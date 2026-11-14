// ============================================================================
// migrate.ts — one-time save updates for big balance changes.
//
// v0.25 BALANCE PASS (save.paid['bal-v1']): XP stopped coming from money (Lv 500+
// saves), every bonus got smaller (x141 -> about x20 maxed), offline pay starts at
// 4 hours, and shards count only island + volcano cash. For saves made BEFORE that:
//   1. a backup copy of the old save is kept (localStorage "<slot key>-pre-v0.25"),
//      unless storage is too full for it (then the save itself always wins)
//   2. level, cash, stat points, upgrades and shards are all KEPT as they are
//   3. progress inside the current level keeps its fraction on the new XP curve
//   4. one FREE respec is offered (stats screen) if any stat point or 💎 shard was
//      ever spent, since every stat and shard upgrade changed
//   5. the shards the old eruption cycle had already earned are carried forward
//      once (paid on top at the next eruption); new tracking starts at zero
//   6. the idle rate (offline pay) is scaled down to the new cash bonuses right
//      away, then re-measured quickly from what the helpers really collect now
// Runs once per save slot (the flag is saved with the slot), never twice.
// ============================================================================
import { PRESTIGE, QUEEN_STATS, SHARD_FX, SHARD_UPS, STAT_FX, STATS, shardCost } from '../data/config';
import { SaveData, activeSaveKey } from './save';

export const BALANCE_FLAG = 'bal-v1';

/** XP from level L to L+1 under the OLD curve (15 x L^1.55). */
const oldXpToNext = (level: number) => Math.round(15 * Math.pow(Math.max(1, level), 1.55));

/** Shards a cycle's earnings are worth (12 x sqrt(millions), no minimum). */
const rawShards = (earned: number) => Math.floor(PRESTIGE.shardsPerSqrtMillion * Math.sqrt(Math.max(0, earned) / 1e6));

/** Shards spent on the shrine so far (3, 5, 7, ... per level). */
export function shardsSpent(save: SaveData) {
  let n = 0;
  for (const d of SHARD_UPS) for (let l = 0; l < (save.shardUps[d.id] ?? 0); l++) n += shardCost(l);
  return n;
}

export interface MigrationResult {
  /** It was an older save and got converted. */
  changed: boolean;
  /** Worth telling the player about (they had real progress). */
  tell: boolean;
}

/**
 * Bring a save up to the v0.25 balance. `newXpToNext` = the new curve
 * (Progress.xpToNext), passed in to avoid an import cycle.
 */
export function migrateBalance(save: SaveData, newXpToNext: (level: number) => number): MigrationResult {
  if (save.paid[BALANCE_FLAG]) return { changed: false, tell: false };
  // A brand-new game has nothing to convert
  const fresh = !save.lastSeen && save.level <= 1 && save.unlocked.length === 0 && !save.eruptions;
  if (fresh) {
    save.paid[BALANCE_FLAG] = 1;
    return { changed: false, tell: false };
  }
  const key = activeSaveKey();
  const backupKey = `${key}-pre-v0.25`;
  const original = JSON.stringify(save);

  // 3) Same fraction of the way through the current level, on the new curve
  const frac = Math.min(0.999, Math.max(0, save.xp / oldXpToNext(save.level)));
  save.xp = Math.floor(frac * newXpToNext(save.level));

  // 4) One free respec, if anything was ever spent (stats, the Queen's stats, shards)
  const spentStats = STATS.reduce((n, d) => n + (save.stats[d.id] ?? 0), 0) + QUEEN_STATS.reduce((n, d) => n + (save.queen.stats[d.id] ?? 0), 0);
  const spentShards = shardsSpent(save);
  if (spentStats + spentShards > 0) save.paid['respec-free'] = 1;

  // 5) Shards already earned this cycle (old rules) carry forward once
  const carry = rawShards(save.cycleEarned);
  if (carry > 0) save.paid['shard-carry'] = (save.paid['shard-carry'] ?? 0) + carry;
  save.cycleEarned = 0;

  // 6) The idle rate was measured with the OLD cash bonuses (Haggling +5%, Obsidian Riches
  // +10%): scale it to the new ones (+1%, +2%) so the next offline pay already fits the new
  // balance (the geothermal boost is the same in both, so it cancels out)...
  const h = Math.min(50, save.stats.haggle ?? 0);
  const r = save.shardUps.riches ?? 0;
  const ratio = ((1 + h * STAT_FX.haggle) * (1 + r * SHARD_FX.riches)) / ((1 + h * 0.05) * (1 + r * 0.1));
  save.rate = (save.rate || 0) * ratio;
  // ...and re-measure it quickly from real collections (main.ts trackIncome; saved, so a
  // short first session doesn't leave the old number in place)
  save.paid['rate-fast'] = 6;

  save.paid[BALANCE_FLAG] = 1;

  // 1) + write: keep a backup of the original, then save the converted game right away
  // (as-is: lastSeen is NOT touched, so the time you were away still counts).
  // All of capflyingfun.github.io shares one storage quota, so if the backup leaves no
  // room for the save itself, the backup goes and the save wins.
  try {
    localStorage.setItem(backupKey, original);
  } catch {
    /* no room for a backup: carry on without it */
  }
  try {
    localStorage.setItem(key, JSON.stringify(save));
  } catch {
    try {
      localStorage.removeItem(backupKey);
      localStorage.setItem(key, JSON.stringify(save));
    } catch {
      /* the regular autosave will try again */
    }
  }
  return { changed: true, tell: spentStats + spentShards > 0 || save.level >= 5 || save.eruptions > 0 };
}
