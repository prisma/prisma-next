// Drive trace-event schema — canonical home. Import this from consumers (e.g. drive-diagnose-run) rather than duplicating.
import { type } from 'arktype';

/** UUID v4 string — emit-side assigns a fresh v4; read validator may tighten. */
const uuidV4 = 'string' as const;

const envelopeFields = {
  event_id: uuidV4,
  schema_version: '"1"',
  ts: 'string', // ISO 8601 UTC
  project_run_id: 'string',
  orchestrator_agent_id: 'string | null',
} as const;

export const DispatchStartEvent = type({
  ...envelopeFields,
  event_type: '"dispatch-start"',
  dispatch_id: uuidV4,
  dispatch_name: 'string',
  subagent_type: 'string',
  model: 'string | null',
  parent_dispatch_id: 'string | null',
});

export const DispatchEndEvent = type({
  ...envelopeFields,
  event_type: '"dispatch-end"',
  dispatch_id: uuidV4,
  result: '"completed" | "failed" | "aborted"',
  wall_clock_ms: 'number.integer>=0',
});

export const RoundStartEvent = type({
  ...envelopeFields,
  event_type: '"round-start"',
  dispatch_id: uuidV4,
  round_id: uuidV4,
  round_number: 'number.integer>=1',
});

export const RoundEndEvent = type({
  ...envelopeFields,
  event_type: '"round-end"',
  dispatch_id: uuidV4,
  round_id: uuidV4,
  verdict: '"satisfied" | "another-round-needed" | "escalating-to-user" | "stop-condition"',
  findings_filed: 'number.integer>=0',
  wall_clock_ms: 'number.integer>=0',
});

export const BriefIssuedEvent = type({
  ...envelopeFields,
  event_type: '"brief-issued"',
  dispatch_id: uuidV4,
  round_id: uuidV4,
  brief_byte_length: 'number.integer>=0',
  brief_content_hash: 'string',
  brief_disposition: '"initial" | "reissue" | "amended"',
});

const dispatchSizeDistribution = type({
  S: 'number.integer>=0',
  M: 'number.integer>=0',
  L: 'number.integer>=0',
  XL: 'number.integer>=0',
});

export const SpecAuthoredEvent = type({
  ...envelopeFields,
  event_type: '"spec-authored"',
  spec_path: 'string',
  spec_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  edge_cases_count: 'number.integer>=0 | null',
  open_questions_count: 'number.integer>=0',
  dod_items_count: 'number.integer>=0',
});

export const SpecAmendedEvent = type({
  ...envelopeFields,
  event_type: '"spec-amended"',
  spec_path: 'string',
  spec_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  bytes_delta: 'number.integer',
  edge_cases_count: 'number.integer>=0 | null',
  open_questions_count: 'number.integer>=0',
  dod_items_count: 'number.integer>=0',
  reason:
    '"falsified-assumption" | "new-edge-case" | "scope-shift" | "operator-correction" | "replan-from-discussion"',
  sections_changed: type('string').array(),
});

export const PlanAuthoredEvent = type({
  ...envelopeFields,
  event_type: '"plan-authored"',
  plan_path: 'string',
  plan_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  dispatch_count: 'number.integer>=0 | null',
  slice_count: 'number.integer>=0 | null',
  dispatch_size_distribution: dispatchSizeDistribution.or('null'),
  open_items_count: 'number.integer>=0',
});

export const PlanAmendedEvent = type({
  ...envelopeFields,
  event_type: '"plan-amended"',
  plan_path: 'string',
  plan_kind: '"project" | "slice"',
  byte_length: 'number.integer>=0',
  bytes_delta: 'number.integer',
  dispatch_count: 'number.integer>=0 | null',
  slice_count: 'number.integer>=0 | null',
  dispatch_size_distribution: dispatchSizeDistribution.or('null'),
  open_items_count: 'number.integer>=0',
  reason:
    '"falsified-assumption" | "new-edge-case" | "scope-shift" | "operator-correction" | "replan-from-discussion" | "dispatch-resize" | "dispatch-added" | "dispatch-removed"',
  dispatches_added: 'number.integer>=0 | null',
  dispatches_removed: 'number.integer>=0 | null',
  dispatches_resized: 'number.integer>=0 | null',
});

