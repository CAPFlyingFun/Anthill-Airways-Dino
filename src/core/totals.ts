// ============================================================================
// totals.ts — lifetime numbers for the 📊 Stats screen (cash earned, items
// sold and made, runs, upgrades bought, time played...).
//
// main.ts calls bindTotals(save) once; after that anything in the game can
// call bump('sold') without being handed the save.
// ============================================================================
import { SaveData } from './save';

let data: Record<string, number> | null = null;

export function bindTotals(save: SaveData) {
  data = save.totals;
}

/** Add `n` to a lifetime total. */
export function bump(key: string, n = 1) {
  if (data) data[key] = (data[key] ?? 0) + n;
}

/** Keep the highest value seen (e.g. the best gate run). */
export function best(key: string, v: number) {
  if (data && v > (data[key] ?? 0)) data[key] = v;
}
