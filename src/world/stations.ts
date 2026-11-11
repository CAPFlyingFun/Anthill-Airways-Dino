// ============================================================================
// stations.ts — everything you walk up to and interact with:
//   ResourcePile — raw items regrow here (crumbs, leaves, sugar cubes)
//   Bakery       — any processor: raw IN, goods OUT (oven, leaf press, candy press)
//   Counter      — drop goods, customers buy them, cash comes out
//   CashPad      — where the cash bills pile up
//   DispatchPad  — load goods onto a cart / raft for a gate run
//   Hatchery     — feed it leaf wraps and new worker ants hatch
//   UnlockTile   — the glowing squares you pour cash into
//
// Every station takes options, so each zone can reuse them with new items.
// ============================================================================
import * as THREE from 'three';
import { CONFIG, UnlockDef } from '../data/config';
import { Flyers, ITEM_H, ITEM_VALUE, ItemType, Layout, Stack, StackItem, makeItem } from './items';
import { GAME_FONT, TextSprite, gameText, makePad, roundRect } from './labels';
import { CreatureModel, animateCreature, faceToward, makeAnt, makeBeetle } from '../actors/models';
import { CreatureKind, spawnCreature } from '../actors/creatures';
import { BUGS, Mind, newMind, stepBug } from '../actors/brain';

const mat = (color: number, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });

/** Axis-aligned box the player can't walk through. */
export interface Blocker {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A rectangular "stand here" zone. */
export class Zone {
  constructor(public x: number, public z: number, public halfW: number, public halfD: number) {}
  contains(p: THREE.Vector3) {
    return Math.abs(p.x - this.x) <= this.halfW && Math.abs(p.z - this.z) <= this.halfD;
  }
}

/** Items in a neat grid that grows upward in layers. */
export function gridLayout(cols: number, rows: number, sx: number, sz: number, y0: number, ox = 0, oz = 0): Layout {
  return (i, type, out) => {
    const per = cols * rows;
    const layer = Math.floor(i / per);
    const k = i % per;
    const c = k % cols;
    const r = Math.floor(k / cols);
    const h = ITEM_H[type];
    return out.set(ox + (c - (cols - 1) / 2) * sx, y0 + layer * h + h / 2, oz + (r - (rows - 1) / 2) * sz);
  };
}

const woodMat = new THREE.MeshStandardMaterial({ color: 0xa8743f, roughness: 0.8 });
const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x7a4f27, roughness: 0.8 });

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ----------------------------------------------------------------------------
export type PileStyle = 'bread' | 'plant' | 'vending';

export class ResourcePile {
  group = new THREE.Group();
  stack: Stack;
  zone: Zone;
  private spawnT = 0;

  constructor(scene: THREE.Scene, x: number, z: number, private flyers: Flyers, public type: ItemType = 'crumb', style: PileStyle = 'bread') {
    this.group.position.set(x, 0, z);
    scene.add(this.group);

    const mound = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.55, 0.22, 20),
      new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 1 }),
    );
    mound.position.y = 0.11;
    mound.receiveShadow = true;
    this.group.add(mound);

    // Behind the pile: where the stuff "comes from".
    const source = new THREE.Group();
    source.position.set(0, 0, -2.0);
    if (style === 'bread') {
      source.add(box(1.7, 1.0, 1.1, mat(0xf0c27a, 0.95), 0, 0.5, 0));
      source.add(box(1.8, 0.25, 1.2, mat(0xb5702c, 0.9), 0, 1.08, 0));
      source.rotation.y = 0.35;
    } else if (style === 'plant') {
      // A clover-ish plant: a stem and big leaves
      source.add(box(0.15, 2.2, 0.15, mat(0x3f7f2a), 0, 1.1, 0));
      const leafMat = mat(0x5cbf43, 0.6);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 8).scale(1, 0.15, 1.6), leafMat);
        const a = (i / 5) * Math.PI * 2;
        leaf.position.set(Math.sin(a) * 0.75, 1.0 + i * 0.28, Math.cos(a) * 0.75);
        leaf.rotation.y = a;
        leaf.rotation.x = 0.35;
        leaf.castShadow = true;
        source.add(leaf);
      }
    } else {
      // A vending machine (giant, from an ant's point of view)
      source.add(box(2.4, 3.4, 1.2, mat(0x2f6fd6, 0.5), 0, 1.7, -0.3));
      source.add(box(1.6, 2.2, 0.08, new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 }), -0.25, 2.0, 0.32));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        source.add(box(0.35, 0.3, 0.3, mat([0xff6fb5, 0xffd166, 0x7df9a0][(r + c) % 3], 0.4), -0.75 + c * 0.5, 1.3 + r * 0.6, 0.1));
      }
      source.add(box(0.5, 0.25, 0.1, mat(0x222222), 0.75, 0.7, 0.32)); // coin slot / tray
      source.position.z = -2.2;
    }
    this.group.add(source);

    const pad = makePad(3.2, 3.2, '', '#ffe07a');
    pad.position.y = 0.235;
    this.group.add(pad);

    this.zone = new Zone(x, z, 1.6, 1.6);
    this.stack = new Stack(this.group, gridLayout(3, 3, 0.48, 0.48, 0.22), CONFIG.crumbPile.max);
    for (let i = 0; i < CONFIG.crumbPile.max; i++) this.stack.addInstant(type);
  }

  update(dt: number) {
    if (this.stack.full) {
      this.spawnT = 0;
      return;
    }
    this.spawnT += dt;
    if (this.spawnT >= CONFIG.crumbPile.spawnInterval) {
      this.spawnT = 0;
      this.flyers.grow(this.stack.addInstant(this.type).mesh, 0.25);
    }
  }
}

