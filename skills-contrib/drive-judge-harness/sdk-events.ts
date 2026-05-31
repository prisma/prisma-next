import type { RunStreamEvent } from './run-one-brief.ts';
import type { TurnUsage } from './usage.ts';

// Pure message-shape mappers for the Cursor SDK local runtime.
//
// These operate over `unknown` and have no dependency on `@cursor/sdk`, so they
// can be unit-tested with the SDK absent. The sole SDK importer remains
// `sdk-adapter.ts`, which imports these utilities and wires them into the live path.
//
// Real shapes from @cursor/sdk@1.0.15 local runtime (confirmed via spike
// 2026-05-31-sdk-token-usage-retrieval.md):
//
//   stream status:    { type: "status",    agent_id, run_id, status }
//   stream assistant: { type: "assistant", agent_id, run_id, message }
//   wait() outcome:   { id, status, result, model, durationMs }
//                     (no agent_id, no token/usage fields on the local runtime)

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function extractUsage(raw: unknown): TurnUsage | null {
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

export function extractText(raw: unknown): string | null {
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

/** Map a raw SDK stream message onto a normalized `RunStreamEvent`. */
export function streamEventFromMessage(message: unknown): RunStreamEvent {
  const usage = extractUsage(message);
  if (usage !== null) return { kind: 'turn-ended', usage };
  const text = extractText(message);
  if (text !== null) return { kind: 'text', text };
  return { kind: 'other' };
}

/** Read the snake_case `agent_id` from a stream message (`status` or
 *  `assistant`). Returns `null` for non-records or absent fields. */
export function agentIdFromMessage(msg: unknown): string | null {
  if (!isRecord(msg)) return null;
  return asString(msg.agent_id);
}

/** Map the raw `wait()` result to the fields the harness consumes.
 *  Real shape: `{ id, status, result, model, durationMs }`.
 *  Degrades gracefully: non-records → `{ status: 'error', runId: null, durationMs: null }`. */
export function outcomeFromResult(raw: unknown): {
  status: 'finished' | 'error';
  runId: string | null;
  durationMs: number | null;
} {
  if (!isRecord(raw)) {
    return { status: 'error', runId: null, durationMs: null };
  }
  const status: 'finished' | 'error' = raw.status === 'finished' ? 'finished' : 'error';
  const runId = asString(raw.id);
  const durationMs = typeof raw.durationMs === 'number' ? raw.durationMs : null;
  return { status, runId, durationMs };
}
