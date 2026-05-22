import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { findPath } from '@prisma-next/migration-tools/migration-graph';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  type CliStructuredError,
  errorUnexpected,
  mapMigrationToolsError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  loadMigrationPackages,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationListOptions extends CommonCommandOptions {
  readonly config?: string;
}

export interface MigrationListEntry {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly migrationHash: string;
  readonly operationCount: number;
  readonly createdAt: string;
}

export interface MigrationListResult {
  readonly ok: true;
  readonly migrations: readonly MigrationListEntry[];
  readonly summary: string;
}

async function executeMigrationListCommand(
  options: MigrationListOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationListResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, appMigrationsDir, appMigrationsRelative } = resolveMigrationPaths(
    options.config,
    config,
  );

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration list',
      description: 'List on-disk migrations in topological order',
      details: [
        { label: 'config', value: configPath },
        { label: 'migrations', value: appMigrationsRelative },
      ],
      flags,
    });
    ui.stderr(header);
  }

  let bundles: Awaited<ReturnType<typeof loadMigrationPackages>>['bundles'];
  let graph: Awaited<ReturnType<typeof loadMigrationPackages>>['graph'];
  try {
    ({ bundles, graph } = await loadMigrationPackages(appMigrationsDir));
  } catch (error) {
    if (MigrationToolsError.is(error)) return notOk(mapMigrationToolsError(error));
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migrations: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  if (bundles.length === 0) {
    return ok({ ok: true, migrations: [], summary: 'No migrations found' });
  }

  const leaves = [...graph.nodes].filter(
    (n) => !graph.forwardChain.has(n) || graph.forwardChain.get(n)!.length === 0,
  );
  const targetHash =
    leaves.length === 1 ? leaves[0]! : ([...graph.nodes].values().next().value as string);
  const chain = findPath(graph, EMPTY_CONTRACT_HASH, targetHash) ?? [];

  const pkgByDirName = new Map(bundles.map((p) => [p.dirName, p]));
  const entries: MigrationListEntry[] = chain.map((edge) => {
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
    migrations: entries,
    summary: `${entries.length} migration(s) on disk`,
  });
}

export function createMigrationListCommand(): Command {
  const command = new Command('list');
  setCommandDescriptions(
    command,
    'List on-disk migrations in topological order',
    'Enumerates all migration packages under migrations/<space>/ in\n' +
      'topological order. Offline — does not consult the database.',
  );
  setCommandExamples(command, ['prisma-next migration list']);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration log', oneLiner: 'Show executed migration history' },
    { verb: 'migration graph', oneLiner: 'Show the migration graph topology' },
    { verb: 'migration show', oneLiner: 'Display migration package contents' },
  ]);
  addGlobalOptions(command)
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: MigrationListOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const result = await executeMigrationListCommand(options, flags, ui);
      const exitCode = handleResult(result, flags, ui, (listResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(listResult, null, 2));
        } else if (!flags.quiet) {
          if (listResult.migrations.length === 0) {
            ui.log('No migrations found');
          } else {
            for (const entry of listResult.migrations) {
              ui.log(
                `${entry.dirName}  ${entry.migrationHash.slice(0, 16)}…  ${entry.operationCount} op(s)`,
              );
            }
            ui.log(`\n${listResult.summary}`);
          }
        }
      });
      process.exit(exitCode);
    });
  return command;
}
