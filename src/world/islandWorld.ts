// ============================================================================
// islandWorld.ts — ACT 3: DINO ISLAND (human scale, like the airport).
//
// Anthill Airways now flies tourists to an island where dinosaurs still live.
// Jack runs the attractions:
//
//   🥤 JUICE BAR    fruit trees -> BLENDER -> smoothies -> tourists buy
//   🦖 DILO SHOW    carry 🍖 dino food from the supply drop to the FEED
//                   platform. While the Dilophosaurus has a full belly, the
//                   crowd in the stands pays. Hungry dino = no show.
//   🥚 DODO RANCH   the Dodos lay eggs in the nests -> sell them at the shop
//   🚤 SEA SAFARI   arriving tourists wait on the dock -> a gate run on the
//                   open sea (Mosasaurus + Megalodon surface as hazards)
//
// Crew unlocks automate each job, and Sarah (your assistant) collects the money. Like the airport, the island keeps working while you're away.
// ============================================================================
import { autoCash } from '../core/income';
import { Upgrades } from './upgradePad';
import { pace } from '../core/pace';
import * as THREE from 'three';
import { CONFIG, ISLAND_CFG as C, ISLAND_UNLOCKS } from '../data/config';
import { Sfx } from '../core/audio';
import { SaveData } from '../core/save';
import { Progress } from '../core/progress';
import { Hud } from '../ui/hud';
import { HumanKind, SeaKind, TreeKind, spawnDino, spawnSea, spawnTree } from '../actors/creatures';
import { CreatureModel, animateCreature, faceToward } from '../actors/models';
import { Player, fpFov, handsSpot } from '../actors/player';
import { Route, Worker } from '../actors/worker';
import { Flyers, ITEM_VALUE, ItemType, Stack } from './items';
import { TextSprite, makePad, TITLE, titleTag } from './labels';
import { Bakery, Blocker, CashPad, ProcessorOpts, ResourcePile, TrashBin, UnlockTile, Zone, gridLayout } from './stations';
import { Assistant, Desk, payBill, person, stepTo } from './airportWorld';
import { weather } from '../core/weather';
import { buildAircraftModel } from './aircraft';

const H = 2.8; // people are this tall (same as the airport)
const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  b.receiveShadow = true;
  return b;
}
/** A flat ellipse lying on the ground. */
function ellipse(rx: number, rz: number, material: THREE.Material, y: number) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 64), material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Background extras don't cast shadows (each shadow = drawing the model twice). */
function noShadow(o: THREE.Object3D) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = false;
  });
  return o;
}

// Island shape: land is an ellipse; you can walk a little inside the beach.
const LAND = { rx: 46, rz: 42 };
const WALK = { rx: 41, rz: 37 };
const AIRSTRIP_Z = 31;
const TOURIST_KINDS: HumanKind[] = ['h-exec', 'h-balance', 'h-ember', 'h-director'];

/** The blender at the Juice Bar (uses the oven/press machine from Act 1). */
const BLENDER: ProcessorOpts = { inType: 'fruit', outType: 'smoothie', label: 'BLENDER', cookTime: C.blendTime, body: 0xf4d35e, trim: 0x2a9d8f, glow: 0xff6fa8 };

// ----------------------------------------------------------------------------
// A fenced paddock (Dilo Show) or pen (Dodo Ranch).
// ----------------------------------------------------------------------------
function fence(scene: THREE.Scene, r: { minX: number; maxX: number; minZ: number; maxZ: number }, h: number, color: number, gap?: { side: 'S'; from: number; to: number }) {
  const post = mat(color, 0.9);
  const rail = mat(new THREE.Color(color).offsetHSL(0, 0, 0.08).getHex(), 0.9);
  const g = new THREE.Group();
  const edge = (x1: number, z1: number, x2: number, z2: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= n; i++) g.add(box(0.28, h, 0.28, post, x1 + ((x2 - x1) * i) / n, h / 2, z1 + ((z2 - z1) * i) / n));
    for (const y of [h * 0.4, h * 0.85]) {
      const b = box(x1 === x2 ? 0.14 : len, 0.16, x1 === x2 ? len : 0.14, rail, (x1 + x2) / 2, y, (z1 + z2) / 2);
      g.add(b);
    }
  };
  edge(r.minX, r.minZ, r.maxX, r.minZ);
  edge(r.minX, r.minZ, r.minX, r.maxZ);
  edge(r.maxX, r.minZ, r.maxX, r.maxZ);
  if (gap) {
    edge(r.minX, r.maxZ, gap.from, r.maxZ);
    edge(gap.to, r.maxZ, r.maxX, r.maxZ);
  } else edge(r.minX, r.maxZ, r.maxX, r.maxZ);
  scene.add(g);
  return g;
}

