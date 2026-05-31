import type { JudgeModel } from './judge-model.ts';

// Live judge-model adapter. Pins a cross-family judge model id (default GPT 5.5
// vs today's Claude orchestrator) and rejects a same-family judge id at
// construction time, so a same-family grading mistake cannot escape into a live
// run. Reuses the `@cursor/sdk` runtime path the harness already uses — the SDK
// is loaded lazily through a dynamic import so typecheck / tests / lint stay
// green when `@cursor/sdk` is not installed and `CURSOR_API_KEY` is absent.
//
// The cross-family guard runs at construction (synchronous) so a misconfigured
// judge id fails fast, before any SDK code is reached.

/** Model families relevant to the cross-family grading guard. Add more as new
 *  orchestrator families appear; an unrecognised id falls into 'unknown' and
 *  is considered cross-family against any known orchestrator family. */
export type ModelFamily = 'claude' | 'gpt' | 'composer' | 'unknown';

export const DEFAULT_JUDGE_MODEL_ID = 'gpt-5.5';
export const DEFAULT_ORCHESTRATOR_FAMILY: ModelFamily = 'claude';

/** Infer a model family from a model id. Heuristic-only — the live adapter's
 *  job is to refuse a same-family pairing, not to model the entire vendor
 *  catalogue. */
export function inferModelFamily(modelId: string): ModelFamily {
  const lower = modelId.toLowerCase();
  if (lower.startsWith('claude')) return 'claude';
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3')) return 'gpt';
  if (lower.startsWith('composer')) return 'composer';
  return 'unknown';
}

export type CreateSdkJudgeModelOptions = {
  /** The judge model id; must be cross-family from the orchestrator under
   *  test. Defaults to GPT 5.5. */
  judgeModelId?: string;
  /** The family of the orchestrator the judge is grading. Defaults to Claude
   *  (today's orchestrator). */
  orchestratorFamily?: ModelFamily;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractText(message: unknown): string {
  if (!isRecord(message) || message.type !== 'assistant') return '';
  const inner = message.message;
  if (!isRecord(inner)) return '';
  const content = inner.content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    }
  }
  return text;
}

/** Construct a live `JudgeModel` backed by `@cursor/sdk`. Cross-family check
 *  runs synchronously at construction. The SDK import + the network call are
 *  deferred until `grade()` is invoked. */
export function createSdkJudgeModel(options: CreateSdkJudgeModelOptions = {}): JudgeModel {
  const judgeModelId = options.judgeModelId ?? DEFAULT_JUDGE_MODEL_ID;
  const orchestratorFamily = options.orchestratorFamily ?? DEFAULT_ORCHESTRATOR_FAMILY;
  const judgeFamily = inferModelFamily(judgeModelId);

  if (judgeFamily === orchestratorFamily) {
    throw new Error(
      `cross-family guard: judge model "${judgeModelId}" is the same family as the orchestrator ` +
        `(${orchestratorFamily}). Pick a cross-family judge model (default: ${DEFAULT_JUDGE_MODEL_ID}).`,
    );
  }

  return {
    async grade(prompt: string): Promise<string> {
      const apiKey = process.env.CURSOR_API_KEY;
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error('CURSOR_API_KEY is required for a live judge call');
      }
      const sdk = await import('@cursor/sdk');
      const agent = await sdk.Agent.create({
        apiKey,
        model: { id: judgeModelId },
        local: { cwd: process.cwd() },
      });
      const run = await agent.send(prompt);
      let text = '';
      for await (const message of run.stream()) {
        text += extractText(message);
      }
      await run.wait();
      return text;
    },
  };
}
