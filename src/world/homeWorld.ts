// ============================================================================
// homeWorld.ts — 🏝️ ANTHILL ISLAND (test version): YOUR BACKYARD.
//
// The new one-island game from the design doc. You're a person (Jack's model)
// with an ant farm in the backyard; the ants become your workforce as the farm
// grows. This first test covers only the opening (see data/home.ts):
//
//   🍞 BREAD BOX -> 🐜 ANT FARM (crumbs in, snack packs out) -> 🙋 ORDERS from
//   the neighbors (cash + lots of XP)
//   Farm Lv 2: a GATHERER ant fills a crumb basket by the farm
//   Farm Lv 3: a CARRIER ant feeds the farm (and later stocks the café) +
//              the 📦 DELIVERY CRATE shows up: fill it, it brings back 🪵 planks
//   The CORNER CAFÉ PLOT: player level + ants working + planks + cash, on one
//              tile by the east gate. The café buys your snack packs, and the
//              new plot hides a 🎁 chest.
//   At the café (you hire helpers where they work): a CASHIER (a person),
//              then a BANKER ant by the cash pad (idle income)
//
// Everything is "stand on a pad" like the classic game, and the building panels
// (⬆️) work here too (world key 'home').
// ============================================================================
import * as THREE from 'three';
import { clock } from '../core/clock';
import { autoCash } from '../core/income';
import { bump } from '../core/totals';
import { Upgrades } from './upgradePad';
import { trash } from './trash';
import { CONFIG } from '../data/config';
import { HOME, HOME_RENAMED, HOME_UNLOCKS, NEIGHBORS } from '../data/home';
import { Sfx } from '../core/audio';
import { HomeSave, SaveData } from '../core/save';
import { Progress } from '../core/progress';
import { Hud } from '../ui/hud';
import { HumanKind } from '../actors/creatures';
import { CreatureModel, animateCreature, faceToward } from '../actors/models';
import { Player, fpFov, handsSpot } from '../actors/player';
import { Banker, Route, Worker } from '../actors/worker';
import { Flyers, ItemType, Stack, StackItem, makeItem } from './items';
import { TextSprite, makePad, titleTag } from './labels';
import { Blocker, CashPad, ProcessorOpts, ResourcePile, TrashBin, UnlockTile, Zone, gridLayout } from './stations';
import { Desk, person, stepTo } from './airportWorld';
import { Tutorial, TutorialScript } from './tutorial';
import type { MapArea, MapMarker, MapRect, MapSeg, MapView } from '../ui/minimap';

const mat = (color: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Title tags over the helper ants (smaller than the people's). */
const ANT_TITLE = 0.6;
/** The backyard's save format (HomeSave.v). 2: the café's staff are hired at the café. */
const HOME_SAVE_V = 2;
/** Who shows up with orders / at the café (the people models). */
const NEIGHBOR_KINDS: HumanKind[] = ['h-ember', 'h-exec', 'h-balance', 'h-crew2', 'h-crew1', 'h-crew3', 'h-crew4', 'h-director'];
const CAFE_KINDS: HumanKind[] = ['h-exec', 'h-balance', 'h-ember', 'h-crew1', 'h-crew2', 'h-crew4'];

// ----------------------------------------------------------------------------
// The sand-and-tunnels picture inside the ant farm.
// ----------------------------------------------------------------------------
function sandTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9b77a';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(120,85,40,0.25)' : 'rgba(255,240,200,0.3)';
    g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }
  // Grass on top
  g.fillStyle = '#5cbf43';
  g.fillRect(0, 0, 512, 14);
  // Tunnels and chambers
  g.strokeStyle = '#6b4426';
  g.lineCap = 'round';
  g.lineWidth = 16;
  const tunnel = (pts: number[]) => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  };
  tunnel([70, 10, 90, 70, 60, 120, 120, 170, 210, 190]);
  tunnel([90, 70, 220, 90, 300, 70, 420, 110, 450, 180]);
  tunnel([300, 70, 330, 10]);
  tunnel([210, 190, 330, 210, 450, 180]);
  tunnel([220, 90, 250, 140, 330, 210]);
  g.fillStyle = '#6b4426';
  for (const [x, y, rx, ry] of [[60, 120, 34, 18], [210, 190, 40, 20], [420, 110, 36, 18], [250, 140, 28, 16]]) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Eggs in a chamber, and a crumb stash
  g.fillStyle = '#fff6dd';
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.ellipse(196 + i * 8, 190 + (i % 2) * 5, 4, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#e8b45a';
  for (let i = 0; i < 6; i++) g.fillRect(405 + (i % 3) * 9, 104 + Math.floor(i / 3) * 8, 7, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ----------------------------------------------------------------------------
// 🐜 THE ANT FARM: a glass frame full of sand and tunnels on a table. Crumbs go
// in on the left (IN), snack packs come out on the right (OUT). Same shape as
// the colony's oven (inZone / outZone / speedMult), so the ⬆️ panel and the ⚠️
// status tag work with it too.
// ----------------------------------------------------------------------------
const FARM: ProcessorOpts = { inType: 'crumb', outType: 'snack', label: '🐜 ANT FARM', cookTime: HOME.farm.cookTime, body: 0x9b6a3c, trim: 0x6b4426, glow: 0xffd166 };

class AntFarm {
  group = new THREE.Group();
  input: Stack;
  output: Stack;
  inZone: Zone;
  outZone: Zone;
  blocker: Blocker;
  opts = FARM;
  /** ⬆️ Upgrade: makes snack packs this many times faster. */
  speedMult = 1;
  /** Making one right now (the ⚠️ status tag reads it). */
  cooking = false;
  /** A snack pack came out. */
  onMade: () => void = () => {};
  private cookT = 0;
  private feed = new THREE.Object3D();  // crumbs drop in here (the funnel on top)
  private hatch = new THREE.Object3D(); // snack packs come out here
  private sign = new TextSprite(0.7);
  private ants: THREE.InstancedMesh;
  private walkers: { x: number; y: number; vx: number; vy: number; t: number }[] = [];
  private shown = 0;
  private dummy = new THREE.Object3D();
  private sand = { x0: -1.85, x1: 1.85, y0: 1.35, y1: 3.0, z: 0.17 };

  constructor(private scene: THREE.Scene, x: number, z: number, private flyers: Flyers) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const wood = mat(0x9b6a3c, 0.85);
    const dark = mat(0x6b4426, 0.9);
    // The table
    this.group.add(box(5.2, 0.16, 2.0, wood, 0, 1.0, 0));
    for (const [lx, lz] of [[-2.4, -0.8], [2.4, -0.8], [-2.4, 0.8], [2.4, 0.8]]) this.group.add(box(0.16, 1.0, 0.16, dark, lx, 0.5, lz));
    // The ant farm: a tall, thin frame with sand and tunnels behind glass
    const W = 4.0;
    const H = 2.2;
    const y0 = 1.08;
    this.group.add(box(W + 0.3, 0.16, 0.6, dark, 0, y0 + 0.08, 0));
    this.group.add(box(W + 0.3, 0.16, 0.6, dark, 0, y0 + H + 0.24, 0));
    for (const s of [-1, 1]) this.group.add(box(0.15, H + 0.16, 0.6, dark, s * (W / 2 + 0.07), y0 + 0.16 + H / 2, 0));
    const sand = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.86, 0.3), new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1 }));
    sand.position.set(0, y0 + 0.16 + H * 0.43, 0);
    sand.receiveShadow = true;
    this.group.add(sand);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.2, roughness: 0.1, metalness: 0.1, depthWrite: false }),
    );
    glass.position.set(0, y0 + 0.16 + H / 2, 0);
    glass.renderOrder = 3;
    this.group.add(glass);
    // A feeding funnel on top (crumbs drop in) and a little hatch at the bottom (snacks out)
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.12, 0.5, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9c46a, roughness: 0.5, side: THREE.DoubleSide }));
    funnel.position.set(-1.3, y0 + H + 0.58, 0);
    this.group.add(funnel);
    this.feed.position.set(-1.3, y0 + H + 0.6, 0);
    this.hatch.position.set(1.6, y0 + 0.5, 0.45);
    this.group.add(this.feed, this.hatch);
    this.group.add(box(0.6, 0.35, 0.25, mat(0x2a9d8f, 0.5), 1.6, y0 + 0.38, 0.3));

    // Tiny ants scurrying through the tunnels (one InstancedMesh = one draw call)
    const antGeo = new THREE.CapsuleGeometry(0.035, 0.09, 3, 6);
    antGeo.rotateZ(Math.PI / 2);
    this.ants = new THREE.InstancedMesh(antGeo, mat(0x3a1208, 0.6), 30);
    this.ants.count = 0;
    this.group.add(this.ants);
    for (let i = 0; i < 30; i++) {
      this.walkers.push({
        x: THREE.MathUtils.lerp(this.sand.x0, this.sand.x1, Math.random()),
        y: THREE.MathUtils.lerp(this.sand.y0, this.sand.y1, Math.random()),
        vx: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35),
        vy: 0,
        t: Math.random() * 3,
      });
    }

    // IN / OUT trays at hand height, with their pads in front
    for (const s of [-1, 1]) this.group.add(box(1.4, 1.0, 1.4, wood, s * 3.6, 0.5, 0.4));
    this.input = new Stack(this.group, gridLayout(3, 3, 0.44, 0.44, 1.0, -3.6, 0.4), CONFIG.bakery.inputMax);
    this.output = new Stack(this.group, gridLayout(2, 3, 0.62, 0.44, 1.0, 3.6, 0.4), CONFIG.bakery.outputMax);
    const inPad = makePad(2.4, 2.4, 'IN');
    inPad.position.set(-3.6, 0.03, 2.9);
    const outPad = makePad(2.4, 2.4, 'OUT');
    outPad.position.set(3.6, 0.03, 2.9);
    this.group.add(inPad, outPad);
    this.inZone = new Zone(x - 3.6, z + 2.9, 1.2, 1.2);
    this.outZone = new Zone(x + 3.6, z + 2.9, 1.2, 1.2);
    this.blocker = { minX: x - 4.35, maxX: x + 4.35, minZ: z - 1.1, maxZ: z + 1.2 };

    this.sign.sprite.position.set(0, 4.4, 0);
    this.group.add(this.sign.sprite);
    this.setLevel(1);
  }

  /** The farm's level: more ants inside, and it says so on its sign. */
  setLevel(level: number) {
    this.sign.setText(`🐜 ANT FARM · Lv ${level}`);
    this.shown = Math.min(30, 6 + (level - 1) * 6);
  }

  update(dt: number) {
    const feedAt = new THREE.Vector3();
    this.feed.getWorldPosition(feedAt);
    const hatchAt = new THREE.Vector3();
    this.hatch.getWorldPosition(hatchAt);
    // Start one: a crumb drops into the funnel
    if (!this.cooking && this.input.canPop() && !this.output.full) {
      const it = this.input.pop()!;
      this.flyers.fly(it.mesh, () => feedAt, () => it.mesh.removeFromParent(), 0.3, 0.9);
      this.cooking = true;
      this.cookT = 0;
    }
    if (this.cooking) {
      this.cookT += dt;
      if (this.cookT >= this.opts.cookTime / this.speedMult) {
        this.cooking = false;
        bump('made'); // 📊 lifetime: items made
        const it: StackItem = { mesh: makeItem('snack'), type: 'snack', value: 0, flying: false };
        it.mesh.position.copy(hatchAt);
        this.scene.add(it.mesh);
        this.flyers.pushInto(it, this.output, 0.3);
        this.onMade();
      }
    }
    // The tiny ants: busier while the farm is working
    const s = this.sand;
    const busy = this.cooking ? 1.8 : 1;
    this.ants.count = this.shown;
    for (let i = 0; i < this.shown; i++) {
      const w = this.walkers[i];
      w.t -= dt;
      if (w.t <= 0) {
        // now and then: turn, or dig up / down a level
        w.t = 0.6 + Math.random() * 2;
        w.vx = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35);
        w.vy = Math.random() < 0.35 ? (Math.random() < 0.5 ? -1 : 1) * 0.25 : 0;
      }
      w.x += w.vx * dt * busy;
      w.y += w.vy * dt * busy;
      if (w.x < s.x0 || w.x > s.x1) w.vx = -w.vx;
      if (w.y < s.y0 || w.y > s.y1) w.vy = -w.vy;
      w.x = THREE.MathUtils.clamp(w.x, s.x0, s.x1);
      w.y = THREE.MathUtils.clamp(w.y, s.y0, s.y1);
      this.dummy.position.set(w.x, w.y, s.z);
      this.dummy.rotation.set(0, 0, Math.atan2(w.vy, w.vx));
      this.dummy.updateMatrix();
      this.ants.setMatrixAt(i, this.dummy.matrix);
    }
    this.ants.instanceMatrix.needsUpdate = true;
  }
}