// ----------------------------------------------------------------------------
// 🦖 THE DILO SHOW
// ----------------------------------------------------------------------------
class DiloShow {
  feed: Stack;               // dino food on the FEED platform
  feedZone: Zone;
  pad: CashPad;
  blockers: Blocker[] = [];
  belly = 0.6;               // 0 = starving .. 1 = stuffed
  private dino: CreatureModel | null;
  private target = new THREE.Vector3();
  private state: 'wander' | 'toTrough' | 'eat' | 'rest' = 'wander';
  private t = 0;
  private payT = 0;
  private sign = new TextSprite(0.9, '#ffd166');
  private shownMood = '';
  private trough = new THREE.Vector3();
  private crowd: CreatureModel[] = [];
  private cheerT = 0;
  readonly pen = { minX: -32, maxX: -13, minZ: -24, maxZ: -9 };
  // Escape: starve him too long and he jumps the fence.
  free = false;
  private starveT = 0;
  private hop: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private chompCd = 0;
  private roam = new THREE.Vector3();
  /** 'escaped' / 'chomp' / 'back' (for banners). */
  onEvent: (what: 'escaped' | 'chomp' | 'back') => void = () => {};
  private feedSpot = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private flyers: Flyers, private payMult: () => number, private sfx: Sfx) {
    const p = this.pen;
    fence(scene, p, 3.2, 0x6b4a2f);
    this.blockers.push({ minX: p.minX - 0.4, maxX: p.maxX + 0.4, minZ: p.minZ - 0.4, maxZ: p.maxZ + 0.4 });
    // Jungle floor inside
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(p.maxX - p.minX, p.maxZ - p.minZ), mat(0x5e8f3a, 1));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((p.minX + p.maxX) / 2, 0.02, (p.minZ + p.maxZ) / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    for (const [x, z] of [[-28, -21], [-18, -21], [-29, -12]]) {
      const t = spawnTree((['t-fern', 't-monkeypuzzle', 't-conifer'] as TreeKind[])[Math.floor(Math.random() * 3)], rand(5, 7));
      if (t) {
        t.position.set(x, 0, z);
        scene.add(t);
      }
    }

    // FEED platform outside the east fence; the trough is just inside.
    const fx = p.maxX + 2.2;
    const fz = -16;
    const plat = box(2.6, 0.3, 2.6, mat(0x8a5a33, 0.9), fx, 0.15, fz);
    scene.add(plat);
    const feedPad = makePad(2.4, 2.4, 'FEED', '#ff9f43');
    feedPad.position.set(fx, 0.32, fz);
    scene.add(feedPad);
    const holder = new THREE.Group();
    holder.position.set(fx, 0.3, fz);
    scene.add(holder);
    this.feed = new Stack(holder, gridLayout(3, 3, 0.5, 0.5, 0.05), 24);
    this.feedZone = new Zone(fx, fz, 1.3, 1.3);
    this.feedSpot.set(fx, 0, fz);
    this.trough.set(p.maxX - 2.4, 0, fz);
    scene.add(box(1.2, 0.5, 2.6, mat(0x5a3a22, 0.9), p.maxX - 0.9, 0.25, fz));

    // Bleachers along the south fence, with a crowd watching
    const seat = mat(0x2a9d8f, 0.6);
    for (let row = 0; row < 2; row++) {
      scene.add(box(14, 0.5 + row * 0.6, 1.2, seat, -23, 0.25 + row * 0.3, -6.6 + row * 1.2));
    }
    this.blockers.push({ minX: -30.2, maxX: -15.8, minZ: -7.4, maxZ: -4.4 });
    for (let i = 0; i < 4; i++) {
      const m = person(TOURIST_KINDS[i % TOURIST_KINDS.length]);
      noShadow(m.root);
      m.root.position.set(-27 + i * 3.2, 0.55 + (i % 2) * 0.6, -6.6 + (i % 2) * 1.2);
      m.root.rotation.y = Math.PI; // facing the paddock
      scene.add(m.root);
      this.crowd.push(m);
    }
    this.pad = new CashPad(scene, -12.5, -4.6);
    this.sign.sprite.position.set(-22, 7.5, -16.5);
    scene.add(this.sign.sprite);

    this.dino = spawnDino('d-dilo', 8.5);
    if (this.dino) {
      this.dino.root.position.set(-22, 0, -16);
      scene.add(this.dino.root);
    }
    this.pickSpot();
  }

  private pickSpot() {
    const p = this.pen;
    this.target.set(rand(p.minX + 4, p.maxX - 4), 0, rand(p.minZ + 4, p.maxZ - 4));
  }

  /** `player` = you, when you're on the island (null while you're away). */
  update(dt: number, player: Player | null) {
    // Belly empties over time; a fed dino puts on a show (the crowd pays).
    this.belly = Math.max(0, this.belly - dt / C.dinoHunger);
    const fed = this.belly > 0.05 && !this.free;
    if (fed) {
      this.payT += dt;
      if (this.payT >= C.showPayEvery) {
        this.payT = 0;
        payBill(this.scene, this.flyers, this.pad, this.crowd[2]?.root ?? this.pad.group, Math.round(C.showPay * this.payMult()));
      }
    }
    const mood = this.free ? '🚨 DILO ESCAPED! Lure him back with 🍖'
      : this.belly > 0.5 ? '🦖 DILO SHOW · 😋 Fed!' : fed ? '🦖 DILO SHOW · 🙂 Peckish' : '🦖 DILO SHOW · 😠 HUNGRY!';
    if (mood !== this.shownMood) {
      this.shownMood = mood;
      this.sign.setText(mood, fed ? '#ffd166' : '#ff6b6b');
    }
    // The crowd bounces when the show is on
    this.cheerT += dt;
    this.crowd.forEach((m, i) => {
      animateCreature(m, dt, 0);
      m.bob.position.y = fed ? Math.max(0, Math.sin(this.cheerT * 6 + i)) * 0.12 : 0;
    });

    const d = this.dino;
    if (!d) return;
    const pos = d.root.position;
    if (this.hop) {
      // Leaping over the fence (out, or back in)
      this.hop.t = Math.min(1, this.hop.t + dt / 1.3);
      pos.lerpVectors(this.hop.from, this.hop.to, this.hop.t);
      pos.y = Math.sin(this.hop.t * Math.PI) * 4.2;
      faceToward(d, this.hop.to.x - this.hop.from.x, this.hop.to.z - this.hop.from.z, dt, 8);
      animateCreature(d, dt, 0);
      if (this.hop.t >= 1) {
        pos.y = 0;
        this.hop = null;
      }
      return;
    }
    if (this.free) {
      this.updateFree(dt, d, player);
      return;
    }
    // Starving too long -> he jumps the fence!
    if (this.belly <= 0) {
      this.starveT += dt;
      if (this.starveT > C.escapeAfter) {
        this.starveT = 0;
        this.free = true;
        this.state = 'wander';
        this.hop = { from: pos.clone(), to: new THREE.Vector3(this.pen.maxX + 6, 0, rand(-20, -12)), t: 0 };
        this.roam.copy(this.hop.to);
        this.onEvent('escaped');
        return;
      }
    } else this.starveT = 0;
    switch (this.state) {
      case 'wander':
        if (this.belly < 0.7 && this.feed.canPop()) {
          this.state = 'toTrough';
          break;
        }
        if (this.walk(d, this.target, fed ? 2.6 : 1.6, dt)) {
          this.state = 'rest';
          this.t = rand(1.5, 4);
        }
        break;
      case 'rest':
        animateCreature(d, dt, 0);
        this.t -= dt;
        if (this.t <= 0 || (this.belly < 0.7 && this.feed.canPop())) {
          this.pickSpot();
          this.state = 'wander';
        }
        break;
      case 'toTrough':
        if (this.walk(d, this.trough, 3.4, dt)) {
          this.state = 'eat';
          this.t = 0;
        }
        break;
      case 'eat': {
        animateCreature(d, dt, 0);
        faceToward(d, 1, 0, dt, 6);
        this.t += dt;
        if (this.t < 0.7) break;
        this.t = 0;
        const it = this.feed.pop();
        if (!it || this.belly >= 0.98) {
          this.pickSpot();
          this.state = 'wander';
          break;
        }
        // Toss it over the fence, chomp!
        const mouth = new THREE.Vector3(pos.x + 2.5, d.height * 0.8, pos.z);
        this.flyers.fly(it.mesh, () => mouth, () => {
          it.mesh.removeFromParent();
          this.belly = Math.min(1, this.belly + C.biteFill);
          d.bob.scale.setScalar(1.06);
          setTimeout(() => d.bob.scale.setScalar(1), 160);
          this.sfx.drop();
        }, 0.35, 1.6);
        break;
      }
    }
  }

  private walk(d: CreatureModel, to: THREE.Vector3, speed: number, dt: number) {
    return stepTo(d, to, speed, dt);
  }

  /**
   * On the loose: he chases you (a chomp makes you drop everything you carry),
   * unless you're carrying 🍖, then he follows you like a puppy. Lead him to
   * the FEED platform and he jumps back into the paddock to eat it.
   */
  private updateFree(dt: number, d: CreatureModel, player: Player | null) {
    const pos = d.root.position;
    this.chompCd -= dt;
    if (player) {
      const pp = player.pos;
      const gap = Math.hypot(pp.x - pos.x, pp.z - pos.z);
      const lured = player.stack.has('meat') && gap < 10;
      if (lured && pos.distanceTo(this.feedSpot) < 5.5) {
        // Back home! He takes the food you carried and hops in.
        while (player.stack.has('meat') && !this.feed.full) this.flyers.transferType(player.stack, this.feed, 'meat');
        this.free = false;
        this.belly = Math.max(this.belly, 0.45);
        this.hop = { from: pos.clone(), to: this.trough.clone(), t: 0 };
        this.state = 'rest';
        this.t = 1;
        this.onEvent('back');
        return;
      }
      if (gap < 28) {
        if (lured) {
          // Follow at a polite distance
          const k = Math.max(0, gap - 2.8) / Math.max(gap, 0.001);
          this.roam.set(pos.x + (pp.x - pos.x) * k, 0, pos.z + (pp.z - pos.z) * k);
          stepTo(d, this.roam, 4.2, dt);
        } else {
          stepTo(d, this.roam.set(pp.x, 0, pp.z), 3.7, dt);
          if (gap < 2.6 && this.chompCd <= 0) {
            this.chompCd = 5;
            // CHOMP: everything you carry goes flying
            while (player.stack.count) {
              const it = player.stack.pop()!;
              const land = new THREE.Vector3(pp.x + rand(-4, 4), 0.2, pp.z + rand(-4, 4));
              this.flyers.fly(it.mesh, () => land, () => it.mesh.removeFromParent(), 0.5, 2.5);
            }
            this.onEvent('chomp');
          }
        }
        return;
      }
    }
    // Nobody around: roam the island
    if (stepTo(d, this.roam, 1.8, dt)) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.8;
      this.roam.set(Math.cos(a) * WALK.rx * r, 0, Math.sin(a) * WALK.rz * r);
    }
  }
}

