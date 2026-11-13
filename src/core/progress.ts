// ============================================================================
// progress.ts — XP, levels and stat points (like ARK: Survival Evolved).
//
// Every task gives XP. Each level-up gives 1 point. Points go into stats
// (carry weight, speed, work speed, haggling, luck), and the rest of the game
// reads the bonuses from the getters at the bottom.
// ============================================================================
import { CONFIG, QUEEN_STATS, QueenStatDef, SHARD_UPS, STAT_MAX, STATS, ShardUpDef, StatDef, shardCost } from '../data/config';
import { SaveData } from './save';

export class Progress {
  /** Called whenever XP, level or points change (to refresh the HUD). */
  onChange: () => void = () => {};
  /** Called once per level gained. */
  onLevelUp: (level: number) => void = () => {};

  constructor(public save: SaveData) {
    for (const s of STATS) {
      save.stats[s.id] ??= 0;
      // Points put in before the cap existed: anything over the max goes back to spend again
      if (save.stats[s.id] > STAT_MAX) {
        save.points += save.stats[s.id] - STAT_MAX;
        save.stats[s.id] = STAT_MAX;
      }
    }
  }

  /** Is this stat at its max? */
  maxed(id: StatDef['id']) {
    return this.stat(id) >= STAT_MAX;
  }
  /** Every stat is maxed (leftover points have nowhere to go). */
  get allMaxed() {
    return STATS.every((d) => this.maxed(d.id));
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
    if (this.save.points <= 0 || this.maxed(id)) return false;
    this.save.points--;
    this.save.stats[id]++;
    this.onChange();
    return true;
  }

  stat(id: StatDef['id']) {
    return this.save.stats[id] ?? 0;
  }

  // ---- 💎 Obsidian Shard upgrades (prestige: permanent) ---------------------
  /** Levels bought in a shard upgrade. */
  up(id: ShardUpDef['id']) {
    return this.save.shardUps[id] ?? 0;
  }
  /** Buy the next level of a shard upgrade. Returns false if you can't. */
  buyUp(id: ShardUpDef['id']) {
    const def = SHARD_UPS.find((d) => d.id === id)!;
    const lv = this.up(id);
    const cost = shardCost(lv);
    if (lv >= def.max || this.save.shards < cost) return false;
    this.save.shards -= cost;
    this.save.shardUps[id] = lv + 1;
    this.onChange();
    return true;
  }

  /**
   * ⚡ Set by the Volcano each frame: 1.25 while its geothermal plant is
   * powered (boosts ALL cash, in every world), else 1. Not saved.
   */
  powerBoost = 1;

  // ---- Bonuses the game uses ---------------------------------------------
  get carryBonus() {
    return this.stat('carry') * 2;
  }
  get speedMult() {
    return (1 + this.stat('speed') * 0.05) * (1 + this.up('swift') * 0.06);
  }
  get workMult() {
    return 1 + this.stat('work') * 0.08;
  }
  /** Haggling x Obsidian Riches x geothermal power. */
  get cashMult() {
    return (1 + this.stat('haggle') * 0.05) * (1 + this.up('riches') * 0.1) * this.powerBoost;
  }
  get luck() {
    // 50 Luck points = the full bonus (12 "luck" in the runs: -70% puddle loss, 80% ? wins),
    // plus 💎 Fortune shard levels on top.
    return (this.stat('luck') * 12) / STAT_MAX + this.up('fortune') * 2;
  }
  /** 😄 Charm: customers arrive and get served faster everywhere. */
  get charmMult() {
    return 1 + this.stat('charm') * 0.05;
  }
  /** 📣 Leadership: every helper is faster. */
  get leadMult() {
    return 1 + this.stat('lead') * 0.04;
  }
  /** 🛡️ Toughness: heat builds up slower (and magma burns away slower). */
  get heatMult() {
    return Math.max(0.2, 1 - this.stat('tough') * (0.8 / STAT_MAX)); // 50 points = -80% heat
  }
  /** 💤 Night Manager: extra share of offline earnings (+1% per point: 50 points takes
   *  the base 50% share to 100%; 💎 Night Shift shards can push it past that). */
  get offlineBonus() {
    return this.stat('manager') * 0.01;
  }

  /** One-line description of a stat's current total bonus. */
  describe(id: StatDef['id']) {
    const n = this.stat(id);
    switch (id) {
      case 'carry': return `+${n * 2} carry`;
      case 'speed': return `+${n * 5}% speed`;
      case 'work': return `+${n * 8}% work speed`;
      case 'haggle': return `+${n * 5}% cash`;
      case 'luck': {
        const l = this.luck; // (includes 💎 Fortune)
        return l ? `-${Math.round(Math.min(70, l * 6))}% puddle loss, ${Math.round(Math.min(80, 50 + l * 4))}% ? win` : 'No bonus yet';
      }
      case 'charm': return `+${n * 5}% customers`;
      case 'lead': return `+${n * 4}% helper speed`;
      case 'tough': return `-${Math.round((1 - this.heatMult) * 100)}% heat`;
      case 'manager': return `+${n}% offline (${Math.round(Math.min(1.5, 0.5 + this.up('night') * 0.1 + this.offlineBonus) * 100)}% kept)`;
    }
  }
}

// ============================================================================
// The Queen's progress: she gains 1 XP per $10 the Bankers collect, levels up, and
// each level gives a point for her stats (Royal Stride, Grab Speed, Tribute).
// ============================================================================
export class QueenProgress {
  onChange: () => void = () => {};
  onLevelUp: (level: number) => void = () => {};

  constructor(public save: SaveData) {
    for (const s of QUEEN_STATS) {
      save.queen.stats[s.id] ??= 0;
      if (save.queen.stats[s.id] > STAT_MAX) {
        save.queen.points += save.queen.stats[s.id] - STAT_MAX;
        save.queen.stats[s.id] = STAT_MAX;
      }
    }
  }

  maxed(id: QueenStatDef['id']) {
    return this.stat(id) >= STAT_MAX;
  }
  get allMaxed() {
    return QUEEN_STATS.every((d) => this.maxed(d.id));
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
    if (this.q.points <= 0 || this.maxed(id)) return false;
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
    if (id === 'speed') return `+${n * 10}% trash money`; // 🗑️ Royal Bins
    if (id === 'grab') return `+${n * 20}% grab`;
    return `+${n * 5}% cash`;
  }
}
