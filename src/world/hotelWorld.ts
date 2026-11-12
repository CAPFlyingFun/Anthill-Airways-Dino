// ============================================================================
// hotelWorld.ts — ACT 5: THE ANTHILL GRAND RESORT (human scale).
//
// Everyone Anthill Airways flies in needs a bed. You run the resort:
//
//   🛎️ FRONT DESK   guests check in (they pay a fee) and leave 🧳 on the BAGS cart
//   🛗 ELEVATOR     carry luggage to the elevator: each bag = one guest in a room
//   🛏️ ROOMS        occupied rooms pay every night. Guests check out after a
//                   while: a dirty room + 🧺 laundry down the chute
//   🧺 LAUNDRY      laundry -> WASHERS -> clean 🧻 towels -> LINEN (cleans a room)
//   🍽️ KITCHEN      🥬 groceries -> KITCHEN -> 🍽️ trays -> the BUFFET
//   🏊 POOL & SPA   keep the towel rack stocked and the loungers pay
//   ⭐ STARS        clean rooms + a short line + no luggage pile-up (+ the
//                   kitchen and pool) = more stars. Stars raise every price and
//                   unlock the fancy stuff (pool at 3★, penthouse at 4★, gala at 5★)
//
// The tower grows a floor (3 more rooms) with every unlock you buy.
// Trouble: 😡 complaints, ⚡ power outages, 🐜 ants raiding the kitchen and an
// escaped 🦤 Dodo running round the lobby. 🛒 Bellhop Dash: a luggage-cart gate
// run down the hallways for tips.
// ============================================================================
import { clock } from '../core/clock';
import { autoCash } from '../core/income';
import { Upgrades } from './upgradePad';
import { trash } from './trash';
import * as THREE from 'three';
import { CONFIG, HOTEL_CFG as C, HOTEL_UNLOCKS } from '../data/config';
import { Sfx } from '../core/audio';
import { SaveData } from '../core/save';
import { Progress } from '../core/progress';
import { Hud } from '../ui/hud';
import { HumanKind, spawnCreature, spawnDino } from '../actors/creatures';
import { CreatureModel, animateCreature, faceToward, makeAnt } from '../actors/models';
import { Player, fpFov, handsSpot } from '../actors/player';
import { Route, Worker } from '../actors/worker';
import { Flyers, ITEM_VALUE, ItemType, Stack } from './items';
import { TITLE, TextSprite, makePad, titleTag } from './labels';
import { Bakery, Blocker, CashPad, ProcessorOpts, ResourcePile, TrashBin, UnlockTile, Zone, gridLayout } from './stations';
import { Assistant, Desk, payBill, person, stepTo } from './airportWorld';

const H = 2.8; // people are this tall
const mat = (color: number, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  b.receiveShadow = true;
  return b;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);
function noShadow(o: THREE.Object3D) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = false;
  });
  return o;
}

// ---- The map (x = east, z = south; the tower stands along the north edge) --
const WALK = { minX: -30, maxX: 30, minZ: -20, maxZ: 28 };
const TOWER = { minX: -10, maxX: 10, minZ: -30, maxZ: -21, lobby: 4.2, floorH: 3.4 };
const SHAFT = { x: 11.6, z: -22.4 };               // the glass elevator, east of the tower
const POOL = { minX: 12, maxX: 26, minZ: 9, maxZ: 18 };
const BUS_STOP = new THREE.Vector3(16, 0, 30);     // guests arrive by shuttle bus
const GUESTS: HumanKind[] = ['h-exec', 'h-balance', 'h-ember', 'h-director', 'h-crew2'];

const WASHERS: ProcessorOpts = { inType: 'laundry', outType: 'towel', label: 'WASHERS', cookTime: C.washTime, body: 0xdfe6ee, trim: 0x5c7a99, glow: 0x7fd8ff };
const KITCHEN: ProcessorOpts = { inType: 'grocery', outType: 'tray', label: 'KITCHEN', cookTime: C.kitchenTime, body: 0xb8bec6, trim: 0x2d3436, glow: 0xff7a1a };

type HotelEvent = 'complaint' | 'outage' | 'ants' | 'dodo';

// ============================================================================
export class HotelWorld {
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
  /** Set by main.ts: launch a Bellhop Dash gate run with `count` bags. */
  onDash: (count: number) => void = () => {};

  // ⭐ Stars + rooms
  rating: number;
  occupied = 0;
  dirty = 0;
  private checkoutAcc = 0;
  private roomPayT = 0;
  private penthouseT = 0;

  // Stations
  private desk: Desk;
  private bags: Stack;
  private bagZone: Zone;
  private elevStack: Stack;
  private elevZone = new Zone(SHAFT.x, -18.6, 1.3, 1.3);
  private elevCar: THREE.Mesh;
  private elev = { state: 'idle' as 'idle' | 'up' | 'down', t: 0, n: 0, trip: 3 };
  private linen: Stack;
  private linenZone = new Zone(4, -18.4, 1.3, 1.3);
  private roomsPad: CashPad;
  private chute: ResourcePile;
  private washers: Bakery;
  private pantry: ResourcePile | null = null;
  private kitchen: Bakery | null = null;
  private buffet: Desk | null = null;
  private pool: { rack: Stack; zone: Zone; pad: CashPad; stock: number; payT: number; loungers: CreatureModel[] } | null = null;
  private dashZone: Zone | null = null;
  private assistant: Assistant | null = null;
  private penthouse = false;
  private gala = false;
  private conciergeZone = new Zone(6, -5.6, 1.2, 1.2);
  private generatorZone = new Zone(26, -16.4, 1.3, 1.3);
  private hasConcierge = false;
  private hasEngineer = false;

  // Trouble
  private event: HotelEvent | null = null;
  private eventT = rand(C.eventEvery[0], C.eventEvery[1]) * 0.6;
  private eventLeft = 0;
  private complainer: { m: CreatureModel; tag: TextSprite } | null = null;
  private fixT = 0;
  private ants: { m: CreatureModel; to: THREE.Vector3; stealT: number }[] = [];
  private dodo: { m: CreatureModel; to: THREE.Vector3 } | null = null;
  private deskInterval = C.checkinEvery;

