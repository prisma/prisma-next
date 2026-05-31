import { outcomeFromResult, streamEventFromMessage } from './claude-events.ts';
import type { CreateAgent, OrchestratorRun, RunOutcome } from './run-one-brief.ts';
import { isRecord } from './sdk-events.ts';

// The ONLY module that imports `@anthropic-ai/claude-agent-sdk`, loaded lazily
// by run-one-brief on the live claude path. Never reached under test (tests
// inject a mock `createAgent`). The SDK is not installed during development or
// CI; the dynamic import path is the only gate.
//
// `query({ prompt, options })` returns an async generator of messages. We iterate
// the entire generator in `stream()`, yielding normalized RunStreamEvents, and
// capture the terminal `result` message for `wait()` to consume. run-one-brief
// drains `stream()` fully before calling `wait()`, so the captured result is
// always available by then.
//
// Pure message-shape mappers live in `claude-events.ts` — no SDK import there,
// fully unit-testable with the SDK absent.

/** Normalize an SDK `query()` generator into the harness's `OrchestratorRun`. */
function adaptQuery(generator: AsyncIterable<unknown>): OrchestratorRun {
  let capturedResult: unknown = null;
  return {
    async *stream() {
      for await (const msg of generator) {
        if (isResultMessage(msg)) {
          capturedResult = msg;
        }
        yield streamEventFromMessage(msg);
      }
    },
    async wait(): Promise<RunOutcome> {
      const parsed = capturedResult !== null ? outcomeFromResult(capturedResult) : null;
      if (parsed === null) {
        return {
          status: 'error',
          runId: null,
          agentId: null,
          durationMs: null,
          tokens: null,
          costUsd: null,
          numTurns: null,
        };
      }
      return {
        status: parsed.status,
        runId: parsed.runId,
        agentId: null,
        durationMs: parsed.durationMs,
        tokens: parsed.tokens,
        costUsd: parsed.costUsd,
        numTurns: parsed.numTurns,
      };
    },
  };
}

function isResultMessage(msg: unknown): msg is Record<string, unknown> {
  return isRecord(msg) && msg.type === 'result';
}

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return v !== null && typeof v === 'object' && Symbol.asyncIterator in v;
}

/** Live `CreateAgent` backed by `@anthropic-ai/claude-agent-sdk`. Reached only
 *  on the live claude path. */
export const createClaudeAgent: CreateAgent = async ({ model, prompt, cwd, maxBudgetUsd }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('ANTHROPIC_API_KEY is required for a live claude run');
  }

  // Dynamic import keeps this module evaluatable (typecheck/lint/test) with
  // @anthropic-ai/claude-agent-sdk absent from node_modules.
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const options: Record<string, unknown> = {
    cwd,
    model,
    settingSources: ['project'],
    skills: 'all',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  };
  if (maxBudgetUsd != null) {
    options.maxBudgetUsd = maxBudgetUsd;
  }

  const rawResult: unknown = query({ prompt, options });
  if (!isAsyncIterable(rawResult)) {
    throw new Error('SDK query() did not return an AsyncIterable');
  }
  return adaptQuery(rawResult);
};
