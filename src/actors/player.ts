// ============================================================================
// player.ts — you! A fire ant Major (the big-headed one) in a blue pilot cap.
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { ITEM_H, ItemType, Layout, Stack } from '../world/items';
import { TextSprite } from '../world/labels';
import { Blocker } from '../world/stations';
import { CreatureModel, animateCreature, faceToward, makeAnt } from './models';
import { spawnCreature } from './creatures';

/**
 * Items stacked on a bug's back, starting at height `y0` and `z0` along its
 * body. `lean` makes tall stacks sway backward while walking.
 * Pass `items` when the stack can hold MIXED item types: each item then sits
 * on top of the real heights of the ones below it (leaves are thin, sugar
 * cubes are tall).
 */
export function backLayout(getLean: () => number, y0: number, z0: number, items?: () => { type: ItemType }[]): Layout {
  return (i, type, out) => {
    const lean = getLean();
    let y = y0;
    const list = items?.();
    if (list) for (let k = 0; k < i && k < list.length; k++) y += ITEM_H[list[k].type];
    else y += i * ITEM_H[type];
    return out.set(0, y + ITEM_H[type] / 2, z0 - lean * i * i * 0.006);
  };
}

/** Where to stack items on a model: on top of the body, a bit behind center. */
export function backSpot(m: CreatureModel) {
  return { y0: m.height * 0.9, z0: -m.length * 0.12 };
}

/** People carry things out in front, held in both hands (Township style). */
export function handsSpot(m: CreatureModel) {
  return { y0: m.height * 0.56, z0: m.height * 0.2 };
}

/** The blue pilot cap + goggles, sized for a head about `size` wide. */
export function makePilotCap(size: number) {
  const g = new THREE.Group();
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.5 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  dome.scale.set(1, 0.75, 1);
  dome.castShadow = true;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 18, 1, false, -Math.PI / 2, Math.PI), capMat);
  brim.position.set(0, 0.02, 0.18);
  const gogMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.4 });
  g.add(dome, brim);
  for (const s of [-1, 1]) {
    const gog = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 14), gogMat);
    gog.position.set(s * 0.17, 0.3, 0.36);
    gog.rotation.x = -0.6;
    g.add(gog);
  }
  g.scale.setScalar(size);
  return g;
}

export class Player {
  model: CreatureModel;
  stack: Stack;
  carryMax = CONFIG.player.baseCarry;
  speedMult = 1;
  /** First-person mode: the joystick turns + walks you, and your body is hidden. */
  firstPerson = false;
  private person: boolean;   // Act 2 (Jack) vs the ant Major
  private eyeH: number;      // eye height above the floor
  private eyeFwd: number;    // eyes sit this far in front of the body's center
  private pitch: number;     // how far the first-person view looks down (radians)
  private lean = 0;
  private maxLabel = new TextSprite(0.6, '#ff6b6b');

  /**
   * Default: the fire ant Major in a pilot cap, carrying on its back.
   * Act 2 passes a person (`model`) who carries in front (`spot`).
   */
  constructor(scene: THREE.Scene, opts?: { model: CreatureModel; spot: { y0: number; z0: number } }) {
    const major = opts ? null : spawnCreature('major', 2.6);
    if (opts) {
      this.model = opts.model;
    } else if (major) {
      this.model = major;
      // Cap sits on the Major's big head (front ~third of the body).
      const cap = makePilotCap(major.length * 0.3);
      cap.position.set(0, major.height * 0.95, major.length * 0.3);
      cap.rotation.x = -0.15;
      major.bob.add(cap);
    } else {
      this.model = makeAnt(0x8e2f14, true);
    }
    scene.add(this.model.root);
    const spot = opts?.spot ?? backSpot(this.model);
    // Back stacks sway backward; front stacks (people) lean in toward the chest.
    const sway = opts ? () => -this.lean * 0.5 : () => this.lean;
    const layout = backLayout(sway, spot.y0, spot.z0, () => this.stack.items);
    this.person = !!opts;
    // First person (people): the stack would sit right in front of your eyes,
    // so it's held lower and only the bottom couple of items are shown.
    const fpDrop = spot.y0 - this.model.height * 0.28;
    const fpOut = this.model.height * 0.2; // ...and a bit further out, so it's in view
    this.stack = new Stack(
      this.model.bob,
      (i, type, out) => {
        layout(i, type, out);
        if (this.firstPerson && this.person) {
          out.y -= fpDrop;
          out.z += fpOut;
        }
        return out;
      },
      this.carryMax,
    );
    // Eyes: a person's are near the top of the head; the ant Major's are on
    // the front of its big head.
    const m = this.model;
    this.eyeH = opts ? m.height * 0.93 : m.height * 0.95;
    this.eyeFwd = opts ? m.height * 0.07 : m.length * 0.45;
    this.pitch = opts ? 0.56 : 0.32;
    this.maxLabel.setText('MAX');
    this.maxLabel.sprite.visible = false;
    scene.add(this.maxLabel.sprite);
  }

