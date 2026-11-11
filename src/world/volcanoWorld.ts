// ============================================================================
// volcanoWorld.ts — ACT 4: THE VOLCANO (human scale, like the island).
//
// Anthill Airways charters helicopter tours to Mount Anthill, an active
// volcano. You run everything around its base:
//
//   💎 OBSIDIAN MINE     black rock -> FORGE -> polished gems -> GEM SHOP
//   ⚡ GEOTHERMAL PLANT  carry 🔥 magma from the lava vent into MAGMA IN.
//                        While it's powered, ALL your cash (every world) is
//                        boosted, and it sells power to the grid.
//                        Magma burns away if you carry it too long!
//   🚁 HELI TOURS        tourists fly in -> a helicopter gate run over the lava
//   🦖 LAVA REX LAIR     feed the Rex 🍖 at TAME until it's tamed; then it
//                        hauls 40 at a time for you (it's heat-proof)
//   🐜 FIRE ANT KINGDOM  giant fire ants! Bring the Fire Queen 💎 tribute and
//                        her colony digs 🔶 Fire Crystals for the Crystal Exchange
//   🌋 THE BIG ERUPTION  prestige (main.ts handles the reset)
//
// Dangers: HEAT (stand near the lava lake and the heat bar fills; full = you
// drop everything), ERUPTIONS (lava bombs land near you, lava flows cross the
// paths, tourists must be evacuated) and MAGMA that burns through your stack.
// ============================================================================
import * as THREE from 'three';
import { CONFIG, VOLCANO_CFG as C, VOLCANO_UNLOCKS } from '../data/config';
import { Sfx } from '../core/audio';
import { SaveData } from '../core/save';
import { Progress } from '../core/progress';
import { Hud } from '../ui/hud';
import { HumanKind, spawnCreature } from '../actors/creatures';
import { CreatureModel, animateCreature, faceToward, makeAnt } from '../actors/models';
import { Player, backSpot, fpFov, handsSpot } from '../actors/player';
import { Route, Worker, addHat } from '../actors/worker';
import { makeRex, roar } from '../actors/rex';
import { Flyers, ITEM_VALUE, ItemType, Stack } from './items';
import { TITLE, TextSprite, makePad, titleTag } from './labels';
import { Bakery, Blocker, CashPad, ProcessorOpts, ResourcePile, TrashBin, UnlockTile, Zone, gridLayout } from './stations';
import { Assistant, Desk, payBill, person, stepTo } from './airportWorld';
import { buildAircraftModel } from './aircraft';

const H = 2.8; // people are this tall (same as the airport + island)
const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const hot = (color: number, glow: number, intensity = 1.4) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: glow, emissiveIntensity: intensity });
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  b.receiveShadow = true;
  return b;
}
/** A flat ellipse lying on the ground. */
function ellipse(rx: number, rz: number, material: THREE.Material, y: number, x = 0, z = 0) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function noShadow(o: THREE.Object3D) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = false;
  });
  return o;
}
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const inRect = (p: THREE.Vector3, r: Rect) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
/** Distance from a point to a rectangle (0 inside). */
const distRect = (p: THREE.Vector3, r: Rect) => Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));

// ---- The map (x = east, z = south; the volcano looms to the north) ----------
const LAND = { rx: 46, rz: 40 };
const WALK = { rx: 42, rz: 36 };
const LAKE: Rect = { minX: 18, maxX: 36, minZ: -32, maxZ: -16 };   // the lava lake (NE)
const PEN: Rect = { minX: -36, maxX: -16, minZ: -30, maxZ: -12 };  // the Lava Rex lair (NW)
const HOLLOW: Rect = { minX: 24, maxX: 40, minZ: -6, maxZ: 14 };   // the Fire Ant Kingdom (E)
const HOLLOW_GAP = { from: 0, to: 6 };                             // its entrance (west wall)
/** Where lava flows cross the paths during an eruption. */
const FLOWS: Rect[] = [
  { minX: 6, maxX: 8.5, minZ: -12, maxZ: 13 },
  { minX: -20, maxX: 2, minZ: -3, maxZ: 0 },
];
const HELIPAD = new THREE.Vector3(24, 0, 30);   // tourists land here
const ERUPT = { x: -8, z: -30 };                 // the prestige altar (matches its tile)
/** Mount Anthill: rises straight out of the sea off the north shore. */
const MOUNT = { z: -100, base: 60, top: 14, h: 85 };
const TOUR_HELI = new THREE.Vector3(-6, 0, 31);  // the tour helicopter parks here
const TOURIST_KINDS: HumanKind[] = ['h-exec', 'h-balance', 'h-ember', 'h-director'];

/** The forge (the oven machine from Act 1, in volcanic colors). */
const FORGE: ProcessorOpts = { inType: 'obsidian', outType: 'gem', label: 'FORGE', cookTime: C.forgeTime, body: 0x3a2f2c, trim: 0x1b1a24, glow: 0xff5a12 };

// ----------------------------------------------------------------------------
// ⚡ THE GEOTHERMAL PLANT: feed it magma; powered = +25% on all your cash
// ----------------------------------------------------------------------------
class GeoPlant {
  input: Stack;
  inZone: Zone;
  pad: CashPad;
  blocker: Blocker = { minX: -4.6, maxX: 4.6, minZ: -24.6, maxZ: -15.4 };
  power = 0.35;
  private eatT = 0;
  private payT = 0;
  private sign = new TextSprite(0.85, '#ffd166');
  private shown = -1;
  private steam: THREE.Mesh[] = [];
  private lights: THREE.MeshStandardMaterial;
  private mouth = new THREE.Vector3(5.5, 2.2, -16.6);
  private t = 0;

  constructor(private scene: THREE.Scene, private flyers: Flyers, private payMult: () => number) {
    // The hall + two cooling towers + a hot pipe running to the lava lake
    scene.add(box(9, 4, 5, mat(0x5d6b78, 0.6, 0.2), 0, 2, -18));
    scene.add(box(9.4, 0.4, 5.4, mat(0x2b3440, 0.6), 0, 4.2, -18));
    this.lights = new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x4fe3ff, emissiveIntensity: 0.2 });
    for (let i = 0; i < 4; i++) scene.add(box(1.2, 0.8, 0.05, this.lights, -3 + i * 2, 2.6, -15.47));
    for (const x of [-2.6, 2.6]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.1, 6, 18, 1, true), mat(0xc9ccd1, 0.7));
      tower.position.set(x, 3, -22);
      tower.castShadow = true;
      scene.add(tower);
      for (let i = 0; i < 3; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, roughness: 1 }));
        puff.position.set(x, 6.5, -22);
        noShadow(puff);
        scene.add(puff);
        this.steam.push(puff);
      }
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 14, 10), hot(0x6a2a10, 0xff4a12, 0.6));
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = 0.25;
    pipe.position.set(11, 0.5, -20);
    scene.add(pipe);

    // MAGMA IN: a heat-proof hopper on the south-east corner
    scene.add(box(2.2, 1.2, 2.2, mat(0x3a3f45, 0.4, 0.6), 5.5, 0.6, -16.6));
    const holder = new THREE.Group();
    holder.position.set(5.5, 1.2, -16.6);
    scene.add(holder);
    this.input = new Stack(holder, gridLayout(3, 3, 0.5, 0.5, 0.0), 27);
    const pad = makePad(2.4, 2.4, 'MAGMA IN', '#ff9f43');
    pad.position.set(5.5, 0.04, -13.8);
    scene.add(pad);
    this.inZone = new Zone(5.5, -13.8, 1.25, 1.25);
    this.pad = new CashPad(scene, -6, -13);
    this.sign.sprite.position.set(0, 7.6, -18);
    scene.add(this.sign.sprite);
    this.draw();
  }

  get powered() {
    return this.power > 0.02;
  }

  private draw() {
    const pct = Math.ceil(this.power * 20) * 5;
    if (pct === this.shown) return;
    this.shown = pct;
    if (this.powered) this.sign.setText(`⚡ GEOTHERMAL · ${pct}% · +${Math.round(C.powerBoost * 100)}% ALL 💵`, '#ffd166');
    else this.sign.setText('⚡ GEOTHERMAL · OFF · bring 🔥 magma', '#ff6b6b');
  }

  update(dt: number) {
    this.t += dt;
    this.power = Math.max(0, this.power - dt / C.plantDrain);
    // Burn one magma rock at a time
    this.eatT += dt;
    if (this.eatT >= 0.45) {
      this.eatT = 0;
      if (this.power < 0.97 && this.input.canPop()) {
        const it = this.input.pop()!;
        this.flyers.fly(it.mesh, () => this.mouth, () => {
          it.mesh.removeFromParent();
          this.power = Math.min(1, this.power + C.magmaFill);
        }, 0.3, 0.6);
      }
    }
    if (this.powered) {
      this.payT += dt;
      if (this.payT >= C.plantPayEvery) {
        this.payT = 0;
        payBill(this.scene, this.flyers, this.pad, this.pad.group, Math.round(C.plantPay * this.payMult()));
      }
    }
    // Steam rises from the towers while it runs; the windows glow
    this.steam.forEach((p, i) => {
      const u = ((this.t * 0.5 + i * 0.33) % 1);
      p.position.y = 6.5 + u * 6;
      p.scale.setScalar(0.8 + u * 1.4);
      (p.material as THREE.MeshStandardMaterial).opacity = this.powered ? 0.55 * (1 - u) : 0;
    });
    this.lights.emissiveIntensity = this.powered ? 0.9 + Math.sin(this.t * 3) * 0.15 : 0.1;
    this.draw();
  }
}

