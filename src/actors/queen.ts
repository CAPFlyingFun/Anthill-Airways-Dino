// ============================================================================
// queen.ts — the Queen collects your money (unlocks at player level 20).
//
// She leaves her corner and patrols the colony:
//   pick    -> choose the cash pad with the most bills on it
//   walk    -> stroll there (through the nest's middle when changing zones)
//   collect -> scoop bills up one by one; each one goes straight to your wallet
//   rest    -> nothing to collect? wander back to her corner and wait
//
// Her stats (QueenProgress) make her faster, grab quicker and add a bonus on
// every bill. She keeps working whatever you're doing, which is what makes
// the colony an idle game while you're busy elsewhere.
// ============================================================================
import { pace } from '../core/pace';
import * as THREE from 'three';
import { ZONES } from '../data/config';
import { QueenProgress } from '../core/progress';
import { Flyers } from '../world/items';
import { TextSprite } from '../world/labels';
import { CashPad } from '../world/stations';
import { CreatureModel, animateCreature, faceToward } from './models';

const HUB = new THREE.Vector3(-2, 0, 2); // the middle of the nest: her crossroads between zones

export class QueenCollector {
  /** ⬆️ COLLECTORS upgrade: grabs bills this many times faster. */
  boost = 1;
  private state: 'pick' | 'walk' | 'collect' | 'rest' = 'pick';
  private pad: CashPad | null = null;
  private path: THREE.Vector3[] = [];
  private grabT = 0;
  private restT = 0;

  constructor(
    private model: CreatureModel,
    private crown: TextSprite,
    private home: THREE.Vector3,
    private qp: QueenProgress,
    private onCash: (amount: number) => void,
  ) {}

  private zoneOf(p: THREE.Vector3) {
    return ZONES.find((z) => p.x >= z.rect.minX && p.x <= z.rect.maxX && p.z >= z.rect.minZ && p.z <= z.rect.maxZ)?.id;
  }

  /** Go to `to`, passing through the nest's middle if it's in another zone. */
  private routeTo(to: THREE.Vector3) {
    const from = this.model.root.position;
    this.path = this.zoneOf(from) !== this.zoneOf(to) ? [HUB.clone(), to.clone()] : [to.clone()];
    this.state = 'walk';
  }

  update(dt: number, pads: CashPad[], flyers: Flyers) {
    const m = this.model;
    const p = m.root.position;
    const speed = 2.4 * this.qp.speedMult * pace.move; // (Movement speed slider)

    switch (this.state) {
      case 'pick': {
        // The pad with the most bills wins.
        const best = pads.reduce<CashPad | null>((b, pad) => (pad.stack.count > (b?.stack.count ?? 0) ? pad : b), null);
        if (best) {
          this.pad = best;
          this.routeTo(new THREE.Vector3(best.zone.x, 0, best.zone.z));
        } else {
          this.pad = null;
          this.routeTo(this.home);
          this.restT = 3;
        }
        break;
      }
      case 'walk': {
        const target = this.path[0];
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.2) {
          this.path.shift();
          if (!this.path.length) this.state = this.pad ? 'collect' : 'rest';
          animateCreature(m, dt, 0);
          break;
        }
        const step = Math.min(d, speed * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        faceToward(m, dx, dz, dt, 5);
        animateCreature(m, dt, speed);
        break;
      }
      case 'collect': {
        animateCreature(m, dt, 0);
        const pad = this.pad!;
        this.grabT += dt;
        if (this.grabT < 0.12 / this.qp.grabMult / this.boost) break;
        this.grabT = 0;
        const bill = pad.stack.pop();
        if (!bill) {
          this.state = 'pick';
          break;
        }
        const target = new THREE.Vector3();
        flyers.fly(
          bill.mesh,
          () => target.copy(p).setY(m.height + 0.5),
          () => {
            bill.mesh.removeFromParent();
            const amount = bill.value * this.qp.tributeMult;
            this.onCash(amount);
            this.qp.addCash(amount);
          },
          0.3,
          1.0,
        );
        break;
      }
      case 'rest':
        animateCreature(m, dt, 0);
        this.restT -= dt;
        if (this.restT <= 0) this.state = 'pick';
        break;
    }
    // Her crown label follows her around.
    this.crown.sprite.position.set(p.x, m.height + 1.2, p.z);
  }
}
