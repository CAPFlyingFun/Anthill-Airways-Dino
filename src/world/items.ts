// ============================================================================
// items.ts — the little things you carry (crumbs, snack packs, cash bills),
// plus two helpers that make the whole "carry and stack" feel work:
//
//   Stack  — a pile of items attached to something (an ant's back, a table,
//            a cash pad). A `layout` function decides where item #i sits.
//   Flyers — animates items hopping in an arc from one place to another.
//
// Rule that keeps things simple: items are only ever taken off the TOP of a
// stack, and only once they have finished flying in.
// ============================================================================
import * as THREE from 'three';

export type ItemType = 'crumb' | 'snack' | 'leaf' | 'wrap' | 'sugar' | 'candy' | 'cash' | 'bag' | 'snackbox'
  // Act 3 (Dino Island)
  | 'fruit' | 'smoothie' | 'meat' | 'egg' | 'ticket';

/** Height of one item when stacked. */
export const ITEM_H: Record<ItemType, number> = { crumb: 0.3, snack: 0.32, leaf: 0.14, wrap: 0.32, sugar: 0.4, candy: 0.3, cash: 0.11, bag: 0.48, snackbox: 0.36, fruit: 0.4, smoothie: 0.5, meat: 0.32, egg: 0.42, ticket: 0.1 };

// Shared geometry + materials: every crumb reuses the same ones (fast).
const geo = {
  crumb: new THREE.BoxGeometry(0.42, 0.28, 0.42),
  snack: new THREE.BoxGeometry(0.56, 0.3, 0.42),
  cash: new THREE.BoxGeometry(0.62, 0.1, 0.36),
  // A leaf: a squashed, pointed ellipsoid (scale baked into the geometry)
  leaf: new THREE.SphereGeometry(0.3, 12, 6).scale(1, 0.22, 1.5),
  // A leaf wrap: a rolled-up leaf lying on its side
  wrap: new THREE.CylinderGeometry(0.16, 0.16, 0.56, 12).rotateZ(Math.PI / 2),
  sugar: new THREE.BoxGeometry(0.4, 0.38, 0.4),
  candy: new THREE.BoxGeometry(0.5, 0.28, 0.38),
  // Act 2 (airport): a suitcase, and a snack box shipped from the ant colony
  bag: new THREE.BoxGeometry(0.7, 0.46, 0.32),
  bagHandle: new THREE.TorusGeometry(0.1, 0.025, 6, 12, Math.PI),
  snackbox: new THREE.BoxGeometry(0.6, 0.34, 0.46),
  // Act 3 (Dino Island)
  fruit: new THREE.SphereGeometry(0.22, 12, 8).scale(1, 0.9, 1.25),     // a big tropical fruit
  leafTop: new THREE.ConeGeometry(0.1, 0.18, 6),
  cup: new THREE.CylinderGeometry(0.2, 0.15, 0.42, 14),                  // smoothie cup
  straw: new THREE.CylinderGeometry(0.025, 0.025, 0.34, 6),
  meat: new THREE.CylinderGeometry(0.17, 0.2, 0.42, 10),                 // a big drumstick
  bone: new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6),
  egg: new THREE.SphereGeometry(0.17, 14, 10).scale(1, 1.3, 1),
  ticket: new THREE.BoxGeometry(0.5, 0.08, 0.3),
};
const mat = {
  crumb: new THREE.MeshStandardMaterial({ color: 0xdca44a, roughness: 0.9 }),
  snackSide: new THREE.MeshStandardMaterial({ color: 0xe0533c, roughness: 0.6 }),
  snackTop: new THREE.MeshStandardMaterial({ color: 0xffd25a, roughness: 0.6 }),
  cashSide: new THREE.MeshStandardMaterial({ color: 0x3f9d4a, roughness: 0.7 }),
  cashTop: new THREE.MeshStandardMaterial({ color: 0x8be36a, roughness: 0.7 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4caf3a, roughness: 0.7 }),
  wrapSide: new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.6 }),
  wrapEnd: new THREE.MeshStandardMaterial({ color: 0xa5d66f, roughness: 0.6 }),
  sugar: new THREE.MeshStandardMaterial({ color: 0xf6f8ff, roughness: 0.35 }),
  candySide: new THREE.MeshStandardMaterial({ color: 0xff6fb5, roughness: 0.35 }),
  candyTop: new THREE.MeshStandardMaterial({ color: 0xfff1f8, roughness: 0.35 }),
  bags: [0x2d6cdf, 0xe63946, 0x2a9d8f, 0xf4a261, 0x6a4c93, 0x333a44].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })),
  handle: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }),
  boxSide: new THREE.MeshStandardMaterial({ color: 0xf28c28, roughness: 0.6 }),
  boxTop: new THREE.MeshStandardMaterial({ color: 0xb8321e, roughness: 0.6 }),
  fruit: new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: 0.55 }),
  cup: new THREE.MeshStandardMaterial({ color: 0xff6fa8, roughness: 0.35 }),
  straw: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
  meat: new THREE.MeshStandardMaterial({ color: 0xa0412d, roughness: 0.7 }),
  bone: new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.6 }),
  egg: new THREE.MeshStandardMaterial({ color: 0xf3e3c3, roughness: 0.5 }),
  ticket: new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.5 }),
};

