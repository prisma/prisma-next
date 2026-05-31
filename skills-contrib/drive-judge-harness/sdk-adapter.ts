import { Agent } from '@cursor/sdk';
import type { CreateAgent, OrchestratorRun, RunOutcome } from './run-one-brief.ts';
import { outcomeFromResult, streamEventFromMessage } from './sdk-events.ts';

// The ONLY module that touches `@cursor/sdk`, loaded lazily by run-one-brief on
// the live path, so typecheck / tests / lint / dry-run never require it.
//
// We import `Agent` for its RUNTIME behaviour only — never the SDK's published
// types. `@cursor/sdk@1.0.15` ships `.d.ts` that re-export from unpublished
// `@anysphere/*` packages, so its own types (including `TurnEndedUpdate`, the
// token-usage carrier) are unresolvable. We therefore call the documented
// runtime API (`Agent.create` → `agent.send` → `run.stream()` / `run.wait()`)
// and read the few fields we consume through runtime guards over `unknown`,
// rather than fabricating a full mirror of the SDK's type surface. When upstream
// ships self-contained declarations, replace these reads with the real types.
// See ./KNOWN-ISSUES.md.
//
// Pure message-shape mappers (isRecord, asString, extractUsage, extractText,
// streamEventFromMessage, agentIdFromMessage, outcomeFromResult) live in
// sdk-events.ts — no SDK import there, fully unit-testable without the SDK.

/** Normalize a started SDK run into the harness's `OrchestratorRun`. Reads the
 *  run's `stream()` / `wait()` (documented runtime API); the yielded messages
 *  and the terminal result are validated structurally, not by SDK types. */
function adaptRun(sdkRun: {
  stream(): AsyncIterable<unknown>;
  wait(): Promise<unknown>;
}): OrchestratorRun {
  return {
    async *stream() {
      for await (const message of sdkRun.stream()) {
        yield streamEventFromMessage(message);
      }
    },
    async wait(): Promise<RunOutcome> {
      const raw = await sdkRun.wait();
      const { status, runId } = outcomeFromResult(raw);
      return { status, runId, agentId: null };
    },
  };
}

/** Live `CreateAgent` backed by `@cursor/sdk`. Reached only on the live path. */
export const createCursorAgent: CreateAgent = async ({ model, prompt, cwd }) => {
  const apiKey = process.env.CURSOR_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('CURSOR_API_KEY is required for a live run');
  }
  const agent = await Agent.create({
    apiKey,
    model: { id: model },
    local: { cwd },
  });
  const sdkRun = await agent.send(prompt);
  return adaptRun(sdkRun);
};
