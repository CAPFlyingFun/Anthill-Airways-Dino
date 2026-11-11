// ============================================================================
// worker.ts — a hired worker ant (yellow hard hat) that carries crumbs from
// the crumb piles to the oven, forever. A tiny "state machine":
//
//   toPile  -> walk to the fullest crumb pile
//   load    -> pick up crumbs until full (or the pile runs out)
//   toOven  -> walk to the oven's IN pad
//   unload  -> drop everything, then start over
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { Flyers, Stack } from '../world/items';
import { Bakery, ResourcePile } from '../world/stations';
import { CreatureModel, animateCreature, faceToward, makeAnt } from './models';
import { backLayout } from './player';

type State = 'toPile' | 'load' | 'toOven' | 'unload';

export class Worker {
  model: CreatureModel;
  stack: Stack;
  private state: State = 'toPile';
  private pile: ResourcePile | null = null;
  private target = new THREE.Vector3();
  private timer = 0;
  private offset = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.model = makeAnt(0x5a3a22);
    const hat = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffc928, roughness: 0.4 }),
    );
    hat.position.set(0, 0.26, 0.5);
    hat.castShadow = true;
    this.model.bob.add(hat);
    this.model.root.position.set(x, 0, z);
    scene.add(this.model.root);
    this.stack = new Stack(this.model.bob, backLayout(() => 0.6), CONFIG.worker.carry);
  }

  /** Walk toward `target`; returns true when there. */
  private walk(dt: number) {
    const p = this.model.root.position;
    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) {
      animateCreature(this.model, dt, 0);
      return true;
    }
    const step = Math.min(d, CONFIG.worker.speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    faceToward(this.model, dx, dz, dt);
    animateCreature(this.model, dt, CONFIG.worker.speed);
    return false;
  }

  update(dt: number, piles: ResourcePile[], bakery: Bakery, flyers: Flyers) {
    switch (this.state) {
      case 'toPile': {
        if (!this.pile) {
          // Pick the pile with the most crumbs on it.
          this.pile = piles.reduce((best, p) => (p.stack.count > best.stack.count ? p : best), piles[0]);
        }
        this.target.set(this.pile.zone.x, 0, this.pile.zone.z).add(this.offset);
        if (this.walk(dt)) this.state = 'load';
        break;
      }
      case 'load': {
        animateCreature(this.model, dt, 0);
        this.timer += dt;
        if (this.timer < CONFIG.worker.pickupInterval) break;
        this.timer = 0;
        const pile = this.pile!;
        if (!this.stack.full && pile.stack.canPop()) {
          flyers.transfer(pile.stack, this.stack);
        } else if (this.stack.full || (pile.stack.count === 0 && this.stack.count > 0)) {
          this.state = 'toOven';
        }
        break;
      }
      case 'toOven': {
        this.target.set(bakery.inZone.x, 0, bakery.inZone.z).add(this.offset);
        if (this.walk(dt)) this.state = 'unload';
        break;
      }
      case 'unload': {
        animateCreature(this.model, dt, 0);
        this.timer += dt;
        if (this.timer < CONFIG.worker.pickupInterval) break;
        this.timer = 0;
        if (this.stack.count === 0) {
          this.pile = null;
          this.state = 'toPile';
        } else if (!bakery.input.full) {
          flyers.transfer(this.stack, bakery.input);
        }
        break;
      }
    }
  }
}
