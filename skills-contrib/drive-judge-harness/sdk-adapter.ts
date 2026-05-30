import type { CreateAgent, OrchestratorRun, RunOutcome, RunStreamEvent } from './run-one-brief.ts';
import type { TurnUsage } from './usage.ts';

// The ONLY module that touches `@cursor/sdk`, and it does so via a DYNAMIC
// import that runs solely on the live execution path. Nothing here is imported
// at module-eval time by the harness core or its tests, so typecheck / tests /
// lint / CI never require `@cursor/sdk` to be installed.
//
// NOTE (operator-gated): adding `@cursor/sdk` to the lockfile currently trips
// the repo's `trustPolicy: no-downgrade` guard on a transitive `undici@5.29.0`.
// Live execution is therefore gated on the operator admitting the dependency
// (a `trustPolicyExclude` entry) AND providing `CURSOR_API_KEY`. The mapping
// below is best-effort against the documented SDK surface (`Agent.create`,
// `run.stream()`, turn-ended `usage`) and should be confirmed on the first live
// run, since the SDK's concrete message shapes are verified only at runtime.

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

type SdkRun = {
  stream(): AsyncIterable<unknown>;
  wait(): Promise<unknown>;
};

type SdkAgent = {
  send(prompt: string): Promise<SdkRun>;
};

type SdkModule = {
  Agent: {
    create(opts: unknown): Promise<SdkAgent>;
  };
};

function isSdkModule(mod: unknown): mod is SdkModule {
  if (!isRecord(mod)) return false;
  const agent = mod.Agent;
  return isRecord(agent) && typeof agent.create === 'function';
}

function adaptOutcome(raw: unknown): RunOutcome {
  if (!isRecord(raw)) {
    return { status: 'error', runId: null, agentId: null };
  }
  const status = raw.status === 'finished' ? 'finished' : 'error';
  return { status, runId: asString(raw.id), agentId: asString(raw.agentId) };
}

function adaptRun(sdkRun: SdkRun): OrchestratorRun {
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
  const mod: unknown = await import('@cursor/sdk');
  if (!isSdkModule(mod)) {
    throw new Error('@cursor/sdk did not expose the expected Agent.create surface');
  }
  const apiKey = process.env.CURSOR_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('CURSOR_API_KEY is required for a live run');
  }
  const agent = await mod.Agent.create({
    apiKey,
    model: { id: model },
    local: { cwd: process.cwd() },
  });
  const sdkRun = await agent.send(prompt);
  return adaptRun(sdkRun);
};