// ----------------------------------------------------------------------------
export interface ProcessorOpts {
  inType: ItemType;
  outType: ItemType;
  label: string;
  cookTime: number;
  body: number;   // main color
  trim: number;   // roof / chimney color
  glow: number;   // door glow color
}
export const OVEN: ProcessorOpts = { inType: 'crumb', outType: 'snack', label: 'OVEN', cookTime: 1.3, body: 0xc8553d, trim: 0x8c3426, glow: 0xff7a1a };

export class Bakery {
  group = new THREE.Group();
  input: Stack;
  output: Stack;
  inZone: Zone;
  outZone: Zone;
  blocker: Blocker;
  cookTime: number;
  private cooking = false;
  private cookT = 0;
  private mouth = new THREE.Object3D();
  private doorMat: THREE.MeshStandardMaterial;
  private flame: THREE.Mesh;

  constructor(private scene: THREE.Scene, x: number, z: number, private flyers: Flyers, public opts: ProcessorOpts = OVEN) {
    this.cookTime = opts.cookTime;
    this.group.position.set(x, 0, z);
    scene.add(this.group);

    const brick = new THREE.MeshStandardMaterial({ color: opts.body, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: opts.trim, roughness: 0.85 });
    this.group.add(box(3.2, 2.0, 2.0, brick, 0, 1.0, 0));
    this.group.add(box(3.4, 0.3, 2.2, trim, 0, 2.15, 0));
    // A rounded "dome" top
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 3.2, 20, 1, false, 0, Math.PI), brick);
    dome.rotation.z = Math.PI / 2;
    dome.position.y = 2.3;
    dome.castShadow = true;
    this.group.add(dome);
    const chimney = box(0.5, 1.2, 0.5, trim, 1.05, 3.1, -0.4);
    this.group.add(chimney);

    // Glowing oven door
    this.doorMat = new THREE.MeshStandardMaterial({ color: 0x331a0f, emissive: opts.glow, emissiveIntensity: 0.4 });
    const door = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20, 0, Math.PI), this.doorMat);
    door.position.set(0, 0.55, 1.01);
    this.group.add(door);
    this.mouth.position.set(0, 0.8, 1.2);
    this.group.add(this.mouth);

    // Flame on the chimney (only shows after the Faster Oven upgrade)
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xff6a00, emissiveIntensity: 1 }),
    );
    this.flame.position.set(1.05, 4.0, -0.4);
    this.flame.visible = false;
    this.group.add(this.flame);

    // Side tables for the input / output piles
    for (const s of [-1, 1]) {
      this.group.add(box(1.5, 0.4, 1.5, woodMat, s * 2.3, 0.2, 0.6));
    }
    this.input = new Stack(this.group, gridLayout(3, 3, 0.46, 0.46, 0.4, -2.3, 0.6), CONFIG.bakery.inputMax);
    const wide = opts.outType === 'wrap' || opts.outType === 'snack' || opts.outType === 'candy';
    this.output = new Stack(this.group, gridLayout(wide ? 2 : 3, 3, wide ? 0.62 : 0.46, 0.46, 0.4, 2.3, 0.6), CONFIG.bakery.outputMax);

    const inPad = makePad(2.2, 2.2, 'IN');
    inPad.position.set(-2.3, 0.03, 2.6);
    const outPad = makePad(2.2, 2.2, 'OUT');
    outPad.position.set(2.3, 0.03, 2.6);
    this.group.add(inPad, outPad);
    this.inZone = new Zone(x - 2.3, z + 2.6, 1.15, 1.15);
    this.outZone = new Zone(x + 2.3, z + 2.6, 1.15, 1.15);
    this.blocker = { minX: x - 3.05, maxX: x + 3.05, minZ: z - 1.1, maxZ: z + 1.4 };

    const sign = new TextSprite(0.9);
    sign.setText(opts.label);
    sign.sprite.position.set(0, 4.2, 0);
    this.group.add(sign.sprite);
  }

  makeFaster() {
    this.cookTime = this.opts.cookTime / CONFIG.bakery.fastOvenMultiplier;
    this.flame.visible = true;
  }

  update(dt: number) {
    const mouthWorld = new THREE.Vector3();
    this.mouth.getWorldPosition(mouthWorld);

    // Start cooking: pull one crumb into the oven.
    if (!this.cooking && this.input.canPop() && !this.output.full) {
      const it = this.input.pop()!;
      this.flyers.fly(it.mesh, () => mouthWorld, () => it.mesh.removeFromParent(), 0.25, 0.6);
      this.cooking = true;
      this.cookT = 0;
    }

    if (this.cooking) {
      this.cookT += dt;
      this.doorMat.emissiveIntensity = 0.6 + Math.sin(this.cookT * 18) * 0.3;
      if (this.cookT >= this.cookTime) {
        this.cooking = false;
        const it: StackItem = { mesh: makeItem(this.opts.outType), type: this.opts.outType, value: 0, flying: false };
        it.mesh.position.copy(mouthWorld);
        this.scene.add(it.mesh);
        this.flyers.pushInto(it, this.output, 0.3);
      }
    } else {
      this.doorMat.emissiveIntensity = 0.3;
    }
    if (this.flame.visible) this.flame.scale.y = 1 + Math.sin(performance.now() * 0.02) * 0.2;
  }
}