// ----------------------------------------------------------------------------
// 🦖 THE LAVA REX LAIR: drop 🍖 on TAME; the Rex eats it and slowly tames
// ----------------------------------------------------------------------------
class RexLair {
  feed: Stack;
  feedZone: Zone;
  blockers: Blocker[] = [];
  rex: ReturnType<typeof makeRex> | null;
  /** 0..1 (saved in save.paid['v4-rex-tame'] so it survives a reload). */
  tame: number;
  onEvent: (what: 'roar' | 'tamed') => void = () => {};
  private sign = new TextSprite(0.9, '#ffd166');
  private shown = '';
  private target = new THREE.Vector3();
  private trough = new THREE.Vector3(PEN.maxX - 2.6, 0, -21);
  private state: 'wander' | 'rest' | 'toTrough' | 'eat' = 'wander';
  private t = 0;
  private roarCd = 3;

  constructor(private scene: THREE.Scene, private flyers: Flyers, private save: SaveData, tamed: boolean) {
    this.tame = tamed ? 1 : save.paid['v4-rex-tame'] ?? 0;
    const p = PEN;
    // Scorched floor + a big rock wall (the Rex could step over a fence!)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(p.maxX - p.minX, p.maxZ - p.minZ), mat(0x3b2e29, 1));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((p.minX + p.maxX) / 2, 0.02, (p.minZ + p.maxZ) / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    const rock = mat(0x2a2422, 0.95);
    const wall = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const w = box(x1 === x2 ? 1 : len + 1, 3.4, x1 === x2 ? len + 1 : 1, rock, (x1 + x2) / 2, 1.7, (z1 + z2) / 2);
      scene.add(w);
      // Jagged rocks on top
      const n = Math.round(len / 2.5);
      for (let i = 0; i <= n; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.6, 1.0)), rock);
        r.position.set(x1 + ((x2 - x1) * i) / n, 3.5, z1 + ((z2 - z1) * i) / n);
        r.castShadow = true;
        scene.add(r);
      }
    };
    wall(p.minX, p.minZ, p.maxX, p.minZ);
    wall(p.minX, p.minZ, p.minX, p.maxZ);
    wall(p.maxX, p.minZ, p.maxX, p.maxZ);
    wall(p.minX, p.maxZ, p.maxX, p.maxZ);
    this.blockers.push({ minX: p.minX - 0.6, maxX: p.maxX + 0.6, minZ: p.minZ - 0.6, maxZ: p.maxZ + 0.6 });
    // A little lava pool in the corner (it likes it warm)
    scene.add(ellipse(3, 2.2, hot(0x7a2008, 0xff5a12, 1.2), 0.05, -31, -25));

    // TAME platform outside the east wall; the trough is just inside
    const tx = p.maxX + 2.8;
    scene.add(box(2.6, 0.3, 2.6, mat(0x6b4a2f, 0.9), tx, 0.15, -21));
    const pad = makePad(2.4, 2.4, 'TAME', '#ff9f43');
    pad.position.set(tx, 0.32, -21);
    scene.add(pad);
    const holder = new THREE.Group();
    holder.position.set(tx, 0.3, -21);
    scene.add(holder);
    this.feed = new Stack(holder, gridLayout(3, 3, 0.5, 0.5, 0.05), 24);
    this.feedZone = new Zone(tx, -21, 1.3, 1.3);
    this.sign.sprite.position.set(-26, 7.5, -21);
    scene.add(this.sign.sprite);

    this.rex = tamed ? null : makeRex(9);
    if (this.rex) {
      this.rex.root.position.set(-26, 0, -21);
      scene.add(this.rex.root);
    }
    this.pickSpot();
    this.draw();
  }

  get tamed() {
    return this.tame >= 1;
  }

  private pickSpot() {
    const p = PEN;
    this.target.set(rand(p.minX + 5, p.maxX - 5), 0, rand(p.minZ + 4, p.maxZ - 4));
  }

  private draw() {
    const txt = this.tamed ? '🦖 LAVA REX · Tamed! It hauls for you' : `🦖 LAVA REX · Taming ${Math.floor(this.tame * 100)}% · bring 🍖`;
    if (txt === this.shown) return;
    this.shown = txt;
    this.sign.setText(txt, this.tamed ? '#7df9a0' : '#ffd166');
  }

  update(dt: number, player: THREE.Vector3 | null) {
    this.draw();
    const d = this.rex;
    if (!d) return;
    const pos = d.root.position;
    // Roars at you when you come close (it's a Rex!)
    this.roarCd -= dt;
    if (player && this.roarCd <= 0 && Math.hypot(player.x - pos.x, player.z - pos.z) < 11) {
      this.roarCd = rand(7, 11);
      roar(d);
      faceToward(d, player.x - pos.x, player.z - pos.z, 1, 1);
      this.onEvent('roar');
    }
    switch (this.state) {
      case 'wander':
        if (this.feed.canPop()) {
          this.state = 'toTrough';
          break;
        }
        if (stepTo(d, this.target, 2.2, dt)) {
          this.state = 'rest';
          this.t = rand(2, 5);
        }
        break;
      case 'rest':
        animateCreature(d, dt, 0);
        this.t -= dt;
        if (this.t <= 0 || this.feed.canPop()) {
          this.pickSpot();
          this.state = 'wander';
        }
        break;
      case 'toTrough':
        if (stepTo(d, this.trough, 3.2, dt)) {
          this.state = 'eat';
          this.t = 0;
        }
        break;
      case 'eat': {
        animateCreature(d, dt, 0);
        faceToward(d, 1, 0, dt, 6);
        this.t += dt;
        if (this.t < 0.8) break;
        this.t = 0;
        const it = this.feed.pop();
        if (!it) {
          this.pickSpot();
          this.state = 'wander';
          break;
        }
        // Toss it over the wall: CHOMP
        const mouth = new THREE.Vector3(pos.x + 3.2, d.height * 0.85, pos.z);
        this.flyers.fly(it.mesh, () => mouth, () => {
          it.mesh.removeFromParent();
          this.tame += 1 / C.rexTameMeat;
          if (this.tame > 0.999) this.tame = 1; // (24 x 1/24 can land a hair under 1)
          this.save.paid['v4-rex-tame'] = this.tame;
          d.bob.scale.setScalar(1.05);
          setTimeout(() => d.bob.scale.setScalar(1), 160);
          if (this.tamed) this.onEvent('tamed');
        }, 0.35, 2.2);
        break;
      }
    }
  }

  /** Tamed: the wild Rex leaves the lair (the world spawns the saddled one). */
  release() {
    this.rex?.root.removeFromParent();
    this.rex = null;
    this.draw();
  }
}

// ----------------------------------------------------------------------------
// 🐜 THE FIRE ANT KINGDOM: giant fire ants + their Queen. Tribute 💎 -> favor;
// while she's pleased, the vault fills with 🔶 Fire Crystals.
// ----------------------------------------------------------------------------
class Kingdom {
  tribute: Stack;
  tributeZone: Zone;
  vault: ResourcePile;
  favor = 0.3;
  blockers: Blocker[] = [];
  private queen: CreatureModel | null;
  private ants: { m: CreatureModel; to: THREE.Vector3; rest: number }[] = [];
  private sign = new TextSprite(0.85, '#ffd166');
  private shown = '';
  private eatT = 0;
  private mouth = new THREE.Vector3(31.6, 1.4, 3);

