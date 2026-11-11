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
}

export function newSave(): SaveData {
  return { cash: 0, unlocked: [], paid: {}, tutorial: 0, sound: true };
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
