// ============================================================================
// baseWorld.ts — the whole growing map. Owns every station, the zones, the
// unlock tiles, and runs the main idle-arcade loop:
//
//   gather -> process -> sell / gate run -> cash -> unlock tiles -> expand
//
// ZONES (see ZONES in config.ts):
//   Nest Entrance  (start)   crumbs  -> oven        -> snack packs
//   Brood Tunnels  (west)    leaves  -> leaf press  -> leaf wraps  (+ Hatchery, raft runs)
//   Hangar Floor   (south)   sugar   -> candy press -> candy
// A zone opens when its Big Order tile is bought: the fence between zones
// comes down, its stations appear, and new unlock tiles light up.
//
// The interaction rule is always the same: stand in a zone and items hop
// between stacks one at a time on a timer.
// ============================================================================
import { autoCash } from '../core/income';
import { Upgrades } from './upgradePad';
import * as THREE from 'three';
import { CONFIG, QUEEN_UNLOCK_LEVEL, TUTORIAL, UNLOCKS, ZONES, ZoneDef } from '../data/config';
import { Sfx } from '../core/audio';
import { SaveData } from '../core/save';
import { Progress, QueenProgress } from '../core/progress';
import { QueenCollector } from '../actors/queen';
import { Hud } from '../ui/hud';
import { Player, fpFov } from '../actors/player';
import { Banker, Route, Worker } from '../actors/worker';
import { Impostor } from '../actors/impostor';
import { spawnCreature, spawnProp } from '../actors/creatures';
import { animateCreature, CreatureModel } from '../actors/models';
import { Flyers, ITEM_VALUE, ItemType } from './items';
import { TextSprite, TITLE, titleTag } from './labels';
import {
  Bakery, Blocker, CashPad, Counter, DispatchPad, Hatchery, ProcessorOpts, ResourcePile, TrashBin, UnlockTile,
} from './stations';

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

const LEAF_PRESS: ProcessorOpts = { inType: 'leaf', outType: 'wrap', label: 'LEAF PRESS', cookTime: 1.6, body: 0x3f8f3a, trim: 0x2a5e27, glow: 0x9dff6a };
const CANDY_PRESS: ProcessorOpts = { inType: 'sugar', outType: 'candy', label: 'CANDY PRESS', cookTime: 2.0, body: 0xe2569b, trim: 0x9c2f68, glow: 0xffb3dc };

export class BaseWorld {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  flyers = new Flyers(this.scene);
  player: Player;

  // Every station of each kind, across all open zones
  piles: ResourcePile[] = [];
  processors: Bakery[] = [];
  counters: Counter[] = [];
  cashPads: CashPad[] = [];
  dispatches: DispatchPad[] = [];
  workers: Worker[] = [];
  bankers: Banker[] = [];
  tiles: UnlockTile[] = [];
  hatchery: Hatchery | null = null;
  trash: TrashBin[] = [];

  // Named stations (workers' routes point at these)
  bakery!: Bakery;       // the Nest oven
  counter!: Counter;     // the Nest snack counter
  leafPress: Bakery | null = null;
  market: Counter | null = null;
  candyPress: Bakery | null = null;
  shop: Counter | null = null;

  /**
   * False while you're at the airport (Act 2): the colony keeps working by
   * itself (workers, cashiers, bankers, the Queen) but the Major waits.
   */
  active = true;
  /** ⬆️ This world's upgrade pads. */
  ups: Upgrades | null = null;

  /** Set by main.ts: called when the player taps LAUNCH RUN. */
  onLaunch: (count: number, from: DispatchPad) => void = () => {};
  /** Set by main.ts: Act 1 finished (Big Order: Airstrip bought) -> open the airport. */
  onAct2: () => void = () => {};

  private backpack = false;            // "Bigger Backpack" unlock bought?
  private blockers: Blocker[] = [];    // solid things the player bumps into
  private idlers: CreatureModel[] = [];// decorative bugs (queen, larvae) that just breathe
  private open = new Set<string>();    // ids of zones you can walk in
  private walkable: Rect[] = [];
  private fences = new THREE.Group();
  private lockSigns = new Map<string, THREE.Object3D>();
  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private camOffset = new THREE.Vector3(0, 14, 10.5);
  private timers = new Map<object, number>();
  private zoneName = '';
  private impostor: Impostor | null = null;
  // The Queen: sits in her corner until you reach level 20, then collects cash for you.
  private queenModel: CreatureModel | null = null;
  private queenCrown: TextSprite | null = null;
  private queenBlocker: Blocker | null = null;
  private queenCollector: QueenCollector | null = null;
  private impostorT = 45 + Math.random() * 30; // seconds until the next sneaky visit

  constructor(private hud: Hud, private sfx: Sfx, public save: SaveData, private progress: Progress, private queenProgress: QueenProgress) {
    this.buildEnvironment();
    this.buildDecor();
    this.scene.add(this.fences);
    this.player = new Player(this.scene);

    this.openZone('nest', false);
    for (const def of UNLOCKS) this.tiles.push(new UnlockTile(this.scene, def, save.paid[def.id] ?? 0));
    // Re-apply everything bought in earlier sessions (no animations).
    for (const id of save.unlocked) this.applyUnlock(id, false);
    this.refreshTiles(false);

    if (save.queen.active || save.level >= QUEEN_UNLOCK_LEVEL) this.activateQueen(false);

    this.hud.setCash(save.cash);
    this.showTutorial();
    this.camera.position.copy(this.player.pos).add(this.camOffset);
    this.camera.lookAt(this.player.pos);
  }

