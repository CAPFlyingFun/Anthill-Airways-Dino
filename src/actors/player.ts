// ============================================================================
// player.ts — the forager ant you control (blue pilot cap!).
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { ITEM_H, Layout, Stack } from '../world/items';
import { TextSprite } from '../world/labels';
import { Blocker } from '../world/stations';
import { CreatureModel, animateCreature, faceToward, makeAnt } from './models';

/** Items stacked on an ant's back. `lean` makes tall stacks sway when walking. */
export function backLayout(getLean: () => number): Layout {
  return (i, type, out) => {
    const h = ITEM_H[type];
    const lean = getLean();
    return out.set(0, 0.42 + i * h + h / 2, -0.4 - lean * i * i * 0.006);
  };
}

export class Player {
  model: CreatureModel;
  stack: Stack;
  carryMax = CONFIG.player.baseCarry;
  private lean = 0;
  private maxLabel = new TextSprite(0.6, '#ff6b6b');

  constructor(scene: THREE.Scene) {
    this.model = makeAnt(0x8e2f14, true);
    scene.add(this.model.root);
    this.stack = new Stack(this.model.bob, backLayout(() => this.lean), this.carryMax);
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

  update(dt: number, move: THREE.Vector2, blockers: Blocker[], bounds: Blocker) {
    this.stack.max = this.carryMax;
    const speed = CONFIG.player.speed;
    // Camera looks toward -z, so pushing the stick "up" walks toward -z.
    const vx = move.x * speed;
    const vz = -move.y * speed;
    const p = this.pos;
    p.x += vx * dt;
    p.z += vz * dt;

    // Push out of anything solid (simple box collision, player radius 0.45).
    const r = 0.45;
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
    p.x = THREE.MathUtils.clamp(p.x, bounds.minX, bounds.maxX);
    p.z = THREE.MathUtils.clamp(p.z, bounds.minZ, bounds.maxZ);

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
      const top = 1.2 + this.stack.count * 0.31;
      this.maxLabel.sprite.position.set(p.x, top + 0.4, p.z);
    }
  }
}
