import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import {
  findPath,
  findPathWithDecision,
  findReachableLeaves,
} from '@prisma-next/migration-tools/dag';
import { readRefs, resolveRef } from '@prisma-next/migration-tools/refs';
import type {
  AttestedMigrationBundle,
  MigrationBundle,
  MigrationChainEntry,
  MigrationGraph,
} from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { cyan, dim, magenta, yellow } from 'colorette';
import { Command } from 'commander';

import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import {
  addGlobalOptions,
  loadMigrationBundles,
  maskConnectionUrl,
  readContractEnvelope,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  toPathDecisionResult,
} from '../utils/command-helpers';
import {
  type EdgeStatus,
  type EdgeStatusKind,
  migrationGraphToRenderInput,
} from '../utils/formatters/graph-migration-mapper';
import {
  extractRelevantSubgraph,
  graphRenderer,
  isLinearGraph,
} from '../utils/formatters/graph-render';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import type { StatusDiagnostic, StatusRef } from '../utils/migration-types';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationStatusOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly ref?: string;
  readonly graph?: boolean;
  readonly limit?: string;
  readonly all?: boolean;
}

export interface MigrationStatusEntry {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly migrationId: string | null;
  readonly operationCount: number;
  readonly operationSummary: string;
  readonly hasDestructive: boolean;
  readonly status: EdgeStatusKind | 'unknown';
}

export type { StatusDiagnostic, StatusRef } from '../utils/migration-types';

