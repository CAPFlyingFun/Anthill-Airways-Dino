// ============================================================================
// upgradePad.ts — the ⬆️ UPGRADE PADS.
//
// Every world owns one `Upgrades` manager. Each frame it:
//   1. FINDS buildings that don't have a pad yet (machines, piles, counters /
//      desks) and puts a pad next to each one, on a free spot of floor.
//      (So anything an unlock builds gets its pad automatically.)
//   2. Adds a 👷 CREW pad (all helpers) and a 💼 COLLECTORS pad (bankers, the
//      Queen, assistants) once the world has any.
//   3. APPLIES every pad's level to its building (speed, prices, carry...).
//   4. Lets you pour cash into the pad you're standing on (after a short
//      pause, so walking over one doesn't spend by accident).
//
// Pad ids are stable ("i3-up-blender@-12,6"), so levels load back onto the
// same building, and island / volcano ones (i3- / v4-) reset on an eruption.
// ============================================================================
import { clock } from '../core/clock';
import * as THREE from 'three';
import type { Text } from 'troika-three-text';
import { SaveData } from '../core/save';
import { Sfx } from '../core/audio';
import { Progress } from '../core/progress';
import { bump } from '../core/totals';
import { COLONY_ZONE_BASE, UP_BASE, UP_KINDS, UP_MAX, UpKind, up, upCost } from '../core/upgrades';
import { Hud } from '../ui/hud';
import { Flyers } from './items';
import { GAME_FONT, TEXT_RES, TextSprite, groundText, roundRect, setGroundText, sharpTexture } from './labels';
import { Blocker, Zone } from './stations';
import { TRASH } from './trash';
import { CONFIG, ZONES } from '../data/config';
import type { Worker } from '../actors/worker';

/** Which world a manager belongs to (also the save key for helpers' XP). */
export type WorldKey = 'ant' | 'air' | 'island' | 'volcano' | 'hotel';
/** Id prefix per world (matches the unlock ids, so eruptions wipe i3- / v4-). */
const PREFIX: Record<WorldKey, string> = { ant: 'c1', air: 'a2', island: 'i3', volcano: 'v4', hotel: 'h5' };

/** Pad width: the human-scale worlds are seen from farther away, so their pads are bigger. */
const SIZES: Record<WorldKey, number> = { ant: 2.3, air: 3.0, island: 3.0, volcano: 3.0, hotel: 3.0 };
const DWELL = 0.6; // seconds you must stand on a pad before cash starts pouring

// ---- Duck types for the buildings (so this file needn't import every world) --
interface MachineLike { group: THREE.Group; inZone: Zone; outZone: Zone; speedMult: number; opts: { label: string } }
interface PileLike { group: THREE.Group; zone: Zone; type: string; rateMult: number; spawnEvery: () => number }
interface SellerLike { group: THREE.Group; priceMult: number; paceMult: number; opts: { label?: string; itemType?: string } }
interface CollectorLike { boost: number }

const isMachine = (o: any): o is MachineLike => o && o.inZone instanceof Zone && o.outZone instanceof Zone && typeof o.speedMult === 'number';
const isPile = (o: any): o is PileLike => o && o.zone instanceof Zone && typeof o.rateMult === 'number' && typeof o.spawnEvery === 'function';
const isSeller = (o: any): o is SellerLike => o && typeof o.priceMult === 'number' && typeof o.paceMult === 'number' && o.group;
const isBin = (o: any) => o && o.mouth instanceof THREE.Vector3 && o.zone instanceof Zone && o.group;

