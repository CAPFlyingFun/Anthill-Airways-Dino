// ============================================================================
// home.ts — 🏝️ ANTHILL ISLAND (test version): the numbers for the backyard.
//
// The new one-island game from the design doc ("Anthill Island: Design Doc").
// This first test is the opening only:
//   backyard ant farm -> neighbors' orders -> the first ant helpers ->
//   the delivery crate (planks) -> the next plot: the Corner Café (+ a chest)
//
// Units: people are AIR.humanH (2.8) tall, like the airport. Helper ants are
// small next to them (HOME.antLength), but big enough to see what they carry.
// ============================================================================
import type { UnlockDef } from './config';

export const HOME = {
  /** Where you can walk: the backyard, then the café plot east of it. */
  yard: { minX: -15, maxX: 15, minZ: -11, maxZ: 11 },
  cafePlot: { minX: 16, maxX: 36, minZ: -11, maxZ: 11 },
  /** The gate in the east fence, between the yard and the café plot (z range). */
  gate: { z0: -1, z1: 5 },
  /** Helper ants' body length (people are 2.8 tall). */
  antLength: 1.6,
  /** People walk a touch faster than the ant Major did (same as the airport). */
  speedMult: 1.15,
  /** The ant farm: seconds to turn one crumb into a snack pack. */
  farm: { cookTime: 2.2 },
  order: {
    first: 5,      // the first neighbor wants 5 snack packs...
    second: 10,    // ...the second one 10
    min: 6,        // later orders: 6-11 packs (+1 every 3 levels)
    max: 11,
    pay: 7,        // $ per snack pack (+5% per level)
    xpBase: 10,    // XP = xpBase + xpPer x packs (+ 1 XP for every pickup and drop on the way)
    xpPer: 3,
    wait: 8,       // seconds until the next neighbor walks in
  },
  crate: {
    /** What each trip asks for (goods you can already make). The last one repeats. */
    asks: [
      { snack: 6, crumb: 6 },
      { snack: 8, crumb: 8 },
      { snack: 10, crumb: 10 },
    ] as Record<string, number>[],
    away: 60,      // seconds on the road before it comes back with planks
    planks: 3,     // 🪵 planks per trip
    xp: 30,
  },
  /** The café plot's gate: helpers working + planks (+ the level and price on its tile). */
  plot: { ants: 2, planks: 3 },
  cafe: {
    priceMult: 1.6, // a snack pack sells for $8 at the café (orders pay $7 + XP)
    interval: 7,    // seconds between new café customers
    queueMax: 5,
    serve: 0.7,     // seconds per pack sold
  },
  chest: { cash: 150, xp: 40 },
};

/**
 * Walk-on tiles, in the order you meet them. The farm levels share one spot by the
 * farm (only one is out at a time). 'ai-order1' isn't a tile: it's added when the
 * first order is filled. Names are plain words (the ground-text font has no emoji
 * or accents: an unknown letter makes it fetch a fallback font, which hangs offline).
 */
export const HOME_UNLOCKS: UnlockDef[] = [
  { id: 'ai-farm2', name: 'Farm Lv 2: Gatherer', icon: '🐜', cost: 40, pos: [-4.5, 3], requires: ['ai-order1'], level: 2 },
  { id: 'ai-farm3', name: 'Farm Lv 3: Carrier', icon: '🐜', cost: 100, pos: [-4.5, 3], requires: ['ai-farm2'], level: 3 },
  { id: 'ai-cafe', name: 'Corner Cafe Plot', icon: '☕', cost: 400, pos: [12.4, 2], requires: ['ai-farm2'], level: 7 },
  { id: 'ai-farm4', name: 'Farm Lv 4: Cashier', icon: '🐜', cost: 400, pos: [-4.5, 3], requires: ['ai-farm3', 'ai-cafe'], level: 8 },
  { id: 'ai-farm5', name: 'Farm Lv 5: Banker', icon: '🐜', cost: 600, pos: [-4.5, 3], requires: ['ai-farm4'], level: 9 },
];

/** The neighbors who come by with orders (names cycle; their looks come from the people models). */
export const NEIGHBORS = ['Rosa', 'Mr. Lee', 'Grandpa Joe', 'Mia', 'Coach Dan', 'Mrs. Patel', 'Sam', 'The Parkers'];
