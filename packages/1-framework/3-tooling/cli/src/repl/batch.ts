/**
 * Shared evaluate-and-print pipeline plus the non-interactive (piped stdin)
 * batch mode. Stream-parameterized so unit tests can drive it with
 * PassThrough streams and a stubbed context.
 */
import { createReplEvaluator, type ReplEvaluator } from './evaluator';
import type { ReplContext } from './load-repl-context';
import { materializeResult } from './materialize';
import { runMetaCommand } from './meta-commands';
import { replPalette } from './palette';
import { renderResultValue } from './render';

/** Thrown by the print pipeline when a meta command requests exit. */
export class ExitSignal extends Error {}

export interface EvaluatePrintOptions {
  readonly context: ReplContext;
  readonly output: NodeJS.WritableStream;
  readonly color: boolean;
  /** Gates terminal-only behavior like the .clear escape sequence. */
  readonly interactive: boolean;
}

export function createSessionEvaluator(context: ReplContext): ReplEvaluator {
  return createReplEvaluator({
    db: context.db,
    sql: context.db.sql,
    orm: context.db.orm,
    enums: context.db.enums,
    raw: context.db.raw,
  });
}

export function formatError(error: unknown, color: boolean): string {
  const palette = replPalette(color);
  if (typeof error === 'object' && error !== null) {
    const structured = error as { code?: unknown; message?: unknown };
    if (typeof structured.code === 'string' && typeof structured.message === 'string') {
      return palette.red(`✗ ${structured.code}: ${structured.message}`);
    }
  }
  if (
    error instanceof Error ||
    (typeof error === 'object' && error !== null && 'message' in error)
  ) {
    const err = error as { name?: string; message?: string };
    return palette.red(`✗ ${err.name ?? 'Error'}: ${err.message ?? String(error)}`);
  }
  return palette.red(`✗ ${String(error)}`);
}

/**
 * Evaluates one submission and writes the outcome. Returns true when the
 * submission failed (evaluation or execution error). Throws {@link ExitSignal}
 * when a meta command requests exit.
 */
export async function evaluateAndPrint(
  input: string,
  evaluator: ReplEvaluator,
  options: EvaluatePrintOptions,
): Promise<boolean> {
  const { context, output, color, interactive } = options;

  const meta = runMetaCommand(input, context.schema, { color });
  if (meta.handled) {
    if (meta.clear && interactive) output.write('\x1b[2J\x1b[H');
    if (meta.output) output.write(`${meta.output}\n`);
    if (meta.exit) throw new ExitSignal();
    return false;
  }

  const result = await evaluator.evaluate(input);
  if (!result.ok) {
    output.write(`${formatError(result.error, color)}\n`);
    return true;
  }

  try {
    // Timed around materialization only, so the figure reflects query
    // execution rather than esbuild/vm overhead.
    const started = performance.now();
    const materialized = await materializeResult(result.value, context.executePlan);
    const elapsedMs = performance.now() - started;
    const rendered = materialized.executed
      ? renderResultValue(materialized.value, { color, elapsedMs })
      : renderResultValue(materialized.value, { color });
    output.write(`${rendered}\n`);
    return false;
  } catch (error) {
    output.write(`${formatError(error, color)}\n`);
    return true;
  }
}

export interface BatchSessionOptions {
  readonly context: ReplContext;
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
  readonly color: boolean;
  /** Echo inputs before results. */
  readonly echo?: boolean;
}

export interface BatchSessionResult {
  readonly failures: number;
}

/**
 * Batch mode: reads full stdin, evaluates statement per line (blank lines
 * and `//` comments skipped), and prints each result. Powers piping:
 * `echo "db.sql.public.user.select('id')" | prisma-next repl`.
 */
export async function runBatchSession(options: BatchSessionOptions): Promise<BatchSessionResult> {
  const { context, input, output, color } = options;
  const evaluator = createSessionEvaluator(context);
  const palette = replPalette(color);

  if (input.isTTY) {
    process.stderr.write('reading input from stdin — end with Ctrl+D\n');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.from(chunk));
  }
  const source = Buffer.concat(chunks).toString('utf8');

  let failures = 0;
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('//')) continue;
    if (options.echo) {
      output.write(`${palette.dim(`› ${trimmed}`)}\n`);
    }
    try {
      const failed = await evaluateAndPrint(trimmed, evaluator, {
        context,
        output,
        color,
        interactive: false,
      });
      if (failed) failures++;
    } catch (error) {
      if (error instanceof ExitSignal) return { failures };
      throw error;
    }
  }
  return { failures };
}
