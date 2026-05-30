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

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function countByKey<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = getKey(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

// ---------------------------------------------------------------------------
// Metrics type
// ---------------------------------------------------------------------------

export type DispatchSizeDistribution = { S: number; M: number; L: number; XL: number };

export type Metrics = {
  rework: {
    /** Round-start count per dispatch_id; mean across dispatches. */
    rounds_per_dispatch: { per_dispatch: Record<string, number>; mean: number } | null;
    rounds_per_dispatch_note?: string;
    /** Fraction of dispatches whose round-1 verdict was "satisfied". */
    first_pass_acceptance_rate: number | null;
    first_pass_acceptance_rate_note?: string;
    /** (another-round-needed + stop-condition) / satisfied across all round-end events. */
    backtrack_ratio: number | null;
    backtrack_ratio_note?: string;
    /** Distribution of brief_disposition overall and per dispatch. */
    brief_stability: {
      overall: Record<string, number>;
      per_dispatch: Record<string, Record<string, number>>;
    } | null;
    brief_stability_note?: string;
    /** Distribution of dispatch-start.model. */
    tier_mix: Record<string, number> | null;
    tier_mix_note?: string;
    /** Per-dispatch wall_clock_ms from dispatch-end events; mean and total. */
    dispatch_wallclock_ms: {
      per_dispatch: Record<string, number>;
      mean: number;
      total: number;
    } | null;
    dispatch_wallclock_ms_note?: string;
    /** Per-round wall_clock_ms from round-end events, keyed by round_id. */
    round_wallclock_ms: Record<string, number> | null;
    round_wallclock_ms_note?: string;
  };
  planning_quality: {
    /** Count of spec-amended events + per-path breakdown + reason distribution. Counts instability; lower is better, 0 = the spec never changed after authoring. */
    spec_amendments: {
      count: number;
      per_path: Record<string, number>;
      reason_distribution: Record<string, number>;
    };
    /** Count of plan-amended events + per-path + reason distribution. Counts plan churn; lower is better, 0 = the plan held. */
    plan_amendments: {
      count: number;
      per_path: Record<string, number>;
      reason_distribution: Record<string, number>;
    };
    /** Planned dispatch-size distribution per plan-authored event, labelled by plan path. */
    dispatch_sizes: { plan_path: string; distribution: DispatchSizeDistribution }[];
    /** Count of falsified-assumption events + triggered_by distribution. Counts mid-flight halts; lower is better, 0 = no assumption was falsified. */
    i12_halts: {
      count: number;
      triggered_by_distribution: Record<string, number>;
    };
    /** Per input_ref: count of triage verdicts and distinct verdict count. */
    triage_stability: Record<
      string,
      { count: number; distinct_verdict_count: number; verdicts: string[] }
    > | null;
    triage_stability_note?: string;
  };
  artefact_churn: {
    /** Total writes per artefact path (authored + amended); mean across paths. */
    write_amplification: {
      per_path: Record<string, number>;
      mean: number | null;
      mean_note?: string;
    };
    /** Time from first author to last amend per path (0 when never amended). */
    time_to_stability_ms: { per_path: Record<string, number> };
  };
  lifecycle: {
    /** project-closed.ts − project-started.ts in milliseconds. */
    project_wallclock_ms: number | null;
    project_wallclock_ms_note?: string;
    /** Per-slice duration from slice-started.ts to slice-completed.ts, matched on slice_slug. */
    slice_wallclock_ms: Record<string, number> | null;
    slice_wallclock_ms_note?: string;
    /** Count of health-check-fired events + cadence distribution + max severity. */
    health_check_cadence: {
      count: number;
      cadence_distribution: Record<string, number>;
      max_drift_severity: string | null;
      max_drift_severity_note?: string;
    };
    /** Count of retro-landed events + trigger_class and landing_surfaces distributions. */
    retro_distribution: {
      count: number;
      trigger_class_distribution: Record<string, number>;
      landing_surfaces_distribution: Record<string, number>;
    };
  };
  operator: {
    /** Always null in the native path — no native operator-turn event exists (post-hoc only). */
    operator_turn_count: null;
    operator_turn_count_note: string;
  };
};

// ---------------------------------------------------------------------------
// computeMetrics
// ---------------------------------------------------------------------------

export function computeMetrics(events: TraceEvent[]): Metrics {
  return {
    rework: computeRework(events),
    planning_quality: computePlanningQuality(events),
    artefact_churn: computeArtefactChurn(events),
    lifecycle: computeLifecycle(events),
    operator: {
      operator_turn_count: null,
      operator_turn_count_note: 'post-hoc only — no native operator-turn event exists in slice 1',
    },
  };
}

// ---------------------------------------------------------------------------
// Rework / build-loop
// ---------------------------------------------------------------------------

function computeRework(events: TraceEvent[]): Metrics['rework'] {
  const roundStarts = eventsOfType(events, 'round-start');
  const roundEnds = eventsOfType(events, 'round-end');
  const briefIssueds = eventsOfType(events, 'brief-issued');
  const dispatchStarts = eventsOfType(events, 'dispatch-start');
  const dispatchEnds = eventsOfType(events, 'dispatch-end');

  // --- rounds_per_dispatch ---
  let rounds_per_dispatch: Metrics['rework']['rounds_per_dispatch'] = null;
  let rounds_per_dispatch_note: string | undefined;

  if (roundStarts.length === 0) {
    rounds_per_dispatch_note = 'no round-start events';
  } else {
    const countsMap = new Map<string, number>();
    for (const e of roundStarts) {
      countsMap.set(e.dispatch_id, (countsMap.get(e.dispatch_id) ?? 0) + 1);
    }
    const counts = [...countsMap.values()];
    const total = counts.reduce((a, b) => a + b, 0);
    rounds_per_dispatch = {
      per_dispatch: Object.fromEntries(countsMap),
      mean: total / counts.length,
    };
  }

  // Map round_id → round_number (for first_pass_acceptance_rate computation)
  const roundIdToNumber = new Map<string, number>();
  for (const e of roundStarts) {
    roundIdToNumber.set(e.round_id, e.round_number);
  }

  // --- first_pass_acceptance_rate ---
  let first_pass_acceptance_rate: number | null = null;
  let first_pass_acceptance_rate_note: string | undefined;

  {
    const dispatchToRound1End = new Map<string, (typeof roundEnds)[number]>();
    for (const e of roundEnds) {
      const roundNum = roundIdToNumber.get(e.round_id);
      if (roundNum === 1) {
        dispatchToRound1End.set(e.dispatch_id, e);
      }
    }
    if (dispatchToRound1End.size === 0) {
      first_pass_acceptance_rate_note = 'no round-end events for round 1';
    } else {
      let satisfied = 0;
      for (const [, roundEnd] of dispatchToRound1End) {
        if (roundEnd.verdict === 'satisfied') satisfied++;
      }
      first_pass_acceptance_rate = satisfied / dispatchToRound1End.size;
    }
  }

  // --- backtrack_ratio ---
  let backtrack_ratio: number | null = null;
  let backtrack_ratio_note: string | undefined;

  if (roundEnds.length === 0) {
    backtrack_ratio_note = 'no round-end events';
  } else {
    let satisfiedCount = 0;
    let nonSatisfiedCount = 0;
    for (const e of roundEnds) {
      if (e.verdict === 'satisfied') {
        satisfiedCount++;
      } else if (e.verdict === 'another-round-needed' || e.verdict === 'stop-condition') {
        nonSatisfiedCount++;
      }
    }
    if (satisfiedCount === 0) {
      backtrack_ratio_note = 'no satisfied verdicts — ratio undefined';
    } else {
      backtrack_ratio = nonSatisfiedCount / satisfiedCount;
    }
  }

  // --- brief_stability ---
  let brief_stability: Metrics['rework']['brief_stability'] = null;
  let brief_stability_note: string | undefined;

  if (briefIssueds.length === 0) {
    brief_stability_note = 'no brief-issued events';
  } else {
    const overall = countByKey(briefIssueds, (e) => e.brief_disposition);
    const perDispatchMap = new Map<string, Map<string, number>>();
    for (const e of briefIssueds) {
      let dispMap = perDispatchMap.get(e.dispatch_id);
      if (dispMap === undefined) {
        dispMap = new Map<string, number>();
        perDispatchMap.set(e.dispatch_id, dispMap);
      }
      dispMap.set(e.brief_disposition, (dispMap.get(e.brief_disposition) ?? 0) + 1);
    }
    const per_dispatch: Record<string, Record<string, number>> = {};
    for (const [dispId, dispMap] of perDispatchMap) {
      per_dispatch[dispId] = Object.fromEntries(dispMap);
    }
    brief_stability = { overall, per_dispatch };
  }

  // --- tier_mix ---
  let tier_mix: Record<string, number> | null = null;
  let tier_mix_note: string | undefined;

  if (dispatchStarts.length === 0) {
    tier_mix_note = 'no dispatch-start events';
  } else {
    const mixMap = new Map<string, number>();
    for (const e of dispatchStarts) {
      const model = e.model !== null ? e.model : '(unspecified)';
      mixMap.set(model, (mixMap.get(model) ?? 0) + 1);
    }
    tier_mix = Object.fromEntries(mixMap);
  }

  // --- dispatch_wallclock_ms ---
  let dispatch_wallclock_ms: Metrics['rework']['dispatch_wallclock_ms'] = null;
  let dispatch_wallclock_ms_note: string | undefined;

  if (dispatchEnds.length === 0) {
    dispatch_wallclock_ms_note = 'no dispatch-end events';
  } else {
    let total = 0;
    const perDispatch: Record<string, number> = {};
    for (const e of dispatchEnds) {
      perDispatch[e.dispatch_id] = e.wall_clock_ms;
      total += e.wall_clock_ms;
    }
    dispatch_wallclock_ms = {
      per_dispatch: perDispatch,
      mean: total / dispatchEnds.length,
      total,
    };
  }

  // --- round_wallclock_ms ---
  let round_wallclock_ms: Record<string, number> | null = null;
  let round_wallclock_ms_note: string | undefined;

  if (roundEnds.length === 0) {
    round_wallclock_ms_note = 'no round-end events';
  } else {
    const perRound: Record<string, number> = {};
    for (const e of roundEnds) {
      perRound[e.round_id] = e.wall_clock_ms;
    }
    round_wallclock_ms = perRound;
  }

  return {
    rounds_per_dispatch,
    rounds_per_dispatch_note,
    first_pass_acceptance_rate,
    first_pass_acceptance_rate_note,
    backtrack_ratio,
    backtrack_ratio_note,
    brief_stability,
    brief_stability_note,
    tier_mix,
    tier_mix_note,
    dispatch_wallclock_ms,
    dispatch_wallclock_ms_note,
    round_wallclock_ms,
    round_wallclock_ms_note,
  };
}

// ---------------------------------------------------------------------------
// Planning quality
// ---------------------------------------------------------------------------

function computePlanningQuality(events: TraceEvent[]): Metrics['planning_quality'] {
  const specAmended = eventsOfType(events, 'spec-amended');
  const planAuthored = eventsOfType(events, 'plan-authored');
  const planAmended = eventsOfType(events, 'plan-amended');
  const falsified = eventsOfType(events, 'falsified-assumption');
  const triageVerdicts = eventsOfType(events, 'triage-verdict');

  const spec_amendments = {
    count: specAmended.length,
    per_path: countByKey(specAmended, (e) => e.spec_path),
    reason_distribution: countByKey(specAmended, (e) => e.reason),
  };

  const dispatch_sizes: { plan_path: string; distribution: DispatchSizeDistribution }[] = [];
  for (const e of planAuthored) {
    const dist = e.dispatch_size_distribution;
    if (dist !== null) {
      dispatch_sizes.push({ plan_path: e.plan_path, distribution: dist });
    }
  }

  const plan_amendments = {
    count: planAmended.length,
    per_path: countByKey(planAmended, (e) => e.plan_path),
    reason_distribution: countByKey(planAmended, (e) => e.reason),
  };

  const i12_halts = {
    count: falsified.length,
    triggered_by_distribution: countByKey(falsified, (e) => e.triggered_by),
  };

  let triage_stability: Metrics['planning_quality']['triage_stability'] = null;
  let triage_stability_note: string | undefined;

  if (triageVerdicts.length === 0) {
    triage_stability_note = 'no triage-verdict events';
  } else {
    const byRef = new Map<string, string[]>();
    for (const e of triageVerdicts) {
      const ref = e.input_ref !== null ? e.input_ref : '(none)';
      let verdicts = byRef.get(ref);
      if (verdicts === undefined) {
        verdicts = [];
        byRef.set(ref, verdicts);
      }
      verdicts.push(e.verdict);
    }
    const result: Record<
      string,
      { count: number; distinct_verdict_count: number; verdicts: string[] }
    > = {};
    for (const [ref, verdicts] of byRef) {
      result[ref] = {
        count: verdicts.length,
        distinct_verdict_count: new Set(verdicts).size,
        verdicts,
      };
    }
    triage_stability = result;
  }

  return {
    spec_amendments,
    plan_amendments,
    dispatch_sizes,
    i12_halts,
    triage_stability,
    triage_stability_note,
  };
}

// ---------------------------------------------------------------------------
// Artefact churn
// ---------------------------------------------------------------------------

function computeArtefactChurn(events: TraceEvent[]): Metrics['artefact_churn'] {
  const specAuthored = eventsOfType(events, 'spec-authored');
  const specAmended = eventsOfType(events, 'spec-amended');
  const planAuthored = eventsOfType(events, 'plan-authored');
  const planAmended = eventsOfType(events, 'plan-amended');

  // write_amplification: total writes (authored + amended) per path
  const writeCounts = new Map<string, number>();
  const inc = (path: string): void => {
    writeCounts.set(path, (writeCounts.get(path) ?? 0) + 1);
  };
  for (const e of specAuthored) inc(e.spec_path);
  for (const e of specAmended) inc(e.spec_path);
  for (const e of planAuthored) inc(e.plan_path);
  for (const e of planAmended) inc(e.plan_path);

  const writePaths = Object.fromEntries(writeCounts);
  const meanVal = avg([...writeCounts.values()]);
  const write_amplification: Metrics['artefact_churn']['write_amplification'] =
    meanVal === null
      ? { per_path: writePaths, mean: null, mean_note: 'no spec or plan events' }
      : { per_path: writePaths, mean: meanVal };

  // time_to_stability_ms: first author ts → last amend ts per path (0 when never amended)
  const firstAuthorTs = new Map<string, string>();
  const lastAmendTs = new Map<string, string>();

  const trackFirst = (path: string, ts: string): void => {
    const cur = firstAuthorTs.get(path);
    if (cur === undefined || ts < cur) firstAuthorTs.set(path, ts);
  };
  const trackLast = (path: string, ts: string): void => {
    const cur = lastAmendTs.get(path);
    if (cur === undefined || ts > cur) lastAmendTs.set(path, ts);
  };

  for (const e of specAuthored) trackFirst(e.spec_path, e.ts);
  for (const e of planAuthored) trackFirst(e.plan_path, e.ts);
  for (const e of specAmended) trackLast(e.spec_path, e.ts);
  for (const e of planAmended) trackLast(e.plan_path, e.ts);

  const stabilityPerPath: Record<string, number> = {};
  for (const [path, firstTs] of firstAuthorTs) {
    const lastTs = lastAmendTs.get(path);
    stabilityPerPath[path] = lastTs === undefined ? 0 : Date.parse(lastTs) - Date.parse(firstTs);
  }

  return {
    write_amplification,
    time_to_stability_ms: { per_path: stabilityPerPath },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle / cadence
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

function computeLifecycle(events: TraceEvent[]): Metrics['lifecycle'] {
  // project_wallclock_ms
  const projectStarted = eventsOfType(events, 'project-started');
  const projectClosed = eventsOfType(events, 'project-closed');

  let project_wallclock_ms: number | null = null;
  let project_wallclock_ms_note: string | undefined;

  if (projectStarted.length === 0) {
    project_wallclock_ms_note = 'no project-started event';
  } else if (projectClosed.length === 0) {
    project_wallclock_ms_note = 'no project-closed event';
  } else {
    project_wallclock_ms = Date.parse(projectClosed[0].ts) - Date.parse(projectStarted[0].ts);
  }

  // slice_wallclock_ms
  const sliceStarted = eventsOfType(events, 'slice-started');
  const sliceCompleted = eventsOfType(events, 'slice-completed');

  let slice_wallclock_ms: Record<string, number> | null = null;
  let slice_wallclock_ms_note: string | undefined;

  if (sliceStarted.length === 0 && sliceCompleted.length === 0) {
    slice_wallclock_ms_note = 'no slice-started or slice-completed events';
  } else {
    const startBySlug = new Map<string, string>();
    for (const e of sliceStarted) startBySlug.set(e.slice_slug, e.ts);

    const perSlice: Record<string, number> = {};
    for (const e of sliceCompleted) {
      const startTs = startBySlug.get(e.slice_slug);
      if (startTs !== undefined) {
        perSlice[e.slice_slug] = Date.parse(e.ts) - Date.parse(startTs);
      }
    }
    slice_wallclock_ms = perSlice;
  }

  // health_check_cadence
  const healthChecks = eventsOfType(events, 'health-check-fired');

  let max_drift_severity: string | null = null;
  let max_drift_severity_note: string | undefined;

  if (healthChecks.length === 0) {
    max_drift_severity_note = 'no health-check-fired events';
  } else {
    let maxRank = -1;
    for (const e of healthChecks) {
      const rank = SEVERITY_RANK[e.max_drift_severity] ?? 0;
      if (rank > maxRank) {
        maxRank = rank;
        max_drift_severity = e.max_drift_severity;
      }
    }
  }

  const health_check_cadence: Metrics['lifecycle']['health_check_cadence'] = {
    count: healthChecks.length,
    cadence_distribution: countByKey(healthChecks, (e) => e.cadence),
    max_drift_severity,
    max_drift_severity_note,
  };

  // retro_distribution
  const retroLanded = eventsOfType(events, 'retro-landed');

  const landingSurfacesMap = new Map<string, number>();
  for (const e of retroLanded) {
    for (const surface of e.landing_surfaces) {
      landingSurfacesMap.set(surface, (landingSurfacesMap.get(surface) ?? 0) + 1);
    }
  }

  const retro_distribution: Metrics['lifecycle']['retro_distribution'] = {
    count: retroLanded.length,
    trigger_class_distribution: countByKey(retroLanded, (e) => e.trigger_class),
    landing_surfaces_distribution: Object.fromEntries(landingSurfacesMap),
  };

  return {
    project_wallclock_ms,
    project_wallclock_ms_note,
    slice_wallclock_ms,
    slice_wallclock_ms_note,
    health_check_cadence,
    retro_distribution,
  };
}
