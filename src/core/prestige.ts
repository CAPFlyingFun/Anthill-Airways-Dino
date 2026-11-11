// ============================================================================
// prestige.ts — THE BIG ERUPTION (Act 4's prestige).
//
// Erupting the volcano resets Dino Island + the Volcano (their unlocks, any
// half-paid tiles, a tamed Rex) and your cash, and pays 💎 Obsidian Shards.
// Shards buy permanent upgrades at the Obsidian Shrine (see progress.ts).
// You keep: the colony, the airport, your level + stats, the Queen, shards.
// ============================================================================
import { PRESTIGE } from '../data/config';
import { SaveData } from './save';

/** Shards for the cash earned since the last eruption: 12 x sqrt(millions). */
export function shardsFor(earned: number) {
  return Math.max(PRESTIGE.minShards, Math.floor(PRESTIGE.shardsPerSqrtMillion * Math.sqrt(Math.max(0, earned) / 1e6)));
}

/** Acts 3 + 4 (island + volcano) ids: everything an eruption wipes. */
const wiped = (id: string) => id.startsWith('i3-') || id.startsWith('v4-');

/** Apply the eruption to the save (the caller saves + reloads the game). */
export function erupt(save: SaveData, gain: number) {
  save.shards += gain;
  save.eruptions += 1;
  save.unlocked = save.unlocked.filter((id) => !wiped(id));
  for (const k of Object.keys(save.paid)) if (wiped(k)) delete save.paid[k];
  // Their ⬆️ upgrade pads and helpers' levels go too
  for (const k of Object.keys(save.upgrades)) if (wiped(k)) delete save.upgrades[k];
  for (const k of Object.keys(save.upPaid)) if (wiped(k)) delete save.upPaid[k];
  delete save.crewXp.island;
  delete save.crewXp.volcano;
  // 🚀 Head Start: $100k per level to get the island going again
  save.cash = 100000 * (save.shardUps.head ?? 0);
  save.cycleEarned = 0;
  save.world = 'island';
  // The island + volcano income is gone for now (offline earnings re-measure it)
  save.rate *= 0.3;
}
