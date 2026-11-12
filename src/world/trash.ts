// ============================================================================
// trash.ts — 🗑️ PAID TRASH (the Queen's old cash job, moved to the bins).
//
// Every piece you dump in a trash bin (any world) pays you:
//   $1 a piece, up to $50 with the colony's 🗑️ TRASH upgrade pad (Lv 10),
//   + 10% per point of the Queen's 🗑️ Royal Bins stat.
// But the bins only take 100 pieces every 5 minutes:
//   • your first piece starts a 5-minute timer ⏱️
//   • after 100 pieces, the bins won't take more until the timer runs out;
//     standing there shows "please wait… 27s"
//   • when the 5 minutes are up, the count starts over (at your next piece)
// The timer is a real clock time, so it keeps counting while the game is closed.
// main.ts calls bindTrash() once; each world's bin calls trash.open / pay / wait.
// ============================================================================
import * as THREE from 'three';
import { SaveData } from '../core/save';
import { QueenProgress } from '../core/progress';
import { bump } from '../core/totals';
import { Hud } from '../ui/hud';

export const TRASH = {
  limit: 100,           // pieces per window
  windowMs: 5 * 60_000, // 5 minutes
  /** $ per piece at each TRASH pad level (0..10). */
  values: [1, 2, 3, 5, 8, 12, 17, 24, 32, 40, 50],
  padId: 'c1-up-trash', // the colony's upgrade pad (not wiped by eruptions)
  padBase: 150,         // its first level's price
};

let save: SaveData | null = null;
let hud: Hud | null = null;
let qp: QueenProgress | null = null;
let pending = 0;      // cash waiting to be shown as one "+$N" float
let floatT = 0;
let waitT = 0;        // throttles the "please wait" banner

export function bindTrash(s: SaveData, h: Hud, q: QueenProgress) {
  save = s;
  hud = h;
  qp = q;
}

/** $ per piece right now (pad level + Royal Bins). */
export function trashValue() {
  if (!save) return 1;
  const lv = save.upgrades[TRASH.padId] ?? 0;
  const royal = 1 + (qp?.stat('speed') ?? 0) * 0.1; // 🗑️ Royal Bins (the Queen's old Royal Stride point)
  return TRASH.values[Math.min(lv, 10)] * royal; // (cents count: $1.20 with 2 Royal Bins points)
}

/** Start a fresh window if the old one ran out. */
function refresh() {
  const t = save!.trash;
  if (t.count > 0 && Date.now() - t.start >= TRASH.windowMs) {
    t.count = 0;
    t.start = 0;
  }
}

/** Seconds until the bins take trash again (0 = open now). */
function waitSecs() {
  refresh();
  const t = save!.trash;
  if (t.count < TRASH.limit) return 0;
  return Math.ceil((t.start + TRASH.windowMs - Date.now()) / 1000);
}

export const trash = {
  /** Will the bins take another piece? */
  open() {
    return !!save && waitSecs() === 0;
  },

  /** A piece just went in: count it and return its pay. Shows "+$N" over the bin. */
  pay(at: THREE.Vector3, camera: THREE.Camera) {
    if (!save) return 0;
    refresh();
    const t = save.trash;
    if (t.count === 0) t.start = Date.now(); // first piece starts the 5-minute timer
    t.count++;
    const v = trashValue();
    bump('trashed');
    bump('trashCash', v);
    pending += v;
    if (floatT <= 0) {
      floatT = 0.35;
      hud?.floatAt(at.clone().setY(at.y + 1), camera, `+$${Math.round(pending)}`, 'gold');
      pending = 0;
    }
    if (t.count === TRASH.limit) hud?.banner('🗑️ The bins are full!', 'They take 100 pieces every 5 minutes', 2400);
    return v;
  },

  /**
   * Every frame: `trying` = you're on a bin with something to dump. If the bins
   * are full, show how long to wait (refreshed every second).
   */
  wait(dt: number, trying: boolean, at: THREE.Vector3, camera: THREE.Camera) {
    floatT -= dt;
    if (floatT <= 0 && pending > 0) {
      hud?.floatAt(at.clone().setY(at.y + 1), camera, `+$${Math.round(pending)}`, 'gold');
      pending = 0;
    }
    waitT -= dt;
    if (!trying || !save || waitT > 0) return;
    const s = waitSecs();
    if (s <= 0) return;
    waitT = 1;
    const time = s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
    hud?.banner('🗑️ Please wait…', `${time} remaining until you can discard more trash`, 1150);
  },
};
