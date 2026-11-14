// ============================================================================
// gateRun.ts — the gate run: a beetle cart races down a path through rows of
// gates. Each row has two gates (left / right); you pass through one and its
// math is applied to your cargo count: +12, x2, -8, ÷2, or ? (a gamble).
// Puddles knock some cargo off. Whatever reaches the finish line is paid out.
//
// Tuning (see CONFIG.run and the docs): one x2 row and one ? row per run, so
// a great run lands around 2-3x the starting count, a bad one about 0.5x.
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { Sfx } from '../core/audio';
import { Hud } from '../ui/hud';
import { CreatureModel, animateCreature, makeBeetle } from '../actors/models';
import { SeaKind, spawnCreature, spawnHuman, spawnSea } from '../actors/creatures';
import { ITEM_VALUE, ItemType, makeItem } from '../world/items';
import { RunTheme, makeVehicle } from '../world/stations';
import { TEXT_RES, TextSprite, gameText, roundRect, sharpTexture } from '../world/labels';
import { buildAircraftModel } from '../world/aircraft';
import { makeRex, roar } from '../actors/rex';

type OpKind = '+' | '-' | 'x' | '/' | '?';
interface Op {
  kind: OpKind;
  v: number;
}
interface Gate {
  group: THREE.Group;
  op: Op;
  side: -1 | 1;
  panel: THREE.MeshBasicMaterial;
}
interface Row {
  z: number;
  gates: Gate[];
  passed: boolean;
  swap?: boolean;   // bonus run trick: the gates trade sides as you get close
  swapped?: boolean;
  risky?: boolean;  // ⚠️ a risky row (pings once as you get close)
  warned?: boolean;
}

/** Sea Safari: a sea creature that leaps out beside the boat (get close for a photo!). */
interface Breacher {
  m: THREE.Object3D;
  x: number;
  z: number;
  t: number;        // 0..1 through its leap (-1 = still waiting)
  snapped: boolean;
}

/** Options for a special run (the offline-earnings bonus run). */
export interface RunOpts {
  hard?: boolean;     // more traps: worse gates, more hazards, gates that swap sides
  valueEach?: number; // cash per item at the finish (instead of the item's price)
  keepMin?: number;   // never pay less than this
  /** The exact payout for (items at the finish, items at the start): shown on the
   *  results card, and main.ts pays the same number (the bonus run). */
  payout?: (end: number, start: number) => number;
  title?: string;     // banner at the start
}
interface Puddle {
  x: number;
  z: number;
  r: number;
  hit: boolean;
  monster?: THREE.Object3D; // ocean: a sea creature lurking under the surface
  risky?: boolean;          // ⚠️ sits right behind a risky ×2 gate: knocks off more
}

/**
 * 📦 DELIVERY CONTRACTS: every regular run has a goal ("finish with 20"). Fill
 * it and the haul pays +50%; miss it and you still get the regular haul.
 * The goal is ~1.5x what you USUALLY load in that world: load more than usual
 * and a safe route gets there; load light and you'll need a risky gate.
 */
export const CONTRACT = { goalMult: 1.5, bonus: 1.5, min: { grass: 12, gutter: 12, ocean: 10, lava: 10, hotel: 10 } as Record<RunTheme, number> };
/** ⚠️ RISKY GATES (from your 3rd run): a small safe +N vs a gold ×2 with a hazard right behind it. */
const RISK = { fromRun: 2, hazardLoss: 0.35 };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const isGood = (k: OpKind) => k === '+' || k === 'x';

/** Apply a gate's math to the current count. `win` = the chance a ? gate pays x3. */
function applyOp(count: number, op: Op, win = 0.5): number {
  switch (op.kind) {
    case '+': return count + op.v;
    case '-': return Math.max(0, count - op.v);
    case 'x': return count * op.v;
    case '/': return Math.floor(count / op.v);
    case '?': return Math.random() < win ? count * 3 : Math.floor(count / 2);
  }
}

function opLabel(op: Op) {
  if (op.kind === '?') return '?';
  if (op.kind === '/') return `÷${op.v}`;
  return `${op.kind}${op.v}`;
}

export class GateRun {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  active = false;
  /** 🍀 Luck (set by main.ts before each run): ? gate win chance + share of losses saved. */
  luckWin = 0.5;
  luckSave = 0;
  /** Haggling multiplier, for showing the right payout on the results card. */
  cashMult = 1;
  /** Set once by main.ts: each world's usual load (for contract goals) + runs done. */
  memory: { contracts: Record<string, number>; runs: () => number } | null = null;
  /** This run's 📦 contract goal (0 = no contract). */
  private target = 0;
  private goalLabel = new TextSprite(0.7);

  private rows: Row[] = [];
  private puddles: Puddle[] = [];
  private breachers: Breacher[] = [];
  private boss: THREE.Object3D | null = null; // the Megalodon at the Sea Safari finish
  private rexBoss: ReturnType<typeof makeRex> | null = null; // the Lava Rex at the heli tour finish
  private heliSpin: THREE.Object3D[] = [];
  private bellhop: CreatureModel | null = null;     // pushes the luggage cart (Bellhop Dash)
  private celeb: { m: CreatureModel; flashes: THREE.Mesh[] } | null = null; // waits at the finish
  private bossT = -1;
  private bossDone = false;
  private dynamic = new THREE.Group(); // everything rebuilt each run
  private cart = new THREE.Group();
  private cargo = new THREE.Group();
  private beetle: CreatureModel;
  private countLabel = new TextSprite(1.1);
  private startCount = 0;
  private count = 0;
  /** 🚩 The most the cart can hold this run (CONFIG.run.maxLoad x the load; no cap on a bonus run). */
  private cap = Infinity;
  private hitCap = false;
  private shownCargo = -1;
  private x = 0;
  private z = 0;
  private speed = 0;
  private state: 'ready' | 'run' | 'done' = 'ready';
  private stateT = 0;
  private finishZ = 0;
  private onDone: (endCount: number) => void = () => {};
  private labelPop = 0;
  private theme: RunTheme = 'grass';
  private itemType: ItemType = 'snack';
  private vehicles: Record<RunTheme, { group: THREE.Group; deckY: number }>;
  private opts: RunOpts = {};

