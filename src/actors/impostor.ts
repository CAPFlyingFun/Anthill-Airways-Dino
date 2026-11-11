// ============================================================================
// impostor.ts — the Ant-Mimicking Spider. Real ant-mimicking spiders
// (Myrmarachne and friends) look like ants and wave their front legs like
// antennae to sneak past colonies. Ours does exactly that:
//
//   sneak  -> walks in from outside the fence to a resource pile
//   steal  -> grabs a few items onto its back
//   escape -> runs for the fence with the loot
//
// Walk into it before it gets away and it drops the loot and you get a
// reward. If it escapes, the stolen items are gone.
// ============================================================================
import * as THREE from 'three';
import { Flyers, Stack } from '../world/items';
import { ResourcePile } from '../world/stations';
import { CreatureModel, animateCreature, faceToward, makeAnt } from './models';
import { spawnCreature } from './creatures';
import { backLayout, backSpot } from './player';

export type ImpostorEvent = 'stealing' | 'caught' | 'escaped' | null;

export class Impostor {
  model: CreatureModel;
  stack: Stack;
  state: 'sneak' | 'steal' | 'escape' | 'caught' = 'sneak';
  done = false;
  private t = 0;
  private stealT = 0;
  private target = new THREE.Vector3();

  constructor(private scene: THREE.Scene, public pile: ResourcePile, private exit: THREE.Vector3) {
    this.model = spawnCreature('ant-mimic', 2.2) ?? makeAnt(0x7a3a1a);
    this.model.root.position.copy(exit);
    scene.add(this.model.root);
    const spot = backSpot(this.model);
    this.stack = new Stack(this.model.bob, backLayout(() => 0.5, spot.y0, spot.z0), 6);
  }

  get pos() {
    return this.model.root.position;
  }

  /** Walk toward `target` at `speed`; true when there. */
  private walk(dt: number, speed: number) {
    const p = this.pos;
    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) {
      animateCreature(this.model, dt, 0);
      return true;
    }
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    faceToward(this.model, dx, dz, dt, 10);
    animateCreature(this.model, dt, speed);
    return false;
  }

  update(dt: number, player: THREE.Vector3, flyers: Flyers): ImpostorEvent {
    this.t += dt;
    let event: ImpostorEvent = null;

    // Caught? (You have to actually walk into it.)
    const gap = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
    if (this.state !== 'caught' && gap < 1.8) {
      this.state = 'caught';
      // Drop the loot: it hops back onto the pile (or vanishes if the pile is full).
      while (this.stack.canPop()) {
        if (!flyers.transfer(this.stack, this.pile.stack)) this.stack.pop()?.mesh.removeFromParent();
      }
      return 'caught';
    }

    switch (this.state) {
      case 'sneak':
        this.target.set(this.pile.zone.x, 0, this.pile.zone.z);
        if (this.walk(dt, 3.0)) this.state = 'steal';
        break;
      case 'steal':
        animateCreature(this.model, dt, 0);
        this.stealT += dt;
        if (this.stealT > 0.45) {
          this.stealT = 0;
          if (!this.stack.full && flyers.transfer(this.pile.stack, this.stack)) {
            if (this.stack.count === 1) event = 'stealing';
          } else {
            this.state = 'escape';
          }
        }
        break;
      case 'escape':
        this.target.copy(this.exit);
        if (this.walk(dt, 5.2)) {
          this.done = true;
          this.model.root.removeFromParent();
          return this.stack.count > 0 ? 'escaped' : null;
        }
        break;
      case 'caught':
        // Scurry off, empty-handed, faster than you can follow.
        this.target.copy(this.exit);
        if (this.walk(dt, 8)) {
          this.done = true;
          this.model.root.removeFromParent();
        }
        break;
    }
    return event;
  }
}
