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
  // (The Conveyor Belt is gone: it grabbed every snack pack before the Runner Ant
  // could. main.ts refunds it on old saves. The belt is saved for a human-scale act.)
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

/**
 * Idle / offline earnings. While you play, the game measures how much cash
 * comes in per second. When you come back after a while, you get a share of
 * that for the time you were away (the colony + airport kept working).
 */
export const OFFLINE = {
  share: 0.5,        // 50% of your measured income rate while away
  maxHours: 8,       // counts up to 8 hours away
  minAwaySecs: 60,   // shorter breaks don't count
  runBundles: 20,    // the bonus run starts with this many cash bundles
  keepMin: 0.25,     // the bonus run always pays at least 25% of the earnings
};

// ============================================================================
// ACT 2: THE AIRPORT (human scale). You (the terminal manager) run the terminal for Anthill Airways:
//   passengers check in (ticket cash + a suitcase) -> carry bags to the plane
//   -> the plane flies when its hold is full (pays per bag)
//   the ant colony ships snack boxes -> carry them to the café -> travellers buy
// Units here: a person is AIR.humanH tall (so stations are a familiar size).
// ============================================================================
export const AIR = {
  humanH: 2.8,             // how tall people are in airport units
  speedMult: 1.15,         // the terminal manager walks a touch faster than the ant Major did
  ticket: 30,              // cash per passenger checked in
  passengerInterval: 2.6,  // seconds between new passengers at check-in
  cafeInterval: 1.6,       // seconds between new café customers (arriving passengers)
  queueMax: 4,             // check-in line
  cafeQueueMax: 6,         // café line
  serveInterval: 0.5,      // seconds between each check-in step (a bag, then the ticket)
  cafeServe: 0.32,         // seconds between each snack box sold
  crewCarry: 12,           // items a crew member carries per trip
  crewSpeed: 5.2,          // crew walk speed (people take bigger steps than ants)
  partialWait: 10,         // a plane with bags aboard leaves after this long without new ones
  crateMax: 18,            // snack boxes the colony's export crate holds
  crateSlowest: 2.8,       // seconds per box with only the first colony unlocks...
  crateFastest: 0.45,      // ...down to this with the whole colony built
  trolleyCarry: 6,         // extra carry from the Luggage Trolley
  colonyAnts: 46,          // tiny ants walking around the planter box at most
};

/**
 * The Anthill Airways fleet. You start with a Cessna 172 and upgrade it;
 * the helicopter flies from its own helipad, alongside the plane.
 *   hold   = bags that fill it (it takes off when full)
 *   fare   = cash multiplier on every bag it flies
 *   flight = seconds it's away before it lands and pays
 */
export type AircraftKind = 'cessna' | 'twin' | 'jet' | 'liner' | 'heli';
export const FLEET: Record<AircraftKind, { name: string; hold: number; fare: number; flight: number }> = {
  cessna: { name: 'Cessna 172', hold: 10, fare: 1.0, flight: 6 },
  twin:   { name: 'Twin Prop',  hold: 16, fare: 1.4, flight: 7 },
  jet:    { name: 'Learjet',    hold: 22, fare: 2.0, flight: 6 },
  liner:  { name: 'Airliner',   hold: 40, fare: 2.6, flight: 9 },
  heli:   { name: 'Helicopter', hold: 8, fare: 2.2, flight: 4 },
};

