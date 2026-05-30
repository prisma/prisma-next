import type { TraceEvent } from '../drive-record-traces/schema.ts';

// Narrows the event union to the events of the requested type using a type
// predicate, so no bare `as` cast is needed at call sites.
function eventsOfType<T extends TraceEvent['event_type']>(
  events: TraceEvent[],
  eventType: T,
): Extract<TraceEvent, { event_type: T }>[] {
  return events.filter(
    (e): e is Extract<TraceEvent, { event_type: T }> => e.event_type === eventType,
  );
}

export type CorrectnessComponent = 'pass' | 'fail' | null;
export type RunVerdict = 'correct' | 'incorrect' | 'not-computable';

export type RunTokens = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
};

export type RunCorrectness = {
  mechanical: CorrectnessComponent;
  qa: CorrectnessComponent;
  intent: CorrectnessComponent;
};

export type RunScore = {
  run_id: string;
  /** The recorded correctness components, or null when no signal was recorded for this run. */
  correctness: RunCorrectness | null;
  verdict: RunVerdict;
  /** Named missing inputs when the verdict is not-computable; empty otherwise. */
  missing_inputs: string[];
  tokens: RunTokens | null;
};

export type Scorecard = {
  /** One entry per project_run_id, in first-seen order. */
  runs: RunScore[];
  /** Run IDs whose verdict is CORRECT. */
  correct_run_ids: string[];
  /** Token totals summed over CORRECT runs; a component is null when no correct run recorded it. */
  correct_tokens: RunTokens;
  /** True when at least one correctness-recorded event exists in the trace. */
  has_any_correctness_signal: boolean;
};

const NO_SIGNAL_MISSING_INPUT = 'external correctness signal (no `correctness-recorded` event)';

function classify(correctness: RunCorrectness | null): {
  verdict: RunVerdict;
  missing_inputs: string[];
} {
  if (correctness === null) {
    return { verdict: 'not-computable', missing_inputs: [NO_SIGNAL_MISSING_INPUT] };
  }
  const missing: string[] = [];
  if (correctness.mechanical === null) missing.push('mechanical');
  if (correctness.qa === null) missing.push('qa');
  if (correctness.intent === null) missing.push('intent');
  if (missing.length > 0) {
    return { verdict: 'not-computable', missing_inputs: missing };
  }
  const allPass =
    correctness.mechanical === 'pass' && correctness.qa === 'pass' && correctness.intent === 'pass';
  return { verdict: allPass ? 'correct' : 'incorrect', missing_inputs: [] };
}

function sumComponent(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

export function computeScorecard(events: TraceEvent[]): Scorecard {
  const correctnessEvents = eventsOfType(events, 'correctness-recorded');
  const tokensEvents = eventsOfType(events, 'tokens-recorded');

  // Last write wins per run, matching append-only "latest recorded" semantics.
  const correctnessByRun = new Map<string, RunCorrectness>();
  for (const e of correctnessEvents) {
    correctnessByRun.set(e.project_run_id, {
      mechanical: e.mechanical,
      qa: e.qa,
      intent: e.intent,
    });
  }
  const tokensByRun = new Map<string, RunTokens>();
  for (const e of tokensEvents) {
    tokensByRun.set(e.project_run_id, {
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      cache_read_tokens: e.cache_read_tokens,
      cache_write_tokens: e.cache_write_tokens,
    });
  }

  const runOrder: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!seen.has(e.project_run_id)) {
      seen.add(e.project_run_id);
      runOrder.push(e.project_run_id);
    }
  }

  const runs: RunScore[] = runOrder.map((run_id) => {
    const correctness = correctnessByRun.get(run_id) ?? null;
    const { verdict, missing_inputs } = classify(correctness);
    return {
      run_id,
      correctness,
      verdict,
      missing_inputs,
      tokens: tokensByRun.get(run_id) ?? null,
    };
  });

  const correctRuns = runs.filter((r) => r.verdict === 'correct');
  const correct_run_ids = correctRuns.map((r) => r.run_id);

  const correctTokenRecords = correctRuns
    .map((r) => r.tokens)
    .filter((t): t is RunTokens => t !== null);

  const correct_tokens: RunTokens = {
    input_tokens: sumComponent(correctTokenRecords.map((t) => t.input_tokens)),
    output_tokens: sumComponent(correctTokenRecords.map((t) => t.output_tokens)),
    cache_read_tokens: sumComponent(correctTokenRecords.map((t) => t.cache_read_tokens)),
    cache_write_tokens: sumComponent(correctTokenRecords.map((t) => t.cache_write_tokens)),
  };

  return {
    runs,
    correct_run_ids,
    correct_tokens,
    has_any_correctness_signal: correctnessEvents.length > 0,
  };
}