  constructor(private hud: Hud, private sfx: Sfx) {
    const s = this.scene;
    s.background = new THREE.Color(0x9fdcff);
    s.fog = new THREE.Fog(0x9fdcff, 40, 140);
    s.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4a, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 20, 10);
    s.add(sun);
    s.add(this.dynamic);

    // Both vehicles live on the cart; start() shows the one for the theme.
    // Act 4: the tour helicopter (nose turned to -z, hovering low over the lane)
    const heli = buildAircraftModel('heli');
    heli.group.scale.setScalar(0.42);
    heli.group.rotation.y = -Math.PI / 2;
    heli.group.position.y = 1.1;
    this.heliSpin = heli.spinners;
    const lavaVehicle = { group: new THREE.Group(), deckY: 1.6 };
    lavaVehicle.group.add(heli.group);
    // Act 5: a brass luggage trolley for the Bellhop Dash
    const trolley = { group: new THREE.Group(), deckY: 0.75 };
    const brass = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.85 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 2.4), new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.8 }));
    base.position.y = 0.6;
    trolley.group.add(base);
    for (const [x, z] of [[-0.9, -1.1], [0.9, -1.1], [-0.9, 1.1], [0.9, 1.1]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), brass);
      pole.position.set(x, 1.7, z);
      trolley.group.add(pole);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.22, z);
      trolley.group.add(wheel);
    }
    for (const z of [-1.1, 1.1]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), brass);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 2.8, z);
      trolley.group.add(bar);
    }
    this.vehicles = { grass: makeVehicle('grass'), gutter: makeVehicle('gutter'), ocean: makeVehicle('ocean'), lava: lavaVehicle, hotel: trolley };
    this.cart.add(this.vehicles.grass.group, this.vehicles.gutter.group, this.vehicles.ocean.group, this.vehicles.lava.group, this.vehicles.hotel.group);
    this.cart.add(this.cargo);
    this.beetle = spawnCreature('aphid', 1.9) ?? makeBeetle(0x2a9d8f);
    this.beetle.root.position.set(0, 0, -1.9);
    this.beetle.root.rotation.y = Math.PI; // faces -z, the way we're racing
    this.cart.add(this.beetle.root);
    this.countLabel.sprite.position.set(0, 3.0, 0);
    this.cart.add(this.countLabel.sprite);
    this.goalLabel.sprite.position.set(0, 2.15, 0); // "📦 14/20" under the count
    this.cart.add(this.goalLabel.sprite);
    s.add(this.cart);
  }

  // --------------------------------------------------------------------------
  /** Build a fresh course and start the run. */
  start(count: number, onDone: (endCount: number) => void, theme: RunTheme = 'grass', itemType: ItemType = 'snack', opts: RunOpts = {}) {
    this.onDone = onDone;
    this.opts = opts;
    this.theme = theme;
    this.itemType = itemType;
    this.vehicles.grass.group.visible = theme === 'grass';
    this.vehicles.gutter.group.visible = theme === 'gutter';
    this.vehicles.ocean.group.visible = theme === 'ocean';
    this.vehicles.lava.group.visible = theme === 'lava';
    this.vehicles.hotel.group.visible = theme === 'hotel';
    this.beetle.root.visible = theme === 'grass' || theme === 'gutter'; // the boat has a motor, the heli has rotors, the trolley has a bellhop
    this.cargo.visible = theme !== 'lava'; // tour passengers ride inside the helicopter
    // A bellhop pushes the luggage trolley
    if (theme === 'hotel' && !this.bellhop) {
      this.bellhop = spawnHuman('h-crew1', 2.6);
      if (this.bellhop) {
        this.bellhop.root.position.set(0, 0, 1.9);
        this.bellhop.root.rotation.y = Math.PI; // facing down the hallway
        this.cart.add(this.bellhop.root);
      }
    }
    if (this.bellhop) this.bellhop.root.visible = theme === 'hotel';
    const sky = theme === 'ocean' ? 0x8fd3ff : theme === 'lava' ? 0x8a6656 : theme === 'hotel' ? 0x4a3628 : 0x9fdcff;
    this.scene.background = new THREE.Color(sky);
    (this.scene.fog as THREE.Fog).color.setHex(sky);
    const deck = this.vehicles[theme].deckY;
    this.cargo.position.y = deck - 0.1;
    // Grass: the aphid pulls the cart. Gutter: it rides at the front of the raft.
    this.beetle.root.position.set(0, theme === 'gutter' ? deck - 0.1 : 0, theme === 'gutter' ? -1.0 : -1.9);
    this.startCount = this.count = count;
    this.shownCargo = -1;
    // 📦 The contract: regular runs only (not the bonus run)
    const plain = !opts.hard && opts.valueEach === undefined && !opts.payout;
    const usual = this.memory?.contracts[theme] ?? count;
    this.target = plain ? Math.max(CONTRACT.min[theme], Math.round(Math.max(usual, 2) * CONTRACT.goalMult)) : 0;
    if (plain && this.memory) this.memory.contracts[theme] = Math.round(usual * 0.7 + count * 0.3); // remember the usual load
    // 🚩 The cart holds ×6 the load at most (and a contract never asks for more than that)
    this.cap = plain ? Math.round(count * CONFIG.run.maxLoad) : Infinity;
    this.hitCap = false;
    if (this.target > this.cap) this.target = this.cap;
    this.goalLabel.sprite.visible = this.target > 0;
    this.x = 0;
    this.z = 0;
    this.speed = 0;
    this.state = 'ready';
    this.stateT = 0;
    this.active = true;
    this.buildCourse(count);
    this.cart.position.set(0, 0, 0);
    // 🔊 Off we go: countdown beeps, plus each ride's own sound
    this.sfx.go();
    if (theme === 'ocean') this.sfx.horn();
    else if (theme === 'lava') this.sfx.heli();
    else if (theme === 'hotel') this.sfx.bell();
    this.updateLabel();
    this.hud.setHint('Drag left / right to steer through the best gates!');
    const names: Partial<Record<ItemType, string>> = { snack: 'snack packs', wrap: 'leaf wraps', candy: 'candies', cash: 'cash bundles', ticket: 'tourists', bag: 'suitcases' };
    const what = names[itemType] ?? 'items';
    const goal = this.target ? ` · 📦 Contract: finish with ${this.target} for +50%!` : '';
    const room = isFinite(this.cap) ? ` (the cart holds ${this.cap})` : '';
    this.hud.banner(opts.title ?? 'Ready…', `${count} ${what} loaded${room}${goal}`, opts.title ? 1800 : this.target ? 2400 : 1500);
  }

  private buildCourse(S: number) {
    this.dynamic.clear();
    this.rows = [];
    this.puddles = [];
    this.breachers = [];
    this.boss = null;
    this.rexBoss = null;
    this.celeb = null;
    this.bossT = -1;
    this.bossDone = false;
    const { rows, rowSpacing, firstRow, laneHalfWidth } = CONFIG.run;
    const lava = this.theme === 'lava';
    const hotel = this.theme === 'hotel';
    this.finishZ = -(firstRow + rows * rowSpacing) + 6;
    const length = -this.finishZ + 60;

    const gutter = this.theme === 'gutter';
    const ocean = this.theme === 'ocean';
    // Ground: a dirt lane (grass), a rain gutter full of water (gutter), or the open sea (ocean)
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(laneHalfWidth * 2 + 0.6, length),
      new THREE.MeshStandardMaterial(gutter ? { color: 0x4aa8ff, roughness: 0.1, metalness: 0.2 } : ocean ? { color: 0x2f9be0, roughness: 0.15, metalness: 0.15 } : lava ? { color: 0x4a3e3a, roughness: 0.95 } : hotel ? { color: 0xb3261e, roughness: 0.9 } : { color: 0xc99561 }),
    );
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.01, -length / 2 + 20);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(ocean ? 600 : 160, length + 80), new THREE.MeshStandardMaterial({ color: ocean ? 0x1f7fc4 : lava ? 0x2b2321 : hotel ? 0x6b4a2f : 0x79c257, roughness: ocean ? 0.2 : 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, 0, -length / 2 + 20);
    this.dynamic.add(grass, lane);
    if (gutter) {
      // Metal gutter walls on both sides
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.35, metalness: 0.5 });
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, length), wallMat);
        wall.position.set(sx * (laneHalfWidth + 0.6), 0.7, -length / 2 + 20);
        this.dynamic.add(wall);
      }
    }

    if (ocean) {
      // Buoy lines mark the safari lane; far-off islands on the horizon
      const buoyMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
      for (let z = 18; z > -length + 20; z -= 4) {
        for (const sx of [-1, 1]) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), buoyMat);
          b.position.set(sx * (laneHalfWidth + 0.5), 0.15, z);
          this.dynamic.add(b);
        }
      }
      for (let i = 0; i < 8; i++) {
        const isle = new THREE.Mesh(new THREE.ConeGeometry(rand(6, 14), rand(4, 9), 10), new THREE.MeshStandardMaterial({ color: 0x5f9e45 }));
        isle.position.set((i % 2 ? 1 : -1) * rand(30, 70), 0, rand(-length + 20, 0));
        this.dynamic.add(isle);
      }
    }

    if (hotel) {
      // A long hotel hallway: gold carpet edges, cream walls lined with room
      // doors, and wall lights between them
      const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.6 });
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.8 });
      const doorMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.6 });
      for (const sx of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.3, length), gold);
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(sx * (laneHalfWidth + 0.15), 0.02, -length / 2 + 20);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.5, length), wallMat);
        wall.position.set(sx * (laneHalfWidth + 3.2), 2.25, -length / 2 + 20);
        this.dynamic.add(edge, wall);
        for (let z = 14; z > -length + 20; z -= 7) {
          const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.8, 1.5), doorMat);
          door.position.set(sx * (laneHalfWidth + 2.95), 1.4, z);
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), gold);
          knob.position.set(sx * (laneHalfWidth + 2.88), 1.3, z + 0.5);
          this.dynamic.add(door, knob);
        }
      }
      // Wall sconces between the doors
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
      for (let z = 10.5; z > -length + 20; z -= 7) {
        for (const sx of [-1, 1]) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
          lamp.position.set(sx * (laneHalfWidth + 2.95), 3.2, z);
          this.dynamic.add(lamp);
        }
      }
    }

    if (lava) {
      // A basalt valley: glowing lava rivers on both sides, black rock spires,
      // and Mount Anthill smoking at the far end
      const river = new THREE.MeshBasicMaterial({ color: 0xff5a12 });
      for (const sx of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.PlaneGeometry(3.2, length + 60), river);
        r.rotation.x = -Math.PI / 2;
        r.position.set(sx * (laneHalfWidth + 3.4), 0.02, -length / 2 + 20);
        this.dynamic.add(r);
      }
      const spireGeo = new THREE.ConeGeometry(1, 1, 6);
      spireGeo.translate(0, 0.5, 0);
      const spires = new THREE.InstancedMesh(spireGeo, new THREE.MeshStandardMaterial({ color: 0x2f2826, roughness: 0.95 }), 160);
      const sm = new THREE.Matrix4();
      for (let i = 0; i < 160; i++) {
        const side = i % 2 ? 1 : -1;
        sm.makeScale(rand(0.8, 2.2), rand(2, 9), rand(0.8, 2.2)).setPosition(side * rand(laneHalfWidth + 6, laneHalfWidth + 40), 0, rand(-length + 20, 20));
        spires.setMatrixAt(i, sm);
      }
      this.dynamic.add(spires);
      const mountain = new THREE.Mesh(new THREE.CylinderGeometry(12, 70, 60, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a2f2b, roughness: 1 }));
      mountain.position.set(0, 30, -length - 40);
      const crater = new THREE.Mesh(new THREE.CircleGeometry(12, 20), new THREE.MeshBasicMaterial({ color: 0xff5a12, fog: false }));
      crater.rotation.x = -Math.PI / 2;
      crater.position.set(0, 59.5, -length - 40);
      this.dynamic.add(mountain, crater);
    }

    // Tall grass walls (instanced for speed)
    const bladeGeo = new THREE.ConeGeometry(0.35, 1, 5);
    bladeGeo.translate(0, 0.5, 0);
    const count = 900;
    const blades = new THREE.InstancedMesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x4f9a35 }), count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * rand(laneHalfWidth + 1.2, laneHalfWidth + 14);
      const z = rand(-length + 20, 20);
      const h = rand(1.5, 4.5);
      m.makeScale(rand(0.8, 1.6), h, rand(0.8, 1.6)).setPosition(x, 0, z);
      blades.setMatrixAt(i, m);
    }
    if (!ocean && !lava && !hotel) this.dynamic.add(blades);

    // Which rows get the special gates
    const xRow = 1 + Math.floor(Math.random() * 3);
    let qRow = 1 + Math.floor(Math.random() * (rows - 1));
    if (qRow === xRow) qRow = rows - 1;

    // ⚠️ Risky rows (from the 3rd run): 1, sometimes 2, of the plain rows
    const riskRows = new Set<number>();
    if (!this.opts.hard && (this.memory?.runs() ?? 0) >= RISK.fromRun) {
      const pool = [];
      for (let r = 1; r < rows - 1; r++) if (r !== xRow && r !== qRow) pool.push(r);
      pool.sort(() => Math.random() - 0.5);
      pool.slice(0, Math.random() < 0.4 ? 2 : 1).forEach((r) => riskRows.add(r));
    }

    for (let r = 0; r < rows; r++) {
      const z = -(firstRow + r * rowSpacing);
      if (riskRows.has(r)) {
        this.riskyRow(r, z, S);
        continue;
      }
      const plus = () => ({ kind: '+' as const, v: Math.max(2, Math.round(S * rand(0.2, 0.45))) });
      const minus = () => ({ kind: '-' as const, v: Math.max(1, Math.round(S * rand(0.25, 0.45))) });
      const hard = !!this.opts.hard;
      let pair: Op[];
      if (r === xRow) pair = [{ kind: 'x', v: 2 }, Math.random() < 0.5 ? minus() : plus()];
      else if (r === qRow) pair = [{ kind: '?', v: 0 }, hard ? minus() : plus()];
      else if (hard) {
        // Bonus run: fewer free wins. Sometimes both gates hurt (pick the lesser evil).
        const roll = Math.random();
        pair =
          roll < 0.3 ? [plus(), minus()]
            : roll < 0.55 ? [plus(), { kind: '/', v: 2 }]
              : roll < 0.75 ? [minus(), { kind: '/', v: 2 }]
                : roll < 0.9 ? [plus(), { kind: '/', v: 3 }]
                  : [{ kind: 'x', v: 2 }, { kind: '/', v: 3 }];
      } else {
        const roll = Math.random();
        pair = roll < 0.45 ? [plus(), minus()] : roll < 0.75 ? [plus(), { kind: '/', v: 2 }] : [plus(), plus()];
      }
      if (Math.random() < 0.5) pair.reverse();
      // Trick (bonus run): about 4 in 10 rows swap their gates at the last second.
      const row: Row = { z, passed: false, gates: [], swap: hard && r > 0 && Math.random() < 0.4 };
      pair.forEach((op, i) => row.gates.push(this.makeGate(op, i === 0 ? -1 : 1, z)));
      this.rows.push(row);

      // A puddle halfway to the next row, now and then (always, on a bonus run;
      // sometimes two of them)
      const hazards = r >= rows - 1 ? 0 : this.opts.hard ? (Math.random() < 0.5 ? 2 : 1) : Math.random() < 0.6 ? 1 : 0;
      for (let h = 0; h < hazards; h++) {
        const p: Puddle = { x: rand(-laneHalfWidth + 1, laneHalfWidth - 1), z: z - rowSpacing * (hazards === 2 ? (h ? 0.68 : 0.36) : 0.5), r: 1.1, hit: false };
        this.puddles.push(p);
        this.hazardVisual(p, (r + h) % 2 === 0);
      }
    }

    if (lava) {
      // 📸 Lava fountains erupt beside the lane: be on their side for the photo
      for (const row of this.rows) {
        if (Math.random() > 0.6 || row.z - rowSpacing * 0.2 < this.finishZ + 8) continue;
        const side = Math.random() < 0.5 ? -1 : 1;
        const f = new THREE.Group();
        const glow = new THREE.MeshBasicMaterial({ color: 0xffa040 });
        for (let k = 0; k < 7; k++) {
          const blob = new THREE.Mesh(new THREE.SphereGeometry(rand(0.25, 0.45), 8, 6), glow);
          blob.userData.k = k;
          f.add(blob);
        }
        f.scale.setScalar(0.001);
        const b: Breacher = { m: f, x: side * (laneHalfWidth + 1.4), z: row.z - rowSpacing * 0.2, t: -1, snapped: false };
        f.position.set(b.x, 0, b.z);
        this.dynamic.add(f);
        this.breachers.push(b);
        const marker = new TextSprite(0.6, '#ffffff');
        marker.setText('📸');
        marker.sprite.position.set(side * (laneHalfWidth - 0.6), 1.2, b.z);
        this.dynamic.add(marker.sprite);
      }
      // The Lava Rex waits beside the finish line
      // (its head looms right over the lane, so it's in the shot as you fly past)
      const rex = makeRex(11);
      rex.root.position.set(-laneHalfWidth - 3.2, 0, this.finishZ - 7);
      rex.root.rotation.y = Math.PI / 2; // facing the lane
      this.rexBoss = rex;
      this.dynamic.add(rex.root);
    }

    if (hotel) {
      // 💵 Tip doors: now and then a guest opens their door to tip the bellhop.
      // Be on their side as you pass.
      for (const row of this.rows) {
        if (Math.random() > 0.6 || row.z - rowSpacing * 0.2 < this.finishZ + 8) continue;
        const side = Math.random() < 0.5 ? -1 : 1;
        const g = new THREE.Group();
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 1.5), new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.6 }));
        door.position.set(0, 1.4, 0.75);
        const hinge = new THREE.Group();
        hinge.position.set(0, 0, -0.75);
        hinge.add(door);
        hinge.name = 'hinge';
        g.add(hinge);
        const guest = spawnHuman(['h-exec', 'h-balance', 'h-ember'][Math.floor(Math.random() * 3)] as 'h-exec', 2.5);
        if (guest) {
          guest.root.position.set(side * 0.6, 0, 0);
          guest.root.rotation.y = -side * Math.PI / 2; // facing the hallway
          guest.root.name = 'guest';
          guest.root.visible = false;
          g.add(guest.root);
        }
        const b: Breacher = { m: g, x: side * (laneHalfWidth + 2.6), z: row.z - rowSpacing * 0.2, t: -1, snapped: false };
        g.position.set(b.x, 0, b.z);
        this.dynamic.add(g);
        this.breachers.push(b);
        const marker = new TextSprite(0.6, '#ffffff');
        marker.setText('💵');
        marker.sprite.position.set(side * (laneHalfWidth - 0.6), 1.2, b.z);
        this.dynamic.add(marker.sprite);
      }
      // A celebrity waits by the penthouse suite at the finish (paparazzi flashing)
      const m = spawnHuman('h-director', 2.8);
      if (m) {
        m.root.position.set(-laneHalfWidth - 1.6, 0, this.finishZ - 2);
        m.root.rotation.y = Math.PI / 2;
        this.dynamic.add(m.root);
        const flashes: THREE.Mesh[] = [];
        for (let k = 0; k < 6; k++) {
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
          f.position.set(-laneHalfWidth - rand(0.5, 2.6), rand(1.6, 2.8), this.finishZ - rand(-1, 5));
          f.visible = false;
          this.dynamic.add(f);
          flashes.push(f);
        }
        this.celeb = { m, flashes };
      }
    }

    if (ocean) {
      // 📸 Photo spots: now and then a sea creature leaps out beside the lane.
      // Be on its side as you pass to get the shot (= more happy tourists).
      for (const row of this.rows) {
        if (Math.random() > 0.6 || row.z - rowSpacing * 0.2 < this.finishZ + 8) continue;
        const side = Math.random() < 0.5 ? -1 : 1;
        const kinds: SeaKind[] = ['s-ichthyo', 's-mosasaurus', 's-ichthyo'];
        const m = spawnSea(kinds[Math.floor(Math.random() * kinds.length)], 6)?.root;
        if (!m) continue;
        const b: Breacher = { m, x: side * (laneHalfWidth - 0.6), z: row.z - rowSpacing * 0.2, t: -1, snapped: false };
        m.position.set(b.x, -3, b.z);
        m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // leaps across toward the middle
        this.dynamic.add(m);
        this.breachers.push(b);
        const marker = new TextSprite(0.6, '#ffffff');
        marker.setText('📸');
        marker.sprite.position.set(b.x, 1.2, b.z);
        this.dynamic.add(marker.sprite);
      }
      // The big one: a Megalodon waiting just past the finish
      const boss = spawnSea('s-megalodon', 16)?.root;
      if (boss) {
        boss.position.set(-14, -6, this.finishZ - 2);
        boss.rotation.y = Math.PI / 2;
        this.boss = boss;
        this.dynamic.add(boss);
      }
    }

    // Checkered finish line
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      g.fillRect(i * 16, j * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const finish = new THREE.Mesh(new THREE.PlaneGeometry(laneHalfWidth * 2 + 0.6, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
    finish.rotation.x = -Math.PI / 2;
    finish.position.set(0, 0.04, this.finishZ);
    this.dynamic.add(finish);
    const finishSign = new TextSprite(1.6, '#ffd166');
    finishSign.setText('FINISH');
    finishSign.sprite.position.set(0, 4.2, this.finishZ);
    this.dynamic.add(finishSign.sprite);
  }

  /**
   * The thing you see at a hazard spot (per theme): a puddle, a floating twig,
   * a lurking shark, an ash cloud / lava bomb, a wet-floor sign / room-service
   * cart. `alt` picks between each theme's two kinds.
   */
  private hazardVisual(p: Puddle, alt: boolean) {
    const lava = this.theme === 'lava';
    const hotel = this.theme === 'hotel';
    const ocean = this.theme === 'ocean';
    const gutter = this.theme === 'gutter';
    if (hotel) {
      // A yellow WET FLOOR sign, or a room-service cart parked in the way
      const g = new THREE.Group();
      if (alt) {
        const yellow = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.6 });
        for (const sz of [-1, 1]) {
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.05), yellow);
          leaf.position.set(0, 0.68, sz * 0.25);
          leaf.rotation.x = sz * 0.35;
          g.add(leaf);
        }
        const puddle = new THREE.Mesh(new THREE.CircleGeometry(p.r, 20), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.6 }));
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.y = 0.03;
        g.add(puddle);
        g.userData.kind = 'wet';
      } else {
        const silver = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.25, metalness: 0.8 });
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.9), silver);
        top.position.y = 1.0;
        const lower = top.clone();
        lower.position.y = 0.35;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), silver);
        dome.position.y = 1.05;
        g.add(top, lower, dome);
        g.userData.kind = 'service';
      }
      g.position.set(p.x, 0, p.z);
      p.monster = g;
      this.dynamic.add(g);
    } else if (lava) {
      // Every other hazard: an ash cloud hanging in the air, or a lava bomb
      // that drops out of the sky as you get close (watch the red ring!)
      if (alt) {
        const cloud = new THREE.Group();
        const ash = new THREE.MeshStandardMaterial({ color: 0x4a4442, roughness: 1, transparent: true, opacity: 0.85 });
        for (let k = 0; k < 5; k++) {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(rand(0.6, 1.0), 10, 8), ash);
          puff.position.set(rand(-0.8, 0.8), rand(1.2, 2.4), rand(-0.6, 0.6));
          cloud.add(puff);
        }
        cloud.position.set(p.x, 0, p.z);
        cloud.userData.kind = 'ash';
        p.monster = cloud;
        this.dynamic.add(cloud);
      } else {
        const bomb = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.RingGeometry(p.r - 0.2, p.r + 0.1, 24), new THREE.MeshBasicMaterial({ color: 0xff2a12, transparent: true, opacity: 0.8 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), new THREE.MeshStandardMaterial({ color: 0x5a1606, emissive: 0xff4a12, emissiveIntensity: 1.6 }));
        rock.position.y = 30;
        rock.name = 'rock';
        bomb.add(ring, rock);
        bomb.position.set(p.x, 0, p.z);
        bomb.userData.kind = 'bomb';
        p.monster = bomb;
        this.dynamic.add(bomb);
      }
    } else if (ocean) {
      // A sea creature lurking: its fin cuts the water, then it lunges
      // out as you pass. Steer around it!
      const kinds: SeaKind[] = ['s-megalodon', 's-mosasaurus'];
      const beast = spawnSea(kinds[Math.floor(Math.random() * 2)], 7)?.root;
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x3a4a5a }));
      const m = beast ?? fin;
      m.position.set(p.x, beast ? -1.6 : 0.3, p.z);
      m.rotation.y = rand(0, Math.PI * 2);
      p.monster = m;
      this.dynamic.add(m);
    } else if (gutter) {
      // A floating twig to steer around
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, p.r * 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2f }));
      twig.rotation.z = Math.PI / 2;
      twig.rotation.y = rand(-0.4, 0.4);
      twig.position.set(p.x, 0.15, p.z);
      this.dynamic.add(twig);
    } else {
      const puddle = new THREE.Mesh(
        new THREE.CircleGeometry(p.r, 24),
        new THREE.MeshStandardMaterial({ color: 0x4aa8ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 }),
      );
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(p.x, 0.03, p.z);
      this.dynamic.add(puddle);
    }
  }

  /**
   * ⚠️ A risky row: a small safe +N on one side, a gold ×2 on the other with a
   * hazard right behind it (visible from far off). ×2 then the hazard (-35%)
   * still beats +N on a big load, but on a light one... it's your call. Or
   * swerve around the hazard right after the gate!
   */
  private riskyRow(r: number, z: number, S: number) {
    const riskSide = (Math.random() < 0.5 ? -1 : 1) as -1 | 1;
    const safe: Op = { kind: '+', v: Math.max(3, Math.round(S * rand(0.12, 0.22))) };
    const row: Row = { z, passed: false, risky: true, gates: [this.makeGate(safe, (-riskSide) as -1 | 1, z), this.makeGate({ kind: 'x', v: 2 }, riskSide, z, true)] };
    this.rows.push(row);
    const p: Puddle = { x: riskSide * 1.75, z: z - 6.5, r: 1.5, hit: false, risky: true };
    this.puddles.push(p);
    this.hazardVisual(p, r % 2 === 0);
    // A warning over the gold gate
    const warn = new TextSprite(1.3, '#ffd166');
    warn.setText('⚠️ RISKY');
    warn.sprite.position.set(riskSide * 1.75, 3.7, z);
    this.dynamic.add(warn.sprite);
  }

  private makeGate(op: Op, side: -1 | 1, z: number, risky = false): Gate {
    const group = new THREE.Group();
    group.position.set(side * 1.75, 0, z);
    const good = isGood(op.kind);
    const color = risky ? 0xffb000 : op.kind === '?' ? 0x9b5de5 : good ? 0x2f9bff : 0xff4d4d; // (risky = gold)
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    for (const px of [-1.6, 1.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 8), postMat);
      post.position.set(px, 1.3, 0);
      group.add(post);
    }
    const panel = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.3), panel);
    glass.position.y = 1.35;
    group.add(glass);

    // Big label on the gate
    const canvas = document.createElement('canvas');
    canvas.width = 256 * TEXT_RES;
    canvas.height = 160 * TEXT_RES;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(TEXT_RES, TEXT_RES);
    roundRect(ctx, 8, 8, 240, 144, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.0)';
    ctx.fill();
    gameText(ctx, opLabel(op), 128, 84, 104);
    const tex = sharpTexture(canvas);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.625), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.position.set(0, 1.4, 0.02);
    group.add(label);
    this.dynamic.add(group);
    return { group, op, side, panel };
  }

  // --------------------------------------------------------------------------
  private updateLabel() {
    const full = this.state !== 'done' && this.count >= this.cap; // (🚩 at the cart's limit)
    this.countLabel.setText(full ? `${this.count} FULL` : String(this.count), full ? '#ffd166' : this.count >= this.startCount ? '#ffffff' : '#ffb3b3');
    if (this.target) {
      const done = this.count >= this.target;
      this.goalLabel.setText(done ? `✅ ${this.count}/${this.target}` : `📦 ${this.count}/${this.target}`, done ? '#7df9a0' : '#ffd166');
    }
    // Rebuild the visible cargo pile (capped so it doesn't get silly).
    const show = Math.min(this.count, 36);
    if (show === this.shownCargo) return;
    this.shownCargo = show;
    this.cargo.clear();
    for (let i = 0; i < show; i++) {
      const it = makeItem(this.itemType);
      const layer = Math.floor(i / 9);
      const k = i % 9;
      it.position.set(((k % 3) - 1) * 0.56, layer * 0.32, (Math.floor(k / 3) - 1) * 0.5);
      this.cargo.add(it);
    }
  }

  /** Set the cargo count (and float the gate's text). `overCap` = a finish-line
   *  bonus, which still counts once the cart is full. */
  private changeCount(next: number, at: THREE.Vector3, text: string, good: boolean, overCap = false) {
    let cls = good ? 'big good' : 'big bad';
    if (!overCap && next > this.cap) {
      // 🚩 The cart is full: the rest doesn't fit
      text = this.count >= this.cap ? '🚩 FULL' : `${text} · 🚩 FULL!`;
      cls = 'big gold';
      next = this.cap;
      this.hitCap = true;
    }
    this.count = Math.min(9999, next);
    this.updateLabel();
    this.labelPop = 1;
    this.hud.floatAt(at, this.camera, text, cls);
  }

  update(dt: number, move: THREE.Vector2) {
    if (!this.active) return;
    const { speed, steerSpeed, laneHalfWidth } = CONFIG.run;
    this.stateT += dt;

    if (this.state === 'ready') {
      if (this.stateT > 1.1) {
        this.state = 'run';
        this.hud.banner('GO!', '', 700);
      }
    } else if (this.state === 'run') {
      this.speed = Math.min(speed, this.speed + speed * dt * 1.5);
    } else {
      this.speed = Math.max(0, this.speed - speed * dt * 1.2);
    }

    // Steering (only while racing)
    if (this.state === 'run') {
      this.x = THREE.MathUtils.clamp(this.x + move.x * steerSpeed * dt, -laneHalfWidth + 1, laneHalfWidth - 1);
    }
    this.z -= this.speed * dt;
    this.cart.position.set(this.x, 0, this.z);
    this.cart.rotation.z = -move.x * 0.08 * (this.state === 'run' ? 1 : 0); // lean into turns
    animateCreature(this.beetle, dt, this.speed, false); // (runs ignore the Movement speed slider)

    // Trick gates: swap sides when you get close (bonus run)
    for (const row of this.rows) {
      if (!row.swap || row.passed) continue;
      if (!row.swapped && this.z - row.z < 11) {
        row.swapped = true;
        for (const g of row.gates) g.side = (g.side === 1 ? -1 : 1) as -1 | 1;
        this.hud.floatAt(new THREE.Vector3(0, 3, row.z), this.camera, '🔀 SWAP!', 'big bad');
      }
      // Slide them across
      for (const g of row.gates) g.group.position.x += (g.side * 1.75 - g.group.position.x) * Math.min(1, dt * 7);
    }

    // ⚠️ A ping as a risky row comes up (time to decide!)
    for (const row of this.rows) {
      if (row.risky && !row.warned && this.z - row.z < 26) {
        row.warned = true;
        this.sfx.risky();
      }
    }

    // Gates
    for (const row of this.rows) {
      if (row.passed || this.z > row.z) continue;
      row.passed = true;
      const side = this.x < 0 ? -1 : 1;
      const gate = row.gates.find((g) => g.side === side)!;
      const before = this.count;
      const after = applyOp(before, gate.op, this.luckWin);
      const good = after >= before;
      let text = opLabel(gate.op);
      if (gate.op.kind === '?') text = after >= before ? '? = x3!' : '? = ÷2';
      this.changeCount(after, new THREE.Vector3(this.x, 2.5, this.z), text, good);
      good ? this.sfx.gateGood() : this.sfx.gateBad();
      // Chosen gate flashes, the other fades
      for (const g of row.gates) {
        g.panel.opacity = g === gate ? 0.9 : 0.12;
        g.group.scale.setScalar(g === gate ? 1.12 : 0.9);
      }
    }

    // Lava: bombs fall out of the sky as you get close; ash clouds churn
    for (const p of this.puddles) {
      const m = p.monster;
      if (!m || !m.userData.kind) continue;
      const near = this.z - p.z;
      if (m.userData.kind === 'bomb') {
        const rock = m.getObjectByName('rock')!;
        const u = THREE.MathUtils.clamp((14 - near) / 12, 0, 1); // lands just before you reach it
        rock.position.y = 30 * (1 - u * u) + 0.6;
        if (u >= 1 && !m.userData.landed) {
          m.userData.landed = true;
          this.sfx.lavaBomb();
        }
        rock.rotation.x += dt * 4;
      } else if (m.userData.kind === 'ash') {
        m.rotation.y += dt * 0.6;
      }
    }

    // Ocean: lurking sea creatures surge up as you get close, then sink back
    for (const p of this.puddles) {
      if (!p.monster || p.monster.userData.kind) continue;
      const near = this.z - p.z; // > 0 = still ahead of us
      const surge = near < 9 && near > -6 ? Math.sin(((9 - near) / 15) * Math.PI) : 0;
      p.monster.position.y = -1.6 + surge * 1.9;
      p.monster.rotation.x = -surge * 0.35;
    }

    // Puddles
    for (const p of this.puddles) {
      if (p.hit || Math.abs(this.z - p.z) > p.r || Math.abs(this.x - p.x) > p.r + 0.7) continue;
      p.hit = true;
      const loss = (p.risky ? RISK.hazardLoss : CONFIG.run.puddleLoss) * (1 - this.luckSave);
      const lost = Math.max(1, Math.ceil(this.count * loss));
      this.changeCount(Math.max(0, this.count - lost), new THREE.Vector3(this.x, 2.5, this.z), `${this.theme === 'gutter' ? '🪵' : this.theme === 'ocean' ? '🦈' : this.theme === 'lava' ? (p.monster?.userData.kind === 'ash' ? '💨' : '🌋') : this.theme === 'hotel' ? (p.monster?.userData.kind === 'wet' ? '🧽' : '🛎️') : '💦'} -${lost}`, false);
      this.sfx.splash();
    }

    // 📸 Breaching sea creatures (Sea Safari) / lava fountains (heli tour)
    for (const b of this.breachers) {
      if (b.t < 0 && this.z - b.z < 9) b.t = 0;
      if (b.t < 0 || b.t > 1) continue;
      b.t = Math.min(1.01, b.t + dt / 1.7);
      if (this.theme === 'hotel') {
        // The door swings open and the guest leans out with a tip
        const open = Math.sin(Math.min(1, b.t) * Math.PI);
        const hinge = b.m.getObjectByName('hinge');
        if (hinge) hinge.rotation.y = -Math.sign(b.x) * open * 1.4;
        const guest = b.m.getObjectByName('guest');
        if (guest) guest.visible = open > 0.3;
        if (!b.snapped && Math.abs(this.z - b.z) < 1.6 && Math.abs(this.x - Math.sign(b.x) * (CONFIG.run.laneHalfWidth - 0.6)) < 3.0) {
          b.snapped = true;
          const bonus = Math.max(3, Math.round(this.count * 0.12));
          this.changeCount(this.count + bonus, new THREE.Vector3(this.x, 2.6, this.z), `💵 TIP +${bonus}`, true);
        }
        continue;
      }
      if (this.theme === 'lava') {
        // The fountain shoots up, blobs arcing out, then dies down
        const arc = Math.sin(Math.min(1, b.t) * Math.PI);
        b.m.scale.setScalar(Math.max(0.001, arc));
        b.m.children.forEach((c) => {
          const k = c.userData.k as number;
          const u = (b.t * 2 + k / 7) % 1;
          c.position.set(Math.cos(k * 2.3) * u * 1.6, Math.sin(u * Math.PI) * 6 + 0.3, Math.sin(k * 2.3) * u * 1.2);
        });
        if (!b.snapped && Math.abs(this.z - b.z) < 1.6 && Math.abs(this.x - Math.sign(b.x) * (CONFIG.run.laneHalfWidth - 0.6)) < 3.0) {
          b.snapped = true;
          const bonus = Math.max(3, Math.round(this.count * 0.12));
          this.changeCount(this.count + bonus, new THREE.Vector3(this.x, 2.6, this.z), `📸 +${bonus}`, true);
        }
        continue;
      }
      const arc = Math.sin(Math.min(1, b.t) * Math.PI);
      b.m.position.set(b.x - Math.sign(b.x) * b.t * 2.5, -3 + arc * 4.2, b.z);
      b.m.rotation.x = (0.5 - b.t) * 1.4; // nose up, then nose down
      // Snap! (when the boat passes on its side of the lane)
      if (!b.snapped && Math.abs(this.z - b.z) < 1.6 && Math.abs(this.x - b.x) < 3.0) {
        b.snapped = true;
        const bonus = Math.max(3, Math.round(this.count * 0.12));
        this.changeCount(this.count + bonus, new THREE.Vector3(this.x, 2.6, this.z), `📸 +${bonus}`, true);
      }
    }
    // The Lava Rex roars at the passing helicopter
    // The bellhop jogs behind the trolley; the paparazzi flash at the celebrity
    if (this.bellhop?.root.visible) animateCreature(this.bellhop, dt, this.speed, false);
    if (this.celeb) {
      animateCreature(this.celeb.m, dt, 0);
      const near = this.z - this.finishZ < 22;
      for (const f of this.celeb.flashes) f.visible = near && Math.random() < 0.18;
    }
    if (this.rexBoss) {
      if (this.bossT < 0 && this.z - this.finishZ < 18) {
        this.bossT = 0;
        roar(this.rexBoss);
        this.sfx.roar();
      }
      animateCreature(this.rexBoss, dt, 0);
    }
    for (const s of this.heliSpin) {
      if (s.userData.tailRotor) s.rotation.z += dt * 30;
      else s.rotation.y += dt * 30;
    }
    // The Megalodon leaps right over the finish line as you cross it
    if (this.boss && this.bossT < 0 && this.z - this.finishZ < 16) this.bossT = 0;
    if (this.boss && this.bossT >= 0 && this.bossT <= 1) {
      this.bossT = Math.min(1.01, this.bossT + dt / 2.2);
      const u = Math.min(1, this.bossT);
      this.boss.position.set(-14 + u * 28, -6 + Math.sin(u * Math.PI) * 13, this.finishZ - 2);
      this.boss.rotation.z = (0.5 - u) * 1.2;
    }

    // Finish
    if (this.state === 'run' && this.z <= this.finishZ) {
      this.state = 'done';
      this.stateT = 0;
      if (this.boss && !this.bossDone) {
        // The money shot: everyone got the Megalodon on camera
        this.bossDone = true;
        this.changeCount(Math.round(this.count * 1.25), new THREE.Vector3(this.x, 3, this.z), '📸 MEGALODON! ×1.25', true, true);
      }
      if (this.celeb && !this.bossDone) {
        this.bossDone = true;
        this.changeCount(Math.round(this.count * 1.25), new THREE.Vector3(this.x, 3, this.z), '🌟 CELEBRITY TIP ×1.25', true, true);
      }
      if (this.rexBoss && !this.bossDone) {
        this.bossDone = true;
        this.changeCount(Math.round(this.count * 1.25), new THREE.Vector3(this.x, 3, this.z), '📸 LAVA REX! ×1.25', true, true);
      }
      // 📦 The contract: +50% if filled; the regular haul either way
      let contract: { target: number; reached: number; filled: boolean } | undefined;
      if (this.target) {
        contract = { target: this.target, reached: this.count, filled: this.count >= this.target };
        if (this.count >= this.target) {
          this.changeCount(Math.round(this.count * CONTRACT.bonus), new THREE.Vector3(this.x, 3.6, this.z), '📦 CONTRACT FILLED! +50%', true, true);
          this.sfx.contract();
        } else {
          this.hud.floatAt(new THREE.Vector3(this.x, 3.6, this.z), this.camera, `📦 Contract missed (${this.count}/${this.target})`, 'big bad');
        }
      }
      this.updateLabel(); // (over the line: the label drops its "FULL")
      this.hud.setHint(null);
      const o = this.opts;
      const earned = o.payout
        ? Math.round(o.payout(this.count, this.startCount))
        : o.valueEach !== undefined
          ? Math.round(Math.max(o.keepMin ?? 0, this.count * o.valueEach))
          : Math.round(this.count * ITEM_VALUE[this.itemType] * this.cashMult);
      window.setTimeout(() => {
        this.hud.showResults(this.startCount, this.count, earned, contract, this.hitCap).then(() => {
          this.active = false;
          this.onDone(this.count);
        });
      }, 700);
    }

    // Label pop animation
    this.labelPop = Math.max(0, this.labelPop - dt * 3);
    const s = 1 + this.labelPop * 0.5;
    this.countLabel.sprite.scale.set(this.countLabel.width * s, 1.1 * s, 1);

    // Camera: behind and above the cart, looking down the lane
    const want = new THREE.Vector3(this.x * 0.5, this.theme === 'lava' ? 8.5 : 7.5, this.z + 10);
    this.camera.position.lerp(want, Math.min(1, dt * 6));
    this.camera.lookAt(this.x * 0.4, 0.5, this.z - 8);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 70 : 55;
    this.camera.updateProjectionMatrix();
  }
}
