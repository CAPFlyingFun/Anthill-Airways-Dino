// ============================================================================
// upgradePad.ts — ⬆️ BUILDING UPGRADES (the panels).
//
// Every world owns one `Upgrades` manager. Each frame it:
//   1. FINDS buildings (machines, piles, counters / desks, the trash bin) and
//      gives each one its upgrades. (So anything an unlock builds gets them
//      automatically.) Piles of one type share one upgrade.
//   2. Adds the world's 👷 STAFF upgrades (all helpers; bankers, the Queen and
//      assistants) once it has any.
//   3. APPLIES every upgrade's level to its building (speed, prices, carry...).
//   4. Shows a "⬆️ OVEN" button when you walk up to a building, and opens that
//      building's PANEL when you tap the button or tap the building itself
//      (tap a helper for the Staff tab). The panel buys levels: x1, x5 or MAX.
//   5. Floats a ⚠️ STATUS TAG over a station while it's stuck (idle oven,
//      full shelf...), and shows the same warning in its panel.
//
// (Until v0.26 these were round pads on the ground that you stood on. The ids
// stayed the same - "i3-up-blender@-12,6" - so every level bought carries over,
// and island / volcano ones (i3- / v4-) still reset on an eruption.)
// ============================================================================
import * as THREE from 'three';
import { SaveData } from '../core/save';
import { Sfx } from '../core/audio';
import { Progress } from '../core/progress';
import { bump } from '../core/totals';
import { COLONY_ZONE_BASE, HAS_MILESTONES, MILESTONES, UP_BASE, UP_KINDS, UP_MAX, UpKind, up, upCost } from '../core/upgrades';
import type { Hud, UpPanelModel, UpRowModel } from '../ui/hud';
import { Flyers } from './items';
import { TextSprite } from './labels';
import { Zone } from './stations';
import { TRASH } from './trash';
import { ZONES } from '../data/config';
import type { Worker } from '../actors/worker';

/** Which world a manager belongs to (also the save key for helpers' XP). */
export type WorldKey = 'ant' | 'air' | 'island' | 'volcano' | 'hotel' | 'home'; // (home = 🏝️ Anthill Island)
/** Id prefix per world (matches the unlock ids, so eruptions wipe i3- / v4-). */
const PREFIX: Record<WorldKey, string> = { ant: 'c1', air: 'a2', island: 'i3', volcano: 'v4', hotel: 'h5', home: 'ai' };
/** How close (world units, from the building's edge) counts as "next to it" for the ⬆️ button. */
const NEAR: Record<WorldKey, number> = { ant: 2.4, air: 3.2, island: 3.2, volcano: 3.2, hotel: 3.2, home: 3.2 };

// ---- Duck types for the buildings (so this file needn't import every world) --
interface MachineLike { group: THREE.Group; inZone: Zone; outZone: Zone; speedMult: number; opts: { label: string } }
interface PileLike { group: THREE.Group; zone: Zone; type: string; rateMult: number; spawnEvery: () => number }
interface SellerLike { group: THREE.Group; priceMult: number; paceMult: number; opts: { label?: string; itemType?: string } }
interface CollectorLike { boost: number; model?: { root: THREE.Object3D } }

const isMachine = (o: any): o is MachineLike => o && o.inZone instanceof Zone && o.outZone instanceof Zone && typeof o.speedMult === 'number';
const isPile = (o: any): o is PileLike => o && o.zone instanceof Zone && typeof o.rateMult === 'number' && typeof o.spawnEvery === 'function';
const isSeller = (o: any): o is SellerLike => o && typeof o.priceMult === 'number' && typeof o.paceMult === 'number' && o.group;
const isBin = (o: any) => o && o.mouth instanceof THREE.Vector3 && o.zone instanceof Zone && o.group;