/** Cash value of each sellable item (counter price; gate runs pay the same per item). */
export const ITEM_VALUE: Record<ItemType, number> = { crumb: 2, snack: 5, leaf: 3, wrap: 14, sugar: 10, candy: 40, cash: 0, bag: 15, snackbox: 25, fruit: 0, smoothie: 60, meat: 0, egg: 80, ticket: 50 };

/** Build the 3D mesh for one item. Box faces order: +x, -x, +y(top), -y, +z, -z */
export function makeItem(type: ItemType): THREE.Mesh {
  let m: THREE.Mesh;
  if (type === 'crumb') {
    m = new THREE.Mesh(geo.crumb, mat.crumb);
    m.rotation.y = Math.random() * 0.8 - 0.4; // crumbs look more natural a bit crooked
  } else if (type === 'snack') {
    const s = mat.snackSide;
    m = new THREE.Mesh(geo.snack, [s, s, mat.snackTop, s, s, s]);
  } else if (type === 'leaf') {
    m = new THREE.Mesh(geo.leaf, mat.leaf);
    m.rotation.y = Math.random() * 0.8 - 0.4;
  } else if (type === 'wrap') {
    m = new THREE.Mesh(geo.wrap, [mat.wrapSide, mat.wrapEnd, mat.wrapEnd]);
  } else if (type === 'sugar') {
    m = new THREE.Mesh(geo.sugar, mat.sugar);
  } else if (type === 'candy') {
    const s = mat.candySide;
    m = new THREE.Mesh(geo.candy, [s, s, mat.candyTop, s, s, s]);
  } else if (type === 'bag') {
    // A suitcase in a random color, with a little handle on top
    m = new THREE.Mesh(geo.bag, mat.bags[Math.floor(Math.random() * mat.bags.length)]);
    const handle = new THREE.Mesh(geo.bagHandle, mat.handle);
    handle.position.y = 0.23;
    m.add(handle);
  } else if (type === 'fruit') {
    m = new THREE.Mesh(geo.fruit, mat.fruit);
    const top = new THREE.Mesh(geo.leafTop, mat.leaf); // reuses the leaf green
    top.position.y = 0.2;
    m.add(top);
  } else if (type === 'smoothie') {
    m = new THREE.Mesh(geo.cup, mat.cup);
    const straw = new THREE.Mesh(geo.straw, mat.straw);
    straw.position.set(0.06, 0.28, 0);
    straw.rotation.z = -0.25;
    m.add(straw);
  } else if (type === 'meat') {
    m = new THREE.Mesh(geo.meat, mat.meat);
    m.rotation.z = Math.PI / 2; // lies on its side
    const bone = new THREE.Mesh(geo.bone, mat.bone);
    bone.position.y = 0.32;
    m.add(bone);
  } else if (type === 'egg') {
    m = new THREE.Mesh(geo.egg, mat.egg);
  } else if (type === 'ticket') {
    m = new THREE.Mesh(geo.ticket, mat.ticket);
  } else if (type === 'snackbox') {
    const s = mat.boxSide;
    m = new THREE.Mesh(geo.snackbox, [s, s, mat.boxTop, s, s, s]);
  } else {
    const s = mat.cashSide;
    m = new THREE.Mesh(geo.cash, [s, s, mat.cashTop, s, s, s]);
  }
  m.castShadow = true;
  return m;
}

export interface StackItem {
  mesh: THREE.Mesh;
  type: ItemType;
  value: number;    // only used by cash bills
  flying: boolean;  // true while it's still hopping into place
}

/** Where item #i of a stack sits, in the parent's local space. */
export type Layout = (i: number, type: ItemType, out: THREE.Vector3) => THREE.Vector3;

export class Stack {
  items: StackItem[] = [];

  constructor(
    public parent: THREE.Object3D,
    public layout: Layout,
    public max: number,
  ) {}

