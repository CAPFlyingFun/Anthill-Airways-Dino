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
import { pace } from '../core/pace';
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

/**
 * Helper levels (worker XP): every item a helper delivers is 1 XP.
 * Each level makes that helper 4% faster (walking and loading). Max level 20.
 */
export const CREW_LEVEL = { max: 20, per: 0.04, xp: (lv: number) => Math.round(20 * Math.pow(lv, 1.6)) };
/** Total XP needed to REACH `level` (level 1 = 0). */
export function crewXpFor(level: number) {
  let t = 0;
  for (let l = 1; l < level; l++) t += CREW_LEVEL.xp(l);
  return t;
}

export class Worker {
  model: CreatureModel;
  stack: Stack;
  /** ⬆️ CREW upgrade (+ Leadership stat): x walk speed and loading speed. */
  boost = 1;
  /** How many items this helper carries before upgrades. */
  baseCarry: number;
  /** Worker XP: 1 per item delivered. */
  xp = 0;
  level = 1;
  /** Called with each level gained (the world shows a little "LEVEL UP"). */
  onLevel: (level: number) => void = () => {};
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
    this.baseCarry = person?.carry ?? CONFIG.worker.carry;
    this.stack = new Stack(this.model.bob, backLayout(() => 0.6, spot.y0, spot.z0), this.baseCarry);
    this.speed = person?.speed ?? CONFIG.worker.speed;
  }

  /** Load saved XP (no level-up fanfare) and refresh the title tag. */
  setXp(xp: number) {
    this.xp = xp;
    this.level = 1;
    while (this.level < CREW_LEVEL.max && this.xp >= crewXpFor(this.level + 1)) this.level++;
    this.showLevel();
  }

  /** +1 XP per delivered item; levels up every CREW_LEVEL.xp. */
  private gainXp(n: number) {
    this.xp += n;
    let up = false;
    while (this.level < CREW_LEVEL.max && this.xp >= crewXpFor(this.level + 1)) {
      this.level++;
      up = true;
    }
    if (up) {
      this.showLevel();
      this.onLevel(this.level);
    }
  }

  /** "🐜 WORKER" -> "🐜 WORKER · Lv 3" over the helper's head. */
  private showLevel() {
    const t = this.model.root.userData.title as { tag: { setText(s: string): void }; text: string } | undefined;
    if (t) t.tag.setText(this.level > 1 ? `${t.text} · Lv ${this.level}` : t.text);
  }

  /** Speed multiplier from upgrades + this helper's own level. */
  get mult() {
    return this.boost * (1 + (this.level - 1) * CREW_LEVEL.per);
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
    const speed = this.speed * this.mult * pace.move; // (upgrades x level x the Movement speed slider)
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    faceToward(this.model, dx, dz, dt);
    animateCreature(this.model, dt, speed);
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
        const iv = CONFIG.worker.pickupInterval / this.mult;
        this.timer = Math.min(this.timer + dt, iv * 4);
        while (this.timer >= iv && this.state === 'load') {
          this.timer -= iv;
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
        const iv = CONFIG.worker.pickupInterval / this.mult;
        this.timer = Math.min(this.timer + dt, iv * 4);
        while (this.timer >= iv && this.state === 'unload') {
          this.timer -= iv;
          if (this.stack.count === 0) {
            this.route = null; // pick a fresh route next trip
            this.state = 'toSource';
          } else if (!r.dst.full) {
            if (flyers.transfer(this.stack, r.dst)) this.gainXp(1); // worker XP: 1 per item delivered
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
  /** ⬆️ COLLECTORS upgrade: grabs bills this many times faster. */
  boost = 1;
  /** 👑 The Queen's Grab Speed points: also faster. */
  royal = 1;
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
    if (this.t < 0.12 / this.boost / this.royal) return;
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