  // Scenery
  private floors: THREE.Group[] = [];
  private windows: THREE.Mesh[] = [];
  private winMats = {
    lit: new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc34d, emissiveIntensity: 0.8, roughness: 0.3 }),
    dirty: new THREE.MeshStandardMaterial({ color: 0x8a6a5a, emissive: 0x3a2010, emissiveIntensity: 0.4, roughness: 0.5 }),
    free: new THREE.MeshStandardMaterial({ color: 0x5b8fbf, roughness: 0.15, metalness: 0.3 }),
    off: new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.2, metalness: 0.3 }),
  };
  private towerSign = new TextSprite(1.0, '#ffd166');
  private crown: THREE.Group | null = null;
  private shaftGlass: THREE.Mesh;
  private bus: THREE.Group;
  private busT = 0;
  private waterTex: THREE.CanvasTexture | null = null;
  private trash: TrashBin;
  private blockers: Blocker[] = [];
  private timers = new Map<object, number>();
  private sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  private camOffset = new THREE.Vector3(0, 20, 17.5);
  private thirdFov = 56;
  private intro = 1;
  private zoneShown = '';
  private hintShown = '';
  private launchShown = false;
  private signShown = '';

  constructor(private hud: Hud, private sfx: Sfx, private save: SaveData, private progress: Progress) {
    // (saved in save.paid so they survive a reload)
    this.rating = save.paid['h5-rating'] ?? 2.5;
    this.occupied = save.paid['h5-occ'] ?? 0;
    this.dirty = save.paid['h5-dirty'] ?? 0;
    this.buildScene();
    this.trash = new TrashBin(this.scene, -28, 26);

    // You (Jack's model, unnamed here) step off the shuttle
    const me = person('h-jack');
    me.root.position.set(4, 0, 20);
    this.player = new Player(this.scene, { model: me, spot: handsSpot(me) });

    // 🧳 The BAGS cart beside the front desk (luggage waits here for the elevator)
    const cart = new THREE.Group();
    cart.position.set(-17, 0, -5.6);
    cart.add(box(2.6, 0.2, 1.6, mat(0xb8860b, 0.3, 0.8), 0, 0.5, 0));
    for (const x of [-1.2, 1.2]) cart.add(box(0.1, 2.6, 0.1, mat(0xd4af37, 0.3, 0.9), x, 1.5, 0));
    cart.add(box(2.5, 0.1, 0.1, mat(0xd4af37, 0.3, 0.9), 0, 2.8, 0));
    this.scene.add(cart);
    this.bags = new Stack(cart, gridLayout(3, 2, 0.75, 0.7, 0.62), 30);
    const bagPad = makePad(2.6, 2.4, 'BAGS', '#ffd166');
    bagPad.position.set(-17, 0.03, -3.2);
    this.scene.add(bagPad);
    this.bagZone = new Zone(-17, -3.2, 1.3, 1.2);
    this.blockers.push({ minX: -18.4, maxX: -15.6, minZ: -6.5, maxZ: -4.7 });

    // 🛎️ The front desk: guests pay a fee and hand over their luggage
    this.desk = new Desk(this.scene, -12, -10, this.flyers, this.addPad(-14.4, -14.6), this.bags, {
      mode: 'checkin', label: '🛎️ FRONT DESK', color: 0x7a2a3a, kinds: GUESTS, interval: C.checkinEvery,
      queueMax: C.queueMax, serve: C.serve, vips: true, fee: C.fee,
      entry: [BUS_STOP.clone().add(new THREE.Vector3(-3, 0, -2)), new THREE.Vector3(2, 0, -4)],
      exit: (from) => [new THREE.Vector3(from.x, 0, -6), new THREE.Vector3(4, 0, 4), BUS_STOP.clone().add(new THREE.Vector3(-3, 0, -2))],
    });
    this.desk.onServe = (byPlayer) => this.progress.addXp(byPlayer ? CONFIG.xp.sale : CONFIG.xp.autoSale);
    this.desk.valueMult = () => this.priceMult;
    this.desk.onVip = (what, amount, where) => {
      if (!this.active) return;
      if (what === 'tip') this.hud.floatAt(where.setY(H + 1.2), this.camera, `🌟 VIP tip +$${amount}`, 'big gold');
      else {
        this.rating = Math.max(1, this.rating - 0.3);
        this.hud.floatAt(where.setY(H + 1.2), this.camera, '🌟 VIP stormed off! -⭐', 'big bad');
      }
    };
    this.blockers.push(this.desk.blocker);

    // 🛗 The elevator (a glass shaft up the east side of the tower)
    const rack = new THREE.Group();
    rack.position.set(SHAFT.x, 0, -20.6);
    rack.add(box(2.2, 0.6, 1.2, mat(0x8a949e, 0.4, 0.6), 0, 0.3, 0));
    this.scene.add(rack);
    this.elevStack = new Stack(rack, gridLayout(3, 2, 0.7, 0.55, 0.62), 18);
    const ePad = makePad(2.6, 2.6, 'ELEVATOR', '#4fe3ff');
    ePad.position.set(SHAFT.x, 0.03, -18.6);
    this.scene.add(ePad);
    this.blockers.push({ minX: SHAFT.x - 1.6, maxX: SHAFT.x + 1.6, minZ: -24, maxZ: -20 });
    this.elevCar = box(2.4, 3, 2.4, mat(0xd4af37, 0.3, 0.8), SHAFT.x, 1.5, SHAFT.z);
    this.scene.add(this.elevCar);
    this.shaftGlass = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.25, roughness: 0.1 }));
    this.scene.add(this.shaftGlass);

    // 🧻 LINEN: clean towels here make up the dirty rooms
    const lcart = new THREE.Group();
    lcart.position.set(4, 0, -20.4);
    lcart.add(box(2.2, 1.0, 1.2, mat(0xf2f2f2, 0.6), 0, 0.5, 0));
    this.scene.add(lcart);
    this.linen = new Stack(lcart, gridLayout(3, 2, 0.6, 0.45, 1.02), 24);
    const lPad = makePad(2.6, 2.4, 'LINEN', '#9ee7ff');
    lPad.position.set(4, 0.03, -18.4);
    this.scene.add(lPad);
    this.blockers.push({ minX: 2.8, maxX: 5.2, minZ: -21.1, maxZ: -19.7 });

    // 🛏️ Room billing lands here
    this.roomsPad = this.addPad(-4, -17.6);

    // 🧺 The laundry chute + the washers
    this.chute = new ResourcePile(this.scene, 18, -16.5, this.flyers, 'laundry', 'chute');
    this.chute.stack.clear();                // it only fills when guests check out
    this.chute.spawnEvery = () => Infinity;
    this.blockers.push({ minX: 16.6, maxX: 19.4, minZ: -19.3, maxZ: -17.7 });
    this.washers = new Bakery(this.scene, 20, -10, this.flyers, WASHERS);
    this.blockers.push(this.washers.blocker);

    // Concierge podium (complaints) + the generator (power outages)
    this.scene.add(box(1.2, 1.3, 1.0, mat(0x7a2a3a, 0.5), 6, 0.65, -8));
    const cPad = makePad(2.4, 2.4, 'CONCIERGE', '#ffd166');
    cPad.position.set(6, 0.03, -5.6);
    this.scene.add(cPad);
    this.blockers.push({ minX: 5.2, maxX: 6.8, minZ: -8.7, maxZ: -7.3 });
    this.scene.add(box(3, 2.2, 2, mat(0x3a5a40, 0.6, 0.3), 27, 1.1, -19.4));
    const gPad = makePad(2.6, 2.6, 'GENERATOR', '#7df9a0');
    gPad.position.set(26, 0.03, -16.4);
    this.scene.add(gPad);
    this.blockers.push({ minX: 25.4, maxX: 28.6, minZ: -20.5, maxZ: -18.3 });

    for (const def of HOTEL_UNLOCKS) this.tiles.push(new UnlockTile(this.scene, def, save.paid[def.id] ?? 0));
    for (const id of save.unlocked) this.applyUnlock(id, false);
    this.rebuildTower();
    this.refreshTiles(false);
    this.bus = this.buildBus();
    this.camera.position.copy(this.player.pos).add(this.camOffset);
    this.camera.lookAt(this.player.pos);
  }

  private addPad(x: number, z: number) {
    const pad = new CashPad(this.scene, x, z);
    this.cashPads.push(pad);
    return pad;
  }

  /** Stars: 1-5 (rounded down). */
  get stars() {
    return THREE.MathUtils.clamp(Math.floor(this.rating + 0.001), 1, 5);
  }
  /** Prices go up with stars: 1★ x0.8 ... 5★ x1.6 (x the gala, x your cash boosts). */
  get priceMult() {
    return (0.6 + 0.2 * this.stars) * (this.gala ? 1.5 : 1) * this.progress.cashMult;
  }
  get rooms() {
    return this.floorCount * C.roomsPerFloor;
  }
  get freeRooms() {
    return Math.max(0, this.rooms - this.occupied - this.dirty);
  }
  /** Every unlock you've bought adds a floor. */
  private get floorCount() {
    return C.baseFloors + this.save.unlocked.filter((id) => id.startsWith('h5-') && !id.startsWith('h5-star') && id !== 'h5-open').length;
  }
  private get outage() {
    return this.event === 'outage';
  }

  // --------------------------------------------------------------------------
  // The resort grounds
  // --------------------------------------------------------------------------
  private buildScene() {
    const s = this.scene;
    const sky = new THREE.Color(0x9fd8ff);
    s.background = sky;
    s.fog = new THREE.Fog(sky.getHex(), 120, 380);
    s.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.3));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // Lawn, a stone plaza in front of the tower, paths, a road for the shuttle
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x6fbf5a, 1));
    lawn.rotation.x = -Math.PI / 2;
    lawn.receiveShadow = true;
    s.add(lawn);
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(64, 26), mat(0xe8dcc8, 0.9));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.01, -8);
    plaza.receiveShadow = true;
    s.add(plaza);
    const pathMat = mat(0xd9c9ad, 0.95);
    for (const [x, z, w, d] of [[4, 12, 4, 30], [-10, 12, 26, 3.4], [16, 22, 4, 20], [-17, 10, 3.4, 22]] as const) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(x, 0.012, z);
      p.receiveShadow = true;
      s.add(p);
    }
    const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 7), mat(0x3d4247, 0.9));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.015, 33);
    s.add(road);
    for (let i = -10; i <= 10; i++) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.25), mat(0xffffff, 0.6));
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(i * 9, 0.02, 33);
      s.add(dash);
    }
    // Hedges around the grounds + palm-ish planters
    const hedge = mat(0x3f8f3a, 1);
    s.add(box(64, 1.4, 1.2, hedge, 0, 0.7, WALK.maxZ + 1.4));
    s.add(box(1.2, 1.4, 50, hedge, WALK.minX - 1.2, 0.7, 4));
    s.add(box(1.2, 1.4, 50, hedge, WALK.maxX + 1.2, 0.7, 4));
    for (const [x, z] of [[-24, -16], [24, 22], [-24, 26], [-2, 26], [28, 26], [-28, -4]]) {
      s.add(box(1.4, 0.8, 1.4, mat(0xc8b08a, 0.9), x, 0.4, z));
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), hedge);
      crown.position.set(x, 1.6, z);
      crown.castShadow = true;
      s.add(crown);
    }

    // The lobby (ground floor of the tower): glass front, revolving doors, a canopy
    const t = TOWER;
    const cx = (t.minX + t.maxX) / 2;
    const cz = (t.minZ + t.maxZ) / 2;
    s.add(box(t.maxX - t.minX, t.lobby, t.maxZ - t.minZ, mat(0xf3ead8, 0.7), cx, t.lobby / 2, cz));
    s.add(box(t.maxX - t.minX - 2, t.lobby - 1, 0.1, new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6 }), cx, (t.lobby - 1) / 2 + 0.2, t.maxZ + 0.06));
    s.add(box(14, 0.3, 4, mat(0x7a2a3a, 0.5), cx, t.lobby + 0.2, t.maxZ + 2));
    for (const x of [-6.5, 6.5]) s.add(box(0.25, t.lobby, 0.25, mat(0xd4af37, 0.3, 0.8), x, t.lobby / 2, t.maxZ + 3.8));
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(4, 16), mat(0xb3261e, 0.9));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(cx, 0.02, t.maxZ + 8);
    s.add(carpet);
    const name = new TextSprite(1.4, '#ffd166');
    name.setText('🏨 ANTHILL GRAND RESORT');
    name.sprite.position.set(cx, t.lobby + 1.6, t.maxZ + 1);
    s.add(name.sprite);
    this.towerSign.sprite.position.set(cx, t.lobby + 3.2, t.maxZ + 1);
    s.add(this.towerSign.sprite);
    this.blockers.push({ minX: t.minX - 0.4, maxX: t.maxX + 0.4, minZ: t.minZ, maxZ: t.maxZ + 0.6 });

    // The pool: shimmering water, a stone rim, deck chairs + umbrellas
    const wc = document.createElement('canvas');
    wc.width = wc.height = 128;
    const wg = wc.getContext('2d')!;
    wg.fillStyle = '#3fb8e6';
    wg.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 60; i++) {
      wg.strokeStyle = `rgba(255,255,255,${rand(0.15, 0.4)})`;
      wg.lineWidth = rand(1, 2.5);
      wg.beginPath();
      const x = rand(0, 128);
      const y = rand(0, 128);
      wg.moveTo(x, y);
      wg.quadraticCurveTo(x + 8, y + rand(-6, 6), x + 16, y);
      wg.stroke();
    }
    this.waterTex = new THREE.CanvasTexture(wc);
    this.waterTex.colorSpace = THREE.SRGBColorSpace;
    this.waterTex.wrapS = this.waterTex.wrapT = THREE.RepeatWrapping;
    this.waterTex.repeat.set(3, 2);
    const p = POOL;
    s.add(box(p.maxX - p.minX + 1.6, 0.35, p.maxZ - p.minZ + 1.6, mat(0xf4efe6, 0.8), (p.minX + p.maxX) / 2, 0.17, (p.minZ + p.maxZ) / 2));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(p.maxX - p.minX, p.maxZ - p.minZ), new THREE.MeshStandardMaterial({ map: this.waterTex, roughness: 0.1, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set((p.minX + p.maxX) / 2, 0.37, (p.minZ + p.maxZ) / 2);
    s.add(water);
    this.blockers.push({ minX: p.minX - 0.8, maxX: p.maxX + 0.8, minZ: p.minZ - 0.8, maxZ: p.maxZ + 0.8 });
    for (let i = 0; i < 4; i++) {
      const x = p.minX + 1.5 + i * 3.6;
      s.add(box(1.0, 0.35, 2.2, mat(0xffffff, 0.7), x, 0.35, p.maxZ + 2.6));
      const pole = box(0.08, 2.6, 0.08, mat(0xdddddd), x + 0.9, 1.3, p.maxZ + 2.2);
      s.add(pole);
      const umb = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 10), mat(i % 2 ? 0x2ec4b6 : 0xff6b6b, 0.7));
      umb.position.set(x + 0.9, 2.8, p.maxZ + 2.2);
      umb.castShadow = true;
      s.add(umb);
    }
    const psign = new TextSprite(0.8, '#4fe3ff');
    psign.setText('🏊 POOL & SPA');
    psign.sprite.position.set((p.minX + p.maxX) / 2, 3.2, p.minZ - 1);
    s.add(psign.sprite);
  }

  /** The tower: one band of 3 rooms per floor, windows lit by who's staying. */
  private rebuildTower() {
    const want = this.floorCount;
    const t = TOWER;
    const cx = (t.minX + t.maxX) / 2;
    const cz = (t.minZ + t.maxZ) / 2;
    const wall = mat(0xf3ead8, 0.7);
    const trim = mat(0xd4af37, 0.4, 0.6);
    while (this.floors.length < want) {
      const i = this.floors.length;
      const g = new THREE.Group();
      const y = t.lobby + i * t.floorH;
      g.add(box(t.maxX - t.minX, t.floorH, t.maxZ - t.minZ, wall, cx, y + t.floorH / 2, cz));
      g.add(box(t.maxX - t.minX + 0.4, 0.2, t.maxZ - t.minZ + 0.4, trim, cx, y + 0.1, cz));
      for (let r = 0; r < C.roomsPerFloor; r++) {
        const w = box(4.6, 2.0, 0.12, this.winMats.free, cx - 6.3 + r * 6.3, y + 1.8, t.maxZ + 0.05);
        w.castShadow = false;
        g.add(w);
        this.windows.push(w);
        g.add(box(4.8, 0.15, 0.7, trim, cx - 6.3 + r * 6.3, y + 0.7, t.maxZ + 0.35)); // balcony ledge
      }
      this.scene.add(g);
      this.floors.push(g);
      if (this.active) this.flyers.grow(g);
    }
    // The glass elevator shaft reaches the top floor
    const top = t.lobby + this.floors.length * t.floorH;
    this.shaftGlass.scale.set(1, top, 1);
    this.shaftGlass.position.set(SHAFT.x, top / 2, SHAFT.z);
    // The penthouse crown sits on the roof
    if (this.crown) this.crown.position.y = top;
    this.paintWindows();
  }

  private paintWindows() {
    this.windows.forEach((w, i) => {
      w.material = this.outage ? this.winMats.off : i < this.occupied ? this.winMats.lit : i < this.occupied + this.dirty ? this.winMats.dirty : this.winMats.free;
    });
  }

  private buildBus() {
    const g = new THREE.Group();
    g.add(box(9, 3, 2.8, mat(0x2d6cdf, 0.5), 0, 1.9, 0));
    g.add(box(8.6, 1, 2.9, new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, metalness: 0.3 }), 0, 2.5, 0));
    for (const x of [-3, 3]) for (const z of [-1.4, 1.4]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12), mat(0x222222));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.55, z);
      g.add(wheel);
    }
    const logo = new TextSprite(0.6, '#ffffff');
    logo.setText('🐜✈️ ANTHILL SHUTTLE');
    logo.sprite.position.set(0, 4, 0);
    g.add(logo.sprite);
    g.position.set(BUS_STOP.x, 0, 33);
    this.scene.add(g);
    return g;
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

  /** Someone standing at a post (concierge, engineer, pool attendant...). */
  private standAt(title: string, kind: HumanKind, x: number, z: number, face: number, animate: boolean) {
    const m = person(kind);
    m.root.position.set(x, 0, z);
    m.root.rotation.y = face;
    titleTag(m, title, TITLE.human);
    this.scene.add(m.root);
    if (animate) this.flyers.grow(m.root);
    return m;
  }

  private standing: CreatureModel[] = [];

  private applyUnlock(id: string, animate: boolean) {
    if (!id.startsWith('h5-')) return;
    const grow = (o: THREE.Object3D) => animate && this.flyers.grow(o);
    switch (id) {
      case 'h5-clerk':
        this.desk.hireStaff(person('h-crew4'), animate, '🛎️ CLERK');
        break;
      case 'h5-bellhop':
        this.crew('🧳 BELLHOP', 'h-crew1', -14, -2, () => ({ src: this.bags, srcZone: this.bagZone, dst: this.elevStack, dstZone: this.elevZone }), animate);
        break;
      case 'h5-housekeeper':
        this.crew('🧹 HOUSEKEEPER', 'h-crew2', 16, -12, () => ({ src: this.chute.stack, srcZone: this.chute.zone, dst: this.washers.input, dstZone: this.washers.inZone }), animate);
        break;
      case 'h5-linen':
        // Rooms first; any spare towels go to the pool rack
        this.crew('🧻 LINEN', 'h-ember', 14, -4, () => {
          const toPool = this.pool && this.dirty === 0 && this.pool.stock < 0.8;
          return toPool
            ? { src: this.washers.output, srcZone: this.washers.outZone, dst: this.pool!.rack, dstZone: this.pool!.zone }
            : { src: this.washers.output, srcZone: this.washers.outZone, dst: this.linen, dstZone: this.linenZone };
        }, animate);
        break;
      case 'h5-dash': {
        const pad = makePad(2.6, 2.6, 'DASH', '#ff9f43');
        pad.position.set(-21, 0.03, 0);
        this.scene.add(pad);
        this.dashZone = new Zone(-21, 0, 1.3, 1.3);
        const sign = new TextSprite(0.6, '#ff9f43');
        sign.setText('🛒 BELLHOP DASH');
        sign.sprite.position.set(-21, 2.6, 0);
        this.scene.add(sign.sprite);
        grow(pad);
        if (animate) this.hud.banner('🛒 Bellhop Dash!', `With ${C.bellhopMin}+ bags on the cart, stand on DASH: race them up for big tips`, 4500);
        break;
      }
      case 'h5-kitchen': {
        this.pantry = new ResourcePile(this.scene, -26, 12, this.flyers, 'grocery', 'pantry');
        this.pantry.spawnEvery = () => C.groceryEvery;
        this.blockers.push({ minX: -27.4, maxX: -24.6, minZ: 9.1, maxZ: 10.9 });
        this.kitchen = new Bakery(this.scene, -17, 9, this.flyers, KITCHEN);
        this.blockers.push(this.kitchen.blocker);
        const pad = this.addPad(-8.4, 20.6);
        this.buffet = new Desk(this.scene, -6, 16, this.flyers, pad, null, {
          mode: 'cafe', sells: 'tray', awning: 0xd4af37, label: '🍽️ BUFFET', color: 0x7a2a3a, kinds: GUESTS,
          interval: C.buffetInterval, queueMax: C.queueMax, serve: C.serve,
          entry: [BUS_STOP.clone().add(new THREE.Vector3(-3, 0, -2)), new THREE.Vector3(6, 0, 22)],
          exit: (from) => [new THREE.Vector3(from.x, 0, 20), new THREE.Vector3(6, 0, 24), BUS_STOP.clone().add(new THREE.Vector3(-3, 0, -2))],
        });
        this.buffet.onServe = (byPlayer) => this.progress.addXp(byPlayer ? CONFIG.xp.sale : CONFIG.xp.autoSale);
        this.buffet.valueMult = () => this.priceMult;
        this.blockers.push(this.buffet.blocker);
        [this.pantry.group, this.kitchen.group, this.buffet.group, pad.group].forEach(grow);
        if (animate) this.hud.banner('🍽️ Kitchen & Buffet open!', '🥬 Groceries -> KITCHEN -> 🍽️ trays -> the BUFFET', 4200);
        break;
      }
      case 'h5-chef':
        this.crew('👨‍🍳 CHEF', 'h-crew3', -22, 14, () => ({ src: this.pantry!.stack, srcZone: this.pantry!.zone, dst: this.kitchen!.input, dstZone: this.kitchen!.inZone }), animate);
        break;
      case 'h5-server':
        this.buffet?.hireStaff(person('h-balance'), animate, '🥗 SERVER');
        break;
      case 'h5-waiter':
        this.crew('🍽️ WAITER', 'h-exec', -12, 14, () => ({ src: this.kitchen!.output, srcZone: this.kitchen!.outZone, dst: this.buffet!.shelf!, dstZone: this.buffet!.staffZone }), animate);
        break;
      case 'h5-engineer':
        this.hasEngineer = true;
        this.standing.push(this.standAt('🔧 ENGINEER', 'h-crew1', 24, -17.5, Math.PI / 2, animate));
        if (animate) this.hud.banner('🔧 Engineer hired', 'He fixes power outages by himself', 3200);
        break;
      case 'h5-pool': {
        const holder = new THREE.Group();
        holder.position.set(10.4, 0, 7.4);
        holder.add(box(1.6, 1.0, 1.0, mat(0x8a5a33, 0.8), 0, 0.5, 0));
        this.scene.add(holder);
        const rack = new Stack(holder, gridLayout(2, 2, 0.6, 0.45, 1.02), 20);
        const pad = makePad(2.4, 2.4, 'TOWELS', '#9ee7ff');
        pad.position.set(8, 0.03, 7.4);
        this.scene.add(pad);
        this.blockers.push({ minX: 9.5, maxX: 11.3, minZ: 6.8, maxZ: 8.0 });
        const cash = this.addPad(10, 22);
        const loungers: CreatureModel[] = [];
        for (let i = 0; i < 4; i++) {
          const m = person(GUESTS[i % GUESTS.length]);
          noShadow(m.root);
          m.root.position.set(POOL.minX + 1.5 + i * 3.6, 0.5, POOL.maxZ + 2.6);
          m.root.rotation.y = Math.PI;
          m.root.visible = false;
          this.scene.add(m.root);
          loungers.push(m);
        }
        this.pool = { rack, zone: new Zone(8, 7.4, 1.2, 1.2), pad: cash, stock: 0.4, payT: 0, loungers };
        [holder, cash.group].forEach(grow);
        if (animate) this.hud.banner('🏊 Pool & Spa open!', 'Keep the TOWELS rack stocked: the loungers pay', 4200);
        break;
      }
      case 'h5-attendant':
        this.crew('🩱 ATTENDANT', 'h-crew2', 12, 4, () => ({ src: this.washers.output, srcZone: this.washers.outZone, dst: this.pool!.rack, dstZone: this.pool!.zone }), animate);
        break;
      case 'h5-concierge':
        this.hasConcierge = true;
        this.standing.push(this.standAt('🎩 CONCIERGE', 'h-director', 6, -9.4, 0, animate));
        if (animate) this.hud.banner('🎩 Concierge hired', 'Complaints get sorted out by themselves', 3200);
        break;
      case 'h5-assistant': {
        const m = person('h-sarah');
        m.root.position.set(-6, 0, 6);
        this.scene.add(m.root);
        grow(m.root);
        const tag = new TextSprite(TITLE.human, '#ffd166');
        tag.setText('💼 ASSISTANT');
        this.scene.add(tag.sprite);
        this.assistant = new Assistant(m, new THREE.Vector3(-6, 0, 6), tag, (v) => {
          v *= this.ups?.bonus ?? 1; // 💼 COLLECTORS upgrade bonus
          this.addCash(v);
          autoCash(v);
        });
        this.assistant.speed = 5.5;
        if (animate) this.hud.banner('👩‍💼 Personal Assistant', 'She collects the cash from every pad for you', 3500);
        break;
      }
      case 'h5-penthouse': {
        this.penthouse = true;
        const g = new THREE.Group();
        g.add(box(12, 3, 7, new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, metalness: 0.4 }), 0, 1.5, -25.5));
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 6), mat(0xd4af37, 0.3, 0.9));
          spike.position.set(-5 + i * 2.5, 4.2, -21.9);
          g.add(spike);
        }
        this.crown = g;
        this.scene.add(g);
        if (animate) this.hud.banner('🌟 Celebrity Penthouse!', 'A movie star moved in on the roof: it pays big, all the time', 4500);
        break;
      }
      case 'h5-gala':
        this.gala = true;
        if (animate) this.hud.banner('✨ THE 5-STAR GRAND GALA ✨', 'Celebrities everywhere: every price at the resort is x1.5 for good!', 6000);
        break;
    }
  }

  private unlock(tile: UnlockTile) {
    const id = tile.def.id;
    this.save.unlocked.push(id);
    delete this.save.paid[id];
    tile.mesh.visible = false;
    this.applyUnlock(id, true);
    this.rebuildTower(); // every unlock = one more floor
    this.progress.addXp(tile.def.cost * CONFIG.xp.unlockFraction * 0.2);
    this.sfx.unlocked();
    this.hud.floatAt(tile.mesh.position.clone().setY(2), this.camera, 'UNLOCKED! +1 FLOOR', 'big gold');
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

  /** A Bellhop Dash finished: tips for every bag that made it, and guests settle in. */
  receiveDash(endCount: number) {
    const earned = Math.round(endCount * ITEM_VALUE.bag * C.bellhopTip * this.priceMult);
    this.addCash(earned);
    const settled = Math.min(endCount, this.freeRooms);
    this.occupied += settled;
    this.progress.addXp(endCount * CONFIG.xp.runPerItem * 3);
    this.sfx.unlocked();
    this.hud.floatAt(this.player.pos.clone().setY(3), this.camera, `+$${earned} in tips`, 'big gold');
    this.paintWindows();
  }

  /** Take every bag off the cart for a Bellhop Dash. */
  takeBags() {
    const n = this.bags.count;
    this.bags.clear();
    return n;
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

  private canWalk = (x: number, z: number) => x >= WALK.minX && x <= WALK.maxX && z >= WALK.minZ && z <= WALK.maxZ;

  update(dt: number, move: THREE.Vector2) {
    // ⬆️ Upgrade pads (made on the first frame, once the world is built)
    this.ups ??= new Upgrades(
      {
        scene: this.scene, camera: this.camera, workers: this.workers, home: new THREE.Vector3(-6, 0, 6), canWalk: this.canWalk, // (home = by the assistant's spot)
        tileSpots: HOTEL_UNLOCKS.map((d) => d.pos), collectors: () => this.assistant ? [this.assistant] : [],
      },
      'hotel', this.save, this.hud, this.sfx, this.flyers, this.progress,
    );
    this.ups.update(dt, this, this.player.pos, this.active);
    const me = this.player;
    this.desk.update(dt, this.active && this.desk.staffZone.contains(me.pos), this.sfx);
    this.buffet?.update(dt, this.active && this.buffet.staffZone.contains(me.pos), this.sfx);
    this.chute.update(dt);
    this.washers.update(dt);
    this.pantry?.update(dt);
    this.kitchen?.update(dt);
    for (const w of this.workers) w.update(dt, this.flyers);
    this.assistant?.update(dt, this.cashPads, this.flyers);
    for (const m of this.standing) animateCreature(m, dt, 0);
    this.updateRooms(dt);
    this.updateElevator(dt);
    this.updatePool(dt);
    this.updateEvents(dt);
    this.updateStars(dt);
    this.updateScenery(dt);

    if (this.active) {
      const prog = this.progress;
      me.carryMax = CONFIG.player.baseCarry + 6 + prog.carryBonus;
      me.speedMult = prog.speedMult * 1.15;
      me.update(dt, move, this.blockers, this.canWalk);
      this.interact(dt);
      this.hud.setInventory(me.stack.counts(), me.stack.count, me.carryMax);
      const zone = `🏨 Resort · ${this.stars}⭐`;
      if (zone !== this.zoneShown) {
        this.zoneShown = zone;
        this.hud.setZone(zone);
      }
      this.showHint();
      this.updateCamera(dt);
    } else {
      animateCreature(me.model, dt, 0);
    }
    this.flyers.update(dt);
  }

  // ---- 🛏️ Rooms: nightly pay, check-outs (dirty rooms + laundry), linen ------
  private updateRooms(dt: number) {
    this.roomPayT += dt;
    if (this.roomPayT >= C.roomPayEvery) {
      this.roomPayT = 0;
      if (this.occupied > 0) {
        const value = this.occupied * C.roomRate * this.priceMult;
        const bills = Math.min(8, this.occupied);
        for (let i = 0; i < bills; i++) payBill(this.scene, this.flyers, this.roomsPad, this.roomsPad.group, Math.round(value / bills));
      }
    }
    if (this.penthouse) {
      this.penthouseT += dt;
      if (this.penthouseT >= C.penthouseEvery) {
        this.penthouseT = 0;
        payBill(this.scene, this.flyers, this.roomsPad, this.roomsPad.group, Math.round(C.penthousePay * this.priceMult));
      }
    }
    // Guests check out at random (on average after C.stay seconds)
    this.checkoutAcc += (dt * this.occupied) / C.stay;
    let changed = false;
    while (this.checkoutAcc >= 1 && this.occupied > 0) {
      this.checkoutAcc -= 1;
      this.occupied--;
      this.dirty++;
      for (let i = 0; i < C.laundryPerCheckout; i++) if (!this.chute.stack.full) this.chute.stack.addInstant('laundry');
      changed = true;
    }
    // Clean towels on the LINEN cart make up dirty rooms (one towel each)
    this.every(this.linen, dt, this.dirty > 0 && this.linen.canPop(), 0.4, () => {
      const it = this.linen.pop();
      if (!it) return;
      const up = new THREE.Vector3(SHAFT.x - 2, TOWER.lobby + 2, SHAFT.z);
      this.flyers.fly(it.mesh, () => up, () => it.mesh.removeFromParent(), 0.5, 1.5);
      this.dirty = Math.max(0, this.dirty - 1);
      this.paintWindows();
    });
    if (changed) this.paintWindows();
  }

  // ---- 🛗 The elevator: takes luggage up, settles guests into free rooms ----
  private updateElevator(dt: number) {
    const e = this.elev;
    const top = TOWER.lobby + Math.max(1, this.floors.length - 1) * TOWER.floorH;
    if (e.state === 'idle') {
      this.elevCar.position.y = 1.5;
      if (!this.outage && this.elevStack.canPop() && this.freeRooms > 0) {
        e.n = Math.min(C.elevatorLoad, this.elevStack.count, this.freeRooms);
        for (let i = 0; i < e.n; i++) {
          const it = this.elevStack.pop();
          if (!it) {
            e.n = i;
            break;
          }
          const car = this.elevCar.position;
          this.flyers.fly(it.mesh, () => car, () => it.mesh.removeFromParent(), 0.35, 0.8);
        }
        e.trip = C.elevatorBase + this.floors.length * 0.15;
        e.state = 'up';
        e.t = 0;
      }
    } else if (!this.outage) {
      e.t += dt;
      const half = e.trip / 2;
      const u = Math.min(1, e.t / half);
      this.elevCar.position.y = 1.5 + (e.state === 'up' ? u : 1 - u) * (top - 1.5);
      if (u >= 1) {
        if (e.state === 'up') {
          this.occupied += e.n; // each bag = a guest in their room
          e.n = 0;
          e.state = 'down';
          e.t = 0;
          this.paintWindows();
        } else e.state = 'idle';
      }
    }
  }

  // ---- 🏊 The pool: towel stock drains; while stocked, the loungers pay -----
  private updatePool(dt: number) {
    const p = this.pool;
    if (!p) return;
    p.stock = Math.max(0, p.stock - dt / C.poolDrain);
    this.every(p.rack, dt, p.stock < 0.95 && p.rack.canPop(), 0.5, () => {
      const it = p.rack.pop();
      if (!it) return;
      const seat = new THREE.Vector3(POOL.minX + rand(1, 12), 1, POOL.maxZ + 2.6);
      this.flyers.fly(it.mesh, () => seat, () => it.mesh.removeFromParent(), 0.5, 1.2);
      p.stock = Math.min(1, p.stock + C.poolPerTowel);
    });
    const open = p.stock > 0.02;
    p.loungers.forEach((m, i) => {
      m.root.visible = open && i < Math.ceil(p.stock * 4);
      if (m.root.visible) animateCreature(m, dt, 0);
    });
    if (open) {
      p.payT += dt;
      if (p.payT >= C.poolPayEvery) {
        p.payT = 0;
        payBill(this.scene, this.flyers, p.pad, p.pad.group, Math.round(C.poolPay * this.priceMult));
      }
    }
  }

  // ---- ⭐ Stars: they drift toward how well the resort is running ------------
  private updateStars(dt: number) {
    const clean = this.rooms ? 1 - this.dirty / this.rooms : 1;
    const service = 1 - Math.min(1, this.desk.waiting / C.queueMax);
    const luggage = 1 - Math.min(1, this.bags.count / 14);
    let extra = (this.kitchen ? 0.3 : 0) + (this.pool && this.pool.stock > 0.02 ? 0.3 : 0) + (this.penthouse ? 0.2 : 0);
    if (this.event === 'outage') extra -= 1;
    if (this.event === 'ants' || this.event === 'dodo') extra -= 0.5;
    const target = THREE.MathUtils.clamp(1 + 1.6 * clean + 1.0 * service + 0.8 * luggage + extra, 1, 5);
    const before = this.stars;
    this.rating += Math.sign(target - this.rating) * Math.min(Math.abs(target - this.rating), dt * 0.04);
    this.save.paid['h5-rating'] = this.rating;
    this.save.paid['h5-occ'] = this.occupied;
    this.save.paid['h5-dirty'] = this.dirty;
    const now = this.stars;
    // Star milestones unlock the fancy stuff (and stay unlocked)
    for (let n = 2; n <= now; n++) {
      const id = `h5-star${n}`;
      if (!this.save.unlocked.includes(id)) {
        this.save.unlocked.push(id);
        this.refreshTiles(true);
        if (this.active) this.hud.banner(`${'⭐'.repeat(n)} A ${n}-star resort!`, n === 3 ? 'The Pool & Spa can be built now' : n === 4 ? 'Celebrities want the Penthouse!' : n === 5 ? 'Time for the Grand Gala ✨' : 'Prices go up with every star', 4200);
        this.sfx.unlocked();
      }
    }
    if (now !== before && this.active && now < before) this.hud.banner(`⭐ Down to ${now} star${now > 1 ? 's' : ''}`, 'Clean rooms, a short line and no luggage pile-up bring them back', 3500);
    const sign = `${'⭐'.repeat(now)} · 🛏️ ${this.occupied}/${this.rooms} · 🧹 ${this.dirty}`;
    if (sign !== this.signShown) {
      this.signShown = sign;
      this.towerSign.setText(sign);
    }
  }

  // ---- 😡⚡🐜🦤 Trouble --------------------------------------------------------
  private updateEvents(dt: number) {
    if (!this.event) {
      this.eventT -= dt;
      if (this.eventT <= 0) {
        this.eventT = rand(C.eventEvery[0], C.eventEvery[1]);
        const can: HotelEvent[] = ['complaint'];
        if (this.floors.length >= 4) can.push('outage');
        if (this.kitchen) can.push('ants');
        can.push('dodo');
        this.startEvent(can[Math.floor(Math.random() * can.length)]);
      }
      return;
    }
    this.eventLeft -= dt;
    const me = this.player.pos;
    switch (this.event) {
      case 'complaint': {
        const c = this.complainer!;
        animateCreature(c.m, dt, 0);
        c.tag.setText(`😡 COMPLAINT · ${Math.ceil(this.eventLeft)}s`, this.eventLeft < 8 ? '#ff6b6b' : '#ffd166');
        c.tag.sprite.position.copy(c.m.root.position).setY(c.m.height + 0.9);
        const sorted = (this.active && this.conciergeZone.contains(me)) || (this.hasConcierge && C.complaintTime - this.eventLeft > 4);
        if (sorted) {
          const tip = Math.round(C.fee * 2 * this.priceMult);
          this.addCash(tip);
          this.rating = Math.min(5, this.rating + 0.15);
          if (this.active) this.hud.floatAt(c.m.root.position.clone().setY(H + 1), this.camera, `😊 Sorted! +$${tip}`, 'big gold');
          this.endEvent();
        } else if (this.eventLeft <= 0) {
          this.rating = Math.max(1, this.rating - 0.6);
          if (this.active) this.hud.banner('😡 A guest left a 1-star review!', 'Sort complaints out at the CONCIERGE desk in time', 3500);
          this.endEvent();
        }
        break;
      }
      case 'outage': {
        const fixing = (this.active && this.generatorZone.contains(me)) || (this.hasEngineer && C.outageLength - this.eventLeft > 8);
        this.fixT = fixing ? this.fixT + dt : 0;
        if (this.fixT >= (this.hasEngineer ? 0 : C.fixTime) && fixing) {
          if (this.active) this.hud.banner('💡 Power is back!', 'The elevator is running again', 2500);
          this.progress.addXp(30);
          this.endEvent();
        } else if (this.eventLeft <= 0) this.endEvent();
        break;
      }
      case 'ants': {
        for (let i = this.ants.length - 1; i >= 0; i--) {
          const a = this.ants[i];
          // Stomp them (they're tiny next to you!)
          if (this.active && Math.hypot(a.m.root.position.x - me.x, a.m.root.position.z - me.z) < 1.6) {
            a.m.root.removeFromParent();
            this.ants.splice(i, 1);
            const reward = Math.round(120 * this.priceMult);
            this.addCash(reward);
            this.hud.floatAt(me.clone().setY(H), this.camera, `🐜 Shoo! +$${reward}`, 'gold');
            continue;
          }
          if (stepTo(a.m, a.to, 2.4, dt)) a.to.set(-17 + rand(-4, 4), 0, 12.6 + rand(-1.5, 2.5));
          // Every few seconds one swipes a tray off the kitchen counter
          a.stealT -= dt;
          if (a.stealT <= 0) {
            a.stealT = rand(4, 7);
            const it = this.kitchen?.output.pop();
            if (it) this.flyers.fly(it.mesh, () => a.m.root.position, () => it.mesh.removeFromParent(), 0.4, 0.6);
          }
        }
        if (!this.ants.length) {
          if (this.active) this.hud.banner('🐜 The kitchen is ant-free!', 'Back to cooking', 2500);
          this.endEvent();
        } else if (this.eventLeft <= 0) this.endEvent();
        break;
      }
      case 'dodo': {
        const d = this.dodo!;
        const p = d.m.root.position;
        if (stepTo(d.m, d.to, 4.2, dt)) d.to.set(rand(-24, 24), 0, rand(-16, 24));
        if (this.active && Math.hypot(p.x - me.x, p.z - me.z) < 1.8) {
          const reward = Math.round(C.fee * 12 * this.priceMult);
          this.addCash(reward);
          this.sfx.unlocked();
          this.hud.floatAt(p.clone().setY(2.5), this.camera, `🦤 Caught! +$${reward}`, 'big gold');
          this.endEvent();
        } else if (this.eventLeft <= 0) this.endEvent();
        break;
      }
    }
  }

  private startEvent(kind: HotelEvent) {
    this.event = kind;
    const say = (title: string, sub: string) => this.active && this.hud.banner(title, sub, 4200);
    if (kind === 'complaint') {
      this.eventLeft = C.complaintTime;
      const m = person(GUESTS[Math.floor(Math.random() * GUESTS.length)]);
      m.root.position.set(8.4, 0, -5.6);
      m.root.rotation.y = -Math.PI / 2;
      this.scene.add(m.root);
      const tag = new TextSprite(TITLE.human, '#ffd166'); // (a countdown, so it lives in the scene)
      this.scene.add(tag.sprite);
      this.complainer = { m, tag };
      say('😡 A guest has a complaint!', 'Get to the CONCIERGE desk before they write a bad review');
    } else if (kind === 'outage') {
      this.eventLeft = C.outageLength;
      this.fixT = 0;
      this.paintWindows();
      say('⚡ Power outage!', this.hasEngineer ? 'The Engineer is on it…' : 'The elevator is stuck! Stand on the GENERATOR to fix it');
    } else if (kind === 'ants') {
      this.eventLeft = C.antsLength;
      for (let i = 0; i < 6; i++) {
        const m = spawnCreature('worker', 0.7) ?? makeAnt(0x5a3a22);
        m.root.position.set(-26 + rand(-1, 1), 0, 16 + rand(-1, 1));
        this.scene.add(m.root);
        this.ants.push({ m, to: new THREE.Vector3(-17 + rand(-3, 3), 0, 12.6 + rand(-1, 2)), stealT: rand(3, 6) });
      }
      say('🐜 Ants in the kitchen!', 'They\'re swiping trays! Walk over them to shoo them out');
    } else {
      this.eventLeft = C.dodoLength;
      const m = spawnDino('d-dodo', 1.0);
      if (!m) {
        // The island's models aren't loaded: have a complaint instead
        this.event = null;
        this.startEvent('complaint');
        return;
      }
      m.root.position.set(BUS_STOP.x - 4, 0, 24);
      this.scene.add(m.root);
      this.dodo = { m, to: new THREE.Vector3(0, 0, 0) };
      // Guests are too busy watching it to check in
      this.desk.opts.interval = this.deskInterval * 2;
      say('🦤 A Dodo escaped from the island!', 'It\'s loose in the resort: catch it!');
    }
  }

  private endEvent() {
    if (this.complainer) {
      this.complainer.tag.sprite.removeFromParent();
      this.complainer.m.root.removeFromParent();
      this.complainer = null;
    }
    for (const a of this.ants) a.m.root.removeFromParent();
    this.ants = [];
    if (this.dodo) {
      this.dodo.m.root.removeFromParent();
      this.dodo = null;
      this.desk.opts.interval = this.deskInterval;
    }
    this.event = null;
    this.paintWindows();
  }

  private updateScenery(dt: number) {
    if (this.waterTex) {
      this.waterTex.offset.x += dt * 0.03;
      this.waterTex.offset.y += dt * 0.015;
    }
    // The shuttle pulls up, waits, then drives off again
    this.busT = (this.busT + dt) % 24;
    const b = this.busT;
    const x = b < 4 ? BUS_STOP.x + 80 * (1 - b / 4) ** 2 : b < 14 ? BUS_STOP.x : BUS_STOP.x - 80 * ((b - 14) / 10) ** 2;
    this.bus.position.x = x;
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

    take(this.bags, this.bagZone, this.bags);
    drop(this.elevZone, this.elevZone, this.elevStack, 'bag');
    take(this.chute, this.chute.zone, this.chute.stack);
    drop(this.washers.inZone, this.washers.inZone, this.washers.input, 'laundry');
    take(this.washers.outZone, this.washers.outZone, this.washers.output);
    drop(this.linenZone, this.linenZone, this.linen, 'towel');
    if (this.pool) drop(this.pool.zone, this.pool.zone, this.pool.rack, 'towel');
    if (this.pantry && this.kitchen) {
      take(this.pantry, this.pantry.zone, this.pantry.stack);
      drop(this.kitchen.inZone, this.kitchen.inZone, this.kitchen.input, 'grocery');
      take(this.kitchen.outZone, this.kitchen.outZone, this.kitchen.output);
    }
    if (this.buffet?.shelf) drop(this.buffet.staffZone, this.buffet.staffZone, this.buffet.shelf, 'tray');

    // 🛒 Bellhop Dash
    if (this.dashZone) {
      const on = this.dashZone.contains(p);
      const ready = on && this.bags.count >= C.bellhopMin;
      if (ready) this.hud.setLaunch(this.bags.count, () => this.onDash(this.takeBags()), '🛒 BELLHOP DASH');
      else if (on || this.launchShown) this.hud.setLaunch(null);
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
    // 🗑️ Paid trash: each piece pays (see world/trash.ts), 100 pieces per 5 minutes
    const onBin = this.trash.zone.contains(p) && me.stack.count > 0;
    this.every(this.trash.zone, dt, onBin && trash.open(), 0.04, () => {
      const it = me.stack.pop();
      if (!it) return;
      this.flyers.fly(it.mesh, () => this.trash.mouth, () => it.mesh.removeFromParent(), 0.25, 1.0);
      this.sfx.drop();
      this.addCash(trash.pay(this.trash.mouth, this.camera));
    });
    trash.wait(dt, onBin, this.trash.mouth, this.camera);

    // Unlock tiles
    for (const t of this.tiles) {
      if (!t.mesh.visible) continue;
      const affordable = this.save.cash >= 1;
      t.update(dt, affordable && this.save.cash >= t.remaining);
      if (affordable && t.zone.contains(p)) {
        const rate = Math.max(t.def.cost / CONFIG.unlockDrainTime, CONFIG.unlockMinRate);
        const pay = Math.min(this.save.cash, rate * dt * clock.scale, t.def.cost - t.paid);
        t.paid += pay;
        this.save.cash -= pay;
        this.save.paid[t.def.id] = t.paid;
        this.hud.setCash(this.save.cash);
        this.sfx.unlockTick();
        if (t.paid >= t.def.cost - 1e-6) this.unlock(t);
      }
    }
  }

  /** Hints: trouble first, then the first steps of the loop. */
  private showHint() {
    const me = this.player.stack;
    let hint: string | null = null;
    if (this.event === 'complaint') hint = '😡 Complaint! Go to the CONCIERGE desk';
    else if (this.event === 'outage' && !this.hasEngineer) hint = '⚡ Power outage! Stand on the GENERATOR (east)';
    else if (this.event === 'ants') hint = '🐜 Ants in the kitchen: walk over them!';
    else if (this.event === 'dodo') hint = '🦤 Catch the escaped Dodo!';
    else if (me.has('bag')) hint = this.freeRooms > 0 ? 'Take the 🧳 luggage to the ELEVATOR (by the tower)' : 'No clean rooms! Bring 🧻 towels to LINEN';
    else if (me.has('laundry')) hint = 'Put the 🧺 laundry in the WASHERS (IN)';
    else if (me.has('towel')) hint = this.dirty > 0 ? 'Bring the 🧻 towels to LINEN: each one makes up a room' : 'Spare 🧻 towels? The pool rack takes them';
    else if (!this.save.unlocked.includes('h5-bellhop')) {
      if (this.bags.count > 0) hint = 'Grab the 🧳 luggage from the BAGS cart';
      else hint = 'Check guests in at the FRONT DESK (stand on CHECK-IN)';
    } else if (this.dirty > 2 && !this.save.unlocked.includes('h5-linen')) hint = '🧹 Dirty rooms! 🧺 Laundry -> WASHERS -> 🧻 towels -> LINEN';
    if (hint !== this.hintShown) {
      this.hintShown = hint ?? '';
      this.hud.setHint(hint);
    }
  }

  // --------------------------------------------------------------------------
  // Camera + switching worlds
  // --------------------------------------------------------------------------
  enter(flyIn: boolean) {
    this.active = true;
    this.zoneShown = '';
    this.hintShown = '-';
    this.hud.setCash(this.save.cash);
    this.intro = flyIn ? 0 : 1;
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
      // Start up by the top of the tower, then swoop down to you
      this.intro = Math.min(1, this.intro + dt / 4);
      const k = this.intro * this.intro * (3 - 2 * this.intro);
      const top = TOWER.lobby + this.floors.length * TOWER.floorH;
      const from = new THREE.Vector3(26, top + 14, 30);
      this.camera.position.lerpVectors(from, want, k);
      this.camLook.lerpVectors(new THREE.Vector3(0, top * 0.6, -25), target, k);
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
