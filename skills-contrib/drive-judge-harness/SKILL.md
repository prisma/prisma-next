---
name: drive-judge-harness
description: >
  Spawns one Drive orchestrator run on a golden-case brief with a pinned model,
  accumulates per-run token usage, and writes a run manifest — the corpus
  generator the Drive LLM judge calibrates against. Supports a pinned skill-bundle
  input (prepare-run → spawn → collect-run) so runs are reproducible against a
  known base ref + skill version. Use when you want to run a golden Drive brief
  end-to-end, produce a natively-instrumented run, accumulate token usage from the
  Cursor SDK, or validate the post-hoc trace parser against a transcript corpus.
  Live execution is gated behind --live + CURSOR_API_KEY; the default is a dry-run
  that makes no live call.
---

# Drive: Judge harness (run-one-brief / run-arm)

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
  model, run/agent ids, accumulated `tokens`, trace path, and the pinned-input
  fields added by `run-arm`).
- `prepare-run.ts` — `prepareRun(config, deps)`: isolate a git checkout at a
  pinned base ref, overlay the skill bundle's canonical home dirs (`skills-contrib`,
  `.agents/rules`, `AGENTS.md`, `CLAUDE.md`), materialize via the repo's `prepare`
  hook, and finalize a baseline commit so the agent's diff is cleanly separable
  from the injected skills.
- `collect-run.ts` — `collectRun(prepared, opts)`: glob `*.jsonl` in the run
  dir, keep those whose first line validates against the trace schema, match by
  `orchestrator_agent_id` (falling back to newest), and compute `diff`/`diffStat`
  against the baseline commit.
- `run-arm.ts` — thin CLI + `runArm(config, deps)` that composes the full
  pipeline: `prepareRun → runOneBrief({ runDir }) → collectRun → write enriched
  manifest`. The enriched manifest carries `base_ref`, `base_sha`,
  `skill_bundle_ref`, `skill_bundle_sha`, `run_dir`, `collected_trace_paths`,
  `diff_stat`, and `materialized`.
- `run-one-brief.ts` — `runOneBrief(config, deps)` + a CLI. Owns the
  live-execution gate and orchestration. Accepts `runDir` so the orchestrator
  spawns inside the prepared checkout.
- `sdk-adapter.ts` — the **only** module that touches `@cursor/sdk`, via a
  dynamic import reached solely on the live path. Uses the `cwd` passed from
  `run-one-brief` rather than the harness's `process.cwd()`.
- `validate-parser.ts` — validates `drive-diagnose-run/posthoc.ts` over a
  transcript corpus, tallying reconstruction confidence (clears TML-2728).
- `judge/` — the bespoke-minimal LLM judge (TML-2736). Grades one Drive run
  from its diff + acceptance set + trace excerpts and emits the `intent`
  correctness component the scorecard already reads. See § The LLM judge below.

## The live-execution gate (safety property)

A live run requires **both** `--live` **and** a present `CURSOR_API_KEY`.
Otherwise the harness takes the **dry-run** path: it never imports `@cursor/sdk`,
never makes a network call, and writes a manifest with `status: "dry-run"`,
`tokens: null`. Because the SDK is reached only through `sdk-adapter.ts`'s
dynamic import on the live path, **typecheck / test / lint / CI all stay green
with no `CURSOR_API_KEY` set and `@cursor/sdk` not installed.** Tests inject a
mock `createAgent` and never make a live call.

## The pinned skill-bundle pipeline (run-arm)

`run-arm` makes a run **reproducible**: the skill bundle under test (a git ref of
`skills-contrib/` + `.agents/rules/` + `AGENTS.md`/`CLAUDE.md`) becomes a
first-class recorded input alongside the base ref and model. An A/B arm is
expressible as `(brief + base_sha, model, skill_bundle_ref)` with one axis varied.

Steps:

1. **Isolate**: `git worktree add --detach <runDir> <baseRef>` — a detached
   worktree that shares the object store; `--detach` removes the branch-conflict
   limitation so parallel arms on the same base work.