// ----------------------------------------------------------------------------
const BEETLE_COLORS = [0xe63946, 0x2a9d8f, 0xf4a261, 0x6a4c93, 0x1d70a2, 0xffb703];
// Customers are the other bugs of the backyard; their brains live in actors/brain.ts.
export interface CounterOpts {
  itemType: ItemType;           // what this counter sells
  facing: 1 | -1;               // +1: customers line up to the east, -1: to the west
  customers: CreatureKind[];    // which bugs shop here
  color: number;
}
export const SNACK_COUNTER: CounterOpts = { itemType: 'snack', facing: 1, customers: ['black-widow', 'jumping-spider', 'housefly', 'aphid', 'wolf-spider'], color: 0x3d6fb6 };

interface Customer {
  model: CreatureModel;
  mind: Mind;
  held: Stack;
  wants: number;
  ready: boolean;        // in its spot and calm this frame (can be served)
  path: THREE.Vector3[]; // waypoints still to go (used when leaving)
}

export class Counter {
  group = new THREE.Group();
  shelf: Stack;
  sellZone: Zone;
  blocker: Blocker;
  hasCashier = false;
  /** Called every time a snack is sold (tutorial + XP). */
  onSale: (byPlayer: boolean) => void = () => {};
  /** Multiplier on sale value (Haggling stat). */
  valueMult: () => number = () => 1;
  private queue: Customer[] = [];
  private leaving: Customer[] = [];
  private spawnT = 1.5;
  private saleT = 0;
  private register = new THREE.Object3D();
  private cashier: CreatureModel | null = null;
  private tmp = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene, private x: number, private z: number, private flyers: Flyers, private cashPad: CashPad,
    public opts: CounterOpts = SNACK_COUNTER,
  ) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const f = opts.facing;

    const blue = new THREE.MeshStandardMaterial({ color: opts.color, roughness: 0.6 });
    const blueTop = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.color).offsetHSL(0, 0, 0.12), roughness: 0.5 });
    this.group.add(box(1.3, 0.9, 3.4, blue, 0, 0.45, 0));
    this.group.add(box(1.45, 0.12, 3.55, blueTop, 0, 0.96, 0));
    // Cash register (purple, like the reference screenshot)
    const reg = box(0.55, 0.35, 0.5, new THREE.MeshStandardMaterial({ color: 0xb48ce6, roughness: 0.4 }), 0, 1.2, 1.35);
    this.group.add(reg);
    this.register.position.set(0, 1.4, 1.35);
    this.group.add(this.register);

    this.shelf = new Stack(this.group, gridLayout(2, 4, 0.6, 0.5, 1.02, 0, -0.35), CONFIG.counter.shelfMax);

    const sellPad = makePad(2.4, 3.2, 'SELL');
    sellPad.position.set(-2.3 * f, 0.03, 0);
    this.group.add(sellPad);
    this.sellZone = new Zone(x - 2.3 * f, z, 1.2, 1.6);
    this.blocker = { minX: x - 0.75, maxX: x + 0.75, minZ: z - 1.8, maxZ: z + 1.8 };
  }

  /** Spawn the cashier ant who sells for you. */
  hireCashier(animate: boolean) {
    this.hasCashier = true;
    this.cashier = spawnCreature('worker', 2.0) ?? makeAnt(0x4a2c1a);
    // Give the cashier a little green visor so you can tell who's who.
    const m = this.cashier;
    const visor = new THREE.Mesh(
      new THREE.CylinderGeometry(m.length * 0.14, m.length * 0.14, 0.05, 16, 1, false, -Math.PI / 2, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x3fbf5a }),
    );
    visor.position.set(0, m.height * 0.85, m.length * 0.38);
    this.cashier.bob.add(visor);
    this.cashier.root.position.set(this.x - 1.15 * this.opts.facing, 0, this.z + 1.0);
    this.cashier.root.rotation.y = (Math.PI / 2) * this.opts.facing; // face the customers
    this.scene.add(this.cashier.root);
    if (animate) this.flyers.grow(this.cashier.root);
  }

  private slot(i: number, out: THREE.Vector3) {
    return out.set(this.x + this.opts.facing * (2.0 + i * 2.3), 0, this.z - 0.4);
  }

  private spawnCustomer() {
    const kinds = this.opts.customers;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const species = BUGS[kind];
    const model = spawnCreature(kind, species.length) ?? makeBeetle(BEETLE_COLORS[Math.floor(Math.random() * BEETLE_COLORS.length)]);
    if (species.medium === 'soil') {
      // Earthworms pop up out of the ground right at the back of the line.
      this.slot(this.queue.length, model.root.position);
      model.root.position.y = -1.5;
    } else {
      model.root.position.set(this.x + this.opts.facing * 15, 0, this.z - 0.4);
    }
    this.scene.add(model.root);
    const top = model.height * 0.9;
    const held = new Stack(model.bob, (i, type, out) => out.set(0, top + i * ITEM_H[type] + ITEM_H[type] / 2, -model.length * 0.1), 4);
    this.queue.push({ model, mind: newMind(species), held, wants: 1 + Math.floor(Math.random() * 3), ready: false, path: [] });
  }

  update(dt: number, playerServing: boolean, sfx: { sale(): void }, playerPos: THREE.Vector3) {
    // New customers arrive while there's room in line.
    this.spawnT += dt;
    if (this.spawnT >= CONFIG.counter.customerInterval && this.queue.length < CONFIG.counter.queueMax) {
      this.spawnT = 0;
      this.spawnCustomer();
    }

    // Everyone in line heads for their spot, using their own brain:
    // spiders hop or rear up at you, flies hover in line, aphids just plod.
    this.queue.forEach((c, i) => {
      c.ready = stepBug(c.model, c.mind, this.slot(i, this.tmp), playerPos, dt);
      if (c.ready) faceToward(c.model, -this.opts.facing, 0, dt, c.mind.species.medium === 'air' ? 4 : 12); // look at the counter
    });

    // The front customer buys if someone is at the register.
    const front = this.queue[0];
    const serving = playerServing || this.hasCashier;
    if (front && serving && front.ready) {
      this.saleT += dt;
      if (this.saleT >= CONFIG.counter.saleInterval && this.shelf.canPop() && front.wants > 0) {
        this.saleT = 0;
        if (this.flyers.transfer(this.shelf, front.held)) {
          front.wants--;
          this.spawnBill();
          sfx.sale();
          this.onSale(playerServing);
        }
      }
    }
    if (front && front.wants <= 0 && front.held.canPop()) {
      // Happy customer leaves. Fliers literally fly away with their snacks!
      this.queue.shift();
      const p = front.model.root.position;
      const f = this.opts.facing;
      const medium = front.mind.species.medium;
      front.path = medium === 'air'
        ? [new THREE.Vector3(this.x + f * 20, 0, this.z - 8)]
        : medium === 'soil'
          ? [p.clone()] // worms burrow straight down where they are
          : [new THREE.Vector3(p.x, 0, this.z + 2.3), new THREE.Vector3(this.x + f * 16, 0, this.z + 2.3)];
      this.leaving.push(front);
    }

    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const c = this.leaving[i];
      const arrived = stepBug(c.model, c.mind, c.path[0], playerPos, dt, true);
      const near = Math.hypot(c.path[0].x - c.model.root.position.x, c.path[0].z - c.model.root.position.z) < 0.3;
      if (arrived || near) {
        c.path.shift();
        if (!c.path.length) {
          c.model.root.removeFromParent();
          this.leaving.splice(i, 1);
        }
      }
    }

    if (this.cashier) animateCreature(this.cashier, dt, 0);
  }

  /** A cash bill pops out of the register and lands on the cash pad. */
  private spawnBill() {
    const value = Math.round(ITEM_VALUE[this.opts.itemType] * this.valueMult());
    if (this.cashPad.stack.full) {
      // Pad is full: add the value to the top bill instead.
      this.cashPad.stack.items[this.cashPad.stack.count - 1].value += value;
      return;
    }
    const it: StackItem = { mesh: makeItem('cash'), type: 'cash', value, flying: false };
    this.register.getWorldPosition(it.mesh.position);
    this.scene.add(it.mesh);
    this.flyers.pushInto(it, this.cashPad.stack, 0.35);
  }
}

