// ============================================================================
// player.ts — you! A fire ant Major (the big-headed one) in a blue pilot cap.
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { ITEM_H, Layout, Stack } from '../world/items';
import { TextSprite } from '../world/labels';
import { Blocker } from '../world/stations';
import { CreatureModel, animateCreature, faceToward, makeAnt } from './models';
import { spawnCreature } from './creatures';

/**
 * Items stacked on a bug's back, starting at height `y0` and `z0` along its
 * body. `lean` makes tall stacks sway backward while walking.
 */
export function backLayout(getLean: () => number, y0: number, z0: number): Layout {
  return (i, type, out) => {
    const h = ITEM_H[type];
    const lean = getLean();
    return out.set(0, y0 + i * h + h / 2, z0 - lean * i * i * 0.006);
  };
}

/** Where to stack items on a model: on top of the body, a bit behind center. */
export function backSpot(m: CreatureModel) {
  return { y0: m.height * 0.9, z0: -m.length * 0.12 };
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
  private lean = 0;
  private maxLabel = new TextSprite(0.6, '#ff6b6b');

  constructor(scene: THREE.Scene) {
    const major = spawnCreature('major', 2.6);
    if (major) {
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
    const spot = backSpot(this.model);
    this.stack = new Stack(this.model.bob, backLayout(() => this.lean, spot.y0, spot.z0), this.carryMax);
    this.maxLabel.setText('MAX');
    this.maxLabel.sprite.visible = false;
    scene.add(this.maxLabel.sprite);
  }

  get pos() {
    return this.model.root.position;
  }

  /** Can the ant pick up one more item of this type? (One type at a time.) */
  canTake(type: string) {
    return !this.stack.full && (this.stack.count === 0 || this.stack.topType === type);
  }

  /** `canWalk(x, z)` says whether a spot is inside an open zone. */
  update(dt: number, move: THREE.Vector2, blockers: Blocker[], canWalk: (x: number, z: number) => boolean) {
    this.stack.max = this.carryMax;
    const speed = CONFIG.player.speed * this.speedMult;
    // Camera looks toward -z, so pushing the stick "up" walks toward -z.
    const vx = move.x * speed;
    const vz = -move.y * speed;
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
    faceToward(this.model, vx, vz, dt);
    animateCreature(this.model, dt, moving);
    // Stack sways back a little when walking, settles when you stop.
    this.lean += ((moving > 0.1 ? 1 : 0) - this.lean) * Math.min(1, dt * 6);

    // Re-place landed items each frame so the sway shows.
    this.stack.items.forEach((it, i) => {
      if (!it.flying) this.stack.layout(i, it.type, it.mesh.position);
    });

    const full = this.stack.full;
    this.maxLabel.sprite.visible = full;
    if (full) {
      const top = this.model.height + 0.6 + this.stack.count * 0.31;
      this.maxLabel.sprite.position.set(p.x, top, p.z);
    }
  }
}
