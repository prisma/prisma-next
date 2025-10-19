# ADR 024 — Telemetry schema & privacy

## Context

We need consistent, low-overhead telemetry to understand performance, safety, and usage across lanes and adapters. Telemetry must be privacy-preserving by default and configurable to meet stricter org policies. Agents and PPg benefit from structured signals like sqlFingerprint, budgets, and lint outcomes without exposing SQL text or PII.

## Decision

Define a canonical, lane-agnostic event schema centered on planId and sqlFingerprint:
- Redact parameters by default and only emit type shapes and sizes
- Support configurable sampling, sinks, and retention with safe defaults
- Provide first-class PII controls, including sensitive column masking guided by the data contract

## Event envelope

Common fields across all runtime telemetry events:
- **ts**: ISO timestamp in UTC
- **env**: enum dev|ci|prod
- **service**: logical application name
- **planId**: stable UUID v5 per Plan instance within a process
- **lane**: dsl|orm|typed-sql|raw
- **target**: adapter target postgres|mysql|sqlite|mongo|...
- **contractHash**: core contract hash
- **profileHash**: adapter profile hash
- **sqlFingerprint**: normalized SQL with placeholders, hashed with algorithm and salt id
- **annotations**: subset of Plan annotations deemed safe to emit
- **traceId**: optional distributed trace correlation id

### Notes
- sqlFingerprint is derived from normalized SQL and a per-deployment salt so it groups similar queries without leaking text
- planId is not globally unique across processes but is stable for the lifetime of a Plan in a single runtime

## Event types

### plan.build
Emitted after Plan compilation, before execution:
- **projection**: number of selected fields if known
- **tables**: list of table names from refs
- **columns**: limited set of column refs if allowed
- **lint**: array of violations with ruleId and level
- **budgets**: configured limits present at build time
- **size.sqlBytes**: length of SQL text

### plan.execute
Emitted after execution completes or fails:
- **latency.ms**: end-to-end measured by runtime
- **rows.observed**: number of rows returned or affected if available
- **rows.estimated**: from EXPLAIN if available
- **explain.source**: analyze|plan|heuristic|none
- **budget**: object with rowCount|latency|sqlSize outcome ok|warn|error and headroom
- **result.sizeBytes**: serialized result size if counted
- **error**: structured code from error taxonomy if failed

### plan.explain
Emitted when EXPLAIN is run:
- **duration.ms**: explain call duration
- **estimatedRows**: normalized estimate
- **usedIndexes**: array of index names when exposed by adapter
- **planSummary**: adapter-normalized sketch safe for logging

### plan.error
Emitted on any failure path:
- **code**: stable error code
- **details**: minimal structured payload safe to log
- **phase**: beforeCompile|beforeExecute|afterExecute|onError

## Parameter handling and redaction
- Default is no parameter values in telemetry
- Emit parameter type shapes only, e.g. [{ type: int4 }, { type: text, length: 12 }]
- Emit array lengths and blob sizes but never contents
- Optional opt-in paramSampling can include sampled values only when annotations.intent is introspect and policy allows, with per-key allowlist

## PII and sensitive data controls

### Contract-driven masking
- Columns tagged sensitive: true in the data contract are never emitted in columns lists unless explicitly allowed
- Lanes may mark result fields as sensitive via annotations
- Runtime enforces masking at the telemetry boundary, not just in sinks

### Policy modes
- **privacy**: strict|standard|custom
- **strict** disables planSummary, usedIndexes, and any column names
- **standard** allows table names and index names
- **custom** per-key allowlist and denylist

### Hashing and salts
- sqlFingerprint uses a rotation-capable salt to support periodic rekeying
- Fingerprints are stable within a rotation window and invalidated on rotation

## Sampling

### Dimensions
- Global sampling rate per event type
- Per-lane multipliers to boost or reduce specific lanes
- Burst sampling for errors and budget violations at 100% for a short window

### Defaults
- plan.build 10% in prod, 100% in dev and ci
- plan.execute 5% in prod, 100% in dev and ci
- plan.explain follow EXPLAIN sampling policy
- plan.error 100% always

### Adaptive sampling
- When a query crosses a budget threshold or triggers a lint at error, temporarily lift sampling for that sqlFingerprint for N minutes
- Cap per-minute event volume per process to avoid storms

## Sinks

### Supported sinks
- **console** for dev
- **http** generic JSON POST with retry and backoff
- **otlp** OpenTelemetry exporter for traces and metrics
- **ppg** first-class sink for Prisma Postgres platform

### Delivery
- Async, non-blocking
- Bounded queues with drop policies configurable per severity
- Retry with jittered backoff and circuit breaker

### Schema evolution
- Events carry schemaVersion and adapters enrich with adapterVersion
- Unknown fields must be tolerated by sinks

### Retention and aggregation
- Local buffering size and retention window configurable
- Sinks may aggregate by sqlFingerprint and time window to reduce volume
- PPg can present dashboards for latency distributions, error rates, and budget hits

## Security
- Never log SQL text or parameter values by default
- Encrypt in transit to remote sinks
- Support customer-managed endpoints and keys
- Provide an in-memory drop-in sink for environments where telemetry must be disabled completely

## Configuration

### Example runtime configuration
```typescript
telemetry({
  env: 'prod',
  privacy: 'standard',
  sampling: {
    planBuild: 0.1,
    planExecute: 0.05,
    planError: 1.0,
    perLane: { raw: 0.2, orm: 0.1 }
  },
  sinks: [
    { kind: 'otlp', endpoint: 'https://otel.example.com', apiKey: '...' },
    { kind: 'ppg', projectId: '...', dataset: '...' }
  ],
  pii: {
    allowColumnNames: false,
    allowIndexNames: true,
    paramSampling: { enabled: false }
  },
  fingerprint: {
    algo: 'sha256',
    saltId: '2025-10',
    rotateEveryDays: 90
  }
})
```

## Testing
- Golden tests for event shapes by type and lane with stable field names
- Privacy tests ensure no SQL text or parameter values leak under default settings
- Sampling tests verify target rates over large runs and adaptive escalation on violations
- Sink conformance tests for backpressure and retry behavior

## Consequences

### Positive
- Consistent, lane-agnostic telemetry that agents and PPg can rely on
- Strong privacy defaults reduce risk while preserving operational insight
- Fingerprint-based aggregation enables meaningful dashboards without raw SQL

### Trade-offs
- Fingerprinting and sampling reduce granularity for some investigations
- Strict privacy mode limits detail like index names, which may slow tuning unless explicitly allowed

## Open questions
- Whether to include a result payload size budget separate from latency and row budgets
- Standardizing a minimal planSummary vocabulary across adapters without leaking sensitive structure
- Coordinating fingerprint salt rotation across services in large deployments
