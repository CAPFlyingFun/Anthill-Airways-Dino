// ============================================================================
// departures.ts — the ✈️ DEPARTURES BOARD: where your colony is headed.
//
// A small "🛫 Next:" chip under the zone name shows your next big stop and how
// close you are. Tap it for the full flip-board: every stop on the route,
// DEPARTED ✅ / NEXT / LATER. Later stops still show their names (a tease:
// sell snacks -> run an airline -> dinosaurs!).
// Each stop is reached by buying its "Big Order" unlock tile.
// ============================================================================
import { AIR_UNLOCKS, ISLAND_UNLOCKS, UNLOCKS, UnlockDef, VOLCANO_UNLOCKS } from '../data/config';

interface Stop {
  id: string;     // the Big Order unlock that gets you there
  also?: string;  // another id that also counts as "been there" (the resort stays after eruptions)
  icon: string;
  name: string;
  where: string;  // which world that Big Order tile is in
}

export const ROUTE: Stop[] = [
  { id: 'expand', icon: '🕳️', name: 'Tunnels', where: 'the Nest Entrance' },
  { id: 'expand2', icon: '🛩️', name: 'Hangar', where: 'the Tunnels' },
  { id: 'expand3', icon: '✈️', name: 'Airport', where: 'the Hangar' },
  { id: 'a2-island', icon: '🦖', name: 'Dino Island', where: 'the Airport' },
  { id: 'i3-volcano', icon: '🌋', name: 'Mount Anthill', where: 'Dino Island' },
  { id: 'v4-resort', also: 'h5-open', icon: '🏨', name: 'Grand Resort', where: 'the Volcano' },
];

const ALL: UnlockDef[] = [...UNLOCKS, ...AIR_UNLOCKS, ...ISLAND_UNLOCKS, ...VOLCANO_UNLOCKS];
const def = (id: string) => ALL.find((d) => d.id === id);

export interface BoardRow {
  stop: Stop;
  status: 'departed' | 'next' | 'later';
  /** For the NEXT stop: "Big Order: Hangar (in the Tunnels) · $3,500". */
  detail?: string;
  /** For the NEXT stop: steps done before its Big Order can be bought. */
  ready?: number;
  steps?: number;
  /** For the NEXT stop: 🔒 the player level its Big Order needs (if not reached yet). */
  needLevel?: number;
}

/** The board's rows for this save's unlocks. */
export function departures(unlocked: string[], level = Infinity): BoardRow[] {
  const has = (id?: string) => !!id && unlocked.includes(id);
  let nextFound = false;
  return ROUTE.map((stop) => {
    if (has(stop.id) || has(stop.also)) return { stop, status: 'departed' };
    if (nextFound) return { stop, status: 'later' };
    nextFound = true;
    const d = def(stop.id);
    const req = d?.requires ?? [];
    const ready = req.filter((r) => unlocked.includes(r)).length;
    const detail = d ? `${d.name} (at ${stop.where}) · $${d.cost.toLocaleString()}${d.level ? ` · Lv ${d.level}` : ''}` : '';
    const needLevel = d?.level && level < d.level ? d.level : undefined;
    return { stop, status: 'next', detail, ready, steps: req.length, needLevel };
  });
}

/** The chip's text ("🛫 Next: Hangar · 2/4 ready"), or null when the whole route is done. */
export function nextChip(unlocked: string[], level = Infinity) {
  const next = departures(unlocked, level).find((r) => r.status === 'next');
  if (!next) return null;
  const allReady = next.ready === next.steps;
  const status = !allReady ? `${next.ready}/${next.steps} steps` : next.needLevel ? `🔒 reach Lv ${next.needLevel}` : 'Big Order ready!';
  return `🛫 Next: ${next.stop.icon} ${next.stop.name} · ${status}`;
}
