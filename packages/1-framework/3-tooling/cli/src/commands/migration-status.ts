import { readFile } from 'node:fs/promises';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import {
  findLeaf,
  findPath,
  findPathWithDecision,
  reconstructGraph,
} from '@prisma-next/migration-tools/dag';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import { readRefs, resolveRef } from '@prisma-next/migration-tools/refs';
import type {
  MigrationChainEntry,
  MigrationGraph,
  MigrationPackage,
} from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import {
  addGlobalOptions,
  maskConnectionUrl,
  resolveContractPath,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatMigrationStatusOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationStatusOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly ref?: string;
}

export interface MigrationStatusEntry {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly migrationId: string | null;
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
  readonly targetHash: string;
  readonly contractHash: string;
  readonly refName?: string;
  readonly refHash?: string;
  readonly pathDecision?: {
    readonly fromHash: string;
    readonly toHash: string;
    readonly alternativeCount: number;
    readonly tieBreakReasons: readonly string[];
    readonly refName?: string;
    readonly selectedPath: readonly {
      readonly dirName: string;
      readonly migrationId: string | null;
      readonly from: string;
      readonly to: string;
    }[];
  };
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
  chain: readonly MigrationChainEntry[],
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

  for (const migration of chain) {
    const pkg = pkgByDirName.get(migration.dirName);
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
      dirName: migration.dirName,
      from: migration.from,
      to: migration.to,
      migrationId: migration.migrationId,
      operationCount: ops.length,
      operationSummary: summary,
      hasDestructive,
      status,
    });

    if (!reachedMarker && migration.to === markerHash) {
      reachedMarker = true;
    }
  }

  return entries;
}

/**
 * Resolve the migration chain to display in status output.
 *
 * When offline or the marker is at EMPTY, the chain is simply the shortest
 * path from EMPTY to the target — all structural paths are equivalent per
 * the spec, so the deterministic shortest path is the canonical display.
 *
 * When online with a non-empty marker, the chain routes *through* the marker:
 * EMPTY→marker (applied history) + marker→target (pending edges). This ensures
 * the displayed chain includes the marker node so applied/pending status is
 * correct. Without this, BFS from EMPTY to target could pick a shortest path
 * that bypasses the marker entirely (e.g. in a diamond graph), causing the
 * marker to appear "diverged" when it isn't.
 */
function resolveDisplayChain(
  graph: MigrationGraph,
  targetHash: string,
  markerHash: string | undefined,
): readonly MigrationChainEntry[] | null {
  if (markerHash === undefined || markerHash === EMPTY_CONTRACT_HASH) {
    return findPath(graph, EMPTY_CONTRACT_HASH, targetHash);
  }

  const toMarker = findPath(graph, EMPTY_CONTRACT_HASH, markerHash);
  if (!toMarker) return findPath(graph, EMPTY_CONTRACT_HASH, targetHash);

  if (markerHash === targetHash) return toMarker;

  const fromMarker = findPath(graph, markerHash, targetHash);
  if (!fromMarker) return findPath(graph, EMPTY_CONTRACT_HASH, targetHash);

  return [...toMarker, ...fromMarker];
}

