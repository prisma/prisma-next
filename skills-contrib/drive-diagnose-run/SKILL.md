---
name: drive-diagnose-run
description: >
  Reads a Drive trace.jsonl and renders a deterministic diagnostics report.
  Use when you want to measure a Drive run, read a trace, or produce a
  diagnostics report over an emitted Drive trace.
---

# Drive: Diagnose Run

A **deterministic, LLM-free tool** that reads an emitted Drive `trace.jsonl` and renders a structured markdown diagnostics report. It is the read-side counterpart to the **`drive-record-traces`** skill, which owns the trace vocabulary and emission protocol.

## What it is

- `schema.ts` — arktype schemas for all 17 trace-event types. This is a **vendored copy** of the canonical `skills-contrib/drive-record-traces/schema.ts`; the two are kept byte-identical by the `schema-parity` test (divergence fails CI).
- `load.ts` — JSONL loader: parses + validates each line; collects errors with line numbers instead of throwing.
- `metrics.ts` — diagnostic-metric functions over a `TraceEvent[]` (rework rate, brief reissues, spec amendments, plan amendments, I12 halts, tier mix, wall-clock, etc.). Metric names count instability: lower is better, `0` means the artefact held.
- `assertions/` — one checker per Drive invariant (I1–I12), cascade-redesign rule, and brief-discipline anti-pattern; each returns `pass | fail | not-checkable` with evidence refs.
- `report.ts` — markdown dashboard renderer.
- `posthoc.ts` — best-effort reconstruction of trace events from a Cursor transcript JSONL.
- `cli.ts` — entry point.

## Usage

```
node skills-contrib/drive-diagnose-run/cli.ts <trace.jsonl> [--posthoc <transcript>] [--out <output.md>]
```

In this repo, the `pnpm drive:diagnose` shortcut is available:

```
pnpm drive:diagnose <trace.jsonl>
```

## How to read the output

The report leads with three important caveats:

- **Run verdict — "Not computable":** no independent correctness signal, no token instrumentation, no baseline exists yet. All-green metrics mean "no recorded problems", not "verified good".
- **Assertion-coverage headline:** many Drive invariants are not observable from the current trace vocabulary. Unobservable assertions are marked `not-checkable` with a one-line rationale — they count toward named coverage gaps, not pass/fail.
- **Provenance caveat:** `origin: "native"` events are author-asserted (the emitting skill or orchestrator appended them). They are not independently verified. Runs where the orchestrator hand-emitted the trace should be discounted to "reader works, not methodology works".

## Prerequisite (portability)

Requires Node with native TypeScript execution (Node 24+) and the `arktype` package.

In this repo `arktype` is already available via the workspace root `node_modules` — no extra install needed.

In another repo, install it before running:

```
npm install arktype
```

A zero-dependency validator is a possible future improvement; for now `arktype` is the only external dep.

## Relationship to the trace vocabulary

`schema.ts` is a vendored copy of the canonical `skills-contrib/drive-record-traces/schema.ts`, which is the single source of truth for the trace-event vocabulary and emission protocol. Make schema changes in `drive-record-traces`; the `schema-parity` test keeps the two byte-identical and fails CI on divergence.