  constructor(private scene: THREE.Scene, private flyers: Flyers) {
    // The Fire Queen on her throne mound, facing the entrance
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.4, 0.8, 20), mat(0x3a2a24, 1));
    mound.position.set(35.5, 0.4, 3);
    mound.receiveShadow = true;
    scene.add(mound);
    this.queen = spawnCreature('queen', 7.5);
    if (this.queen) {
      this.queen.root.position.set(35.5, 0.8, 3);
      this.queen.root.rotation.y = -Math.PI / 2; // facing west, toward the entrance
      scene.add(this.queen.root);
    }
    this.blockers.push({ minX: 31.4, maxX: 39.6, minZ: -0.6, maxZ: 6.6 });

    // TRIBUTE altar between the entrance and the Queen
    scene.add(box(1.6, 0.9, 1.6, mat(0x2b2422, 1), 30.2, 0.45, 3));
    const holder = new THREE.Group();
    holder.position.set(30.2, 0.9, 3);
    scene.add(holder);
    this.tribute = new Stack(holder, gridLayout(2, 2, 0.5, 0.5, 0.0), 24);
    const pad = makePad(2.4, 2.4, 'TRIBUTE', '#ffd166');
    pad.position.set(27.6, 0.04, 3);
    scene.add(pad);
    this.tributeZone = new Zone(27.6, 3, 1.2, 1.2);
    this.blockers.push({ minX: 29.3, maxX: 31.1, minZ: 2.1, maxZ: 3.9 });

    // The vault the colony fills with Fire Crystals
    this.vault = new ResourcePile(scene, 30, 10.5, flyers, 'crystal', 'vault');
    this.vault.spawnEvery = () => (this.favor > 0.02 ? C.crystalEvery : Infinity);
    this.blockers.push({ minX: 28.6, maxX: 31.4, minZ: 7.7, maxZ: 9.3 });

    this.sign.sprite.position.set(35.5, 8.2, 3);
    scene.add(this.sign.sprite);

    // Giant fire ants bustling around (your colony's ancient cousins!)
    for (let i = 0; i < 4; i++) {
      const m = spawnCreature(i === 0 ? 'major' : 'worker', i === 0 ? 2.8 : 2.2);
      if (!m) continue;
      m.root.position.set(rand(26, 30), 0, rand(-4, 12));
      scene.add(m.root);
      this.ants.push({ m, to: m.root.position.clone(), rest: rand(0, 2) });
    }
    this.draw();
  }

  private draw() {
    const pct = Math.round(this.favor * 10) * 10;
    const txt = this.favor > 0.02 ? `👑 FIRE QUEEN · 😊 Pleased ${pct}%` : '👑 FIRE QUEEN · 😠 Bring 💎 tribute!';
    if (txt === this.shown) return;
    this.shown = txt;
    this.sign.setText(txt, this.favor > 0.02 ? '#ffd166' : '#ff6b6b');
  }

  update(dt: number) {
    this.favor = Math.max(0, this.favor - dt / C.favorDrain);
    this.vault.update(dt);
    // The Queen accepts one gem at a time
    this.eatT += dt;
    if (this.eatT >= 0.6) {
      this.eatT = 0;
      if (this.favor < 0.97 && this.tribute.canPop()) {
        const it = this.tribute.pop()!;
        this.flyers.fly(it.mesh, () => this.mouth, () => {
          it.mesh.removeFromParent();
          this.favor = Math.min(1, this.favor + C.favorPerGem);
          if (this.queen) {
            this.queen.bob.scale.setScalar(1.04);
            setTimeout(() => this.queen?.bob.scale.setScalar(1), 160);
          }
        }, 0.35, 1.2);
      }
    }
    if (this.queen) animateCreature(this.queen, dt, 0);
    // The ants scurry between dig spots (faster when the Queen is pleased)
    const pace = this.favor > 0.02 ? 3.2 : 1.4;
    for (const a of this.ants) {
      if (a.rest > 0) {
        a.rest -= dt;
        animateCreature(a.m, dt, 0);
        if (a.rest <= 0) a.to.set(rand(26, 30.5), 0, rand(-4.5, 13));
        continue;
      }
      if (stepTo(a.m, a.to, pace, dt)) a.rest = rand(0.5, 2.5);
    }
    this.draw();
  }
}

// ----------------------------------------------------------------------------
// 🚁 HELI TOURS: tourists wait by the tour helicopter; launch a tour run.
// ----------------------------------------------------------------------------
class HeliTours {
  waiting = 0;
  zone = new Zone(4, 27, 1.2, 1.2);
  pad: CashPad;
  hasPilot = false;
  /** Seconds until the helicopter is back (0 = parked). */
  away = 0;
  blocker: Blocker = { minX: TOUR_HELI.x - 2.8, maxX: TOUR_HELI.x + 7.4, minZ: TOUR_HELI.z - 1.4, maxZ: TOUR_HELI.z + 1.4 };
  onAutoTrip: (n: number) => void = () => {};
  private heli: { group: THREE.Group; spinners: THREE.Object3D[] };
  private label = new TextSprite(0.7, '#ffffff');
  private figures: CreatureModel[] = [];
  private pilotT = 0;
  private trip = C.tourTime;
  private shown = '';

  constructor(scene: THREE.Scene, private erupting: () => boolean) {
    // A painted H pad under the tour helicopter
    const hpad = new THREE.Mesh(new THREE.CircleGeometry(4.2, 28), mat(0x3a3f45, 0.8));
    hpad.rotation.x = -Math.PI / 2;
    hpad.position.set(TOUR_HELI.x + 1, 0.03, TOUR_HELI.z);
    hpad.receiveShadow = true;
    scene.add(hpad);
    this.heli = buildAircraftModel('heli');
    this.heli.group.position.copy(TOUR_HELI);
    scene.add(this.heli.group);
    const pad = makePad(2.4, 2.4, 'BOARD', '#4fe3ff');
    pad.position.set(4, 0.05, 27);
    scene.add(pad);
    this.pad = new CashPad(scene, 8.5, 31);
    const sign = new TextSprite(0.8, '#4fe3ff');
    sign.setText('🚁 VOLCANO HELI TOURS');
    sign.sprite.position.set(TOUR_HELI.x + 1, 6.4, TOUR_HELI.z);
    scene.add(sign.sprite);
    this.label.sprite.position.set(5.5, 3.8, 27);
    scene.add(this.label.sprite);
    for (let i = 0; i < 3; i++) {
      const m = person(TOURIST_KINDS[i % TOURIST_KINDS.length]);
      noShadow(m.root);
      m.root.position.set(6.2 + i * 1.4, 0, 27 + (i % 2 ? 0.7 : -0.7));
      m.root.rotation.y = -Math.PI / 2; // facing the BOARD pad
      m.root.visible = false;
      scene.add(m.root);
      this.figures.push(m);
    }
    this.draw();
  }

  add(n: number) {
    this.waiting = Math.min(C.tourMax, this.waiting + n);
  }

  /** Everyone boards: the helicopter takes off on a tour (or an evacuation). */
  take(trip = C.tourTime) {
    const n = this.waiting;
    this.waiting = 0;
    this.away = this.trip = trip;
    return n;
  }

  get ready() {
    return this.away <= 0 && this.waiting >= C.tourMin && !this.erupting();
  }

  private draw() {
    const txt = this.erupting() && this.waiting > 0 && this.away <= 0 ? `🌋 EVACUATE! Stand on BOARD · 🧍 ${this.waiting}`
      : this.away > 0 ? `🚁 On tour · back in ${Math.ceil(this.away)}s · 🧍 ${this.waiting}`
        : this.erupting() ? '🌋 No tours during an eruption'
          : `🧍 ${this.waiting} waiting${this.waiting < C.tourMin ? ` (need ${C.tourMin})` : ''}`;
    if (txt === this.shown) return;
    this.shown = txt;
    this.label.setText(txt, txt.startsWith('🌋 EVAC') ? '#ff6b6b' : '#ffffff');
    this.figures.forEach((m, i) => (m.root.visible = i < Math.min(3, Math.ceil(this.waiting / 6))));
  }

  update(dt: number) {
    if (this.away > 0) this.away = Math.max(0, this.away - dt);
    // Away: lift off, fly north toward the crater and back
    const k = this.away > 0 ? Math.min(1, (this.trip - this.away) / 4, this.away / 4) : 0;
    const g = this.heli.group.position;
    g.set(TOUR_HELI.x, k * 22, TOUR_HELI.z - k * 70);
    this.heli.group.visible = k < 0.98;
    this.heli.group.rotation.z = this.away > 0 ? -0.12 * Math.min(1, k * 4) : 0;
    for (const s of this.heli.spinners) {
      if (s.userData.tailRotor) s.rotation.z += dt * 30;
      else s.rotation.y += dt * (this.away > 0 ? 28 : 3);
    }
    for (const m of this.figures) if (m.root.visible) animateCreature(m, dt, 0);
    if (this.hasPilot) {
      this.pilotT += dt;
      if (this.pilotT >= C.pilotEvery && this.ready) {
        this.pilotT = 0;
        this.onAutoTrip(this.take());
      }
    }
    this.draw();
  }
}

// ----------------------------------------------------------------------------
// Tourists arriving by helicopter (lands straight down on the helipad).
// ----------------------------------------------------------------------------
class Arrivals {
  onLand: (n: number) => void = () => {};
  private heli: { group: THREE.Group; spinners: THREE.Object3D[] };
  private t = 0;
  private state: 'away' | 'landing' | 'parked' | 'leaving' = 'away';
  private walkers: { m: CreatureModel; to: THREE.Vector3[] }[] = [];