// ----------------------------------------------------------------------------
// The crumb basket by the farm (Farm Lv 2): the Gatherer fills it, the Carrier
// (or you) takes crumbs from it to the farm. A low wicker tray you stand on.
// ----------------------------------------------------------------------------
class Basket {
  group = new THREE.Group();
  stack: Stack;
  zone: Zone;
  constructor(scene: THREE.Scene, x: number, z: number) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const wicker = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.0, 0.35, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8975a, roughness: 0.9, side: THREE.DoubleSide }));
    wicker.position.y = 0.18;
    wicker.castShadow = true;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.04, 24), mat(0xa87a45, 0.9));
    bottom.position.y = 0.02;
    this.group.add(wicker, bottom);
    this.stack = new Stack(this.group, gridLayout(3, 3, 0.44, 0.44, 0.05), 27);
    this.zone = new Zone(x, z, 1.2, 1.2);
    const sign = new TextSprite(0.5, '#ffd166');
    sign.setText('🧺 CRUMB BASKET');
    sign.sprite.position.set(0, 1.3, -1.4);
    this.group.add(sign.sprite);
  }
}

// ----------------------------------------------------------------------------
// 🙋 Where the neighbors come for their orders: a garden table by the fence.
// You stand on ORDER and the snack packs hop into their basket.
// ----------------------------------------------------------------------------
class OrderSpot {
  group = new THREE.Group();
  zone: Zone;
  basket: Stack;
  blocker: Blocker;
  bubble = new TextSprite(0.66, '#ffffff');
  /** Where the neighbor stands, facing you. */
  stand: THREE.Vector3;
  constructor(scene: THREE.Scene, x: number, z: number) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 24), mat(0xf4f1de, 0.5));
    top.position.y = 1.05;
    top.castShadow = true;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.0, 10), mat(0x5a5f66, 0.4, 0.5));
    leg.position.y = 0.5;
    this.group.add(top, leg);
    // A basket on the table for the packs
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.3, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8975a, roughness: 0.9, side: THREE.DoubleSide }));
    b.position.y = 1.25;
    this.group.add(b);
    this.basket = new Stack(this.group, gridLayout(2, 2, 0.5, 0.36, 1.12), 40);
    const pad = makePad(2.4, 2.4, 'ORDER', '#ffd166');
    pad.position.set(-2.2, 0.03, 0);
    this.group.add(pad);
    this.zone = new Zone(x - 2.2, z, 1.2, 1.2);
    this.blocker = { minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.9, maxZ: z + 0.9 };
    this.stand = new THREE.Vector3(x + 1.5, 0, z);
    this.bubble.sprite.position.set(1.5, 4.0, 0);
    this.bubble.sprite.visible = false;
    this.group.add(this.bubble.sprite);
  }
}

// ----------------------------------------------------------------------------
// 📦 The delivery crate: fill it with goods you can make, it goes off on a truck
// and comes back with 🪵 planks (the building material new plots need).
// ----------------------------------------------------------------------------
class Crate {
  group = new THREE.Group();
  body = new THREE.Group();
  zone: Zone;
  stack: Stack;
  blocker: Blocker;
  sign = new TextSprite(0.66, '#ffffff');
  constructor(scene: THREE.Scene, x: number, z: number) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    this.group.add(this.body);
    const wood = mat(0xb5803f, 0.85);
    this.body.add(box(2.0, 0.16, 1.6, mat(0x7a5530, 0.9), 0, 0.08, 0)); // pallet
    this.body.add(box(1.8, 1.1, 1.4, wood, 0, 0.71, 0));
    for (const y of [0.35, 1.05]) this.body.add(box(1.86, 0.1, 1.46, mat(0x8a5a2b, 0.85), 0, y, 0));
    this.stack = new Stack(this.body, gridLayout(3, 3, 0.5, 0.42, 1.27), 40);
    const pad = makePad(2.4, 2.4, 'CRATE', '#ffb347');
    pad.position.set(-2.4, 0.03, 0);
    this.group.add(pad);
    this.zone = new Zone(x - 2.4, z, 1.2, 1.2);
    // (solid only while it's here: away on the truck, you can walk through its spot)
    this.blocker = { minX: x - 1.05, maxX: x + 1.05, minZ: z - 0.85, maxZ: z + 0.85, obj: this.body };
    this.sign.sprite.position.set(0, 3.1, 0);
    this.group.add(this.sign.sprite);
  }
}

