import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorUnexpected,
  mapMigrationToolsError,
  requireLiveDatabase,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  maskConnectionUrl,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
  targetSupportsMigrations,
} from '../utils/command-helpers';
import { createAnsiMigrationListStyler } from '../utils/formatters/migration-list-styler';
import {
  MIGRATION_LOG_EMPTY_MESSAGE,
  renderMigrationLogTable,
  type SerializedLedgerEntryRecord,
  serializeLedgerEntriesForJson,
} from '../utils/formatters/migration-log-table';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationLogOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly utc?: boolean;
}

export interface MigrationLogResult {
  readonly ok: true;
  readonly entries: readonly SerializedLedgerEntryRecord[];
}

export async function executeMigrationLogCommand(
  options: MigrationLogOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<readonly LedgerEntryRecord[], CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath } = resolveMigrationPaths(options.config, config);

  const dbConnection = options.db ?? config.db?.connection;
  const missingDb = requireLiveDatabase({
    dbConnection,
    hasDriver: !!config.driver,
    why: `migration log needs a database connection and driver to read the ledger (set db.connection in ${configPath}, or pass --db <url>)`,
    commandName: 'migration log',
  });
  if (missingDb) {
    return notOk(missingDb);
  }
  if (!targetSupportsMigrations(config.target)) {
    return notOk(errorUnexpected('Target does not support migrations'));
  }

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration log',
      description: 'Show executed migration history from the database ledger',
      details: [
        { label: 'config', value: configPath },
        ...(typeof dbConnection === 'string'
          ? [{ label: 'database', value: maskConnectionUrl(dbConnection) }]
          : []),
      ],
      flags,
    });
    ui.stderr(header);
  }

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    ...ifDefined('driver', config.driver),
    extensionPacks: config.extensionPacks ?? [],
  });

  try {
    await client.connect(dbConnection);
    const ledger = await client.readLedger();
    return ok(ledger);
  } catch (error) {
    if (CliStructuredError.is(error)) return notOk(error);
    if (MigrationToolsError.is(error)) return notOk(mapMigrationToolsError(error));
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migration log: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createMigrationLogCommand(): Command {
  const command = new Command('log');
  setCommandDescriptions(
    command,
    'Show executed migration history',
    'Reads the database ledger and displays every applied migration edge\n' +
      'in chronological order, including rollbacks and re-applies.',
  );
  setCommandExamples(command, [
    'prisma-next migration log --db $DATABASE_URL',
    'prisma-next migration log --utc --db $DATABASE_URL',
    'prisma-next migration log --json --db $DATABASE_URL',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration list', oneLiner: 'List on-disk migrations' },
    { verb: 'migration graph', oneLiner: 'Show the migration graph topology' },
    { verb: 'migration show', oneLiner: 'Display migration package contents' },
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--utc', 'Render human timestamps in UTC instead of local time')
    .action(async (options: MigrationLogOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const result = await executeMigrationLogCommand(options, flags, ui);
      const exitCode = handleResult(result, flags, ui, (entries) => {
        if (flags.json) {
          const result: MigrationLogResult = {
            ok: true,
            entries: serializeLedgerEntriesForJson(entries),
          };
          ui.output(JSON.stringify(result, null, 2));
        } else if (!flags.quiet) {
          if (entries.length === 0) {
            ui.output(MIGRATION_LOG_EMPTY_MESSAGE);
          } else {
            const styler = createAnsiMigrationListStyler({ useColor: ui.useColor });
            ui.output(renderMigrationLogTable(entries, { utc: options.utc === true, styler }));
          }
        }
      });
      process.exit(exitCode);
    });
  return command;
}