// ----------------------------------------------------------------------------
export class CashPad {
  group = new THREE.Group();
  stack: Stack;
  zone: Zone;

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const base = box(2.0, 0.08, 2.0, new THREE.MeshStandardMaterial({ color: 0x2d3a40, roughness: 0.7 }), 0, 0.04, 0);
    this.group.add(base);
    const pad = makePad(2.4, 2.4, '', '#5dff8f');
    pad.position.y = 0.09;
    this.group.add(pad);
    this.stack = new Stack(this.group, gridLayout(2, 3, 0.68, 0.42, 0.08), 90);
    this.zone = new Zone(x, z, 1.2, 1.2);
  }
}

// ----------------------------------------------------------------------------
export type RunTheme = 'grass' | 'gutter';

/** The vehicle a gate run uses: a wheeled cart (grass) or a leaf raft (gutter). */
export function makeVehicle(theme: RunTheme): { group: THREE.Group; deckY: number } {
  const g = new THREE.Group();
  if (theme === 'gutter') {
    const raft = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10).scale(1.1, 0.12, 1.6), mat(0x4caf3a, 0.6));
    raft.position.y = 0.2;
    raft.castShadow = true;
    g.add(raft);
    g.add(box(0.08, 0.06, 3.0, mat(0x2f7d32), 0, 0.33, 0)); // the leaf's middle vein
    return { group: g, deckY: 0.36 };
  }
  g.add(box(1.7, 0.5, 2.0, woodMat, 0, 0.55, 0));
  g.add(box(1.8, 0.12, 2.1, darkWoodMat, 0, 0.85, 0));
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.15, 14);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a });
  for (const sx of [-1, 1]) {
    for (const sz of [-0.6, 0.6]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 0.92, 0.35, sz);
      w.castShadow = true;
      g.add(w);
    }
  }
  return { group: g, deckY: 0.91 };
}