/** Short names for each pile type ("CRUMBS"). */
const PILE_NAME: Record<string, string> = {
  crumb: 'CRUMBS', leaf: 'LEAVES', sugar: 'SUGAR', snackbox: 'EXPORTS', fruit: 'FRUIT', meat: 'DINO FOOD', egg: 'NESTS',
  obsidian: 'OBSIDIAN', magma: 'LAVA VENT', crystal: 'VAULT', grocery: 'GROCERIES', laundry: 'LAUNDRY',
};
const PILE_ICON: Record<string, string> = {
  crumb: '🍞', leaf: '🌿', sugar: '🍬', snackbox: '📦', fruit: '🍓', meat: '🍖', egg: '🥚',
  obsidian: '🪨', magma: '🌋', crystal: '💎', grocery: '🥕', laundry: '🧺',
};
/** "☕ Ant Café" -> "ANT CAFÉ" (emoji off). */
const clean = (s: string) => s.replace(/[^\p{L}\p{N} \-&']/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
/** The emoji at the start of a label, if any ("☕ Ant Café" -> "☕"). */
const leadEmoji = (s: string) => /^\p{Extended_Pictographic}️?/u.exec(s.trim())?.[0] ?? '';

/** Drawn on screen? (itself and every parent visible) */
const shown = (o: THREE.Object3D) => {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
};

const SELLER_NAME: Record<string, string> = { snack: 'SNACK SHOP', wrap: 'WRAP MARKET', candy: 'CANDY SHOP' };

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
  /** (Kept for the worlds' setup code: where the old crew pad went. Unused now.) */
  home?: THREE.Vector3;
  canWalk?: (x: number, z: number) => boolean;
  tileSpots?: [number, number][];
  /** Collectors in this world right now (bankers / the Queen / an assistant). */
  collectors: () => CollectorLike[];
  /** Upgrades only appear once this is true (the colony waits for your first Worker Ant). */
  ready?: () => boolean;
}

/** One upgrade: its level lives in save.upgrades[id] (partial payments in save.upPaid). */
export class Upgrade {
  /** Highest level (most: 10). */
  max = UP_MAX;
  /** Price of the next level. */
  costOf = (lv: number) => upCost(this.base, lv);
  constructor(public id: string, public kind: UpKind, public label: string, public base: number) {}
}

interface Target {
  up: Upgrade;
  /** Puts the level into effect (`animate` = just bought, not loading a save). */
  apply: (lv: number, animate?: boolean) => void;
  /** Only shown (and buyable) while this is true. */
  visible?: () => boolean;
  /** How many piles share it (shown as "all 2 crumb piles"). */
  shared?: () => number;
}

/** A building you can upgrade. */
interface Building {
  name: string;           // "OVEN"
  icon: string;           // "🔥" (for the panel title + button)
  group: THREE.Object3D;
  targets: Target[];      // its upgrades
  status?: Status;        // ⚠️ what's wrong, if anything
  rect: { minX: number; maxX: number; minZ: number; maxZ: number }; // footprint (for "next to it")
}

export class Upgrades {
  private targets: Target[] = [];
  private buildings: Building[] = [];
  private staff: Target[] = []; // 👷 crew + 💼 collectors (the Staff tab)
  private seen = new Set<object>();
  private box = new THREE.Box3();
  private piles = new Map<string, { list: PileLike[]; target: Target }>(); // one upgrade per pile TYPE
  private scanT = 0;
  private rectT = 0;
  private crewLoaded = 0; // helpers whose saved XP has been loaded
  private statuses: Status[] = [];
  private statusT = 0;
  private active = false;
  private ray = new THREE.Raycaster();
  /** The building whose ⬆️ button is showing (null = none). */
  private nearby: Building | null = null;
  /** This world is driving the ⬆️ button (it's the one you're in). */
  private claimed = false;
  /** Where you were last frame (staff upgrades float their message there). */
  private lastPlayer = new THREE.Vector3();
  /** The panel, while it's open for this world: which building + tab. */
  private open: { b: Building | null; tab: 'building' | 'staff' } | null = null;

  constructor(private host: UpgradeHost, private world: WorldKey, private save: SaveData, private hud: Hud, private sfx: Sfx, private flyers: Flyers, private progress: Progress) {
    save.crewXp[world] ??= [];
  }

  /** An upgrade's base price: per world, and in the colony per zone (Nest / Tunnels / Hangar). */
  private baseAt(near: THREE.Vector3) {
    if (this.world !== 'ant') return UP_BASE[this.world];
    const zone = ZONES.find((z) => near.x >= z.rect.minX && near.x <= z.rect.maxX && near.z >= z.rect.minZ && near.z <= z.rect.maxZ);
    return COLONY_ZONE_BASE[zone?.id ?? 'nest'] ?? UP_BASE.ant;
  }

  /** Levels bought on an upgrade. */
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

  /** Upgrades are available here yet (the colony waits for its first Worker Ant). */
  private get ready() {
    return this.host.ready?.() ?? true;
  }

  /** The nearest building that has something to upgrade (for the tutorial's arrow), or null. */
  nearestBuilding(from: THREE.Vector3): THREE.Vector3 | null {
    if (!this.ready) return null;
    let best: Building | null = null;
    let d = Infinity;
    for (const b of this.buildings) {
      if (!this.hasRows(b)) continue;
      const dd = this.distTo(b, from);
      if (dd < d) {
        d = dd;
        best = b;
      }
    }
    return best ? best.group.position.clone().setY(0) : null;
  }

  // ---- Finding buildings ------------------------------------------------------
  /**
   * Look through the world for buildings we don't know yet: its own fields, any
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
    for (const o of found) {
      if (this.seen.has(o)) continue;
      this.seen.add(o);
      const status = isMachine(o) || isSeller(o) ? this.addStatus(o) : undefined;
      this.register(o, status);
    }
  }

  /** A (hidden) status tag over a machine or a counter / desk. */
  private addStatus(o: any): Status {
    const g = o.group as THREE.Object3D;
    this.box.setFromObject(g);
    const tag = new TextSprite(this.world === 'ant' ? 1.05 : 0.95, '#ffb347');
    tag.sprite.visible = false;
    this.host.scene.add(tag.sprite);
    const top = isFinite(this.box.max.y) ? Math.min(this.box.max.y, g.position.y + 8) : 3;
    const st: Status = { o, kind: isMachine(o) ? 'machine' : 'seller', tag, top, problem: '', since: 0 };
    this.statuses.push(st);
    return st;
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
  private footprint(g: THREE.Object3D) {
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
    if (!isFinite(b.min.x)) {
      const p = g.position;
      return { minX: p.x - 1, maxX: p.x + 1, minZ: p.z - 1, maxZ: p.z + 1 };
    }
    return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
  }

  /** Distance from a point to a building's footprint (0 inside). */
  private distTo(b: Building, p: THREE.Vector3) {
    const r = b.rect;
    return Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
  }

  /** A new building: give it its upgrades. */
  private register(o: any, status?: Status) {
    const at = o.group.position as THREE.Vector3;
    const key = `${Math.round(at.x)},${Math.round(at.z)}`;
    const make = (name: string, icon: string, targets: Target[]) => {
      const b: Building = { name, icon, group: o.group, targets, status, rect: this.footprint(o.group) };
      this.buildings.push(b);
      return b;
    };
    if (isBin(o)) {
      // 🗑️ One TRASH upgrade, on the colony's first bin: $ per piece in every world's bins
      if (this.world !== 'ant' || this.targets.some((t) => t.up.id === TRASH.padId)) return;
      const t = this.add('trash', 'trash', 'TRASH', at, () => {}, TRASH.padId, TRASH.padBase);
      if (t) make('TRASH BIN', '🗑️', [t]);
    } else if (isMachine(o)) {
      const label = clean(o.opts.label) || 'MACHINE';
      const t = this.add(`${label.toLowerCase()}@${key}`, 'machine', label, at, (lv) => (o.speedMult = up.machine(lv)));
      if (t) make(label, leadEmoji(o.opts.label) || '⚙️', [t]);
    } else if (isPile(o)) {
      const every = o.spawnEvery();
      const name = PILE_NAME[o.type] ?? o.type.toUpperCase();
      if (!isFinite(every) || every > 60) return; // filled by something else (laundry chute, vault)
      const known = this.piles.get(o.type);
      if (known) {
        // Same upgrade as the first pile of this type (a pile added later gets the level already bought)
        known.list.push(o);
        o.rateMult = up.source(this.level(known.target.up.id));
        make(name, PILE_ICON[o.type] ?? '🌱', [known.target]);
        return;
      }
      const list = [o];
      const t = this.add(`pile-${o.type}`, 'source', name, at, (lv) => list.forEach((p) => (p.rateMult = up.source(lv))));
      if (!t) return;
      t.shared = () => list.length;
      this.piles.set(o.type, { list, target: t });
      make(name, PILE_ICON[o.type] ?? '🌱', [t]);
    } else if (isSeller(o)) {
      const raw = o.opts.label ?? SELLER_NAME[o.opts.itemType ?? ''] ?? 'SHOP';
      const label = clean(raw) || 'SHOP';
      const charm = () => this.progress.charmMult; // 😄 Charm stat
      const sell = this.add(`sell-${label.toLowerCase()}@${key}`, 'seller', label, at, (lv) => {
        o.priceMult = up.price(lv);
        o.paceMult = up.pace(lv) * charm();
      });
      // 👥 The LINE upgrade, after the shop's first cashier is hired:
      //   Lv 0 -> buy the 2ND CASHIER (a second line, served at the same time)
      //   Lv 1-11 -> BIGGER ORDERS Lv 0-10 (+20% per level: customers buy more)
      const shop = o as SellerLike & {
        bulk: number; lines: number; hasCashier?: boolean; hasStaff?: boolean;
        hireCashier2?: (animate: boolean) => void; hireStaff2?: (animate: boolean) => void;
      };
      const base = this.baseAt(at); // (colony: by zone)
      const line = this.add(
        `line-${label.toLowerCase()}@${key}`, 'line', label, at,
        (lv, animate) => {
          if (lv >= 1 && shop.lines < 2) (shop.hireCashier2 ?? shop.hireStaff2)?.call(shop, !!animate);
          shop.bulk = up.bulk(Math.max(0, lv - 1));
        },
        undefined, undefined,
        () => !!(shop.hasCashier || shop.hasStaff), // only once the first cashier works here
      );
      if (line) {
        line.up.max = 11;
        line.up.costOf = (lv) => (lv === 0 ? base * 4 : upCost(base * 1.5, lv - 1));
      }
      const targets = [sell, line].filter((t): t is Target => !!t);
      if (targets.length) make(label, leadEmoji(raw) || '🛒', targets);
    }
  }

  /** Make an upgrade (once per id). */
  private add(
    name: string, kind: UpKind, label: string, near: THREE.Vector3, apply: Target['apply'],
    fixedId?: string, base?: number, visible?: () => boolean,
  ): Target | null {
    const id = fixedId ?? this.id(name);
    if (this.targets.some((t) => t.up.id === id)) return null;
    const t: Target = { up: new Upgrade(id, kind, label, base ?? this.baseAt(near)), apply, visible };
    this.targets.push(t);
    apply(this.level(id));
    return t;
  }

  // ---- Every frame -------------------------------------------------------------
  /**
   * `active` = you're playing this world (the ⬆️ button and taps work here). In
   * the background the effects still apply so the helpers keep their boosts.
   */
  update(dt: number, root: any, playerPos: THREE.Vector3, active: boolean) {
    this.lastPlayer.copy(playerPos);
    // New buildings? (cheap enough to check twice a second)
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      this.scan(root);
      if (this.host.workers.length && !this.targets.some((t) => t.up.id === this.id('crew'))) {
        const t = this.add('crew', 'crew', 'CREW', new THREE.Vector3(), () => {});
        if (t) this.staff.unshift(t);
      }
      if (this.host.collectors().length && !this.targets.some((t) => t.up.id === this.id('collectors'))) {
        const t = this.add('collectors', 'collector', 'COLLECTORS', new THREE.Vector3(), () => {});
        if (t) this.staff.push(t);
      }
    }
    // Buildings grow in (and move) after an unlock: refresh their footprints now and then
    this.rectT -= dt;
    if (this.rectT <= 0) {
      this.rectT = 2;
      for (const b of this.buildings) b.rect = this.footprint(b.group);
    }

    // Effects (every frame: stats like Charm / Leadership can change any time)
    for (const t of this.targets) t.apply(this.level(t.up.id));
    this.applyCrew();
    const grab = up.grab(this.level(this.id('collectors')));
    for (const c of this.host.collectors()) c.boost = grab;

    this.active = active;
    this.updateStatus(dt, active); // ⚠️ station status tags (shown from the start: they guide new players too)

    // The ⬆️ button for the building you're standing next to
    let near: Building | null = null;
    if (active && this.ready && !this.open) {
      let d = NEAR[this.world];
      for (const b of this.buildings) {
        if (!this.hasRows(b)) continue;
        const dd = this.distTo(b, playerPos);
        if (dd < d) {
          d = dd;
          near = b;
        }
      }
    }
    // (Only the world you're in drives the button. Worlds keep running in the background,
    // so one you just left lets go of it, and the new one claims it on its first frame.)
    if (!active) {
      if (this.claimed) {
        this.claimed = false;
        this.nearby = null;
        this.hud.releaseUpgradeButton(this);
      }
    } else if (near !== this.nearby || !this.claimed || !this.hud.ownsUpgradeButton(this)) {
      // (also after a gate run, which hides the button: take it back right away)
      this.claimed = true;
      this.nearby = near;
      this.hud.setUpgradeButton(near ? `${near.icon} ${near.name}` : null, near ? () => this.openPanel(near!, 'building') : undefined, this.affordable(near), this);
    } else if (near && (this.scanT === 0.5 || Math.random() < 0.1)) {
      // (now and then: does the button glow because you can afford a level?)
      this.hud.setUpgradeButton(`${near.icon} ${near.name}`, () => this.openPanel(near!, 'building'), this.affordable(near), this);
    }
    // Leaving the world closes its panel
    if (!active && this.open) this.closePanel();
  }

  /** Does this building have anything to show in its panel? */
  private hasRows(b: Building) {
    return b.targets.some((t) => t.visible?.() ?? true);
  }

  /** Can you afford the next level of anything here? (makes the ⬆️ button glow) */
  private affordable(b: Building | null) {
    if (!b) return false;
    return b.targets.some((t) => (t.visible?.() ?? true) && this.level(t.up.id) < t.up.max && this.save.cash >= this.remaining(t.up, this.level(t.up.id)));
  }

  /** Cash still to pay for level `lv` -> `lv + 1` (counts a part-payment from the old pads). */
  private remaining(u: Upgrade, lv: number) {
    const paid = lv === this.level(u.id) ? this.save.upPaid[u.id] ?? 0 : 0;
    return Math.max(0, Math.ceil(u.costOf(lv) - paid));
  }

  // ---- Tapping ------------------------------------------------------------------
  /**
   * A tap on the game view at normalised screen coords (-1..1): did it hit a
   * building (its panel) or a helper (the Staff tab)? Returns true if it opened one.
   */
  pick(ndc: THREE.Vector2): boolean {
    if (!this.active || !this.ready || this.open) return false;
    this.ray.setFromCamera(ndc, this.host.camera);
    const groups = this.buildings.filter((b) => this.hasRows(b)).map((b) => b.group);
    const helpers = [...this.host.workers.map((w) => w.model.root), ...this.host.collectors().map((c) => c.model?.root).filter((r): r is THREE.Object3D => !!r)];
    const hits = this.ray.intersectObjects([...groups, ...(this.staff.length ? helpers : [])], true);
    for (const h of hits) {
      if ((h.object as THREE.Sprite).isSprite) continue; // (labels and tags don't count)
      if (!shown(h.object)) continue; // (the raycaster also finds hidden parts: skip them)
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        const b = this.buildings.find((x) => x.group === o);
        if (b) {
          this.openPanel(b, 'building');
          return true;
        }
        if (helpers.includes(o)) {
          this.openPanel(this.nearby, 'staff');
          return true;
        }
      }
    }
    return false;
  }

  // ---- The panel ----------------------------------------------------------------
  private openPanel(b: Building | null, tab: 'building' | 'staff') {
    if (!b && !this.staff.length) return;
    this.open = { b, tab: b ? tab : 'staff' };
    this.nearby = null;
    this.hud.setUpgradeButton(null, undefined, false, this);
    this.sfx.popup();
    this.hud.openUpgrades({
      model: () => this.model(),
      buy: (id, n) => this.buy(id, n),
      tab: (key) => {
        if (this.open) this.open.tab = key === 'staff' ? 'staff' : 'building';
      },
      close: () => {
        this.open = null;
      },
    });
  }

  private closePanel() {
    this.open = null;
    this.hud.closeUpgrades();
  }

  /** What the panel shows right now. */
  private model(): UpPanelModel | null {
    const o = this.open;
    if (!o) return null;
    const tabs: UpPanelModel['tabs'] = [];
    if (o.b) tabs.push({ key: 'building', label: `${o.b.icon} ${titleCase(o.b.name)}`, on: o.tab === 'building' });
    if (this.staff.length) tabs.push({ key: 'staff', label: '👷 Staff', on: o.tab === 'staff' || !o.b });
    const staffTab = o.tab === 'staff' || !o.b;
    const list = staffTab ? this.staff : o.b!.targets;
    const st = !staffTab ? o.b!.status : undefined;
    return {
      tabs,
      title: staffTab ? '👷 Staff (every helper here)' : `${o.b!.icon} ${titleCase(o.b!.name)}`,
      warn: st && st.problem && st.since > 2.2 ? st.problem : '',
      cash: this.save.cash,
      rows: list.filter((t) => t.visible?.() ?? true).map((t) => this.row(t)),
    };
  }

  /** One upgrade's row: name, level pips (⭐ milestones), now -> next, and the buy buttons. */
  private row(t: Target): UpRowModel {
    const u = t.up;
    const lv = this.level(u.id);
    const maxed = lv >= u.max;
    // The line: Lv 0 = the 2nd cashier, Lv 1-11 = bigger orders Lv 0-10
    const isLine = u.kind === 'line';
    const hiring = isLine && lv === 0;
    const shownLv = isLine ? Math.max(0, lv - 1) : lv;
    const shownMax = isLine ? u.max - 1 : u.max;
    const stars = HAS_MILESTONES.has(u.kind);
    const pips = hiring ? [] : Array.from({ length: shownMax }, (_, i) => ({ filled: i < shownLv, star: stars && MILESTONES.includes(i + 1) }));
    const name = hiring ? '2nd cashier' : isLine ? 'Bigger orders' : UP_KINDS[u.kind].name;
    const icon = hiring ? '👥' : isLine ? '📦' : UP_KINDS[u.kind].icon;
    const n = t.shared?.() ?? 1;
    const sub = u.kind === 'source' && n > 1 ? `All ${n} ${PILE_NAME_LOWER(u.label)} piles` : hiring ? 'A second line, served at the same time' : '';
    const nextMilestone = stars && !maxed ? MILESTONES.find((m) => m === lv + 1) : undefined;
    // Buy buttons: x1, x5 (if 2+ levels left), MAX (as many as you can afford now)
    const buys: UpRowModel['buys'] = [];
    if (!maxed) {
      const left = u.max - lv;
      const one = this.priceOf(u, 1);
      buys.push({ n: 1, label: hiring ? 'Hire' : '×1', cost: one.cost, ok: this.save.cash >= one.cost });
      if (left >= 2 && !hiring) {
        const five = this.priceOf(u, 5);
        buys.push({ n: five.n, label: `×${five.n}`, cost: five.cost, ok: this.save.cash >= five.cost });
      }
      const most = this.mostAffordable(u);
      if (!hiring && most.n >= 2) buys.push({ n: most.n, label: `MAX ×${most.n}`, cost: most.cost, ok: true });
    }
    return {
      id: u.id,
      icon,
      name,
      sub,
      level: maxed ? 'MAX' : hiring ? 'Not hired' : `Lv ${shownLv}/${shownMax}`,
      pips,
      now: this.effect(u, lv),
      next: maxed ? null : this.effect(u, lv + 1),
      star: nextMilestone ? `⭐ Lv ${nextMilestone} is a milestone: a bigger jump` : '',
      buys,
    };
  }

  /** What an upgrade does at a level, in words. */
  private effect(u: Upgrade, lv: number) {
    const x = (v: number) => `×${(Math.round(v * 100) / 100).toString()}`;
    switch (u.kind) {
      case 'machine': return `${x(up.machine(lv))} cook speed`;
      case 'seller': return `${x(up.price(lv))} prices · ${x(up.pace(lv))} customers`;
      case 'line': return lv === 0 ? '1 line' : `2 lines · customers buy ${x(up.bulk(lv - 1))}`;
      case 'source': return `${x(up.source(lv))} regrow speed`;
      case 'crew': return `${x(up.crewSpeed(lv))} speed · +${up.crewCarry(lv)} carry`;
      case 'collector': return `${x(up.grab(lv))} grab speed · +${Math.round((up.bonus(lv) - 1) * 100)}% cash`;
      case 'trash': return `$${TRASH.values[Math.min(lv, TRASH.values.length - 1)]} per piece`;
    }
  }

  /** Price of the next `n` levels (fewer if it maxes out). */
  private priceOf(u: Upgrade, n: number) {
    const lv = this.level(u.id);
    let cost = 0;
    let k = 0;
    while (k < n && lv + k < u.max) {
      cost += this.remaining(u, lv + k);
      k++;
    }
    return { n: k, cost };
  }

  /** As many levels as you can afford right now (and their price). */
  private mostAffordable(u: Upgrade) {
    const lv = this.level(u.id);
    let cost = 0;
    let k = 0;
    while (lv + k < u.max) {
      const next = this.remaining(u, lv + k);
      if (cost + next > this.save.cash) break;
      cost += next;
      k++;
    }
    return { n: k, cost };
  }

  /** Buy `n` levels of an upgrade (stops early if the cash runs out). */
  private buy(id: string, n: number) {
    const t = this.targets.find((x) => x.up.id === id);
    if (!t || !(t.visible?.() ?? true)) return;
    const u = t.up;
    let bought = 0;
    while (bought < n) {
      const lv = this.level(id);
      if (lv >= u.max) break;
      const pay = this.remaining(u, lv);
      if (this.save.cash < pay) break;
      this.save.cash -= pay;
      delete this.save.upPaid[id];
      this.save.upgrades[id] = lv + 1;
      t.apply(lv + 1, true);
      bump('upgrades');
      bought++;
    }
    if (!bought) return;
    // (No XP: upgrades used to pay 10% of their price as XP, which flooded levels.)
    this.hud.setCash(this.save.cash);
    this.sfx.upgrade();
    const lv = this.level(id);
    const b = this.open?.b;
    const where = (b?.group.position ?? this.lastPlayer).clone().setY(this.world === 'ant' ? 2.6 : 3.6);
    const star = HAS_MILESTONES.has(u.kind) && MILESTONES.some((m) => m > lv - bought && m <= lv);
    const msg =
      u.kind === 'line' && lv === 1 ? '👥 2nd line open!'
        : u.kind === 'line' ? `📦 Bigger orders Lv ${lv - 1}!`
          : `${star ? '⭐' : '⬆️'} ${titleCase(u.label)} Lv ${lv}${lv >= u.max ? ' MAX' : ''}!`;
    this.hud.floatAt(where, this.host.camera, msg, 'big gold');
    if (b) this.flyers.grow(b.group, 0.25);
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

/** "SNACK SHOP" -> "Snack Shop". */
function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}
/** "CRUMBS" -> "crumb" (for "All 2 crumb piles"). */
function PILE_NAME_LOWER(label: string) {
  const l = label.toLowerCase();
  return l.endsWith('s') ? l.slice(0, -1) : l;
}
