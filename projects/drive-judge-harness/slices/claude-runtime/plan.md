# Plan: claude-runtime (TML-2759)

Test-first. The Claude SDK is reached only via `claude-adapter.ts`'s lazy import (mirroring `sdk-adapter.ts`); all mapping logic lives in the no-SDK `claude-events.ts` so it's unit-testable with the SDK absent. Built on branch `tml-2757-run-fidelity` (PR #657), on top of the run-fidelity commits.

## Dispatches

### D1 — `claude-events.ts`: pure mappers + extraction (test-first)
- **Outcome:** Claude message/result shapes map to the harness's `RunStreamEvent` + a rich outcome, with no SDK import.
- Implement `usageFromAssistant`, `streamEventFromMessage`, `outcomeFromResult` (→ `{status,runId,tokens,durationMs,costUsd,numTurns}`) over `unknown`. Map `cache_creation_input_tokens`→`cacheWriteTokens`, `cache_read_input_tokens`→`cacheReadTokens`; `session_id`→`runId`; `subtype==='success'`→`finished`.
- Tests (`test/claude-events.test.ts`): real `SDKResultMessage` (success + an `error_*` subtype) + a real `assistant` message; assert token totals, `cost_usd`, `wall_clock_ms` (`duration_ms`), `num_turns`, `run_id`; degrade on non-records. SDK not installed.
- **Builds on:** run-fidelity (`usage.ts`, the seam). **Hands to:** D2.

### D2 — `claude-adapter.ts` + seam/manifest + runtime selection (test-first)
- **Outcome:** the harness runs on Claude by default and records tokens/cost/turns; `--runtime cursor` still works.
- `RunOutcome` gains `tokens`/`costUsd`/`numTurns` (Cursor adapter sets null). `run-one-brief.ts`: prefer `outcome.tokens` else `accumulateUsage`; populate `cost_usd`/`num_turns`/`wall_clock_ms`; runtime selection + per-runtime key gating; `defaultCreateAgent(runtime)`. `manifest.ts`: add `runtime`/`cost_usd`/`num_turns`. `run-arm.ts` + `run-one-brief.ts` CLIs: `--runtime` (default claude), `--max-budget-usd`.
- `claude-adapter.ts`: `query()` with `cwd`/`settingSources:['project']`/`skills:'all'`/`permissionMode:'bypassPermissions'`/`allowDangerouslySkipPermissions:true`/`model`/`maxBudgetUsd`; buffer the result for `wait()`.
- Tests: injected `createAgent` returning a Claude-shaped outcome → manifest has `runtime:'claude'`, non-null `tokens`/`cost_usd`/`num_turns`; a `--runtime cursor` selection test; key-gating per runtime.
- **Builds on:** D1. **Hands to:** D3 (orchestrator).

### D3 — install + docs + live smoke + gates + PR (orchestrator)
- Install `@anthropic-ai/claude-agent-sdk` (`pnpm add -w -D`); handle any build-script/native hiccups as with `@cursor/sdk`.
- Wire `test/claude-events.test.ts` into `test:scripts`.
- Docs: SKILL.md "Runtimes" section (claude default / cursor secondary, selection, `maxBudgetUsd`); scope the token-gap note to the Cursor adapter in SKILL.md + KNOWN-ISSUES.
- Live smoke on `claude-haiku-4-5` iff `ANTHROPIC_API_KEY` present (else gated follow-up note).
- Gates: `pnpm test:scripts`, biome, transient-id scan. Update PR #657 title/body to "faithful + decoupled runs" (refs TML-2757 + TML-2759). Commit signed-off, push.
- **Builds on:** D2.

## Sequencing
Serial: D1 (mappers) → D2 (adapter + wiring consume them) → D3 (install/docs/gates). Target 3 dispatches; D1+D2 delegated to one implementer, D3 by the orchestrator.
