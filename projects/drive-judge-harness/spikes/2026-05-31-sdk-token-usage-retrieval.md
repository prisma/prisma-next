# Spike: can per-run token usage be retrieved from `@cursor/sdk` for a local run?

**Date:** 2026-05-31 · **Trigger:** the first live `run-arm` (composer-2.5, i12-halt) returned `tokens: {all zero}`. **Question:** is the token signal — our stated #1 efficiency metric after correctness — obtainable from the SDK for a *local-runtime* run, via the stream, the run outcome, the `analytics` surface, or the cloud-API `getRun`?

## Answer

**No. Token usage is not retrievable via the `@cursor/sdk` public surface for local runs, by any path.** Wall-clock (`durationMs`) is available and becomes the primary efficiency metric; `tokens` is honestly `null` from the runtime.

## Evidence (`@cursor/sdk@1.0.15`)

A throwaway probe spawned a trivial local run and dumped every stream message + the `wait()` outcome:

- **Stream messages** — only two types across the whole run: `status` `{ type, agent_id, run_id, status }` and `assistant` `{ type, agent_id, run_id, message }`. **No `turnEnded` / `usage` event is emitted by the local runtime.** (The SDK *does* define a `usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` schema, but it rides on a `turnEnded` update that only the **cloud** runtime streams.)
- **Run outcome** (`wait()`) — `{ id, status, result, model, durationMs }`. Carries wall-clock (`durationMs`), no tokens. `agent_id` is **not** here; it is on the stream messages.
- **`analytics.d.ts`** — emit-only outbound telemetry (`trackSdkRunCreated/Completed/SendLatency`, `flushSdkAnalytics`). No read-back API. The event props (`SdkRunCreatedProps`, `SdkRunCompletedProps`, `SdkRunSendLatencyProps`) carry `turn_count`, latency, `end_reason` — **no token counts**.
- **`cloud-api-client` `getRun({agentId,runId}) → V1Run`** — `{ id, agentId, status, createdAt, updatedAt, durationMs?, result?, git? }`. **No tokens.** `RunResultMetadata` and `executor-types.d.ts` have zero token/usage/cost fields. (Also a cloud-agent query; a local run is not necessarily registered there.)

## Decision (re-route)

Proceed on **option (d)**:

- Capture `durationMs` (wall-clock) from the run outcome → the primary Tier-2 efficiency metric for local runs.
- `tokens` stays `null` for local runs, with an explicit manifest note + a documented SDK limitation (consumption gotcha). Not a bug in our extraction — there is nothing to extract.
- A future token source must come from **outside** the SDK (a Cursor admin/usage API, or CLI-internal telemetry). Out of scope for the fix slice.

Companion clean fixes (same slice): capture `agent_id` from the stream `status` message; scope `collect-run` to traces emitted *during* the run (exclude baseline-committed traces).
