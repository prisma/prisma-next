import type { RunStreamEvent } from './run-one-brief.ts';
import { asString, isRecord } from './sdk-events.ts';
import { accumulateUsage, type TokenTotals, type TurnUsage } from './usage.ts';

// Pure message-shape mappers for the Anthropic Claude Agent SDK.
//
// These operate over `unknown` and have zero dependency on
// `@anthropic-ai/claude-agent-sdk`, so they can be unit-tested with the SDK
// absent. The sole SDK importer remains `claude-adapter.ts`, which wires these
// utilities into the live path.
//
// Real shapes from @anthropic-ai/claude-agent-sdk (confirmed from SDK docs):
//
//   stream assistant: { type: "assistant", message: { id, usage: {
//                         input_tokens, output_tokens,
//                         cache_creation_input_tokens,
//                         cache_read_input_tokens } } }
//   terminal result:  { type: "result", subtype: "success"|"error_max_turns"|...,
//                       session_id, duration_ms, num_turns, total_cost_usd,
//                       usage: { input_tokens, output_tokens,
//                                cache_creation_input_tokens,
//                                cache_read_input_tokens } }
//
// Field mapping (SDK snake_case -> harness camelCase):
//   input_tokens               -> inputTokens
//   output_tokens              -> outputTokens
//   cache_read_input_tokens    -> cacheReadTokens
//   cache_creation_input_tokens -> cacheWriteTokens

function mapUsage(usage: Record<string, unknown>): TurnUsage {
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheWriteTokens: num(usage.cache_creation_input_tokens),
  };
}

/** Read usage from an assistant message's nested `message.usage` object.
 *  Returns null if the message is not an assistant type or has no usage. */
export function usageFromAssistant(msg: unknown): TurnUsage | null {
  if (!isRecord(msg) || msg.type !== 'assistant') return null;
  const message = msg.message;
  if (!isRecord(message)) return null;
  const usage = message.usage;
  if (!isRecord(usage)) return null;
  return mapUsage(usage);
}

/** Map a raw Claude SDK stream message onto a normalized `RunStreamEvent`.
 *  An assistant message with usage maps to `turn-ended`; everything else is `other`. */
export function streamEventFromMessage(msg: unknown): RunStreamEvent {
  const usage = usageFromAssistant(msg);
  if (usage !== null) return { kind: 'turn-ended', usage };
  return { kind: 'other' };
}

/** Map a raw Claude SDK terminal `result` message to the harness outcome fields.
 *  Returns null when `msg.type !== 'result'`. Degrades gracefully on non-records. */
export function outcomeFromResult(msg: unknown): {
  status: 'finished' | 'error';
  runId: string | null;
  tokens: TokenTotals | null;
  durationMs: number | null;
  costUsd: number | null;
  numTurns: number | null;
} | null {
  if (!isRecord(msg) || msg.type !== 'result') return null;
  const status: 'finished' | 'error' = msg.subtype === 'success' ? 'finished' : 'error';
  const runId = asString(msg.session_id);
  const durationMs = typeof msg.duration_ms === 'number' ? msg.duration_ms : null;
  const costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null;
  const numTurns = typeof msg.num_turns === 'number' ? msg.num_turns : null;

  const usageRaw = msg.usage;
  const tokens: TokenTotals | null = isRecord(usageRaw)
    ? accumulateUsage([mapUsage(usageRaw)])
    : null;

  return { status, runId, tokens, durationMs, costUsd, numTurns };
}
