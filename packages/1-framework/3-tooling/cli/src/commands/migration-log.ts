import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { findPath } from '@prisma-next/migration-tools/migration-graph';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { cyan, dim } from 'colorette';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorUnexpected,
  mapMigrationToolsError,
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
import { buildReadAggregate } from '../utils/contract-space-aggregate-loader';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationLogOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
}

export interface MigrationLogEntry {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly migrationHash: string;
  readonly operationCount: number;
  readonly createdAt: string;
}

export interface MigrationLogResult {
  readonly ok: true;
  readonly markerHash: string | null;
  readonly applied: readonly MigrationLogEntry[];
  readonly summary: string;
}

export async function executeMigrationLogCommand(
  options: MigrationLogOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationLogResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, appMigrationsRelative, migrationsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for migration log (set db.connection in ${configPath}, or pass --db <url>)`,
        commandName: 'migration log',
      }),
    );
  }
  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for migration log' }));
  }
  if (!targetSupportsMigrations(config.target)) {
    return notOk(errorUnexpected('Target does not support migrations'));
  }

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration log',
      description: 'Show executed migration history',
      details: [
        { label: 'config', value: configPath },
        { label: 'migrations', value: appMigrationsRelative },
        ...(typeof dbConnection === 'string'
          ? [{ label: 'database', value: maskConnectionUrl(dbConnection) }]
          : []),
      ],
      flags,
    });
    ui.stderr(header);
  }

  const loaded = await buildReadAggregate(config, { migrationsDir });
  if (!loaded.ok) {
    return loaded;
  }
  const graph = loaded.value.aggregate.app.graph();
  const bundles = loaded.value.aggregate.app.packages;

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });

  try {
    await client.connect(dbConnection);
    const marker = await client.readMarker();
    const markerHash = marker?.storageHash ?? null;

    if (!markerHash) {
      return ok({
        ok: true,
        markerHash: null,
        applied: [],
        summary: 'No migrations applied (database has no marker)',
      });
    }

    const appliedPath = findPath(graph, EMPTY_CONTRACT_HASH, markerHash);
    if (appliedPath === null) {
      return notOk(
        errorUnexpected('Database marker is not reachable from migration history', {
          why: `Marker hash ${markerHash} is not reachable from the root of the on-disk migration graph.`,
          fix: 'The database may have been migrated outside this project. Use `migration status` to inspect the current state.',
        }),
      );
    }
    const pkgByDirName = new Map(bundles.map((p) => [p.dirName, p]));
    const entries: MigrationLogEntry[] = appliedPath.map((edge) => {
      const pkg = pkgByDirName.get(edge.dirName);
      const ops = (pkg?.ops ?? []) as readonly MigrationPlanOperation[];
      return {
        dirName: edge.dirName,
        from: edge.from,
        to: edge.to,
        migrationHash: edge.migrationHash,
        operationCount: ops.length,
        createdAt: edge.createdAt,
      };
    });

    return ok({
      ok: true,
      markerHash,
      applied: entries,
      summary: `${entries.length} migration(s) applied`,
    });
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
    'Reads the database marker and displays the applied migration chain\n' +
      'from the initial state to the current marker position.',
  );
  setCommandExamples(command, [
    'prisma-next migration log --db $DATABASE_URL',
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
    .action(async (options: MigrationLogOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const result = await executeMigrationLogCommand(options, flags, ui);
      const exitCode = handleResult(result, flags, ui, (logResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(logResult, null, 2));
        } else if (!flags.quiet) {
          const c = (fn: (s: string) => string, s: string) => (flags.color !== false ? fn(s) : s);
          if (logResult.applied.length === 0) {
            ui.log(logResult.summary);
          } else {
            for (const entry of logResult.applied) {
              ui.log(
                `${c(cyan, '✓')} ${entry.dirName}  ${c(dim, entry.migrationHash.slice(0, 16) + '…')}  ${entry.operationCount} op(s)`,
              );
            }
            ui.log(`\n${logResult.summary}`);
          }
        }
      });
      process.exit(exitCode);
    });
  return command;
}