export interface MigrationStatusResult {
  readonly ok: true;
  readonly mode: 'online' | 'offline';
  readonly migrations: readonly MigrationStatusEntry[];
  readonly markerHash?: string;
  readonly targetHash: string;
  readonly contractHash: string;
  readonly refs?: readonly StatusRef[];
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
  readonly graph?: MigrationGraph;
  readonly bundles?: readonly MigrationBundle[];
  readonly edgeStatuses?: readonly EdgeStatus[];
  readonly activeRefHash?: string;
  readonly activeRefName?: string;
  readonly diverged?: boolean;
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

/**
 * Derive per-edge status across the full graph using path analysis.
 *
 * - **applied**: edge is on the path from root to the DB marker
 * - **pending**: edge is on the path from the DB marker to the target
 *   (and the marker is reachable from root, i.e. it's on the same branch)
 * - **unreachable**: edge is on the path from root to the target but the DB
 *   marker is on a different branch — `apply` can't reach these edges
 *   without the DB first moving to this branch
 *
 * Returns statuses only for edges that have a known status (skips offline
 * and edges not on any relevant path).
 *
 * @internal Exported for testing only.
 */
export function deriveEdgeStatuses(
  graph: MigrationGraph,
  targetHash: string,
  contractHash: string,
  markerHash: string | undefined,
  mode: 'online' | 'offline',
): EdgeStatus[] {
  if (mode === 'offline') return [];

  const edgeKey = (e: MigrationChainEntry) => `${e.from}\0${e.to}`;

  // No marker = empty DB — treat root as the marker (nothing applied, everything pending)
  const effectiveMarker = markerHash ?? EMPTY_CONTRACT_HASH;

  const appliedPath =
    markerHash !== undefined ? findPath(graph, EMPTY_CONTRACT_HASH, markerHash) : null;

  const pendingPath = findPath(graph, effectiveMarker, targetHash);
  const targetPath = findPath(graph, EMPTY_CONTRACT_HASH, targetHash);

  const statuses: EdgeStatus[] = [];
  const assignedKeys = new Set<string>();

  // Applied edges (root → marker)
  if (appliedPath) {
    for (const e of appliedPath) {
      assignedKeys.add(edgeKey(e));
      statuses.push({ dirName: e.dirName, status: 'applied' });
    }
  }

  // Pending edges (marker → target)
  if (pendingPath) {
    for (const e of pendingPath) {
      assignedKeys.add(edgeKey(e));
      statuses.push({ dirName: e.dirName, status: 'pending' });
    }
  }

  // Pending edges beyond the target: target → contract (when target is a ref
  // and the contract is reachable from it)
  if (
    contractHash !== EMPTY_CONTRACT_HASH &&
    contractHash !== targetHash &&
    graph.nodes.has(contractHash)
  ) {
    const beyondTarget = findPath(graph, targetHash, contractHash);
    if (beyondTarget) {
      for (const e of beyondTarget) {
        if (!assignedKeys.has(edgeKey(e))) {
          assignedKeys.add(edgeKey(e));
          statuses.push({ dirName: e.dirName, status: 'pending' });
        }
      }
    }
  }

  // Unreachable edges: on the path from root to the target but neither applied
  // nor pending. This covers two cases:
  //  1. Marker can't reach target at all (different branch entirely)
  //  2. Marker reaches target via a different route, leaving some root→target
  //     edges orphaned (e.g. a fork where one branch was applied and apply
  //     will continue through the other)
  if (targetPath) {
    for (const e of targetPath) {
      if (!assignedKeys.has(edgeKey(e))) {
        statuses.push({ dirName: e.dirName, status: 'unreachable' });
      }
    }
  }

  return statuses;
}

/**
 * @param mode    — 'online' if we connected to the database, 'offline' otherwise
 * @param markerHash — the marker hash from the database, or undefined if no marker row / offline
 */
function buildMigrationEntries(
  chain: readonly MigrationChainEntry[],
  packages: readonly MigrationBundle[],
  mode: 'online' | 'offline',
  markerHash: string | undefined,
  edgeStatuses?: readonly EdgeStatus[],
): MigrationStatusEntry[] {
  const pkgByDirName = new Map(packages.map((p) => [p.dirName, p]));
  const statusByDirName = edgeStatuses
    ? new Map(edgeStatuses.map((e) => [e.dirName, e.status]))
    : undefined;

  const markerInChain = markerHash === undefined || chain.some((e) => e.to === markerHash);

  const entries: MigrationStatusEntry[] = [];
  let reachedMarker = mode === 'online' && markerHash === undefined;

  for (const migration of chain) {
    const pkg = pkgByDirName.get(migration.dirName);
    const ops = (pkg?.ops ?? []) as readonly MigrationPlanOperation[];
    const { summary, hasDestructive } = summarizeOps(ops);

    let status: EdgeStatusKind | 'unknown';
    const edgeStatus = statusByDirName?.get(migration.dirName);
    if (edgeStatus) {
      status = edgeStatus;
    } else if (mode === 'offline' || !markerInChain) {
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
  if (markerHash === undefined) {
    return findPath(graph, EMPTY_CONTRACT_HASH, targetHash);
  }

  const toMarker = findPath(graph, EMPTY_CONTRACT_HASH, markerHash);
  // Marker unreachable from EMPTY — show the target chain anyway.
  // The caller detects this via markerInChain and emits a divergence diagnostic.
  if (!toMarker) return findPath(graph, EMPTY_CONTRACT_HASH, targetHash);

  if (markerHash === targetHash) return toMarker;

  const fromMarker = findPath(graph, markerHash, targetHash);
  if (fromMarker) return [...toMarker, ...fromMarker];

  // Marker is ahead of target (or on a disconnected branch).
  // Try the inverse: target→marker. If it succeeds, the marker is ahead —
  // show the full chain from EMPTY through the target and on to the marker.
  const toTarget = findPath(graph, EMPTY_CONTRACT_HASH, targetHash);
  if (!toTarget) return null;

  const targetToMarker = findPath(graph, targetHash, markerHash);
  if (targetToMarker) return [...toTarget, ...targetToMarker];

  // Genuinely disconnected — show EMPTY→target; caller handles divergence diagnostic.
  return toTarget;
}

const DEFAULT_LIMIT = 10;

function determineLimit(opts: MigrationStatusOptions) {
  if (opts.all) {
    // No limit
    return;
  }
  if (!opts.limit) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(opts.limit, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT;
  }
  return parsed;
}

async function executeMigrationStatusCommand(
  options: MigrationStatusOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationStatusResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, migrationsRelative, refsPath } = resolveMigrationPaths(
    options.config,
    config,
  );

  const dbConnection = options.db ?? config.db?.connection;
  const hasDriver = !!config.driver;

  let activeRefName: string | undefined;
  let activeRefHash: string | undefined;
  let allRefs: Record<string, string> = {};
  try {
    allRefs = await readRefs(refsPath);
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

  if (options.ref) {
    activeRefName = options.ref;
    try {
      activeRefHash = resolveRef(allRefs, activeRefName);
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

  // todo: can't we derive this without modifying the StatusRef obj
  const statusRefs: StatusRef[] = Object.entries(allRefs).map(([name, hash]) => ({
    name,
    hash,
    active: name === activeRefName,
  }));

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
    ];
    if (dbConnection && hasDriver) {
      details.push({ label: 'database', value: maskConnectionUrl(String(dbConnection)) });
    }
    if (activeRefName) {
      details.push({ label: 'ref', value: activeRefName });
    }
    const header = formatStyledHeader({
      command: 'migration status',
      description: 'Show migration history and applied status',
      details,
      flags,
    });
    ui.stderr(header);
  }

  const diagnostics: StatusDiagnostic[] = [];
  let contractHash: string = EMPTY_CONTRACT_HASH;
  try {
    const envelope = await readContractEnvelope(config);
    contractHash = envelope.storageHash;
  } catch (error) {
    diagnostics.push({
      code: 'CONTRACT.UNREADABLE',
      severity: 'warn',
      message: `Could not read contract: ${error instanceof Error ? error.message : 'unknown error'}`,
      hints: ["Run 'prisma-next contract emit' to generate a valid contract"],
    });
  }

  let attested: readonly AttestedMigrationBundle[];
  let graph: MigrationGraph;
  try {
    ({ bundles: attested, graph } = await loadMigrationBundles(migrationsDir));
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

  if (attested.length === 0) {
    if (contractHash !== EMPTY_CONTRACT_HASH) {
      diagnostics.push({
        code: 'CONTRACT.AHEAD',
        severity: 'warn',
        message: 'No migration exists for the current contract',
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

  let targetHash: string | undefined;

  if (activeRefHash) {
    targetHash = activeRefHash;
  } else if (graph.nodes.has(contractHash)) {
    targetHash = contractHash;
  } else {
    const leaves = findReachableLeaves(graph, EMPTY_CONTRACT_HASH);
    if (leaves.length === 1) {
      targetHash = leaves[0];
    } else {
      diagnostics.push({
        code: 'MIGRATION.DIVERGED',
        severity: 'warn',
        message: 'There are multiple valid migration paths — you must select a target',
        hints: [
          "Use '--ref <name>' to select a target",
          "Or 'prisma-next migration ref set <name> <hash>' to create one",
        ],
      });
    }
  }

  let markerHash: string | undefined;
  let mode: 'online' | 'offline' = 'offline';

  if (dbConnection && hasDriver) {
    const client = createControlClient({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver,
      extensionPacks: config.extensionPacks ?? [],
    });
    try {
      await client.connect(dbConnection);
      markerHash = (await client.readMarker())?.storageHash;
      mode = 'online';
    } catch {
      if (!flags.json && !flags.quiet) {
        ui.warn('Could not connect to database — showing offline status');
      }
    } finally {
      await client.close();
    }
  }

  // Marker exists but is not in the migration graph and doesn't match the
  // contract hash. The DB is at an unknown state relative to the graph.
  // Bail out early with a clear diagnostic instead of rendering a confusing
  // graph with no statuses.
  //
  // When marker === contract (both off-graph), the DB matches the current
  // contract — proceed normally; the detached contract node will carry both
  // the db and contract markers.
  if (
    mode === 'online' &&
    markerHash !== undefined &&
    !graph.nodes.has(markerHash) &&
    markerHash !== contractHash
  ) {
    const hints: string[] = [];
    if (graph.nodes.has(contractHash)) {
      hints.push(
        "Run 'prisma-next db sign' to overwrite the marker if the database already matches the contract",
        "Run 'prisma-next db update' to push the current contract to the database",
        "Run 'prisma-next contract infer' to make your contract match the database",
        "Run 'prisma-next db verify' to inspect the database state",
      );
    } else {
      hints.push(
        "Run 'prisma-next db update' to push the current contract to the database",
        "Run 'prisma-next contract infer' to make your contract match the database",
        "Run 'prisma-next db verify' to inspect the database state",
      );
    }
    diagnostics.push({
      code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
      severity: 'warn',
      message:
        'Database was updated outside the migration system (marker does not match any migration)',
      hints,
    });
    return ok({
      ok: true,
      mode,
      migrations: [],
      targetHash: EMPTY_CONTRACT_HASH,
      contractHash,
      summary: `${attested.length} migration(s) on disk`,
      diagnostics,
      markerHash,
      ...(statusRefs.length > 0 ? { refs: statusRefs } : {}),
    });
  }

  if (mode === 'online' && markerHash === undefined) {
    diagnostics.push({
      code: 'MIGRATION.NO_MARKER',
      severity: 'warn',
      message: 'Database has not been initialized — no migration marker found',
      hints: ["Run 'prisma-next migration apply' to apply pending migrations"],
    });
  }

  // Contract diagnostic — fires when no migration produces the current contract hash.
  // Suppressed when: (a) graph is diverged (MIGRATION.DIVERGED already guides the user),
  // (b) marker === contract and both off-graph (marker-not-in-graph diagnostic covers it).
  if (
    targetHash &&
    contractHash !== EMPTY_CONTRACT_HASH &&
    !graph.nodes.has(contractHash) &&
    markerHash !== contractHash
  ) {
    diagnostics.push({
      code: 'CONTRACT.AHEAD',
      severity: 'warn',
      message: 'Contract has changed since the last migration was planned',
      hints: ["Run 'prisma-next migration plan' to generate a migration for the current contract"],
    });
  }

  if (!targetHash) {
    return ok({
      ok: true,
      mode,
      migrations: [],
      targetHash: EMPTY_CONTRACT_HASH,
      contractHash,
      summary: `${attested.length} migration(s) on disk`,
      diagnostics,
      ...ifDefined('markerHash', markerHash),
      ...(statusRefs.length > 0 ? { refs: statusRefs } : {}),
      graph,
      bundles: attested,
      diverged: true,
    });
  }

  const chain = resolveDisplayChain(graph, targetHash, markerHash);

  if (!chain) {
    return notOk(
      errorRuntime('Cannot reconstruct migration history', {
        why: `No path from ${EMPTY_CONTRACT_HASH} to target ${targetHash}`,
        fix: 'The migration history may have gaps. Check the migrations directory for missing or corrupted packages.',
      }),
    );
  }

  const edgeStatuses = deriveEdgeStatuses(graph, targetHash, contractHash, markerHash, mode);
  const entries = buildMigrationEntries(chain, attested, mode, markerHash, edgeStatuses);

  const pendingCount = edgeStatuses.filter((e) => e.status === 'pending').length;
  const appliedCount = edgeStatuses.filter((e) => e.status === 'applied').length;

  let summary: string;
  if (mode === 'online') {
    if (markerHash !== undefined && !graph.nodes.has(markerHash) && markerHash === contractHash) {
      summary = `${attested.length} migration(s) on disk`;
    } else if (activeRefHash && markerHash !== undefined) {
      summary = summarizeRefDistance(graph, markerHash, activeRefHash, activeRefName!);
    } else if (pendingCount === 0) {
      summary = `Database is up to date (${appliedCount} migration${appliedCount !== 1 ? 's' : ''} applied)`;
    } else if (markerHash === undefined) {
      summary = `${pendingCount} pending migration(s) — database has no marker`;
    } else {
      summary = `${pendingCount} pending migration(s) — run 'prisma-next migration apply' to apply`;
    }
  } else {
    summary = `${entries.length} migration(s) on disk`;
  }

  if (mode === 'online') {
    if (markerHash !== undefined && !graph.nodes.has(markerHash) && markerHash === contractHash) {
      diagnostics.push({
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        severity: 'warn',
        message:
          'Database matches the current contract but was updated directly (not via migration apply)',
        hints: ["Run 'prisma-next migration plan' to plan a migration to your current contract"],
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
    const decision = findPathWithDecision(graph, markerHash, targetHash, activeRefName);
    if (decision) {
      pathDecision = toPathDecisionResult(decision);
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
    ...(statusRefs.length > 0 ? { refs: statusRefs } : {}),
    ...ifDefined('pathDecision', pathDecision),
    graph,
    bundles: attested,
    edgeStatuses,
    ...ifDefined('activeRefHash', activeRefHash),
    ...ifDefined('activeRefName', activeRefName),
  };
  return ok(result);
}

export function createMigrationStatusCommand(): Command {
  const command = new Command('status');
  setCommandDescriptions(
    command,
    'Show migration history and applied status',
    'Displays the migration history in order. When a database connection\n' +
      'is available, shows which migrations are applied and which are pending.\n' +
      'Without a database connection, shows the history from disk only.',
  );
  setCommandExamples(command, [
    'prisma-next migration status',
    'prisma-next migration status --db $DATABASE_URL',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--ref <name>', 'Target ref name from migrations/refs.json')
    .option('--graph', 'Show the full migration graph with all branches')
    .option('--limit <n>', 'Maximum number of migrations to display (default: 10)')
    .option('--all', 'Show full history (disables truncation)')
    .action(async (options: MigrationStatusOptions) => {
      const flags = parseGlobalFlags(options);

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeMigrationStatusCommand(options, flags, ui);

      const exitCode = handleResult(result, flags, ui, (statusResult) => {
        if (flags.json) {
          const {
            graph: _g,
            bundles: _b,
            edgeStatuses: _es,
            activeRefHash: _arh,
            activeRefName: _arn,
            diverged: _d,
            ...jsonResult
          } = statusResult;
          ui.output(JSON.stringify(jsonResult, null, 2));
        } else if (!flags.quiet) {
          const colorize = flags.color !== false;

          if (statusResult.graph) {
            const limit = determineLimit(options);
            const renderInput = migrationGraphToRenderInput({
              graph: statusResult.graph,
              mode: statusResult.mode,
              markerHash: statusResult.markerHash,
              contractHash: statusResult.contractHash,
              refs: statusResult.refs,
              activeRefHash: statusResult.activeRefHash,
              activeRefName: statusResult.activeRefName,
              edgeStatuses: statusResult.edgeStatuses,
            });

            const graphToRender =
              options.graph || statusResult.diverged
                ? renderInput.graph
                : extractRelevantSubgraph(renderInput.graph, renderInput.relevantPaths);
            const renderOptions = {
              ...renderInput.options,
              colorize,
              ...ifDefined('limit', limit),
              ...(isLinearGraph(graphToRender) ? { dagreOptions: { ranksep: 1 } } : {}),
            };
            const graphOutput = graphRenderer.render(graphToRender, renderOptions);
            ui.log(graphOutput);
            if (statusResult.mode === 'online') {
              ui.log(formatLegend(colorize));
            }
          }
          ui.log('');
          ui.log(formatStatusSummary(statusResult, colorize));
        }
      });

      process.exit(exitCode);
    });

  return command;
}

function formatLegend(colorize: boolean): string {
  const c = (fn: (s: string) => string, s: string) => (colorize ? fn(s) : s);
  const parts = [
    `${c(cyan, '✓')} applied`,
    `${c(yellow, '⧗')} pending`,
    `${c(magenta, '✗')} unreachable`,
  ];
  return c(dim, parts.join('  '));
}

function formatStatusSummary(result: MigrationStatusResult, colorize: boolean): string {
  const c = (fn: (s: string) => string, s: string) => (colorize ? fn(s) : s);
  const lines: string[] = [];

  const hasUnknown = result.migrations.some((e) => e.status === 'unknown');
  const pendingCount = result.migrations.filter((e) => e.status === 'pending').length;

  const hasWarnings = result.diagnostics?.some((d) => d.severity === 'warn') ?? false;

  if (result.mode === 'online') {
    if (hasUnknown || hasWarnings) {
      lines.push(`${c(yellow, '⚠')} ${result.summary}`);
    } else if (pendingCount === 0) {
      lines.push(`${c(cyan, '✔')} ${result.summary}`);
    } else {
      lines.push(`${c(yellow, '⧗')} ${result.summary}`);
    }
  } else {
    lines.push(result.summary);
  }

  const warnings = result.diagnostics?.filter((d) => d.severity === 'warn') ?? [];
  for (const diag of warnings) {
    lines.push(`${c(yellow, '⚠')} ${diag.message}`);
    for (const hint of diag.hints) {
      lines.push(`  ${c(dim, hint)}`);
    }
  }

  return lines.join('\n');
}

function summarizeRefDistance(
  graph: MigrationGraph,
  markerHash: string,
  refHash: string,
  refName: string,
): string {
  if (markerHash === refHash) return `At ref "${refName}" target`;

  const pathToRef = findPath(graph, markerHash, refHash);
  if (pathToRef) return `${pathToRef.length} migration(s) behind ref "${refName}"`;

  const pathFromRef = findPath(graph, refHash, markerHash);
  if (pathFromRef) return `${pathFromRef.length} migration(s) ahead of ref "${refName}"`;

  return `No path between database marker and ref "${refName}" target`;
}