async function executeMigrationStatusCommand(
  options: MigrationStatusOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
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

  let refName: string | undefined;
  let refHash: string | undefined;
  if (options.ref) {
    refName = options.ref;
    const refsPath = resolve(migrationsDir, 'refs.json');
    try {
      const refs = await readRefs(refsPath);
      refHash = resolveRef(refs, refName);
    } catch (error) {
      if (MigrationToolsError.is(error)) {
        return notOk(
          errorRuntime(error.message, {
            why: error.why,
            fix: error.fix,
            meta: { code: error.code },
          }),
        );
      }
      throw error;
    }
  }

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
    ];
    if (dbConnection && hasDriver) {
      details.push({ label: 'database', value: maskConnectionUrl(String(dbConnection)) });
    }
    if (refName) {
      details.push({ label: 'ref', value: refName });
    }
    const header = formatStyledHeader({
      command: 'migration status',
      description: 'Show migration chain and applied status',
      details,
      flags,
    });
    ui.stderr(header);
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

  const attested = allPackages.filter((p) => typeof p.manifest.migrationId === 'string');

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
      targetHash: EMPTY_CONTRACT_HASH,
      contractHash,
      summary: 'No migrations found',
      diagnostics,
    });
  }

  let graph: MigrationGraph;
  let targetHash: string;
  try {
    graph = reconstructGraph(attested);
    targetHash = refHash ?? findLeaf(graph);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(
        errorRuntime(error.message, { why: error.why, fix: error.fix, meta: { code: error.code } }),
      );
    }
    throw error;
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
      if (!flags.json && !flags.quiet) {
        ui.warn('Could not connect to database — showing offline status');
      }
    }
  }

  const chain = resolveDisplayChain(graph, targetHash, mode === 'online' ? markerHash : undefined);

  if (!chain) {
    return notOk(
      errorRuntime('Cannot reconstruct migration chain', {
        why: `No path from ${EMPTY_CONTRACT_HASH} to target ${targetHash}`,
        fix: 'The migration history may have gaps. Check the migrations directory for missing or corrupted packages.',
      }),
    );
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
    } else if (refHash && markerHash !== undefined) {
      summary = summarizeRefDistance(graph, markerHash, refHash, refName!);
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

  if (contractHash !== EMPTY_CONTRACT_HASH && contractHash !== targetHash) {
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

  let pathDecision: MigrationStatusResult['pathDecision'];
  if (mode === 'online' && markerHash !== undefined) {
    const decision = findPathWithDecision(graph, markerHash, targetHash, refName);
    if (decision) {
      pathDecision = {
        fromHash: decision.fromHash,
        toHash: decision.toHash,
        alternativeCount: decision.alternativeCount,
        tieBreakReasons: decision.tieBreakReasons,
        ...ifDefined('refName', decision.refName),
        selectedPath: decision.selectedPath.map((entry) => ({
          dirName: entry.dirName,
          migrationId: entry.migrationId,
          from: entry.from,
          to: entry.to,
        })),
      };
    }
  }

  const result: MigrationStatusResult = {
    ok: true,
    mode,
    migrations: entries,
    targetHash,
    contractHash,
    summary,
    diagnostics,
    ...ifDefined('markerHash', markerHash),
    ...ifDefined('refName', refName),
    ...ifDefined('refHash', refHash),
    ...(pathDecision ? { pathDecision } : {}),
  };
  return ok(result);
}

export function createMigrationStatusCommand(): Command {
  const command = new Command('status');
  setCommandDescriptions(
    command,
    'Show migration chain and applied status',
    'Displays the migration chain in order. When a database connection\n' +
      'is available, shows which migrations are applied and which are pending.\n' +
      'Without a database connection, shows the chain from disk only.',
  );
  setCommandExamples(command, [
    'prisma-next migration status',
    'prisma-next migration status --db $DATABASE_URL',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--ref <name>', 'Target ref name from migrations/refs.json')
    .action(async (options: MigrationStatusOptions) => {
      const flags = parseGlobalFlags(options);

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeMigrationStatusCommand(options, flags, ui);

      const exitCode = handleResult(result, flags, ui, (statusResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(statusResult, null, 2));
        } else if (!flags.quiet) {
          ui.log(formatMigrationStatusOutput(statusResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}

function summarizeRefDistance(
  graph: MigrationGraph,
  markerHash: string,
  refHash: string,
  refName: string,
): string {
  if (markerHash === refHash) return `At ref "${refName}" target`;

  const pathToRef = findPath(graph, markerHash, refHash);
  if (pathToRef) return `${pathToRef.length} edge(s) behind ref "${refName}"`;

  const pathFromRef = findPath(graph, refHash, markerHash);
  if (pathFromRef) return `${pathFromRef.length} edge(s) ahead of ref "${refName}"`;

  return `No path between marker and ref "${refName}" target`;
}