  constructor(private scene: THREE.Scene, private erupting: () => boolean) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(4.6, 28), mat(0x3a3f45, 0.8));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(HELIPAD.x, 0.03, HELIPAD.z);
    pad.receiveShadow = true;
    scene.add(pad);
    const h = makePad(3.2, 3.2, 'H', '#ffd166');
    h.position.set(HELIPAD.x, 0.05, HELIPAD.z);
    scene.add(h);
    this.heli = buildAircraftModel('heli');
    this.heli.group.visible = false;
    scene.add(this.heli.group);
  }

  update(dt: number) {
    for (const s of this.heli.spinners) {
      if (s.userData.tailRotor) s.rotation.z += dt * 30;
      else s.rotation.y += dt * (this.state === 'parked' ? 6 : 28);
    }
    this.t += dt;
    const g = this.heli.group.position;
    if (this.state === 'away' && this.t >= C.arrivalEvery && !this.erupting()) {
      this.state = 'landing';
      this.t = 0;
      this.heli.group.visible = true;
    } else if (this.state === 'landing') {
      const u = Math.min(1, this.t / 4.5);
      const k = (1 - u) * (1 - u);
      g.set(HELIPAD.x + 50 * k, 30 * k, HELIPAD.z + 30 * k);
      if (u >= 1) {
        this.state = 'parked';
        this.t = 0;
        const n = Math.round(rand(C.arrivalTourists[0], C.arrivalTourists[1]));
        this.onLand(n);
        // A couple wander off to look around (scenery)
        for (let i = 0; i < Math.min(2, n); i++) {
          const m = person(TOURIST_KINDS[Math.floor(Math.random() * TOURIST_KINDS.length)]);
          m.root.position.set(HELIPAD.x - 3 + i, 0, HELIPAD.z - 2);
          this.scene.add(m.root);
          const goals = [new THREE.Vector3(4, 0, 22), new THREE.Vector3(-4, 0, 22), new THREE.Vector3(18, 0, 18), new THREE.Vector3(0, 0, 8)];
          this.walkers.push({ m, to: [new THREE.Vector3(HELIPAD.x - 6, 0, HELIPAD.z - 3), goals[Math.floor(Math.random() * goals.length)]] });
        }
      }
    } else if (this.state === 'parked' && this.t > 3.5) {
      this.state = 'leaving';
      this.t = 0;
    } else if (this.state === 'leaving') {
      const u = Math.min(1, this.t / 4.5);
      g.set(HELIPAD.x + 50 * u * u, 30 * u, HELIPAD.z + 30 * u * u);
      if (u >= 1) {
        this.state = 'away';
        this.t = 0;
        this.heli.group.visible = false;
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

// ----------------------------------------------------------------------------
// A lava bomb (eruptions): a red ring shows where it'll land, then it falls.
// ----------------------------------------------------------------------------
interface Bomb {
  at: THREE.Vector3;
  t: number;
  ring: THREE.Mesh;
  rock: THREE.Mesh;
  hit: boolean;
}
const BOMB_FALL = 1.35; // seconds from the warning ring to impact

// ============================================================================
export class VolcanoWorld {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 700);
  flyers = new Flyers(this.scene);
  player: Player;
  cashPads: CashPad[] = [];
  tiles: UnlockTile[] = [];
  workers: Worker[] = [];
  active = false;
  /** Set by main.ts: launch a heli tour gate run with `count` tourists. */
  onTour: (count: number) => void = () => {};
  /** Set by main.ts: you stepped on the ERUPT altar (prestige). */
  onErupt: () => void = () => {};

  // Eruptions
  phase: 'calm' | 'rumble' | 'erupt' = 'calm';
  private phaseLeft = rand(C.eruptionEvery[0], C.eruptionEvery[1]) * 0.6; // the first one comes a bit sooner
  private bombs: Bomb[] = [];
  private bombT = 0;
  private flowMeshes: THREE.Mesh[] = [];
  private evacuated = false;
  private shake = 0;

  // Heat + magma
  heat = 0;
  private burnT = 0;
  private suit = false;

  private piles: ResourcePile[] = [];
  private forge: Bakery;
  private gemShop: Desk;
  private plant: GeoPlant | null = null;
  private vent: ResourcePile | null = null;
  private mist: { zone: Zone; puffs: THREE.Mesh[] } | null = null;
  private tours: HeliTours | null = null;
  private lair: RexLair | null = null;
  private supply: ResourcePile | null = null;
  private kingdom: Kingdom | null = null;
  private exchange: Desk | null = null;
  private treasurer: Assistant | null = null;
  private eruptZone: Zone | null = null;
  private eruptArmed = true;
  private gapBlocker: Blocker = { minX: HOLLOW.minX - 0.8, maxX: HOLLOW.minX + 0.8, minZ: HOLLOW_GAP.from, maxZ: HOLLOW_GAP.to };
  private gapRocks = new THREE.Group();
  private arrivals: Arrivals;
  private trash: TrashBin;
  private blockers: Blocker[] = [];
  private timers = new Map<object, number>();
  private lavaTex: THREE.CanvasTexture;
  private oceanTex: THREE.CanvasTexture;
  private smoke: THREE.Mesh[] = [];
  private fountain: THREE.Mesh[] = [];
  private sky = new THREE.Color(0x9b8577);
  private sun = new THREE.DirectionalLight(0xffd2a8, 2.5);
  private camOffset = new THREE.Vector3(0, 20, 17.5);
  private thirdFov = 56;
  private intro = 1;
  private zoneName = '';
  private hintShown = '';
  private launchShown = false;

  constructor(private hud: Hud, private sfx: Sfx, private save: SaveData, private progress: Progress) {
    [this.lavaTex, this.oceanTex] = this.buildScene();
    this.trash = new TrashBin(this.scene, -32, 22);
    this.arrivals = new Arrivals(this.scene, () => this.erupting);
    this.arrivals.onLand = (n) => this.tours?.add(n);

    // You fly in with the tourists (Jack's model, unnamed here)
    const jack = person('h-jack');
    jack.root.position.set(2, 0, 20);
    this.player = new Player(this.scene, { model: jack, spot: handsSpot(jack) });

    // 💎 The mine: two obsidian outcrops, the forge, the Gem Shop
    for (const [x, z] of [[-26, 16], [-31, 6]]) {
      const pile = new ResourcePile(this.scene, x, z, this.flyers, 'obsidian', 'rock');
      pile.spawnEvery = () => C.rockEvery;
      this.piles.push(pile);
      this.blockers.push({ minX: x - 1.5, maxX: x + 1.5, minZ: z - 3.4, maxZ: z - 0.9 });
    }
    this.forge = new Bakery(this.scene, -16, 6, this.flyers, FORGE);
    this.blockers.push(this.forge.blocker);
    const gemPad = new CashPad(this.scene, -8.4, 20.6);
    this.cashPads.push(gemPad);
    this.gemShop = this.addDesk(-6, 16, gemPad, '💎 GEM SHOP', 'gem', 0x3b2a6a, 0xff7a1a, C.shopInterval);

    for (const def of VOLCANO_UNLOCKS) this.tiles.push(new UnlockTile(this.scene, def, save.paid[def.id] ?? 0));
    for (const id of save.unlocked) this.applyUnlock(id, false);
    this.refreshTiles(false);
    this.camera.position.copy(this.player.pos).add(this.camOffset);
    this.camera.lookAt(this.player.pos);
  }

  get erupting() {
    return this.phase === 'erupt';
  }

  // --------------------------------------------------------------------------
  // The volcano island: ash beach, basalt ground, the lava lake, the mountain
  // --------------------------------------------------------------------------
  private buildScene(): [THREE.CanvasTexture, THREE.CanvasTexture] {
    const s = this.scene;
    s.background = this.sky.clone();
    s.fog = new THREE.Fog(this.sky.getHex(), 120, 420);
    s.add(new THREE.HemisphereLight(0xffe6cc, 0x3a2a20, 1.35));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // A dark, ashy sea
    const oc = document.createElement('canvas');
    oc.width = oc.height = 256;
    const og = oc.getContext('2d')!;
    og.fillStyle = '#245a6e';
    og.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 140; i++) {
      og.fillStyle = `rgba(255,255,255,${rand(0.04, 0.16)})`;
      og.fillRect(rand(0, 256), rand(0, 256), rand(6, 24), rand(1.5, 3));
    }
    const oceanTex = new THREE.CanvasTexture(oc);
    oceanTex.colorSpace = THREE.SRGBColorSpace;
    oceanTex.wrapS = oceanTex.wrapT = THREE.RepeatWrapping;
    oceanTex.repeat.set(40, 40);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: oceanTex, roughness: 0.3, metalness: 0.1 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.45;
    s.add(ocean);
    s.add(ellipse(LAND.rx + 4, LAND.rz + 4, mat(0x34302f, 1), -0.08)); // black sand beach
    // Basalt ground, speckled with dark cinders and pale ash
    const gc = document.createElement('canvas');
    gc.width = gc.height = 256;
    const gg = gc.getContext('2d')!;
    gg.fillStyle = '#5a4d46';
    gg.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      gg.fillStyle = Math.random() < 0.6 ? `rgba(30,24,22,${rand(0.15, 0.45)})` : `rgba(160,146,136,${rand(0.1, 0.3)})`;
      const r = rand(1, 4.5);
      gg.beginPath();
      gg.arc(rand(0, 256), rand(0, 256), r, 0, Math.PI * 2);
      gg.fill();
    }
    const groundTex = new THREE.CanvasTexture(gc);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(10, 10);
    const ground = ellipse(LAND.rx, LAND.rz, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }), 0);
    // ShapeGeometry UVs are in world units: scale them down so the texture tiles nicely
    const uv = ground.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 9, uv.getY(i) / 9);
    groundTex.repeat.set(1, 1);
    s.add(ground);
    // Ash paths
    const path = mat(0x7a6c63, 1);
    for (const [x, z, w, d, r] of [[0, 14, 3, 30, 0], [-10, 8, 3, 26, 1.2], [12, 6, 3, 26, -1.2], [0, -6, 3, 20, 0], [14, 22, 3, 22, 1.57]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), path);
      p.rotation.set(-Math.PI / 2, 0, r);
      p.position.set(x, 0.015, z);
      p.receiveShadow = true;
      s.add(p);
    }

    // 🔥 The lava lake (a scrolling glowing texture, with a rocky rim)
    const lc = document.createElement('canvas');
    lc.width = lc.height = 128;
    const lg = lc.getContext('2d')!;
    lg.fillStyle = '#ff5a12';
    lg.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) {
      lg.fillStyle = Math.random() < 0.5 ? `rgba(255,214,90,${rand(0.3, 0.8)})` : `rgba(60,14,6,${rand(0.3, 0.7)})`;
      lg.beginPath();
      lg.ellipse(rand(0, 128), rand(0, 128), rand(3, 14), rand(2, 8), rand(0, 3), 0, Math.PI * 2);
      lg.fill();
    }
    const lavaTex = new THREE.CanvasTexture(lc);
    lavaTex.colorSpace = THREE.SRGBColorSpace;
    lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping;
    lavaTex.repeat.set(3, 3);
    const lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex });
    const lx = (LAKE.minX + LAKE.maxX) / 2;
    const lz = (LAKE.minZ + LAKE.maxZ) / 2;
    s.add(ellipse((LAKE.maxX - LAKE.minX) / 2 + 1.2, (LAKE.maxZ - LAKE.minZ) / 2 + 1.2, mat(0x221c1a, 1), 0.02, lx, lz));
    s.add(ellipse((LAKE.maxX - LAKE.minX) / 2, (LAKE.maxZ - LAKE.minZ) / 2, lavaMat, 0.05, lx, lz));
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.8, 1.6)), mat(0x2a2422, 0.95));
      r.position.set(lx + Math.cos(a) * ((LAKE.maxX - LAKE.minX) / 2 + 1.4), 0.3, lz + Math.sin(a) * ((LAKE.maxZ - LAKE.minZ) / 2 + 1.4));
      r.castShadow = true;
      s.add(r);
    }
    const lakeGlow = new THREE.PointLight(0xff6a1a, 60, 28, 1.6);
    lakeGlow.position.set(lx, 4, lz);
    s.add(lakeGlow);
    this.blockers.push({ minX: LAKE.minX - 0.6, maxX: LAKE.maxX + 0.6, minZ: LAKE.minZ - 0.6, maxZ: LAKE.maxZ + 0.6 });
    const warn = new TextSprite(0.7, '#ff9f43');
    warn.setText('🔥 LAVA LAKE · HOT!');
    warn.sprite.position.set(lx, 4.5, LAKE.maxZ + 1);
    s.add(warn.sprite);

    // Lava flows (only show during eruptions)
    for (const f of FLOWS) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(f.maxX - f.minX, f.maxZ - f.minZ), lavaMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((f.minX + f.maxX) / 2, 0.04, (f.minZ + f.maxZ) / 2);
      m.visible = false;
      s.add(m);
      this.flowMeshes.push(m);
    }

    // 🌋 Mount Anthill, looming over the north shore
    const M = MOUNT;
    const mountain = new THREE.Mesh(new THREE.CylinderGeometry(M.top, M.base, M.h, 40, 1, true), mat(0x3a2f2b, 1));
    mountain.position.set(0, M.h / 2 - 0.5, M.z);
    s.add(mountain);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(M.top, 24), new THREE.MeshBasicMaterial({ color: 0xff5a12, fog: false }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(0, M.h - 0.6, M.z);
    s.add(crater);
    const craterGlow = new THREE.PointLight(0xff6a1a, 400, 120, 1.4);
    craterGlow.position.set(0, M.h + 6, M.z);
    s.add(craterGlow);
    // Glowing lava streams down the slopes
    const streamMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, fog: false });
    for (const a of [-0.5, 0.15, 0.6]) {
      // A flat ribbon tipped back to lie on the slope (~47°), then turned around the mountain
      const slope = Math.hypot(M.h, M.base - M.top);
      const st = new THREE.Mesh(new THREE.PlaneGeometry(2.4, slope * 0.92), streamMat);
      const mid = (M.base + M.top) / 2 + 0.6;
      st.position.set(Math.sin(a) * mid, M.h / 2, M.z + Math.cos(a) * mid);
      st.rotation.order = 'YXZ';
      st.rotation.set(-(Math.PI / 2 - Math.atan2(M.h, M.base - M.top)), a, 0);
      s.add(st);
    }
    for (let i = 0; i < 7; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a5452, transparent: true, opacity: 0.55, roughness: 1 }));
      puff.position.set(0, MOUNT.h + 6 + i * 8, MOUNT.z);
      s.add(puff);
      this.smoke.push(puff);
    }
    for (let i = 0; i < 10; i++) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(rand(1.2, 2.4), 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false }));
      blob.visible = false;
      s.add(blob);
      this.fountain.push(blob);
    }

    // Charred dead trees + scattered rocks + steam vents
    const charred = mat(0x241e1c, 1);
    for (const [x, z] of [[-38, -4], [-36, 22], [38, 20], [-20, 30], [-40, 10], [16, 32], [-14, -30], [40, -12]]) {
      const trunk = box(0.5, rand(4, 7), 0.5, charred, x, 2.5, z);
      s.add(trunk);
      for (let i = 0; i < 3; i++) {
        const br = box(0.18, rand(1.5, 2.6), 0.18, charred, x + rand(-0.6, 0.6), rand(3, 5.5), z + rand(-0.4, 0.4));
        br.rotation.z = rand(-1, 1);
        s.add(br);
      }
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rand(-0.1, 0.1);
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.7, 1.8)), mat(0x332b28, 0.95));
      r.position.set(Math.cos(a) * (LAND.rx - 1.5), 0.2, Math.sin(a) * (LAND.rz - 1.5));
      r.castShadow = true;
      s.add(r);
    }
    const welcome = new TextSprite(1.1, '#ffb347');
    welcome.setText('🌋 WELCOME TO MOUNT ANTHILL');
    welcome.sprite.position.set(HELIPAD.x - 4, 6.5, HELIPAD.z - 6);
    s.add(welcome.sprite);

    // The Fire Ant Kingdom's hollow: a ring of rock walls (boulders block the
    // entrance until you buy it)
    const rock = mat(0x2a2422, 0.95);
    const h = HOLLOW;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(h.maxX - h.minX, h.maxZ - h.minZ), mat(0x2e2420, 1));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((h.minX + h.maxX) / 2, 0.025, (h.minZ + h.maxZ) / 2);
    floor.receiveShadow = true;
    s.add(floor);
    for (let i = 0; i < 9; i++) {
      // Glowing cracks in the floor
      const c = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.12, 0.22), rand(1.2, 2.4)), new THREE.MeshBasicMaterial({ color: 0xff5a12 }));
      c.rotation.set(-Math.PI / 2, 0, rand(0, 3));
      c.position.set(rand(h.minX + 3, h.maxX - 3), 0.03, rand(h.minZ + 3, h.maxZ - 3));
      s.add(c);
    }
    const wallSeg = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      s.add(box(x1 === x2 ? 1.2 : len + 1.2, 2.4, x1 === x2 ? len + 1.2 : 1.2, rock, (x1 + x2) / 2, 1.2, (z1 + z2) / 2));
      this.blockers.push({ minX: Math.min(x1, x2) - 0.6, maxX: Math.max(x1, x2) + 0.6, minZ: Math.min(z1, z2) - 0.6, maxZ: Math.max(z1, z2) + 0.6 });
    };
    wallSeg(h.minX, h.minZ, h.maxX, h.minZ);
    wallSeg(h.maxX, h.minZ, h.maxX, h.maxZ);
    wallSeg(h.minX, h.maxZ, h.maxX, h.maxZ);
    wallSeg(h.minX, h.minZ, h.minX, HOLLOW_GAP.from);
    wallSeg(h.minX, HOLLOW_GAP.to, h.minX, h.maxZ);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1.3), rock);
      b.position.set(h.minX + rand(-0.4, 0.4), 1, HOLLOW_GAP.from + 0.8 + i * 1.5);
      b.castShadow = true;
      this.gapRocks.add(b);
    }
    s.add(this.gapRocks);
    this.blockers.push(this.gapBlocker);
    const ksign = new TextSprite(0.8, '#ff9f43');
    ksign.setText('🐜 FIRE ANT KINGDOM');
    ksign.sprite.position.set(h.minX - 0.5, 5.2, (HOLLOW_GAP.from + HOLLOW_GAP.to) / 2);
    s.add(ksign.sprite);
    return [lavaTex, oceanTex];
  }

  private addDesk(x: number, z: number, pad: CashPad, label: string, sells: ItemType, color: number, awning: number, interval: number) {
    const desk = new Desk(this.scene, x, z, this.flyers, pad, null, {
      mode: 'cafe', sells, awning, label, color, kinds: TOURIST_KINDS, interval, queueMax: C.queueMax, serve: C.serve,
      // Tourists walk over from the helipad...
      entry: [new THREE.Vector3(HELIPAD.x - 4, 0, HELIPAD.z - 2), new THREE.Vector3(x + 9, 0, z + 6)],
      // ...and back to it afterwards
      exit: (from) => [new THREE.Vector3(from.x, 0, z + 4.5), new THREE.Vector3(x + 9, 0, z + 9), new THREE.Vector3(HELIPAD.x - 4, 0, HELIPAD.z - 2)],
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

  /** A giant fire ant hauler (with an orange hard hat). */
  private antHauler(x: number, z: number, route: () => Route, animate: boolean) {
    const m = spawnCreature('worker', 2.4) ?? makeAnt(0x8e2f14);
    addHat(m, 0xff7a1a);
    titleTag(m, '🔥 HAULER', TITLE.human);
    const w = new Worker(this.scene, x, z, route, { color: 0 }, 2.4, { model: m, spot: backSpot(m), carry: C.crewCarry, speed: C.crewSpeed });
    this.workers.push(w);
    if (animate) this.flyers.grow(m.root);
  }

  /** The tamed Lava Rex: hauls 40 at a time. Magma for the plant when it's low, else obsidian. */
  private spawnTamedRex(animate: boolean) {
    const rex = makeRex(9, true);
    const fullest = (piles: ResourcePile[]) => piles.reduce((a, b) => (b.stack.count > a.stack.count ? b : a));
    const w = new Worker(this.scene, PEN.maxX + 5, -16, () => {
      if (this.plant && this.vent && this.plant.power < 0.75 && this.vent.stack.count >= 4) {
        return { src: this.vent.stack, srcZone: this.vent.zone, dst: this.plant.input, dstZone: this.plant.inZone };
      }
      const p = fullest(this.piles);
      return { src: p.stack, srcZone: p.zone, dst: this.forge.input, dstZone: this.forge.inZone };
    }, { color: 0 }, 9, { model: rex, spot: { y0: rex.height * 0.92, z0: 0 }, carry: C.rexCarry, speed: C.rexSpeed });
    // Its load rides on its back in neat layers (not one tall tower)
    w.stack.layout = gridLayout(2, 3, 0.55, 0.55, rex.height * 0.92, 0, -0.2);
    this.workers.push(w);
    titleTag(rex, '🦖 REX · HAULER', TITLE.human);
    if (animate) {
      this.flyers.grow(rex.root);
      roar(rex);
    }
  }

  private applyUnlock(id: string, animate: boolean) {
    if (!id.startsWith('v4-')) return;
    const grow = (o: THREE.Object3D) => animate && this.flyers.grow(o);
    const fullest = (piles: ResourcePile[]) => piles.reduce((a, b) => (b.stack.count > a.stack.count ? b : a));
    switch (id) {
      case 'v4-clerk':
        this.gemShop.hireStaff(person('h-crew3'), animate, '🛍️ CLERK');
        break;
      case 'v4-miner':
        this.crew('⛏️ MINER', 'h-crew1', -22, 12, () => {
          const p = fullest(this.piles);
          return { src: p.stack, srcZone: p.zone, dst: this.forge.input, dstZone: this.forge.inZone };
        }, animate);
        break;
      case 'v4-runner':
        this.crew('🏃 RUNNER', 'h-ember', -10, 12, () => ({ src: this.forge.output, srcZone: this.forge.outZone, dst: this.gemShop.shelf!, dstZone: this.gemShop.staffZone }), animate);
        break;
      case 'v4-plant': {
        this.plant = new GeoPlant(this.scene, this.flyers, () => this.progress.cashMult);
        this.cashPads.push(this.plant.pad);
        this.blockers.push(this.plant.blocker, { minX: 4.3, maxX: 6.7, minZ: -17.8, maxZ: -15.4 });
        // The lava vent spits out magma (twice as fast during an eruption!)
        this.vent = new ResourcePile(this.scene, 15, -12, this.flyers, 'magma', 'vent');
        this.vent.spawnEvery = () => (this.erupting ? C.magmaEvery / 2 : C.magmaEvery);
        this.blockers.push({ minX: 13.4, maxX: 16.6, minZ: -15.6, maxZ: -12.6 });
        // ❄️ MIST: misting fans to cool off
        const zone = new Zone(3, -4, 1.4, 1.4);
        const pad = makePad(2.8, 2.8, 'MIST', '#9ee7ff');
        pad.position.set(3, 0.04, -4);
        this.scene.add(pad);
        const puffs: THREE.Mesh[] = [];
        for (const sx of [-1.7, 1.7]) {
          this.scene.add(box(0.2, 3.2, 0.2, mat(0xc9ccd1, 0.4, 0.5), 3 + sx, 1.6, -4));
          this.scene.add(box(0.6, 0.6, 0.3, mat(0x4fa3d1, 0.4), 3 + sx, 3.1, -4));
          for (let i = 0; i < 3; i++) {
            const p = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshStandardMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.5 }));
            noShadow(p);
            p.position.set(3 + sx, 3, -4);
            this.scene.add(p);
            puffs.push(p);
          }
        }
        this.mist = { zone, puffs };
        [this.plant.pad.group, this.vent.group].forEach(grow);
        if (animate) this.hud.banner('⚡ Geothermal Plant online!', 'Carry 🔥 magma from the vent to MAGMA IN. Powered = +25% on ALL cash!', 4800);
        break;
      }
      case 'v4-suit':
        this.suit = true;
        if (animate) this.hud.banner('🦺 Heat Suit', 'You heat up half as fast near the lava', 3200);
        break;
      case 'v4-heli': {
        this.tours = new HeliTours(this.scene, () => this.erupting);
        this.cashPads.push(this.tours.pad);
        this.blockers.push(this.tours.blocker);
        this.tours.add(8);
        this.tours.onAutoTrip = (n) => this.payTrip(n, 1);
        if (animate) this.hud.banner('🚁 Heli Tours open!', 'Tourists wait by the helicopter: stand on BOARD to fly a tour', 4200);
        break;
      }
      case 'v4-pilot': {
        if (this.tours) this.tours.hasPilot = true;
        const m = person('h-director');
        m.root.position.set(TOUR_HELI.x - 4.5, 0, TOUR_HELI.z - 2);
        m.root.rotation.y = Math.PI / 4;
        titleTag(m, '🧑‍✈️ PILOT', TITLE.human);
        this.scene.add(m.root);
        grow(m.root);
        if (animate) this.hud.banner('🧑‍✈️ Tour Pilot hired', 'Flies full tours by himself (steady 1x), and evacuates in eruptions', 3800);
        break;
      }
      case 'v4-lair': {
        const tamed = this.save.unlocked.includes('v4-rex-tamed');
        this.lair = new RexLair(this.scene, this.flyers, this.save, tamed);
        this.blockers.push(...this.lair.blockers);
        this.lair.onEvent = (what) => {
          if (what === 'tamed') {
            if (!this.save.unlocked.includes('v4-rex-tamed')) this.save.unlocked.push('v4-rex-tamed');
            delete this.save.paid['v4-rex-tame'];
            this.lair!.release();
            this.spawnTamedRex(true);
            this.sfx.unlocked();
            if (this.active) this.hud.banner('🦖 LAVA REX TAMED!', 'It hauls 40 at a time: magma for the plant, obsidian for the forge', 5000);
          } else if (this.active) {
            const p = this.lair!.rex?.root.position;
            if (p) this.hud.floatAt(p.clone().setY(6), this.camera, '🦖 ROAAAR!', 'big bad');
          }
        };
        if (tamed) this.spawnTamedRex(false);
        // Dino food for taming it
        this.supply = new ResourcePile(this.scene, -8, -7, this.flyers, 'meat', 'supply');
        this.supply.spawnEvery = () => 0.9;
        this.blockers.push({ minX: -9.3, maxX: -6.7, minZ: -9.9, maxZ: -8.1 });
        grow(this.supply.group);
        if (animate) this.hud.banner('🦖 The Lava Rex!', `Carry 🍖 from the supply drop to TAME. ${C.rexTameMeat} meat and it works for you!`, 4800);
        break;
      }
      case 'v4-kingdom': {
        this.kingdom = new Kingdom(this.scene, this.flyers);
        this.blockers.push(...this.kingdom.blockers);
        this.gapRocks.visible = false;
        const gi = this.blockers.indexOf(this.gapBlocker);
        if (gi >= 0) this.blockers.splice(gi, 1);
        const pad = new CashPad(this.scene, 11.6, 12.6);
        this.cashPads.push(pad);
        this.exchange = this.addDesk(14, 8, pad, '🔶 CRYSTAL EXCHANGE', 'crystal', 0x7a2a12, 0xffd166, C.exchangeInterval);
        // Its tourists come round from the helipad on the east side
        this.exchange.opts.entry = [new THREE.Vector3(HELIPAD.x - 4, 0, HELIPAD.z - 2), new THREE.Vector3(22, 0, 16)];
        this.exchange.opts.exit = (from) => [new THREE.Vector3(from.x, 0, 12.5), new THREE.Vector3(22, 0, 16), new THREE.Vector3(HELIPAD.x - 4, 0, HELIPAD.z - 2)];
        [this.exchange.group, pad.group].forEach(grow);
        if (animate) this.hud.banner('🐜 The Fire Ant Kingdom!', 'Giant fire ants: your colony\'s ancient cousins! Bring the Queen 💎 tribute for 🔶 Fire Crystals', 5500);
        break;
      }
      case 'v4-haulers':
        // One carries crystals to the exchange, one brings gems to the Queen
        this.antHauler(26, 8, () => ({ src: this.kingdom!.vault.stack, srcZone: this.kingdom!.vault.zone, dst: this.exchange!.shelf!, dstZone: this.exchange!.staffZone }), animate);
        this.antHauler(22, 3, () => ({ src: this.forge.output, srcZone: this.forge.outZone, dst: this.kingdom!.tribute, dstZone: this.kingdom!.tributeZone }), animate);
        if (animate) this.hud.banner('🔥 Fire Ant Haulers', 'Crystals -> the exchange, and gems -> the Queen\'s tribute', 3800);
        break;
      case 'v4-trader':
        this.exchange?.hireStaff(person('h-balance'), animate, '💱 TRADER');
        break;
      case 'v4-treasurer': {
        // Your personal assistant (Sarah's model, unnamed here) collects the cash from every pad
        const m = person('h-sarah');
        m.root.position.set(-2, 0, 8);
        this.scene.add(m.root);
        grow(m.root);
        const tag = new TextSprite(TITLE.human, '#ffd166');
        tag.setText('💼 ASSISTANT');
        this.scene.add(tag.sprite);
        this.treasurer = new Assistant(m, new THREE.Vector3(-2, 0, 8), tag, (v) => this.addCash(v));
        this.treasurer.speed = 5.5;
        if (animate) this.hud.banner('👩‍💼 Personal Assistant', 'She collects the cash from every pad for you', 3500);
        break;
      }
      case 'v4-eruption': {
        // The ERUPT altar at the foot of the volcano
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.5, 8, 20), mat(0x2a2422, 0.95));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(ERUPT.x, 0.3, ERUPT.z);
        this.scene.add(ring);
        this.scene.add(ellipse(2.1, 2.1, hot(0x7a2008, 0xff5a12, 1.6), 0.06, ERUPT.x, ERUPT.z));
        const pad = makePad(3, 3, 'ERUPT', '#ff6b6b');
        pad.position.set(ERUPT.x, 0.08, ERUPT.z);
        this.scene.add(pad);
        const sign = new TextSprite(0.9, '#ff6b6b');
        sign.setText('🌋 THE BIG ERUPTION · stand here');
        sign.sprite.position.set(ERUPT.x, 4.5, ERUPT.z);
        this.scene.add(sign.sprite);
        this.eruptZone = new Zone(ERUPT.x, ERUPT.z, 1.5, 1.5);
        if (animate) this.hud.banner('🌋 The volcano is ready to blow!', 'Stand on ERUPT when you want to prestige for 💎 Obsidian Shards', 5000);
        break;
      }
    }
  }

  private unlock(tile: UnlockTile) {
    const id = tile.def.id;
    this.save.unlocked.push(id);
    delete this.save.paid[id];
    tile.mesh.visible = false;
    this.applyUnlock(id, true);
    this.progress.addXp(tile.def.cost * CONFIG.xp.unlockFraction * 0.3);
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

  /** Bills on the tour pad for a tour the pilot flew (or an evacuation). */
  private payTrip(n: number, mult: number) {
    if (!this.tours || n <= 0) return;
    const value = n * ITEM_VALUE.ticket * C.tourFare * mult * this.progress.cashMult;
    const bills = Math.min(10, n);
    for (let i = 0; i < bills; i++) payBill(this.scene, this.flyers, this.tours.pad, this.tours.pad.group, Math.round(value / bills));
  }

  /** A heli tour run finished: pay for every tourist who made it. */
  receiveTour(endCount: number) {
    const earned = Math.round(endCount * ITEM_VALUE.ticket * C.tourFare * this.progress.cashMult);
    this.addCash(earned);
    this.progress.addXp(endCount * CONFIG.xp.runPerItem * 3);
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
    const me = this.player;
    // The world runs whether or not you're here
    for (const p of this.piles) p.update(dt);
    this.forge.update(dt);
    this.gemShop.update(dt, this.active && this.gemShop.staffZone.contains(me.pos), this.sfx);
    this.exchange?.update(dt, this.active && this.exchange.staffZone.contains(me.pos), this.sfx);
    this.plant?.update(dt);
    this.vent?.update(dt);
    this.supply?.update(dt);
    this.lair?.update(dt, this.active ? me.pos : null);
    this.kingdom?.update(dt);
    this.tours?.update(dt);
    this.arrivals.update(dt);
    for (const w of this.workers) w.update(dt, this.flyers);
    this.treasurer?.update(dt, this.cashPads, this.flyers);
    // ⚡ A powered plant boosts ALL cash (every world reads progress.cashMult)
    this.progress.powerBoost = this.plant?.powered ? 1 + C.powerBoost : 1;
    this.updateEruption(dt);
    this.updateScenery(dt);

    if (this.active) {
      const prog = this.progress;
      me.carryMax = CONFIG.player.baseCarry + 6 + prog.carryBonus;
      me.speedMult = prog.speedMult * 1.15;
      me.update(dt, move, this.blockers, this.canWalk);
      this.interact(dt);
      this.updateHeat(dt);
      this.hud.setInventory(me.stack.counts(), me.stack.count, me.carryMax);
      if (this.zoneName !== 'volcano') {
        this.zoneName = 'volcano';
        this.hud.setZone('🌋 Mount Anthill');
      }
      this.showHint();
      this.updateCamera(dt);
    } else {
      animateCreature(me.model, dt, 0);
    }
    this.flyers.update(dt);
  }

  // ---- 🌋 Eruptions -----------------------------------------------------------
  private updateEruption(dt: number) {
    this.phaseLeft -= dt;
    if (this.phaseLeft <= 0) {
      if (this.phase === 'calm') {
        this.phase = 'rumble';
        this.phaseLeft = C.eruptionWarning;
        if (this.active) this.hud.banner('🌋 The volcano is rumbling!', `Eruption in ${C.eruptionWarning} s: lava bombs + lava flows. Get the tourists out!`, 4000);
      } else if (this.phase === 'rumble') {
        this.phase = 'erupt';
        this.phaseLeft = C.eruptionLength;
        this.evacuated = false;
        this.flowMeshes.forEach((m) => (m.visible = true));
        if (this.active) this.hud.banner('🌋 ERUPTION!', 'Dodge the red rings! Lava flows cross the paths', 3200);
        // The Tour Pilot evacuates everyone by himself
        if (this.tours?.hasPilot && this.tours.waiting > 0 && this.tours.away <= 0) this.evacuate(false);
      } else {
        this.phase = 'calm';
        this.phaseLeft = rand(C.eruptionEvery[0], C.eruptionEvery[1]);
        this.flowMeshes.forEach((m) => (m.visible = false));
        for (const b of this.bombs) b.ring.removeFromParent(), b.rock.removeFromParent();
        this.bombs = [];
        // Nobody came for them: half the tourists in line run off
        const t = this.tours;
        let fled = 0;
        if (t && !this.evacuated && t.waiting > 0) {
          fled = Math.ceil(t.waiting / 2);
          t.waiting -= fled;
        }
        if (this.active) this.hud.banner('🌋 The eruption is over', fled ? `😱 ${fled} tourists fled the island` : 'Phew! Back to work', 3000);
      }
    }
    this.shake = this.phase === 'rumble' ? 0.08 : this.phase === 'erupt' ? 0.14 : 0;
    // Sky + fog darken to a red glow during an eruption
    const want = this.phase === 'erupt' ? 0x5a2a1e : this.phase === 'rumble' ? 0x7d6258 : 0x9b8577;
    this.sky.lerp(new THREE.Color(want), Math.min(1, dt * 1.5));
    (this.scene.background as THREE.Color).copy(this.sky);
    (this.scene.fog as THREE.Fog).color.copy(this.sky);
    // Lava bombs (only while you're here to dodge them)
    if (this.erupting && this.active) {
      this.bombT += dt;
      if (this.bombT >= C.bombEvery) {
        this.bombT = 0;
        this.dropBomb();
      }
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      const u = Math.min(1, b.t / BOMB_FALL);
      b.ring.scale.setScalar(0.4 + u * 0.6);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * Math.abs(Math.sin(b.t * 10));
      const fall = Math.max(0, (b.t - BOMB_FALL + 0.45) / 0.45);
      b.rock.visible = fall > 0;
      b.rock.position.set(b.at.x, 28 * (1 - Math.min(1, fall)) + 0.4, b.at.z);
      if (!b.hit && b.t >= BOMB_FALL) {
        b.hit = true;
        const p = this.player.pos;
        if (this.active && Math.hypot(p.x - b.at.x, p.z - b.at.z) < C.bombRadius) {
          this.scatter('🌋 LAVA BOMB! Dropped everything');
          this.heat = Math.min(0.95, this.heat + 0.25);
        }
        this.sfx.splash();
      }
      if (b.t >= BOMB_FALL + 0.6) {
        b.ring.removeFromParent();
        b.rock.removeFromParent();
        this.bombs.splice(i, 1);
      }
    }
  }

  private dropBomb() {
    const p = this.player.pos;
    // Usually near you, sometimes right on top of you: keep moving!
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() < 0.35 ? rand(0, 1.2) : rand(2, 6);
    const at = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
    const ring = new THREE.Mesh(new THREE.RingGeometry(C.bombRadius - 0.35, C.bombRadius, 28), new THREE.MeshBasicMaterial({ color: 0xff2a12, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.07, at.z);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8), hot(0x5a1606, 0xff4a12, 1.6));
    rock.visible = false;
    this.scene.add(ring, rock);
    this.bombs.push({ at, t: 0, ring, rock, hit: false });
  }

  /** Everything you carry goes flying (lava bomb / overheating). */
  private scatter(text: string) {
    const me = this.player;
    const pp = me.pos;
    if (me.stack.count) {
      while (me.stack.canPop()) {
        const it = me.stack.pop()!;
        const land = new THREE.Vector3(pp.x + rand(-4, 4), 0.2, pp.z + rand(-4, 4));
        this.flyers.fly(it.mesh, () => land, () => it.mesh.removeFromParent(), 0.5, 2.5);
      }
    }
    this.hud.floatAt(pp.clone().setY(H + 1), this.camera, text, 'big bad');
  }

  /** Fly every waiting tourist out (an eruption). They pay a normal 1x fare. */
  private evacuate(byPlayer: boolean) {
    const t = this.tours;
    if (!t || t.waiting <= 0 || t.away > 0) return;
    const n = t.take(C.tourTime * 0.6);
    this.evacuated = true;
    this.payTrip(n, 1);
    this.progress.addXp(n * 2);
    if (this.active) this.hud.banner(`🚁 ${n} tourists evacuated!`, byPlayer ? 'Hero pilot! They paid for the ride 💵' : 'Your Tour Pilot flew them out safely', 3000);
  }

  // ---- 🥵 Heat + 🔥 magma -------------------------------------------------------
  private updateHeat(dt: number) {
    const p = this.player.pos;
    const atMist = !!this.mist?.zone.contains(p);
    const onFlow = this.erupting && FLOWS.some((f) => inRect(p, f));
    const nearLake = distRect(p, LAKE) < C.heatRange;
    let rate = atMist ? -C.mistCool : onFlow ? C.flowHeat : nearLake ? C.heatRise : -C.heatCool;
    if (rate > 0 && this.suit) rate *= 0.5;
    this.heat = THREE.MathUtils.clamp(this.heat + rate * dt, 0, 1);
    if (this.heat >= 1) {
      this.scatter('🥵 OVERHEATED! Dropped everything');
      this.heat = 0.55;
    }
    this.hud.setHeat(this.heat > 0.01 ? this.heat : null);

    // Magma is HOT: carrying it, one rock burns away every few seconds
    const me = this.player.stack;
    if (me.has('magma')) {
      this.burnT += dt;
      if (this.burnT >= C.magmaBurn) {
        this.burnT = 0;
        const it = me.popType('magma');
        if (it) {
          const puff = it.mesh.getWorldPosition(new THREE.Vector3()).setY(H + 2.5);
          this.flyers.fly(it.mesh, () => puff, () => it.mesh.removeFromParent(), 0.4, 0.5);
          this.hud.floatAt(p.clone().setY(H + 1), this.camera, '🔥 Magma burned away!', 'bad');
        }
      }
    } else this.burnT = 0;
  }

  private updateScenery(dt: number) {
    this.lavaTex.offset.x += dt * 0.02;
    this.lavaTex.offset.y += dt * 0.012;
    this.oceanTex.offset.x += dt * 0.004;
    const now = performance.now() / 1000;
    const thick = this.phase === 'erupt' ? 1.6 : 1;
    this.smoke.forEach((p, i) => {
      const u = ((now * 4 + i * 9) % 60) / 60;
      p.position.y = MOUNT.h + 6 + u * 60;
      p.scale.setScalar((1 + u * 2.2) * thick);
      (p.material as THREE.MeshStandardMaterial).opacity = 0.6 * (1 - u);
      (p.material as THREE.MeshStandardMaterial).color.setHex(this.phase === 'erupt' ? 0x3a3230 : 0x5a5452);
    });
    // Lava fountains out of the crater during an eruption
    this.fountain.forEach((b, i) => {
      b.visible = this.phase === 'erupt';
      if (!b.visible) return;
      const u = ((now * 0.8 + i / this.fountain.length) % 1);
      const a = i * 2.4;
      b.position.set(Math.cos(a) * u * 22, MOUNT.h + Math.sin(u * Math.PI) * 38, MOUNT.z + Math.sin(a) * u * 10);
    });
    if (this.mist) {
      this.mist.puffs.forEach((p, i) => {
        const u = ((now * 0.9 + i * 0.37) % 1);
        p.position.y = 3 - u * 2.4;
        p.scale.setScalar(0.6 + u * 1.4);
        (p.material as THREE.MeshStandardMaterial).opacity = 0.55 * (1 - u);
      });
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
    drop(this.forge.inZone, this.forge.inZone, this.forge.input, 'obsidian');
    take(this.forge.outZone, this.forge.outZone, this.forge.output);
    if (this.gemShop.shelf) drop(this.gemShop.staffZone, this.gemShop.staffZone, this.gemShop.shelf, 'gem');
    if (this.vent) take(this.vent, this.vent.zone, this.vent.stack);
    if (this.plant) drop(this.plant.inZone, this.plant.inZone, this.plant.input, 'magma');
    if (this.supply) take(this.supply, this.supply.zone, this.supply.stack);
    if (this.lair && !this.lair.tamed) drop(this.lair.feedZone, this.lair.feedZone, this.lair.feed, 'meat');
    if (this.kingdom) {
      drop(this.kingdom.tributeZone, this.kingdom.tributeZone, this.kingdom.tribute, 'gem');
      take(this.kingdom.vault, this.kingdom.vault.zone, this.kingdom.vault.stack);
    }
    if (this.exchange?.shelf) drop(this.exchange.staffZone, this.exchange.staffZone, this.exchange.shelf, 'crystal');

    // Heli tours: stand on BOARD (or EVACUATE during an eruption)
    if (this.tours) {
      const t = this.tours;
      const on = t.zone.contains(p);
      if (on && this.erupting && t.waiting > 0 && t.away <= 0) this.evacuate(true);
      const ready = on && t.ready;
      if (ready) this.hud.setLaunch(t.waiting, () => this.onTour(this.tours!.take()), '🚁 VOLCANO TOUR');
      else if (on || this.launchShown) this.hud.setLaunch(null);
      this.launchShown = ready;
    }

    // 🌋 The ERUPT altar (asks first; step off and back on to ask again)
    if (this.eruptZone) {
      const on = this.eruptZone.contains(p);
      if (on && this.eruptArmed) {
        this.eruptArmed = false;
        this.onErupt();
      } else if (!on) this.eruptArmed = true;
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

  /** Hints: dangers first, then the first steps. */
  private showHint() {
    const me = this.player.stack;
    let hint: string | null = null;
    if (this.erupting) hint = '🌋 ERUPTION! Dodge the red rings, stay off the lava flows';
    else if (me.has('magma')) hint = '🔥 Magma burns away! Rush it to the plant\'s MAGMA IN';
    else if (this.heat > 0.6) hint = '🥵 Too hot! Back away from the lava (or cool off at ❄️ MIST)';
    else if (!this.save.unlocked.includes('v4-miner')) {
      if (me.has('gem')) hint = 'Put the 💎 gems on the GEM SHOP counter (SELL)';
      else if (me.has('obsidian')) hint = 'Drop the 🪨 obsidian into the FORGE (IN)';
      else if (this.forge.output.count > 0) hint = 'Grab the polished gems from the forge (OUT)';
      else hint = 'Mine 🪨 obsidian from the black rocks (west)';
    }
    if (hint !== this.hintShown) {
      this.hintShown = hint ?? '';
      this.hud.setHint(hint);
    }
  }

  // --------------------------------------------------------------------------
  // Camera + switching worlds
  // --------------------------------------------------------------------------
  /** Flying in: the camera starts high by the crater and swoops down to Jack. */
  enter(flyIn: boolean) {
    this.active = true;
    this.zoneName = '';
    this.hintShown = '-';
    this.hud.setCash(this.save.cash);
    this.intro = flyIn ? 0 : 1;
    if (this.erupting) this.hud.banner('🌋 The volcano is erupting!', 'Dodge the red rings!', 3000);
  }

  leave() {
    this.active = false;
    this.hud.setHint(null);
    this.hud.setLaunch(null);
    this.hud.setHeat(null);
    for (const b of this.bombs) b.ring.removeFromParent(), b.rock.removeFromParent();
    this.bombs = [];
  }

  get focus() {
    return this.player.pos;
  }

  /** The prestige cinematic: everything glows red and shakes for a moment. */
  bigBang() {
    this.phase = 'erupt';
    this.phaseLeft = 999;
    this.flowMeshes.forEach((m) => (m.visible = true));
    this.shake = 0.5;
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
      if (this.shake) this.camera.position.y += (Math.random() - 0.5) * this.shake;
      return;
    }
    if (this.intro < 1) {
      // Swoop down from up by the crater
      this.intro = Math.min(1, this.intro + dt / 4.2);
      const k = this.intro * this.intro * (3 - 2 * this.intro);
      const from = new THREE.Vector3(30, 70, 60);
      this.camera.position.lerpVectors(from, want, k);
      this.camLook.lerpVectors(new THREE.Vector3(0, MOUNT.h * 0.6, MOUNT.z), target, k);
      this.camera.lookAt(this.camLook);
      return;
    }
    this.camera.position.lerp(want, Math.min(1, dt * 5));
    this.camera.lookAt(this.camera.position.x - this.camOffset.x, 0, this.camera.position.z - this.camOffset.z);
    if (this.shake) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
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
