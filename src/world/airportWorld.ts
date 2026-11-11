// ============================================================================
// airportWorld.ts — ACT 2: THE AIRPORT (human scale).
//
// You play the terminal manager (Jack's model; he's only named on the island), running the terminal for Anthill Airways. Your ant colony
// is still there: it's the little planter box by the window (the camera
// zooms out from it when you switch worlds), and it keeps working while
// you're here. The Queen still collects your cash in the colony.
//
// LOOP 1 — FLIGHTS
//   passengers line up at CHECK-IN -> pay a ticket + drop a suitcase on the
//   BAGS cart -> you carry bags to the TO PLANE belt -> the plane flies off
//   when its hold is full -> it comes back and pays for every bag it flew.
//
// LOOP 2 — THE ANT CAFÉ
//   the colony ships snack boxes to the ANT EXPORTS crate (faster the more of
//   the colony you've built) -> you carry them to the café -> travellers buy.
//
// Unlock tiles hire crew (people from the Anthill Airways flight crew) until
// it all runs by itself, and your personal assistant (Sarah's model) collects cash.
// ============================================================================
import { autoCash } from '../core/income';
import { bump } from '../core/totals';
import { Upgrades } from './upgradePad';
import { pace } from '../core/pace';
import * as THREE from 'three';
import { AIR, AIR_UNLOCKS, AircraftKind, CONFIG, UNLOCKS } from '../data/config';
import { Aircraft } from './aircraft';
import { Sfx } from '../core/audio';
import { SaveData } from '../core/save';
import { Progress } from '../core/progress';
import { lod } from '../core/lod';
import { Hud } from '../ui/hud';
import { HumanKind, spawnHuman } from '../actors/creatures';
import { CreatureModel, animateCreature, faceToward, makeAnt } from '../actors/models';
import { Player, backLayout, fpFov, handsSpot } from '../actors/player';
import { Route, Worker } from '../actors/worker';
import { Flyers, ITEM_VALUE, ItemType, Stack, StackItem, makeItem } from './items';
import { TextSprite, makePad, TITLE, titleTag } from './labels';
import { Blocker, CashPad, ResourcePile, TrashBin, UnlockTile, Zone, gridLayout } from './stations';

const H = AIR.humanH;
const mat = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A person of `kind`, or a stand-in shape if the model didn't load. */
export function person(kind: HumanKind, height = H): CreatureModel {
  return spawnHuman(kind, height * (0.94 + Math.random() * 0.1)) ?? makeAnt(0x6688aa, true);
}

/** Walk a model toward `t`. Returns true once it's there. */
export function stepTo(m: CreatureModel, t: THREE.Vector3, speed: number, dt: number) {
  speed *= pace.move; // everyone who walks follows the Movement speed slider
  const p = m.root.position;
  const dx = t.x - p.x;
  const dz = t.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.08) {
    animateCreature(m, dt, 0);
    return true;
  }
  const step = Math.min(d, speed * dt);
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  faceToward(m, dx, dz, dt, 8);
  animateCreature(m, dt, speed);
  return d - step < 0.08;
}

// The terminal building (where you can walk) and its doors.
const TERMINAL = { minX: -18, maxX: 18, minZ: -12, maxZ: 12 };
const EAST_DOOR = { from: -5, to: 7 };   // big sliding doors (passengers come in here)
const GATE_DOOR = { from: -0.5, to: 3.5 }; // boarding gate in the north window

// ----------------------------------------------------------------------------
// People lining up at a desk: check-in or the café.
// ----------------------------------------------------------------------------
interface Guest {
  model: CreatureModel;
  held: Stack;         // suitcases they arrive with / snack boxes they buy
  wants: number;       // café: boxes still to buy
  path: THREE.Vector3[]; // waypoints still to walk (arriving or leaving)
  vip?: { patience: number; tag: TextSprite; shown: number }; // 👑 VIP: tips big if served in time
}

/** VIP passengers at check-in: they tip big if served in time, or leave angry. */
const VIP = { chance: 0.12, patience: 30, tip: 6 };

export interface DeskOpts {
  mode: 'checkin' | 'cafe';
  sells?: ItemType;          // café-style desks: what's on the shelf (default snack boxes)
  awning?: number;           // café awning stripe color (default red)
  label: string;
  color: number;
  kinds: HumanKind[];        // who shows up
  interval: number;          // seconds between new arrivals
  queueMax: number;          // most people in line (or on their way to it)
  vips?: boolean;            // check-in: some passengers are 👑 VIPs
  fee?: number;              // check-in: what each guest pays (default: an airline ticket)
  serve: number;             // seconds between each sale / check-in step
  entry: THREE.Vector3[];    // waypoints from outside to the back of the line
  exit: (from: THREE.Vector3) => THREE.Vector3[]; // where they go when done
}

