ADR 027 — Error Envelope & Stable Codes

Status

Proposed

Context
	•	Prisma Next spans lanes (DSL, ORM, raw), runtimes, adapters, migrations, and PPg preflight
	•	Users and agents need machine-parsable, stable errors with actionable detail
	•	Today, SQLSTATEs, driver exceptions, lint violations, and budget overages surface inconsistently
	•	We need a single envelope and a stable code registry so policies, dashboards, and retries work uniformly

Decision

Define a canonical RuntimeError envelope and a stable error code registry shared across lanes, runtime, adapters, migrations, and PPg
	•	Errors are returned or thrown only as RuntimeError envelopes
	•	Codes are short, namespaced, immutable once published
	•	Mapping rules translate source errors and policy outcomes into envelopes
	•	Redaction rules ensure messages are safe by default
	•	Severity and policy determine whether an error is blocking or advisory

Error envelope

export type ErrorSeverity = 'error' | 'warn' | 'info'
export type ErrorCategory =
  | 'PLAN'       // Plan construction, validation, hashing
  | 'RUNTIME'    // Execution pipeline and hooks
  | 'ADAPTER'    // Driver, connectivity, protocol, capability
  | 'BUDGET'     // Time/rows/size budgets and EXPLAIN policies
  | 'LINT'       // Guardrail rule violations
  | 'MIGRATION'  // Planner, runner, pre/post checks
  | 'PREFLIGHT'  // CI and PPg preflight
  | 'CONTRACT'   // Contract hash, marker, capability negotiation
  | 'CONFIG'     // Misconfiguration, unsupported options

export interface RuntimeError {
  code: string                 // Stable code, e.g. 'ADAPTER.TIMEOUT'
  category: ErrorCategory
  severity: ErrorSeverity      // 'error' blocks, 'warn' advises, 'info' annotates
  message: string              // Human oriented, redacted
  details?: Record<string, unknown> // Structured, redacted by policy
  cause?: RuntimeErrorCause    // Optional chain for provenance

  // Correlation and context
  planId?: string
  planHash?: string
  sqlFingerprint?: string
  contractHash?: string
  profileHash?: string
  lane?: string                // 'dsl' | 'orm' | 'raw' | external
  ruleId?: string              // For LINT.* codes
  budgetId?: string            // For BUDGET.* codes
  migration?: { edgeId?: string; opId?: string }
  environment?: { project?: string; env?: string; tenantId?: string }

  // Remediation hints
  hints?: string[]             // Short actionable suggestions
  docs?: string[]              // Doc anchors or ADR refs
}

export interface RuntimeErrorCause {
  code?: string                // If source was mapped from a known code
  message?: string
  origin?: 'adapter' | 'driver' | 'engine' | 'db' | 'lane' | 'system'
  sqlState?: string            // For SQL targets
  raw?: unknown                // Redacted by policy
}

Envelope principles
	•	Stable codes and categories support long-lived policies, alerts, and dashboards
	•	Redacted by default for messages and details
	•	Deterministic context fields for correlation and policy routing
	•	No raw SQL or params unless explicitly enabled by secure debug policy

Stable code registry

Format

NAMESPACE.SUBCODE where NAMESPACE ∈ { PLAN, RUNTIME, ADAPTER, BUDGET, LINT, MIGRATION, PREFLIGHT, CONTRACT, CONFIG } and SUBCODE is UPPER_SNAKE_CASE

Core set v1

PLAN
	•	PLAN.INVALID malformed or incomplete Plan
	•	PLAN.UNSUPPORTED lane emitted a Plan the adapter cannot lower
	•	PLAN.HASH_MISMATCH identity conflicts within a pipeline step

RUNTIME
	•	RUNTIME.BACKPRESSURE enqueue timeout or queue cap exceeded
	•	RUNTIME.HOOK_FAILURE plugin threw or returned invalid result
	•	RUNTIME.TIMEOUT statement timeout exceeded
	•	RUNTIME.CANCELLED cancellation propagated

ADAPTER
	•	ADAPTER.CONNECTION_FAILED could not acquire or initialize connection
	•	ADAPTER.TIMEOUT driver or server timeout distinct from runtime timeout
	•	ADAPTER.SYNTAX_ERROR target rejected payload as invalid
	•	ADAPTER.CAPABILITY_MISSING capability required not available
	•	ADAPTER.PREPARE_FAILED prepared statement error or reuse invalidation

BUDGET
	•	BUDGET.TIME_EXCEEDED elapsed time over budget
	•	BUDGET.ROWS_EXCEEDED returned or estimated rows over budget
	•	BUDGET.SIZE_EXCEEDED payload size over budget
	•	BUDGET.EXPLAIN_RISK normalized EXPLAIN indicates risk per policy

LINT
	•	LINT.NO_LIMIT select lacks LIMIT where required
	•	LINT.NO_WHERE_MUTATION mutation lacks WHERE
	•	LINT.SELECT_STAR projection uses *
	•	LINT.UNINDEXED_PREDICATE predicate lacks supporting index