  // --------------------------------------------------------------------------
  // World building
  // --------------------------------------------------------------------------
  private buildEnvironment() {
    const s = this.scene;
    s.background = new THREE.Color(0x8fd3ff);
    s.fog = new THREE.Fog(0x8fd3ff, 50, 120);

    s.add(new THREE.HemisphereLight(0xffffff, 0x8d6e4a, 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // Grass everywhere
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x79c257, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    s.add(grass);

    // Each zone's floor (locked zones get a dark overlay + a lock sign)
    for (const z of ZONES) this.buildZoneFloor(z);

    // Paths where customers walk in from outside the fence
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xb98a58, roughness: 1 });
    for (const [x, z, w] of [[34, -2.2, 40], [-62, -0.6, 40], [34, 26.5, 40]]) {
      const path = new THREE.Mesh(new THREE.PlaneGeometry(w, 6.5), pathMat);
      path.rotation.x = -Math.PI / 2;
      path.position.set(x, 0.008, z);
      path.receiveShadow = true;
      s.add(path);
    }

    // Grass tufts outside every zone (one InstancedMesh = fast)
    const tuftGeo = new THREE.ConeGeometry(0.18, 0.9, 5);
    tuftGeo.translate(0, 0.45, 0);
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0x4f9a35 }), 900);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let n = 0;
    while (n < 900) {
      const x = (Math.random() - 0.5) * 150 - 10;
      const z = (Math.random() - 0.5) * 110 + 5;
      const inZone = ZONES.some((zd) => x > zd.rect.minX - 1 && x < zd.rect.maxX + 1 && z > zd.rect.minZ - 1 && z < zd.rect.maxZ + 1);
      const onPath = (x > 14 && (Math.abs(z + 2.2) < 3.5 || Math.abs(z - 26.5) < 3.5)) || (x < -42 && Math.abs(z + 0.6) < 3.5);
      const onRunway = Math.abs(z + 30) < 6;
      if (inZone || onPath || onRunway) continue;
      pos.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), Math.random() * 0.3);
      const k = 0.6 + Math.random() * 1.4;
      scl.set(k, k, k);
      tufts.setMatrixAt(n++, m.compose(pos, q, scl));
    }
    tufts.castShadow = true;
    s.add(tufts);

    // Teaser: the old airstrip just past the fence (Act 2!)
    const runway = new THREE.Mesh(new THREE.BoxGeometry(160, 0.06, 11), new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.9 }));
    runway.position.set(0, 0.03, -30);
    runway.receiveShadow = true;
    s.add(runway);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5 });
    for (let x = -78; x <= 78; x += 8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 0.5), dashMat);
      dash.position.set(x, 0.04, -30);
      s.add(dash);
    }
    const tire = new THREE.Mesh(new THREE.TorusGeometry(5, 2.2, 16, 40), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
    tire.position.set(-24, 7.2, -23);
    tire.rotation.y = 0.7;
    tire.castShadow = true;
    s.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 2.6, 24), new THREE.MeshStandardMaterial({ color: 0xb0b6bd, metalness: 0.6, roughness: 0.4 }));
    hub.rotation.z = Math.PI / 2;
    hub.rotation.y = 0.7 + Math.PI / 2;
    hub.position.copy(tire.position);
    s.add(hub);
    const sign = new TextSprite(2.2, '#ffd166');
    sign.setText('OLD AIRSTRIP');
    sign.sprite.position.set(6, 4, -26);
    s.add(sign.sprite);
  }

  /** A speckled ground texture drawn on a canvas. */
  private floorTexture(base: string, dots: [string, string], lines = false) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const c = canvas.getContext('2d')!;
    c.fillStyle = base;
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = Math.random() < 0.5 ? dots[0] : dots[1];
      c.beginPath();
      c.arc(Math.random() * 512, Math.random() * 512, Math.random() * 4 + 1, 0, Math.PI * 2);
      c.fill();
    }
    if (lines) {
      // Painted hangar floor markings
      c.fillStyle = 'rgba(255, 201, 40, 0.85)';
      c.fillRect(0, 250, 512, 12);
      c.fillRect(250, 0, 12, 512);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
  }

  private buildZoneFloor(zd: ZoneDef) {
    const r = zd.rect;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const tex =
      zd.ground === 'tunnel'
        ? this.floorTexture('#7a5236', ['rgba(40,25,10,0.3)', 'rgba(200,160,110,0.2)'])
        : zd.ground === 'concrete'
          ? this.floorTexture('#a7adb3', ['rgba(60,60,60,0.18)', 'rgba(255,255,255,0.2)'], true)
          : this.floorTexture('#c99561', ['rgba(120,80,40,0.25)', 'rgba(255,230,190,0.25)']);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: zd.ground === 'concrete' ? 0.7 : 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((r.minX + r.maxX) / 2, 0.01, (r.minZ + r.maxZ) / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    if (zd.unlock) {
      // Locked: darken it and stand a big lock sign in the middle
      const lock = new THREE.Group();
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x1a2a1a, transparent: true, opacity: 0.45, depthWrite: false }));
      shade.rotation.x = -Math.PI / 2;
      shade.position.y = 0.02;
      const label = new TextSprite(2.0, '#ffffff');
      label.setText(`🔒 ${zd.name}`);
      label.sprite.position.y = 3;
      lock.add(shade, label.sprite);
      lock.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
      this.scene.add(lock);
      this.lockSigns.set(zd.id, lock);
    }
  }

  /** The Queen's corner, larvae, rocks, twigs and an earthworm (real 3D models). */
  private buildDecor() {
    const queen = spawnCreature('queen', 4.2);
    if (queen) {
      queen.root.position.set(-11, 0, -10.2);
      queen.root.rotation.y = 0.5;
      this.scene.add(queen.root);
      this.idlers.push(queen);
      const crown = new TextSprite(0.8, '#ffd166');
      crown.setText('👑 QUEEN');
      crown.sprite.position.set(-11, queen.height + 1.2, -10.2);
      this.scene.add(crown.sprite);
      this.queenBlocker = { minX: -12.8, maxX: -9.2, minZ: -12, maxZ: -8.6 };
      this.blockers.push(this.queenBlocker);
      this.queenModel = queen;
      this.queenCrown = crown;
    }
    // Larvae sleeping near the Queen
    for (const [x, z, r] of [[-12.6, -7.6, 0.4], [-9.3, -7.4, -0.8], [-8.6, -10.8, 2.2]]) {
      const larva = spawnCreature('larva', 1.1);
      if (!larva) continue;
      larva.root.position.set(x, 0, z);
      larva.root.rotation.y = r;
      this.scene.add(larva.root);
      this.idlers.push(larva);
    }
    // Props: inside corners and outside the fences
    const props: [Parameters<typeof spawnProp>[0], number, number, number, number][] = [
      ['rock-model', 2.0, 12.6, -11.6, 0.3],
      ['rock-model', 3.2, -47, -9, 1.2],
      ['rock-model', 2.6, 19, 7, 2.0],
      ['rock-model', 2.4, -40.5, -11.5, 0.8],
      ['twig-model', 3.0, -12.2, 9.4, 0.6],
      ['twig-model', 4.0, 17, -14, 1.4],
      ['twig-model', 3.5, -40, 9.5, 2.4],
      ['dirt-clod', 1.6, 12.4, 9.6, 0.2],
      ['dirt-clod', 2.2, -17, 14, 1.0],
      ['dirt-clod', 1.4, 18, 16, 2.2],
      ['dirt-clod', 1.8, -15.6, -11.6, 0.4],
    ];
    for (const [name, len, x, z, rot] of props) {
      const p = spawnProp(name, len);
      if (!p) continue;
      p.position.set(x, 0, z);
      p.rotation.y = rot;
      this.scene.add(p);
    }
    const worm = spawnCreature('earthworm', 6);
    if (worm) {
      worm.root.position.set(-30, 0, 17);
      worm.root.rotation.y = 1.1;
      this.scene.add(worm.root);
    }
  }

  // --------------------------------------------------------------------------
  // Zones, fences and where you can walk
  // --------------------------------------------------------------------------
  /** Two zones share an edge if one's side sits exactly on the other's. */
  private neighbor(a: ZoneDef, side: 'n' | 's' | 'e' | 'w'): ZoneDef | undefined {
    const r = a.rect;
    return ZONES.find((b) => {
      if (b === a) return false;
      const o = b.rect;
      if (side === 'w') return o.maxX === r.minX && o.minZ < r.maxZ && o.maxZ > r.minZ;
      if (side === 'e') return o.minX === r.maxX && o.minZ < r.maxZ && o.maxZ > r.minZ;
      if (side === 'n') return o.maxZ === r.minZ && o.minX < r.maxX && o.maxX > r.minX;
      return o.minZ === r.maxZ && o.minX < r.maxX && o.maxX > r.minX;
    });
  }

  /** Rebuild every fence and the walkable area from the open zones. */
  private rebuildFences() {
    // Old fences go away (free their GPU memory), then we rebuild every run.
    this.fences.children.forEach((c) => (c as THREE.InstancedMesh).dispose?.());
    this.fences.clear();
    this.postMats = [];
    this.railMats = [];
    this.walkable = [];
    for (const zd of ZONES) {
      if (!this.open.has(zd.id)) continue;
      const r = zd.rect;
      const walk = { minX: r.minX + 0.6, maxX: r.maxX - 0.6, minZ: r.minZ + 0.6, maxZ: r.maxZ - 0.6 };
      const sides: ['n' | 's' | 'e' | 'w', number, number, number, number][] = [
        ['n', r.minX, r.minZ, r.maxX, r.minZ],
        ['s', r.minX, r.maxZ, r.maxX, r.maxZ],
        ['w', r.minX, r.minZ, r.minX, r.maxZ],
        ['e', r.maxX, r.minZ, r.maxX, r.maxZ],
      ];
      for (const [side, x1, z1, x2, z2] of sides) {
        const nb = this.neighbor(zd, side);
        if (nb && this.open.has(nb.id)) {
          // Open border: no fence, and you can walk across it.
          if (side === 'w') walk.minX = r.minX - 0.7;
          if (side === 'e') walk.maxX = r.maxX + 0.7;
          if (side === 'n') walk.minZ = r.minZ - 0.7;
          if (side === 's') walk.maxZ = r.maxZ + 0.7;
          continue;
        }
        // Fence this side, leaving gaps where customers walk in.
        const along = side === 'n' || side === 's';
        const a0 = along ? x1 : z1;
        const a1 = along ? x2 : z2;
        let cur = a0;
        const gaps = zd.gaps.filter((g) => g.side === side).sort((g, h) => g.from - h.from);
        for (const g of gaps) {
          if (g.from > cur) this.fenceRun(along, cur, g.from, along ? z1 : x1);
          cur = Math.max(cur, g.to);
        }
        if (cur < a1) this.fenceRun(along, cur, a1, along ? z1 : x1);
      }
      this.walkable.push(walk);
    }
    // PERFORMANCE: every post (and every rail) is drawn in ONE draw call with
    // an InstancedMesh, instead of hundreds of separate meshes.
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a4f27, roughness: 0.9 });
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.14, 1.3, 6), mat, this.postMats.length);
    this.postMats.forEach((m, i) => posts.setMatrixAt(i, m));
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.railMats.length);
    this.railMats.forEach((m, i) => rails.setMatrixAt(i, m));
    for (const im of [posts, rails]) {
      im.castShadow = true;
      im.computeBoundingSphere();
      this.fences.add(im);
    }
  }

  private postMats: THREE.Matrix4[] = [];
  private railMats: THREE.Matrix4[] = [];

  /** A straight fence from a to b along x (along=true, at z=fixed) or along z. */
  private fenceRun(along: boolean, a: number, b: number, fixed: number) {
    if (along) this.fence(a, fixed, b, fixed);
    else this.fence(fixed, a, fixed, b);
  }

  /** Straight run of fence posts + two rails. */
  private fence(x1: number, z1: number, x2: number, z2: number) {
    // Records where each post and rail goes; rebuildFences() draws them all at once.
    const len = Math.hypot(x2 - x1, z2 - z1);
    const posts = Math.max(2, Math.round(len / 1.6) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      this.postMats.push(new THREE.Matrix4().makeTranslation(x1 + (x2 - x1) * t, 0.65, z1 + (z2 - z1) * t));
    }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(x2 - x1, z2 - z1));
    for (const y of [0.45, 0.95]) {
      this.railMats.push(new THREE.Matrix4().compose(new THREE.Vector3((x1 + x2) / 2, y, (z1 + z2) / 2), q, new THREE.Vector3(0.1, 0.1, len)));
    }
  }

  /** Can the player stand here? (Inside any open zone.) */
  private canWalk = (x: number, z: number) => this.walkable.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);

  /** Open a zone: build its stations, drop the fences between, lift the lock sign. */
  private openZone(id: string, animate: boolean) {
    if (this.open.has(id)) return;
    this.open.add(id);
    const lock = this.lockSigns.get(id);
    if (lock) lock.removeFromParent();
    const grow = (o: THREE.Object3D) => animate && this.flyers.grow(o);

    if (id === 'nest') {
      this.piles.push(new ResourcePile(this.scene, -8, -5, this.flyers, 'crumb', 'bread'));
      this.bakery = new Bakery(this.scene, 0, -9, this.flyers);
      this.processors.push(this.bakery);
      const pad = new CashPad(this.scene, 6.7, 0.8);
      this.counter = this.addCounter(new Counter(this.scene, 9, -3, this.flyers, pad), pad);
      this.blockers.push(this.bakery.blocker);
    } else if (id === 'brood') {
      const pile = new ResourcePile(this.scene, -20, -6, this.flyers, 'leaf', 'plant');
      this.piles.push(pile);
      this.leafPress = new Bakery(this.scene, -28, -9, this.flyers, LEAF_PRESS);
      this.processors.push(this.leafPress);
      const pad = new CashPad(this.scene, -33.7, 2.8);
      this.market = this.addCounter(
        new Counter(this.scene, -36, -1, this.flyers, pad, { itemType: 'wrap', facing: -1, customers: ['earthworm', 'aphid', 'housefly', 'huntsman', 'wolf-spider'], color: 0x6b8f3a }),
        pad,
      );
      this.blockers.push(this.leafPress.blocker);
      // Tunnel roots arching over the back wall
      const rootMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1 });
      for (const [x, s] of [[-17, 2.4], [-26, 3.0], [-39, 2.2]]) {
        const root = new THREE.Mesh(new THREE.TorusGeometry(s, 0.35, 8, 20, Math.PI), rootMat);
        root.position.set(x, 0, -12.4);
        root.castShadow = true;
        this.scene.add(root);
      }
      [pile.group, this.leafPress.group, this.market.group, pad.group].forEach(grow);
    } else if (id === 'hangar') {
      const pile = new ResourcePile(this.scene, -8, 17, this.flyers, 'sugar', 'vending');
      this.piles.push(pile);
      this.candyPress = new Bakery(this.scene, 2, 16, this.flyers, CANDY_PRESS);
      this.processors.push(this.candyPress);
      const pad = new CashPad(this.scene, 6.7, 30.8);
      this.shop = this.addCounter(
        new Counter(this.scene, 9, 27, this.flyers, pad, { itemType: 'candy', facing: 1, customers: ['housefly', 'black-widow', 'jumping-spider', 'huntsman'], color: 0x8a5cc8 }),
        pad,
      );
      this.blockers.push(this.candyPress.blocker);
      // A giant oil drum and a screw lying on the hangar floor
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3.2, 20), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.3 }));
      drum.position.set(11.5, 1.6, 14.5);
      drum.castShadow = true;
      this.scene.add(drum);
      this.blockers.push({ minX: 10.1, maxX: 12.9, minZ: 13.1, maxZ: 15.9 });
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4, 10), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.3 }));
      screw.rotation.z = Math.PI / 2;
      screw.rotation.y = 0.5;
      screw.position.set(-11, 0.25, 22);
      this.scene.add(screw);
      [pile.group, this.candyPress.group, this.shop.group, pad.group].forEach(grow);
    }
    // Every zone gets a trash bin for dumping the wrong items.
    const bin = id === 'nest' ? [-12, 4.5] : id === 'brood' ? [-39.5, -8] : [-11.5, 13.5];
    const t = new TrashBin(this.scene, bin[0], bin[1]);
    this.trash.push(t);
    grow(t.group);
    this.rebuildFences();
  }

  /** Register a counter (sales give XP; haggling raises the price). */
  private addCounter(c: Counter, pad: CashPad) {
    c.onSale = (byPlayer) => {
      this.tutorialDone(3);
      this.progress.addXp((byPlayer ? CONFIG.xp.sale : CONFIG.xp.autoSale) * (ITEM_VALUE[c.opts.itemType] / ITEM_VALUE.snack) ** 0.5);
    };
    c.valueMult = () => this.progress.cashMult;
    this.counters.push(c);
    this.cashPads.push(pad);
    this.blockers.push(c.blocker);
    return c;
  }

  // --------------------------------------------------------------------------
  // Worker routes
  // --------------------------------------------------------------------------
  /** Fullest pile of `type` -> the processor's IN table. */
  private gatherRoute(type: ItemType, proc: Bakery): () => Route {
    return () => {
      const piles = this.piles.filter((p) => p.type === type);
      const pile = piles.reduce((best, p) => (p.stack.count > best.stack.count ? p : best), piles[0]);
      return { src: pile.stack, srcZone: pile.zone, dst: proc.input, dstZone: proc.inZone };
    };
  }

  /** Processor OUT table -> counter shelf. */
  private deliverRoute(proc: Bakery, counter: Counter): () => Route {
    return () => ({ src: proc.output, srcZone: proc.outZone, dst: counter.shelf, dstZone: counter.sellZone });
  }

  private hire(title: string, x: number, z: number, route: () => Route, hat: { color: number; flat?: boolean }, animate: boolean, length?: number) {
    const w = new Worker(this.scene, x, z, route, hat, length);
    titleTag(w.model, title, TITLE.ant);
    this.workers.push(w);
    if (animate) this.flyers.grow(w.model.root);
  }

  /** A Banker Ant for one zone's cash pad. Once the Queen is active, her Tribute bonus applies too. */
  private hireBanker(pad: CashPad | undefined, animate: boolean) {
    if (!pad) return;
    const b = new Banker(this.scene, pad, (amount) => {
      const tribute = this.save.queen.active ? this.queenProgress.tributeMult : 1;
      const v = amount * tribute * (this.ups?.bonus ?? 1); // (+ 💼 COLLECTORS upgrade bonus)
      this.addCash(v);
      autoCash(v); // automated income: counts toward +$/min and offline pay
    });
    titleTag(b.model, '🏦 BANKER', TITLE.ant);
    this.bankers.push(b);
    if (animate) this.flyers.grow(b.model.root);
  }

  /** A baby worker from the Hatchery: alternates gathering leaves and delivering wraps. */
  private hatchling(animate: boolean) {
    if (!this.leafPress || !this.market || !this.hatchery) return;
    const gather = this.gatherRoute('leaf', this.leafPress);
    const deliver = this.deliverRoute(this.leafPress, this.market);
    let flip = this.workers.length % 2 === 0;
    const h = this.hatchery.zone;
    this.hire('🐣 HATCHLING', h.x, h.z + 1.5, () => ((flip = !flip) ? gather() : deliver()), { color: 0xffffff }, animate, 1.7);
  }

  // --------------------------------------------------------------------------
  // Unlocks
  // --------------------------------------------------------------------------
  private applyUnlock(id: string, animate: boolean) {
    const def = UNLOCKS.find((u) => u.id === id);
    if (!def) return;
    const [x, z] = def.pos;
    const grow = (o: THREE.Object3D) => animate && this.flyers.grow(o);
    switch (id) {
      // ---- Nest Entrance ----
      case 'pile2': {
        const pile = new ResourcePile(this.scene, x, z, this.flyers, 'crumb', 'bread');
        this.piles.push(pile);
        grow(pile.group);
        break;
      }
      case 'cashier':
        this.counter.hireCashier(animate);
        break;
      case 'dispatch': {
        const d = new DispatchPad(this.scene, x, z, 'snack', 'grass');
        this.dispatches.push(d);
        this.blockers.push(d.blocker);
        grow(d.group);
        break;
      }
      case 'carry1':
        this.backpack = true;
        break;
      case 'worker1':
      case 'worker2':
        this.hire('🐜 WORKER', x, z, this.gatherRoute('crumb', this.bakery), { color: 0xffc928 }, animate);
        break;
      case 'runner':
        this.hire('🏃 RUNNER', x, z, this.deliverRoute(this.bakery, this.counter), { color: 0xe63946, flat: true }, animate);
        break;
      // (case 'conveyor' is gone: the Runner Ant does that job now)
      case 'oven2':
        this.bakery.makeFaster();
        break;
      case 'banker':
        this.hireBanker(this.cashPads[this.counters.indexOf(this.counter)], animate);
        break;
      case 'expand':
        this.openZone('brood', animate);
        if (animate) this.hud.banner('Brood Tunnels open! 🐜', 'Head west through the fence', 4000);
        break;

      // ---- Brood Tunnels ----
      case 'leaf2': {
        const pile = new ResourcePile(this.scene, x, z, this.flyers, 'leaf', 'plant');
        this.piles.push(pile);
        grow(pile.group);
        break;
      }
      case 'cashier2':
        this.market?.hireCashier(animate);
        break;
      case 'leafant':
        if (this.leafPress) this.hire('🍃 LEAF ANT', x, z, this.gatherRoute('leaf', this.leafPress), { color: 0x7df9a0 }, animate);
        break;
      case 'wraprunner':
        if (this.leafPress && this.market) this.hire('🏃 RUNNER', x, z, this.deliverRoute(this.leafPress, this.market), { color: 0xe63946, flat: true }, animate);
        break;
      case 'hatchery': {
        this.hatchery = new Hatchery(this.scene, x, z, this.flyers, this.save.hatched, 4);
        this.hatchery.onHatch = () => {
          this.save.hatched = this.hatchery!.hatched;
          this.hatchling(true);
          this.sfx.unlocked();
          this.hud.banner('An egg hatched! 🐣', 'A new worker joins the Brood Tunnels', 2600);
        };
        for (let i = 0; i < this.save.hatched; i++) this.hatchling(false);
        grow(this.hatchery.group);
        break;
      }
      case 'raft': {
        const d = new DispatchPad(this.scene, x, z, 'wrap', 'gutter');
        this.dispatches.push(d);
        this.blockers.push(d.blocker);
        grow(d.group);
        break;
      }
      case 'press2':
        this.leafPress?.makeFaster();
        break;
      case 'leafant2':
        if (this.leafPress) this.hire('🍃 LEAF ANT', x, z, this.gatherRoute('leaf', this.leafPress), { color: 0x7df9a0 }, animate);
        break;
      case 'banker2':
        if (this.market) this.hireBanker(this.cashPads[this.counters.indexOf(this.market)], animate);
        break;
      case 'expand2':
        this.openZone('hangar', animate);
        if (animate) this.hud.banner('Hangar Floor open! 🏭', 'Head south through the fence', 4000);
        break;

      // ---- Hangar Floor ----
      case 'sugar2': {
        const pile = new ResourcePile(this.scene, x, z, this.flyers, 'sugar', 'vending');
        this.piles.push(pile);
        grow(pile.group);
        break;
      }
      case 'cashier3':
        this.shop?.hireCashier(animate);
        break;
      case 'sugarant':
        if (this.candyPress) this.hire('🍬 SUGAR ANT', x, z, this.gatherRoute('sugar', this.candyPress), { color: 0xff6fb5 }, animate);
        break;
      case 'candyrunner':
        if (this.candyPress && this.shop) this.hire('🏃 RUNNER', x, z, this.deliverRoute(this.candyPress, this.shop), { color: 0xe63946, flat: true }, animate);
        break;
      case 'candy2':
        this.candyPress?.makeFaster();
        break;
      case 'sugarant2':
        if (this.candyPress) this.hire('🍬 SUGAR ANT', x, z, this.gatherRoute('sugar', this.candyPress), { color: 0xff6fb5 }, animate);
        break;
      case 'banker3':
        if (this.shop) this.hireBanker(this.cashPads[this.counters.indexOf(this.shop)], animate);
        break;
      case 'expand3':
        if (animate) this.onAct2();
        break;
    }
  }

  private unlock(tile: UnlockTile) {
    const id = tile.def.id;
    this.save.unlocked.push(id);
    delete this.save.paid[id];
    tile.mesh.visible = false;
    this.applyUnlock(id, true);
    this.progress.addXp(tile.def.cost * CONFIG.xp.unlockFraction);
    this.sfx.unlocked();
    this.hud.floatAt(tile.mesh.position.clone().setY(1.5), this.camera, 'UNLOCKED!', 'big gold');
    this.tutorialDone(5);
    this.refreshTiles(true);
  }

  /** Show tiles whose requirements are met and that aren't bought yet. */
  private refreshTiles(animate: boolean) {
    for (const t of this.tiles) {
      const owned = this.save.unlocked.includes(t.def.id);
      const ready = t.def.requires.every((r) => this.save.unlocked.includes(r));
      const show = !owned && ready;
      if (show && !t.mesh.visible && animate) this.flyers.grow(t.mesh);
      t.mesh.visible = show;
    }
  }

  // --------------------------------------------------------------------------
  // Tutorial
  // --------------------------------------------------------------------------
  private showTutorial() {
    const i = this.save.tutorial;
    this.hud.setHint(i < TUTORIAL.length ? TUTORIAL[i] : null);
  }

  /** Mark tutorial step `step` done (only if it's the current one). */
  private tutorialDone(step: number) {
    if (this.save.tutorial === step) {
      this.save.tutorial++;
      this.showTutorial();
    }
  }

  // --------------------------------------------------------------------------
  // Money
  // --------------------------------------------------------------------------
  addCash(amount: number) {
    this.save.cash += amount;
    this.hud.setCash(this.save.cash);
  }

  /** Called by main.ts when a gate run finishes. */
  receiveRunPayout(endCount: number, itemType: ItemType = 'snack') {
    const earned = Math.round(endCount * ITEM_VALUE[itemType] * this.progress.cashMult);
    this.addCash(earned);
    this.progress.addXp(endCount * CONFIG.xp.runPerItem * (ITEM_VALUE[itemType] / ITEM_VALUE.snack) ** 0.5);
    this.sfx.unlocked();
    this.hud.floatAt(this.player.pos.clone().setY(2.5), this.camera, `+$${earned}`, 'big gold');
  }

  // --------------------------------------------------------------------------
  // Per-frame update
  // --------------------------------------------------------------------------
  /** Runs `fn` every `interval` seconds while `active` is true (one timer per `key`). */
  private every(key: object, dt: number, active: boolean, interval: number, fn: () => void) {
    if (!active) {
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
    // ⬆️ Upgrade pads (made on the first frame, once the world is built)
    this.ups ??= new Upgrades(
      {
        scene: this.scene, camera: this.camera, workers: this.workers, home: this.player.pos.clone(), canWalk: this.canWalk,
        tileSpots: UNLOCKS.map((d) => d.pos), collectors: () => [...this.bankers, ...(this.queenCollector ? [this.queenCollector] : [])],
        ready: () => this.save.unlocked.includes('worker1'), // (keeps a brand-new game simple)
      },
      'ant', this.save, this.hud, this.sfx, this.flyers, this.progress,
    );
    this.ups.update(dt, this, this.player.pos, this.active);
    const p = this.player.pos;
    const prog = this.progress;
    const xp = CONFIG.xp;
    const me = this.player;
    this.player.carryMax = CONFIG.player.baseCarry + (this.backpack ? CONFIG.player.carryPerUpgrade : 0) + prog.carryBonus;
    this.player.speedMult = prog.speedMult;
    if (this.active) this.player.update(dt, move, this.blockers, this.canWalk);
    for (const m of this.idlers) animateCreature(m, dt, 0);

    for (const pile of this.piles) pile.update(dt);
    for (const proc of this.processors) proc.update(dt);
    for (const c of this.counters) c.update(dt, this.active && c.sellZone.contains(p), this.sfx, p);
    for (const d of this.dispatches) d.update(dt);
    for (const w of this.workers) w.update(dt, this.flyers);
    for (const b of this.bankers) b.update(dt, this.flyers);
    this.hatchery?.update(dt);

    if (!this.active) {
      // In the background: no player, no HUD, no impostor. The Queen still works.
      this.queenCollector?.update(dt, this.cashPads, this.flyers);
      this.flyers.update(dt);
      return;
    }

    const iv = CONFIG.player.pickupInterval / prog.workMult;
    const has = (t: ItemType) => me.stack.has(t); // carrying this type anywhere in the stack?

    // 1) Resource piles -> player
    for (const pile of this.piles) {
      this.every(pile.zone, dt, pile.zone.contains(p) && me.canTake(pile.type), iv, () => {
        if (me.canTake(pile.type) && this.flyers.transfer(pile.stack, me.stack)) {
          this.sfx.pickup();
          prog.addXp(xp.pickup);
          this.tutorialDone(0);
        }
      });
    }

    // 2) Processors: drop raw items on IN, pick goods up from OUT
    for (const proc of this.processors) {
      const { inType, outType } = proc.opts;
      this.every(proc.inZone, dt, proc.inZone.contains(p) && has(inType), iv, () => {
        if (this.flyers.transferType(me.stack, proc.input, inType)) {
          this.sfx.drop();
          prog.addXp(xp.drop);
          this.tutorialDone(1);
        }
      });
      this.every(proc.outZone, dt, proc.outZone.contains(p) && me.canTake(outType), iv, () => {
        if (me.canTake(outType) && this.flyers.transfer(proc.output, me.stack)) {
          this.sfx.pickup();
          prog.addXp(xp.pickup);
          this.tutorialDone(2);
        }
      });
    }

    // 3) Goods -> counter shelves
    for (const c of this.counters) {
      const type = c.opts.itemType;
      this.every(c.sellZone, dt, c.sellZone.contains(p) && has(type), iv, () => {
        if (this.flyers.transferType(me.stack, c.shelf, type)) {
          this.sfx.drop();
          prog.addXp(xp.drop);
        }
      });
    }

    // 4) Cash pads -> wallet
    for (const pad of this.cashPads) {
      this.every(pad.zone, dt, pad.zone.contains(p), 0.035, () => {
        const bill = pad.stack.pop();
        if (!bill) return;
        const target = new THREE.Vector3();
        this.flyers.fly(
          bill.mesh,
          () => target.copy(p).setY(1.2),
          () => {
            bill.mesh.removeFromParent();
            this.addCash(bill.value);
            this.sfx.cash();
            this.tutorialDone(4);
          },
          0.22,
          0.8,
        );
      });
    }

    // 4b) Trash bins: dump everything you're carrying
    for (const bin of this.trash) {
      this.every(bin.zone, dt, bin.zone.contains(p) && me.stack.count > 0, 0.04, () => {
        const it = me.stack.pop();
        if (!it) return;
        this.flyers.fly(it.mesh, () => bin.mouth, () => it.mesh.removeFromParent(), 0.25, 1.0);
        this.sfx.drop();
      });
    }

    // 5) Hatchery: feed it leaf wraps
    const hatch = this.hatchery;
    if (hatch) {
      this.every(hatch.zone, dt, hatch.zone.contains(p) && has('wrap') && hatch.hatched < hatch.maxHatch, iv, () => {
        if (this.flyers.transferType(me.stack, hatch.input, 'wrap')) {
          this.sfx.drop();
          prog.addXp(xp.drop);
        }
      });
    }

    // 6) Gate-run carts / rafts: load goods, then LAUNCH
    let launchFrom: DispatchPad | null = null;
    for (const d of this.dispatches) {
      const here = d.zone.contains(p);
      this.every(d.zone, dt, here && has(d.itemType), iv, () => {
        if (this.flyers.transferType(me.stack, d.cargo, d.itemType)) {
          this.sfx.drop();
          prog.addXp(xp.drop);
        }
      });
      if (here && d.cargo.count >= CONFIG.cart.minLaunch) launchFrom = d;
    }
    if (launchFrom) {
      const d: DispatchPad = launchFrom;
      this.hud.setLaunch(d.cargo.count, () => {
        const count = d.cargo.count;
        d.cargo.clear();
        this.hud.setLaunch(null);
        this.onLaunch(count, d);
      });
    } else {
      this.hud.setLaunch(null);
    }

    // 7) Unlock tiles: stand on one to pour cash in
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

    // 8) The Ant-Mimicking Spider sneaks in now and then to steal
    this.updateImpostor(dt);

    // 9) The Queen collects cash from every pad (once she's active)
    this.queenCollector?.update(dt, this.cashPads, this.flyers);

    // Inventory panel
    this.hud.setInventory(me.stack.counts(), me.stack.count, me.carryMax);

    // Zone name in the HUD follows where you're standing
    const here = ZONES.find((zd) => this.open.has(zd.id) && p.x >= zd.rect.minX - 0.7 && p.x <= zd.rect.maxX + 0.7 && p.z >= zd.rect.minZ - 0.7 && p.z <= zd.rect.maxZ + 0.7);
    const name = this.save.unlocked.includes('expand3') ? `🏆 ${here?.name ?? ''}` : here?.name ?? '';
    if (name !== this.zoneName) {
      this.zoneName = name;
      this.hud.setZone(name);
    }

    this.flyers.update(dt);
    this.updateCamera(dt);
  }

  /** Coming back from the airport: refresh the HUD for the colony. */
  enter() {
    this.active = true;
    this.zoneName = '';
    this.showTutorial();
    this.hud.setCash(this.save.cash);
  }

  /** Level 20: the Queen leaves her corner and starts collecting your cash. */
  activateQueen(announce: boolean) {
    if (this.queenCollector || !this.queenModel || !this.queenCrown) return;
    this.save.queen.active = true;
    this.idlers = this.idlers.filter((m) => m !== this.queenModel);
    this.blockers = this.blockers.filter((b) => b !== this.queenBlocker); // her corner is open now
    this.queenCrown.setText('👑 QUEEN · Lv ' + this.save.queen.level);
    this.queenCollector = new QueenCollector(this.queenModel, this.queenCrown, new THREE.Vector3(-11, 0, -9), this.queenProgress, (amount) => {
      amount *= this.ups?.bonus ?? 1; // 💼 COLLECTORS upgrade bonus
      this.addCash(amount);
      autoCash(amount); // automated income: counts toward +$/min and offline pay
    });
    this.queenProgress.onLevelUp = (lv) => {
      this.queenCrown?.setText('👑 QUEEN · Lv ' + lv);
      this.sfx.unlocked();
      this.hud.banner(`👑 The Queen reached Lv ${lv}!`, 'Tap your level (top left) to give her a point', 2600);
    };
    if (announce) {
      this.sfx.unlocked();
      this.hud.banner('👑 The Queen joins the economy!', 'She now walks the colony collecting your cash', 4500);
    }
  }

  /** Spawn, run and reward the impostor spider. */
  private updateImpostor(dt: number) {
    if (!this.impostor) {
      if (!this.save.unlocked.includes('pile2')) return; // not until you've got going
      this.impostorT -= dt;
      if (this.impostorT > 0) return;
      this.impostorT = 60 + Math.random() * 45;
      const pile = this.piles[Math.floor(Math.random() * this.piles.length)];
      // It sneaks in through that zone's customer gap.
      const exit = pile.zone.x < -14 ? new THREE.Vector3(-45, 0, -0.6) : pile.zone.z > 11 ? new THREE.Vector3(17, 0, 26.5) : new THREE.Vector3(17, 0, -2.5);
      this.impostor = new Impostor(this.scene, pile, exit);
      return;
    }
    const imp = this.impostor;
    const ev = imp.update(dt, this.player.pos, this.flyers);
    const at = imp.pos.clone().setY(2.5);
    const tier = imp.pile.type === 'sugar' ? 3 : imp.pile.type === 'leaf' ? 2 : 1;
    if (ev === 'stealing') {
      this.hud.floatAt(at, this.camera, '🕷️ IMPOSTOR!', 'big bad');
      this.hud.banner('An impostor is stealing! 🕷️', 'That "ant" is a spider. Run into it!', 2600);
      this.sfx.gateBad();
    } else if (ev === 'caught') {
      const reward = [0, 40, 150, 500][tier];
      this.addCash(reward);
      this.progress.addXp(15 * tier);
      this.sfx.unlocked();
      this.hud.floatAt(at, this.camera, `Caught! +$${reward}`, 'big gold');
    } else if (ev === 'escaped') {
      this.hud.floatAt(this.player.pos.clone().setY(2.5), this.camera, 'The impostor got away! 😤', 'bad');
    }
    if (imp.done) this.impostor = null;
  }

  /** Change the shadow map resolution (auto quality). */
  setShadowSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null; // rebuilt at the new size next frame
  }

  private updateCamera(dt: number) {
    const target = this.player.pos;
    this.setFov(this.player.firstPerson ? fpFov(this.camera.aspect) : this.thirdFov);
    if (this.player.firstPerson) {
      this.player.placeEyeCamera(this.camera);
      this.sun.position.set(target.x + 8, 20, target.z + 9);
      this.sun.target.position.copy(target);
      return;
    }
    const want = new THREE.Vector3().copy(target).add(this.camOffset);
    this.camera.position.lerp(want, Math.min(1, dt * 5));
    this.camera.lookAt(this.camera.position.x - this.camOffset.x, 0, this.camera.position.z - this.camOffset.z);
    // Keep the shadow box centered on the player.
    this.sun.position.set(target.x + 8, 20, target.z + 9);
    this.sun.target.position.copy(target);
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
    // Portrait phones need the camera further back to see enough of the yard.
    const portrait = w < h;
    this.camOffset.set(0, portrait ? 18 : 14.5, portrait ? 16 : 14);
    this.thirdFov = portrait ? 56 : 42;
    this.camera.fov = this.player.firstPerson ? fpFov(this.camera.aspect) : this.thirdFov;
    this.camera.updateProjectionMatrix();
  }
}