export class Desk {
  group = new THREE.Group();
  staffZone: Zone;           // stand here to serve (or hire staff)
  shelf: Stack | null = null; // café only: snack boxes for sale
  blocker: Blocker;
  hasStaff = false;
  onServe: (byPlayer: boolean) => void = () => {};
  /** A VIP was served in time (tip) or gave up (angry). */
  onVip: (what: 'tip' | 'angry', amount: number, where: THREE.Vector3) => void = () => {};
  /** Rush hour: people arrive ~3x as fast and the line gets longer. */
  rush = false;
  valueMult: () => number = () => 1;
  /** ⬆️ Upgrade: x price per sale, and people arrive / are served faster. */
  priceMult = 1;
  paceMult = 1;
  private queue: Guest[] = [];
  private leaving: Guest[] = [];
  private spawnT = 1;
  private serveT = 0;
  private register = new THREE.Object3D();
  private staff: CreatureModel | null = null;
  private tmp = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene, private x: number, private z: number, private flyers: Flyers,
    private cashPad: CashPad, private bagPile: Stack | null, public opts: DeskOpts,
  ) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    lod.add(this.group, 3);
    const body = mat(opts.color, 0.5);
    const top = mat(new THREE.Color(opts.color).offsetHSL(0, 0, 0.18).getHex(), 0.35);
    this.group.add(box(1.4, 1.55, 3.6, body, 0, 0.78, 0));
    this.group.add(box(1.6, 0.12, 3.8, top, 0, 1.6, 0));
    if (opts.mode === 'checkin') {
      // A monitor, and a sign on a pole
      this.group.add(box(0.1, 0.55, 0.8, mat(0x222831, 0.3), -0.3, 1.95, 1.0));
      this.group.add(box(0.12, 3.4, 0.12, mat(0x8a949e, 0.4, 0.5), 0, 1.7, -1.75));
    } else {
      // Café: a coffee machine and a striped awning
      this.group.add(box(0.6, 0.8, 0.6, mat(0x3a3f45, 0.3, 0.6), -0.2, 2.06, 1.3));
      this.group.add(box(0.2, 0.2, 0.2, mat(0xffffff, 0.3), 0.15, 1.75, 1.3));
      for (let i = 0; i < 6; i++) {
        this.group.add(box(1.9, 0.08, 0.66, mat(i % 2 ? 0xffffff : opts.awning ?? 0xc0392b, 0.6), -0.2, 3.3, -1.65 + i * 0.66));
      }
      for (const zz of [-1.75, 1.75]) this.group.add(box(0.1, 3.3, 0.1, mat(0x5a3a22), -1.0, 1.65, zz));
      this.shelf = new Stack(this.group, gridLayout(2, 4, 0.66, 0.5, 1.66, 0, -0.3), 30);
    }
    this.register.position.set(0, 2.0, 1.2);
    this.group.add(this.register);
    const sign = new TextSprite(0.85);
    sign.setText(opts.label);
    sign.sprite.position.set(0, 4.4, 0);
    this.group.add(sign.sprite);

    const pad = makePad(2.4, 3.2, opts.mode === 'checkin' ? 'CHECK-IN' : 'SELL');
    pad.position.set(-2.4, 0.03, 0);
    this.group.add(pad);
    this.staffZone = new Zone(x - 2.4, z, 1.2, 1.6);
    this.blocker = { minX: x - 0.8, maxX: x + 0.8, minZ: z - 1.9, maxZ: z + 1.9 };
  }

  /** Crew member who serves for you (check-in agent / barista), with a role title. */
  hireStaff(model: CreatureModel, animate: boolean, title: string) {
    this.hasStaff = true;
    this.staff = model;
    model.root.position.set(this.x - 1.4, 0, this.z + 0.9);
    model.root.rotation.y = Math.PI / 2; // face the line
    titleTag(model, title, TITLE.human);
    this.scene.add(model.root);
    if (animate) this.flyers.grow(model.root);
  }

  /** Spot `i` in line (the line runs east from the desk). */
  private slot(i: number, out: THREE.Vector3) {
    return out.set(this.x + 2.3 + i * 2.3, 0, this.z - 0.3);
  }

  private spawnGuest() {
    const kind = this.opts.kinds[Math.floor(Math.random() * this.opts.kinds.length)];
    const model = person(kind);
    const [start, ...rest] = this.opts.entry;
    model.root.position.copy(start);
    this.scene.add(model.root);
    const spot = handsSpot(model);
    const held = new Stack(model.bob, backLayout(() => 0, spot.y0, spot.z0), 4);
    if (this.opts.mode === 'checkin') {
      // Passengers bring 1 or 2 suitcases
      const bags = Math.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < bags; i++) held.addInstant('bag');
    }
    const g: Guest = { model, held, wants: 1 + Math.floor(Math.random() * 3), path: rest.map((v) => v.clone()) };
    if (this.opts.vips && Math.random() < VIP.chance) {
      const tag = new TextSprite(0.42, '#ffd166');
      tag.setText(`👑 VIP · ${VIP.patience}s`);
      this.scene.add(tag.sprite);
      g.vip = { patience: VIP.patience, tag, shown: VIP.patience };
    }
    this.queue.push(g);
  }

  /** How many are waiting (for hints). */
  get waiting() {
    return this.queue.length;
  }

  update(dt: number, playerServing: boolean, sfx: Sfx) {
    this.spawnT += dt;
    const interval = (this.rush ? this.opts.interval * 0.35 : this.opts.interval) / this.paceMult;
    const queueMax = this.rush ? this.opts.queueMax + 3 : this.opts.queueMax;
    if (this.spawnT >= interval && this.queue.length < queueMax) {
      this.spawnT = 0;
      this.spawnGuest();
    }

    // Walk in (entry waypoints first), then shuffle up the line.
    let frontReady = false;
    let angry: Guest | null = null;
    this.queue.forEach((g, i) => {
      g.model.holding = g.held.count > 0;
      if (g.vip) {
        // VIPs count down once they're in line; the tag floats over them.
        if (!g.path.length) g.vip.patience -= dt;
        const secs = Math.max(0, Math.ceil(g.vip.patience));
        if (secs !== g.vip.shown) {
          g.vip.shown = secs;
          g.vip.tag.setText(`👑 VIP · ${secs}s`, secs <= 8 ? '#ff6b6b' : '#ffd166');
        }
        const p = g.model.root.position;
        g.vip.tag.sprite.position.set(p.x, g.model.height + 0.8, p.z);
        if (g.vip.patience <= 0 && !angry) angry = g;
      }
      if (g.path.length) {
        if (stepTo(g.model, g.path[0], 4.2, dt)) g.path.shift();
        return;
      }
      const at = stepTo(g.model, this.slot(i, this.tmp), 3.6, dt);
      if (at) faceToward(g.model, -1, 0, dt, 8);
      if (i === 0) frontReady = at;
    });

    // A VIP who waited too long storms off (no ticket, no tip).
    if (angry) {
      const a = angry as Guest;
      this.onVip('angry', 0, a.model.root.position.clone());
      a.vip!.tag.sprite.removeFromParent();
      a.vip = undefined;
      this.queue.splice(this.queue.indexOf(a), 1);
      a.path = this.opts.exit(a.model.root.position);
      this.leaving.push(a);
    }

    // Serve the front of the line.
    const g = this.queue[0];
    if (g && frontReady && (playerServing || this.hasStaff)) {
      const serve = this.opts.serve / this.paceMult;
      this.serveT = Math.min(this.serveT + dt, serve * 4);
      while (this.serveT >= serve && this.queue[0] === g) {
        this.serveT -= serve;
        if (this.opts.mode === 'checkin') this.serveCheckin(g, playerServing, sfx);
        else this.serveCafe(g, playerServing, sfx);
      }
    }

    // Done: leave along the exit path, then vanish (boarded / gone home).
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.model.holding = l.held.count > 0;
      if (stepTo(l.model, l.path[0], 4.2, dt)) {
        l.path.shift();
        if (!l.path.length) {
          l.model.root.removeFromParent();
          this.leaving.splice(i, 1);
        }
      }
    }
    if (this.staff) animateCreature(this.staff, dt, 0);
  }

  /** Check-in: take one suitcase at a time onto the BAGS cart, then the ticket. */
  private serveCheckin(g: Guest, byPlayer: boolean, sfx: Sfx) {
    if (g.held.count > 0) {
      if (this.bagPile && !this.bagPile.full && this.flyers.transfer(g.held, this.bagPile)) sfx.drop();
      return; // cart full = the line waits (go load the plane!)
    }
    const fee = this.opts.fee ?? AIR.ticket;
    this.spawnBill(fee);
    if (g.vip) {
      // Served in time: a big tip!
      const tip = fee * VIP.tip;
      this.spawnBill(tip);
      this.onVip('tip', Math.round(tip * this.valueMult()), g.model.root.position.clone());
      g.vip.tag.sprite.removeFromParent();
      g.vip = undefined;
    }
    sfx.sale();
    this.onServe(byPlayer);
    this.finish(g);
  }

  /** Café: sell snack boxes one at a time until they've got what they wanted. */
  private serveCafe(g: Guest, byPlayer: boolean, sfx: Sfx) {
    if (g.wants > 0) {
      if (this.shelf && this.flyers.transfer(this.shelf, g.held)) {
        g.wants--;
        this.spawnBill(ITEM_VALUE[this.opts.sells ?? 'snackbox']);
        sfx.sale();
        this.onServe(byPlayer);
      }
      return;
    }
    if (g.held.canPop()) this.finish(g);
  }

  private finish(g: Guest) {
    this.queue.shift();
    g.path = this.opts.exit(g.model.root.position);
    this.leaving.push(g);
  }

  /** A bill pops out of the register onto the cash pad. */
  private spawnBill(base: number) {
    const value = Math.round(base * this.valueMult() * this.priceMult);
    bump('sold'); // 📊 lifetime: sales / check-ins
    payBill(this.scene, this.flyers, this.cashPad, this.register, value);
  }
}

