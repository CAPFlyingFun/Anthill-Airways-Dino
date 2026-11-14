// ============================================================================
// progress.ts — XP, levels and stat points (like ARK: Survival Evolved).
//
// Every task gives XP. Each level-up gives 1 point. Points go into stats
// (carry weight, speed, work speed, haggling, luck), and the rest of the game
// reads the bonuses from the getters at the bottom.
// ============================================================================
import { CONFIG, LUCK_CAP, OFFLINE, QUEEN_FX, QUEEN_STATS, QueenStatDef, SHARD_FX, SHARD_UPS, STAT_FX, STAT_MAX, STATS, ShardUpDef, StatDef, shardCost } from '../data/config';
import { SaveData } from './save';
import { shardsSpent } from './migrate';

/** 0.125 -> "12.5%" (no trailing .0). */
const pct = (f: number) => `${+(f * 100).toFixed(1)}%`;
/** 4.8 -> "4h 48m". */
const hours = (h: number) => (h % 1 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${h}h`);

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
    return CONFIG.xp.levelBase + CONFIG.xp.levelStep * (Math.max(1, level) - 1);
  }

  /** Gate-run XP: items that reached the finish, but at most 2x the starting load
   *  (so one lucky run with big x gates can't dominate leveling). */
  static runXp(endCount: number, startCount?: number) {
    const capped = startCount ? Math.min(endCount, startCount * CONFIG.xp.runCap) : endCount;
    return Math.max(0, capped) * CONFIG.xp.runPerItem;
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

  /** 🔄 Take back every 💎 shard spent at the Obsidian Shrine (to spend again). Returns how many. */
  respecShards() {
    const n = shardsSpent(this.save);
    this.save.shardUps = {};
    this.save.shards += n;
    this.onChange();
    return n;
  }

  /** 🔄 Take every point back out of the stats (to spend again). Returns how many. */
  respec() {
    let n = 0;
    for (const d of STATS) {
      n += this.stat(d.id);
      this.save.stats[d.id] = 0;
    }
    this.save.points += n;
    this.onChange();
    return n;
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
  // (Per-point values: STAT_FX / SHARD_FX in config.ts.)
  get carryBonus() {
    return this.stat('carry') * STAT_FX.carry;
  }
  get speedMult() {
    return (1 + this.stat('speed') * STAT_FX.speed) * (1 + this.up('swift') * SHARD_FX.swift);
  }
  get workMult() {
    return 1 + this.stat('work') * STAT_FX.work;
  }
  /** Haggling x Obsidian Riches x geothermal power. */
  get cashMult() {
    return (1 + this.stat('haggle') * STAT_FX.haggle) * (1 + this.up('riches') * SHARD_FX.riches) * this.powerBoost;
  }
  /** 🍀 Chance a ? gate pays x3 (50% base; Luck + 💎 Lucky Ash, max 80%). */
  get luckWin() {
    return Math.min(LUCK_CAP.win, 0.5 + this.stat('luck') * STAT_FX.luckWin + this.up('fortune') * SHARD_FX.fortuneWin);
  }
  /** 🍀 Share of puddle / hazard losses Luck saves (max 70%). */
  get luckSave() {
    return Math.min(LUCK_CAP.save, this.stat('luck') * STAT_FX.luckSave + this.up('fortune') * SHARD_FX.fortuneSave);
  }
  /** 😄 Charm: customers arrive and get served faster everywhere. */
  get charmMult() {
    return 1 + this.stat('charm') * STAT_FX.charm;
  }
  /** 📣 Leadership: every helper is faster. */
  get leadMult() {
    return 1 + this.stat('lead') * STAT_FX.lead;
  }
  /** 🛡️ Toughness: heat builds up slower (and magma burns away slower). 50 points = -60%. */
  get heatMult() {
    return Math.max(0.4, 1 - this.stat('tough') * STAT_FX.tough);
  }
  /** 💤 Night Manager: extra share of offline earnings (+0.5 points each, 50 = +25). */
  get offlineBonus() {
    return this.stat('manager') * STAT_FX.manager;
  }
  /** 💤 Share of the idle rate paid while away: 50% + Night Manager (25) + Night Shift (25) = 100% max. */
  get offlineShare() {
    return Math.min(1, OFFLINE.share + this.offlineBonus + this.up('night') * SHARD_FX.nightShare);
  }
  /** 💤 Hours away that count: 4 to start, +48 min per Night Shift level (8 max). */
  get offlineHours() {
    return OFFLINE.maxHours + this.up('night') * SHARD_FX.nightHours;
  }

  /** One-line description of a stat's current total bonus. */
  describe(id: StatDef['id']) {
    const n = this.stat(id);
    switch (id) {
      case 'carry': return `+${n * STAT_FX.carry} carry`;
      case 'speed': return `+${pct(n * STAT_FX.speed)} speed`;
      case 'work': return `+${pct(n * STAT_FX.work)} work speed`;
      case 'haggle': return `+${pct(n * STAT_FX.haggle)} cash`;
      case 'luck': // (includes 💎 Lucky Ash)
        return this.luckSave > 0 || this.luckWin > 0.5 ? `${pct(this.luckWin)} ? wins, -${pct(this.luckSave)} losses` : 'No bonus yet';
      case 'charm': return `+${pct(n * STAT_FX.charm)} customers`;
      case 'lead': return `+${pct(n * STAT_FX.lead)} helper speed`;
      case 'tough': return `-${pct(1 - this.heatMult)} heat`;
      case 'manager': return `+${pct(this.offlineBonus)} offline (${pct(this.offlineShare)} kept, up to ${hours(this.offlineHours)})`;
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

  /** 🔄 Take every point back out of the Queen's stats. Returns how many. */
  respec() {
    let n = 0;
    for (const d of QUEEN_STATS) {
      n += this.stat(d.id);
      this.q.stats[d.id] = 0;
    }
    this.q.points += n;
    this.onChange();
    return n;
  }

  /** (Her old "Royal Stride": she stays on her throne now, so this only paces her idle shuffle.) */
  get speedMult() {
    return 1;
  }
  /** 🗑️ Royal Bins: trash money multiplier. */
  get binMult() {
    return 1 + this.stat('speed') * QUEEN_FX.bins;
  }
  get grabMult() {
    return 1 + this.stat('grab') * QUEEN_FX.grab;
  }
  get tributeMult() {
    return 1 + this.stat('tribute') * QUEEN_FX.tribute;
  }

  describe(id: QueenStatDef['id']) {
    const n = this.stat(id);
    if (id === 'speed') return `+${pct(n * QUEEN_FX.bins)} trash money`; // 🗑️ Royal Bins
    if (id === 'grab') return `+${pct(n * QUEEN_FX.grab)} grab`;
    return `+${pct(n * QUEEN_FX.tribute)} cash`;
  }
}