export class DispatchPad {
  group = new THREE.Group();
  cargo: Stack;
  zone: Zone;
  blocker: Blocker;
  beetle: CreatureModel;

  constructor(scene: THREE.Scene, x: number, z: number, public itemType: ItemType = 'snack', public theme: RunTheme = 'grass') {
    this.group.position.set(x, 0, z);
    scene.add(this.group);

    const pad = makePad(2.4, 2.4, 'LOAD', '#ffb347');
    this.group.add(pad);
    this.zone = new Zone(x, z, 1.2, 1.2);

    // The vehicle, parked to the right and facing +x.
    const cart = new THREE.Group();
    cart.position.set(3.4, 0, 0);
    cart.rotation.y = Math.PI / 2;
    this.group.add(cart);
    if (theme === 'gutter') {
      // A little puddle for the raft to float in
      const water = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshStandardMaterial({ color: 0x4aa8ff, roughness: 0.1, transparent: true, opacity: 0.85 }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.04;
      cart.add(water);
    }
    const v = makeVehicle(theme);
    cart.add(v.group);
    this.cargo = new Stack(cart, gridLayout(3, 4, 0.56, 0.46, v.deckY), CONFIG.cart.max);
    this.beetle = spawnCreature('aphid', 1.9) ?? makeBeetle(0x2a9d8f);
    this.beetle.root.position.set(0, 0, 1.9);
    cart.add(this.beetle.root);

    // Little flag so the spot reads as "the start line"
    const pole = box(0.08, 2.4, 0.08, darkWoodMat, -1.6, 1.2, -1.4);
    const flagCanvas = document.createElement('canvas');
    flagCanvas.width = 64;
    flagCanvas.height = 64;
    const fc = flagCanvas.getContext('2d')!;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      fc.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      fc.fillRect(i * 16, j * 16, 16, 16);
    }
    const flagTex = new THREE.CanvasTexture(flagCanvas);
    flagTex.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.set(-1.15, 2.1, -1.4);
    this.group.add(pole, flag);

    const sign = new TextSprite(0.8, '#ffd166');
    sign.setText(theme === 'gutter' ? 'RAFT RUNS' : 'GATE RUNS');
    sign.sprite.position.set(3.4, 2.8, 0);
    this.group.add(sign.sprite);

    this.blocker = { minX: x + 2.4, maxX: x + 5.6, minZ: z - 1.1, maxZ: z + 1.1 };
  }

