// ============================================================================
// upgrades.ts — the ⬆️ UPGRADE PADS' numbers (what each level does + costs).
//
// Every world has upgrade pads next to its buildings. Stand on one and pour
// cash in (like an unlock tile) to raise that building a level (max 10).
//   machine   — ovens, presses, blender, forge, washers, kitchen: cook faster
//   seller    — counters + desks: higher prices and more customers
//   source    — piles that regrow: regrow faster
//   crew      — every helper in that world: walk + work faster, carry more
//   collector — bankers, the Queen, assistants: grab faster + bonus cash
// Levels are saved in save.upgrades (by pad id).
// ============================================================================
export type UpKind = 'machine' | 'seller' | 'source' | 'crew' | 'collector' | 'trash';

export const UP_MAX = 10;

export const UP_KINDS: Record<UpKind, { icon: string; per: string }> = {
  machine: { icon: '⚙️', per: '+25% cook speed' },
  seller: { icon: '💲', per: '+10% prices, +8% customers, +20% bigger orders' },
  source: { icon: '🌱', per: '+30% regrow speed' },
  crew: { icon: '👷', per: '+10% helper speed, +1 carry' },
  collector: { icon: '💼', per: '+15% grab speed, +6% cash' },
  trash: { icon: '🗑️', per: '$1 -> $50 per piece of trash' },
};

/** Price of the NEXT level: `base` x 1.85 per level already bought. */
export function upCost(base: number, level: number) {
  return Math.round(base * Math.pow(1.85, level));
}

// ---- What a level does (lv = levels bought, 0..10) --------------------------
export const up = {
  machine: (lv: number) => 1 + lv * 0.25,     // cook speed multiplier
  price: (lv: number) => 1 + lv * 0.1,        // seller: price multiplier
  pace: (lv: number) => 1 + lv * 0.08,        // seller: customer + service speed
  bulk: (lv: number) => 1 + lv * 0.2,         // seller: customers buy more per visit (colony shops)
  source: (lv: number) => 1 + lv * 0.3,       // regrow speed multiplier
  crewSpeed: (lv: number) => 1 + lv * 0.1,    // helpers' speed multiplier
  crewCarry: (lv: number) => lv,              // extra items per trip
  grab: (lv: number) => 1 + lv * 0.15,        // collectors' speed multiplier
  bonus: (lv: number) => 1 + lv * 0.06,       // collectors' cash multiplier
};

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
