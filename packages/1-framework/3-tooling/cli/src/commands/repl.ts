import { Command } from 'commander';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import type { CommonCommandOptions } from '../utils/global-flags';
import { parseGlobalFlagsOrExit } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI } from '../utils/terminal-ui';

interface ReplCommandOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
}

/** Resolves once queued stdout writes have reached the OS, then exits. */
function flushAndExit(code: number): void {
  process.exitCode = code;
  process.stdout.write('', () => process.exit(code));
}

export function createReplCommand(): Command {
  const command = new Command('repl');
  setCommandDescriptions(
    command,
    'Interactive query console',
    'Starts an interactive console connected to your database. Type any Prisma Next\n' +
      'query — SQL lane or ORM lane — and it executes on Enter; builders and plans run\n' +
      'without .build() or execute(). Tab completes tables, columns, and methods from\n' +
      'your contract. Plain TypeScript works too. When stdin is piped, each line is\n' +
      'evaluated in order, results stream to stdout, and the exit code is 1 when any\n' +
      'line fails.',
  );
  setCommandExamples(command, [
    'prisma-next repl',
    'prisma-next repl --db $DATABASE_URL',
    `echo "db.sql.public.user.select('id').limit(5)" | prisma-next repl`,
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: ReplCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);

      // Loaded lazily so the repl's heavier dependencies (esbuild for TS
      // stripping, the line editor) never tax the startup time of other
      // commands bundled into the same CLI entry.
      const [{ loadReplContext }, { runInteractiveSession }, { runBatchSession }] =
        await Promise.all([
          import('../repl/load-repl-context'),
          import('../repl/session'),
          import('../repl/batch'),
        ]);

      const result = await loadReplContext({
        ...(options.db !== undefined ? { db: options.db } : {}),
        ...(options.config !== undefined ? { config: options.config } : {}),
      });

      if (!result.ok) {
        const exitCode = handleResult(result, flags, ui, () => undefined);
        process.exit(exitCode);
      }

      const context = result.value;
      const interactive =
        flags.interactive !== false &&
        process.stdin.isTTY === true &&
        process.stdout.isTTY === true;
      const color = flags.color === true;

      let exitCode = 0;
      try {
        if (interactive) {
          await runInteractiveSession({
            context,
            input: process.stdin,
            output: process.stdout,
            color,
          });
        } else {
          const { failures } = await runBatchSession({
            context,
            input: process.stdin,
            output: process.stdout,
            color,
            echo: true,
          });
          if (failures > 0) exitCode = 1;
        }
      } catch (error) {
        ui.error(error instanceof Error ? error.message : String(error));
        exitCode = 1;
      } finally {
        await context.close();
      }
      flushAndExit(exitCode);
    });

  return command;
}
