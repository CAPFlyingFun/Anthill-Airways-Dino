// ============================================================================
// income.ts — AUTOMATED income meter.
//
// Idle / offline earnings must only be based on money that arrives WITHOUT
// you: the Queen collecting cash, an assistant at the airport, and so on.
// Bills you pick up yourself don't count (you won't be there while you're away).
//
// Anything that collects cash on its own calls `autoCash(amount)`.
// main.ts reads and clears `income.auto` every frame to build the +$/min rate.
// ============================================================================
export const income = { auto: 0 };

/** Call when an automated helper (Queen, assistant...) collects `amount` cash. */
export function autoCash(amount: number) {
  if (amount > 0) income.auto += amount;
}
