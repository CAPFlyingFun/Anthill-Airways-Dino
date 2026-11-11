// ============================================================================
// save.ts — saves progress to the browser (localStorage).
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
  queen: QueenSave;                   // the Queen's own level + stats (she collects cash from Lv 20)
  world: 'ant' | 'air';               // which world you're playing (Act 2 adds the airport)
  airSeen: boolean;                   // seen the airport intro?
  view: 'third' | 'first';            // camera: behind you, or through your eyes
}

export interface QueenSave {
  active: boolean;
  level: number;
  xp: number;
  points: number;
  stats: Record<string, number>;
}

export function newSave(): SaveData {
  return { cash: 0, unlocked: [], paid: {}, tutorial: 0, sound: true, xp: 0, level: 1, points: 0, stats: {}, hatched: 0, queen: { active: false, level: 1, xp: 0, points: 0, stats: {} }, world: 'ant', airSeen: false, view: 'third' };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return newSave();
    // Merge with defaults so older saves still load after we add new fields.
    return { ...newSave(), ...JSON.parse(raw) };
  } catch {
    return newSave();
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(data));
  } catch {
    /* saving is best-effort */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(CONFIG.saveKey);
  } catch {
    /* ignore */
  }
}
