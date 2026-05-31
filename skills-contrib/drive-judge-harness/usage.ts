// Per-run token accumulation from the SDK's turn-ended usage updates.
//
// The Cursor SDK reports per-turn usage on `TurnEndedUpdate.usage` with
// `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens`. This
// module is the pure, SDK-agnostic accumulator: the run loop feeds it the usage
// objects it observes, and it sums them into a per-run total. Keeping it pure
// (no SDK import) is what lets the harness's token logic be unit-tested without
// a live call.

/** One turn's usage as observed from the stream. Fields are optional/nullable
 *  because a given update may omit a counter; missing counters contribute 0. */
export type TurnUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

/** Accumulated per-run token totals. `totalTokens` is the sum of the four. */
export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

export function emptyTotals(): TokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

function coerce(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Sum a run's turn-ended usage updates into a single TokenTotals. Missing or
 *  non-finite counters are treated as 0. */
export function accumulateUsage(updates: readonly TurnUsage[]): TokenTotals {
  const totals = emptyTotals();
  for (const u of updates) {
    totals.inputTokens += coerce(u.inputTokens);
    totals.outputTokens += coerce(u.outputTokens);
    totals.cacheReadTokens += coerce(u.cacheReadTokens);
    totals.cacheWriteTokens += coerce(u.cacheWriteTokens);
  }
  totals.totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return totals;
}