/** Put one cash bill on a pad (or add it to the top bill if the pad is full). */
export function payBill(scene: THREE.Scene, flyers: Flyers, pad: CashPad, from: THREE.Object3D, value: number) {
  if (pad.stack.full) {
    pad.stack.items[pad.stack.count - 1].value += value;
    return;
  }
  const it: StackItem = { mesh: makeItem('cash'), type: 'cash', value, flying: false };
  from.getWorldPosition(it.mesh.position);
  scene.add(it.mesh);
  flyers.pushInto(it, pad.stack, 0.35);
}

// ----------------------------------------------------------------------------
// Sarah, your personal assistant: walks to whichever cash pad has the most
// bills and brings it all to your wallet (like the Queen does for the colony).
// ----------------------------------------------------------------------------
export class Assistant {
  speed = 4.2;
  /** ⬆️ COLLECTORS upgrade: walks and grabs this many times faster. */
  boost = 1;
  private pad: CashPad | null = null;
  private state: 'pick' | 'walk' | 'collect' | 'rest' = 'pick';
  private t = 0;
  private tmp = new THREE.Vector3();

  constructor(public model: CreatureModel, private home: THREE.Vector3, private tag: TextSprite, private onCash: (v: number) => void) {}

  update(dt: number, pads: CashPad[], flyers: Flyers) {
    const m = this.model;
    const p = m.root.position;
    if (this.state === 'pick') {
      this.pad = pads.reduce<CashPad | null>((b, pad) => (pad.stack.count > (b?.stack.count ?? 0) ? pad : b), null);
      this.state = 'walk';
    } else if (this.state === 'walk') {
      const to = this.pad ? this.tmp.set(this.pad.zone.x, 0, this.pad.zone.z + 1.3) : this.home;
      if (stepTo(m, to, this.speed * this.boost, dt)) {
        this.state = this.pad ? 'collect' : 'rest';
        this.t = 2.5;
      }
    } else if (this.state === 'collect') {
      animateCreature(m, dt, 0);
      this.t += dt;
      if (this.t >= 0.1 / this.boost) {
        this.t = 0;
        const bill = this.pad!.stack.pop();
        if (!bill) this.state = 'pick';
        else {
          const target = new THREE.Vector3();
          flyers.fly(bill.mesh, () => target.copy(p).setY(m.height * 0.7), () => {
            bill.mesh.removeFromParent();
            this.onCash(bill.value);
          }, 0.25, 1.0);
        }
      }
    } else {
      animateCreature(m, dt, 0);
      faceToward(m, 0, 1, dt, 3);
      this.t -= dt;
      if (this.t <= 0) this.state = 'pick';
    }
    this.tag.sprite.position.set(p.x, m.height + 0.9, p.z);
  }
}

// ----------------------------------------------------------------------------
// The colony in a planter box: tiny ants scurrying around an anthill. The
// more of Act 1 you've built, the busier it gets.
// ----------------------------------------------------------------------------
class ColonyPlanter {
  group = new THREE.Group();
  blocker: Blocker;
  private ants: THREE.InstancedMesh;
  private walkers: { x: number; z: number; a: number; s: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  readonly topY = 1.25;
  readonly half = 1.8;

  constructor(scene: THREE.Scene, public x: number, public z: number) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const wood = mat(0x9b6a3c, 0.85);
    const s = this.half * 2 + 0.4;
    for (const [w, d, px, pz] of [[s, 0.2, 0, -this.half - 0.1], [s, 0.2, 0, this.half + 0.1], [0.2, s, -this.half - 0.1, 0], [0.2, s, this.half + 0.1, 0]]) {
      this.group.add(box(w, this.topY + 0.1, d, wood, px, (this.topY + 0.1) / 2, pz));
    }
    this.group.add(box(this.half * 2, this.topY - 0.05, this.half * 2, mat(0x6b4426, 1), 0, (this.topY - 0.05) / 2, 0));
    // The anthill and a couple of little plants
    const hill = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.45, 18), mat(0x8a5a33, 1));
    hill.position.set(0.2, this.topY + 0.22, -0.3);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), mat(0x1a0f08, 1));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(0.2, this.topY + 0.451, -0.3);
    this.group.add(hill, hole);
    for (const [px, pz, h] of [[-1.2, -1.1, 1.3], [1.3, 1.0, 0.9], [-1.1, 1.2, 0.7]]) {
      this.group.add(box(0.06, h, 0.06, mat(0x3f7f2a), px, this.topY + h / 2, pz));
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6).scale(1, 0.2, 1.6), mat(0x5cbf43, 0.6));
      leaf.position.set(px, this.topY + h, pz);
      this.group.add(leaf);
    }
    const sign = new TextSprite(0.55, '#ffd166');
    sign.setText('🐜 THE COLONY');
    sign.sprite.position.set(0, 3.0, 0);
    this.group.add(sign.sprite);

    // Each tiny ant: a stretched dark-red blob (one InstancedMesh = one draw call).
    const geo = new THREE.SphereGeometry(1, 6, 4).scale(0.035, 0.03, 0.075);
    this.ants = new THREE.InstancedMesh(geo, mat(0x6e1d0e, 0.5), AIR.colonyAnts);
    this.ants.position.y = this.topY + 0.03;
    this.ants.frustumCulled = false;
    this.group.add(this.ants);
    for (let i = 0; i < AIR.colonyAnts; i++) {
      this.walkers.push({ x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3, a: Math.random() * 6.28, s: 0.25 + Math.random() * 0.2 });
    }
    lod.add(this.group, 3.5);
    this.blocker = { minX: x - this.half - 0.2, maxX: x + this.half + 0.2, minZ: z - this.half - 0.2, maxZ: z + this.half + 0.2 };
  }

  /** `busy` 0..1 = how much of the colony is built. */
  update(dt: number, busy: number) {
    if (!this.group.visible) return;
    const n = Math.max(8, Math.round(AIR.colonyAnts * busy));
    this.ants.count = n;
    const lim = this.half - 0.1;
    for (let i = 0; i < n; i++) {
      const w = this.walkers[i];
      w.a += (Math.random() - 0.5) * dt * 6; // wander
      // Head home to the anthill now and then (so they gather around it)
      const hx = 0.2 - w.x;
      const hz = -0.3 - w.z;
      if (Math.random() < dt * 0.4) w.a = Math.atan2(hx, hz) + (Math.random() - 0.5);
      w.x += Math.sin(w.a) * w.s * dt;
      w.z += Math.cos(w.a) * w.s * dt;
      if (Math.abs(w.x) > lim) { w.x = Math.sign(w.x) * lim; w.a = -w.a; }
      if (Math.abs(w.z) > lim) { w.z = Math.sign(w.z) * lim; w.a = Math.PI - w.a; }
      this.q.setFromAxisAngle(this.up, w.a);
      this.ants.setMatrixAt(i, this.m.compose(this.v.set(w.x, 0, w.z), this.q, this.one));
    }
    this.ants.instanceMatrix.needsUpdate = true;
  }

  /** A point just above the planter (where the camera zooms out from). */
  get eye() {
    return new THREE.Vector3(this.x + 0.2, this.topY, this.z - 0.3);
  }
}