  update(dt: number) {
    animateCreature(this.beetle, dt, 0);
  }
}

// ----------------------------------------------------------------------------
/**
 * The Hatchery: feed it leaf wraps. Every few wraps an egg hatches into a
 * new worker ant, who joins the Brood Tunnels' crew for free.
 */
export class Hatchery {
  group = new THREE.Group();
  input: Stack;
  zone: Zone;
  /** Wraps fed toward the next hatch. */
  progress = 0;
  /** Called when an egg hatches; `index` = how many have hatched so far. */
  onHatch: () => void = () => {};
  private sign = new TextSprite(0.75, '#fff3b0');
  private eggs: THREE.Mesh[] = [];
  private eatT = 0;

  constructor(private scene: THREE.Scene, x: number, z: number, private flyers: Flyers, public hatched: number, public maxHatch: number) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), mat(0x6b4a2f, 1));
    mound.position.z = -2.9;
    mound.receiveShadow = true;
    mound.castShadow = true;
    this.group.add(mound);
    const eggMat = new THREE.MeshStandardMaterial({ color: 0xfffbea, roughness: 0.4, emissive: 0xfff3b0, emissiveIntensity: 0.15 });
    for (let i = 0; i < 6; i++) {
      const egg = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8).scale(1, 1.4, 1), eggMat);
      const a = (i / 6) * Math.PI * 2;
      egg.position.set(Math.sin(a) * 0.8, 0.95, -2.9 + Math.cos(a) * 0.6);
      egg.castShadow = true;
      this.group.add(egg);
      this.eggs.push(egg);
    }
    const pad = makePad(2.4, 2.4, 'FEED', '#fff3b0');
    this.group.add(pad);
    this.zone = new Zone(x, z, 1.2, 1.2);
    this.input = new Stack(this.group, gridLayout(3, 2, 0.6, 0.5, 0.05, 0, -0.3), 12);
    this.sign.sprite.position.set(0, 2.9, -2.9);
    this.group.add(this.sign.sprite);
  }

  /** Wraps needed for the next egg (each hatch needs a few more). */
  get needed() {
    return 6 + this.hatched * 4;
  }

  update(dt: number) {
    const full = this.hatched >= this.maxHatch;
    this.sign.setText(full ? '🥚 NURSERY FULL' : `🥚 ${this.progress}/${this.needed}`);
    this.eggs.forEach((e, i) => (e.scale.y = 1 + Math.sin(performance.now() * 0.004 + i) * 0.06));
    if (full) return;
    // Eat one wrap at a time off the pad.
    this.eatT += dt;
    if (this.eatT > 0.4 && this.input.canPop()) {
      this.eatT = 0;
      const it = this.input.pop()!;
      const target = new THREE.Vector3();
      this.eggs[Math.floor(Math.random() * this.eggs.length)].getWorldPosition(target);
      this.flyers.fly(it.mesh, () => target, () => it.mesh.removeFromParent(), 0.35, 1.2);
      this.progress++;
      if (this.progress >= this.needed) {
        this.progress = 0;
        this.hatched++;
        this.onHatch();
      }
    }
  }
}