// ----------------------------------------------------------------------------
// 🦖 THIEF: a baby Dilophosaurus sneaks in from the jungle, grabs a few things
// from a counter/nest/blender and runs off. Walk into it to get them back.
// ----------------------------------------------------------------------------
class DinoThief {
  model: CreatureModel | null;
  stack: Stack | null = null;
  state: 'sneak' | 'steal' | 'escape' | 'caught' = 'sneak';
  done = false;
  private t = 0;
  private tag = new TextSprite(0.45, '#ff6b6b');
  private to = new THREE.Vector3();

  constructor(private scene: THREE.Scene, public loot: { stack: Stack; zone: Zone; name: string }, private exit: THREE.Vector3) {
    this.model = spawnDino('d-dilo', 3.2);
    if (!this.model) {
      this.done = true;
      return;
    }
    this.model.root.position.copy(exit);
    scene.add(this.model.root);
    const spot = handsSpot(this.model);
    this.stack = new Stack(this.model.bob, (i, _type, out) => out.set(0, spot.y0 + i * 0.32, spot.z0 + 0.6), 6);
    this.tag.setText('🦖 THIEF!');
    scene.add(this.tag.sprite);
  }

  /** Returns what happened this frame (for banners). */
  update(dt: number, player: THREE.Vector3 | null, flyers: Flyers): 'stealing' | 'caught' | 'escaped' | null {
    const m = this.model;
    if (!m || !this.stack || this.done) return null;
    const p = m.root.position;
    this.tag.sprite.position.set(p.x, m.height + 0.9, p.z);
    if (player && this.state !== 'caught' && Math.hypot(player.x - p.x, player.z - p.z) < 2.4) {
      // Caught! The loot hops back where it came from.
      this.state = 'caught';
      while (this.stack.canPop()) {
        if (!flyers.transfer(this.stack, this.loot.stack)) this.stack.pop()?.mesh.removeFromParent();
      }
      this.tag.setText('😵', '#ffffff');
      return 'caught';
    }
    let event: 'stealing' | 'escaped' | null = null;
    switch (this.state) {
      case 'sneak':
        if (stepTo(m, this.to.set(this.loot.zone.x, 0, this.loot.zone.z), 3.4, dt)) this.state = 'steal';
        break;
      case 'steal':
        animateCreature(m, dt, 0);
        this.t += dt;
        if (this.t > 0.5) {
          this.t = 0;
          if (!this.stack.full && flyers.transfer(this.loot.stack, this.stack)) {
            if (this.stack.count === 1) event = 'stealing';
          } else this.state = 'escape';
        }
        break;
      case 'escape':
      case 'caught':
        if (stepTo(m, this.exit, this.state === 'caught' ? 8 : 5.6, dt)) {
          this.done = true;
          m.root.removeFromParent();
          this.tag.sprite.removeFromParent();
          if (this.state === 'escape' && this.stack.count) event = 'escaped';
        }
        break;
    }
    return event;
  }
}

// ----------------------------------------------------------------------------
// 🥚 THE DODO RANCH: a pen of Dodos and the nests they lay eggs in
// ----------------------------------------------------------------------------
class DodoRanch {
  nests: ResourcePile[] = [];
  blockers: Blocker[] = [];
  private dodos: { m: CreatureModel; target: THREE.Vector3; rest: number }[] = [];
  readonly pen = { minX: 12, maxX: 32, minZ: -27, maxZ: -12 };

  constructor(scene: THREE.Scene, flyers: Flyers) {
    const p = this.pen;
    fence(scene, p, 1.6, 0xc8a26a);
    this.blockers.push({ minX: p.minX - 0.4, maxX: p.maxX + 0.4, minZ: p.minZ - 0.4, maxZ: p.maxZ + 0.4 });
    const hay = new THREE.Mesh(new THREE.PlaneGeometry(p.maxX - p.minX, p.maxZ - p.minZ), mat(0xd8c27a, 1));
    hay.rotation.x = -Math.PI / 2;
    hay.position.set((p.minX + p.maxX) / 2, 0.02, (p.minZ + p.maxZ) / 2);
    hay.receiveShadow = true;
    scene.add(hay);
    // A little coop
    scene.add(box(4, 2.6, 3, mat(0xb5651d, 0.8), 28, 1.3, -24));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.6, 4), mat(0x7a3b12, 0.8));
    roof.position.set(28, 3.4, -24);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    scene.add(roof);
    const sign = new TextSprite(0.8, '#ffd166');
    sign.setText('🦤 DODO RANCH');
    sign.sprite.position.set(22, 5, -19.5);
    scene.add(sign.sprite);

    // Nests just outside the south fence (the Dodos lay through the rails)
    for (const x of [16, 27]) {
      const n = new ResourcePile(scene, x, -8.6, flyers, 'egg', 'nest');
      n.spawnEvery = () => C.eggEvery;
      this.nests.push(n);
    }
    for (let i = 0; i < 5; i++) {
      const m = spawnDino('d-dodo', rand(0.95, 1.15)); // about chest-high on a person
      if (!m) continue;
      m.root.position.set(rand(p.minX + 2, p.maxX - 2), 0, rand(p.minZ + 2, p.maxZ - 2));
      scene.add(m.root);
      this.dodos.push({ m, target: m.root.position.clone(), rest: rand(0, 3) });
    }
  }

  update(dt: number) {
    for (const n of this.nests) n.update(dt);
    const p = this.pen;
    for (const d of this.dodos) {
      if (d.rest > 0) {
        d.rest -= dt;
        animateCreature(d.m, dt, 0);
        if (d.rest <= 0) {
          // Sometimes waddle over to "lay" at the nests by the south fence
          const nestSide = Math.random() < 0.35;
          d.target.set(nestSide ? (Math.random() < 0.5 ? 16 : 27) + rand(-1.5, 1.5) : rand(p.minX + 2, p.maxX - 2), 0, nestSide ? p.maxZ - 1.2 : rand(p.minZ + 2, p.maxZ - 2));
        }
        continue;
      }
      if (stepTo(d.m, d.target, 1.1, dt)) d.rest = rand(1, 4);
    }
  }
}