2. **Overlay**: `git archive <bundleRef> -- skills-contrib .agents/rules AGENTS.md CLAUDE.md | tar -x -C <runDir>` — the skill bundle's canonical dirs are extracted over the base checkout.
3. **Materialize**: the repo's own `prepare` hook (`pnpm install`) regenerates
   the gitignored `.cursor/`/`.claude/`/`.agents/skills/` trees. If it fails
   against an old toolchain, `materialized: false` is recorded (the case is not
   replayable) rather than silently mis-instrumented.
4. **Baseline commit**: `git add -A && git commit -m 'prepare-run baseline'` —
   the cut point. Everything injected lives in this commit, so `collect-run`'s
   diff is exactly the agent's work.
5. **Spawn**: `runOneBrief({ runDir })` executes the orchestrator inside the
   prepared checkout.
6. **Collect**: `collectRun` globs `*.jsonl` in `runDir`, validates the first
   line of each against the trace schema, and computes the agent diff against
   the baseline commit.

Usage (dry-run — proves the pipeline without a live call):

```bash
pnpm drive:run-arm -- \
  --repo . --base-ref main --bundle-ref HEAD \
  --run-dir /tmp/my-run \
  --case projects/drive-judge-harness/assets/golden/slice-dedupe-generated-imports \
  --model claude-4.6-sonnet-high-thinking
```

Live run (operator-gated):

```bash
CURSOR_API_KEY=cursor_... pnpm drive:run-arm -- \
  --repo . --base-ref <historical-sha> --bundle-ref HEAD \
  --run-dir /tmp/my-run \
  --case projects/drive-judge-harness/assets/golden/slice-dedupe-generated-imports \
  --model claude-4.6-sonnet-high-thinking --live
```

## Usage

Dry-run (safe; the default — proves the wiring without a live call):

```bash
node skills-contrib/drive-judge-harness/run-one-brief.ts \
  --case projects/drive-judge-harness/assets/golden/slice-dedupe-generated-imports \
  --model claude-4.6-sonnet-high-thinking \
  --trace-file wip/drive-trace/golden-slice-dedupe-generated-imports.jsonl \
  --manifest-file wip/drive-trace/golden-slice-dedupe-generated-imports.run.json
```

In this repo, `pnpm drive:run-brief -- <args>` is the shortcut.

Live run (operator-gated — see "Live execution prerequisites"):