// ----------------------------------------------------------------------------
// 🎁 A chest hidden on a new plot. Walk into it to open it.
// ----------------------------------------------------------------------------
class Chest {
  group = new THREE.Group();
  zone: Zone;
  private lid = new THREE.Group();
  private openT = -1;
  constructor(scene: THREE.Scene, x: number, z: number, open: boolean) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const wood = mat(0x8a4b22, 0.8);
    const gold = mat(0xf2c14e, 0.35, 0.6);
    this.group.add(box(1.4, 0.75, 0.9, wood, 0, 0.375, 0));
    for (const x2 of [-0.55, 0.55]) this.group.add(box(0.12, 0.78, 0.94, gold, x2, 0.39, 0));
    this.lid.position.set(0, 0.75, -0.45);
    const lidBox = box(1.4, 0.32, 0.9, wood, 0, 0.16, 0.45);
    this.lid.add(lidBox, box(0.24, 0.2, 0.08, gold, 0, 0.05, 0.92));
    this.group.add(this.lid);
    this.zone = new Zone(x, z, 1.3, 1.3);
    if (open) this.lid.rotation.x = -1.9;
  }
  /** Pop the lid open (animated). */
  open() {
    this.openT = 0;
  }
  update(dt: number) {
    if (this.openT < 0 || this.openT >= 1) return;
    this.openT = Math.min(1, this.openT + dt / 0.5);
    this.lid.rotation.x = -1.9 * (1 - (1 - this.openT) ** 3);
  }
}

// ============================================================================
// The backyard
// ============================================================================
export class HomeWorld {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  flyers = new Flyers(this.scene);
  player: Player;
  /** (always the world on screen: there's only one for now) */
  active = true;
  /** ⬆️ The building panels. */
  ups: Upgrades | null = null;
  tutorial: Tutorial;

  // Stations (field names matter: the ⬆️ panels look through them)
  piles: ResourcePile[] = [];
  processors: AntFarm[] = [];
  desks: Desk[] = [];
  cashPads: CashPad[] = [];
  tiles: UnlockTile[] = [];
  workers: Worker[] = [];
  bankers: Banker[] = [];
  bin: TrashBin;

  farm: AntFarm;
  bread: ResourcePile;
  basket: Basket | null = null;
  orderSpot: OrderSpot;
  crate: Crate | null = null;
  cafe: Desk | null = null;
  chest: Chest | null = null;

  private home: HomeSave;
  private blockers: Blocker[] = [];
  private timers = new Map<object, number>();
  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private camOffset = new THREE.Vector3(0, 16, 15.5);
  private thirdFov = 42;
  private zoneName = '';
  private gate = new THREE.Group();     // the closed gate to the café plot
  private lot = new THREE.Group();      // the empty lot (before the café is bought)
  private plotSign: TextSprite[] = [];  // what the café plot needs, over its gate
  private plotSignT = 0;
  private cafeOpen = false;
  // The neighbor with an order: walking in, waiting, or walking out
  private neighbor: { model: CreatureModel; state: 'in' | 'wait' | 'out'; path: THREE.Vector3[] } | null = null;
  /** Just bought a tile here: the next one on this spot (the farm levels share one) waits until you step off. */
  private stepOff: Zone | null = null;
  /** 🗺️ For the minimap: the fences and trees, as they're built. */
  private fenceSegs: MapSeg[] = [];
  private treeSpots: { x: number; z: number; r: number }[] = [];
  private nextOrderT: number = HOME.order.wait;

  constructor(private hud: Hud, private sfx: Sfx, public save: SaveData, private progress: Progress) {
    this.home = save.home ??= { made: 0, orders: 0, order: null, crate: { trips: 0, got: {}, away: 0 }, planks: 0, chest: false, cafeSales: 0, v: HOME_SAVE_V };
    if ((this.home.v ?? 1) < 2) {
      // v0.27 save: the café's cashier and banker were farm levels (same prices): rename them
      // (and never twice: a save holding both names would hire two of each)
      const renamed = [...new Set(save.unlocked.map((id) => HOME_RENAMED[id] ?? id))];
      save.unlocked.splice(0, save.unlocked.length, ...renamed);
      for (const [from, to] of Object.entries(HOME_RENAMED)) {
        if (save.paid[from] === undefined) continue;
        if (save.paid[to] === undefined && !save.unlocked.includes(to)) save.paid[to] = save.paid[from];
        delete save.paid[from];
      }
    }
    this.home.v = HOME_SAVE_V;
    this.buildEnvironment();

    // You: Jack's model, by the ant farm
    const me = person('h-jack');
    me.root.position.set(0, 0, 1.5);
    me.root.rotation.y = Math.PI;
    this.player = new Player(this.scene, { model: me, spot: handsSpot(me) });

    // The bread box, the ant farm, the order table, the trash bin
    this.bread = new ResourcePile(this.scene, -10, -2.5, this.flyers, 'crumb', 'bread');
    this.piles.push(this.bread);
    this.farm = new AntFarm(this.scene, -1, -6, this.flyers);
    this.processors.push(this.farm);
    this.blockers.push(this.farm.blocker);
    this.farm.onMade = () => {
      this.home.made++;
    };
    this.orderSpot = new OrderSpot(this.scene, 8.8, -3.2);
    this.blockers.push(this.orderSpot.blocker);
    this.bin = new TrashBin(this.scene, 1.5, 9);

    for (const def of HOME_UNLOCKS) this.tiles.push(new UnlockTile(this.scene, def, save.paid[def.id] ?? 0));
    const plot = this.tiles.find((t) => t.def.id === 'ai-cafe');
    if (plot) plot.need = () => this.plotNeed();
    for (const id of save.unlocked) this.applyUnlock(id, false);
    this.refreshTiles(false);

    // An order that was open when you left: the neighbor is still waiting
    if (this.home.order) this.spawnNeighbor(true);

    this.hud.setCash(save.cash);
    this.tutorial = new Tutorial(this, hud, save, homeTutorial(this));
    this.camera.position.copy(this.player.pos).add(this.camOffset);
    this.camera.lookAt(this.player.pos);
  }

