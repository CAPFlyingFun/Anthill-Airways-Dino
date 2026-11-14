// ============================================================================
// upgrades.ts — the ⬆️ BUILDING UPGRADES' numbers (what each level does + costs).
//
// Walk up to a building and tap ⬆️ (or tap the building) to open its panel,
// then buy levels (x1, x5 or MAX; max level 10). ⭐ Lv 5 and Lv 10 are
// MILESTONES: those levels give a bigger jump than the others.
//   machine   — ovens, presses, blender, forge, washers, kitchen: cook faster
//   seller    — counters + desks: higher prices and more customers
//   source    — piles that regrow: regrow faster
//   crew      — every helper in that world: walk + work faster, carry more
//   collector — bankers, the Queen, assistants: grab faster + bonus cash
// Levels are saved in save.upgrades (by pad id).
// ============================================================================
export type UpKind = 'machine' | 'seller' | 'source' | 'crew' | 'collector' | 'trash' | 'line';

export const UP_MAX = 10;

export const UP_KINDS: Record<UpKind, { icon: string; name: string }> = {
  machine: { icon: '⚙️', name: 'Cook speed' },
  seller: { icon: '💲', name: 'Prices & customers' },
  line: { icon: '👥', name: '2nd cashier, then bigger orders' },
  source: { icon: '🌱', name: 'Regrow speed' },
  crew: { icon: '👷', name: 'Helpers: speed & carry' },
  collector: { icon: '💼', name: 'Bankers & assistants: grab speed & cash' },
  trash: { icon: '🗑️', name: 'Trash money (every bin)' },
};

/** Price of the NEXT level: `base` x 1.85 per level already bought. */
export function upCost(base: number, level: number) {
  return Math.round(base * Math.pow(1.85, level));
}

/** ⭐ Milestone levels: each one adds a bigger jump on top of the usual step. */
export const MILESTONES = [5, 10];
/** How many milestones `lv` has reached (0, 1 or 2). */
const ms = (lv: number) => MILESTONES.filter((m) => lv >= m).length;

// ---- What a level does (lv = levels bought, 0..10) --------------------------
// Each = a small step per level + a ⭐ jump at Lv 5 and Lv 10. At Lv 10 they add up to
// exactly what the old flat steps gave (machine x3.5, prices x2, regrow x4...), so the
// v0.25 balance budget is unchanged; the milestones just make Lv 5 / 10 feel special.
export const up = {
  machine: (lv: number) => 1 + lv * 0.2 + ms(lv) * 0.25,    // cook speed multiplier (Lv 10: x3.5)
  price: (lv: number) => 1 + lv * 0.08 + ms(lv) * 0.1,      // seller: price multiplier (Lv 10: x2)
  pace: (lv: number) => 1 + lv * 0.06 + ms(lv) * 0.1,       // seller: customer + service speed (Lv 10: x1.8)
  bulk: (lv: number) => 1 + lv * 0.2,                       // BIGGER ORDERS (after the 2nd cashier): customers buy more per visit
  source: (lv: number) => 1 + lv * 0.25 + ms(lv) * 0.25,    // regrow speed multiplier (Lv 10: x4)
  crewSpeed: (lv: number) => 1 + lv * 0.08 + ms(lv) * 0.1,  // helpers' speed multiplier (Lv 10: x2)
  crewCarry: (lv: number) => lv,                            // extra items per trip
  grab: (lv: number) => 1 + lv * 0.12 + ms(lv) * 0.15,      // collectors' speed multiplier (Lv 10: x2.5)
  bonus: (lv: number) => 1 + lv * 0.05 + ms(lv) * 0.05,     // collectors' cash multiplier (Lv 10: x1.6)
};
/** Kinds whose Lv 5 / Lv 10 are ⭐ milestones (the line and trash use their own steps). */
export const HAS_MILESTONES: ReadonlySet<string> = new Set(['machine', 'seller', 'source', 'crew', 'collector']);


/** The colony's pads by zone: later zones' buildings earn more, so their pads cost more. */
export const COLONY_ZONE_BASE: Record<string, number> = { nest: 60, brood: 250, hangar: 750 };

/**
 * Base price of a level-1 upgrade in each world (later levels x1.85 each).
 * Roughly the price of that world's cheapest unlock tiles.
 */
export const UP_BASE: Record<string, number> = {
  ant: 60,
  air: 3000,
  island: 25000,
  volcano: 120000,
  hotel: 450000,
};