// ============================================================================
export class AirportWorld {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  flyers = new Flyers(this.scene);
  player: Player;
  cashPads: CashPad[] = [];
  tiles: UnlockTile[] = [];
  workers: Worker[] = [];

  private checkin: Desk;
  private cafe: Desk | null = null;
  private crate: ResourcePile | null = null;
  private plane: Aircraft;
  private heli: Aircraft | null = null;
  private flightPad!: CashPad;
  private bagPile: Stack;
  private bagZone: Zone;
  private trash: TrashBin;
  private planter: ColonyPlanter;
  private director: CreatureModel | null = null;
  private sarah: Assistant | null = null;
  private blockers: Blocker[] = [];
  private timers = new Map<object, number>();
  private trolley = false;
  private rushT = 150 + Math.random() * 60;
  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private camOffset = new THREE.Vector3(0, 14, 10.5);
  private intro = 1; // 0 -> 1: camera zooming out from the planter
  private zoneName = '';
  private walk = { minX: TERMINAL.minX + 0.6, maxX: TERMINAL.maxX - 0.6, minZ: TERMINAL.minZ + 0.6, maxZ: TERMINAL.maxZ - 0.6 };

  constructor(private hud: Hud, private sfx: Sfx, private save: SaveData, private progress: Progress) {
    this.buildTerminal();
    this.planter = new ColonyPlanter(this.scene, -13.5, -5.8);
    this.blockers.push(this.planter.blocker);

    // Jack (you), in the terminal next to the colony
    const jack = person('h-jack');
    jack.root.position.set(-2, 0, -4);
    this.player = new Player(this.scene, { model: jack, spot: handsSpot(jack) });

    // Flights: the BAGS cart, check-in desk and the plane
    const bags = new THREE.Group();
    bags.position.set(5, 0, -8.5);
    this.scene.add(bags);
    bags.add(box(2.6, 0.25, 1.9, mat(0x5b6670, 0.5, 0.4), 0, 0.35, -0.2));
    for (const [wx, wz] of [[-1, -0.9], [1, -0.9], [-1, 0.5], [1, 0.5]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12), mat(0x222222));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.18, wz);
      bags.add(wheel);
    }
    const bagsPad = makePad(3.2, 3.2, 'BAGS', '#ffe07a');
    bags.add(bagsPad);
    this.bagPile = new Stack(bags, gridLayout(3, 4, 0.76, 0.38, 0.48, 0, -0.2), 36);
    this.bagZone = new Zone(5, -8.5, 1.6, 1.6);
    lod.add(bags, 2.5);

    const ticketPad = new CashPad(this.scene, 6.6, 1.2);
    this.cashPads.push(ticketPad);
    this.checkin = new Desk(this.scene, 9, -3, this.flyers, ticketPad, this.bagPile, {
      mode: 'checkin', label: '✈️ CHECK-IN', color: 0x2d6cdf, kinds: ['h-exec', 'h-balance', 'h-ember'], interval: AIR.passengerInterval,
      queueMax: AIR.queueMax, serve: AIR.serveInterval, vips: true,
      entry: [new THREE.Vector3(34, 0, 0), new THREE.Vector3(21, 0, -1)],
      // After check-in: around the desk, then out through the boarding gate
      exit: (from) => [new THREE.Vector3(from.x, 0, 1.0), new THREE.Vector3(2.5, 0, -1.5), new THREE.Vector3(1.5, 0, -11.2), new THREE.Vector3(1.5, 0, -14)],
    });
    this.addDesk(this.checkin);
    this.checkin.onVip = (what, amount, where) => {
      if (!this.active) return;
      if (what === 'tip') this.hud.floatAt(where.setY(H + 1), this.camera, `👑 VIP tip +$${amount}`, 'big gold');
      else this.hud.floatAt(where.setY(H + 1), this.camera, '😠 VIP left!', 'big bad');
    };

    // The plane (starts as a Cessna 172; fleet upgrades swap it) + its cash pad
    this.flightPad = new CashPad(this.scene, 15.6, -9.5);
    this.cashPads.push(this.flightPad);
    this.plane = this.addAircraft(12, -9.5, 'cessna', this.flightPad);
    this.blockers.push(this.checkin.blocker);

    this.trash = new TrashBin(this.scene, -15.5, 9.5);

    // The Director (the airport's boss) welcomes you near the entrance
    const dir = spawnHuman('h-director', H * 1.02);
    if (dir) {
      dir.root.position.set(-7, 0, 10.2);
      this.scene.add(dir.root);
      this.director = dir;
      const tag = new TextSprite(0.5, '#ffd166');
      tag.setText('🎩 DIRECTOR');
      tag.sprite.position.set(-7, H + 0.8, 10.2);
      this.scene.add(tag.sprite);
      this.blockers.push({ minX: -7.5, maxX: -6.5, minZ: 9.7, maxZ: 10.7 });
    }

    for (const def of AIR_UNLOCKS) this.tiles.push(new UnlockTile(this.scene, def, save.paid[def.id] ?? 0));
    for (const id of save.unlocked) this.applyUnlock(id, false);
    this.refreshTiles(false);
    this.camera.position.copy(this.player.pos).add(this.camOffset);
    this.camera.lookAt(this.player.pos);
  }

  /** True while this is the world on screen (set by main.ts). */
  active = false;
  /** ⬆️ This world's upgrade pads. */
  ups: Upgrades | null = null;
  /** Set by main.ts: "Big Order: Island" bought -> open Dino Island (Act 3). */
  onAct3: () => void = () => {};

  // --------------------------------------------------------------------------
  // Building
  // --------------------------------------------------------------------------
  private buildTerminal() {
    const s = this.scene;
    s.background = new THREE.Color(0x9fd8ff);
    s.fog = new THREE.Fog(0x9fd8ff, 70, 170);
    s.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.7));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -24;
    sc.right = sc.top = 24;
    sc.near = 1;
    sc.far = 70;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // Outside: grass, the apron (where the plane parks) and the runway
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat(0x7cc35a, 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 26), mat(0x8d949b, 0.9));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, -0.01, -24);
    apron.receiveShadow = true;
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(260, 12), mat(0x4a4f55, 0.9));
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0, -44);
    runway.receiveShadow = true;
    s.add(ground, apron, runway);
    const dash = mat(0xf5f5f5);
    for (let x = -120; x <= 120; x += 10) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), dash);
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.01, -44);
      s.add(d);
    }
    // Yellow taxi line to the gate
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(220, 0.3), mat(0xffc928));
    taxi.rotation.x = -Math.PI / 2;
    taxi.position.set(0, 0.005, -20);
    s.add(taxi);

    // Terminal floor: big glossy tiles
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e9edf1';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#dde3e9';
    g.fillRect(0, 0, 128, 128);
    g.fillRect(128, 128, 128, 128);
    g.strokeStyle = 'rgba(120,130,140,0.35)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 256, 256);
    g.strokeRect(0, 0, 128, 128);
    g.strokeRect(128, 128, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(9, 6);
    tex.anisotropy = 8;
    const w = TERMINAL.maxX - TERMINAL.minX;
    const d = TERMINAL.maxZ - TERMINAL.minZ;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.01, 0);
    floor.receiveShadow = true;
    s.add(floor);
    // Red carpet from the doors
    const trim = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.6), mat(0xd4a017, 0.6));
    trim.rotation.x = -Math.PI / 2;
    trim.position.set(14.6, 0.015, 1);
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 2.3), mat(0x7d1f2a, 0.95));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(14.6, 0.02, 1);
    carpet.receiveShadow = trim.receiveShadow = true;
    s.add(trim, carpet);

    // Walls: low on the camera sides (so they never hide you), a tall glass
    // window wall on the runway side.
    const wallMat = mat(0xcfd6dd, 0.6);
    const wallH = 1.1;
    const wall = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const m = box(x1 === x2 ? 0.35 : len, wallH, x1 === x2 ? len : 0.35, wallMat, (x1 + x2) / 2, wallH / 2, (z1 + z2) / 2);
      s.add(m);
    };
    wall(TERMINAL.minX, TERMINAL.maxZ, TERMINAL.maxX, TERMINAL.maxZ); // south
    wall(TERMINAL.minX, TERMINAL.minZ, TERMINAL.minX, TERMINAL.maxZ); // west
    wall(TERMINAL.maxX, TERMINAL.minZ, TERMINAL.maxX, EAST_DOOR.from); // east, either side of the doors
    wall(TERMINAL.maxX, EAST_DOOR.to, TERMINAL.maxX, TERMINAL.maxZ);
    // Door frame + sign
    const frame = mat(0x5b6670, 0.4, 0.5);
    for (const zz of [EAST_DOOR.from, EAST_DOOR.to]) s.add(box(0.4, 4.2, 0.4, frame, TERMINAL.maxX, 2.1, zz));
    s.add(box(0.4, 0.5, EAST_DOOR.to - EAST_DOOR.from + 0.4, frame, TERMINAL.maxX, 4.2, (EAST_DOOR.from + EAST_DOOR.to) / 2));
    const doorSign = new TextSprite(0.7);
    doorSign.setText('🚪 ENTRANCE');
    doorSign.sprite.position.set(TERMINAL.maxX, 5.1, 1);
    s.add(doorSign.sprite);

    // Window wall (north): glass panes + steel mullions, gap at the gate
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
    const pane = (x1: number, x2: number) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, 5.2), glass);
      p.position.set((x1 + x2) / 2, 2.6, TERMINAL.minZ);
      s.add(p);
    };
    pane(TERMINAL.minX, GATE_DOOR.from);
    pane(GATE_DOOR.to, TERMINAL.maxX);
    for (let x = TERMINAL.minX; x <= TERMINAL.maxX; x += 4) {
      if (x > GATE_DOOR.from && x < GATE_DOOR.to) continue;
      s.add(box(0.18, 5.2, 0.18, frame, x, 2.6, TERMINAL.minZ));
    }
    s.add(box(TERMINAL.maxX - TERMINAL.minX, 0.3, 0.3, frame, 0, 5.3, TERMINAL.minZ));
    s.add(box(TERMINAL.maxX - TERMINAL.minX, 0.25, 0.3, frame, 0, 0.12, TERMINAL.minZ));
    for (const xx of [GATE_DOOR.from, GATE_DOOR.to]) s.add(box(0.35, 5.2, 0.35, mat(0x2d6cdf, 0.4), xx, 2.6, TERMINAL.minZ));
    const gateSign = new TextSprite(0.7, '#ffd166');
    gateSign.setText('GATE 1 ✈️');
    gateSign.sprite.position.set((GATE_DOOR.from + GATE_DOOR.to) / 2, 6.2, TERMINAL.minZ);
    s.add(gateSign.sprite);

    // Waiting-area benches by the gate
    const seat = mat(0x2d6cdf, 0.5);
    for (const bx of [-7, -3.5]) {
      for (const bz of [-9.8]) {
        s.add(box(2.8, 0.18, 0.8, seat, bx, 0.9, bz));
        s.add(box(2.8, 0.8, 0.15, seat, bx, 1.35, bz - 0.38));
        s.add(box(0.12, 0.9, 0.6, frame, bx - 1.2, 0.45, bz));
        s.add(box(0.12, 0.9, 0.6, frame, bx + 1.2, 0.45, bz));
        this.blockers.push({ minX: bx - 1.4, maxX: bx + 1.4, minZ: bz - 0.5, maxZ: bz + 0.4 });
      }
    }
    // Potted plants in the corners
    for (const [px, pz] of [[16.6, 10.6], [16.6, -10.6], [-16.6, 10.6]]) {
      s.add(box(0.9, 0.9, 0.9, mat(0xf0f0f0, 0.5), px, 0.45, pz));
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), mat(0x3f9b3a, 0.8));
      bush.position.set(px, 1.5, pz);
      bush.castShadow = true;
      s.add(bush);
    }
  }

  /** An aircraft + its belt pad. It pays onto `pad` when it lands back. */
  private addAircraft(padX: number, padZ: number, kind: AircraftKind, pad: CashPad) {
    const a = new Aircraft(this.scene, this.flyers, padX, padZ, kind, TERMINAL.minZ);
    a.onPayout = (n) => {
      const total = n * ITEM_VALUE.bag * a.fare * this.progress.cashMult;
      const bills = Math.min(10, n);
      for (let i = 0; i < bills; i++) payBill(this.scene, this.flyers, pad, a.doorObj, Math.round(total / bills));
      this.progress.addXp(n * CONFIG.xp.runPerItem);
      if (this.active) {
        this.sfx.unlocked();
        this.hud.floatAt(new THREE.Vector3(pad.zone.x, 3, pad.zone.z), this.camera, `${a.kind === 'heli' ? '🚁' : '✈️'} +$${Math.round(total)}`, 'big gold');
      }
    };
    a.onDepart = () => {
      if (!this.active) return;
      this.sfx.gateGood();
      this.hud.banner(`${a.kind === 'heli' ? '🚁' : '✈️'} ${a.spec.name} departing!`, 'It pays for every bag when it lands back here', 2200);
    };
    return a;
  }

  /** Register a desk: serving gives XP, Haggling raises prices. */
  private addDesk(d: Desk) {
    d.onServe = (byPlayer) => this.progress.addXp(byPlayer ? CONFIG.xp.sale : CONFIG.xp.autoSale);
    d.valueMult = () => this.progress.cashMult;
  }

  /** How much of the colony (Act 1) is built, 0..1 — speeds up the export crate. */
  private colonyBuilt() {
    const ids = new Set(UNLOCKS.map((u) => u.id));
    return this.save.unlocked.filter((id) => ids.has(id)).length / UNLOCKS.length;
  }

  // --------------------------------------------------------------------------
  // Unlocks
  // --------------------------------------------------------------------------
  private crew(title: string, kind: HumanKind, x: number, z: number, route: () => Route, animate: boolean) {
    const m = person(kind);
    const w = new Worker(this.scene, x, z, route, { color: 0 }, H, { model: m, spot: handsSpot(m), carry: AIR.crewCarry, speed: AIR.crewSpeed });
    titleTag(m, title, TITLE.human);
    this.workers.push(w);
    if (animate) this.flyers.grow(m.root);
  }

  private applyUnlock(id: string, animate: boolean) {
    const def = AIR_UNLOCKS.find((u) => u.id === id);
    if (!def) return;
    const grow = (o: THREE.Object3D) => animate && this.flyers.grow(o);
    switch (id) {
      case 'a2-agent':
        this.checkin.hireStaff(person('h-crew4'), animate, '🎫 AGENT');
        break;
      case 'a2-trolley':
        this.trolley = true;
        break;
      case 'a2-cafe': {
        const pad = new CashPad(this.scene, -11.4, 8.6);
        this.cashPads.push(pad);
        this.cafe = new Desk(this.scene, -9, 4, this.flyers, pad, null, {
          mode: 'cafe', label: '☕ ANT CAFÉ', color: 0x8a5a33, kinds: ['h-exec', 'h-balance', 'h-ember'], interval: AIR.cafeInterval,
          queueMax: AIR.cafeQueueMax, serve: AIR.cafeServe,
          // Arriving passengers: off the plane through Gate 1, grab a snack on the way out
          entry: [new THREE.Vector3(1.5, 0, -14), new THREE.Vector3(1.5, 0, -10.5), new THREE.Vector3(-1, 0, 1.4)],
          exit: (from) => [new THREE.Vector3(from.x, 0, 7.4), new THREE.Vector3(16, 0, 7.4), new THREE.Vector3(21, 0, 5), new THREE.Vector3(34, 0, 4)],
        });
        this.addDesk(this.cafe);
        this.blockers.push(this.cafe.blocker);
        // The colony's export crate sits right next to the café (short trips)
        this.crate = new ResourcePile(this.scene, -12.8, -0.9, this.flyers, 'snackbox', 'crate');
        const built = () => this.colonyBuilt();
        this.crate.spawnEvery = () => AIR.crateSlowest - (AIR.crateSlowest - AIR.crateFastest) * built();
        this.blockers.push({ minX: -14.1, maxX: -11.5, minZ: -3.6, maxZ: -2.2 });
        [this.cafe.group, pad.group, this.crate.group].forEach(grow);
        if (animate) this.hud.banner('☕ The Ant Café is open!', 'The colony ships snack boxes to the ANT EXPORTS crate', 3500);
        break;
      }
      case 'a2-handler':
        this.crew('🧳 HANDLER', 'h-crew1', 8, -8, () => {
          // Feed whichever aircraft is shorter on bags (the helicopter's hold is small).
          const h = this.heli;
          const to = h && h.cargo.count + h.hold < h.holdMax && h.cargo.count < this.plane.cargo.count ? h : this.plane;
          return { src: this.bagPile, srcZone: this.bagZone, dst: to.cargo, dstZone: to.zone };
        }, animate);
        break;
      case 'a2-barista':
        if (this.cafe) this.cafe.hireStaff(person('h-crew3'), animate, '☕ BARISTA');
        break;
      case 'a2-host':
        this.crew('🍱 HOST', 'h-crew2', -9, 0, () => ({ src: this.crate!.stack, srcZone: this.crate!.zone, dst: this.cafe!.shelf!, dstZone: this.cafe!.staffZone }), animate);
        break;
      // Fleet upgrades: the plane is swapped for the next one up.
      case 'a2-twin':
      case 'a2-jet':
      case 'a2-liner': {
        const kind = id === 'a2-twin' ? 'twin' : id === 'a2-jet' ? 'jet' : 'liner';
        this.plane.setKind(kind);
        grow(this.plane.group);
        if (animate) this.hud.banner(`✈️ New plane: ${this.plane.spec.name}!`, `Holds ${this.plane.holdMax} bags · ${this.plane.spec.fare}x fares`, 3500);
        break;
      }
      case 'a2-heli': {
        const pad = new CashPad(this.scene, -12, -10.2);
        this.cashPads.push(pad);
        this.heli = this.addAircraft(-15.5, -10.2, 'heli', pad);
        [this.heli.group, pad.group].forEach(grow);
        if (animate) this.hud.banner('🚁 Helipad open!', 'Quick trips, small hold, big fares', 3500);
        break;
      }
      case 'a2-sarah': {
        const m = person('h-sarah');
        m.root.position.set(3, 0, 7.5);
        this.scene.add(m.root);
        grow(m.root);
        const tag = new TextSprite(TITLE.human, '#ffd166');
        tag.setText('💼 ASSISTANT'); // (Sarah's model; she's only named on the island)
        this.scene.add(tag.sprite);
        this.sarah = new Assistant(m, new THREE.Vector3(3, 0, 7.5), tag, (v) => {
          v *= this.ups?.bonus ?? 1; // 💼 COLLECTORS upgrade bonus
          this.addCash(v);
          autoCash(v);
        });
        if (animate) this.hud.banner('👩‍💼 You hired a personal assistant!', 'She collects the cash from every pad for you', 3500);
        break;
      }
      case 'a2-island':
        if (animate) this.onAct3(); // main.ts opens Dino Island
        break;
    }
  }

  private unlock(tile: UnlockTile) {
    const id = tile.def.id;
    this.save.unlocked.push(id);
    delete this.save.paid[id];
    tile.mesh.visible = false;
    this.applyUnlock(id, true);
    this.progress.addXp(tile.def.cost * CONFIG.xp.unlockFraction * 0.5);
    this.sfx.unlocked();
    this.hud.floatAt(tile.mesh.position.clone().setY(2), this.camera, 'UNLOCKED!', 'big gold');
    this.refreshTiles(true);
  }

  private refreshTiles(animate: boolean) {
    for (const t of this.tiles) {
      const show = !this.save.unlocked.includes(t.def.id) && t.def.requires.every((r) => this.save.unlocked.includes(r));
      if (show && !t.mesh.visible && animate) this.flyers.grow(t.mesh);
      t.mesh.visible = show;
    }
  }

  addCash(amount: number) {
    this.save.cash += amount;
    this.hud.setCash(this.save.cash);
  }

  // --------------------------------------------------------------------------
  // Per frame
  // --------------------------------------------------------------------------
  private every(key: object, dt: number, on: boolean, interval: number, fn: () => void) {
    if (!on) {
      this.timers.set(key, interval);
      return;
    }
    let t = (this.timers.get(key) ?? interval) + dt;
    while (t >= interval) {
      t -= interval;
      fn();
    }
    this.timers.set(key, t);
  }

  private canWalk = (x: number, z: number) => {
    const w = this.walk;
    return x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ;
  };

  /**
   * @param active false = you're in the ant colony: the airport keeps running
   *               (crew, plane, café...) but Jack stands still and no HUD.
   */
  update(dt: number, move: THREE.Vector2) {
    // ⬆️ Upgrade pads (made on the first frame, once the world is built)
    this.ups ??= new Upgrades(
      {
        scene: this.scene, camera: this.camera, workers: this.workers, home: new THREE.Vector3(3, 0, 7.5), canWalk: this.canWalk, // (home = by the assistant's spot)
        tileSpots: AIR_UNLOCKS.map((d) => d.pos), collectors: () => this.sarah ? [this.sarah] : [],
      },
      'air', this.save, this.hud, this.sfx, this.flyers, this.progress,
    );
    this.ups.update(dt, this, this.player.pos, this.active);
    const me = this.player;
    const p = me.pos;
    const prog = this.progress;
    const xp = CONFIG.xp;

    // Rush hour now and then: passengers pour in (~40 s every 2.5-3.5 min)
    this.rushT -= dt;
    if (this.rushT <= 0) {
      this.checkin.rush = !this.checkin.rush;
      this.rushT = this.checkin.rush ? 40 : 150 + Math.random() * 60;
      if (this.active && this.checkin.rush) this.hud.banner('🏃 Rush hour!', 'Passengers are pouring in: keep the bags moving', 2800);
    }
    this.checkin.update(dt, this.active && this.checkin.staffZone.contains(p), this.sfx);
    this.cafe?.update(dt, this.active && this.cafe.staffZone.contains(p), this.sfx);
    this.crate?.update(dt);
    this.plane.update(dt);
    this.heli?.update(dt);
    for (const w of this.workers) w.update(dt, this.flyers);
    this.sarah?.update(dt, this.cashPads, this.flyers);
    this.planter.update(dt, this.colonyBuilt());
    if (this.director) {
      animateCreature(this.director, dt, 0);
      faceToward(this.director, p.x - this.director.root.position.x, p.z - this.director.root.position.z, dt, 2);
    }

    if (this.active) {
      me.carryMax = CONFIG.player.baseCarry + (this.trolley ? AIR.trolleyCarry : 0) + prog.carryBonus;
      me.speedMult = prog.speedMult * AIR.speedMult;
      me.update(dt, move, this.blockers, this.canWalk);
      this.interact(dt);
      this.hud.setInventory(me.stack.counts(), me.stack.count, me.carryMax);
      const name = '✈️ Airport Terminal';
      if (name !== this.zoneName) {
        this.zoneName = name;
        this.hud.setZone(name);
      }
      this.showHint();
    } else {
      animateCreature(me.model, dt, 0);
    }
    this.flyers.update(dt);
    if (this.active) this.updateCamera(dt);
    void xp;
  }

  /** Everything Jack does by standing on pads. */
  private interact(dt: number) {
    const me = this.player;
    const p = me.pos;
    const prog = this.progress;
    const xp = CONFIG.xp;
    const iv = CONFIG.player.pickupInterval / prog.workMult;
    const has = (t: ItemType) => me.stack.has(t);

    // Pick up: bags from the cart, snack boxes from the crate
    const takeFrom = (key: object, zone: Zone, from: Stack) =>
      this.every(key, dt, zone.contains(p) && me.canTake(), iv, () => {
        if (me.canTake() && this.flyers.transfer(from, me.stack)) {
          this.sfx.pickup();
          prog.addXp(xp.pickup);
        }
      });
    takeFrom(this.bagZone, this.bagZone, this.bagPile);
    if (this.crate) takeFrom(this.crate.zone, this.crate.zone, this.crate.stack);

    // Drop off: bags on the plane belt, snack boxes on the café counter
    const dropTo = (zone: Zone, to: Stack, type: ItemType) =>
      this.every(zone, dt, zone.contains(p) && has(type), iv, () => {
        if (!to.full && this.flyers.transferType(me.stack, to, type)) {
          this.sfx.drop();
          prog.addXp(xp.drop);
        }
      });
    dropTo(this.plane.zone, this.plane.cargo, 'bag');
    if (this.heli) dropTo(this.heli.zone, this.heli.cargo, 'bag');
    if (this.cafe?.shelf) dropTo(this.cafe.staffZone, this.cafe.shelf, 'snackbox');

    // Cash pads -> wallet
    for (const pad of this.cashPads) {
      this.every(pad.zone, dt, pad.zone.contains(p), 0.035, () => {
        const bill = pad.stack.pop();
        if (!bill) return;
        const target = new THREE.Vector3();
        this.flyers.fly(bill.mesh, () => target.copy(p).setY(H * 0.6), () => {
          bill.mesh.removeFromParent();
          this.addCash(bill.value);
          this.sfx.cash();
        }, 0.22, 0.8);
      });
    }

    // Trash bin
    this.every(this.trash.zone, dt, this.trash.zone.contains(p) && me.stack.count > 0, 0.04, () => {
      const it = me.stack.pop();
      if (!it) return;
      this.flyers.fly(it.mesh, () => this.trash.mouth, () => it.mesh.removeFromParent(), 0.25, 1.0);
      this.sfx.drop();
    });

    // Unlock tiles
    for (const t of this.tiles) {
      if (!t.mesh.visible) continue;
      const affordable = this.save.cash >= 1;
      t.update(dt, affordable && this.save.cash >= t.remaining);
      if (affordable && t.zone.contains(p)) {
        const rate = Math.max(t.def.cost / CONFIG.unlockDrainTime, CONFIG.unlockMinRate);
        const pay = Math.min(this.save.cash, rate * dt, t.def.cost - t.paid);
        t.paid += pay;
        this.save.cash -= pay;
        this.save.paid[t.def.id] = t.paid;
        this.hud.setCash(this.save.cash);
        this.sfx.unlockTick();
        if (t.paid >= t.def.cost - 1e-6) this.unlock(t);
      }
    }
  }

  /** A simple first-time guide, until the flights loop is understood. */
  private hintShown = '';
  private showHint() {
    const me = this.player.stack;
    let hint: string | null = null;
    if (!this.save.unlocked.includes('a2-agent')) {
      if (me.has('bag')) hint = 'Load the bags onto the TO PLANE belt ✈️';
      else if (this.bagPile.count > 0) hint = 'Grab the suitcases 🧳 from the BAGS cart';
      else hint = 'Stand on CHECK-IN to check passengers in 🛂';
    }
    if (hint !== this.hintShown) {
      this.hintShown = hint ?? '';
      this.hud.setHint(hint);
    }
  }

  // --------------------------------------------------------------------------
  // Camera, switching worlds
  // --------------------------------------------------------------------------
  /** Called when you switch to the airport: the camera zooms out from the colony. */
  enter(zoomFromColony: boolean) {
    this.active = true;
    this.zoneName = '';
    this.hintShown = '-';
    this.hud.setCash(this.save.cash);
    this.intro = zoomFromColony ? 0 : 1;
    if (zoomFromColony) {
      const eye = this.planter.eye;
      this.camera.position.set(eye.x, eye.y + 0.5, eye.z + 0.9);
      this.camera.lookAt(eye);
    }
  }

  leave() {
    this.active = false;
    this.hud.setHint(null);
  }

  /** Where the camera looks, for culling (LOD). */
  get focus() {
    return this.player.pos;
  }

  private camLook = new THREE.Vector3();
  private updateCamera(dt: number) {
    const target = this.player.pos;
    const want = new THREE.Vector3().copy(target).add(this.camOffset);
    this.setFov(this.player.firstPerson && this.intro >= 1 ? fpFov(this.camera.aspect) : this.thirdFov);
    if (this.player.firstPerson && this.intro >= 1) {
      this.player.placeEyeCamera(this.camera);
      this.sun.position.set(target.x + 10, 26, target.z + 12);
      this.sun.target.position.copy(target);
      return;
    }
    if (this.intro < 1 && this.player.firstPerson) {
      // Zooming out of the colony straight into Jack's eyes
      this.intro = Math.min(1, this.intro + dt / 2.6);
      const k = this.intro * this.intro * (3 - 2 * this.intro);
      const eye = this.planter.eye;
      const from = new THREE.Vector3(eye.x, eye.y + 0.5, eye.z + 0.9);
      this.player.placeEyeCamera(this.camera);
      const to = this.camera.position.clone();
      const toQ = this.camera.quaternion.clone();
      this.camera.position.copy(from);
      this.camera.lookAt(eye);
      this.camera.position.lerp(to, k);
      this.camera.quaternion.slerp(toQ, k);
      return;
    }
    if (this.intro < 1) {
      // Zoom out from the tiny colony to human scale (a slow ease).
      this.intro = Math.min(1, this.intro + dt / 2.6);
      const k = this.intro * this.intro * (3 - 2 * this.intro);
      const eye = this.planter.eye;
      const from = new THREE.Vector3(eye.x, eye.y + 0.5, eye.z + 0.9);
      this.camera.position.lerpVectors(from, want, k);
      this.camLook.lerpVectors(eye, target, k);
      this.camera.lookAt(this.camLook);
    } else {
      this.camera.position.lerp(want, Math.min(1, dt * 5));
      this.camera.lookAt(this.camera.position.x - this.camOffset.x, 0, this.camera.position.z - this.camOffset.z);
    }
    this.sun.position.set(target.x + 10, 26, target.z + 12);
    this.sun.target.position.copy(target);
  }

  setShadowSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
  }

  /** Third-person field of view (set in resize); first person is wider. */
  private thirdFov = 42;
  private setFov(fov: number) {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    // A little further back than the colony: people and planes are bigger.
    const portrait = w < h;
    this.camOffset.set(0, portrait ? 20 : 16, portrait ? 17.5 : 15.5);
    this.thirdFov = portrait ? 56 : 42;
    this.camera.fov = this.player.firstPerson ? fpFov(this.camera.aspect) : this.thirdFov;
    this.camera.updateProjectionMatrix();
  }
}
