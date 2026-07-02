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

export function createReplCommand(): Command {
  const command = new Command('repl');
  setCommandDescriptions(
    command,
    'Interactive query console',
    'Starts an interactive console connected to your database. Type any Prisma Next\n' +
      'query — SQL lane or ORM lane — and it executes on Enter; builders and plans run\n' +
      'without .build() or execute(). Tab completes tables, columns, and methods from\n' +
      'your contract. Plain TypeScript works too. When stdin is piped, each line is\n' +
      'evaluated in order and results stream to stdout.',
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
      const [{ loadReplContext }, { runBatchSession, runInteractiveSession }] = await Promise.all([
        import('../repl/load-repl-context'),
        import('../repl/session'),
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
      const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
      const color = flags.color === true;

      try {
        if (interactive) {
          await runInteractiveSession({
            context,
            input: process.stdin,
            output: process.stdout,
            color,
          });
        } else {
          await runBatchSession({
            context,
            input: process.stdin,
            output: process.stdout,
            color,
            echo: true,
          });
        }
        process.exitCode = 0;
      } catch (error) {
        ui.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      } finally {
        await context.close();
      }
      process.exit(process.exitCode ?? 0);
    });

  return command;
}
