// ============================================================================
// progress.ts — XP, levels and stat points (like ARK: Survival Evolved).
//
// Every task gives XP. Each level-up gives 1 point. Points go into stats
// (carry weight, speed, work speed, haggling, luck), and the rest of the game
// reads the bonuses from the getters at the bottom.
// ============================================================================
import { CONFIG, STATS, StatDef } from '../data/config';
import { SaveData } from './save';

export class Progress {
  /** Called whenever XP, level or points change (to refresh the HUD). */
  onChange: () => void = () => {};
  /** Called once per level gained. */
  onLevelUp: (level: number) => void = () => {};

  constructor(public save: SaveData) {
    for (const s of STATS) save.stats[s.id] ??= 0;
  }

  /** XP needed to go from `level` to `level + 1`. */
  xpToNext(level = this.save.level) {
    return Math.round(CONFIG.xp.curveBase * Math.pow(level, CONFIG.xp.curveExp));
  }

  addXp(amount: number) {
    if (amount <= 0) return;
    this.save.xp += amount;
    while (this.save.xp >= this.xpToNext()) {
      this.save.xp -= this.xpToNext();
      this.save.level++;
      this.save.points++;
      this.onLevelUp(this.save.level);
    }
    this.onChange();
  }

  /** Spend one point on a stat. Returns false if there are no points. */
  spend(id: StatDef['id']) {
    if (this.save.points <= 0) return false;
    this.save.points--;
    this.save.stats[id]++;
    this.onChange();
    return true;
  }

  stat(id: StatDef['id']) {
    return this.save.stats[id] ?? 0;
  }

  // ---- Bonuses the game uses ---------------------------------------------
  get carryBonus() {
    return this.stat('carry') * 2;
  }
  get speedMult() {
    return 1 + this.stat('speed') * 0.05;
  }
  get workMult() {
    return 1 + this.stat('work') * 0.08;
  }
  get cashMult() {
    return 1 + this.stat('haggle') * 0.05;
  }
  get luck() {
    return this.stat('luck');
  }

  /** One-line description of a stat's current total bonus. */
  describe(id: StatDef['id']) {
    const n = this.stat(id);
    switch (id) {
      case 'carry': return `+${n * 2} carry`;
      case 'speed': return `+${n * 5}% speed`;
      case 'work': return `+${n * 8}% work speed`;
      case 'haggle': return `+${n * 5}% cash`;
      case 'luck': return n ? `-${Math.min(70, n * 6)}% puddle loss, ${Math.round(Math.min(80, 50 + n * 4))}% ? win` : 'No bonus yet';
    }
  }
}