// ----------------------------------------------------------------------------
/** Trash bin: stand on it to dump whatever you're carrying (one type at a time!). */
export class TrashBin {
  group = new THREE.Group();
  zone: Zone;
  mouth = new THREE.Vector3();

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 1.6, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a949e, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide }));
    can.position.set(0, 0.8, -1.7);
    can.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 8, 24), mat(0x6b747d, 0.4));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 1.6, -1.7);
    this.group.add(can, rim);
    const pad = makePad(2.0, 2.0, '🗑️', '#c9d1d9');
    this.group.add(pad);
    this.zone = new Zone(x, z, 1.0, 1.0);
    this.mouth.set(x, 1.4, z - 1.7);
  }
}

// ----------------------------------------------------------------------------
export class UnlockTile {
  mesh: THREE.Mesh;
  zone: Zone;
  paid: number;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private shown = '';
  private pulseT = Math.random() * 6;

  constructor(scene: THREE.Scene, public def: UnlockDef, paid: number) {
    this.paid = paid;
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(def.pos[0], 0.04, def.pos[1]);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.zone = new Zone(def.pos[0], def.pos[1], 1.25, 1.25);
  }

  get remaining() {
    return Math.max(0, Math.ceil(this.def.cost - this.paid));
  }

  /** Redraw only when the number or color actually changes. */
  draw(affordable: boolean) {
    const key = `${this.remaining}|${affordable}`;
    if (key === this.shown) return;
    this.shown = key;
    const c = this.ctx;
    c.clearRect(0, 0, 256, 256);
    roundRect(c, 10, 10, 236, 236, 34);
    c.fillStyle = 'rgba(30, 40, 50, 0.5)';
    c.fill();
    c.setLineDash([24, 14]);
    c.lineWidth = 10;
    c.strokeStyle = affordable ? '#ffe066' : '#bdefff';
    c.stroke();
    c.setLineDash([]);
    c.font = `84px ${GAME_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(this.def.icon, 128, 78);
    gameText(c, this.def.name, 128, 146, this.def.name.length > 13 ? 22 : 28);
    gameText(c, `$${this.remaining}`, 128, 202, 50, affordable ? '#ffe066' : '#ffffff');
    this.tex.needsUpdate = true;
  }

  update(dt: number, affordable: boolean) {
    this.draw(affordable);
    this.pulseT += dt;
    const s = affordable ? 1 + Math.sin(this.pulseT * 5) * 0.04 : 1;
    this.mesh.scale.set(s, s, 1);
  }
}

// ----------------------------------------------------------------------------
/**
 * Conveyor belt: carries snack packs from the oven's OUT table to the
 * counter shelf by itself. Items ride along a path of straight segments.
 */
export class Conveyor {
  group = new THREE.Group();
  blockers: Blocker[] = [];
  private path: THREE.Vector3[];
  private segLen: number[] = [];
  private total = 0;
  private riders: { it: StackItem; d: number }[] = [];
  private pending = 0; // items hopping onto the belt right now
  private pullT = 0;
  private beltTex: THREE.CanvasTexture[] = [];
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private bakery: Bakery, private counter: Counter, private flyers: Flyers) {
    scene.add(this.group);
    const y = 0.62;
    // Oven OUT table (2.3, -8.4) -> east -> north to the back of the counter (9, -4.9)
    const ox = bakery.outZone.x;
    const oz = bakery.outZone.z - 2.0;
    const cx = counter.sellZone.x + 2.3;
    const cz = counter.sellZone.z - 1.9;
    this.path = [
      new THREE.Vector3(ox + 1.1, y, oz),
      new THREE.Vector3(cx, y, oz),
      new THREE.Vector3(cx, y, cz),
    ];
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i];
      const b = this.path[i + 1];
      const len = a.distanceTo(b);
      this.segLen.push(len);
      this.total += len;
      this.buildSegment(a, b, len);
    }
  }

  private buildSegment(a: THREE.Vector3, b: THREE.Vector3, len: number) {
    const seg = new THREE.Group();
    seg.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    seg.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    const L = len + 0.9;
    // Moving rubber belt: a striped texture that scrolls
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3a3f45';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#4d545c';
    g.fillRect(0, 0, 64, 18);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, L * 2);
    this.beltTex.push(tex);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, L), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    belt.position.y = 0.55;
    belt.receiveShadow = true;
    seg.add(belt);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xffc928, roughness: 0.5 });
    for (const s of [-1, 1]) seg.add(box(0.12, 0.25, L, frameMat, s * 0.5, 0.58, 0));
    const legMat = new THREE.MeshStandardMaterial({ color: 0x555b62 });
    for (let t = -L / 2 + 0.3; t <= L / 2; t += 1.6) for (const s of [-1, 1]) seg.add(box(0.1, 0.5, 0.1, legMat, s * 0.42, 0.25, t));
    this.group.add(seg);
    const minX = Math.min(a.x, b.x) - 0.5;
    const maxX = Math.max(a.x, b.x) + 0.5;
    const minZ = Math.min(a.z, b.z) - 0.5;
    const maxZ = Math.max(a.z, b.z) + 0.5;
    this.blockers.push({ minX, maxX, minZ, maxZ });
  }

  /** Position `d` units along the belt. */
  private pointAt(d: number, out: THREE.Vector3) {
    let rest = d;
    for (let i = 0; i < this.segLen.length; i++) {
      if (rest <= this.segLen[i] || i === this.segLen.length - 1) {
        return out.lerpVectors(this.path[i], this.path[i + 1], Math.min(1, rest / this.segLen[i]));
      }
      rest -= this.segLen[i];
    }
    return out.copy(this.path[this.path.length - 1]);
  }

  update(dt: number) {
    const { speed, spacing } = CONFIG.conveyor;
    for (const t of this.beltTex) t.offset.y -= dt * speed * 2;

    // Pull a snack off the oven table onto the start of the belt.
    this.pullT += dt;
    const lastD = this.riders.length ? this.riders[this.riders.length - 1].d : Infinity;
    const room = this.counter.shelf.count + this.riders.length + this.pending < this.counter.shelf.max;
    if (this.pullT > 0.25 && lastD > spacing && this.pending === 0 && room && this.bakery.output.canPop()) {
      this.pullT = 0;
      const it = this.bakery.output.pop()!;
      this.pending++;
      const start = this.path[0].clone().setY(this.path[0].y + 0.2);
      this.flyers.fly(it.mesh, () => start, () => {
        this.pending--;
        this.scene.add(it.mesh);
        this.riders.push({ it, d: 0 });
      }, 0.25, 0.6);
    }

    // Move riders; each stops behind the one ahead (or at the end if the shelf is full).
    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i];
      const limit = i === 0 ? this.total : this.riders[i - 1].d - spacing;
      r.d = Math.min(limit, r.d + speed * dt);
      this.pointAt(r.d, this.tmp);
      r.it.mesh.position.set(this.tmp.x, this.tmp.y + 0.2, this.tmp.z);
    }
    // Hop off at the end onto the counter shelf.
    const first = this.riders[0];
    if (first && first.d >= this.total - 1e-3 && !this.counter.shelf.full) {
      this.riders.shift();
      this.flyers.pushInto(first.it, this.counter.shelf, 0.3);
    }
  }
}
