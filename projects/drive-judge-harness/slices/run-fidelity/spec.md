# Slice: run-fidelity

_Parent project `projects/drive-judge-harness/`. Outcome this slice contributes: the harness records a **faithful** run — correct `agent_id`, a real wall-clock signal, and a trace set scoped to what the run actually emitted — so the corpus the judge calibrates against and the A/B engine ranks on isn't polluted or blank. Fixes the three fidelity defects the first live `run-arm` exposed._

## At a glance

The first live run (composer-2.5, i12-halt) proved the pipeline but mis-recorded the run: `agent_id: null`, `tokens` all-zero, and `collected_trace_paths` containing 5 pre-existing committed traces from the base checkout plus 1 real one. This slice fixes the recordable defects and honestly documents the one that isn't recordable:

- **`agent_id`** is read from the stream `status` message (where the local runtime actually puts it), not the `wait()` outcome.
- **Wall-clock** (`durationMs` from the outcome) is captured as `wall_clock_ms` — the primary Tier-2 efficiency metric, since tokens are unavailable.
- **`collect-run`** returns only traces *emitted during the run*, not every schema-valid `.jsonl` in the checkout.
- **Tokens** stay `null` for local runs with an explicit note + documented SDK limitation (spike `2026-05-31-sdk-token-usage-retrieval.md`).

## Chosen design

Ground-truth shapes from the spike probe (`@cursor/sdk@1.0.15`, local runtime):
- stream `status` → `{ type:"status", agent_id, run_id, status }`
- stream `assistant` → `{ type:"assistant", agent_id, run_id, message }`
- outcome (`wait()`) → `{ id, status, result, model, durationMs }` (no `agent_id`, no tokens)

### 1. `sdk-events.ts` — extract the pure mappers (no SDK import)

Today the message/outcome mappers (`extractUsage`, `extractText`, `adaptOutcome`, `toStreamEvent`) live inside `sdk-adapter.ts`, which `import`s `@cursor/sdk` at module top — so they can't be unit-tested without the SDK installed. Move them into a new **`sdk-events.ts`** that imports nothing from the SDK and operates over `unknown`. `sdk-adapter.ts` imports them. This is what lets the fixes be test-first while preserving the live-execution gate (SDK reached only via `sdk-adapter.ts`'s dynamic import).

`sdk-events.ts` exports pure functions, unit-tested against the **real captured shapes**:
- `streamEventFromMessage(msg) -> RunStreamEvent` — maps `status`/`assistant` (real shapes) and keeps the `turn-ended` branch for the cloud runtime (still valid if ever used).
- `agentIdFromMessage(msg) -> string | null` — reads snake_case `agent_id`.
- `outcomeFromResult(raw) -> { status, runId, durationMs }` — reads `id`→runId, `status`, `durationMs` (number|null).

### 2. `run-one-brief.ts` — capture agent_id + wall-clock

`RunOutcome` gains `durationMs: number | null`. The adapter captures `agent_id` from the **first stream message that carries one** (run-one-brief drains the stream before `wait()`, so it's available), and `wait()` returns it as `agentId`. `durationMs` flows from `outcomeFromResult`. No behaviour change to the dry-run/gate paths.

### 3. `manifest.ts` — wall-clock + honest token note

Add `wall_clock_ms: number | null` (from `durationMs`). When `tokens` is `null` on a *finished live* run, append a note: `"tokens unavailable: @cursor/sdk local runtime emits no usage events (see spike 2026-05-31)"`. `tokens` field stays (null for local).

### 4. `collect-run.ts` — scope to run-emitted traces

`PreparedRun` gains `preexistingTracePaths: string[]` — the set of `*.jsonl` present under `runDir` immediately after `prepareRun`'s baseline commit (the base checkout's committed traces). `collectRun` excludes that set, so `tracePaths` contains only traces the run produced. This is deterministic (no mtime/clock reliance) and robust to gitignored trace locations (e.g. `wip/drive-trace/`, where the real trace landed). `agent_id` matching then runs over the run-emitted set only.

## Coherence rationale

One reviewer holds it in one sitting: every change serves "record the run faithfully," and they're entangled — the `agent_id` fix is what makes `collect-run`'s matching work, the mapper extraction is what makes both testable, and the wall-clock capture is the efficiency metric that stands in for the tokens the SDK won't give us. Rolls back as one unit (one new pure module + additive manifest/outcome fields + a `collect-run` scoping change). Touches no production package.

## Scope

**In:** new `sdk-events.ts` (+ tests with real-shape fixtures); `sdk-adapter.ts` (import the mappers, capture stream `agent_id`); `run-one-brief.ts` (`RunOutcome.durationMs`, agent_id wiring); `manifest.ts` (`wall_clock_ms` + token note); `collect-run.ts` + `prepare-run.ts` (`preexistingTracePaths` snapshot + exclusion); `run-arm.ts` (thread `wall_clock_ms` into the enriched manifest); the spike artifact; SKILL.md / KNOWN-ISSUES note on the token gap; new tests wired into `test:scripts`.

**Out:** a non-SDK token source (Cursor admin/usage API, CLI telemetry) — deferred, out of scope (spike decision). The k=N A/B loop, aggregation, CI gate — TML-2737. The judge — TML-2736.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Local runtime emits no usage event | Documented, not fixed | Confirmed by spike; `tokens: null` + note is the honest record. |
| Real trace landed in gitignored `wip/drive-trace/` | Drove the design | Snapshot-exclusion (not git-diff) is why scoping works for gitignored traces. |
| `agent_id` present on stream but not outcome | Core of the fix | Capture from the stream message, not `wait()`. |
| Multiple run-emitted traces remain after exclusion | Matching handles it | `agent_id` match, else newest, over the run-emitted set. |

## Slice-specific done conditions

- [ ] A test feeds the **real captured** `status`/`assistant`/outcome shapes (from the spike) through `sdk-events.ts` and asserts `agent_id` + `durationMs` extraction — with `@cursor/sdk` not installed.
- [ ] A `collect-run` test with a baseline-committed trace + a run-emitted trace asserts only the latter is returned.

## Open Questions

1. **Snapshot `preexistingTracePaths` in `prepare-run` vs re-scan in `collect-run`?** Working position: snapshot in `prepare-run` (deterministic, captures the exact pre-run state) and pass it through `PreparedRun`. Re-scanning in `collect-run` would race any late base writes.

## References

- Parent project: `projects/drive-judge-harness/spec.md`
- Spike: `projects/drive-judge-harness/spikes/2026-05-31-sdk-token-usage-retrieval.md`
- Linear: [TML-2757](https://linear.app/prisma-company/issue/TML-2757) (blocks TML-2737)
- Surfaces: `skills-contrib/drive-judge-harness/{sdk-adapter,run-one-brief,manifest,collect-run,prepare-run,run-arm}.ts`
- First-run evidence: manifest at `run-arm-i12-…/run-manifest.json` (agent_id null, tokens 0, polluted trace list)
