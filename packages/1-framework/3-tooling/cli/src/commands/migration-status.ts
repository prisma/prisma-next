import { readFile } from 'node:fs/promises';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { findLeaf, findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import type {
  MigrationGraph,
  MigrationGraphEdge,
  MigrationPackage,
} from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import {
  maskConnectionUrl,
  resolveContractPath,
  setCommandDescriptions,
} from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatMigrationStatusOutput,
  formatStyledHeader,
} from '../utils/output';
import { handleResult } from '../utils/result-handler';

interface MigrationStatusOptions {
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

export interface MigrationStatusEntry {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly edgeId: string | null;
  readonly operationCount: number;
  readonly operationSummary: string;
  readonly hasDestructive: boolean;
  readonly status: 'applied' | 'pending' | 'unknown';
}

export interface StatusDiagnostic {
  readonly code: string;
  readonly severity: 'warn' | 'info';
  readonly message: string;
  readonly hints: readonly string[];
}

export interface MigrationStatusResult {
  readonly ok: true;
  readonly mode: 'online' | 'offline';
  readonly migrations: readonly MigrationStatusEntry[];
  readonly markerHash?: string;
  readonly leafHash: string;
  readonly contractHash: string;
  readonly summary: string;
  readonly diagnostics: readonly StatusDiagnostic[];
}

function summarizeOps(ops: readonly MigrationPlanOperation[]): {
  summary: string;
  hasDestructive: boolean;
} {
  if (ops.length === 0) return { summary: '0 ops', hasDestructive: false };

  const classes = new Map<string, number>();
  for (const op of ops) {
    classes.set(op.operationClass, (classes.get(op.operationClass) ?? 0) + 1);
  }

  const hasDestructive = classes.has('destructive');
  const count = ops.length;
  const noun = count === 1 ? 'op' : 'ops';

  if (classes.size === 1) {
    const cls = [...classes.keys()][0]!;
    return { summary: `${count} ${noun} (all ${cls})`, hasDestructive };
  }

  const destructiveCount = classes.get('destructive');
  if (destructiveCount) {
    return { summary: `${count} ${noun} (${destructiveCount} destructive)`, hasDestructive };
  }

  const parts = [...classes.entries()].map(([cls, n]) => `${n} ${cls}`);
  return { summary: `${count} ${noun} (${parts.join(', ')})`, hasDestructive };
}

export function buildMigrationEntries(
  chain: readonly MigrationGraphEdge[],
  packages: readonly MigrationPackage[],
  markerHash: string | undefined,
): MigrationStatusEntry[] {
  const pkgByDirName = new Map(packages.map((p) => [p.dirName, p]));

  const markerInChain =
    markerHash === undefined ||
    markerHash === EMPTY_CONTRACT_HASH ||
    chain.some((e) => e.to === markerHash);

  const entries: MigrationStatusEntry[] = [];
  let reachedMarker = markerHash === undefined || markerHash === EMPTY_CONTRACT_HASH;

  for (const edge of chain) {
    const pkg = pkgByDirName.get(edge.dirName);
    const ops = (pkg?.ops ?? []) as readonly MigrationPlanOperation[];
    const { summary, hasDestructive } = summarizeOps(ops);

    let status: 'applied' | 'pending' | 'unknown';
    if (markerHash === undefined || !markerInChain) {
      status = 'unknown';
    } else if (reachedMarker) {
      status = 'pending';
    } else {
      status = 'applied';
    }

    entries.push({
      dirName: edge.dirName,
      from: edge.from,
      to: edge.to,
      edgeId: edge.edgeId,
      operationCount: ops.length,
      operationSummary: summary,
      hasDestructive,
      status,
    });

    if (!reachedMarker && edge.to === markerHash) {
      reachedMarker = true;
    }
  }

  return entries;
}

async function executeMigrationStatusCommand(
  options: MigrationStatusOptions,
  flags: GlobalFlags,
): Promise<Result<MigrationStatusResult, CliStructuredError>> {
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
  const hasDriver = !!config.driver;

  if (flags.json !== 'object' && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
    ];
    if (dbConnection && hasDriver) {
      details.push({ label: 'database', value: maskConnectionUrl(String(dbConnection)) });
    }
    const header = formatStyledHeader({
      command: 'migration status',
      description: 'Show migration graph and applied status',
      details,
      flags,
    });
    console.log(header);
  }

  const diagnostics: StatusDiagnostic[] = [];
  let contractHash: string = EMPTY_CONTRACT_HASH;
  try {
    const contractPathAbsolute = resolveContractPath(config);
    const contractContent = await readFile(contractPathAbsolute, 'utf-8');
    try {
      const contractRaw = JSON.parse(contractContent) as Record<string, unknown>;
      const hash = contractRaw['storageHash'];
      if (typeof hash === 'string') {
        contractHash = hash;
      } else {
        diagnostics.push({
          code: 'CONTRACT.MISSING_HASH',
          severity: 'warn',
          message: 'Contract file exists but has no storageHash field',
          hints: ["Run 'prisma-next contract emit' to regenerate the contract"],
        });
      }
    } catch {
      diagnostics.push({
        code: 'CONTRACT.INVALID_JSON',
        severity: 'warn',
        message: 'Contract file contains invalid JSON',
        hints: ["Run 'prisma-next contract emit' to regenerate the contract"],
      });
    }
  } catch {
    diagnostics.push({
      code: 'CONTRACT.UNREADABLE',
      severity: 'warn',
      message: 'Could not read contract file — contract state unknown',
      hints: ["Run 'prisma-next contract emit' to generate a contract"],
    });
  }