/** Act 2 unlock tiles (inside the terminal). Same shape as UNLOCKS. */
export const AIR_UNLOCKS: UnlockDef[] = [
  { id: 'a2-agent',   name: 'Check-in Agent',  icon: '🛂', cost: 4000,  pos: [2.5, -5],    requires: [] },
  { id: 'a2-trolley', name: 'Luggage Trolley', icon: '🛒', cost: 5000,  pos: [0, 2],       requires: ['a2-agent'] },
  { id: 'a2-cafe',    name: 'Ant Café',        icon: '☕', cost: 7000,  pos: [-9, 4],      requires: ['a2-agent'] },
  { id: 'a2-handler', name: 'Baggage Handler', icon: '🧳', cost: 10000,  pos: [8.5, -6.2],  requires: ['a2-agent'] },
  { id: 'a2-barista', name: 'Barista',         icon: '🧋', cost: 13000,  pos: [-5, 7.6],    requires: ['a2-cafe'] },
  { id: 'a2-host',    name: 'Café Host',       icon: '🍱', cost: 16000,  pos: [-4.5, -6],   requires: ['a2-cafe'] },
  { id: 'a2-twin',    name: 'Plane: Twin Prop', icon: '🛩️', cost: 12000,  pos: [8.5, -10.5], requires: ['a2-handler'] },
  { id: 'a2-heli',    name: 'Helipad',          icon: '🚁', cost: 18000,  pos: [-15.5, -10.2], requires: ['a2-handler'] },
  { id: 'a2-jet',     name: 'Plane: Learjet',   icon: '🛫', cost: 28000, pos: [8.5, -10.5], requires: ['a2-twin'] },
  { id: 'a2-sarah',   name: 'Personal Assistant', icon: '👩‍💼', cost: 36000, pos: [3, 6.5],  requires: ['a2-barista', 'a2-host', 'a2-handler'] },
  { id: 'a2-liner',   name: 'Plane: Airliner',  icon: '✈️', cost: 52000, pos: [8.5, -10.5], requires: ['a2-jet', 'a2-sarah'] },
  { id: 'a2-island',  name: 'Big Order: Island', icon: '🏝️', cost: 90000, pos: [-2.5, 9.6], requires: ['a2-liner', 'a2-heli'] },
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
  id: 'carry' | 'speed' | 'work' | 'haggle' | 'luck' | 'charm' | 'lead' | 'tough' | 'manager';
  name: string;
  icon: string;
  per: string; // what one point does (shown in the stats screen)
}
/** Most points any one stat (yours or the Queen's) can hold. Luck and Toughness are
 *  spread out so they keep improving right up to this. */
export const STAT_MAX = 50;

export const STATS: StatDef[] = [
  { id: 'carry', name: 'Carry Weight', icon: '🎒', per: '+2 items on your back' },
  { id: 'speed', name: 'Movement Speed', icon: '👟', per: '+5% walk speed' },
  { id: 'work', name: 'Work Speed', icon: '⚡', per: '+8% faster pickup and drop-off' },
  { id: 'haggle', name: 'Haggling', icon: '💰', per: '+5% cash from sales and runs' },
  { id: 'luck', name: 'Luck', icon: '🍀', per: '-1.4% puddle loss, +0.5% ? gate wins' },
  { id: 'charm', name: 'Charm', icon: '😄', per: '+5% more customers, served faster' },
  { id: 'lead', name: 'Leadership', icon: '📣', per: '+4% speed for all your helpers' },
  { id: 'tough', name: 'Toughness', icon: '🛡️', per: '-1.6% heat at the volcano, magma lasts longer' },
  { id: 'manager', name: 'Night Manager', icon: '💤', per: '+5% offline earnings' },
];

/** The Queen joins the economy at this player level. */
export const QUEEN_UNLOCK_LEVEL = 20;

