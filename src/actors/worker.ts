// ============================================================================
// worker.ts — hired worker fire ants. Each one has a job:
//
//   'crumbs' (yellow hard hat): crumb piles  -> oven IN
//   'snacks' (red headband, the Runner Ant): oven OUT -> SELL counter shelf
//
// Both run the same little "state machine":
//   toSource -> load (until full or empty) -> toDest -> unload -> repeat
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { Flyers, Stack } from '../world/items';
import { Bakery, Counter, ResourcePile, Zone } from '../world/stations';
import { CreatureModel, animateCreature, faceToward, makeAnt } from './models';
import { spawnCreature } from './creatures';
import { backLayout, backSpot } from './player';

export type Job = 'crumbs' | 'snacks';
type State = 'toSource' | 'load' | 'toDest' | 'unload';

export interface WorkCtx {
  piles: ResourcePile[];
  bakery: Bakery;
  counter: Counter;
  flyers: Flyers;
}

/** A little hat on top of a bug's head. */
export function addHat(m: CreatureModel, color: number, flat = false) {
  const r = m.length * 0.13;
  const hat = new THREE.Mesh(
    flat ? new THREE.CylinderGeometry(r, r, r * 0.35, 16) : new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4 }),
  );
  hat.position.set(0, m.height * 0.82, m.length * 0.33);
  hat.castShadow = true;
  m.bob.add(hat);
}

export class Worker {
  model: CreatureModel;
  stack: Stack;
  private state: State = 'toSource';
  private pile: ResourcePile | null = null;
  private target = new THREE.Vector3();
  private timer = 0;
  private offset = new THREE.Vector3((Math.random() - 0.5) * 1.0, 0, (Math.random() - 0.5) * 1.0);

  constructor(scene: THREE.Scene, x: number, z: number, public job: Job) {
    this.model = spawnCreature('worker', 2.1) ?? makeAnt(0x5a3a22);
    addHat(this.model, job === 'crumbs' ? 0xffc928 : 0xe63946, job === 'snacks');
    this.model.root.position.set(x, 0, z);
    scene.add(this.model.root);
    const spot = backSpot(this.model);
    this.stack = new Stack(this.model.bob, backLayout(() => 0.6, spot.y0, spot.z0), CONFIG.worker.carry);
  }

  /** Where this worker picks up from and drops off to. */
  private route(ctx: WorkCtx): { src: Stack; srcZone: Zone; dst: Stack; dstZone: Zone } {
    if (this.job === 'snacks') {
      return { src: ctx.bakery.output, srcZone: ctx.bakery.outZone, dst: ctx.counter.shelf, dstZone: ctx.counter.sellZone };
    }
    if (!this.pile) this.pile = ctx.piles.reduce((best, p) => (p.stack.count > best.stack.count ? p : best), ctx.piles[0]);
    return { src: this.pile.stack, srcZone: this.pile.zone, dst: ctx.bakery.input, dstZone: ctx.bakery.inZone };
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

  update(dt: number, ctx: WorkCtx) {
    const r = this.route(ctx);
    switch (this.state) {
      case 'toSource':
        this.target.set(r.srcZone.x, 0, r.srcZone.z).add(this.offset);
        if (this.walk(dt)) this.state = 'load';
        break;
      case 'load': {
        animateCreature(this.model, dt, 0);
        this.timer += dt;
        if (this.timer < CONFIG.worker.pickupInterval) break;
        this.timer = 0;
        if (!this.stack.full && r.src.canPop()) ctx.flyers.transfer(r.src, this.stack);
        else if (this.stack.full || (r.src.count === 0 && this.stack.count > 0)) this.state = 'toDest';
        break;
      }
      case 'toDest':
        this.target.set(r.dstZone.x, 0, r.dstZone.z).add(this.offset);
        if (this.walk(dt)) this.state = 'unload';
        break;
      case 'unload':
        animateCreature(this.model, dt, 0);
        this.timer += dt;
        if (this.timer < CONFIG.worker.pickupInterval) break;
        this.timer = 0;
        if (this.stack.count === 0) {
          this.pile = null;
          this.state = 'toSource';
        } else if (!r.dst.full) {
          ctx.flyers.transfer(this.stack, r.dst);
        }
        break;
    }
  }
}
