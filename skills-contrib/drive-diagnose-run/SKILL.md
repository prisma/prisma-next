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

- arktype schemas — imported directly from the canonical `skills-contrib/drive-record-traces/schema.ts` (the single source of truth for the trace-event vocabulary).
- `load.ts` — JSONL loader: parses + validates each line; collects errors with line numbers instead of throwing.
- `metrics.ts` — diagnostic-metric functions over a `TraceEvent[]` (rework rate, brief reissues, spec amendments, plan amendments, I12 halts, tier mix, wall-clock, etc.). Metric names count instability: lower is better, `0` means the artefact held.
- `scorecard.ts` — the two-tier scorecard over a `TraceEvent[]`: a per-run Tier-1 correctness verdict (from the external `correctness-recorded` feed) and the Tier-2 token totals (from the per-run `tokens-recorded` feed). The headline of the report.
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

The report leads with the **two-tier scorecard** and these caveats:

- **Scorecard — Tier 1 (correctness) then Tier 2 (efficiency).** Tier 1 is a binary correctness gate sourced from outside the run (the `correctness-recorded` feed: mechanical gates + QA run + judge intent). With no correctness signal, the run verdict reads **`not computable`** and names the missing input — all-green metrics never imply "good". Tier 2 (tokens from the `tokens-recorded` feed, plus wall-clock and rework) is rendered only over runs that passed Tier 1; absent token figures render `n/a (no signal)`.
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

`drive-diagnose-run` imports schemas directly from the canonical `skills-contrib/drive-record-traces/schema.ts`, which is the single source of truth for the trace-event vocabulary and emission protocol. Schema changes go in `drive-record-traces`.
