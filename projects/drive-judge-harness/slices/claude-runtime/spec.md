# Slice: claude-runtime

_Parent project `projects/drive-judge-harness/`. Outcome this slice contributes: the harness is **decoupled from Cursor** — it runs the Drive orchestrator on Anthropic's Claude Agent SDK by default, which reports real token usage, USD cost, and wall-clock natively (the signal `@cursor/sdk`'s local runtime never gave us). The Cursor adapter stays as a runtime-selectable secondary. Delivered alongside the run-fidelity fixes on the same branch/PR (#657)._

## At a glance

A live run now records tokens + dollars + wall-clock, because the runtime reports them:

```jsonc
{ "runtime": "claude", "model": "claude-haiku-4-5", "status": "finished",
  "run_id": "<session-id>", "agent_id": null,
  "tokens": { "inputTokens": 33, "outputTokens": 904, "cacheReadTokens": 230827, "cacheWriteTokens": 53995, "totalTokens": 285759 },
  "cost_usd": 0.1839242, "num_turns": 9, "wall_clock_ms": 16025, "notes": [] }
```

The Cursor runtime stays available via `--runtime cursor`; its token gap (documented in the run-fidelity work) is now scoped to that adapter.

## Chosen design

The Cursor coupling lives in exactly one module behind a seam that already exists: `run-one-brief.ts` defines `CreateAgent` / `OrchestratorRun` / `RunOutcome`; `sdk-adapter.ts` is the only `@cursor/sdk` importer. This slice adds a **second adapter** over the same seam.

Ground-truth Claude Agent SDK shapes (`@anthropic-ai/claude-agent-sdk`, confirmed from the cost-tracking + TS-reference docs):
- `query({ prompt, options })` returns an async iterable of messages.
- Per-`assistant` message: nested `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) + `message.id`.
- Terminal `result` message (`SDKResultMessage`): `subtype` (`success` | `error_*`), cumulative `usage` (same fields), `total_cost_usd`, `duration_ms`, `num_turns`, `session_id`, `result`.

### 1. `claude-events.ts` — pure mappers (no SDK import)

Mirror of `sdk-events.ts`, for the Claude shapes. Operates over `unknown`; imports nothing from the SDK so it's unit-testable with the SDK absent. Exports:
- `usageFromAssistant(msg) -> TurnUsage | null` — maps `message.usage` (`cache_creation_input_tokens`→`cacheWriteTokens`, `cache_read_input_tokens`→`cacheReadTokens`).
- `streamEventFromMessage(msg) -> RunStreamEvent` — `assistant` with usage → `turn-ended`; else `other`.
- `outcomeFromResult(msg) -> { status; runId; tokens; durationMs; costUsd; numTurns } | null` — only for `type: 'result'`. `subtype === 'success'` → `finished`, else `error`; `session_id` → `runId`; cumulative `usage` → `TokenTotals`; `total_cost_usd` → `costUsd`; `duration_ms` → `durationMs`; `num_turns` → `numTurns`. Degrades on non-records.

### 2. `claude-adapter.ts` — the only Claude-SDK importer (lazy)

Implements `CreateAgent` over `query()`. Because `query()` is one generator (not split stream/wait), the adapter iterates it inside `stream()`, yields `turn-ended` events from per-assistant usage, captures the terminal `result` message, and returns it from `wait()` (run-one-brief drains the stream before calling `wait()`, so the result is available). `query()` options for an **unattended, skill-aware** orchestrator run:
- `cwd: runDir` (the prepared checkout — its `.claude/skills/` are the injected bundle)
- `settingSources: ['project']` (loads `.claude/skills/`, `.claude/agents/`, `CLAUDE.md` from the checkout)
- `skills: 'all'` (auto-enables the `Skill` tool)
- `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true` (no interactive prompts)
- `model` (the pinned model id)
- `maxBudgetUsd` when provided (hard per-run dollar cap — aborts with `error_max_budget_usd`)

### 3. Seam + manifest extensions

- `RunOutcome` gains `tokens: TokenTotals | null`, `costUsd: number | null`, `numTurns: number | null` (Cursor adapter sets these `null`; tokens still flow via per-turn accumulation there).
- `run-one-brief.ts`: prefer `outcome.tokens` when present, else fall back to `accumulateUsage(usageUpdates)`. Populate `cost_usd` / `num_turns` / `wall_clock_ms` from the outcome. The null-token note (from the run-fidelity work) fires only when tokens are genuinely null.
- `RunManifest` gains `runtime: 'claude' | 'cursor'`, `cost_usd: number | null`, `num_turns: number | null`.
- **Runtime selection:** `RunOneBriefConfig`/`RunArmConfig` gain `runtime: 'claude' | 'cursor'` (default `'claude'`) and optional `maxBudgetUsd`. `defaultCreateAgent(runtime)` lazily imports the matching adapter. The gate's `apiKeyPresent` is computed against the runtime's key (`ANTHROPIC_API_KEY` for claude, `CURSOR_API_KEY` for cursor). CLI gains `--runtime <claude|cursor>` (default claude) and `--max-budget-usd <n>`.

## Coherence rationale

One reviewer holds it in one sitting: a second adapter behind an existing seam, plus the manifest fields the new runtime can finally populate. It's entangled with the run-fidelity work on the same branch — both are "make the recorded run faithful," and this slice is what turns the token gap that work documented into a captured signal. Rolls forward as: new pure module + new adapter + additive outcome/manifest fields + a runtime selector. No production package touched.

## Scope

**In:** `claude-events.ts` (+ tests with real result/assistant fixtures); `claude-adapter.ts` (lazy, sole Claude-SDK importer); `RunOutcome`/`RunManifest` additions; runtime selection + key-gating + CLI flags in `run-one-brief.ts` and `run-arm.ts`; install `@anthropic-ai/claude-agent-sdk`; SKILL.md runtimes section + scope the token-gap doc to the Cursor adapter; new test wired into `test:scripts`. Delivered on branch `tml-2757-run-fidelity` / PR #657.

**Out:** removing the Cursor adapter (kept as secondary, operator decision). The A/B loop / aggregation / CI gate (TML-2737). Judge calibration (TML-2736) and corpus generation (real-dollar, operator-gated).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `query()` is one generator, not stream+wait | Drove the adapter shape | Iterate in `stream()`, stash the `result` message for `wait()`. |
| Claude reports cumulative usage on `result`, not just per-turn | `RunOutcome.tokens` | run-one-brief prefers outcome tokens; per-turn accumulation stays the Cursor path. |
| No `agent_id` concept in Claude SDK | `agent_id: null`, `session_id`→`run_id` | The session id is the run identifier. |
| Unattended run hitting a permission prompt | `bypassPermissions` + `allowDangerouslySkipPermissions` | Required for autonomous orchestrator runs. |
| Runaway cost during calibration | `maxBudgetUsd` cap | Aborts with `error_max_budget_usd`; recorded as an error run with usage-so-far. |
| `@anthropic-ai/claude-agent-sdk` not installed at test time | Lazy import behind the gate | `claude-events.ts` has no SDK import; tests never load the adapter. |

## Slice-specific done conditions

- [ ] A test feeds a real `SDKResultMessage` (success + an `error_*` subtype) through `claude-events.ts` and asserts `tokens`, `cost_usd`, `wall_clock_ms`, `num_turns`, `run_id` extraction — with the SDK not installed.
- [ ] `--runtime cursor` still produces a Cursor-runtime manifest (selection works both ways).
- [ ] A live smoke run on `claude-haiku-4-5` records non-null `tokens` + `cost_usd` **iff** `ANTHROPIC_API_KEY` is present; otherwise this is a gated follow-up.

## Open Questions

1. **Subagent token attribution.** Claude's `usage` aggregates orchestrator + subagents into one run total (per-subagent breakdown is an open SDK request). Working position: the run total is exactly what we want for the efficiency metric; per-subagent attribution is not needed for this slice.

## References

- Parent: `projects/drive-judge-harness/spec.md`; sibling run-fidelity slice (same branch).
- Spike: `projects/drive-judge-harness/spikes/2026-05-31-sdk-token-usage-retrieval.md`.
- Linear: [TML-2759](https://linear.app/prisma-company/issue/TML-2759) (related TML-2757, blocks TML-2737).
- SDK docs: [cost-tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [TS reference](https://code.claude.com/docs/en/agent-sdk/typescript), [skills](https://code.claude.com/docs/en/agent-sdk/skills).
- Seam: `skills-contrib/drive-judge-harness/{run-one-brief,sdk-adapter,sdk-events,run-arm,manifest,usage}.ts`.