  let allPackages: readonly MigrationPackage[];
  try {
    allPackages = await readMigrationsDir(migrationsDir);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(
        errorRuntime(error.message, { why: error.why, fix: error.fix, meta: { code: error.code } }),
      );
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migrations directory: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  const attested = allPackages.filter((p) => typeof p.manifest.edgeId === 'string');

  if (attested.length === 0) {
    if (contractHash !== EMPTY_CONTRACT_HASH) {
      diagnostics.push({
        code: 'CONTRACT.AHEAD',
        severity: 'warn',
        message: 'Contract has changed since the last migration was planned',
        hints: [
          "Run 'prisma-next migration plan' to generate a migration for the current contract",
        ],
      });
    }
    return ok({
      ok: true,
      mode: dbConnection && hasDriver ? 'online' : 'offline',
      migrations: [],
      leafHash: EMPTY_CONTRACT_HASH,
      contractHash,
      summary: 'No migrations found',
      diagnostics,
    });
  }

  let graph: MigrationGraph;
  let leafHash: string;
  try {
    graph = reconstructGraph(attested);
    leafHash = findLeaf(graph);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(
        errorRuntime(error.message, { why: error.why, fix: error.fix, meta: { code: error.code } }),
      );
    }
    throw error;
  }

  const chain = findPath(graph, EMPTY_CONTRACT_HASH, leafHash);
  if (!chain) {
    return notOk(
      errorRuntime('Cannot reconstruct migration chain', {
        why: `No path from ${EMPTY_CONTRACT_HASH} to leaf ${leafHash}`,
        fix: 'The migration history may have gaps. Check the migrations directory for missing or corrupted packages.',
      }),
    );
  }

  let markerHash: string | undefined;
  let mode: 'online' | 'offline' = 'offline';

  if (dbConnection && hasDriver) {
    try {
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
        markerHash = marker?.storageHash ?? EMPTY_CONTRACT_HASH;
        mode = 'online';
      } finally {
        await client.close();
      }
    } catch {
      if (flags.json !== 'object' && !flags.quiet) {
        console.log('  ⚠ Could not connect to database — showing offline status\n');
      }
    }
  }

  const entries = buildMigrationEntries(
    chain,
    attested,
    mode === 'online' ? markerHash : undefined,
  );

  const markerInChain =
    markerHash === undefined ||
    markerHash === EMPTY_CONTRACT_HASH ||
    chain.some((e) => e.to === markerHash);

  let summary: string;
  if (mode === 'online') {
    if (!markerInChain) {
      summary = `Database marker does not match any migration — was the database managed with 'db update'?`;
    } else {
      const pendingCount = entries.filter((e) => e.status === 'pending').length;
      const appliedCount = entries.filter((e) => e.status === 'applied').length;
      if (pendingCount === 0) {
        summary = `Database is up to date (${appliedCount} migration${appliedCount !== 1 ? 's' : ''} applied)`;
      } else if (markerHash === EMPTY_CONTRACT_HASH) {
        summary = `${pendingCount} pending migration(s) — database has no marker`;
      } else {
        summary = `${pendingCount} pending migration(s) — run 'prisma-next migration apply' to apply`;
      }
    }
  } else {
    summary = `${entries.length} migration(s) on disk`;
  }

  if (contractHash !== EMPTY_CONTRACT_HASH && contractHash !== leafHash) {
    diagnostics.push({
      code: 'CONTRACT.AHEAD',
      severity: 'warn',
      message: 'Contract has changed since the last migration was planned',
      hints: ["Run 'prisma-next migration plan' to generate a migration for the current contract"],
    });
  }

  if (mode === 'online') {
    const pendingCount = entries.filter((e) => e.status === 'pending').length;
    if (!markerInChain) {
      diagnostics.push({
        code: 'MIGRATION.MARKER_DIVERGED',
        severity: 'warn',
        message: 'Database marker does not match any migration in the chain',
        hints: [
          "The database may have been managed with 'db update' instead of migrations",
          "Run 'prisma-next db verify' to inspect the database state",
        ],
      });
    } else if (pendingCount > 0) {
      diagnostics.push({
        code: 'MIGRATION.DATABASE_BEHIND',
        severity: 'info',
        message: `${pendingCount} migration(s) pending`,
        hints: ["Run 'prisma-next migration apply' to apply pending migrations"],
      });
    } else {
      diagnostics.push({
        code: 'MIGRATION.UP_TO_DATE',
        severity: 'info',
        message: 'Database is up to date',
        hints: [],
      });
    }
  }

  const result: MigrationStatusResult = {
    ok: true,
    mode,
    migrations: entries,
    leafHash,
    contractHash,
    summary,
    diagnostics,
    ...(markerHash !== undefined ? { markerHash } : {}),
  };
  return ok(result);
}

export function createMigrationStatusCommand(): Command {
  const command = new Command('status');
  setCommandDescriptions(
    command,
    'Show migration graph and applied status',
    'Displays the migration graph as a linear chain. When a database connection\n' +
      'is available, shows which migrations are applied and which are pending.\n' +
      'Without a database connection, shows the graph from disk only.',
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
    .option('-v, --verbose', 'Verbose output')
    .option('-vv, --trace', 'Trace output')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: MigrationStatusOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await executeMigrationStatusCommand(options, flags);

      const exitCode = handleResult(result, flags, (statusResult) => {
        if (flags.json === 'object') {
          console.log(JSON.stringify(statusResult, null, 2));
        } else if (!flags.quiet) {
          console.log(formatMigrationStatusOutput(statusResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
