/**
 * Interactive REPL session: the banner, the raw-mode read-eval-print loop,
 * and SIGINT scoping. The evaluate/print pipeline and batch mode live in
 * `batch.ts`.
 */
import packageJson from '../../package.json' with { type: 'json' };
import { createSessionEvaluator, evaluateAndPrint, ExitSignal } from './batch';
import { complete } from './completion';
import type { EditorContext } from './editor-state';
import { createLineEditor } from './line-editor';
import type { ReplContext } from './load-repl-context';
import { replPalette } from './palette';

export interface InteractiveSessionOptions {
  readonly context: ReplContext;
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
  readonly color: boolean;
}

export function renderBanner(context: ReplContext, color: boolean): string {
  const p = replPalette(color);
  const tables = Object.values(context.schema.namespaces).reduce(
    (count, ns) => count + Object.keys(ns.tables).length,
    0,
  );
  return [
    `${p.bold('Prisma Next')} repl ${p.dim(`v${packageJson.version}`)}`,
    `${p.cyan('●')} ${context.targetId} ${p.dim(context.dbUrlMasked)} ${p.dim(`· ${tables} tables`)}`,
    p.dim('Type a query — it runs on Enter. Tab completes. .help for commands.'),
    '',
  ].join('\n');
}

/**
 * While the session owns the terminal, the CLI's global SIGINT handler
 * (which aborts and force-exits after a grace period) must not fire: at the
 * prompt Ctrl+C arrives as a raw-mode keypress, but during evaluation it
 * would raise SIGINT and kill the whole session seconds later. Swap in a
 * no-op handler for the session's lifetime and restore on exit.
 */
function scopeSigint(): () => void {
  const previous = process.listeners('SIGINT');
  process.removeAllListeners('SIGINT');
  const onSigint = (): void => {
    process.stderr.write('\n(press Ctrl+C at the prompt to clear the line, Ctrl+D to exit)\n');
  };
  process.on('SIGINT', onSigint);
  return () => {
    process.removeListener('SIGINT', onSigint);
    for (const listener of previous) {
      process.on('SIGINT', listener);
    }
  };
}

export async function runInteractiveSession(options: InteractiveSessionOptions): Promise<void> {
  const { context, input, output, color } = options;
  const p = replPalette(color);
  const evaluator = createSessionEvaluator(context);

  const history: string[] = [];
  const editorCtx: EditorContext = {
    complete: (buffer, cursor) => complete(buffer, cursor, context.schema, evaluator.globalNames()),
    history,
    historyGhost: (prefix) => {
      for (let i = history.length - 1; i >= 0; i--) {
        const entry = history[i]!;
        // Multiline entries cannot render as an inline ghost suffix.
        if (entry.includes('\n')) continue;
        if (entry.startsWith(prefix) && entry !== prefix) return entry;
      }
      return null;
    },
  };

  output.write(renderBanner(context, color));

  const editor = createLineEditor({
    input,
    output,
    prompt: color ? `${p.cyan('prisma')}${p.dim('›')} ` : 'prisma› ',
    continuationPrompt: color ? p.dim('     … ') : '     … ',
    color,
    ctx: editorCtx,
  });

  const restoreSigint = scopeSigint();
  try {
    while (true) {
      const line = await editor.readLine();
      if (line === null) break;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (history[history.length - 1] !== line) history.push(line);
      try {
        await evaluateAndPrint(trimmed, evaluator, {
          context,
          output,
          color,
          interactive: true,
        });
      } catch (error) {
        if (error instanceof ExitSignal) break;
        throw error;
      }
    }
  } finally {
    restoreSigint();
    editor.close();
  }
}
