// ============================================================================
// worker.ts — hired worker fire ants. Each one is given a ROUTE: where to
// pick up from and where to drop off. Examples:
//
//   Worker Ant   (yellow hard hat): crumb piles  -> oven IN
//   Runner Ant   (red headband):    oven OUT     -> counter shelf
//   Leaf Ant     (green hard hat):  leaf patches -> leaf press IN
//   Hatchlings   (white cap):       born in the Hatchery, swap jobs each trip
//
// All of them run the same little "state machine":
//   toSource -> load (until full or empty) -> toDest -> unload -> repeat
// A fresh route is picked at the start of every trip, so a worker always
// heads for the fullest pile.
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { Flyers, Stack } from '../world/items';
import { Zone } from '../world/stations';
import { CreatureModel, animateCreature, faceToward, makeAnt } from './models';
import { spawnCreature } from './creatures';
import { backLayout, backSpot } from './player';

/** One trip: pick up from `src` (standing in `srcZone`), drop at `dst`. */
export interface Route {
  src: Stack;
  srcZone: Zone;
  dst: Stack;
  dstZone: Zone;
}

type State = 'toSource' | 'load' | 'toDest' | 'unload';

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
  private route: Route | null = null;
  private target = new THREE.Vector3();
  private timer = 0;
  private speed: number;
  private offset = new THREE.Vector3((Math.random() - 0.5) * 1.0, 0, (Math.random() - 0.5) * 1.0);

  /**
   * @param pickRoute called at the start of each trip; returns where to go.
   * @param hat       hat color, and `flat` for a headband-style cap.
   */
  /**
   * @param person  Act 2: a crew member (human model) instead of an ant; no hat,
   *                and they carry in front of them (`spot`).
   */
  constructor(
    scene: THREE.Scene, x: number, z: number, private pickRoute: () => Route, hat: { color: number; flat?: boolean }, length = 2.1,
    person?: { model: CreatureModel; spot: { y0: number; z0: number }; carry?: number; speed?: number },
  ) {
    this.model = person?.model ?? spawnCreature('worker', length) ?? makeAnt(0x5a3a22);
    if (!person) addHat(this.model, hat.color, hat.flat);
    this.model.root.position.set(x, 0, z);
    scene.add(this.model.root);
    const spot = person?.spot ?? backSpot(this.model);
    this.stack = new Stack(this.model.bob, backLayout(() => 0.6, spot.y0, spot.z0), person?.carry ?? CONFIG.worker.carry);
    this.speed = person?.speed ?? CONFIG.worker.speed;
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
    const step = Math.min(d, this.speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    faceToward(this.model, dx, dz, dt);
    animateCreature(this.model, dt, this.speed);
    return false;
  }

  update(dt: number, flyers: Flyers) {
    this.model.holding = this.stack.count > 0;
    if (!this.route) this.route = this.pickRoute();
    const r = this.route;
    switch (this.state) {
      case 'toSource':
        this.target.set(r.srcZone.x, 0, r.srcZone.z).add(this.offset);
        if (this.walk(dt)) this.state = 'load';
        break;
      case 'load': {
        animateCreature(this.model, dt, 0);
        // Catch up on every item due this frame (a slow frame mustn't slow the
        // work), but don't bank up a burst while waiting.
        this.timer = Math.min(this.timer + dt, CONFIG.worker.pickupInterval * 4);
        while (this.timer >= CONFIG.worker.pickupInterval && this.state === 'load') {
          this.timer -= CONFIG.worker.pickupInterval;
          if (!this.stack.full && r.src.canPop()) flyers.transfer(r.src, this.stack);
          else if (this.stack.full || (r.src.count === 0 && this.stack.count > 0)) this.state = 'toDest';
          else break; // waiting for the source to refill
        }
        break;
      }
      case 'toDest':
        this.target.set(r.dstZone.x, 0, r.dstZone.z).add(this.offset);
        if (this.walk(dt)) this.state = 'unload';
        break;
      case 'unload':
        animateCreature(this.model, dt, 0);
        this.timer = Math.min(this.timer + dt, CONFIG.worker.pickupInterval * 4);
        while (this.timer >= CONFIG.worker.pickupInterval && this.state === 'unload') {
          this.timer -= CONFIG.worker.pickupInterval;
          if (this.stack.count === 0) {
            this.route = null; // pick a fresh route next trip
            this.state = 'toSource';
          } else if (!r.dst.full) {
            flyers.transfer(this.stack, r.dst);
          } else break; // destination full: wait
        }
        break;
    }
  }
}

// ============================================================================
// Banker Ant (gold cap): stands beside a zone's cash pad and sweeps every bill
// straight into your wallet, so the zone keeps paying you while you're away.
// ============================================================================
export class Banker {
  model: CreatureModel;
  private t = 0;

  constructor(scene: THREE.Scene, private pad: { stack: Stack; zone: Zone }, private onCash: (amount: number) => void) {
    this.model = spawnCreature('worker', 2.0) ?? makeAnt(0x5a3a22);
    addHat(this.model, 0xffd166, true);
    // Stand just behind the pad, facing it.
    this.model.root.position.set(pad.zone.x + pad.zone.halfW + 0.9, 0, pad.zone.z);
    this.model.root.rotation.y = -Math.PI / 2;
    scene.add(this.model.root);
  }

  update(dt: number, flyers: Flyers) {
    animateCreature(this.model, dt, 0);
    this.t += dt;
    if (this.t < 0.12) return;
    this.t = 0;
    const bill = this.pad.stack.pop();
    if (!bill) return;
    const target = new THREE.Vector3();
    this.model.root.getWorldPosition(target).setY(this.model.height + 0.4);
    flyers.fly(
      bill.mesh,
      () => target,
      () => {
        bill.mesh.removeFromParent();
        this.onCash(bill.value);
      },
      0.25,
      0.7,
    );
  }
}