```bash
CURSOR_API_KEY=cursor_... node skills-contrib/drive-judge-harness/run-one-brief.ts \
  --case projects/drive-judge-harness/assets/golden/slice-dedupe-generated-imports \
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

**Tokens are unavailable for local runs.** The `@cursor/sdk` *local* runtime
emits no per-turn usage events at all — no `turnEnded`, and nothing in the run
outcome, the `getRun`/`V1Run` cloud query, or the `analytics` surface carries
token counts (confirmed by the spike at
`projects/drive-judge-harness/spikes/2026-05-31-sdk-token-usage-retrieval.md`,
and see KNOWN-ISSUES.md). So `tokens` is honestly `null` for local runs, with a
note recorded on the manifest. **Wall-clock (`wall_clock_ms`, from the run
outcome's `durationMs`) is therefore the primary Tier-2 efficiency metric.** A
future token source would have to come from outside the SDK (a Cursor
admin/usage API, or CLI-internal telemetry); `accumulateUsage` stays wired so the
signal flows automatically if the cloud runtime (which *does* stream usage) is
used, or once a local source exists.

## The LLM judge (`judge/`)

A bespoke-minimal grader that turns the run's artifacts (diff + golden
`acceptance.md` + relevant `trace.jsonl` excerpts) into the `intent`
correctness component the scorecard reads. Four pieces, all mock-friendly:

- `judge/judge-model.ts` — the `JudgeModel` interface (`grade(prompt) ->
  Promise<string>`), injected into every prompt-set module. Tests pass a mock
  that returns canned structured text; no real-dollar call happens in tests /
  typecheck / lint / CI.
- `judge/judge-model-sdk.ts` — the live `@cursor/sdk` adapter. Pins a
  cross-family judge model id (default `gpt-5.5` against today's Claude
  orchestrator) and **rejects a same-family judge id at construction** — so a
  same-family grading mistake fails fast, before any SDK call. The SDK is
  loaded lazily inside `grade()` so module load stays green without
  `@cursor/sdk` installed and without `CURSOR_API_KEY`.
- `judge/rubric-correctness.ts` — renders the requirements + intent rubric and
  parses an arktype-validated `{intent: "pass"|"fail", reasons: string[]}`.
  Requirements (acceptance criteria) are folded into the single `intent`
  component the schema carries — mechanical and QA stay gate-sourced.
- `judge/classify-failure.ts` / `judge/classify-operator.ts` — diagnostic
  classifiers (F1–F15 + scope-trap + qa-coverage-gap; five operator-turn
  buckets). Feed the auto-retro surface; don't gate the scorecard.
- `judge/emit-correctness.ts` — the merge-preserving emission helper. See §
  The `correctness-recorded` merge rule below.
- `judge/calibration.ts` + `judge/calibration/labels.md` — judge-vs-human
  agreement tally with the **≥0.80** gate. The corpus is currently empty; the
  actual calibration run is **parked** (see § Parked calibration).

### Fail-to-null invariant

A malformed model response **never** silently becomes a `pass`. Each prompt
set's parser falls back to its safe-null verdict:

- rubric → `{intent: null, reasons: [...]}` (→ scorecard `not-computable`,
  naming `intent` as the missing input)
- failure-mode classifier → `{failureModes: [], reasons: [...]}`
- operator-turn classifier → `{bucket: null, reasons: [...]}`

### The `correctness-recorded` merge rule

The scorecard is **last-write-wins per `project_run_id` on the whole
`{mechanical, qa, intent}` triple** — a `correctness-recorded` event replaces
the triple, it does not merge components. So the judge cannot emit
`{mechanical: null, qa: null, intent: <verdict>}` without clobbering any
`mechanical` or `qa` already recorded by the validation gates / QA run.

`judge/emit-correctness.ts` solves this:

1. `mergedCorrectnessPayload(events, projectRunId, intent)` reads the run's
   latest `correctness-recorded` event and returns a merged triple that
   preserves the prior `mechanical` and `qa` while filling `intent` with the
   judge's verdict.
2. `emitMergedCorrectness(...)` computes the merged payload and appends one
   line through the deterministic emitter
   (`drive-record-traces/emit.ts`) — fail-closed, schema-validated.

End-to-end test pins the invariant: a prior `mechanical:pass + qa:pass`
survives the judge's emission, and `computeScorecard` reads the run as
`correct`. A `null` intent verdict (malformed model output) preserves prior
components and leaves the run `not-computable` with `intent` named as the
missing input.

### Cross-family grading requirement

The judge model is a pinned **per-experiment parameter** and **must be
cross-family from the orchestrator under test** — same-family grading
inflates agreement without measuring real correctness. Today's orchestrator is
Claude, so the default judge id is `gpt-5.5`. The SDK adapter's
synchronous family-check refuses a same-family pairing at construction; the
runtime cannot reach the SDK without clearing the guard.

### Parked calibration

The judge's `intent` signal is trusted only after it clears **≥0.80 exact
agreement** against held-out human labels on the instrumented-run corpus.
This slice ships the machinery — `agreementRate` + the 0.80 gate + the
`labels.md` corpus store — but **does not run the calibration**:

- The corpus needs ~10–20 instrumented runs.
- Run production is gated on operator approval of real-dollar model spend.
- Until the corpus exists, every judge emission is honest but **uncalibrated**;
  the project-DoD calibration item stays unchecked.

When the corpus exists, calibration is a one-shot run against the locked
prompt set; the gate moves the project-DoD item to checked, and drift
monitoring re-runs the same gate periodically.

## Relationship to the rest of the cluster

- **Golden-case library** (`projects/drive-judge-harness/assets/golden/`) — the
  briefs/acceptance/QA this harness runs.
- **`drive-record-traces`** — the trace vocabulary the spawned run emits into.
- **`drive-diagnose-run`** — reads the produced trace; `posthoc.ts` is validated
  by `validate-parser.ts`.
