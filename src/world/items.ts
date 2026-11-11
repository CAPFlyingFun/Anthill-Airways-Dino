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

export type ItemType = 'crumb' | 'snack' | 'cash';

/** Height of one item when stacked. */
export const ITEM_H: Record<ItemType, number> = { crumb: 0.3, snack: 0.32, cash: 0.11 };

// Shared geometry + materials: every crumb reuses the same ones (fast).
const geo = {
  crumb: new THREE.BoxGeometry(0.42, 0.28, 0.42),
  snack: new THREE.BoxGeometry(0.56, 0.3, 0.42),
  cash: new THREE.BoxGeometry(0.62, 0.1, 0.36),
};
const mat = {
  crumb: new THREE.MeshStandardMaterial({ color: 0xdca44a, roughness: 0.9 }),
  snackSide: new THREE.MeshStandardMaterial({ color: 0xe0533c, roughness: 0.6 }),
  snackTop: new THREE.MeshStandardMaterial({ color: 0xffd25a, roughness: 0.6 }),
  cashSide: new THREE.MeshStandardMaterial({ color: 0x3f9d4a, roughness: 0.7 }),
  cashTop: new THREE.MeshStandardMaterial({ color: 0x8be36a, roughness: 0.7 }),
};

/** Build the 3D mesh for one item. Box faces order: +x, -x, +y(top), -y, +z, -z */
export function makeItem(type: ItemType): THREE.Mesh {
  let m: THREE.Mesh;
  if (type === 'crumb') {
    m = new THREE.Mesh(geo.crumb, mat.crumb);
    m.rotation.y = Math.random() * 0.8 - 0.4; // crumbs look more natural a bit crooked
  } else if (type === 'snack') {
    const s = mat.snackSide;
    m = new THREE.Mesh(geo.snack, [s, s, mat.snackTop, s, s, s]);
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
