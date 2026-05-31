# Plan: run-fidelity (TML-2757)

Test-first throughout. The live SDK is reached only via `sdk-adapter.ts`'s dynamic import; all new logic lives in no-SDK-import modules so it's unit-testable with `@cursor/sdk` absent. Spike `2026-05-31-sdk-token-usage-retrieval.md` is committed in dispatch 1.

## Dispatches

### D1 — `sdk-events.ts`: pure mappers + real-shape extraction (test-first)
- **Outcome:** message/outcome mapping lives in a no-SDK module, with `agent_id` and `durationMs` extracted from the **real captured shapes**.
- Move `extractText` / `toStreamEvent` / `adaptOutcome` (and the now-dead `extractUsage`) out of `sdk-adapter.ts` into new `sdk-events.ts` (imports nothing from the SDK; operates over `unknown`). Add `agentIdFromMessage`, `outcomeFromResult` (→ `{status,runId,durationMs}`), `streamEventFromMessage`.
- Tests (`test/sdk-events.test.ts`): feed the real `status`/`assistant`/outcome fixtures from the spike; assert `agent_id`, `durationMs`, stream mapping. Runs with the SDK uninstalled.
- `sdk-adapter.ts` imports the mappers (no behaviour change).
- Commit the spike artifact here.
- **Builds on:** merged run-setup. **Hands to:** D2.

### D2 — capture agent_id + wall-clock end-to-end (test-first)
- **Outcome:** a finished run records the real `agent_id` and `wall_clock_ms`.
- `run-one-brief.ts`: `RunOutcome` gains `durationMs: number | null`; adapter captures `agent_id` from the first stream message carrying one and returns it from `wait()`.
- `manifest.ts`: add `wall_clock_ms`; add the token-unavailable note when `tokens` is null on a finished live run. `run-arm.ts` threads `wall_clock_ms` into the enriched manifest.
- Tests: outcome→manifest mapping populates `agent_id` + `wall_clock_ms`; null-token note present.
- **Builds on:** D1. **Hands to:** D3.

### D3 — `collect-run` run-scoping (test-first)
- **Outcome:** `collectRun` returns only traces emitted during the run.
- `prepare-run.ts`: snapshot `*.jsonl` under `runDir` after the baseline commit → `PreparedRun.preexistingTracePaths`.
- `collect-run.ts`: exclude `preexistingTracePaths`; `agent_id` match over the remainder.
- Tests: baseline-committed trace + run-emitted trace → only the latter returned (cover a gitignored-path trace).
- **Builds on:** D2. **Hands to:** D4.

### D4 — docs + gates + PR
- **Outcome:** token gap documented; suite green; PR open.
- SKILL.md / KNOWN-ISSUES: token gap (link spike) + wall-clock-as-primary note.
- Wire new tests into `test:scripts`; run `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w test:scripts`; fix fallout.
- Stage explicitly, sign off, push to `tml-2757-run-fidelity`, open PR (create-pr skill).
- **Builds on:** D3.

## Sequencing
Serial: D1 unlocks testability, D2 consumes the extractors, D3 is independent of D2 but shares the manifest touch (sequence after to avoid conflict), D4 closes. Target 4 dispatches.