  // --------------------------------------------------------------------------
  // Building the backyard
  // --------------------------------------------------------------------------
  private buildEnvironment() {
    const s = this.scene;
    s.background = new THREE.Color(0x9fd8ff);
    s.fog = new THREE.Fog(0x9fd8ff, 60, 150);
    s.add(new THREE.HemisphereLight(0xffffff, 0x7a8a5a, 1.7));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -24;
    sc.right = sc.top = 24;
    sc.near = 1;
    sc.far = 70;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // The lawn (mowing stripes), the sidewalk and the street
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#79c257' : '#6fb84e';
      g.fillRect(i * 32, 0, 32, 256);
    }
    const lawnTex = new THREE.CanvasTexture(c);
    lawnTex.colorSpace = THREE.SRGBColorSpace;
    lawnTex.wrapS = lawnTex.wrapT = THREE.RepeatWrapping;
    lawnTex.repeat.set(8, 8);
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: lawnTex, roughness: 1 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(10, -0.01, 0);
    lawn.receiveShadow = true;
    s.add(lawn);
    const flat = (w: number, d: number, color: number, x: number, z: number, y = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color, 0.95));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      s.add(m);
      return m;
    };
    flat(120, 2.6, 0xc9c5bd, 10, 13.6, 0.005); // sidewalk
    flat(120, 9, 0x4a4f55, 10, 19.5, 0.004);   // street
    for (let x = -46; x <= 66; x += 7) flat(3, 0.3, 0xf2d25a, x, 19.5, 0.008);
    // Houses across the street (just shapes, for the neighborhood feel)
    const colors = [0xf4a261, 0x8ecae6, 0xe9c46a, 0xb5e48c, 0xcdb4db];
    for (let i = 0; i < 6; i++) {
      const hx = -30 + i * 16;
      s.add(box(10, 5, 7, mat(colors[i % colors.length], 0.8), hx, 2.5, 30));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 3, 4), mat(0x6d4c41, 0.8));
      roof.position.set(hx, 6.5, 30);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.75);
      s.add(roof);
    }

    // Your house, north of the yard, with a back deck
    s.add(box(20, 6.5, 8, mat(0xf1e3c8, 0.8), -5, 3.25, -17));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 6.2, 3.4, 4, 1), mat(0x8d5b4c, 0.8));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.62, 1, 0.66);
    roof.position.set(-5, 8.2, -17);
    s.add(roof);
    for (const wx of [-12, -7.5, 2]) s.add(box(2.2, 1.8, 0.1, mat(0x4f6d8a, 0.2, 0.3), wx, 3.6, -12.96));
    s.add(box(1.6, 3.0, 0.1, mat(0x7a4b2a, 0.7), -3, 1.5, -12.96)); // back door
    s.add(box(14, 0.3, 2.2, mat(0xa0703f, 0.85), -5, 0.15, -12)); // deck
    // A big shade tree and some bushes
    this.tree(12, -8.5, 1.0);
    this.tree(-13, 8.5, 0.8);
    for (const [bx, bz] of [[-14, -6], [-14, 2], [5, -10.3], [14, -10.2], [-6, 10.3]]) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), mat(0x3f8f3a, 0.9));
      bush.scale.set(1.3, 0.8, 1);
      bush.position.set(bx, 0.6, bz);
      bush.castShadow = true;
      s.add(bush);
    }
    // A picnic table by the bread box
    const wood = mat(0xa0703f, 0.85);
    s.add(box(3.0, 0.14, 1.3, wood, -11.8, 1.15, -6.4), box(3.0, 0.1, 0.4, wood, -11.8, 0.65, -5.3), box(3.0, 0.1, 0.4, wood, -11.8, 0.65, -7.5));
    this.blockers.push({ minX: -13.4, maxX: -10.2, minZ: -7.8, maxZ: -5.0 });

    // The fences: around the yard (a gap in the south for the neighbors, a gate east to the café plot)
    const Y = HOME.yard;
    this.fence(Y.minX, Y.minZ, Y.maxX, Y.minZ);
    this.fence(Y.minX, Y.minZ, Y.minX, Y.maxZ);
    this.fence(Y.minX, Y.maxZ, 11.2, Y.maxZ);
    this.fence(Y.maxX, Y.minZ, Y.maxX, HOME.gate.z0);
    this.fence(Y.maxX, HOME.gate.z1, Y.maxX, Y.maxZ);
    // The gate (closed until the café plot is yours)
    const gateMat = mat(0xffffff, 0.6);
    const len = HOME.gate.z1 - HOME.gate.z0;
    this.gate.position.set(Y.maxX, 0, HOME.gate.z0);
    for (const y of [0.5, 1.1]) this.gate.add(box(0.1, 0.12, len, gateMat, 0, y, len / 2));
    for (let zz = 0.2; zz < len; zz += 0.45) this.gate.add(box(0.12, 1.3, 0.16, gateMat, 0, 0.65, zz));
    s.add(this.gate);
    // The café plot next door: an empty lot for now
    const P = HOME.cafePlot;
    this.fence(P.minX, P.minZ, P.maxX, P.minZ);
    this.fence(P.maxX, P.minZ, P.maxX, P.maxZ);
    this.fence(P.minX, P.maxZ, 28.5, P.maxZ);
    this.lot.add(flat(P.maxX - P.minX, P.maxZ - P.minZ, 0xb39368, (P.minX + P.maxX) / 2, (P.minZ + P.maxZ) / 2, 0.006));
    const sale = new TextSprite(0.8, '#ffd166');
    sale.setText('🏷️ LOT FOR SALE');
    sale.sprite.position.set(26, 3.2, 0);
    this.lot.add(sale.sprite);
    this.lot.add(box(0.15, 2.4, 0.15, mat(0x6b4426), 26, 1.2, 0));
    s.add(this.lot);
    // What the plot needs (shown over the gate until it's bought)
    // (over the plot's tile, just inside the gate, so it's on screen as you walk up)
    for (let i = 0; i < 3; i++) {
      const t = new TextSprite(i === 0 ? 0.78 : 0.6, i === 0 ? '#ffd166' : '#ffffff');
      t.sprite.position.set(12.4, 5.0 - i * 0.78, (HOME.gate.z0 + HOME.gate.z1) / 2);
      s.add(t.sprite);
      this.plotSign.push(t);
    }
  }

  /** A simple round tree. */
  private tree(x: number, z: number, k: number) {
    const trunk = box(0.6 * k, 4 * k, 0.6 * k, mat(0x7a4b2a, 0.9), x, 2 * k, z);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(3 * k, 14, 10), mat(0x4f9a35, 0.85));
    crown.position.set(x, 5.2 * k, z);
    crown.castShadow = true;
    this.scene.add(trunk, crown);
    this.blockers.push({ minX: x - 0.5 * k, maxX: x + 0.5 * k, minZ: z - 0.5 * k, maxZ: z + 0.5 * k });
    this.treeSpots.push({ x, z, r: 3 * k });
  }

  /** A white picket fence from (x1, z1) to (x2, z2): one InstancedMesh of pickets + two rails. */
  private fence(x1: number, z1: number, x2: number, z2: number) {
    this.fenceSegs.push({ x0: x1, z0: z1, x1: x2, z1: z2 });
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / 0.45));
    const white = mat(0xffffff, 0.6);
    const pickets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.3, 0.12), white, n);
    const m = new THREE.Matrix4();
    const angle = Math.atan2(x2 - x1, z2 - z1);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      m.makeRotationY(angle);
      m.setPosition(x1 + (x2 - x1) * k, 0.65, z1 + (z2 - z1) * k);
      pickets.setMatrixAt(i, m);
    }
    pickets.castShadow = true;
    this.scene.add(pickets);
    for (const y of [0.45, 1.05]) {
      const rail = box(0.08, 0.12, len, white, (x1 + x2) / 2, y, (z1 + z2) / 2);
      rail.rotation.y = angle;
      this.scene.add(rail);
    }
  }

  // --------------------------------------------------------------------------
  // Where you can walk
  // --------------------------------------------------------------------------
  private canWalk = (x: number, z: number) => {
    const Y = HOME.yard;
    if (x > Y.minX + 0.6 && x < Y.maxX - 0.6 && z > Y.minZ + 0.6 && z < Y.maxZ - 0.6) return true;
    if (!this.cafeOpen) return false;
    const P = HOME.cafePlot;
    if (x > P.minX + 0.6 && x < P.maxX - 0.6 && z > P.minZ + 0.6 && z < P.maxZ - 0.6) return true;
    return x >= Y.maxX - 0.6 && x <= P.minX + 0.6 && z > HOME.gate.z0 + 0.4 && z < HOME.gate.z1 - 0.4; // through the gate
  };

  // --------------------------------------------------------------------------
  // Helpers (the ants)
  // --------------------------------------------------------------------------
  private antWorker(title: string, x: number, z: number, route: () => Route, hat: { color: number; flat?: boolean }, animate: boolean) {
    const w = new Worker(this.scene, x, z, route, hat, HOME.antLength);
    titleTag(w.model, title, ANT_TITLE);
    this.workers.push(w);
    if (animate) this.flyers.grow(w.model.root);
    return w;
  }

  // --------------------------------------------------------------------------
  // Unlocks
  // --------------------------------------------------------------------------
  private owns(id: string) {
    return this.save.unlocked.includes(id);
  }

  /** What the café plot still needs besides level and cash ('' = nothing). */
  private plotNeed() {
    if (this.workers.length < HOME.plot.ants) return `NEEDS ${HOME.plot.ants} ANTS WORKING`;
    if (this.home.planks < HOME.plot.planks) return `NEEDS ${HOME.plot.planks} PLANKS`;
    return '';
  }

  private applyUnlock(id: string, animate: boolean) {
    const grow = (o: THREE.Object3D) => animate && this.flyers.grow(o);
    switch (id) {
      case 'ai-farm2': {
        // 🧺 The crumb basket, and the Gatherer who fills it from the bread box
        this.basket = new Basket(this.scene, -7.5, 1.6);
        grow(this.basket.group);
        const basket = this.basket;
        this.antWorker('🐜 GATHERER', -9, 0, () => ({ src: this.bread.stack, srcZone: this.bread.zone, dst: basket.stack, dstZone: basket.zone }), { color: 0xffc928 }, animate);
        this.farm.setLevel(2);
        break;
      }
      case 'ai-farm3': {
        // The Carrier: basket -> farm, and (once the café is open) farm -> café, turn about.
        // (The café run only when there are packs to take and room on its shelf for a load,
        // and if a pick-up spot stays empty it switches jobs: it never stalls the farm.)
        // Each trip it picks a job that can be finished (packs to take and room on the café's
        // shelf / crumbs in the basket and room in the farm), taking turns when both can.
        // Nothing to do: it waits by the basket and looks again a few seconds later.
        let flip = false;
        const idle = new Stack(new THREE.Group(), gridLayout(1, 1, 0, 0, 0), 1); // (always empty)
        const carrier: Worker = this.antWorker('🐜 CARRIER', -5, -1, () => {
          flip = !flip;
          const load = carrier.stack.max;
          const basket = this.basket!;
          const cafe = this.cafe;
          const toCafe = !!cafe?.shelf && this.farm.output.count > 0 && cafe.shelf.count + load <= cafe.shelf.max;
          const toFarm = basket.stack.count > 0 && this.farm.input.count + load <= this.farm.input.max;
          if (cafe?.shelf && toCafe && (!flip || !toFarm)) return { src: this.farm.output, srcZone: this.farm.outZone, dst: cafe.shelf, dstZone: cafe.staffZone };
          if (toFarm) return { src: basket.stack, srcZone: basket.zone, dst: this.farm.input, dstZone: this.farm.inZone };
          return { src: idle, srcZone: basket.zone, dst: this.farm.input, dstZone: this.farm.inZone };
        }, { color: 0xe63946, flat: true }, animate);
        carrier.patience = 5;
        this.farm.setLevel(3);
        // ...and the delivery crate turns up by the south fence
        this.crate = new Crate(this.scene, 9, 7);
        this.blockers.push(this.crate.blocker);
        grow(this.crate.group);
        if (this.home.crate.away === 0) {
          for (const [t, n] of Object.entries(this.home.crate.got)) for (let i = 0; i < n; i++) this.crate.stack.addInstant(t as ItemType);
        }
        break;
      }
      case 'ai-cafe':
        this.openCafe(animate);
        break;
      case 'ai-cashier':
        // ☕ A person behind the café's counter: sells to the customers for you
        this.cafe?.hireStaff(person('h-crew3'), animate, '☕ CASHIER');
        break;
      case 'ai-banker': {
        // 🏦 A banker ant by the café's cash pad: sweeps the bills into your wallet (idle income)
        const pad = this.cashPads[0];
        if (!pad) break;
        const b = new Banker(this.scene, pad, (amount) => {
          const v = amount * (this.ups?.bonus ?? 1); // (+ 💼 collectors upgrade)
          this.addCash(v);
          autoCash(v); // automated income: the +$/min rate
        }, HOME.antLength);
        titleTag(b.model, '🏦 BANKER', ANT_TITLE);
        this.bankers.push(b);
        grow(b.model.root);
        break;
      }
    }
  }

  /** ☕ The Corner Café plot: the gate opens, the café goes up, a chest is hidden on it. */
  private openCafe(animate: boolean) {
    if (this.cafeOpen) return;
    this.cafeOpen = true;
    this.gate.visible = false;
    this.lot.visible = false;
    for (const t of this.plotSign) t.sprite.visible = false;
    const P = HOME.cafePlot;
    // A paved patio
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d8cbb3';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(120,100,70,0.35)';
    g.lineWidth = 3;
    for (let i = 0; i <= 256; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    const patio = new THREE.Mesh(new THREE.PlaneGeometry(P.maxX - P.minX, P.maxZ - P.minZ), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    patio.rotation.x = -Math.PI / 2;
    patio.position.set((P.minX + P.maxX) / 2, 0.007, (P.minZ + P.maxZ) / 2);
    patio.receiveShadow = true;
    this.scene.add(patio);
    // The café (a desk that sells your snack packs) + its cash pad
    // (the desk sits level with the gate, so the Carrier ant walks through it, not the fence)
    const pad = new CashPad(this.scene, 21, -4);
    this.cashPads.push(pad);
    const cafe = new Desk(this.scene, 23, 1.5, this.flyers, pad, null, {
      mode: 'cafe', sells: 'snack', awning: 0x2d6cdf, label: '☕ CORNER CAFÉ', color: 0xd9a066, kinds: CAFE_KINDS,
      interval: HOME.cafe.interval, queueMax: HOME.cafe.queueMax, serve: HOME.cafe.serve,
      entry: [new THREE.Vector3(33, 0, 15), new THREE.Vector3(33, 0, 5)],
      exit: (from) => [new THREE.Vector3(from.x, 0, 5), new THREE.Vector3(33, 0, 15)],
      staff2: () => person('h-balance'), // (the ⬆️ panel's 2nd cashier: someone who looks different from the first)
    });
    cafe.onServe = (byPlayer) => {
      this.progress.addXp(byPlayer ? CONFIG.xp.sale : CONFIG.xp.autoSale);
      this.home.cafeSales++;
    };
    cafe.valueMult = () => this.progress.cashMult * HOME.cafe.priceMult;
    this.cafe = cafe;
    this.desks.push(cafe);
    this.blockers.push(cafe.blocker);
    // Patio tables with umbrellas
    const tables: THREE.Object3D[] = [];
    for (const [tx, tz, color] of [[28, -6, 0xe63946], [33, -8, 0x2a9d8f], [19.5, 8, 0xf4a261]] as [number, number, number][]) {
      const t = new THREE.Group();
      t.position.set(tx, 0, tz);
      t.add(box(1.4, 0.1, 1.4, mat(0xf4f1de, 0.5), 0, 1.0, 0), box(0.1, 1.0, 0.1, mat(0x5a5f66, 0.4, 0.5), 0, 0.5, 0), box(0.07, 2.6, 0.07, mat(0x5a5f66, 0.4, 0.5), 0, 1.3, 0));
      const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.55, 8), mat(color, 0.6));
      umbrella.position.y = 2.65;
      umbrella.castShadow = true;
      t.add(umbrella);
      this.scene.add(t);
      tables.push(t);
      this.blockers.push({ minX: tx - 0.8, maxX: tx + 0.8, minZ: tz - 0.8, maxZ: tz + 0.8 });
    }
    // 🎁 The chest
    this.chest = new Chest(this.scene, 28, 8.5, this.home.chest);
    if (animate) {
      for (const o of [patio, cafe.group, pad.group, this.chest.group, ...tables]) this.flyers.grow(o);
      this.hud.banner('☕ The Corner Café is yours!', 'It buys your snack packs. Something is hidden on the new plot…', 4500);
    }
  }

  private unlock(tile: UnlockTile) {
    const id = tile.def.id;
    this.save.unlocked.push(id);
    delete this.save.paid[id];
    tile.mesh.visible = false;
    if (id === 'ai-cafe') this.home.planks -= HOME.plot.planks; // (the planks get used)
    this.applyUnlock(id, true);
    this.progress.addXp(CONFIG.xp.tile.home);
    this.sfx.unlocked();
    this.hud.floatAt(tile.mesh.position.clone().setY(2), this.camera, 'UNLOCKED!', 'big gold');
    this.refreshTiles(true);
  }

  /** Show tiles whose requirements are met and that aren't bought yet. */
  private refreshTiles(animate: boolean) {
    for (const t of this.tiles) {
      const show = !this.owns(t.def.id) && t.def.requires.every((r) => this.owns(r));
      if (show && !t.mesh.visible && animate) this.flyers.grow(t.mesh);
      t.mesh.visible = show;
    }
  }

  // --------------------------------------------------------------------------
  // 🙋 Orders from the neighbors
  // --------------------------------------------------------------------------
  private orderSize(n: number) {
    if (n === 0) return HOME.order.first;
    if (n === 1) return HOME.order.second;
    const o = HOME.order;
    const n2 = o.min + Math.floor(Math.random() * (o.max - o.min + 1)) + Math.floor((this.save.level - 1) / 3);
    return Math.min(n2, 30); // (the order basket holds 40)
  }

  /** The neighbor with the open order walks in (or, after a reload, is already there). */
  private spawnNeighbor(already: boolean) {
    const order = this.home.order!;
    const model = person(NEIGHBOR_KINDS[order.who % NEIGHBOR_KINDS.length]);
    const spot = this.orderSpot.stand;
    const path = [new THREE.Vector3(12.8, 0, 16), new THREE.Vector3(12.8, 0, spot.z + 1.2), spot.clone()];
    model.root.position.copy(already ? spot : path[0]);
    this.scene.add(model.root);
    this.neighbor = { model, state: already ? 'wait' : 'in', path: already ? [] : path.slice(1) };
    if (already) for (let i = 0; i < order.have; i++) this.orderSpot.basket.addInstant('snack');
  }

  private newOrder() {
    const n = this.home.orders;
    this.home.order = { who: n, want: this.orderSize(n), have: 0 };
    this.spawnNeighbor(false);
  }

  private orderReward(want: number) {
    const o = HOME.order;
    return {
      cash: Math.round(want * o.pay * (1 + 0.05 * (this.save.level - 1)) * this.progress.cashMult),
      xp: o.xpBase + o.xpPer * want,
    };
  }

  private completeOrder() {
    const order = this.home.order!;
    const r = this.orderReward(order.want);
    this.addCash(r.cash);
    this.progress.addXp(r.xp);
    bump('sold', order.want);
    this.sfx.contract();
    const at = this.orderSpot.stand.clone().setY(3.4);
    this.hud.floatAt(at, this.camera, `Thank you! 😊 +$${r.cash} · +${r.xp} XP`, 'big gold');
    // The packs go into the neighbor's arms, and off they go (they've all landed by now:
    // see updateOrders)
    const n = this.neighbor;
    for (const it of this.orderSpot.basket.items.splice(0)) {
      const target = new THREE.Vector3();
      this.flyers.fly(it.mesh, () => (n ? target.copy(n.model.root.position).setY(1.6) : target.copy(at)), () => it.mesh.removeFromParent(), 0.3, 0.6);
    }
    if (n) {
      n.state = 'out';
      n.path = [new THREE.Vector3(12.8, 0, this.orderSpot.stand.z + 1.2), new THREE.Vector3(12.8, 0, 16)];
    }
    this.home.order = null;
    this.home.orders++;
    if (this.home.orders === 1) {
      this.save.unlocked.push('ai-order1'); // (brings out the first farm upgrade)
      this.refreshTiles(true);
    }
    this.nextOrderT = HOME.order.wait;
  }

  private updateOrders(dt: number) {
    const spot = this.orderSpot;
    const order = this.home.order;
    // The neighbor walks in, waits (facing you), or walks home
    const n = this.neighbor;
    if (n) {
      if (n.state === 'wait') {
        animateCreature(n.model, dt, 0);
        faceToward(n.model, -1, 0, dt, 6);
      } else if (n.path.length) {
        if (stepTo(n.model, n.path[0], 4.2, dt)) n.path.shift();
      } else if (n.state === 'in') {
        n.state = 'wait';
      } else {
        n.model.root.removeFromParent();
        this.neighbor = null;
      }
    }
    // The bubble: "🙋 Rosa · 🍪 3/5"
    const waiting = !!order && n?.state === 'wait';
    spot.bubble.sprite.visible = waiting;
    if (order && waiting) spot.bubble.setText(`🙋 ${NEIGHBORS[order.who % NEIGHBORS.length]} · 🍪 ${order.have}/${order.want}`);
    // Filled! (once the last pack has landed in the basket)
    if (order && order.have >= order.want && waiting && !spot.basket.items.some((it) => it.flying)) this.completeOrder();
    // A new neighbor comes by (the first one once the farm has made its first snack pack)
    if (!order && !this.neighbor && this.home.made > 0) {
      this.nextOrderT -= dt;
      if (this.nextOrderT <= 0) this.newOrder();
    }
  }

  // --------------------------------------------------------------------------
  // 📦 The delivery crate
  // --------------------------------------------------------------------------
  private crateAsk() {
    const asks = HOME.crate.asks;
    return asks[Math.min(this.home.crate.trips, asks.length - 1)];
  }

  private updateCrate(dt: number) {
    const crate = this.crate;
    if (!crate) return;
    const st = this.home.crate;
    if (st.away > 0) {
      st.away = Math.max(0, st.away - dt);
      crate.body.visible = false;
      crate.sign.setText(`🚚 Planks on the way · ${Math.ceil(st.away)}s`);
      if (st.away === 0) {
        // Back, with planks!
        this.home.planks += HOME.crate.planks;
        this.sfx.unlocked();
        this.hud.floatAt(crate.group.position.clone().setY(3), this.camera, `+${HOME.crate.planks} 🪵 planks!`, 'big gold');
      }
      return;
    }
    // The crate itself shows up again once you're not standing in its spot (it doesn't shove you)
    if (!crate.body.visible) {
      const b = crate.blocker;
      const p = this.player.pos;
      if (!(p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ)) {
        crate.body.visible = true;
        this.flyers.grow(crate.body);
      }
    }
    const ask = this.crateAsk();
    crate.sign.setText(`📦 CRATE · 🍪 ${st.got.snack ?? 0}/${ask.snack} · 🍞 ${st.got.crumb ?? 0}/${ask.crumb}`);
    this.crateFilled();
  }

  /** Is the crate full (and has the last item landed)? Then it's off on the truck. */
  private crateFilled() {
    const crate = this.crate!;
    const st = this.home.crate;
    const ask = this.crateAsk();
    if (Object.keys(ask).some((t) => (st.got[t] ?? 0) < ask[t])) return;
    if (crate.stack.items.some((it) => it.flying)) return;
    st.trips++;
    st.got = {};
    st.away = HOME.crate.away;
    crate.stack.clear();
    this.progress.addXp(HOME.crate.xp);
    this.sfx.contract();
    this.hud.banner('📦 The crate is on its way!', `It comes back with ${HOME.crate.planks} 🪵 planks for building`, 3200);
  }

  // --------------------------------------------------------------------------
  // Money
  // --------------------------------------------------------------------------
  addCash(amount: number) {
    this.save.cash += amount;
    this.hud.setCash(this.save.cash);
  }

  // --------------------------------------------------------------------------
  // Per-frame update
  // --------------------------------------------------------------------------
  /** Runs `fn` every `interval` seconds while `on` is true (one timer per `key`). */
  private every(key: object, dt: number, on: boolean, interval: number, fn: () => void) {
    if (!on) {
      this.timers.set(key, interval); // first item hops right away next time
      return;
    }
    let t = (this.timers.get(key) ?? interval) + dt;
    while (t >= interval) {
      t -= interval;
      fn();
    }
    this.timers.set(key, t);
  }

  update(dt: number, move: THREE.Vector2) {
    // ⬆️ Building panels (made on the first frame, once the world is built)
    this.ups ??= new Upgrades(
      { scene: this.scene, camera: this.camera, workers: this.workers, collectors: () => this.bankers, ready: () => this.owns('ai-order1') },
      'home', this.save, this.hud, this.sfx, this.flyers, this.progress,
    );
    this.ups.update(dt, this, this.player.pos, true);
    const me = this.player;
    const p = me.pos;
    const prog = this.progress;
    const xp = CONFIG.xp;
    me.carryMax = CONFIG.player.baseCarry + prog.carryBonus;
    me.speedMult = prog.speedMult * HOME.speedMult;
    me.update(dt, move, this.blockers, this.canWalk);

    this.bread.update(dt);
    this.farm.update(dt);
    for (const w of this.workers) w.update(dt, this.flyers);
    for (const b of this.bankers) b.update(dt, this.flyers);
    this.cafe?.update(dt, !!this.cafe && this.cafe.staffZone.contains(p), this.sfx);
    this.chest?.update(dt);
    this.updateOrders(dt);
    this.updateCrate(dt);

    const iv = CONFIG.player.pickupInterval / prog.workMult;
    const has = (t: ItemType) => me.stack.has(t);
    const take = (key: object, zone: Zone, from: Stack, type: ItemType, step: number) =>
      this.every(key, dt, zone.contains(p) && me.canTake(type), iv, () => {
        if (me.canTake(type) && this.flyers.transfer(from, me.stack)) {
          this.sfx.pickup();
          prog.addXp(xp.pickup);
          this.tutorial.did(step);
        }
      });
    const drop = (key: object, zone: Zone, to: Stack, type: ItemType, step: number, onDrop?: () => void) =>
      this.every(key, dt, zone.contains(p) && has(type) && !to.full, iv, () => {
        if (!to.full && this.flyers.transferType(me.stack, to, type)) {
          this.sfx.drop();
          prog.addXp(xp.drop);
          this.tutorial.did(step);
          onDrop?.();
        }
      });

    // 1) Crumbs: from the bread box (and the basket), into the farm
    take(this.bread.zone, this.bread.zone, this.bread.stack, 'crumb', 0);
    if (this.basket) take(this.basket.zone, this.basket.zone, this.basket.stack, 'crumb', 0);
    drop(this.farm.inZone, this.farm.inZone, this.farm.input, 'crumb', 1);
    // 2) Snack packs off the farm's OUT tray
    take(this.farm.outZone, this.farm.outZone, this.farm.output, 'snack', 2);
    // 3) Orders: hand the packs over
    const order = this.home.order;
    if (order && this.neighbor?.state === 'wait') {
      this.every(this.orderSpot.zone, dt, this.orderSpot.zone.contains(p) && has('snack') && order.have < order.want, iv, () => {
        if (order.have < order.want && this.flyers.transferType(me.stack, this.orderSpot.basket, 'snack')) {
          order.have++; // (it's filled once the last pack lands: updateOrders)
          this.sfx.drop();
          prog.addXp(xp.drop);
        }
      });
    }
    // 4) The crate takes what it still needs
    const crate = this.crate;
    if (crate && this.home.crate.away === 0) {
      const ask = this.crateAsk();
      const got = this.home.crate.got;
      const wanted = (Object.keys(ask) as ItemType[]).find((t) => (got[t] ?? 0) < ask[t] && has(t));
      this.every(crate.zone, dt, crate.zone.contains(p) && !!wanted, iv, () => {
        const t = (Object.keys(ask) as ItemType[]).find((k) => (got[k] ?? 0) < ask[k] && has(k));
        if (!t || !this.flyers.transferType(me.stack, crate.stack, t)) return;
        got[t] = (got[t] ?? 0) + 1; // (it leaves once the last one lands: updateCrate)
        this.sfx.drop();
        prog.addXp(xp.drop);
      });
    }
    // 5) The café: stock its shelf (and serve while you're there)
    const cafe = this.cafe;
    if (cafe?.shelf) drop(cafe.staffZone, cafe.staffZone, cafe.shelf, 'snack', -1);
    // 6) Cash pads -> wallet
    for (const pad of this.cashPads) {
      this.every(pad.zone, dt, pad.zone.contains(p), 0.035, () => {
        const bill = pad.stack.pop();
        if (!bill) return;
        const target = new THREE.Vector3();
        this.flyers.fly(bill.mesh, () => target.copy(p).setY(1.7), () => {
          bill.mesh.removeFromParent();
          this.addCash(bill.value);
          this.sfx.cash();
        }, 0.22, 0.8);
      });
    }
    // 7) 🎁 The chest
    const chest = this.chest;
    if (chest && !this.home.chest && chest.zone.contains(p)) {
      this.home.chest = true;
      chest.open();
      const c = HOME.chest;
      const cash = Math.round(c.cash * prog.cashMult);
      this.addCash(cash);
      prog.addXp(c.xp);
      this.sfx.contract();
      this.hud.floatAt(chest.group.position.clone().setY(2.4), this.camera, `🎁 A chest! +$${cash} · +${c.xp} XP`, 'big gold');
    }
    // 8) Trash bin (each piece pays a little: world/trash.ts)
    const onBin = this.bin.zone.contains(p) && me.stack.count > 0;
    this.every(this.bin.zone, dt, onBin && trash.open(), 0.04, () => {
      const it = me.stack.pop();
      if (!it) return;
      this.flyers.fly(it.mesh, () => this.bin.mouth, () => it.mesh.removeFromParent(), 0.25, 1.0);
      this.sfx.trash();
      this.addCash(trash.pay(this.bin.mouth, this.camera));
    });
    trash.wait(dt, onBin, this.bin.mouth, this.camera);
    // 9) Unlock tiles: stand on one to pour cash in
    if (this.stepOff && !this.stepOff.contains(p)) this.stepOff = null;
    for (const t of this.tiles) {
      if (!t.mesh.visible) continue;
      const affordable = this.save.cash >= 1 && !t.locked;
      t.update(dt, affordable && this.save.cash >= t.remaining);
      if (affordable && t.zone.contains(p) && !this.stepOff) {
        const rate = Math.max(t.def.cost / CONFIG.unlockDrainTime, CONFIG.unlockMinRate);
        const pay = Math.min(this.save.cash, rate * dt * clock.scale, t.def.cost - t.paid);
        t.paid += pay;
        this.save.cash -= pay;
        this.save.paid[t.def.id] = t.paid;
        this.hud.setCash(this.save.cash);
        this.sfx.unlockTick();
        if (t.paid >= t.def.cost - 1e-6) {
          this.unlock(t);
          this.stepOff = t.zone;
        }
      }
    }
    this.updatePlotSign(dt);

    this.hud.setInventory(me.stack.counts(), me.stack.count, me.carryMax);
    // Where you are (+ your planks, once you have some)
    const place = p.x > HOME.yard.maxX ? '☕ Corner Café' : '🏡 Your Backyard';
    const name = this.home.planks > 0 ? `${place} · 🪵 ${this.home.planks}` : place;
    if (name !== this.zoneName) {
      this.zoneName = name;
      this.hud.setZone(name);
    }
    this.flyers.update(dt);
    this.updateCamera(dt);
    this.tutorial.update(dt, true);
  }

  /** Over the gate: what the café plot needs, ticked off as you get there. */
  private updatePlotSign(dt: number) {
    if (this.cafeOpen) return;
    this.plotSignT -= dt;
    if (this.plotSignT > 0) return;
    this.plotSignT = 0.5;
    const show = this.owns('ai-farm2');
    for (const t of this.plotSign) t.sprite.visible = show;
    if (!show) return;
    const def = HOME_UNLOCKS.find((d) => d.id === 'ai-cafe')!;
    const ok = (b: boolean) => (b ? '✅' : '⬜');
    const ants = Math.min(this.workers.length, HOME.plot.ants);
    const planks = Math.min(this.home.planks, HOME.plot.planks);
    this.plotSign[0].setText('☕ CORNER CAFÉ PLOT');
    this.plotSign[1].setText(`${ok(this.save.level >= (def.level ?? 0))} Lv ${def.level} · ${ok(ants >= HOME.plot.ants)} 🐜 ${ants}/${HOME.plot.ants} ants`);
    this.plotSign[2].setText(`${ok(planks >= HOME.plot.planks)} 🪵 ${planks}/${HOME.plot.planks} planks · 💵 $${def.cost}`);
  }

  // --------------------------------------------------------------------------
  // 🗺️ The minimap
  // --------------------------------------------------------------------------
  /** The whole map (the big view fits it): your house to the street, the yard and the café plot. */
  static readonly MAP_BOUNDS: MapRect = { minX: -17, maxX: 38, minZ: -22, maxZ: 18 };

  /** What the minimap draws right now. */
  mapView(): MapView {
    const Y = HOME.yard;
    const P = HOME.cafePlot;
    const areas: MapArea[] = [
      { rect: { minX: -60, maxX: 90, minZ: 12.3, maxZ: 14.9 }, fill: '#c9c5bd' }, // sidewalk
      { rect: { minX: -60, maxX: 90, minZ: 14.9, maxZ: 24 }, fill: '#4a4f55' },   // street
      { rect: Y, fill: '#79c257', label: 'Your backyard' },
      this.cafeOpen
        ? { rect: P, fill: '#d8cbb3', label: 'Corner Café' }
        : { rect: P, fill: '#b39368', edge: 'rgba(255, 220, 140, 0.9)', dashed: true, label: 'Lot for sale' },
      { rect: { minX: -15, maxX: 5, minZ: -21, maxZ: -13 }, fill: '#f1e3c8', edge: '#8d5b4c', label: 'Your house' },
      { rect: { minX: -12, maxX: 2, minZ: -13.1, maxZ: -10.9 }, fill: '#a0703f' }, // deck
    ];
    // (the gate to the café plot is a fence until the plot is yours)
    const fences = this.cafeOpen ? this.fenceSegs : [...this.fenceSegs, { x0: Y.maxX, z0: HOME.gate.z0, x1: Y.maxX, z1: HOME.gate.z1 }];
    const order = this.home.order;
    const markers: MapMarker[] = [
      { x: -10, z: -2.5, icon: '🍞', label: 'Bread' },
      { x: -1, z: -6, icon: '🐜', label: 'Ant farm' },
      { x: 8.8, z: -3.2, icon: '🙋', label: 'Orders', alert: !!order && this.neighbor?.state === 'wait' && order.have < order.want },
      { x: 1.5, z: 9, icon: '🗑️', label: 'Trash' },
    ];
    if (this.basket) markers.push({ x: -7.5, z: 1.6, icon: '🧺' }); // (no name: it's right by the bread box)
    if (this.crate) markers.push(this.home.crate.away > 0 ? { x: 9, z: 7, icon: '🚚', label: 'Crate (away)' } : { x: 9, z: 7, icon: '📦', label: 'Crate' });
    if (this.cafe) {
      markers.push({ x: 23, z: 1.5, icon: '☕', label: 'Café' }, { x: 21, z: -4, icon: '💵', label: 'Cash' });
      if (!this.home.chest) markers.push({ x: 28, z: 8.5, icon: '🎁', label: 'Chest' });
    } else {
      markers.push({ x: 26, z: 0, icon: '🏷️', label: 'For sale' });
    }
    const p = this.player.pos;
    const target = this.tutorial.target;
    return {
      areas,
      trees: this.treeSpots,
      fences,
      markers,
      tiles: this.tiles.filter((t) => t.mesh.visible).map((t) => ({ x: t.zone.x, z: t.zone.z })),
      player: { x: p.x, z: p.z, yaw: this.player.model.root.rotation.y },
      target: target ? { x: target.x, z: target.z } : null,
    };
  }

  // --------------------------------------------------------------------------
  // Camera
  // --------------------------------------------------------------------------
  /** Where the camera looks (for the level-of-detail culling). */
  get focus() {
    return this.player.pos;
  }

  setShadowSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
  }

  private updateCamera(dt: number) {
    const target = this.player.pos;
    const fov = this.player.firstPerson ? fpFov(this.camera.aspect) : this.thirdFov;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.sun.position.set(target.x + 10, 26, target.z + 12);
    this.sun.target.position.copy(target);
    if (this.player.firstPerson) {
      this.player.placeEyeCamera(this.camera);
      return;
    }
    const want = new THREE.Vector3().copy(target).add(this.camOffset);
    this.camera.position.lerp(want, Math.min(1, dt * 5));
    this.camera.lookAt(this.camera.position.x - this.camOffset.x, 0, this.camera.position.z - this.camOffset.z);
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

// ============================================================================
// 🎓 Anthill Island's tutorial: the arrow + hints through the backyard
// ============================================================================
function homeTutorial(w: HomeWorld): TutorialScript {
  const home = () => w.save.home!;
  // 🎯 The quest card's bar: the order's packs handed over...
  const orderProgress = () => {
    const o = home().order;
    return o ? o.have / o.want : null;
  };
  // ...what's in the crate (of what this trip asks for)...
  const crateProgress = () => {
    const st = home().crate;
    if (!w.crate || st.away > 0) return null;
    const ask = HOME.crate.asks[Math.min(st.trips, HOME.crate.asks.length - 1)];
    let got = 0;
    let want = 0;
    for (const [t, n] of Object.entries(ask)) {
      got += Math.min(st.got[t] ?? 0, n);
      want += n;
    }
    return want ? got / want : null;
  };
  return {
    intro: {
      title: '🏝️ Welcome to Anthill Island!',
      html: `<p>You've set up an <b>ant farm</b> in your backyard. Feed your ants, fill your neighbors' orders, and as the
        farm grows, <b>the ants take over the chores</b>: gathering, carrying, selling.</p>
        <p>🧪 This is a <b>test version</b>: just the backyard and the first café plot, so you can see how it feels.</p>
        <p>Want a quick walkthrough? A yellow arrow 🔽 shows you where to go.</p>`,
    },
    finish: {
      title: '🎉 That\'s the first test!',
      html: `<p>Your ants feed the farm, the neighbors keep ordering, and the <b>Corner Café</b> buys your snack packs.</p>
        <ul>
          <li>☕ Hire a <b>cashier</b> at the café (Lv 8), then a <b>banker ant</b> (Lv 9) to collect its cash, so it runs by itself.</li>
          <li>📦 The crate keeps bringing 🪵 planks: they're for the next plots.</li>
          <li>⬆️ Walk up to a building and tap ⬆️ (or tap it) to upgrade it.</li>
        </ul>
        <p>Thanks for testing! 🐜</p>`,
      button: '👍 Got it',
    },
    defs: HOME_UNLOCKS,
    steps: (t) => [
      { text: () => '👆 Drag anywhere to walk. Grab some crumbs from the bread box 🍞', target: () => t.at(w.bread.zone) },
      { text: () => '🐜 Drop the crumbs on your ANT FARM\'s IN tray: the ants turn them into snack packs', target: () => t.at(w.farm.inZone) },
      { text: () => '📦 Take the snack packs from the OUT tray', target: () => t.at(w.farm.outZone) },
      {
        text: () => {
          const o = home().order;
          return o ? `🙋 Your neighbor wants ${o.want} snack packs! Stand on ORDER to hand them over` : '🙋 A neighbor is coming over… make a few snack packs';
        },
        target: () => (home().order ? t.at(w.orderSpot.zone) : t.at(w.farm.outZone)),
        done: () => home().orders >= 1,
        progress: orderProgress,
      },
      {
        text: () => '📋 More neighbors, more orders: they pay cash and lots of XP',
        target: () => (home().order ? t.at(w.orderSpot.zone) : null),
        done: () => home().orders >= 2,
        progress: orderProgress,
      },
      t.unlockStep('ai-farm2', '🐜 Grow your ant farm! Lv 2 sends out a Gatherer ant'),
      t.unlockStep('ai-farm3', '🐜 Farm Lv 3: a Carrier ant feeds the farm for you'),
      {
        text: () => '📦 Fill the delivery crate with snack packs and crumbs: it brings back 🪵 planks',
        target: () => (w.crate ? t.at(w.crate.zone) : null),
        done: () => home().crate.trips > 0,
        progress: crateProgress,
      },
      {
        ...t.unlockStep('ai-cafe', '☕ Open the next plot: the Corner Café! (the sign by the gate shows what it needs)'),
        // (the bar fills as you meet each thing the plot needs: level, ants, planks, then the cash)
        progress: () => {
          const def = HOME_UNLOCKS.find((d) => d.id === 'ai-cafe')!;
          const met = (w.save.level >= (def.level ?? 0) ? 1 : 0) + (w.workers.length >= HOME.plot.ants ? 1 : 0) + (home().planks >= HOME.plot.planks ? 1 : 0);
          return (met + (t.paidOf('ai-cafe') ?? 0)) / 4;
        },
      },
      {
        text: () => '☕ The café buys your snack packs: bring some to its SELL spot',
        target: () => (w.cafe ? t.at(w.cafe.staffZone) : null),
        done: () => home().cafeSales > 0,
      },
      {
        text: () => '🎁 Every new plot hides a chest. Find it!',
        target: () => (w.chest ? w.chest.group.position.clone().setY(0) : null),
        done: () => home().chest,
      },
    ],
  };
}
