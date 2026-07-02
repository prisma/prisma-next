/**
 * REPL session orchestration: the banner, the read-eval-print loop, and the
 * non-interactive (piped stdin) batch mode.
 */
import { createColors } from 'colorette';
import packageJson from '../../package.json' with { type: 'json' };
import { complete } from './completion';
import type { EditorContext } from './editor-state';
import { createReplEvaluator, type ReplEvaluator } from './evaluator';
import { createLineEditor } from './line-editor';
import type { ReplContext } from './load-repl-context';
import { materializeResult } from './materialize';
import { runMetaCommand } from './meta-commands';
import { renderResultValue } from './render';

// The session's `color` flag is authoritative (TTY + --color/--no-color).
const { bold, cyan, dim, red } = createColors({ useColor: true });

export interface ReplSessionOptions {
  readonly context: ReplContext;
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
  readonly color: boolean;
  /** Echo inputs before results — used by non-interactive mode. */
  readonly echo?: boolean;
}

function formatError(error: unknown, color: boolean): string {
  const paint = (text: string) => (color ? red(text) : text);
  if (typeof error === 'object' && error !== null) {
    const structured = error as { code?: unknown; message?: unknown };
    if (typeof structured.code === 'string' && typeof structured.message === 'string') {
      return paint(`✗ ${structured.code}: ${structured.message}`);
    }
  }
  if (
    error instanceof Error ||
    (typeof error === 'object' && error !== null && 'message' in error)
  ) {
    const err = error as { name?: string; message?: string };
    return paint(`✗ ${err.name ?? 'Error'}: ${err.message ?? String(error)}`);
  }
  return paint(`✗ ${String(error)}`);
}

export function renderBanner(context: ReplContext, color: boolean): string {
  const paint = (text: string, fn: (s: string) => string) => (color ? fn(text) : text);
  const tables = Object.values(context.schema.namespaces).reduce(
    (count, ns) => count + Object.keys(ns.tables).length,
    0,
  );
  return [
    `${paint('Prisma Next', bold)} repl ${paint(`v${packageJson.version}`, dim)}`,
    `${paint('●', cyan)} ${context.targetId} ${paint(context.dbUrlMasked, dim)} ${paint(`· ${tables} tables`, dim)}`,
    paint('Type a query — it runs on Enter. Tab completes. .help for commands.', dim),
    '',
  ].join('\n');
}

async function evaluateAndPrint(
  input: string,
  evaluator: ReplEvaluator,
  options: ReplSessionOptions,
): Promise<void> {
  const { context, output, color } = options;

  const meta = runMetaCommand(input, context.schema, { color });
  if (meta.handled) {
    if (meta.clear) output.write('\x1b[2J\x1b[H');
    if (meta.output) output.write(`${meta.output}\n`);
    if (meta.exit) throw new ExitSignal();
    return;
  }

  const started = performance.now();
  const result = await evaluator.evaluate(input);
  if (!result.ok) {
    output.write(`${formatError(result.error, color)}\n`);
    return;
  }

  try {
    const materialized = await materializeResult(result.value, context.executePlan);
    const elapsedMs = performance.now() - started;
    const rendered = materialized.executed
      ? renderResultValue(materialized.value, { color, elapsedMs })
      : renderResultValue(materialized.value, { color });
    output.write(`${rendered}\n`);
  } catch (error) {
    output.write(`${formatError(error, color)}\n`);
  }
}

class ExitSignal extends Error {}

export async function runInteractiveSession(options: ReplSessionOptions): Promise<void> {
  const { context, input, output, color } = options;
  const evaluator = createReplEvaluator({
    db: context.db,
    sql: context.db.sql,
    orm: context.db.orm,
    enums: context.db.enums,
    raw: context.db.raw,
  });

  const history: string[] = [];
  const editorCtx: EditorContext = {
    complete: (buffer, cursor) => complete(buffer, cursor, context.schema, evaluator.globalNames()),
    history,
    historyGhost: (prefix) => {
      for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i]!;
        if (entry.startsWith(prefix) && entry !== prefix) return entry;
      }
      return null;
    },
  };

  output.write(renderBanner(context, color));

  const editor = createLineEditor({
    input,
    output,
    prompt: color ? `${cyan('prisma')}${dim('›')} ` : 'prisma› ',
    continuationPrompt: color ? dim('     … ') : '     … ',
    color,
    ctx: editorCtx,
  });

  try {
    while (true) {
      const line = await editor.readLine();
      if (line === null) break;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (history[history.length - 1] !== line) history.push(line);
      try {
        await evaluateAndPrint(trimmed, evaluator, options);
      } catch (error) {
        if (error instanceof ExitSignal) break;
        throw error;
      }
    }
  } finally {
    editor.close();
  }
}

/**
 * Batch mode: reads full stdin, evaluates statement per line (blank lines
 * and `//` comments skipped), and prints each result. Powers piping:
 * `echo "db.sql.public.user.select('id')" | prisma-next repl`.
 */
export async function runBatchSession(options: ReplSessionOptions): Promise<void> {
  const { context, input, output, color } = options;
  const evaluator = createReplEvaluator({
    db: context.db,
    sql: context.db.sql,
    orm: context.db.orm,
    enums: context.db.enums,
    raw: context.db.raw,
  });

  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.from(chunk));
  }
  const source = Buffer.concat(chunks).toString('utf8');

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('//')) continue;
    if (options.echo) {
      output.write(`${color ? dim(`› ${trimmed}`) : `› ${trimmed}`}\n`);
    }
    try {
      await evaluateAndPrint(trimmed, evaluator, options);
    } catch (error) {
      if (error instanceof ExitSignal) return;
      throw error;
    }
  }
}
