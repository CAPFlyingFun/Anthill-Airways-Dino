// ============================================================================
// config.ts — every tunable number in the game lives here.
// Balancing the game = editing numbers in this file, not hunting through code.
// ============================================================================

export const CONFIG = {
  player: {
    speed: 6.5,            // world units per second
    baseCarry: 8,          // how many items the ant can stack on its back
    carryPerUpgrade: 6,    // extra carry from the "Bigger Backpack" unlock
    pickupInterval: 0.07,  // seconds between each item hop (lower = faster)
  },
  crumbPile: {
    max: 18,               // crumbs a pile holds when full
    spawnInterval: 0.55,   // seconds to regrow one crumb
  },
  bakery: {
    inputMax: 30,
    outputMax: 24,
    cookTime: 1.3,         // seconds per snack pack
    fastOvenMultiplier: 1.7,
  },
  counter: {
    shelfMax: 30,
    saleValue: 5,          // cash per snack pack sold at the counter
    customerInterval: 2.0, // seconds between new customers
    queueMax: 4,
    saleInterval: 0.3,     // seconds between each sale to the front customer
  },
  worker: {
    speed: 3.6,
    carry: 5,
    pickupInterval: 0.15,
  },
  cart: {
    max: 40,               // most snack packs a gate run can start with
    minLaunch: 5,          // need at least this many to launch
  },
  run: {
    speed: 13,             // forward speed during a gate run
    steerSpeed: 9,         // sideways speed from the joystick
    rows: 6,               // gate rows per run
    rowSpacing: 32,
    firstRow: 34,
    laneHalfWidth: 3.4,
    valuePerItem: 5,       // cash per item that reaches the finish
    puddleLoss: 0.15,      // fraction lost when you splash through a puddle
  },
  unlockDrainTime: 1.4,    // seconds to pour cash into an unlock tile (minimum rate below)
  unlockMinRate: 12,       // cash per second, at least
  saveKey: 'anthill-airways-save-v1',
};

/** One glowing unlock tile on the ground. */
export interface UnlockDef {
  id: string;
  name: string;
  icon: string;
  cost: number;
  pos: [number, number];   // [x, z] on the ground
  requires: string[];      // other unlock ids that must be bought first
}

// The order here is also roughly the order the player will meet them.
export const UNLOCKS: UnlockDef[] = [
  { id: 'pile2',    name: 'Crumb Pile',      icon: '🍞', cost: 25,  pos: [-8, 2],    requires: [] },
  { id: 'cashier',  name: 'Hire Cashier',    icon: '🧾', cost: 40,  pos: [10.5, 3.2], requires: [] },
  { id: 'dispatch', name: 'Gate Runs',       icon: '🚩', cost: 60,  pos: [0, 5.5],   requires: ['pile2'] },
  { id: 'carry1',   name: 'Bigger Backpack', icon: '🎒', cost: 75,  pos: [-3.5, 7],  requires: ['pile2'] },
  { id: 'worker1',  name: 'Worker Ant',      icon: '🐜', cost: 90,  pos: [-4, -1.5], requires: ['cashier'] },
  { id: 'oven2',    name: 'Faster Oven',     icon: '🔥', cost: 120, pos: [-5.4, -9], requires: ['worker1'] },
  { id: 'worker2',  name: 'Worker Ant',      icon: '🐜', cost: 200, pos: [-11.5, -1.5], requires: ['worker1', 'pile2'] },
  { id: 'expand',   name: 'Big Order: Tunnels', icon: '🗺️', cost: 500, pos: [11, 7], requires: ['dispatch', 'worker2', 'oven2'] },
];

/** Tutorial hints, shown one at a time until the player does each thing. */
export const TUTORIAL = [
  'Drag anywhere to walk. Grab crumbs from the crumb pile 🍞',
  'Carry the crumbs to the oven\'s IN pad',
  'Pick up fresh snack packs from the OUT pad',
  'Stand on SELL to serve the customers',
  'Walk over your cash 💵 to collect it',
  'Stand on a glowing tile to unlock it',
];