  /** Hide/show your own body (the carried stack stays visible). */
  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    const carried = new Set(this.stack.items.map((it) => it.mesh));
    for (const c of this.model.bob.children) if (!carried.has(c as THREE.Mesh)) c.visible = !on;
  }

  /** Put the camera at your eyes, looking where you face (a little down, to see pads). */
  placeEyeCamera(cam: THREE.PerspectiveCamera) {
    const r = this.model.root.rotation.y;
    const p = this.pos;
    const dx = Math.sin(r);
    const dz = Math.cos(r);
    cam.position.set(p.x + dx * this.eyeFwd, this.eyeH, p.z + dz * this.eyeFwd);
    cam.lookAt(cam.position.x + dx * 10, this.eyeH - Math.tan(this.pitch) * 10, cam.position.z + dz * 10);
  }

  /** Height of the top of the carried stack. */
  private stackTop() {
    const items = this.stack.items;
    const tmp = new THREE.Vector3();
    if (!items.length) return 0;
    this.stack.layout(items.length - 1, items[items.length - 1].type, tmp);
    return tmp.y + 0.3;
  }

  get pos() {
    return this.model.root.position;
  }

  /** Can the ant pick up one more item? (Any mix of types, up to the carry limit.) */
  canTake(_type?: string) {
    return !this.stack.full;
  }

  /** `canWalk(x, z)` says whether a spot is inside an open zone. */
  update(dt: number, move: THREE.Vector2, blockers: Blocker[], canWalk: (x: number, z: number) => boolean) {
    this.stack.max = this.carryMax;
    const speed = CONFIG.player.speed * this.speedMult;
    let vx: number;
    let vz: number;
    if (this.firstPerson) {
      // Through your eyes: left/right turns you, up/down walks forward/back.
      const r = (this.model.root.rotation.y -= move.x * 2.4 * dt);
      const fwd = move.y * speed;
      vx = Math.sin(r) * fwd;
      vz = Math.cos(r) * fwd;
    } else {
      // Camera looks toward -z, so pushing the stick "up" walks toward -z.
      vx = move.x * speed;
      vz = -move.y * speed;
    }
    const p = this.pos;
    // Move one axis at a time so you slide along fences instead of sticking.
    if (canWalk(p.x + vx * dt, p.z)) p.x += vx * dt;
    if (canWalk(p.x, p.z + vz * dt)) p.z += vz * dt;

    // Push out of anything solid (simple box collision, player radius 0.5).
    const r = 0.5;
    for (const b of blockers) {
      if (p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r) {
        const pushL = p.x - (b.minX - r);
        const pushR = b.maxX + r - p.x;
        const pushU = p.z - (b.minZ - r);
        const pushD = b.maxZ + r - p.z;
        const m = Math.min(pushL, pushR, pushU, pushD);
        if (m === pushL) p.x = b.minX - r;
        else if (m === pushR) p.x = b.maxX + r;
        else if (m === pushU) p.z = b.minZ - r;
        else p.z = b.maxZ + r;
      }
    }

    const moving = Math.hypot(vx, vz);
    this.model.holding = this.stack.count > 0; // people: arms out front to hold the stack
    // Third person: turn to face where you walk. (First person: the stick
    // already turned you, and walking backward keeps you facing forward.)
    if (!this.firstPerson) faceToward(this.model, vx, vz, dt);
    animateCreature(this.model, dt, moving);
    // Stack sways back a little when walking, settles when you stop.
    this.lean += ((moving > 0.1 ? 1 : 0) - this.lean) * Math.min(1, dt * 6);

    // Re-place landed items each frame so the sway shows.
    const fpHide = this.firstPerson && this.person;
    this.stack.items.forEach((it, i) => {
      if (!it.flying) this.stack.layout(i, it.type, it.mesh.position);
      it.mesh.visible = !(fpHide && i >= 1); // first person: just the top of the bottom item peeks in
    });

    const full = this.stack.full;
    this.maxLabel.sprite.visible = full && !this.firstPerson;
    if (full) {
      const top = Math.max(this.model.height + 0.6, this.stackTop() + 0.7);
      this.maxLabel.sprite.position.set(p.x, top, p.z);
    }
  }
}