MIGRATION
	•	MIGRATION.PRECHECK_FAILED preconditions not met
	•	MIGRATION.POSTCHECK_FAILED postconditions not satisfied
	•	MIGRATION.IDEMPOTENT_ALREADY_APPLIED safe no-op replay
	•	MIGRATION.CONFLICT state differs in conflicting ways
	•	MIGRATION.NON_TRANSACTIONAL_STEP requires compensation plan

PREFLIGHT
	•	PREFLIGHT.SHADOW_FAILED shadow DB provision or migrate failed
	•	PREFLIGHT.DIAGNOSTIC_TIMEOUT exceeded job budget for diagnostics
	•	PREFLIGHT.INSUFFICIENT_SIGNAL explain-only mode lacks required fields

CONTRACT
	•	CONTRACT.MARKER_MISSING DB not stamped with contract marker
	•	CONTRACT.MARKER_MISMATCH DB marker hash differs from app
	•	CONTRACT.NEGOTIATION_FAILED profile capability negotiation failed

CONFIG
	•	CONFIG.INVALID invalid project or runtime configuration
	•	CONFIG.INCOMPATIBLE_VERSION mismatched lane/runtime/adapter versions

Stability policy
	•	Codes and their semantics are immutable once released
	•	New codes can be added in minor releases
	•	Codes can be deprecated in minor, removed only in major with a crosswalk published
	•	Message text may change but must remain compatible and redacted

Mapping rules

From adapters and databases
	•	Driver errors map to ADAPTER.* using adapter-specific tables
	•	SQLSTATE classification informs subcode and severity where applicable
	•	Adapter attaches cause.origin = 'db' | 'driver' and cause.sqlState for SQL

From budgets and lints
	•	Policy decides whether a rule is warn or error and sets severity accordingly
	•	Violations become LINT.* or BUDGET.* with ruleId or budgetId populated
	•	When severity is warn, runtime continues and attaches the envelope to diagnostics

From migrations and preflight
	•	Runner emits MIGRATION.* with op context and idempotency classification
	•	Preflight emits PREFLIGHT.* with job identifiers and links to artifacts

From runtime pipeline
	•	Queue saturation maps to RUNTIME.BACKPRESSURE
	•	Hook throw maps to RUNTIME.HOOK_FAILURE and includes which hook name
	•	Statement timer expiration maps to RUNTIME.TIMEOUT

Severity and outcomes
	•	error indicates blocking behavior and throws or rejects
	•	warn is advisory and logged or attached to the result diagnostics
	•	info is non-blocking annotation for visibility only
	•	Policy can escalate warn to error per environment or downgrade in incident mode

Redaction and privacy
	•	Envelope messages are safe for logs by default
	•	details must pass through redaction policy before emission
	•	Params and raw SQL are excluded unless a secure debug feature flag is on
	•	Sensitive identifiers may be masked according to contract sensitivity tags

Construction API

import { err } from '@prisma/runtime/errors'

throw err('ADAPTER.TIMEOUT', {
  category: 'ADAPTER',
  message: 'Adapter timeout after 10s',
  severity: 'error',
  details: { elapsedMs: 10023 },
  cause: { origin: 'driver', message: 'socket timeout', sqlState: '57014' },
  planId, planHash, sqlFingerprint, contractHash, profileHash
})

	•	Central factory validates codes and applies redaction
	•	Helpers exist for common maps, e.g. fromSqlState(state, context)
	•	Hooks may return RuntimeError to signal warn without throwing

Versioning and upgrades
	•	The code registry is versioned with the runtime
	•	Adding fields to the envelope is backward compatible
	•	Removing fields or changing code semantics requires a major version
	•	A JSON Schema for the envelope is published for agents and CI

Observability
	•	All envelopes are emitted to telemetry with code, category, severity, and selected context fields
	•	Dashboards group by code and category for SLOs and incident runbooks
	•	Budgets and lints expose top offenders by sqlFingerprint and ruleId

Acceptance criteria
	•	All errors thrown by lanes, runtime, adapters, migrations, and preflight are wrapped in RuntimeError
	•	Stable mapping tables exist for each adapter and are covered by conformance tests
	•	Lint and budget plugins consistently use LINT.* and BUDGET.* codes with severity from policy
	•	PPg services accept and persist envelopes without modification and surface them in UI

Alternatives considered
	•	Propagate native errors and let callers normalize
	•	Fails ecosystem interoperability and breaks policy routing
	•	Single numeric code space
	•	Harder to read and maintain, lacks namespacing for ownership

Open questions
	•	Do we reserve sub-namespaces for community adapters, e.g. ADAPTER.VENDOR_*
	•	Should we include a retryable: boolean hint derived from code and policy
	•	Do we add spanId/traceId fields directly to the envelope or rely on context propagation