/** Short names for each pile type ("CRUMBS"), shown on its pad. */
const PILE_NAME: Record<string, string> = {
  crumb: 'CRUMBS', leaf: 'LEAVES', sugar: 'SUGAR', snackbox: 'EXPORTS', fruit: 'FRUIT', meat: 'DINO FOOD', egg: 'NESTS',
  obsidian: 'OBSIDIAN', magma: 'LAVA VENT', crystal: 'VAULT', grocery: 'GROCERIES', laundry: 'LAUNDRY',
};
/** "☕ Ant Café" -> "ANT CAFÉ" (emoji off; the pad paints its own icons). */
const clean = (s: string) => s.replace(/[^\p{L}\p{N} \-&']/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();

const SELLER_NAME: Record<string, string> = { snack: 'SNACK SHOP', wrap: 'WRAP MARKET', candy: 'CANDY SHOP' };

// ============================================================================
// One pad on the ground
// ============================================================================
export class UpgradePad {
  mesh: THREE.Mesh;
  zone: Zone;
  dwell = 0;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private nameText: Text;
  private priceText: Text;
  private shown = '';
  private pulseT = Math.random() * 6;
  /** Highest level (most pads: 10). */
  max = UP_MAX;
  /** Price of the next level. */
  costOf = (lv: number) => upCost(this.base, lv);
  /** Name shown on the pad at a level. */
  titleOf = (lv: number) => `${this.label} · Lv ${lv}`;
  /** Second icon on the pad at a level. */
  iconOf = (_lv: number) => UP_KINDS[this.kind].icon;

  constructor(scene: THREE.Scene, public id: string, public kind: UpKind, public label: string, x: number, z: number, public base: number, private size: number) {
    const SIZE = size;
    this.canvas.width = this.canvas.height = 256 * TEXT_RES;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = sharpTexture(this.canvas);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(x, 0.05, z);
    this.mesh.renderOrder = 2;
    this.nameText = groundText('', 0.3, '#ffffff', SIZE * 0.9);
    this.nameText.position.y = -0.12;
    this.priceText = groundText('', 0.46, '#ffffff', SIZE * 0.86);
    this.priceText.position.y = -0.62;
    this.mesh.add(this.nameText, this.priceText);
    scene.add(this.mesh);
    this.zone = new Zone(x, z, SIZE * 0.42, SIZE * 0.42);
  }

  /** Repaint only when something visible changed. */
  draw(level: number, remaining: number, affordable: boolean) {
    const SIZE = this.size;
    const maxed = level >= this.max;
    const key = `${level}|${remaining}|${affordable}`;
    if (key === this.shown) return;
    const repaint = this.shown.split('|')[2] !== String(affordable) || this.shown.split('|')[0] !== String(level);
    this.shown = key;
    setGroundText(this.priceText, maxed ? 'MAX' : `$${remaining.toLocaleString()}`, maxed ? '#7df9a0' : affordable ? '#ffe066' : '#ffffff', SIZE * 0.86);
    if (!repaint) return;
    setGroundText(this.nameText, this.titleOf(level), '#ffffff', SIZE * 0.9);
    const c = this.ctx;
    c.setTransform(TEXT_RES, 0, 0, TEXT_RES, 0, 0);
    c.clearRect(0, 0, 256, 256);
    roundRect(c, 12, 12, 232, 232, 116); // a circle-ish pill: tells pads apart from unlock tiles
    c.fillStyle = maxed ? 'rgba(20, 70, 40, 0.55)' : 'rgba(45, 25, 80, 0.55)';
    c.fill();
    c.setLineDash([20, 12]);
    c.lineWidth = 10;
    c.strokeStyle = maxed ? '#7df9a0' : affordable ? '#ffe066' : '#c9a6ff';
    c.stroke();
    c.setLineDash([]);
    c.font = `70px ${GAME_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(maxed ? '⭐' : '⬆️', 98, 78);
    c.fillText(this.iconOf(level), 160, 78);
    this.tex.needsUpdate = true;
  }

  pulse(dt: number, on: boolean) {
    this.pulseT += dt;
    const s = on ? 1 + Math.sin(this.pulseT * 5) * 0.04 : 1;
    this.mesh.scale.set(s, s, 1);
  }
}

// ============================================================================
// ⚠️ STATUS TAGS: a little warning over a station only while something's wrong
// (an idle oven, a full shelf…), so you can see where production is stuck.
// ============================================================================
/** What a machine's input is called in "needs …". */
const NEEDS: Record<string, string> = {
  crumb: 'crumbs', leaf: 'leaves', sugar: 'sugar', fruit: 'fruit', obsidian: 'obsidian', laundry: 'laundry',
  grocery: 'groceries', meat: 'meat', magma: 'magma', gem: 'gems', snackbox: 'snack boxes',
};

interface Status {
  o: any;
  kind: 'machine' | 'seller';
  tag: TextSprite;
  top: number;      // height of the station's roof (the tag floats above it)
  problem: string;  // what's wrong right now ('' = all good)
  since: number;    // how long it's been that way
}

/** What's wrong with a machine right now ('' = nothing). */
function machineProblem(o: any) {
  if (o.output.full) return '📦 OUT full · pick it up';
  if (o.input.count === 0 && !o.cooking && o.output.count === 0) return `😴 Idle · needs ${NEEDS[o.opts.inType] ?? o.opts.inType}`;
  return '';
}

/** What's wrong with a counter / desk right now ('' = nothing). */
function sellerProblem(o: any) {
  // How many are waiting (counters keep 1-2 lines of customers, desks report it)
  const waiting: number = o.queues ? o.queues.reduce((n: number, q: unknown[]) => n + q.length, 0) : 0;
  const staffed = !!(o.hasCashier || o.hasStaff);
  if (o.bagPile?.full) return '🧳 BAGS full · pick them up';
  if (!staffed && waiting >= 3) return '🙋 No cashier · stand here';
  const shelf = o.shelf;
  if (!shelf) return '';
  // (nearly full: customers keep taking one, so it's rarely exactly full)
  if (shelf.count >= shelf.max * 0.8 && waiting >= 2) return '🛒 Shelf full · slow buyers';
  if (shelf.count === 0 && waiting >= 2) return '😟 Shelf empty · buyers waiting';
  return '';
}

// ============================================================================
// Everything a world needs to give the manager
// ============================================================================
export interface UpgradeHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  workers: Worker[];
  /** Where the 👷 CREW / 💼 COLLECTORS pads try to go (near the start). */
  home: THREE.Vector3;
  /** Can the player stand at (x, z)? (Pads must be reachable.) */
  canWalk: (x: number, z: number) => boolean;
  /** Every unlock tile spot, bought or not (pads never cover a future building). */
  tileSpots: [number, number][];
  /** Collectors in this world right now (bankers / the Queen / an assistant). */
  collectors: () => CollectorLike[];
  /** Pads only appear once this is true (the colony waits for your first Worker Ant). */
  ready?: () => boolean;
}

interface Target {
  pad: UpgradePad;
  /** Puts the level into effect (`animate` = just bought, not loading a save). */
  apply: (lv: number, animate?: boolean) => void;
  /** The building it belongs to (pads stay near it if they have to move). */
  near: THREE.Vector3;
  /** Only shown (and buyable) while this is true. */
  visible?: () => boolean;
}

export class Upgrades {
  private targets: Target[] = [];
  private seen = new Set<object>();
  private buildings: THREE.Object3D[] = []; // every building's 3D group (for footprints)
  private box = new THREE.Box3();
  /** Seconds until pads recheck for anything built on top of them (-1 = no). */
  private recheckT = 1;
  private unlockedSeen = -1;
  private piles = new Map<string, PileLike[]>(); // one pad per pile TYPE
  private scanT = 0;
  private crewLoaded = 0; // helpers whose saved XP has been loaded
  private statuses: Status[] = [];
  private statusT = 0;
  private active = false;

  constructor(private host: UpgradeHost, private world: WorldKey, private save: SaveData, private hud: Hud, private sfx: Sfx, private flyers: Flyers, private progress: Progress) {
    save.crewXp[world] ??= [];
  }

  /** A pad's base price: per world, and in the colony per zone (Nest / Tunnels / Hangar). */
  private baseAt(near: THREE.Vector3) {
    if (this.world !== 'ant') return UP_BASE[this.world];
    const zone = ZONES.find((z) => near.x >= z.rect.minX && near.x <= z.rect.maxX && near.z >= z.rect.minZ && near.z <= z.rect.maxZ);
    return COLONY_ZONE_BASE[zone?.id ?? 'nest'] ?? UP_BASE.ant;
  }

  /** Where the nearest shown pad is (for the tutorial's arrow), or null. */
  nearestPad(from: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let d = Infinity;
    for (const t of this.targets) {
      if (!t.pad.mesh.visible) continue;
      const p = t.pad.mesh.position;
      const dd = (p.x - from.x) ** 2 + (p.z - from.z) ** 2;
      if (dd < d) {
        d = dd;
        best = new THREE.Vector3(p.x, 0, p.z);
      }
    }
    return best;
  }

  /** Levels bought on a pad. */
  level(id: string) {
    return this.save.upgrades[id] ?? 0;
  }

  /** 💼 bonus on cash the collectors bring in (1 = none). */
  get bonus() {
    return up.bonus(this.level(this.id('collectors')));
  }

  private id(name: string) {
    return `${PREFIX[this.world]}-up-${name}`;
  }

  // ---- Finding buildings ------------------------------------------------------
  /**
   * Look through the world for buildings without a pad: its own fields, any
   * arrays of stations, and stations kept inside other objects (two levels).
   */
  private scan(root: any) {
    const found: any[] = [];
    const visit = (o: any, depth: number) => {
      if (!o || typeof o !== 'object' || o instanceof THREE.Object3D || depth > 2) return;
      if (isMachine(o) || isPile(o) || isSeller(o) || isBin(o)) {
        found.push(o);
        return;
      }
      const vals = Array.isArray(o) ? o : Object.values(o);
      for (const v of vals) if (v && typeof v === 'object' && !(v instanceof THREE.Object3D) && !(v instanceof Zone)) visit(v, depth + 1);
    };
    for (const [k, v] of Object.entries(root)) {
      if (['save', 'scene', 'camera', 'hud', 'sfx', 'flyers', 'progress', 'player', 'ups', 'tiles', 'cashPads', 'workers'].includes(k)) continue;
      visit(v, 0);
    }
    let added = false;
    for (const o of found) {
      if (this.seen.has(o)) continue;
      this.seen.add(o);
      this.buildings.push(o.group);
      added = true;
      this.register(o, root);
      if (isMachine(o) || isSeller(o)) this.addStatus(o);
    }
    if (added) this.recheckT = 1; // (after the new building's grow-in animation)
  }

  /** A (hidden) status tag over a machine or a counter / desk. */
  private addStatus(o: any) {
    const g = o.group as THREE.Object3D;
    this.box.setFromObject(g);
    const tag = new TextSprite(this.world === 'ant' ? 1.05 : 0.95, '#ffb347');
    tag.sprite.visible = false;
    this.host.scene.add(tag.sprite);
    const top = isFinite(this.box.max.y) ? Math.min(this.box.max.y, g.position.y + 8) : 3;
    this.statuses.push({ o, kind: isMachine(o) ? 'machine' : 'seller', tag, top, problem: '', since: 0 });
  }

  /** Show a tag once a problem has lasted a couple of seconds; hide it when fixed. */
  private updateStatus(dt: number, show: boolean) {
    this.statusT -= dt;
    const check = this.statusT <= 0;
    if (check) this.statusT = 0.25;
    for (const st of this.statuses) {
      if (check) {
        const now = st.kind === 'machine' ? machineProblem(st.o) : sellerProblem(st.o);
        if (now !== st.problem) {
          st.problem = now;
          st.since = 0;
        }
      }
      st.since += dt;
      const on = show && st.problem !== '' && st.since > 2.2;
      st.tag.sprite.visible = on;
      if (on) {
        st.tag.setText(st.problem);
        const p = st.o.group.position;
        st.tag.sprite.position.set(p.x, st.top + (this.world === 'ant' ? 1.6 : 1.3), p.z);
      }
    }
  }

  /** A building's footprint on the ground (from its real 3D shape, labels ignored). */
  private footprint(g: THREE.Object3D): Blocker {
    this.box.makeEmpty();
    g.updateWorldMatrix(true, true);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (o as THREE.Object3D & { isSprite?: boolean }).isSprite || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      if (b) this.box.union(b.clone().applyMatrix4(mesh.matrixWorld));
    });
    const b = this.box;
    return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
  }

  /**
   * A new building went up: if it landed on a pad (e.g. a 2nd crumb pile's
   * bread loaf), move that pad to a free spot by its own building.
   */
  private unblock(root: any) {
    const size = SIZES[this.world];
    const h = size / 2;
    const obs = this.obstacles(root, false);
    for (const t of this.targets) {
      const p = t.pad.mesh.position;
      const hit = obs.some((f) => p.x + h > f.minX && p.x - h < f.maxX && p.z + h > f.minZ && p.z - h < f.maxZ);
      if (!hit) continue;
      const others = this.targets.filter((o) => o !== t);
      const keep = this.targets;
      this.targets = others; // (so it doesn't avoid its own old spot)
      const spot = this.freeSpot(t.near, root);
      this.targets = keep;
      p.set(spot.x, p.y, spot.z);
      t.pad.zone.x = spot.x;
      t.pad.zone.z = spot.z;
    }
  }

  private register(o: any, root: any) {
    const at = o.group.position as THREE.Vector3;
    const key = `${Math.round(at.x)},${Math.round(at.z)}`;
    if (isBin(o)) {
      // 🗑️ One TRASH pad, by the colony's first bin: $ per piece in every world's bins
      if (this.world !== 'ant' || this.targets.some((t) => t.pad.id === TRASH.padId)) return;
      this.add('trash', 'trash', 'TRASH', at, root, () => {}, TRASH.padId, TRASH.padBase);
    } else if (isMachine(o)) {
      const label = clean(o.opts.label) || 'MACHINE';
      this.add(`${label.toLowerCase()}@${key}`, 'machine', label, at, root, (lv) => (o.speedMult = up.machine(lv)));
    } else if (isPile(o)) {
      const every = o.spawnEvery();
      if (!isFinite(every) || every > 60) return; // filled by something else (laundry chute, vault)
      const list = this.piles.get(o.type);
      if (list) {
        list.push(o); // same pad as the first pile of this type
        o.rateMult = up.source(this.level(this.id(`pile-${o.type}`))); // (a pile added later gets the level already bought)
        return;
      }
      const piles = [o];
      this.piles.set(o.type, piles);
      const name = PILE_NAME[o.type] ?? o.type.toUpperCase();
      this.add(`pile-${o.type}`, 'source', name, at, root, (lv) => piles.forEach((p) => (p.rateMult = up.source(lv))));
    } else if (isSeller(o)) {
      const raw = o.opts.label ?? SELLER_NAME[o.opts.itemType ?? ''] ?? 'SHOP';
      const label = clean(raw) || 'SHOP';
      const charm = () => this.progress.charmMult; // 😄 Charm stat
      this.add(`sell-${label.toLowerCase()}@${key}`, 'seller', label, at, root, (lv) => {
        o.priceMult = up.price(lv);
        o.paceMult = up.pace(lv) * charm();
      });
      // 👥 The LINE pad, after the shop's first cashier is hired:
      //   Lv 0 -> buy the 2ND CASHIER (a second line, served at the same time)
      //   Lv 1-11 -> BIGGER ORDERS Lv 0-10 (+20% per level: customers buy more)
      const shop = o as SellerLike & {
        bulk: number; lines: number; hasCashier?: boolean; hasStaff?: boolean;
        hireCashier2?: (animate: boolean) => void; hireStaff2?: (animate: boolean) => void;
      };
      const base = this.baseAt(at); // (colony: by zone)
      const line = this.add(
        `line-${label.toLowerCase()}@${key}`, 'line', label, at, root,
        (lv, animate) => {
          if (lv >= 1 && shop.lines < 2) (shop.hireCashier2 ?? shop.hireStaff2)?.call(shop, !!animate);
          shop.bulk = up.bulk(Math.max(0, lv - 1));
        },
        undefined, undefined,
        () => !!(shop.hasCashier || shop.hasStaff), // only once the first cashier works here
      );
      if (line) {
        line.max = 11;
        line.costOf = (lv) => (lv === 0 ? base * 4 : upCost(base * 1.5, lv - 1));
        line.titleOf = (lv) => (lv === 0 ? '2ND CASHIER' : `BIGGER ORDERS · Lv ${lv - 1}`);
        line.iconOf = (lv) => (lv === 0 ? '👥' : '📦');
      }
    }
  }

  /** Make a pad for `name`, on a free spot near `near`. */
  private add(
    name: string, kind: UpKind, label: string, near: THREE.Vector3, root: any, apply: Target['apply'],
    fixedId?: string, base?: number, visible?: () => boolean,
  ): UpgradePad | null {
    const id = fixedId ?? this.id(name);
    if (this.targets.some((t) => t.pad.id === id)) return null;
    const spot = this.freeSpot(near, root);
    const pad = new UpgradePad(this.host.scene, id, kind, label, spot.x, spot.z, base ?? this.baseAt(near), SIZES[this.world]);
    this.targets.push({ pad, apply, near: near.clone(), visible });
    apply(this.level(id));
    return pad;
  }

  // ---- Placing pads -----------------------------------------------------------
  /** Everything a pad mustn't sit on: blockers, stand-here zones, unlock tiles, other pads. */
  private obstacles(root: any, withPads = true): Blocker[] {
    const SIZE = SIZES[this.world];
    const out: Blocker[] = [];
    const seen = new Set<object>();
    const visit = (o: any, depth: number) => {
      if (!o || typeof o !== 'object' || seen.has(o) || o instanceof THREE.Object3D || depth > 3) return;
      seen.add(o);
      if (o instanceof Zone) {
        out.push({ minX: o.x - o.halfW, maxX: o.x + o.halfW, minZ: o.z - o.halfD, maxZ: o.z + o.halfD });
        return;
      }
      // A shop's waiting lines (2 lines once the 2nd cashier is hired): keep them clear
      if (isSeller(o)) {
        const c = o as SellerLike & { opts: { facing?: number; queueMax?: number } };
        const at = c.group.position;
        const f = c.opts.facing ?? 1; // counters face either way; desks' lines run east (+x)
        const n = c.opts.queueMax ?? CONFIG.counter.queueMax;
        const x1 = at.x + f * 1.0;
        const x2 = at.x + f * (2.3 + n * 2.3);
        out.push({ minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minZ: at.z - 2.1, maxZ: at.z + 2.1 });
      }
      // Anything with a 3D group (carts, bins, the hatchery, piles, machines…):
      // its real footprint, so no pad ever ends up under an object
      if (o.group instanceof THREE.Object3D && o !== root.player) {
        const f = this.footprint(o.group);
        if (isFinite(f.minX) && (f.maxX - f.minX) * (f.maxZ - f.minZ) < 300) out.push(f);
      }
      if (typeof o.minX === 'number' && typeof o.maxZ === 'number' && typeof o.maxX === 'number') {
        // (Huge rects are walkable floors / zone outlines, not obstacles)
        if ((o.maxX - o.minX) * (o.maxZ - o.minZ) < 300) out.push(o as Blocker);
        return;
      }
      const vals = Array.isArray(o) ? o : Object.values(o);
      for (const v of vals) visit(v, depth + 1);
    };
    for (const [k, v] of Object.entries(root)) {
      if (['save', 'scene', 'camera', 'hud', 'sfx', 'flyers', 'progress', 'ups', 'walkable'].includes(k)) continue;
      visit(v, 0);
    }
    for (const [x, z] of this.host.tileSpots) out.push({ minX: x - 1.4, maxX: x + 1.4, minZ: z - 1.4, maxZ: z + 1.4 });
    // Every building's real footprint (a pile's bread loaf, a machine's body...)
    for (const g of this.buildings) out.push(this.footprint(g));
    // Decorations (rocks, twigs, trees): anything spawned with userData.decor
    for (const o of this.host.scene.children) {
      if (!o.userData.decor) continue;
      const f = this.footprint(o);
      if (!isFinite(f.minX)) continue;
      if (o.userData.decor === 'tree') {
        // A tree's leaves are up high: only its trunk takes up floor
        const cx = (f.minX + f.maxX) / 2;
        const cz = (f.minZ + f.maxZ) / 2;
        out.push({ minX: cx - 1, maxX: cx + 1, minZ: cz - 1, maxZ: cz + 1 });
      } else out.push(f);
    }
    if (withPads) {
      for (const t of this.targets) {
        const p = t.pad.mesh.position;
        out.push({ minX: p.x - SIZE / 2, maxX: p.x + SIZE / 2, minZ: p.z - SIZE / 2, maxZ: p.z + SIZE / 2 });
      }
    }
    return out;
  }

  /**
   * Try spots in rings around the building, in front first (toward the
   * camera), until one is clear of everything and walkable.
   */
  private freeSpot(near: THREE.Vector3, root: any) {
    const SIZE = SIZES[this.world];
    const obs = this.obstacles(root);
    const h = SIZE / 2 + 0.25;
    const clear = (x: number, z: number) =>
      [[x, z], [x - h, z - h], [x + h, z - h], [x - h, z + h], [x + h, z + h]].every(([px, pz]) => this.host.canWalk(px, pz)) &&
      !obs.some((b) => x + h > b.minX && x - h < b.maxX && z + h > b.minZ && z - h < b.maxZ);
    // In front (toward the camera) at any distance beats beside it, which beats behind it
    const arcs = [[0, 0.45, -0.45], [0.9, -0.9, 1.35, -1.35], [1.8, -1.8, 2.3, -2.3, 2.75, -2.75, Math.PI]];
    for (const arc of arcs) {
      for (const r of [3.4, 4.4, 5.6, 7, 8.6].map((v) => (v * SIZE) / 2.3)) {
        for (const a of arc) {
          const x = near.x + Math.sin(a) * r;
          const z = near.z + Math.cos(a) * r;
          if (clear(x, z)) return new THREE.Vector3(x, 0, z);
        }
      }
    }
    return near.clone().add(new THREE.Vector3(0, 0, 3.4)); // crowded: just in front
  }

  // ---- Every frame -------------------------------------------------------------
  /**
   * `active` = you're playing this world (pads show + take cash). In the
   * background the effects still apply so the helpers keep their boosts.
   */
  update(dt: number, root: any, playerPos: THREE.Vector3, active: boolean) {
    // New buildings? (cheap enough to check twice a second)
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      this.scan(root);
      if (this.host.workers.length && !this.targets.some((t) => t.pad.id === this.id('crew'))) {
        this.add('crew', 'crew', 'CREW', this.host.home, root, () => {});
      }
      if (this.host.collectors().length && !this.targets.some((t) => t.pad.id === this.id('collectors'))) {
        this.add('collectors', 'collector', 'COLLECTORS', this.host.home, root, () => {});
      }
    }

    // Something new was bought (a cart, a bin...): recheck the pads once it has grown in
    if (this.save.unlocked.length !== this.unlockedSeen) {
      this.unlockedSeen = this.save.unlocked.length;
      this.recheckT = 1;
    }
    if (this.recheckT >= 0) {
      this.recheckT -= dt;
      if (this.recheckT < 0) this.unblock(root);
    }

    // Effects (every frame: stats like Charm / Leadership can change any time)
    for (const t of this.targets) t.apply(this.level(t.pad.id));
    this.applyCrew();
    const grab = up.grab(this.level(this.id('collectors')));
    for (const c of this.host.collectors()) c.boost = grab;

    this.active = active;
    this.updateStatus(dt, active); // ⚠️ station status tags (shown from the start: they guide new players too)
    const show = active && (this.host.ready?.() ?? true);
    for (const t of this.targets) t.pad.mesh.visible = show && (t.visible?.() ?? true);
    if (!show) return;

    // Pour cash into the pad you're standing on
    for (const t of this.targets) {
      const pad = t.pad;
      if (!pad.mesh.visible) continue;
      const lv = this.level(pad.id);
      const cost = pad.costOf(lv);
      const paid = this.save.upPaid[pad.id] ?? 0;
      const remaining = Math.max(0, Math.ceil(cost - paid));
      const canBuy = lv < pad.max;
      pad.draw(lv, remaining, canBuy && this.save.cash >= remaining);
      pad.pulse(dt, canBuy && this.save.cash >= remaining);
      const on = pad.zone.contains(playerPos);
      pad.dwell = on ? pad.dwell + dt : 0;
      if (!on || !canBuy || pad.dwell < DWELL || this.save.cash < 1) continue;
      const rate = Math.max(cost / 1.4, 12);
      const pay = Math.min(this.save.cash, rate * dt * clock.scale, cost - paid);
      this.save.upPaid[pad.id] = paid + pay;
      this.save.cash -= pay;
      this.hud.setCash(this.save.cash);
      this.sfx.unlockTick();
      if (paid + pay >= cost - 1e-6) this.levelUp(t, lv + 1, cost);
    }
  }

  private levelUp(t: Target, lv: number, cost: number) {
    const pad = t.pad;
    this.save.upgrades[pad.id] = lv;
    delete this.save.upPaid[pad.id];
    pad.dwell = -0.6; // a short breather before the next level starts pouring
    t.apply(lv, true);
    bump('upgrades');
    // (No XP: upgrades used to pay 10% of their price as XP, which flooded levels.)
    this.sfx.upgrade();
    const msg = pad.kind === 'line' && lv === 1 ? `👥 ${pad.label}: 2nd line open!` : `⬆️ ${pad.titleOf(lv)}!`;
    this.hud.floatAt(pad.mesh.position.clone().setY(1.6), this.host.camera, msg, 'big gold');
    this.flyers.grow(pad.mesh, 0.3);
  }

  /** 👷 CREW level + 📣 Leadership on every helper, and their saved XP. */
  private applyCrew() {
    const lv = this.level(this.id('crew'));
    const speed = up.crewSpeed(lv) * this.progress.leadMult;
    const extra = up.crewCarry(lv);
    const saved = this.save.crewXp[this.world]!;
    this.host.workers.forEach((w, i) => {
      if (i >= this.crewLoaded) {
        // A helper we haven't seen: load its saved XP and hook its level-ups
        w.setXp(saved[i] ?? 0);
        w.onLevel = (n) => {
          if (!this.active) return; // (only cheer in the world you're looking at)
          this.hud.floatAt(w.model.root.position.clone().setY(w.model.height + 1.5), this.host.camera, `⭐ Lv ${n}!`, 'gold');
        };
        this.crewLoaded = i + 1;
      }
      w.boost = speed;
      w.stack.max = w.baseCarry + extra;
      saved[i] = Math.round(w.xp);
    });
  }
}