/** The Queen's own stats (she earns XP from the cash your Bankers collect, like an ARK tame). */
export interface QueenStatDef {
  id: 'speed' | 'grab' | 'tribute';
  name: string;
  icon: string;
  per: string;
}
export const QUEEN_STATS: QueenStatDef[] = [
  // (The Queen stays home now: her points boost the 🏦 Bankers and the 🗑️ trash money.
  //  'speed' keeps its save id; it used to be Royal Stride.)
  { id: 'speed', name: 'Royal Bins', icon: '🗑️', per: '+10% trash money' },
  { id: 'grab', name: 'Grab Speed', icon: '✋', per: '+20% faster Banker pickup' },
  { id: 'tribute', name: 'Tribute', icon: '💰', per: '+5% on all cash Bankers collect' },
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

// ============================================================================
// ACT 3: DINO ISLAND (human scale, like the airport). Anthill Airways flies
// tourists in to the island airstrip. Attractions:
//   🥤 JUICE BAR   fruit trees -> blender -> smoothies -> tourists buy
//   🦖 DILO SHOW   carry dino food to the feeding platform; while the
//                  Dilophosaurus is fed, the crowd in the stands pays
//   🥚 DODO RANCH  Dodos lay eggs in nests -> sell them at the Dodo Shop
//   🚤 SEA SAFARI  tourists wait on the dock -> a gate run on the open sea
//                  (Mosasaurus + Megalodon surface as hazards)
// ============================================================================
export const ISLAND_CFG = {
  arrivalEvery: 22,     // seconds between tourist flights landing
  arrivalTourists: [3, 6] as [number, number],
  juiceInterval: 1.8,   // seconds between juice bar customers
  shopInterval: 2.2,    // ... and Dodo Shop customers
  queueMax: 4,
  serve: 0.4,
  blendTime: 0.9,       // seconds per smoothie
  fruitEvery: 1.1,      // a fruit tree grows one fruit every ... seconds
  eggEvery: 1.6,        // a nest gets a new egg every ... seconds
  meatEvery: 0.9,       // the supply crate refills one dino food every ... seconds
  dinoHunger: 32,       // seconds for a full Dilophosaurus to get hungry again
  biteFill: 0.25,       // one dino food = this much of a full belly
  escapeAfter: 20,      // seconds starving before he jumps the fence
  showPayEvery: 2.0,    // while fed, the stands pay every ... seconds
  showPay: 70,          // ... this much
  safariMin: 5,         // tourists needed to launch a Sea Safari
  safariMax: 40,
  captainEvery: 30,     // the Boat Captain runs a safari (at 1x) every ... seconds
  tripTime: 25,         // seconds the safari boat is away on a trip
  thiefEvery: [100, 170] as [number, number], // seconds between baby Dilo thieves
  thiefReward: 400,     // cash for catching one
  crewCarry: 12,
  crewSpeed: 5.2,
};

/** Act 3 unlock tiles. Same shape as UNLOCKS. */
export const ISLAND_UNLOCKS: UnlockDef[] = [
  { id: 'i3-cashier',  name: 'Juice Cashier',    icon: '🧃', cost: 25000,   pos: [-2, 21],   requires: [] },
  { id: 'i3-picker',   name: 'Fruit Picker',     icon: '🍈', cost: 36000,   pos: [-20, 3],   requires: [] },
  { id: 'i3-runner',   name: 'Smoothie Runner',  icon: '🥤', cost: 48000,  pos: [-9, 2],    requires: ['i3-picker'] },
  { id: 'i3-dilo',     name: 'Dilo Show',        icon: '🦖', cost: 80000,  pos: [-8, -8],   requires: ['i3-cashier'] },
  { id: 'i3-keeper',   name: 'Dino Keeper',      icon: '🍖', cost: 105000,  pos: [-2, -4],   requires: ['i3-dilo'] },
  { id: 'i3-dodo',     name: 'Dodo Ranch',       icon: '🦤', cost: 140000,  pos: [10, -6],   requires: ['i3-dilo'] },
  { id: 'i3-eggs',     name: 'Egg Collector',    icon: '🥚', cost: 170000,  pos: [6, 6],     requires: ['i3-dodo'] },
  { id: 'i3-clerk',    name: 'Shop Clerk',       icon: '🛍️', cost: 195000,  pos: [12, 10.5], requires: ['i3-dodo'] },
  { id: 'i3-dock',     name: 'Sea Safari Dock',  icon: '🚤', cost: 240000,  pos: [27, 13],   requires: ['i3-dodo'] },
  { id: 'i3-captain',  name: 'Boat Captain',     icon: '🧑‍✈️', cost: 300000, pos: [25, 25],   requires: ['i3-dock'] },
  { id: 'i3-cashdodo', name: 'Sarah: Assistant', icon: '👩‍💼', cost: 360000,  pos: [4, 14],    requires: ['i3-cashier', 'i3-keeper', 'i3-clerk'] },
  { id: 'i3-volcano',  name: 'Big Order: Volcano', icon: '🌋', cost: 1000000, pos: [0, -20], requires: ['i3-cashdodo', 'i3-captain'] },
];

// ============================================================================
// ACT 4: THE VOLCANO (human scale). Anthill Airways charters helicopter tours
// over an active volcano. Outside to inside:
//   💎 OBSIDIAN MINE  black rock -> FORGE -> polished gems -> Gem Shop
//   ⚡ GEOTHERMAL     carry 🔥 magma (it burns away if you dawdle!) into the
//                     plant: while it's powered, ALL your cash is boosted
//   🚁 HELI TOURS     tourists fly in -> a helicopter gate run over the lava
//   🦖 LAVA REX       feed it 🍖 to tame it; then it hauls for you (heat-proof)
//   🐜 FIRE ANT KINGDOM  giant fire ants! Bring the Fire Queen 💎 tribute and
//                     her colony digs 🔥 Fire Crystals (the priciest goods)
//   🌋 THE BIG ERUPTION  prestige: reset the island + volcano for 💎 Obsidian
//                     Shards = permanent boosts
// Dangers: heat (stand too near the lava and you overheat), eruptions (lava
// bombs + lava flows), and magma that burns through your stack.
// ============================================================================
export const VOLCANO_CFG = {
  arrivalEvery: 20,     // seconds between tourist helicopters landing
  arrivalTourists: [3, 6] as [number, number],
  shopInterval: 2.0,    // seconds between Gem Shop customers
  exchangeInterval: 2.4,// ... and Crystal Exchange customers
  queueMax: 4,
  serve: 0.45,
  forgeTime: 1.0,       // seconds to polish one gem
  rockEvery: 1.1,       // an obsidian outcrop regrows one rock every ... seconds
  magmaEvery: 1.2,      // the lava vent spits out one magma rock every ... seconds
  magmaBurn: 6,         // carrying magma: one rock burns away every ... seconds
  heatRise: 0.13,       // heat per second near the lava lake (0..1 = overheated)
  flowHeat: 0.75,       // heat per second standing ON a lava flow (eruptions)
  heatCool: 0.18,       // heat lost per second away from the lava
  mistCool: 0.9,        // ... and at the ❄️ MIST station
  heatRange: 7,         // how close to the lava lake counts as "hot"
  plantDrain: 70,       // seconds for a full geothermal plant to run dry
  magmaFill: 0.1,       // one magma rock = this much power
  powerBoost: 0.25,     // powered plant = +25% on ALL cash, in every world
  plantPay: 90,         // ...and it sells power to the grid: this much...
  plantPayEvery: 2.0,   // ...every ... seconds
  tourMin: 5,           // tourists needed to launch a heli tour
  tourMax: 40,
  tourFare: 2.4,        // a heli tour pays this many times a safari ticket
  tourTime: 25,         // seconds the tour helicopter is away
  pilotEvery: 30,       // the Tour Pilot flies a tour (1x) every ... seconds
  rexTameMeat: 24,      // 🍖 it takes to tame the Lava Rex
  rexCarry: 40,
  rexSpeed: 4.6,
  favorDrain: 55,       // seconds for the Fire Queen's favor to run out
  favorPerGem: 0.1,     // one 💎 tribute = this much favor
  crystalEvery: 1.6,    // while she's pleased, the vault gets a crystal every ... seconds
  eruptionEvery: [240, 360] as [number, number], // seconds between eruptions
  eruptionWarning: 12,  // seconds of rumbling first
  eruptionLength: 30,
  bombEvery: 1.7,       // during an eruption, a lava bomb lands near you every ... seconds
  bombRadius: 2.3,
  crewCarry: 14,
  crewSpeed: 5.4,
};

/** Act 4 unlock tiles. Same shape as UNLOCKS. */
export const VOLCANO_UNLOCKS: UnlockDef[] = [
  { id: 'v4-clerk',     name: 'Gem Shop Clerk',     icon: '🛍️', cost: 250000,  pos: [-1, 22],  requires: [] },
  { id: 'v4-miner',     name: 'Obsidian Miner',     icon: '⛏️', cost: 300000,  pos: [-24, 24], requires: [] },
  { id: 'v4-runner',    name: 'Gem Runner',         icon: '💎', cost: 380000,  pos: [-9, 2],   requires: ['v4-miner'] },
  { id: 'v4-plant',     name: 'Geothermal Plant',   icon: '⚡', cost: 550000,  pos: [0, -10],  requires: ['v4-clerk'] },
  { id: 'v4-suit',      name: 'Heat Suit',          icon: '🦺', cost: 450000,  pos: [2, 2],    requires: ['v4-plant'] },
  { id: 'v4-heli',      name: 'Volcano Heli Tours', icon: '🚁', cost: 750000,  pos: [8, 20],   requires: ['v4-plant'] },
  { id: 'v4-pilot',     name: 'Tour Pilot',         icon: '🧑‍✈️', cost: 1000000, pos: [-2, 26], requires: ['v4-heli'] },
  { id: 'v4-lair',      name: 'Lava Rex Lair',      icon: '🦖', cost: 900000,  pos: [-10, -12], requires: ['v4-plant'] },
  { id: 'v4-kingdom',   name: 'Fire Ant Kingdom',   icon: '🐜', cost: 1500000, pos: [20, 2],   requires: ['v4-lair', 'v4-runner'] },
  { id: 'v4-haulers',   name: 'Fire Ant Haulers',   icon: '🔥', cost: 1800000, pos: [28, 18],  requires: ['v4-kingdom'] },
  { id: 'v4-trader',    name: 'Crystal Trader',     icon: '💱', cost: 2100000, pos: [6, 10],   requires: ['v4-kingdom'] },
  { id: 'v4-treasurer', name: 'Personal Assistant', icon: '👩‍💼', cost: 2500000, pos: [-2, 8],   requires: ['v4-trader', 'v4-pilot', 'v4-clerk'] },
  // Opens ACT 5 (the hotel). The hotel is yours for good: eruptions don't reset it.
  { id: 'v4-resort',    name: 'Big Order: Resort',  icon: '🏨', cost: 4000000, pos: [-14, 20], requires: ['v4-treasurer'] },
  { id: 'v4-eruption',  name: 'THE BIG ERUPTION',   icon: '🌋', cost: 6000000, pos: [-8, -30],  requires: ['v4-treasurer', 'v4-haulers'] },
];

// ============================================================================
// PRESTIGE: The Big Eruption. Resets Dino Island + the Volcano (their unlocks
// and your cash) and pays 💎 Obsidian Shards, which buy PERMANENT boosts.
// You keep the colony, the airport, your level, stats and the Queen.
// ============================================================================
export const PRESTIGE = {
  /** Shards for the cash earned since the last eruption: 12 x sqrt(millions). */
  shardsPerSqrtMillion: 12,
  minShards: 5,
};
export interface ShardUpDef {
  id: 'riches' | 'swift' | 'fortune' | 'head' | 'night';
  name: string;
  icon: string;
  per: string;
  max: number;
}
export const SHARD_UPS: ShardUpDef[] = [
  { id: 'riches',  name: 'Obsidian Riches', icon: '💰', per: '+10% on ALL cash',            max: 50 },
  { id: 'swift',   name: 'Lava Legs',       icon: '👟', per: '+6% walk speed',              max: 10 },
  { id: 'fortune', name: 'Lucky Ash',       icon: '🍀', per: 'Better ? gates, fewer losses', max: 10 },
  { id: 'head',    name: 'Head Start',      icon: '🚀', per: '+$100k cash after each eruption', max: 20 },
  { id: 'night',   name: 'Night Shift',     icon: '💤', per: '+10% offline earnings',        max: 5 },
];
/** Shard price of the next level of an upgrade (3, 5, 7, ...). */
export const shardCost = (level: number) => 3 + level * 2;

// ============================================================================
// ACT 5: THE ANTHILL GRAND RESORT (human scale). Everyone your airline flies
// in needs somewhere to stay. The loop:
//   🛎️ FRONT DESK  guests check in (fee) and leave 🧳 luggage on the BAGS cart
//   🛗 ELEVATOR    carry the luggage to the elevator: each bag = a guest in a room
//   🛏️ ROOMS       occupied rooms pay every night; guests check out after a while,
//                  leaving a dirty room + 🧺 laundry down the chute
//   🧺 LAUNDRY     laundry -> WASHERS -> clean 🧻 towels -> LINEN (cleans a room)
//   🍽️ KITCHEN     🥬 groceries -> KITCHEN -> 🍽️ trays -> the BUFFET
//   🏊 POOL & SPA  keep it stocked with towels: the loungers pay
//   ⭐ STARS       clean rooms, a short line and no luggage pile-up = more stars;
//                  stars raise every price and unlock the fancy stuff
// The tower grows a floor (3 more rooms) with every unlock.
// Trouble: complaints, power outages, ants raiding the kitchen, an escaped Dodo.
// Bellhop Dash: a luggage-cart gate run down the hallways for tips.
// ============================================================================
/** Movement speed slider (Settings): how fast everyone walks. 1 = normal. */
export const GAME_SPEED = { min: 0.2, max: 3, step: 0.1, key: 'anthill-airways-speed' };

export const HOTEL_CFG = {
  checkinEvery: 4.5,    // seconds between new guests at the front desk
  queueMax: 5,
  serve: 0.5,
  fee: 150,             // check-in fee per guest (x stars x cash boosts)
  roomsPerFloor: 3,
  baseFloors: 2,        // floors before any unlock (each unlock adds one)
  roomRate: 60,         // each occupied room pays this...
  roomPayEvery: 8,      // ...every ... seconds
  stay: 60,             // average seconds a guest stays before checking out
  laundryPerCheckout: 2,
  elevatorLoad: 4,      // bags per elevator trip
  elevatorBase: 2.5,    // seconds per trip (+ a little per floor)
  washTime: 0.9,        // seconds per towel in the washers
  kitchenTime: 1.1,     // seconds per tray
  groceryEvery: 1.0,    // the pantry restocks one crate every ... seconds
  buffetInterval: 2.2,  // seconds between buffet customers
  poolDrain: 45,        // seconds for a full towel stock to run out
  poolPerTowel: 0.15,
  poolPay: 160,         // the loungers pay this...
  poolPayEvery: 2,      // ...every ... seconds while there are towels
  penthousePay: 900,    // the celebrity penthouse pays this...
  penthouseEvery: 6,    // ...every ... seconds
  bellhopMin: 5,        // bags needed on the cart for a Bellhop Dash
  bellhopTip: 8,        // a dashed bag pays this many times a bag's value
  eventEvery: [70, 120] as [number, number], // seconds between trouble events
  complaintTime: 25,    // seconds to sort out a complaint at the CONCIERGE desk
  outageLength: 35,     // a power outage lasts this long unless you fix it
  fixTime: 2.5,         // seconds standing at the GENERATOR to fix it
  antsLength: 40,       // the kitchen ants leave after this long
  dodoLength: 45,       // the escaped Dodo leaves after this long
  crewCarry: 14,
  crewSpeed: 5.6,
};

/** Act 5 unlock tiles (ids start with h5-; the "h5-starN" ids are star milestones). */
export const HOTEL_UNLOCKS: UnlockDef[] = [
  { id: 'h5-clerk',      name: 'Front Desk Clerk',   icon: '🛎️', cost: 900000,   pos: [-19, -13], requires: [] },
  { id: 'h5-bellhop',    name: 'Bellhop',            icon: '🧳', cost: 1100000,  pos: [-4, -4],   requires: [] },
  { id: 'h5-housekeeper',name: 'Housekeeper',        icon: '🧹', cost: 1300000,  pos: [12, -10],  requires: ['h5-bellhop'] },
  { id: 'h5-dash',       name: 'Bellhop Dash',       icon: '🛒', cost: 1600000,  pos: [-20, 6],   requires: ['h5-bellhop'] },
  { id: 'h5-linen',      name: 'Linen Runner',       icon: '🧻', cost: 1700000,  pos: [14, -2],   requires: ['h5-housekeeper'] },
  { id: 'h5-kitchen',    name: 'Kitchen & Buffet',   icon: '🍽️', cost: 2200000,  pos: [-14, 14],  requires: ['h5-clerk'] },
  { id: 'h5-chef',       name: 'Chef',               icon: '👨‍🍳', cost: 2600000, pos: [-26, 18], requires: ['h5-kitchen'] },
  { id: 'h5-server',     name: 'Buffet Server',      icon: '🥗', cost: 2800000,  pos: [-2, 20],   requires: ['h5-kitchen'] },
  { id: 'h5-waiter',     name: 'Waiter',             icon: '🍽️', cost: 3000000,  pos: [-14, 22],  requires: ['h5-chef'] },
  { id: 'h5-engineer',   name: 'Engineer',           icon: '🔧', cost: 3200000,  pos: [26, -12],  requires: ['h5-kitchen'] },
  { id: 'h5-pool',       name: 'Pool & Spa',         icon: '🏊', cost: 3600000,  pos: [8, 6],     requires: ['h5-linen', 'h5-star3'] },
  { id: 'h5-attendant',  name: 'Pool Attendant',     icon: '🩱', cost: 4200000,  pos: [26, 4],    requires: ['h5-pool'] },
  { id: 'h5-concierge',  name: 'Concierge',          icon: '🎩', cost: 4600000,  pos: [4, -2],    requires: ['h5-pool', 'h5-waiter'] },
  { id: 'h5-assistant',  name: 'Personal Assistant', icon: '👩‍💼', cost: 5200000, pos: [-6, 6],  requires: ['h5-concierge', 'h5-server', 'h5-attendant'] },
  { id: 'h5-penthouse',  name: 'Celebrity Penthouse',icon: '🌟', cost: 7000000,  pos: [0, -8],    requires: ['h5-concierge', 'h5-star4'] },
  { id: 'h5-gala',       name: '5-Star Grand Gala',  icon: '✨', cost: 12000000, pos: [0, 12],    requires: ['h5-penthouse', 'h5-assistant', 'h5-star5'] },
];