  get count() {
    return this.items.length;
  }
  get full() {
    return this.items.length >= this.max;
  }
  get topType(): ItemType | null {
    return this.items.length ? this.items[this.items.length - 1].type : null;
  }
  /** True if the top item has landed and can be taken. */
  canPop() {
    const top = this.items[this.items.length - 1];
    return !!top && !top.flying;
  }
  pop(): StackItem | undefined {
    return this.canPop() ? this.items.pop() : undefined;
  }
  /** Does the stack hold a landed item of this type (anywhere, not just the top)? */
  has(type: ItemType) {
    return this.items.some((it) => it.type === type && !it.flying);
  }
  /** How many of each type (for the inventory panel). */
  counts() {
    const out = new Map<ItemType, number>();
    for (const it of this.items) out.set(it.type, (out.get(it.type) ?? 0) + 1);
    return out;
  }
  /**
   * Take the highest landed item of `type` out of the stack, wherever it is.
   * (The items above it slide down; the owner re-lays them out each frame.)
   */
  popType(type: ItemType): StackItem | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.type === type && !it.flying) {
        this.items.splice(i, 1);
        return it;
      }
    }
    return undefined;
  }
  /** World position of slot i (for flying items to aim at). */
  slotWorld(i: number, type: ItemType, out: THREE.Vector3) {
    this.layout(i, type, out);
    return this.parent.localToWorld(out);
  }
  /** Add an item with no animation (used when piles regrow / on load). */
  addInstant(type: ItemType, value = 0): StackItem {
    const it: StackItem = { mesh: makeItem(type), type, value, flying: false };
    this.items.push(it);
    this.layout(this.items.length - 1, type, it.mesh.position);
    this.parent.add(it.mesh);
    return it;
  }
  /** Remove every item (used when a cart launches on a run). */
  clear() {
    this.items.forEach((it) => it.mesh.removeFromParent());
    this.items = [];
  }
}

interface Flight {
  mesh: THREE.Object3D;
  from: THREE.Vector3;
  target: () => THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  onLand: () => void;
}

interface Grow {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  to: number;
}

export class Flyers {
  private flights: Flight[] = [];
  private grows: Grow[] = [];
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {}

  /** Fly any object from where it is now to a (possibly moving) target. */
  fly(mesh: THREE.Object3D, target: () => THREE.Vector3, onLand: () => void, dur = 0.28, arc = 1.1) {
    const from = new THREE.Vector3();
    mesh.getWorldPosition(from);
    mesh.removeFromParent();
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.flights.push({ mesh, from, target, t: 0, dur, arc, onLand });
  }

  /** Put an item onto a stack with a hop animation. */
  pushInto(it: StackItem, to: Stack, dur = 0.28) {
    it.flying = true;
    to.items.push(it);
    const index = to.items.length - 1;
    const tmp = new THREE.Vector3();
    this.fly(
      it.mesh,
      () => to.slotWorld(index, it.type, tmp),
      () => {
        it.flying = false;
        to.parent.add(it.mesh);
        to.layout(index, it.type, it.mesh.position);
      },
      dur,
    );
  }

  /** Move the top item of one stack onto another. Returns the item or null. */
  transfer(from: Stack, to: Stack): StackItem | null {
    if (to.full) return null;
    const it = from.pop();
    if (!it) return null;
    this.pushInto(it, to);
    return it;
  }

  /** Move one item of a given type (from anywhere in `from`) onto `to`. */
  transferType(from: Stack, to: Stack, type: ItemType): StackItem | null {
    if (to.full) return null;
    const it = from.popType(type);
    if (!it) return null;
    this.pushInto(it, to);
    return it;
  }

  /** Make something pop into existence with a little bounce. */
  grow(obj: THREE.Object3D, dur = 0.35) {
    const to = obj.scale.x || 1;
    obj.scale.setScalar(0.001);
    this.grows.push({ obj, t: 0, dur, to });
  }

  update(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t * f.t * (3 - 2 * f.t); // smoothstep easing
      const target = f.target();
      this.tmp.lerpVectors(f.from, target, e);
      this.tmp.y += Math.sin(Math.PI * f.t) * f.arc; // the hop
      f.mesh.position.copy(this.tmp);
      if (f.t >= 1) {
        this.flights.splice(i, 1);
        f.onLand();
      }
    }
    for (let i = this.grows.length - 1; i >= 0; i--) {
      const g = this.grows[i];
      g.t = Math.min(1, g.t + dt / g.dur);
      // "back out" easing: overshoots a little, then settles = bouncy pop
      const c = 1.70158;
      const x = g.t - 1;
      const s = 1 + (c + 1) * x * x * x + c * x * x;
      g.obj.scale.setScalar(Math.max(0.001, s * g.to));
      if (g.t >= 1) this.grows.splice(i, 1);
    }
  }
}
