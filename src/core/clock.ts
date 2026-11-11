// ============================================================================
// clock.ts — real time vs game time.
//
// The game caps each frame's time step (so a lag spike can't teleport
// anyone). On a struggling phone that makes GAME time run slower than REAL
// time. Paying for things should never feel slower, so cash pouring into
// unlock tiles and upgrade pads multiplies its step by `clock.scale`
// (real seconds / game seconds this frame; 1 when the phone keeps up).
// It ignores the Movement speed slider entirely.
// ============================================================================
export const clock = { scale: 1 };

/** main.ts calls this every frame with the real frame time + the capped step. */
export function tickClock(realSecs: number, cappedSecs: number) {
  clock.scale = cappedSecs > 0 ? Math.min(5, Math.min(0.25, realSecs) / cappedSecs) : 1;
}
