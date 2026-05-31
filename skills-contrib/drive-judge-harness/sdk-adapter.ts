import { Agent } from '@cursor/sdk';
import type { CreateAgent, OrchestratorRun, RunOutcome, RunStreamEvent } from './run-one-brief.ts';
import type { TurnUsage } from './usage.ts';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function extractUsage(raw: unknown): TurnUsage | null {
  if (!isRecord(raw)) return null;
  const usage = raw.usage;
  if (!isRecord(usage)) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    cacheReadTokens: num(usage.cacheReadTokens),
    cacheWriteTokens: num(usage.cacheWriteTokens),
  };
}

function extractText(raw: unknown): string | null {
  if (!isRecord(raw) || raw.type !== 'assistant') return null;
  const message = raw.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  if (!Array.isArray(content)) return null;
  let text = '';
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    }
  }
  return text.length > 0 ? text : null;
}

function toStreamEvent(message: unknown): RunStreamEvent {
  const usage = extractUsage(message);
  if (usage !== null) return { kind: 'turn-ended', usage };
  const text = extractText(message);
  if (text !== null) return { kind: 'text', text };
  return { kind: 'other' };
}

function adaptOutcome(raw: unknown): RunOutcome {
  if (!isRecord(raw)) {
    return { status: 'error', runId: null, agentId: null };
  }
  const status = raw.status === 'finished' ? 'finished' : 'error';
  return { status, runId: asString(raw.id), agentId: asString(raw.agentId) };
}

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
        yield toStreamEvent(message);
      }
    },
    async wait() {
      return adaptOutcome(await sdkRun.wait());
    },
  };
}

/** Live `CreateAgent` backed by `@cursor/sdk`. Reached only on the live path. */
export const createCursorAgent: CreateAgent = async ({ model, prompt }) => {
  const apiKey = process.env.CURSOR_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('CURSOR_API_KEY is required for a live run');
  }
  const agent = await Agent.create({
    apiKey,
    model: { id: model },
    local: { cwd: process.cwd() },
  });
  const sdkRun = await agent.send(prompt);
  return adaptRun(sdkRun);
};
