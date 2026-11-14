// ============================================================================
// save.ts — saves progress to the browser (localStorage).
//
// THREE SAVE SLOTS: each is a completely separate game (own cash, levels,
// unlocks). Slot 1 uses the original key, so existing progress is Slot 1.
// Only the slot you're playing earns offline: switching slots pauses the one
// you leave (its "last seen" is cleared), so slots never stack offline income.
// Everything is wrapped in try/catch because private browsing or a full
// disk can make localStorage throw; the game still works, it just won't save.
// ============================================================================
import { CONFIG } from '../data/config';

export interface SaveData {
  cash: number;
  unlocked: string[];                 // ids of unlock tiles already bought
  paid: Record<string, number>;       // partial payments on tiles not finished yet
  tutorial: number;                   // index of the next tutorial hint
  sound: boolean;
  xp: number;                         // XP toward the next level
  level: number;
  points: number;                     // unspent stat points
  stats: Record<string, number>;      // points spent per stat id
  hatched: number;                    // worker ants born in the Hatchery
  queen: QueenSave;                   // the Queen's own level + stats (crowned at Lv 20)
  world: 'ant' | 'air' | 'island' | 'volcano' | 'hotel'; // which world you're playing (Act 2 airport … Act 5 hotel)
  airSeen: boolean;                   // seen the airport intro?
  view: 'third' | 'first';            // camera: behind you, or through your eyes
  lastSeen: number;                   // when the game last saved (ms) -> offline earnings
  rate: number;                       // measured income ($ per second) while playing
  // Prestige (The Big Eruption)
  shards: number;                     // 💎 Obsidian Shards to spend
  eruptions: number;                  // how many times you've erupted the volcano
  shardUps: Record<string, number>;   // levels bought in each shard upgrade
  cycleEarned: number;                // island + volcano cash earned since the last eruption (sets the shard payout)
  // ⬆️ Upgrade pads
  upgrades: Record<string, number>;   // level bought on each upgrade pad (by pad id)
  upPaid: Record<string, number>;     // cash poured into the next level so far
  crewXp: Record<string, number[]>;   // each world's helpers' XP, in hiring order
  totals: Record<string, number>;     // 📊 lifetime stats (cash earned, items sold...)
  trash: { start: number; count: number }; // 🗑️ paid trash: pieces dumped in this 5-min window
  contracts: Record<string, number>;       // 📦 usual load per run type (sets contract goals)
}

export interface QueenSave {
  active: boolean;
  level: number;
  xp: number;
  points: number;
  stats: Record<string, number>;
}

export function newSave(): SaveData {
  return { cash: 0, unlocked: [], paid: {}, tutorial: 0, sound: true, xp: 0, level: 1, points: 0, stats: {}, hatched: 0, queen: { active: false, level: 1, xp: 0, points: 0, stats: {} }, world: 'ant', airSeen: false, view: 'third', lastSeen: 0, rate: 0, shards: 0, eruptions: 0, shardUps: {}, cycleEarned: 0, upgrades: {}, upPaid: {}, crewXp: {}, totals: {}, trash: { start: 0, count: 0 }, contracts: {} };
}

export const SLOTS = [1, 2, 3] as const;
export type Slot = (typeof SLOTS)[number];
const SLOT_KEY = 'anthill-airways-slot';

/** The localStorage key for a slot (slot 1 = the original key). */
function keyFor(slot: Slot) {
  return slot === 1 ? CONFIG.saveKey : `${CONFIG.saveKey}-slot${slot}`;
}

/** The localStorage key of the slot being played. */
export function activeSaveKey() {
  return keyFor(activeSlot());
}

/** Which slot is being played. */
export function activeSlot(): Slot {
  try {
    const n = Number(localStorage.getItem(SLOT_KEY));
    return (SLOTS as readonly number[]).includes(n) ? (n as Slot) : 1;
  } catch {
    return 1;
  }
}

/** Once we're switching slots, nothing more may be written to the old one. */
let locked = false;

/** A slot's headline numbers (for the slot picker); null = empty slot. */
export function slotSummary(slot: Slot) {
  try {
    const raw = localStorage.getItem(keyFor(slot));
    if (!raw) return null;
    const d = { ...newSave(), ...JSON.parse(raw) } as SaveData;
    const act = d.unlocked.includes('h5-open') ? '🏨 Act 5' : d.unlocked.includes('i3-volcano') ? '🌋 Act 4' : d.unlocked.includes('a2-island') ? '🏝️ Act 3' : d.unlocked.includes('expand3') ? '✈️ Act 2' : '🐜 Act 1';
    return { level: d.level, cash: d.cash, act: d.eruptions ? `${act} · 🌋×${d.eruptions}` : act, lastSeen: d.lastSeen };
  } catch {
    return null;
  }
}

/**
 * Save + pause the current slot, then make `slot` the active one. The caller
 * reloads the page to start it. The slot we leave gets no offline earnings
 * for the time spent in other slots.
 */
export function switchSlot(current: SaveData, slot: Slot) {
  try {
    current.lastSeen = 0; // paused: no offline income while you're elsewhere
    localStorage.setItem(keyFor(activeSlot()), JSON.stringify(current));
    localStorage.setItem(SLOT_KEY, String(slot));
  } catch {
    /* ignore */
  }
  locked = true;
}

/** Erase one slot (if it's the one being played, the caller reloads). */
export function eraseSlot(slot: Slot) {
  try {
    localStorage.removeItem(keyFor(slot));
  } catch {
    /* ignore */
  }
  if (slot === activeSlot()) locked = true;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(keyFor(activeSlot()));
    if (!raw) return newSave();
    // Merge with defaults so older saves still load after we add new fields.
    return { ...newSave(), ...JSON.parse(raw) };
  } catch {
    return newSave();
  }
}

export function writeSave(data: SaveData) {
  if (locked) return; // switching slots: don't touch the one we left
  try {
    data.lastSeen = Date.now(); // offline earnings count from the last save
    localStorage.setItem(keyFor(activeSlot()), JSON.stringify(data));
  } catch {
    /* saving is best-effort */
  }
}

/** Reset the slot being played. */
export function clearSave() {
  eraseSlot(activeSlot());
}
