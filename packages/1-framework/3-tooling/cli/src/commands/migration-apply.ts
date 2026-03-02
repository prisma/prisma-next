import { relative, resolve } from 'node:path';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { findLeaf, findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import type { MigrationGraph, MigrationPackage } from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import type { MigrationApplyEdge, MigrationApplyFailure } from '../control-api/types';
import {
  CliStructuredError,
  type CliStructuredError as CliStructuredErrorType,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import { maskConnectionUrl, setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatCommandHelp, formatStyledHeader } from '../utils/output';
import { handleResult } from '../utils/result-handler';

interface MigrationApplyCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly vv?: boolean;
  readonly trace?: boolean;
  readonly timestamps?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
}

export interface MigrationApplyResult {
  readonly ok: boolean;
  readonly migrationsApplied: number;
  readonly migrationsTotal: number;
  readonly markerHash: string;
  readonly applied: readonly {
    readonly dirName: string;
    readonly from: string;
    readonly to: string;
    readonly operationsExecuted: number;
  }[];
  readonly summary: string;
  readonly timings: {
    readonly total: number;
  };
}

function mapMigrationToolsError(error: unknown): CliStructuredErrorType {
  if (MigrationToolsError.is(error)) {
    return errorRuntime(error.message, {
      why: error.why,
      fix: error.fix,
      meta: { code: error.code, ...(error.details ?? {}) },
    });
  }
  return errorUnexpected(error instanceof Error ? error.message : String(error), {
    why: `Unexpected error during migration apply: ${error instanceof Error ? error.message : String(error)}`,
  });
}

function mapApplyFailure(failure: MigrationApplyFailure): CliStructuredErrorType {
  return errorRuntime(failure.summary, {
    why: failure.why ?? 'Migration runner failed',
    fix: 'Fix the issue and re-run `prisma-next migration apply` — previously applied migrations are preserved.',
    meta: failure.meta ?? {},
  });
}

function packageToEdge(pkg: MigrationPackage): MigrationApplyEdge {
  return {
    dirName: pkg.dirName,
    from: pkg.manifest.from,
    to: pkg.manifest.to,
    toContract: pkg.manifest.toContract,
    operations: pkg.ops as MigrationApplyEdge['operations'],
  };
}

async function executeMigrationApplyCommand(
  options: MigrationApplyCommandOptions,
  flags: GlobalFlags,
  startTime: number,
): Promise<Result<MigrationApplyResult, CliStructuredErrorType>> {
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  const migrationsDir = resolve(
    options.config ? resolve(options.config, '..') : process.cwd(),
    config.migrations?.dir ?? 'migrations',
  );
  const migrationsRelative = relative(process.cwd(), migrationsDir);

  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for migration apply (set db.connection in ${configPath}, or pass --db <url>)`,
      }),
    );
  }

  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for migration apply' }));
  }

  if (!config.target.migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  if (flags.json !== 'object' && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
    ];
    if (typeof dbConnection === 'string') {
      details.push({ label: 'database', value: maskConnectionUrl(dbConnection) });
    }
    const header = formatStyledHeader({
      command: 'migration apply',
      description: 'Apply pending migrations to the database',
      url: 'https://pris.ly/migration-apply',
      details,
      flags,
    });
    console.log(header);
  }

  // Read migrations and build DAG (offline — no DB needed)
  let packages: readonly MigrationPackage[];
  try {
    const allPackages = await readMigrationsDir(migrationsDir);
    packages = allPackages.filter((p) => typeof p.manifest.edgeId === 'string');
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

  if (packages.length === 0) {
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
      const markerHash = marker?.storageHash ?? EMPTY_CONTRACT_HASH;
      if (markerHash !== EMPTY_CONTRACT_HASH) {
        return notOk(
          errorRuntime('Database has state but no migrations exist', {
            why: `The database marker hash "${markerHash}" exists but no attested migrations were found in ${migrationsRelative}`,
            fix: 'Ensure the migrations directory is correct, or reset the database with `prisma-next db init`.',
            meta: { markerHash, migrationsDir: migrationsRelative },
          }),
        );
      }
    } finally {
      await client.close();
    }
    return ok({
      ok: true,
      migrationsApplied: 0,
      migrationsTotal: 0,
      markerHash: EMPTY_CONTRACT_HASH,
      applied: [],
      summary: 'No attested migrations found',
      timings: { total: Date.now() - startTime },
    });
  }

  let graph: MigrationGraph;
  let leafHash: string;
  try {
    graph = reconstructGraph(packages);
    leafHash = findLeaf(graph);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

  // Create control client for all DB operations
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
    const markerHash = marker?.storageHash ?? EMPTY_CONTRACT_HASH;

    if (markerHash !== EMPTY_CONTRACT_HASH && !graph.nodes.has(markerHash)) {
      return notOk(
        errorRuntime('Database marker does not match any known migration', {
          why: `The database marker hash "${markerHash}" is not found in the migration history at ${migrationsRelative}`,
          fix: 'Ensure the migrations directory matches this database, or reset the database with `prisma-next db init`.',
          meta: { markerHash, knownNodes: [...graph.nodes] },
        }),
      );
    }

    const pendingPath = findPath(graph, markerHash, leafHash);
    if (!pendingPath) {
      return notOk(
        errorRuntime('No migration path from current state to target', {
          why: `Cannot find a path from marker hash "${markerHash}" to leaf "${leafHash}"`,
          fix: 'Check the migration history for gaps or inconsistencies.',
          meta: { markerHash, leafHash },
        }),
      );
    }

    if (pendingPath.length === 0) {
      return ok({
        ok: true,
        migrationsApplied: 0,
        migrationsTotal: 0,
        markerHash,
        applied: [],
        summary: 'Already up to date',
        timings: { total: Date.now() - startTime },
      });
    }

    // Resolve graph edges to full apply-ready edges
    const packageByDir = new Map(packages.map((pkg) => [pkg.dirName, pkg]));
    const pendingEdges: MigrationApplyEdge[] = [];
    for (const edge of pendingPath) {
      const pkg = packageByDir.get(edge.dirName);
      if (!pkg) {
        return notOk(
          errorRuntime(`Migration package not found: ${edge.dirName}`, {
            why: `The migration directory for edge ${edge.from} → ${edge.to} was not found`,
            fix: 'Ensure all migration directories are present and intact.',
          }),
        );
      }
      pendingEdges.push(packageToEdge(pkg));
    }

    if (!flags.quiet && flags.json !== 'object') {
      for (const edge of pendingEdges) {
        console.log(`  Applying ${edge.dirName}...`);
      }
    }

    const applyResult = await client.migrationApply({ pendingEdges });

    if (!applyResult.ok) {
      return notOk(mapApplyFailure(applyResult.failure));
    }

    const { value } = applyResult;

    return ok({
      ok: true,
      migrationsApplied: value.migrationsApplied,
      migrationsTotal: pendingPath.length,
      markerHash: value.markerHash,
      applied: value.applied,
      summary: value.summary,
      timings: { total: Date.now() - startTime },
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during migration apply: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createMigrationApplyCommand(): Command {
  const command = new Command('apply');
  setCommandDescriptions(
    command,
    'Apply pending migrations to the database',
    'Reads on-disk migration packages, determines which are pending by comparing\n' +
      'the database marker against the migration DAG, and executes each pending\n' +
      'migration sequentially. Each migration runs in its own transaction.',
  );
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const defaultFlags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags: defaultFlags });
      },
    })
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: MigrationApplyCommandOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      const result = await executeMigrationApplyCommand(options, flags, startTime);

      const exitCode = handleResult(result, flags, (applyResult) => {
        if (flags.json === 'object') {
          console.log(JSON.stringify(applyResult, null, 2));
        } else if (!flags.quiet) {
          console.log(formatMigrationApplyOutput(applyResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}

function formatMigrationApplyOutput(result: MigrationApplyResult, flags: GlobalFlags): string {
  const lines: string[] = [];
  const useColor = flags.color !== false;

  const green_ = useColor ? (s: string) => `\x1b[32m${s}\x1b[0m` : (s: string) => s;
  const dim_ = useColor ? (s: string) => `\x1b[2m${s}\x1b[0m` : (s: string) => s;

  if (result.migrationsApplied === 0) {
    lines.push(`${green_('✔')} ${result.summary}`);
    lines.push(dim_(`  marker: ${result.markerHash}`));
    return lines.join('\n');
  }

  lines.push(`${green_('✔')} ${result.summary}`);
  lines.push('');

  for (let i = 0; i < result.applied.length; i++) {
    const m = result.applied[i]!;
    const isLast = i === result.applied.length - 1;
    const treeChar = isLast ? '└' : '├';
    lines.push(`${dim_(treeChar)}─ ${m.dirName} ${dim_(`[${m.operationsExecuted} op(s)]`)}`);
  }

  lines.push('');
  lines.push(dim_(`marker: ${result.markerHash}`));

  if (flags.verbose && result.timings) {
    lines.push('');
    lines.push(dim_(`Total time: ${result.timings.total}ms`));
  }

  return lines.join('\n');
}
