// ============================================================================
// progress.ts — XP, levels and stat points (like ARK: Survival Evolved).
//
// Every task gives XP. Each level-up gives 1 point. Points go into stats
// (carry weight, speed, work speed, haggling, luck), and the rest of the game
// reads the bonuses from the getters at the bottom.
// ============================================================================
import { CONFIG, QUEEN_STATS, QueenStatDef, STATS, StatDef } from '../data/config';
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

// ============================================================================
// The Queen's progress: she gains 1 XP per $10 she collects, levels up, and
// each level gives a point for her stats (Royal Stride, Grab Speed, Tribute).
// ============================================================================
export class QueenProgress {
  onChange: () => void = () => {};
  onLevelUp: (level: number) => void = () => {};

  constructor(public save: SaveData) {
    for (const s of QUEEN_STATS) save.queen.stats[s.id] ??= 0;
  }

  get q() {
    return this.save.queen;
  }

  xpToNext(level = this.q.level) {
    return Math.round(25 * Math.pow(level, 1.5));
  }

  /** Called with the cash she just collected. */
  addCash(amount: number) {
    this.q.xp += amount / 10;
    while (this.q.xp >= this.xpToNext()) {
      this.q.xp -= this.xpToNext();
      this.q.level++;
      this.q.points++;
      this.onLevelUp(this.q.level);
    }
    this.onChange();
  }

  spend(id: QueenStatDef['id']) {
    if (this.q.points <= 0) return false;
    this.q.points--;
    this.q.stats[id]++;
    this.onChange();
    return true;
  }

  stat(id: QueenStatDef['id']) {
    return this.q.stats[id] ?? 0;
  }

  get speedMult() {
    return 1 + this.stat('speed') * 0.12;
  }
  get grabMult() {
    return 1 + this.stat('grab') * 0.2;
  }
  get tributeMult() {
    return 1 + this.stat('tribute') * 0.05;
  }

  describe(id: QueenStatDef['id']) {
    const n = this.stat(id);
    if (id === 'speed') return `+${n * 12}% speed`;
    if (id === 'grab') return `+${n * 20}% grab`;
    return `+${n * 5}% cash`;
  }
}
