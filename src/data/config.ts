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
  conveyor: {
    speed: 2.4,            // belt speed (units per second)
    spacing: 0.7,          // gap between snack packs on the belt
  },
  xp: {
    pickup: 1,             // each item you pick up
    drop: 1,               // each item you drop off at a station
    sale: 2,               // each sale while YOU work the register
    autoSale: 0.5,         // each sale made by the cashier
    unlockFraction: 0.2,   // unlocking gives 20% of its cost as XP
    runPerItem: 1,         // gate run: XP per item that reaches the finish
    curveBase: 15,         // XP to reach level 2
    curveExp: 1.55,        // how fast levels get harder
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
  { id: 'conveyor', name: 'Conveyor Belt',   icon: '⛓️', cost: 150, pos: [6.2, -10.6], requires: ['cashier'] },
  { id: 'runner',   name: 'Runner Ant',      icon: '🏃', cost: 150, pos: [3.6, -2.4], requires: ['cashier'] },
  { id: 'worker2',  name: 'Worker Ant',      icon: '🐜', cost: 200, pos: [-11.5, -1.5], requires: ['worker1', 'pile2'] },
  { id: 'banker',   name: 'Banker Ant',      icon: '💼', cost: 300, pos: [4.2, 2.4], requires: ['cashier', 'runner'] },
  { id: 'expand',   name: 'Big Order: Tunnels', icon: '🗺️', cost: 500, pos: [11, 7], requires: ['dispatch', 'worker2', 'oven2'] },

  // ---- Zone 2: Brood Tunnels (west) — leaves -> leaf press -> leaf wraps ----
  { id: 'leaf2',      name: 'Leaf Patch',      icon: '🌿', cost: 300,  pos: [-20, 4],     requires: ['expand'] },
  { id: 'cashier2',   name: 'Hire Cashier',    icon: '🧾', cost: 450,  pos: [-36, -6.4],  requires: ['expand'] },
  { id: 'leafant',    name: 'Leaf Ant',        icon: '🐜', cost: 550,  pos: [-24, -1.5],  requires: ['leaf2'] },
  { id: 'wraprunner', name: 'Wrap Runner',     icon: '🏃', cost: 650,  pos: [-30.5, 1.5], requires: ['cashier2'] },
  { id: 'hatchery',   name: 'Hatchery',        icon: '🥚', cost: 800,  pos: [-30, 7.5],   requires: ['leafant'] },
  { id: 'raft',       name: 'Raft Runs',       icon: '🚣', cost: 900,  pos: [-24, 8],     requires: ['leaf2'] },
  { id: 'press2',     name: 'Faster Press',    icon: '🔥', cost: 1200, pos: [-35, -10.6], requires: ['leafant'] },
  { id: 'leafant2',   name: 'Leaf Ant',        icon: '🐜', cost: 1000, pos: [-24, -1.5],  requires: ['leafant'] },
  { id: 'banker2',    name: 'Banker Ant',      icon: '💼', cost: 1400, pos: [-37.5, 4.6], requires: ['cashier2', 'wraprunner'] },
  { id: 'expand2',    name: 'Big Order: Hangar', icon: '🗺️', cost: 3500, pos: [7, 9.3], requires: ['hatchery', 'raft', 'press2', 'wraprunner'] },

  // ---- Zone 3: Hangar Floor (south) — vending machine sugar -> candy press -> candy ----
  { id: 'sugar2',      name: 'Vending Machine', icon: '🍬', cost: 1500,  pos: [-8, 28],   requires: ['expand2'] },
  { id: 'cashier3',    name: 'Hire Cashier',    icon: '🧾', cost: 2000,  pos: [11, 33.5], requires: ['expand2'] },
  { id: 'sugarant',    name: 'Sugar Ant',       icon: '🐜', cost: 2400,  pos: [-3, 24.5], requires: ['sugar2'] },
  { id: 'candyrunner', name: 'Candy Runner',    icon: '🏃', cost: 2800,  pos: [2.5, 24.5], requires: ['cashier3'] },
  { id: 'candy2',      name: 'Faster Press',    icon: '🔥', cost: 4000,  pos: [-3, 33.5], requires: ['sugarant'] },
  { id: 'sugarant2',   name: 'Sugar Ant',       icon: '🐜', cost: 3200,  pos: [-3, 24.5], requires: ['sugarant'] },
  { id: 'banker3',     name: 'Banker Ant',      icon: '💼', cost: 4500,  pos: [3.4, 32.2], requires: ['cashier3', 'candyrunner'] },
  { id: 'expand3',     name: 'Big Order: Airstrip', icon: '✈️', cost: 12000, pos: [-10, 34], requires: ['candy2', 'candyrunner'] },
];

/** The map grows zone by zone. A zone opens when its `unlock` is bought. */
export interface ZoneDef {
  id: string;
  name: string;
  rect: { minX: number; maxX: number; minZ: number; maxZ: number };
  unlock: string | null;      // unlock id that opens it (null = open from the start)
  ground: 'dirt' | 'tunnel' | 'concrete';
  gaps: { side: 'n' | 's' | 'e' | 'w'; from: number; to: number }[]; // fence openings for customers
}
export const ZONES: ZoneDef[] = [
  { id: 'nest', name: 'Nest Entrance', rect: { minX: -14, maxX: 14, minZ: -13, maxZ: 11 }, unlock: null, ground: 'dirt', gaps: [{ side: 'e', from: -6.2, to: 1.2 }] },
  { id: 'brood', name: 'Brood Tunnels', rect: { minX: -42, maxX: -14, minZ: -13, maxZ: 11 }, unlock: 'expand', ground: 'tunnel', gaps: [{ side: 'w', from: -4.2, to: 3.0 }] },
  { id: 'hangar', name: 'Hangar Floor', rect: { minX: -14, maxX: 14, minZ: 11, maxZ: 37 }, unlock: 'expand2', ground: 'concrete', gaps: [{ side: 'e', from: 22.8, to: 30.2 }] },
];

/** ARK-style stats: each level-up gives 1 point to spend on one of these. */
export interface StatDef {
  id: 'carry' | 'speed' | 'work' | 'haggle' | 'luck';
  name: string;
  icon: string;
  per: string; // what one point does (shown in the stats screen)
}
export const STATS: StatDef[] = [
  { id: 'carry', name: 'Carry Weight', icon: '🎒', per: '+2 items on your back' },
  { id: 'speed', name: 'Movement Speed', icon: '👟', per: '+5% walk speed' },
  { id: 'work', name: 'Work Speed', icon: '⚡', per: '+8% faster pickup and drop-off' },
  { id: 'haggle', name: 'Haggling', icon: '💰', per: '+5% cash from sales and runs' },
  { id: 'luck', name: 'Luck', icon: '🍀', per: 'Fewer puddle losses, better ? gates' },
];

/** The Queen joins the economy at this player level. */
export const QUEEN_UNLOCK_LEVEL = 20;

/** The Queen's own stats (she earns XP from the cash she collects, like an ARK tame). */
export interface QueenStatDef {
  id: 'speed' | 'grab' | 'tribute';
  name: string;
  icon: string;
  per: string;
}
export const QUEEN_STATS: QueenStatDef[] = [
  { id: 'speed', name: 'Royal Stride', icon: '👟', per: '+12% walk speed' },
  { id: 'grab', name: 'Grab Speed', icon: '✋', per: '+20% faster cash pickup' },
  { id: 'tribute', name: 'Tribute', icon: '💰', per: '+5% on all cash she collects' },
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
