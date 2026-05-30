---
name: drive-judge-harness
description: >
  Spawns one Drive orchestrator run on a golden-case brief with a pinned model,
  accumulates per-run token usage, and writes a run manifest — the corpus
  generator the Drive LLM judge calibrates against. Use when you want to run a
  golden Drive brief end-to-end, produce a natively-instrumented run, accumulate
  token usage from the Cursor SDK, or validate the post-hoc trace parser against
  a transcript corpus. Live execution is gated behind --live + CURSOR_API_KEY;
  the default is a dry-run that makes no live call.
---

# Drive: Judge harness (run-one-brief)

A **minimal live harness** that runs ONE canonical Drive brief through an
orchestrator and records the run. It is the read/produce-side counterpart to the
golden-case library under `projects/drive-judge-harness/assets/golden/`: the
library supplies the briefs + acceptance sets + pre-written QA plans; this
harness spawns the run that produces the natively-instrumented trace the LLM
judge (TML-2736) later calibrates against, and the experiment engine (TML-2737)
builds the k=N A/B loop on top of.

## What it is

- `load-brief.ts` — loads a golden case (`case.json` metadata + `brief.md`).
- `usage.ts` — `accumulateUsage(updates)`: pure accumulation of the four SDK
  token counters (`inputTokens` / `outputTokens` / `cacheReadTokens` /
  `cacheWriteTokens`) into a per-run `TokenTotals`.
- `manifest.ts` — `RunManifest` + `writeManifest`: the per-run record (status,
  model, run/agent ids, accumulated `tokens`, trace path).
- `run-one-brief.ts` — `runOneBrief(config, deps)` + a CLI. Owns the
  live-execution gate and orchestration.
- `sdk-adapter.ts` — the **only** module that touches `@cursor/sdk`, via a
  dynamic import reached solely on the live path.
- `validate-parser.ts` — validates `drive-diagnose-run/posthoc.ts` over a
  transcript corpus, tallying reconstruction confidence (clears TML-2728).

## The live-execution gate (safety property)

A live run requires **both** `--live` **and** a present `CURSOR_API_KEY`.
Otherwise the harness takes the **dry-run** path: it never imports `@cursor/sdk`,
never makes a network call, and writes a manifest with `status: "dry-run"`,
`tokens: null`. Because the SDK is reached only through `sdk-adapter.ts`'s
dynamic import on the live path, **typecheck / test / lint / CI all stay green
with no `CURSOR_API_KEY` set and `@cursor/sdk` not installed.** Tests inject a
mock `createAgent` and never make a live call.

## Usage

Dry-run (safe; the default — proves the wiring without a live call):

```bash
node skills-contrib/drive-judge-harness/run-one-brief.ts \
  --case projects/drive-judge-harness/assets/golden/slice-cli-list-flag \
  --model claude-4.6-sonnet-high-thinking \
  --trace-file wip/drive-trace/golden-slice-cli-list-flag.jsonl \
  --manifest-file wip/drive-trace/golden-slice-cli-list-flag.run.json
```

In this repo, `pnpm drive:run-brief -- <args>` is the shortcut.

Live run (operator-gated — see "Live execution prerequisites"):

```bash
CURSOR_API_KEY=cursor_... node skills-contrib/drive-judge-harness/run-one-brief.ts \
  --case projects/drive-judge-harness/assets/golden/slice-cli-list-flag \
  --model claude-4.6-sonnet-high-thinking --live \
  --trace-file ... --manifest-file ...
```

Validate the post-hoc parser over a transcript corpus:

```bash
node skills-contrib/drive-judge-harness/validate-parser.ts <transcript.jsonl>...
# or: pnpm drive:validate-parser -- <transcript.jsonl>...
```

## Live execution prerequisites (operator-gated)

Two gates, both owned by the operator, neither needed for dry-run / tests / CI:

1. **`CURSOR_API_KEY`** — a Cursor user or service-account key.
2. **`@cursor/sdk` admitted to the lockfile.** `pnpm add @cursor/sdk` currently
   fails the repo's `trustPolicy: no-downgrade` guard on a transitive
   `undici@5.29.0` (an earlier version had provenance attestation this one
   lacks). The documented escape hatch is a `trustPolicyExclude` entry in
   `pnpm-workspace.yaml` (as already exists for `chokidar` / `evlog` /
   `semver`). Admitting a supply-chain-flagged package is an operator decision;
   the harness ships fully functional in dry-run/mock form until then.

## The token signal and its transitional home

`accumulateUsage` sums the SDK's per-turn usage into a `TokenTotals`. The
canonical trace `tokens` field is owned by a sibling slice (TML-2720, which owns
`drive-record-traces/schema.ts`) and does not exist yet, so the fail-closed
emitter would reject a trace line carrying it. Until that schema field lands,
the harness records the totals in the **run manifest** beside the trace. When the
`tokens` trace field exists, the manifest's `tokens` migrates into the validated
trace via the emitter. The spawned orchestrator self-instruments its Drive
methodology events into `--trace-file` via `drive-record-traces`; the harness
owns only the token manifest.

## Relationship to the rest of the cluster

- **Golden-case library** (`projects/drive-judge-harness/assets/golden/`) — the
  briefs/acceptance/QA this harness runs.
- **`drive-record-traces`** — the trace vocabulary the spawned run emits into.
- **`drive-diagnose-run`** — reads the produced trace; `posthoc.ts` is validated
  by `validate-parser.ts`.