export const TriageVerdictEvent = type({
  ...envelopeFields,
  event_type: '"triage-verdict"',
  verdict:
    '"direct-change" | "orphan-slice" | "in-project-slice" | "new-project" | "promote" | "demote" | "spike-first" | "defer"',
  input_shape:
    '"linear-ticket" | "chat-ask" | "customer-ask" | "bug-report" | "mid-flight-scope-signal" | "i-should-do-x-thought"',
  input_ref: 'string | null',
});

export const FalsifiedAssumptionEvent = type({
  ...envelopeFields,
  event_type: '"falsified-assumption"',
  artifact_path: 'string',
  triggered_by:
    '"implementer-pushback" | "wip-inspection" | "dispatch-blocked" | "health-check-drift" | "orchestrator-self-detected" | "operator-flagged"',
  assumption_summary: 'string | null',
});

export const ProjectStartedEvent = type({
  ...envelopeFields,
  event_type: '"project-started"',
  project_slug: 'string',
  origin: '"new-project" | "promote"',
  has_linear_project: 'boolean',
});

export const ProjectClosedEvent = type({
  ...envelopeFields,
  event_type: '"project-closed"',
  dod_status: '"all-met" | "some-deferred" | "some-cancelled"',
  slices_completed: 'number.integer>=0',
  final_retro_done: 'boolean',
});

export const SliceStartedEvent = type({
  ...envelopeFields,
  event_type: '"slice-started"',
  slice_slug: 'string',
  slice_index: 'number.integer>=1',
  linear_ref: 'string | null',
});

export const SliceCompletedEvent = type({
  ...envelopeFields,
  event_type: '"slice-completed"',
  slice_slug: 'string',
  result: '"merged" | "abandoned"',
  pr_ref: 'string | null',
});

export const HealthCheckFiredEvent = type({
  ...envelopeFields,
  event_type: '"health-check-fired"',
  cadence:
    '"opening-rollup" | "per-slice-merge" | "closing-rollup" | "session-bookend" | "trigger-fired"',
  drift_signal_count: 'number.integer>=0',
  max_drift_severity: '"none" | "low" | "medium" | "high"',
  recommended_next: 'string | null',
});

export const RetroLandedEvent = type({
  ...envelopeFields,
  event_type: '"retro-landed"',
  trigger_class:
    '"dispatch-failure" | "drift-event" | "scope-shift-escapee" | "wip-inspection-finding" | "operator-flagged-surprise" | "mandatory-final"',
  landing_surfaces: type('"canonical-skill" | "project-context-readme" | "adr"').array(),
  is_mandatory_final: 'boolean',
});

export const Slice1TraceEvent = DispatchStartEvent.or(DispatchEndEvent)
  .or(RoundStartEvent)
  .or(RoundEndEvent)
  .or(BriefIssuedEvent)
  .or(SpecAuthoredEvent)
  .or(SpecAmendedEvent)
  .or(PlanAuthoredEvent)
  .or(PlanAmendedEvent)
  .or(TriageVerdictEvent)
  .or(FalsifiedAssumptionEvent)
  .or(ProjectStartedEvent)
  .or(ProjectClosedEvent)
  .or(SliceStartedEvent)
  .or(SliceCompletedEvent)
  .or(HealthCheckFiredEvent)
  .or(RetroLandedEvent);

export const TraceEvent = Slice1TraceEvent;
export type TraceEvent = typeof Slice1TraceEvent.infer;

export const KNOWN_EVENT_TYPES = [
  'dispatch-start',
  'dispatch-end',
  'round-start',
  'round-end',
  'brief-issued',
  'spec-authored',
  'spec-amended',
  'plan-authored',
  'plan-amended',
  'triage-verdict',
  'falsified-assumption',
  'project-started',
  'project-closed',
  'slice-started',
  'slice-completed',
  'health-check-fired',
  'retro-landed',
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];