// ----------------------------------------------------------------------------
// 🚤 SEA SAFARI DOCK: tourists wait on the pier; launch a safari gate run.
// ----------------------------------------------------------------------------
class SafariDock {
  waiting = 0;
  zone: Zone;
  pad: CashPad;
  hasCaptain = false;
  onAutoTrip: (n: number) => void = () => {};
  private figures: CreatureModel[] = [];
  private label = new TextSprite(0.7, '#ffffff');
  private boat = new THREE.Group();
  private bobT = 0;
  private captainT = 0;
  /** Seconds until the boat is back from its current trip (0 = at the pier). */
  away = 0;
  private boatHome = new THREE.Vector3(46, -0.25, 25);

  constructor(scene: THREE.Scene) {
    // The pier, out into the sea to the east
    const plank = mat(0x9b6a3c, 0.9);
    scene.add(box(16, 0.3, 4, plank, 38, 0.35, 20));
    for (let x = 31; x <= 46; x += 3) for (const z of [18.2, 21.8]) scene.add(box(0.35, 2.2, 0.35, mat(0x5a3a22), x, -0.6, z));
    const pad = makePad(2.4, 2.4, 'BOARD', '#4fe3ff');
    pad.position.set(31.5, 0.05, 20);
    scene.add(pad);
    this.zone = new Zone(31.5, 20, 1.2, 1.2);
    this.pad = new CashPad(scene, 28, 24.5);

    // The safari boat at the end of the pier
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xf4f6f8, 0.4));
    hull.scale.set(2.2, 1.0, 5.2); // the lower half of a sphere = a bowl-shaped hull
    hull.position.y = 0.55;
    const stripe = box(4.5, 0.25, 9.5, mat(0x2a9d8f, 0.5), 0, 0.5, 0);
    const deck = box(4.2, 0.15, 9, mat(0xc8a26a, 0.8), 0, 0.62, 0);
    const cabin = box(2.6, 1.6, 2.4, mat(0xffffff, 0.4), 0, 1.4, -1.6);
    const roof = box(3.0, 0.2, 3.2, mat(0x2a9d8f, 0.5), 0, 2.3, -1.6);
    this.boat.add(hull, stripe, deck, cabin, roof);
    this.boat.position.set(46, -0.25, 25);
    scene.add(this.boat);
    const sign = new TextSprite(0.8, '#4fe3ff');
    sign.setText('🚤 SEA SAFARI');
    sign.sprite.position.set(40, 4.8, 20);
    scene.add(sign.sprite);
    this.label.sprite.position.set(36, 3.6, 20);
    scene.add(this.label.sprite);
    // Up to 3 people shown waiting in line on the pier (the label has the count)
    for (let i = 0; i < 3; i++) {
      const m = person(TOURIST_KINDS[i % TOURIST_KINDS.length]);
      noShadow(m.root);
      m.root.position.set(33.5 + i * 1.45, 0.5, 20 + (i % 2 ? 0.7 : -0.7));
      m.root.rotation.y = -Math.PI / 2; // facing the land (the BOARD pad)
      m.root.visible = false;
      scene.add(m.root);
      this.figures.push(m);
    }
    this.drawLabel();
  }

  add(n: number) {
    this.waiting = Math.min(C.safariMax, this.waiting + n);
    this.drawLabel();
  }

  /** Everyone boards: the boat heads out on a safari. */
  take() {
    const n = this.waiting;
    this.waiting = 0;
    this.away = C.tripTime;
    this.drawLabel();
    return n;
  }

  /** Can a safari leave right now? */
  get ready() {
    return this.away <= 0 && this.waiting >= C.safariMin && !weather.storm;
  }

  private shown = '';
  private drawLabel() {
    const txt = this.away > 0 ? `🚤 Out on safari · back in ${Math.ceil(this.away)}s · 🧍 ${this.waiting}`
      : weather.storm ? `⛈️ No safaris in a storm · 🧍 ${this.waiting}`
        : `🧍 ${this.waiting} waiting${this.waiting < C.safariMin ? ` (need ${C.safariMin})` : ''}`;
    if (txt === this.shown) return;
    this.shown = txt;
    this.label.setText(txt);
    this.figures.forEach((m, i) => (m.root.visible = i < Math.min(3, Math.ceil(this.waiting / 6))));
  }

  update(dt: number) {
    this.bobT += dt;
    // Off on a trip: sail out east, vanish over the horizon, then come back.
    if (this.away > 0) this.away = Math.max(0, this.away - dt);
    const trip = C.tripTime;
    const out = this.away > 0 ? Math.min(1, (trip - this.away) / 6, this.away / 6) : 0;
    this.boat.position.set(this.boatHome.x + out * 60, -0.25 + Math.sin(this.bobT * 1.6) * 0.08, this.boatHome.z + out * 8);
    this.boat.visible = out < 0.98;
    this.boat.rotation.z = Math.sin(this.bobT * 1.1) * 0.03;
    this.drawLabel();
    for (const m of this.figures) if (m.root.visible) animateCreature(m, dt, 0);
    // The Boat Captain takes full boats out by himself (a steady 1x trip).
    if (this.hasCaptain) {
      this.captainT += dt;
      if (this.captainT >= C.captainEvery && this.ready) {
        this.captainT = 0;
        this.onAutoTrip(this.take());
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Tourists flying in: a little plane lands on the airstrip, people get off
// and wander to the attractions (the safari line grows with each flight).
// ----------------------------------------------------------------------------
class Arrivals {
  onLand: (n: number) => void = () => {};
  private plane: { group: THREE.Group; spinners: THREE.Object3D[] };
  private t = 0;
  private state: 'away' | 'landing' | 'parked' | 'leaving' = 'away';
  private walkers: { m: CreatureModel; to: THREE.Vector3[] }[] = [];

  constructor(private scene: THREE.Scene) {
    this.plane = buildAircraftModel('twin');
    this.plane.group.visible = false;
    scene.add(this.plane.group);
  }

  update(dt: number) {
    for (const s of this.plane.spinners) s.rotation.x += dt * (this.state === 'parked' ? 3 : 40);
    this.t += dt;
    const g = this.plane.group.position;
    const z = AIRSTRIP_Z;
    if (this.state === 'away' && this.t >= C.arrivalEvery && !weather.storm) {
      this.state = 'landing';
      this.t = 0;
      this.plane.group.visible = true;
    } else if (this.state === 'landing') {
      const u = Math.min(1, this.t / 5);
      const k = (1 - u) * (1 - u);
      g.set(-6 + 80 * k, 16 * k * k, z);
      this.plane.group.rotation.z = 0.1 * k;
      if (u >= 1) {
        this.state = 'parked';
        this.t = 0;
        const n = Math.round(rand(C.arrivalTourists[0], C.arrivalTourists[1]));
        this.onLand(n);
        // A couple of them walk off toward the attractions (scenery)
        for (let i = 0; i < Math.min(2, n); i++) {
          const m = person(TOURIST_KINDS[Math.floor(Math.random() * TOURIST_KINDS.length)]);
          m.root.position.set(-4 + i, 0, z - 2);
          this.scene.add(m.root);
          const goals = [new THREE.Vector3(-4, 0, 20), new THREE.Vector3(14, 0, 12), new THREE.Vector3(26, 0, 22), new THREE.Vector3(-14, 0, -2)];
          this.walkers.push({ m, to: [new THREE.Vector3(-4 + i * 2, 0, z - 6), goals[Math.floor(Math.random() * goals.length)]] });
        }
      }
    } else if (this.state === 'parked' && this.t > 4) {
      this.state = 'leaving';
      this.t = 0;
    } else if (this.state === 'leaving') {
      g.x = -6 - 2.4 * this.t * this.t;
      g.y = Math.max(0, this.t - 2.6) ** 2 * 1.4;
      this.plane.group.rotation.z = -Math.min(0.25, Math.max(0, this.t - 2.6) * 0.15);
      if (this.t > 6) {
        this.state = 'away';
        this.t = 0;
        this.plane.group.visible = false;
      }
    }
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (stepTo(w.m, w.to[0], 3.6, dt)) {
        w.to.shift();
        if (!w.to.length) {
          w.m.root.removeFromParent();
          this.walkers.splice(i, 1);
        }
      }
    }
  }
}

// ============================================================================
export class IslandWorld {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  flyers = new Flyers(this.scene);
  player: Player;
  cashPads: CashPad[] = [];
  tiles: UnlockTile[] = [];
  workers: Worker[] = [];
  active = false;
  /** ⬆️ This world's upgrade pads. */
  ups: Upgrades | null = null;
  /** Set by main.ts: launch a Sea Safari gate run with `count` tourists. */
  onSafari: (count: number) => void = () => {};
  /** Set by main.ts: "Big Order: Volcano" was just bought (opens Act 4). */
  onAct4: () => void = () => {};

  private piles: ResourcePile[] = [];
  private blender: Bakery;
  private juice: Desk;
  private show: DiloShow | null = null;
  private supply: ResourcePile | null = null;
  private ranch: DodoRanch | null = null;
  private shop: Desk | null = null;
  private dock: SafariDock | null = null;
  private arrivals: Arrivals;
  private cashDodo: Assistant | null = null;
  private thief: DinoThief | null = null;
  private thiefT = rand(90, 150);
  private trash: TrashBin;
  private blockers: Blocker[] = [];
  private timers = new Map<object, number>();
  private sea: { m: CreatureModel; r: number; speed: number; a: number; y: number; dive: number }[] = [];
  private oceanTex: THREE.CanvasTexture;
  private smoke: THREE.Mesh[] = [];
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.7);
  private camOffset = new THREE.Vector3(0, 20, 17.5);
  private thirdFov = 56;
  private intro = 1;
  private zoneName = '';
  private hintShown = '';

  constructor(private hud: Hud, private sfx: Sfx, private save: SaveData, private progress: Progress) {
    this.oceanTex = this.buildIsland();
    this.trash = new TrashBin(this.scene, -30, 22);
    this.arrivals = new Arrivals(this.scene);
    this.arrivals.onLand = (n) => this.dock?.add(n);

    // Jack arrives by plane (stands by the airstrip)
    const jack = person('h-jack');
    jack.root.position.set(0, 0, 23);
    this.player = new Player(this.scene, { model: jack, spot: handsSpot(jack) });

    // 🥤 Juice Bar: two fruit trees, the blender, the counter + its cash pad
    for (const [x, z] of [[-24, 18], [-29, 9]]) {
      const pile = new ResourcePile(this.scene, x, z, this.flyers, 'fruit', 'fruit');
      pile.spawnEvery = () => (weather.storm ? C.fruitEvery * 3 : C.fruitEvery); // storms slow the trees
      this.piles.push(pile);
      this.blockers.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 2.8, maxZ: z - 1.2 });
    }
    this.blender = new Bakery(this.scene, -14, 8, this.flyers, BLENDER);
    this.blockers.push(this.blender.blocker);
    const juicePad = new CashPad(this.scene, -8.4, 20.6);
    this.cashPads.push(juicePad);
    this.juice = this.addDesk(-6, 16, juicePad, '🥤 JUICE BAR', 'smoothie', 0xf4a259, 0x2a9d8f, C.juiceInterval);

    for (const def of ISLAND_UNLOCKS) this.tiles.push(new UnlockTile(this.scene, def, save.paid[def.id] ?? 0));
    for (const id of save.unlocked) this.applyUnlock(id, false);
    this.refreshTiles(false);
    this.camera.position.copy(this.player.pos).add(this.camOffset);
    this.camera.lookAt(this.player.pos);
  }

  // --------------------------------------------------------------------------
  // The island: sea, beach, grass, volcano, airstrip, trees, sea creatures
  // --------------------------------------------------------------------------
  private buildIsland() {
    const s = this.scene;
    s.background = new THREE.Color(0x8fd3ff);
    s.fog = new THREE.Fog(0x8fd3ff, 140, 480);
    s.add(new THREE.HemisphereLight(0xffffff, 0x4a7a5a, 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // Ocean: a big sheet with drifting sparkles (a canvas texture that scrolls)
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1f7fc4';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${rand(0.05, 0.22)})`;
      g.fillRect(rand(0, 256), rand(0, 256), rand(6, 26), rand(1.5, 3));
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.1 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.45;
    ocean.receiveShadow = true;
    s.add(ocean);
    s.add(ellipse(LAND.rx + 12, LAND.rz + 12, new THREE.MeshStandardMaterial({ color: 0x46c6c9, roughness: 0.3, transparent: true, opacity: 0.75 }), -0.4)); // shallows
    s.add(ellipse(LAND.rx + 4, LAND.rz + 4, mat(0xf1d9a0, 1), -0.08)); // beach
    s.add(ellipse(LAND.rx, LAND.rz, mat(0x6fbf4a, 1), 0)); // grass
    // Paths (sandy) linking the attractions
    const path = mat(0xe3c98f, 1);
    for (const [x, z, w, d, r] of [[0, 12, 3, 40, 0], [-10, 2, 3, 30, 1.2], [12, 2, 3, 30, -1.2], [16, 20, 3, 28, 1.57]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), path);
      p.rotation.set(-Math.PI / 2, 0, r);
      p.position.set(x, 0.015, z);
      p.receiveShadow = true;
      s.add(p);
    }

    // Airstrip along the south shore
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(56, 6), mat(0x55595e, 0.9));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.02, AIRSTRIP_Z);
    strip.receiveShadow = true;
    s.add(strip);
    for (let x = -24; x <= 24; x += 6) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.35), mat(0xffffff, 0.7));
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.03, AIRSTRIP_Z);
      s.add(dash);
    }
    const windsock = box(0.12, 4, 0.12, mat(0xdddddd, 0.5), 27, 2, AIRSTRIP_Z - 4);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6, 10, 1, true), mat(0xff7a1a, 0.6));
    sock.rotation.z = Math.PI / 2;
    sock.position.set(27.8, 3.8, AIRSTRIP_Z - 4);
    s.add(windsock, sock);
    const welcome = new TextSprite(1.1, '#ffd166');
    welcome.setText('🏝️ WELCOME TO DINO ISLAND');
    welcome.sprite.position.set(0, 6.5, 26);
    s.add(welcome.sprite);

    // The volcano, out to sea in the north, smoking away
    // (a cut-off cone: the crater on top glows with lava)
    const volcano = new THREE.Mesh(new THREE.CylinderGeometry(11, 52, 58, 28, 1, true), mat(0x4e3b33, 1));
    volcano.position.set(-30, 27, -210);
    s.add(volcano);
    const lava = new THREE.Mesh(new THREE.CircleGeometry(11, 20), new THREE.MeshBasicMaterial({ color: 0xff5a1f, fog: false }));
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(-30, 55.5, -210);
    s.add(lava);
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.5, roughness: 1 }));
      puff.position.set(-30, 60 + i * 7, -210);
      s.add(puff);
      this.smoke.push(puff);
    }

    // Trees: palms around the beach, jungle trees inland (kept clear of the
    // attractions and paths)
    const spots: [TreeKind, number, number, number][] = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const x = Math.cos(a) * (LAND.rx - 1.5);
      const z = Math.sin(a) * (LAND.rz - 1.5);
      if (z > AIRSTRIP_Z - 6 && Math.abs(x) < 32) continue; // keep the airstrip clear
      if (x > 26 && z > 14 && z < 27) continue;              // and the pier
      spots.push(['t-palm', x, z, rand(7, 10)]);
    }
    const inland: [TreeKind, number, number][] = [
      ['t-banyan', -38, -2], ['t-fern', -36, 24], ['t-monkeypuzzle', 36, -4], ['t-conifer', 37, 6],
      ['t-banyan', -6, -30], ['t-fern', 6, -32], ['t-monkeypuzzle', -40, 12], ['t-fern', 36, -22],
      ['t-conifer', -2, -34], ['t-banyan', -18, 26],
    ];
    for (const [k, x, z] of inland) spots.push([k, x, z, rand(6, 9)]);
    for (const [k, x, z, h] of spots) {
      const t = spawnTree(k, h);
      if (!t) continue;
      t.position.set(x, 0, z);
      s.add(t);
    }

    // Sea creatures swimming laps around the island (scenery)
    const swimmers: [SeaKind, number, number, number][] = [
      ['s-mosasaurus', 16, 64, 5], ['s-megalodon', 11, 78, 6.5], ['s-ichthyo', 6, 58, 7.5],
    ];
    // (just three: they're big, and mostly under water)
    swimmers.forEach(([k, len, r, speed], i) => {
      const m = spawnSea(k, len);
      if (!m) return;
      noShadow(m.root); // swimming in the sea: no shadow needed
      s.add(m.root);
      this.sea.push({ m, r, speed, a: i * 1.7, y: -1.2, dive: rand(0, 6) });
    });
    // Crocodilians sunning on the beach
    for (const [k, x, z, ry] of [['s-sarco', -44, -14, 1.2], ['s-deino', 41, -20, -2.2]] as [SeaKind, number, number, number][]) {
      const m = spawnSea(k, k === 's-sarco' ? 9 : 8);
      if (!m) continue;
      m.root.position.set(x, -0.05, z);
      m.root.rotation.y = ry;
      s.add(m.root);
    }
    return tex;
  }

  private addDesk(x: number, z: number, pad: CashPad, label: string, sells: ItemType, color: number, awning: number, interval: number) {
    const desk = new Desk(this.scene, x, z, this.flyers, pad, null, {
      mode: 'cafe', sells, awning, label, color, kinds: TOURIST_KINDS, interval, queueMax: C.queueMax, serve: C.serve,
      // Tourists come up from the airstrip...
      entry: [new THREE.Vector3(2, 0, AIRSTRIP_Z + 2), new THREE.Vector3(x + 9, 0, z + 6)],
      // ...and head back to it afterwards
      exit: (from) => [new THREE.Vector3(from.x, 0, z + 4.5), new THREE.Vector3(x + 9, 0, z + 9), new THREE.Vector3(2, 0, AIRSTRIP_Z + 2)],
    });
    desk.onServe = (byPlayer) => this.progress.addXp(byPlayer ? CONFIG.xp.sale : CONFIG.xp.autoSale);
    desk.valueMult = () => this.progress.cashMult;
    this.blockers.push(desk.blocker);
    return desk;
  }

  // --------------------------------------------------------------------------
  // Unlocks
  // --------------------------------------------------------------------------
  private crew(title: string, kind: HumanKind, x: number, z: number, route: () => Route, animate: boolean) {
    const m = person(kind);
    const w = new Worker(this.scene, x, z, route, { color: 0 }, H, { model: m, spot: handsSpot(m), carry: C.crewCarry, speed: C.crewSpeed });
    titleTag(m, title, TITLE.human);
    this.workers.push(w);
    if (animate) this.flyers.grow(m.root);
  }

  private applyUnlock(id: string, animate: boolean) {
    if (!ISLAND_UNLOCKS.some((u) => u.id === id)) return;
    const grow = (o: THREE.Object3D) => animate && this.flyers.grow(o);
    const fullest = (piles: ResourcePile[]) => piles.reduce((a, b) => (b.stack.count > a.stack.count ? b : a));
    switch (id) {
      case 'i3-cashier':
        this.juice.hireStaff(person('h-crew3'), animate, '🥤 CASHIER');
        break;
      case 'i3-picker':
        this.crew('🍈 PICKER', 'h-crew1', -20, 12, () => {
          const p = fullest(this.piles);
          return { src: p.stack, srcZone: p.zone, dst: this.blender.input, dstZone: this.blender.inZone };
        }, animate);
        break;
      case 'i3-runner':
        this.crew('🏃 RUNNER', 'h-ember', -10, 12, () => ({ src: this.blender.output, srcZone: this.blender.outZone, dst: this.juice.shelf!, dstZone: this.juice.staffZone }), animate);
        break;
      case 'i3-dilo': {
        this.show = new DiloShow(this.scene, this.flyers, () => this.progress.cashMult, this.sfx);
        this.show.onEvent = (what) => {
          if (!this.active) return;
          if (what === 'escaped') this.hud.banner('🚨 The Dilophosaurus escaped!', 'Grab 🍖 from the supply drop: he follows food. Lead him to FEED!', 5000);
          else if (what === 'chomp') this.hud.floatAt(this.player.pos.clone().setY(H + 1), this.camera, '🦖 CHOMP! Dropped everything', 'big bad');
          else this.hud.banner('🦖 Back in the paddock!', 'The show is back on', 2500);
        };
        this.cashPads.push(this.show.pad);
        this.blockers.push(...this.show.blockers);
        this.supply = new ResourcePile(this.scene, -4, -12, this.flyers, 'meat', 'supply');
        this.supply.spawnEvery = () => (weather.storm ? Infinity : C.meatEvery); // no supply drops in a storm
        this.blockers.push({ minX: -5.3, maxX: -2.7, minZ: -14.9, maxZ: -13.1 });
        grow(this.supply.group);
        if (animate) this.hud.banner('🦖 The Dilo Show is open!', 'Carry 🍖 from the supply drop to FEED: a fed dino = a paying crowd', 4200);
        break;
      }
      case 'i3-keeper':
        this.crew('🦖 KEEPER', 'h-crew4', -6, -8, () => ({ src: this.supply!.stack, srcZone: this.supply!.zone, dst: this.show!.feed, dstZone: this.show!.feedZone }), animate);
        break;
      case 'i3-dodo': {
        this.ranch = new DodoRanch(this.scene, this.flyers);
        this.blockers.push(...this.ranch.blockers);
        const pad = new CashPad(this.scene, 15.6, 6.6);
        this.cashPads.push(pad);
        this.shop = this.addDesk(18, 2, pad, '🥚 DODO SHOP', 'egg', 0x6a4c93, 0xffd166, C.shopInterval);
        [this.shop.group, pad.group].forEach(grow);
        if (animate) this.hud.banner('🦤 Dodo Ranch open!', 'Collect 🥚 from the nests and sell them at the Dodo Shop', 4200);
        break;
      }
      case 'i3-eggs':
        this.crew('🥚 COLLECTOR', 'h-crew2', 20, -4, () => {
          const n = fullest(this.ranch!.nests);
          return { src: n.stack, srcZone: n.zone, dst: this.shop!.shelf!, dstZone: this.shop!.staffZone };
        }, animate);
        break;
      case 'i3-clerk':
        this.shop?.hireStaff(person('h-balance'), animate, '🛍️ CLERK');
        break;
      case 'i3-dock': {
        this.dock = new SafariDock(this.scene);
        this.cashPads.push(this.dock.pad);
        this.dock.add(8); // a few tourists are already waiting
        this.dock.onAutoTrip = (n) => {
          // The captain's trips pay a steady 1x per tourist (no gates)
          const value = n * ITEM_VALUE.ticket * this.progress.cashMult;
          const bills = Math.min(10, n);
          for (let i = 0; i < bills; i++) payBill(this.scene, this.flyers, this.dock!.pad, this.dock!.pad.group, Math.round(value / bills));
        };
        if (animate) this.hud.banner('🚤 Sea Safari open!', 'Tourists wait on the pier: stand on BOARD to launch a safari run', 4200);
        break;
      }
      case 'i3-captain': {
        if (this.dock) this.dock.hasCaptain = true;
        // He waits by the BOARD pad between trips
        const cap = person('h-director');
        cap.root.position.set(33.6, 0, 21.4);
        cap.root.rotation.y = -Math.PI / 2;
        titleTag(cap, '🧑‍✈️ CAPTAIN', TITLE.human);
        this.scene.add(cap.root);
        grow(cap.root);
        if (animate) this.hud.banner('🧑‍✈️ Boat Captain hired', 'He takes full boats out by himself (steady 1x trips)', 3500);
        break;
      }
      case 'i3-cashdodo': {
        // Sarah, your personal assistant, comes over from the airport to run
        // the island's cash (the unlock's id is kept so old saves still work).
        const m = person('h-sarah');
        m.root.position.set(4, 0, 12);
        this.scene.add(m.root);
        grow(m.root);
        const tag = new TextSprite(TITLE.human, '#ffd166');
        tag.setText('💼 SARAH'); // (the only place she goes by name)
        this.scene.add(tag.sprite);
        this.cashDodo = new Assistant(m, new THREE.Vector3(4, 0, 12), tag, (v) => {
          v *= this.ups?.bonus ?? 1; // 💼 COLLECTORS upgrade bonus
          this.addCash(v);
          autoCash(v);
        });
        if (animate) this.hud.banner('👩‍💼 Sarah is on the island!', 'She collects the cash from every pad for you', 3500);
        break;
      }
      case 'i3-volcano':
        // ACT 4: main.ts opens the volcano (only when you just bought it)
        if (animate) this.onAct4();
        break;
    }
  }

  private unlock(tile: UnlockTile) {
    const id = tile.def.id;
    this.save.unlocked.push(id);
    delete this.save.paid[id];
    tile.mesh.visible = false;
    this.applyUnlock(id, true);
    this.progress.addXp(tile.def.cost * CONFIG.xp.unlockFraction * 0.4);
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

  /** A Sea Safari run finished: pay for every tourist who made it. */
  receiveSafari(endCount: number) {
    const earned = Math.round(endCount * ITEM_VALUE.ticket * this.progress.cashMult);
    this.addCash(earned);
    this.progress.addXp(endCount * CONFIG.xp.runPerItem * 2);
    this.sfx.unlocked();
    this.hud.floatAt(this.player.pos.clone().setY(3), this.camera, `+$${earned}`, 'big gold');
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

  private canWalk = (x: number, z: number) => (x / WALK.rx) ** 2 + (z / WALK.rz) ** 2 <= 1;

  update(dt: number, move: THREE.Vector2) {
    // ⬆️ Upgrade pads (made on the first frame, once the world is built)
    this.ups ??= new Upgrades(
      {
        scene: this.scene, camera: this.camera, workers: this.workers, home: new THREE.Vector3(4, 0, 12), canWalk: this.canWalk, // (home = by the assistant's spot)
        tileSpots: ISLAND_UNLOCKS.map((d) => d.pos), collectors: () => this.cashDodo ? [this.cashDodo] : [],
      },
      'island', this.save, this.hud, this.sfx, this.flyers, this.progress,
    );
    this.ups.update(dt, this, this.player.pos, this.active);
    const me = this.player;
    // The world runs whether or not you're here
    for (const p of this.piles) p.update(dt);
    this.blender.update(dt);
    this.juice.update(dt, this.active && this.juice.staffZone.contains(me.pos), this.sfx);
    this.shop?.update(dt, this.active && this.shop.staffZone.contains(me.pos), this.sfx);
    this.supply?.update(dt);
    this.show?.update(dt, this.active ? me : null);
    this.updateThief(dt);
    this.ranch?.update(dt);
    this.dock?.update(dt);
    this.arrivals.update(dt);
    for (const w of this.workers) w.update(dt, this.flyers);
    this.cashDodo?.update(dt, this.cashPads, this.flyers);
    this.updateScenery(dt);

    if (this.active) {
      const prog = this.progress;
      me.carryMax = CONFIG.player.baseCarry + 6 + prog.carryBonus;
      me.speedMult = prog.speedMult * 1.15;
      me.update(dt, move, this.blockers, this.canWalk);
      this.interact(dt);
      this.hud.setInventory(me.stack.counts(), me.stack.count, me.carryMax);
      if (this.zoneName !== 'island') {
        this.zoneName = 'island';
        this.hud.setZone('🏝️ Dino Island');
      }
      this.showHint();
      this.updateCamera(dt);
    } else {
      animateCreature(me.model, dt, 0);
    }
    this.flyers.update(dt);
  }

  /** Baby Dilo thieves sneak in now and then (only while you're here to stop them). */
  private updateThief(dt: number) {
    if (this.thief) {
      const ev = this.thief.update(dt, this.active ? this.player.pos : null, this.flyers);
      if (ev === 'stealing' && this.active) this.hud.banner('🦖 Thief!', `A baby Dilo is stealing your ${this.thief.loot.name}. Run into it!`, 3200);
      else if (ev === 'caught') {
        const reward = Math.round(C.thiefReward * this.progress.cashMult);
        this.addCash(reward);
        this.sfx.unlocked();
        this.hud.floatAt(this.player.pos.clone().setY(H + 1), this.camera, `🦖 Caught! +$${reward}`, 'big gold');
      } else if (ev === 'escaped' && this.active) this.hud.floatAt(this.player.pos.clone().setY(H + 1), this.camera, '🦖 It got away with the loot…', 'big bad');
      if (this.thief.done) this.thief = null;
      return;
    }
    if (!this.active) return;
    this.thiefT -= dt;
    if (this.thiefT > 0) return;
    this.thiefT = rand(C.thiefEvery[0], C.thiefEvery[1]);
    // Go after whatever has the most stuff on it
    const spots: { stack: Stack; zone: Zone; name: string }[] = [
      { stack: this.juice.shelf!, zone: this.juice.staffZone, name: 'smoothies 🥤' },
      { stack: this.blender.output, zone: this.blender.outZone, name: 'smoothies 🥤' },
      ...this.piles.map((p) => ({ stack: p.stack, zone: p.zone, name: 'fruit 🍈' })),
      ...(this.shop?.shelf ? [{ stack: this.shop.shelf, zone: this.shop.staffZone, name: 'Dodo eggs 🥚' }] : []),
      ...(this.ranch ? this.ranch.nests.map((n) => ({ stack: n.stack, zone: n.zone, name: 'Dodo eggs 🥚' })) : []),
    ].filter((s) => s.stack.count >= 3);
    if (!spots.length) return;
    const loot = spots.reduce((a, b) => (b.stack.count > a.stack.count ? b : a));
    // Sneaks in from the jungle edge on the far side of the loot from you
    const a = Math.atan2(loot.zone.z, loot.zone.x) + rand(-0.6, 0.6);
    const exit = new THREE.Vector3(Math.cos(a) * WALK.rx, 0, Math.sin(a) * WALK.rz);
    this.thief = new DinoThief(this.scene, loot, exit);
  }

  private updateScenery(dt: number) {
    this.oceanTex.offset.x += dt * 0.004;
    this.oceanTex.offset.y += dt * 0.0025;
    const now = performance.now() / 1000;
    this.smoke.forEach((p, i) => {
      p.position.y = 60 + ((now * 3 + i * 7) % 42);
      p.scale.setScalar(1 + ((now * 3 + i * 7) % 42) / 20);
      (p.material as THREE.MeshStandardMaterial).opacity = 0.55 * (1 - ((now * 3 + i * 7) % 42) / 42);
    });
    // Swimmers: laps around the island, now and then diving + surfacing
    for (const s of this.sea) {
      s.a += (dt * s.speed * pace.move) / s.r;
      const x = Math.cos(s.a) * s.r;
      const z = Math.sin(s.a) * s.r * 0.92;
      s.dive += dt;
      const surf = Math.sin(s.dive * 0.5); // > 0 near the surface
      s.m.root.position.set(x, -1.6 + Math.max(0, surf) * 1.3, z);
      // Face along the lap (tangent), tipping nose down/up with the dive
      s.m.root.rotation.set(Math.cos(s.dive * 0.5) * -0.15, Math.atan2(-Math.sin(s.a), Math.cos(s.a) * 0.92), Math.sin(s.dive * 2) * 0.06);
    }
  }

  private interact(dt: number) {
    const me = this.player;
    const p = me.pos;
    const prog = this.progress;
    const xp = CONFIG.xp;
    const iv = CONFIG.player.pickupInterval / prog.workMult;
    const take = (key: object, zone: Zone, from: Stack) =>
      this.every(key, dt, zone.contains(p) && me.canTake(), iv, () => {
        if (me.canTake() && this.flyers.transfer(from, me.stack)) {
          this.sfx.pickup();
          prog.addXp(xp.pickup);
        }
      });
    const drop = (key: object, zone: Zone, to: Stack, type: ItemType) =>
      this.every(key, dt, zone.contains(p) && me.stack.has(type), iv, () => {
        if (!to.full && this.flyers.transferType(me.stack, to, type)) {
          this.sfx.drop();
          prog.addXp(xp.drop);
        }
      });

    for (const pile of this.piles) take(pile, pile.zone, pile.stack);
    drop(this.blender.inZone, this.blender.inZone, this.blender.input, 'fruit');
    take(this.blender.outZone, this.blender.outZone, this.blender.output);
    if (this.juice.shelf) drop(this.juice.staffZone, this.juice.staffZone, this.juice.shelf, 'smoothie');
    if (this.supply) take(this.supply, this.supply.zone, this.supply.stack);
    if (this.show) drop(this.show.feedZone, this.show.feedZone, this.show.feed, 'meat');
    if (this.ranch) for (const n of this.ranch.nests) take(n, n.zone, n.stack);
    if (this.shop?.shelf) drop(this.shop.staffZone, this.shop.staffZone, this.shop.shelf, 'egg');

    // Sea Safari: stand on BOARD with enough tourists waiting
    if (this.dock) {
      const ready = this.dock.zone.contains(p) && this.dock.ready;
      if (ready) this.hud.setLaunch(this.dock.waiting, () => this.onSafari(this.dock!.take()), '🚤 SEA SAFARI');
      else if (this.dock.zone.contains(p) || this.launchShown) this.hud.setLaunch(null);
      this.launchShown = ready;
    }

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
  private launchShown = false;

  /** First steps on the island. */
  private showHint() {
    const me = this.player.stack;
    let hint: string | null = null;
    if (!this.save.unlocked.includes('i3-picker')) {
      if (me.has('smoothie')) hint = 'Put the 🥤 smoothies on the JUICE BAR counter (SELL)';
      else if (me.has('fruit')) hint = 'Drop the 🍈 fruit into the BLENDER (IN)';
      else if (this.blender.output.count > 0) hint = 'Grab the smoothies from the blender (OUT)';
      else hint = 'Pick 🍈 fruit from the trees (by the beach, west)';
    }
    if (hint !== this.hintShown) {
      this.hintShown = hint ?? '';
      this.hud.setHint(hint);
    }
  }

  // --------------------------------------------------------------------------
  // Camera + switching worlds
  // --------------------------------------------------------------------------
  /** Flying in: the camera starts high over the island and swoops down to Jack. */
  enter(flyIn: boolean) {
    this.active = true;
    this.zoneName = '';
    this.hintShown = '-';
    this.hud.setCash(this.save.cash);
    this.intro = flyIn ? 0 : 1;
    if (this.show?.free) this.hud.banner('🚨 The Dilophosaurus is loose!', 'Carry 🍖 near him and lead him to FEED', 4500);
  }

  leave() {
    this.active = false;
    this.hud.setHint(null);
    this.hud.setLaunch(null);
  }

  get focus() {
    return this.player.pos;
  }

  private camLook = new THREE.Vector3();
  private setFov(fov: number) {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(dt: number) {
    const target = this.player.pos;
    const want = new THREE.Vector3().copy(target).add(this.camOffset);
    const fp = this.player.firstPerson && this.intro >= 1;
    this.setFov(fp ? fpFov(this.camera.aspect) : this.thirdFov);
    this.sun.position.set(target.x + 12, 30, target.z + 14);
    this.sun.target.position.copy(target);
    if (fp) {
      this.player.placeEyeCamera(this.camera);
      return;
    }
    if (this.intro < 1) {
      // Swoop in from high above the island (like coming in on the plane)
      this.intro = Math.min(1, this.intro + dt / 3.2);
      const k = this.intro * this.intro * (3 - 2 * this.intro);
      const from = new THREE.Vector3(60, 75, 110);
      this.camera.position.lerpVectors(from, want, k);
      this.camLook.lerpVectors(new THREE.Vector3(0, 0, -10), target, k);
      this.camera.lookAt(this.camLook);
      return;
    }
    this.camera.position.lerp(want, Math.min(1, dt * 5));
    this.camera.lookAt(this.camera.position.x - this.camOffset.x, 0, this.camera.position.z - this.camOffset.z);
  }

  setShadowSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    const portrait = w < h;
    this.camOffset.set(0, portrait ? 20 : 16, portrait ? 17.5 : 15.5);
    this.thirdFov = portrait ? 56 : 42;
    this.camera.fov = this.player.firstPerson ? fpFov(this.camera.aspect) : this.thirdFov;
    this.camera.updateProjectionMatrix();
  }
}
