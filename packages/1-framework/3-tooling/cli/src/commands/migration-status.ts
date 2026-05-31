import type { Contract } from '@prisma-next/contract/types';
import {
  createControlStack,
  type MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import {
  type ContractMarkerRecordLike,
  type ContractSpaceAggregate,
  graphWalkStrategy,
  loadContractSpaceAggregate,
  requireHeadRef,
} from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import {
  errorNoInvariantPath,
  errorUnknownInvariant,
  MigrationToolsError,
} from '@prisma-next/migration-tools/errors';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import {
  findPath,
  findPathWithDecision,
  findReachableLeaves,
} from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import type { RefEntry, Refs } from '@prisma-next/migration-tools/refs';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { cyan, dim, magenta, yellow } from 'colorette';
import { Command } from 'commander';

import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorRuntime,
  errorUnexpected,
  mapMigrationToolsError,
  mapRefResolutionError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  collectDeclaredInvariants,
  maskConnectionUrl,
  readContractEnvelope,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
  toPathDecisionResult,
  toStructuralEdge,
} from '../utils/command-helpers';
import {
  appContractStandInFromIdentity,
  loadContractRawSafely,
  refuseContractSpaceIntegrity,
  refusePackageCorruptionOnAggregate,
} from '../utils/contract-space-aggregate-loader';
import { toDeclaredExtensionsFromRaw } from '../utils/extension-pack-inputs';
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
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import type { StatusDiagnostic, StatusRef } from '../utils/migration-types';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationStatusOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly to?: string;
  readonly from?: string;
}

export interface MigrationStatusEntry {
  readonly dirName: string;
  readonly from: string;
  readonly to: string;
  readonly migrationHash: string;
  readonly operationCount: number;
  readonly operationSummary: string;
  readonly hasDestructive: boolean;
  readonly status: EdgeStatusKind | 'unknown';
}

/**
 * Per-space status row in the aggregate-shaped status output.
 *
 * Surfaces, for each contract space:
 *
 * - `headHash`: the on-disk head ref's hash (where the space is going).
 * - `markerHash`: the live marker hash for the space, or null if no
 *    marker has been written yet (greenfield, or pre-`migrate`).
 * - `pendingCount`: number of migration edges between marker and head.
 *    Computed via {@link graphWalkStrategy}; 0 means the space is
 *    already at head.
 * - `status`: convenience tag the formatter uses to pick a glyph.
 *    `'never-planned'` is reserved for spaces with non-empty head but
 *    no on-disk migrations — which shouldn't happen if the loader's
 *    integrity check passes.
 *
 * Online-only fields (`markerHash`, `status`) are absent when the
 * command runs without a database connection.
 */
export interface MigrationStatusSpaceEntry {
  readonly spaceId: string;
  readonly kind: 'app' | 'extension';
  readonly headHash: string;
  readonly markerHash?: string | null;
  readonly pendingCount?: number;
  readonly status?: 'up-to-date' | 'pending' | 'no-marker' | 'never-planned' | 'unreachable';
}

/**
 * Sum per-space `pendingCount` into a cross-space total, but only when
 * every loaded space reports a defined `pendingCount`. Returns
 * `undefined` if any space is on the marker-unknown / offline path
 * (where `pendingCount` is intentionally absent), so JSON consumers can
 * distinguish "no pending" from "unknown".
 */
export function computeTotalPendingAcrossSpaces(
  spaces: readonly MigrationStatusSpaceEntry[],
): number | undefined {
  if (spaces.length === 0) return undefined;
  let total = 0;
  for (const s of spaces) {
    if (s.pendingCount === undefined) return undefined;
    total += s.pendingCount;
  }
  return total;
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
  /** Required invariants from the active ref, sorted ascending. Always present (`[]` when no `--ref` or the ref declares none) — knowable offline. */
  readonly requiredInvariants: readonly string[];
  /**
   * Invariants the marker has applied at least once, intersected with
   * `requiredInvariants` for display relevance. JSON consumers see only the
   * subset overlapping the active ref's required set — the full unfiltered
   * marker invariant list lives on `marker.invariants` (control plane) and
   * is not surfaced here. Present only in `mode === 'online'`; absent when
   * offline (the marker is unknown, not empty).
   */
  readonly appliedInvariants?: readonly string[];
  /** required − applied. Present only in `mode === 'online'`; absent when offline. */
  readonly missingInvariants?: readonly string[];
  readonly pathDecision?: {
    readonly fromHash: string;
    readonly toHash: string;
    readonly alternativeCount: number;
    readonly tieBreakReasons: readonly string[];
    readonly refName?: string;
    readonly requiredInvariants: readonly string[];
    readonly satisfiedInvariants: readonly string[];
    readonly selectedPath: readonly {
      readonly dirName: string;
      readonly migrationHash: string;
      readonly from: string;
      readonly to: string;
      readonly invariants: readonly string[];
    }[];
  };
  readonly summary: string;
  readonly diagnostics: readonly StatusDiagnostic[];
  /**
   * Aggregate enumeration of every on-disk contract space (app +
   * extensions), in canonical schedule order (extensions
   * alphabetically, then app). Present whenever the aggregate loader
   * succeeded; absent in early-error returns (e.g. unreadable
   * migrations directory) where the existing diagnostics already
   * surface the failure.
   *
   * The top-level fields (`migrations`, `markerHash`, `targetHash`,
   * `pathDecision`, …) describe the **app member** specifically.
   * Per-space detail for extension members lives only on this list.
   */
  readonly spaces?: readonly MigrationStatusSpaceEntry[];
  /** Cross-space pending-migration total (sum of `spaces[].pendingCount`). Present when `spaces` is. */
  readonly totalPendingAcrossSpaces?: number;
  readonly graph?: MigrationGraph;
  readonly bundles?: readonly OnDiskMigrationPackage[];
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

  const edgeKey = (e: MigrationEdge) => `${e.from}\0${e.to}`;

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
  chain: readonly MigrationEdge[],
  packages: readonly OnDiskMigrationPackage[],
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
      migrationHash: migration.migrationHash,
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
): readonly MigrationEdge[] | null {
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

/**
 * Build the aggregate enumeration of contract spaces for the status
 * output. Loads the aggregate from disk (lossy on failure — extension
 * spaces are simply omitted, the app member's output keeps working),
 * reads per-space marker rows when online, and uses
 * {@link graphWalkStrategy} to compute each space's pending count.
 *
 * The aggregate-walking status reports per-space marker + pending
 * state alongside the cross-space totals.
 */
export async function loadAggregateStatusSpaces(args: {
  readonly aggregate: ContractSpaceAggregate;
  readonly extensionPacks: ReadonlyArray<unknown>;
  readonly markersBySpace: ReadonlyMap<string, ContractMarkerRecordLike> | null;
}): Promise<readonly MigrationStatusSpaceEntry[]> {
  const declaredExtensions = toDeclaredExtensionsFromRaw(args.extensionPacks);
  if (
    refuseContractSpaceIntegrity(args.aggregate, {
      declaredExtensions,
      checkContracts: true,
    })
  ) {
    // Full integrity refusal (drift, layout violation, etc.) — surfacing
    // it as a status diagnostic would duplicate `migration plan`'s job.
    // The app pipeline still runs; extensions are simply not enumerated.
    return [];
  }
  const aggregate = args.aggregate;

  const orderedMembers = [...aggregate.extensions, aggregate.app];
  const rows: MigrationStatusSpaceEntry[] = [];
  for (const member of orderedMembers) {
    const liveMarker = args.markersBySpace?.get(member.spaceId) ?? null;
    const isApp = member.spaceId === aggregate.app.spaceId;
    // The aggregate passed the integrity gate above, so every member has
    // a resolved head ref (a missing one would have refused the load).
    const headRef = requireHeadRef(member);

    if (member.graph().nodes.size === 0) {
      rows.push({
        spaceId: member.spaceId,
        kind: isApp ? 'app' : 'extension',
        headHash: headRef.hash,
        ...(args.markersBySpace !== null
          ? {
              markerHash: liveMarker?.storageHash ?? null,
              status: headRef.hash === EMPTY_CONTRACT_HASH ? 'up-to-date' : 'never-planned',
              pendingCount: 0,
            }
          : {}),
      });
      continue;
    }

    if (args.markersBySpace === null) {
      rows.push({
        spaceId: member.spaceId,
        kind: isApp ? 'app' : 'extension',
        headHash: headRef.hash,
      });
      continue;
    }

    const walked = graphWalkStrategy({
      aggregateTargetId: aggregate.targetId,
      member,
      currentMarker: liveMarker,
    });
    let pendingCount = 0;
    let status: MigrationStatusSpaceEntry['status'];
    if (walked.kind === 'ok') {
      // Count pending *migrations* (graph edges), not operations: a
      // single authored migration that lowers to N ops or zero ops
      // both count as exactly one pending unit of work for the user.
      pendingCount = walked.result.migrationEdges?.length ?? 0;
      if (liveMarker === null) {
        status = pendingCount === 0 ? 'no-marker' : 'pending';
      } else {
        status = pendingCount === 0 ? 'up-to-date' : 'pending';
      }
    } else {
      status = 'unreachable';
    }

    rows.push({
      spaceId: member.spaceId,
      kind: isApp ? 'app' : 'extension',
      headHash: headRef.hash,
      markerHash: liveMarker?.storageHash ?? null,
      pendingCount,
      ...(status ? { status } : {}),
    });
  }
  return rows;
}

/**
 * Read the raw contract.json bytes from disk for the aggregate
 * loader. Returns `null` if the file is missing or unparseable —
 * the existing `readContractEnvelope` path will report the same
 * problem via a status diagnostic, no need to double-surface.
 */

async function validateOnlineMarkerRead(
  config: Awaited<ReturnType<typeof loadConfig>>,
  dbConnection: unknown,
): Promise<Result<void, CliStructuredError>> {
  const driver = config.driver;
  if (!driver) {
    return ok(undefined);
  }

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver,
    extensionPacks: config.extensionPacks ?? [],
  });
  try {
    await client.connect(dbConnection);
    await client.readMarker();
    return ok(undefined);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read database marker: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

async function executeMigrationStatusCommand(
  options: MigrationStatusOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationStatusResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, appMigrationsRelative, migrationsDir, refsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

  const dbConnection = options.db ?? config.db?.connection;
  const hasDriver = !!config.driver;

  let activeRefName: string | undefined;
  let activeRefHash: string | undefined;
  let activeRefEntry: RefEntry | undefined;
  let allRefs: Refs = {};
  try {
    allRefs = await readRefs(refsDir);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
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

  const contractRawForAggregate = await loadContractRawSafely(config);
  const stack = createControlStack(config);
  const familyInstance = config.family.create(stack);
  const deserializeContract = (json: unknown): Contract => familyInstance.deserializeContract(json);
  const appContractStandIn = appContractStandInFromIdentity({
    contractHash,
    targetId: config.target.id,
    targetFamily: config.target.familyId,
  });
  let appContractForLoad: Contract = appContractStandIn;
  if (contractRawForAggregate !== null) {
    try {
      appContractForLoad = deserializeContract(contractRawForAggregate);
    } catch (error) {
      diagnostics.push({
        code: 'CONTRACT.UNREADABLE',
        severity: 'warn',
        message: `Could not deserialize contract: ${error instanceof Error ? error.message : 'unknown error'}`,
        hints: ["Run 'prisma-next contract emit' to generate a valid contract"],
      });
    }
  }

  let aggregate: ContractSpaceAggregate;
  try {
    aggregate = await loadContractSpaceAggregate({
      migrationsDir,
      deserializeContract,
      appContract: appContractForLoad,
    });
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migrations directory: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  if (contractRawForAggregate !== null) {
    const corruptionFailure = refusePackageCorruptionOnAggregate(aggregate);
    if (corruptionFailure) {
      return notOk(corruptionFailure);
    }
  }

  const appGraph = aggregate.app.graph();

  let fromOverrideHash: string | undefined;

  if (options.to || options.from) {
    if (options.to) {
      const refResult = parseContractRef(options.to, { graph: appGraph, refs: allRefs });
      if (!refResult.ok) {
        return notOk(mapRefResolutionError(refResult.failure));
      }
      activeRefHash = refResult.value.hash;
      if (refResult.value.provenance.kind === 'ref') {
        const resolvedRefName = refResult.value.provenance.refName;
        activeRefName = resolvedRefName;
        activeRefEntry = allRefs[resolvedRefName];
      }
    }

    if (options.from) {
      const fromResult = parseContractRef(options.from, { graph: appGraph, refs: allRefs });
      if (!fromResult.ok) {
        return notOk(mapRefResolutionError(fromResult.failure));
      }
      fromOverrideHash = fromResult.value.hash;
    }
  }

  const requiredInvariants: readonly string[] = [...(activeRefEntry?.invariants ?? [])].sort();

  const statusRefs: StatusRef[] = Object.entries(allRefs).map(([name, entry]) => ({
    name,
    hash: entry.hash,
    active: name === activeRefName,
  }));

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: appMigrationsRelative },
    ];
    if (dbConnection && hasDriver) {
      details.push({ label: 'database', value: maskConnectionUrl(String(dbConnection)) });
    }
    if (activeRefName) {
      details.push({ label: 'ref', value: activeRefName });
    }
    if (options.from) {
      details.push({ label: 'from', value: options.from });
    }
    if (activeRefEntry && activeRefEntry.invariants.length > 0) {
      details.push({
        label: 'required',
        value: formatInvariantList(activeRefEntry.invariants),
      });
    }
    const header = formatStyledHeader({
      command: 'migration status',
      description: 'Show migration history and applied status',
      details,
      flags,
    });
    ui.stderr(header);
  }

  const bundles = aggregate.app.packages;
  const graph = appGraph;

  if (bundles.length === 0) {
    if (dbConnection && hasDriver) {
      const markerProbe = await validateOnlineMarkerRead(config, dbConnection);
      if (!markerProbe.ok) {
        return markerProbe;
      }
    }
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
      requiredInvariants,
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
          "Use '--to <contract>' to select a target",
          "Or 'prisma-next ref set <name> <hash>' to create one",
        ],
      });
    }
  }

  let markerHash: string | undefined;
  let markerInvariants: readonly string[] = [];
  let mode: 'online' | 'offline' = 'offline';
  let allMarkers: ReadonlyMap<string, ContractMarkerRecordLike> | null = null;

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
      const marker = await client.readMarker();
      markerHash = marker?.storageHash;
      markerInvariants = marker?.invariants ?? [];
      mode = 'online';
      // Read every space's marker so the aggregate enumeration can
      // surface per-space marker state. `readAllMarkers` mirrors what
      // `db init` / `db update` already use to drive the planner;
      // here it powers the aggregate status output.
      //
      // Probe for the method first so we only swallow the
      // unsupported-method case: older family instances may not
      // implement `readAllMarkers` (per-space enumeration then falls
      // back to "marker unknown"). Real query / runtime errors from
      // an instance that *does* expose the method must propagate up
      // — otherwise transient DB failures would silently degrade
      // status to "markers unknown".
      if (typeof client.readAllMarkers === 'function') {
        allMarkers = await client.readAllMarkers();
      } else {
        // Leaving `allMarkers` as `null` signals "unknown" to the
        // aggregate loader (an empty `Map` would instead mean "every
        // space has no marker", which is a different condition).
        allMarkers = null;
      }
    } catch (error) {
      if (CliStructuredError.is(error)) {
        return notOk(error);
      }
      if (!flags.json && !flags.quiet) {
        ui.warn('Could not connect to database — showing offline status');
      }
    } finally {
      await client.close();
    }
  }

  if (fromOverrideHash !== undefined) {
    markerHash = fromOverrideHash;
    mode = 'offline';
    allMarkers = null;
  }

  let aggregateSpaces: readonly MigrationStatusSpaceEntry[] = [];
  if (contractRawForAggregate !== null) {
    try {
      aggregateSpaces = await loadAggregateStatusSpaces({
        aggregate,
        extensionPacks: config.extensionPacks ?? [],
        markersBySpace: allMarkers,
      });
    } catch {
      aggregateSpaces = [];
    }
  }
  const totalPendingAcrossSpaces = computeTotalPendingAcrossSpaces(aggregateSpaces);

  // Pre-check unknown invariants. Online: union the graph's declared
  // invariants with the marker's recorded set so a retired-but-applied
  // invariant doesn't surface as MIGRATION.UNKNOWN_INVARIANT — apply would
  // route fine because marker subtraction empties `effectiveRequired`.
  // Offline: keep the check graph-strict (the marker is unknown, and a
  // missing declarer is the dominant signal we can offer).
  if (activeRefEntry && activeRefEntry.invariants.length > 0) {
    const declared = collectDeclaredInvariants(graph);
    const known = new Set<string>(declared);
    if (mode === 'online') {
      for (const id of markerInvariants) known.add(id);
    }
    const unknown = activeRefEntry.invariants.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return notOk(
        mapMigrationToolsError(
          errorUnknownInvariant({
            ...ifDefined('refName', activeRefName),
            unknown,
            declared: [...declared].sort(),
          }),
        ),
      );
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
      summary: `${bundles.length} migration(s) on disk`,
      diagnostics,
      markerHash,
      requiredInvariants,
      ...(statusRefs.length > 0 ? { refs: statusRefs } : {}),
    });
  }

  if (mode === 'online' && markerHash === undefined) {
    diagnostics.push({
      code: 'MIGRATION.NO_MARKER',
      severity: 'warn',
      message: 'Database has not been initialized — no migration marker found',
      hints: ["Run 'prisma-next migrate' to apply pending migrations"],
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
      summary: `${bundles.length} migration(s) on disk`,
      diagnostics,
      ...ifDefined('markerHash', markerHash),
      requiredInvariants,
      ...(statusRefs.length > 0 ? { refs: statusRefs } : {}),
      graph,
      bundles,
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
  const entries = buildMigrationEntries(chain, bundles, mode, markerHash, edgeStatuses);

  const pendingCount = edgeStatuses.filter((e) => e.status === 'pending').length;
  const appliedCount = edgeStatuses.filter((e) => e.status === 'applied').length;

  let appliedInvariants: readonly string[] | undefined;
  let missingInvariants: readonly string[] | undefined;
  let effectiveRequired = new Set<string>();
  if (mode === 'online') {
    // Mirrors `migrate.ts`: compute `effectiveRequired = required −
    // marker.invariants` directly, then derive the display fields from it.
    // `appliedInvariants` is the intersection (`required ∩ marker`), which
    // is what JSON consumers see for the active ref; the unfiltered set
    // lives on `marker.invariants`.
    const markerSet = new Set(markerInvariants);
    effectiveRequired = new Set(requiredInvariants.filter((id) => !markerSet.has(id)));
    appliedInvariants = requiredInvariants.filter((id) => markerSet.has(id));
    missingInvariants = [...effectiveRequired].sort();
  }

  // The marker can match the structural target while still missing required
  // invariants — for example, a self-edge that provides X, applied via a ref
  // declaring X. `pendingCount` (structural) says zero in that case but
  // `effectiveRequired` is non-empty, so up-to-date messaging would mislead.
  const hasInvariantWork = effectiveRequired.size > 0;
  const missingList = [...effectiveRequired].sort().join(', ');

  let summary: string;
  if (mode === 'online') {
    if (markerHash !== undefined && !graph.nodes.has(markerHash) && markerHash === contractHash) {
      summary = `${bundles.length} migration(s) on disk`;
    } else if (activeRefHash && activeRefName && markerHash !== undefined) {
      const distance = summarizeRefDistance(graph, markerHash, activeRefHash, activeRefName);
      summary = hasInvariantWork ? `${distance} — missing invariant(s): ${missingList}` : distance;
    } else if (pendingCount === 0 && !hasInvariantWork) {
      summary = `Database is up to date (${appliedCount} migration${appliedCount !== 1 ? 's' : ''} applied)`;
    } else if (pendingCount === 0 && hasInvariantWork) {
      summary = `Missing invariant(s): ${missingList} — run 'prisma-next migrate --to ${activeRefName ?? '<ref>'}' to apply`;
    } else if (markerHash === undefined) {
      summary = `${pendingCount} pending migration(s) — database has no marker`;
    } else {
      summary = `${pendingCount} pending migration(s) — run 'prisma-next migrate' to apply`;
    }
  } else {
    summary = `${entries.length} migration(s) on disk`;
  }

  let pathDecision: MigrationStatusResult['pathDecision'];
  let routingUnreachable = false;
  if (mode === 'online') {
    const originHash = markerHash ?? EMPTY_CONTRACT_HASH;
    const outcome = findPathWithDecision(graph, originHash, targetHash, {
      ...ifDefined('refName', activeRefName),
      required: effectiveRequired,
    });
    if (outcome.kind === 'ok') {
      pathDecision = toPathDecisionResult(outcome.decision);
    } else if (outcome.kind === 'unsatisfiable') {
      return notOk(
        mapMigrationToolsError(
          errorNoInvariantPath({
            ...ifDefined('refName', activeRefName),
            required: [...effectiveRequired].sort(),
            missing: outcome.missing,
            structuralPath: outcome.structuralPath.map(toStructuralEdge),
          }),
        ),
      );
    } else {
      // outcome.kind === 'unreachable' — origin (marker) has no structural
      // path to the active target. `pendingCount` and `hasInvariantWork`
      // both report zero in this case, but emitting MIGRATION.UP_TO_DATE
      // would be wrong: the database simply cannot reach the requested
      // ref/contract from its current state. Suppress UP_TO_DATE below.
      routingUnreachable = true;
    }
  }

  if (mode === 'online') {
    if (markerHash !== undefined && !graph.nodes.has(markerHash) && markerHash === contractHash) {
      diagnostics.push({
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        severity: 'warn',
        message: 'Database matches the current contract but was updated directly (not via migrate)',
        hints: ["Run 'prisma-next migration plan' to plan a migration to your current contract"],
      });
    } else if (pendingCount > 0) {
      diagnostics.push({
        code: 'MIGRATION.DATABASE_BEHIND',
        severity: 'info',
        message: `${pendingCount} migration(s) pending`,
        hints: ["Run 'prisma-next migrate' to apply pending migrations"],
      });
    } else if (hasInvariantWork) {
      diagnostics.push({
        code: 'MIGRATION.INVARIANTS_PENDING',
        severity: 'info',
        message: `Missing required invariant(s): ${missingList}`,
        hints: [
          `Run 'prisma-next migrate --to ${activeRefName ?? '<ref>'}' to apply a path that covers the required invariants`,
        ],
      });
    } else if (!routingUnreachable) {
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
    targetHash,
    contractHash,
    summary,
    diagnostics,
    ...ifDefined('markerHash', markerHash),
    requiredInvariants,
    ...ifDefined('appliedInvariants', appliedInvariants),
    ...ifDefined('missingInvariants', missingInvariants),
    ...(statusRefs.length > 0 ? { refs: statusRefs } : {}),
    ...ifDefined('pathDecision', pathDecision),
    graph,
    bundles,
    edgeStatuses,
    ...ifDefined('activeRefHash', activeRefHash),
    ...ifDefined('activeRefName', activeRefName),
    spaces: aggregateSpaces,
    ...ifDefined('totalPendingAcrossSpaces', totalPendingAcrossSpaces),
  };
  return ok(result);
}

export function createMigrationStatusCommand(): Command {
  const command = new Command('status');
  setCommandDescriptions(
    command,
    'Show migration path and pending status',
    'Shows which migrations are pending between the database marker and\n' +
      'the target contract. Requires a database connection for live status.\n' +
      'Use `migration graph` for topology, `migration log` for history,\n' +
      'and `migration list` for on-disk enumeration.',
  );
  setCommandExamples(command, [
    'prisma-next migration status --db $DATABASE_URL',
    'prisma-next migration status --to production --db $DATABASE_URL',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration log', oneLiner: 'Show executed migration history' },
    { verb: 'migration list', oneLiner: 'List on-disk migrations' },
    { verb: 'migration graph', oneLiner: 'Show the migration graph topology' },
    { verb: 'migration show', oneLiner: 'Display migration package contents' },
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option(
      '--to <contract>',
      'Target contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path)',
    )
    .option(
      '--from <contract>',
      'Origin contract reference; same grammar as --to. Supplying --from switches to offline path computation.',
    )
    .action(async (options: MigrationStatusOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);

      const result = await executeMigrationStatusCommand(options, flags, ui);

      const exitCode = handleResult(result, flags, ui, (statusResult) => {
        if (flags.json) {
          const {
            graph: _graph,
            bundles: _bundles,
            edgeStatuses: _edgeStatuses,
            activeRefHash: _activeRefHash,
            activeRefName: _activeRefName,
            diverged: _diverged,
            ...jsonResult
          } = statusResult;
          ui.output(JSON.stringify(jsonResult, null, 2));
        } else if (!flags.quiet) {
          const colorize = flags.color !== false;

          if (statusResult.graph) {
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

            const graphToRender = statusResult.diverged
              ? renderInput.graph
              : extractRelevantSubgraph(renderInput.graph, renderInput.relevantPaths);
            const dagreOptions = isLinearGraph(graphToRender) ? { ranksep: 1 } : undefined;
            const renderOptions = {
              ...renderInput.options,
              colorize,
              ...ifDefined('dagreOptions', dagreOptions),
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

export function formatStatusSummary(result: MigrationStatusResult, colorize: boolean): string {
  const c = (fn: (s: string) => string, s: string) => (colorize ? fn(s) : s);
  const lines: string[] = [];

  const hasUnknown = result.migrations.some((e) => e.status === 'unknown');
  const pendingCount = result.migrations.filter((e) => e.status === 'pending').length;

  const hasWarnings = result.diagnostics?.some((d) => d.severity === 'warn') ?? false;
  // INVARIANTS_PENDING is filed at severity 'info' (per ADR 208) so the
  // warn-severity check above doesn't see it. It still represents pending
  // work, so it must promote the summary off the success icon.
  const hasInvariantPending =
    result.diagnostics?.some((d) => d.code === 'MIGRATION.INVARIANTS_PENDING') ?? false;

  if (result.mode === 'online') {
    if (hasUnknown || hasWarnings) {
      lines.push(`${c(yellow, '⚠')} ${result.summary}`);
    } else if (pendingCount === 0 && !hasInvariantPending) {
      lines.push(`${c(cyan, '✔')} ${result.summary}`);
    } else {
      lines.push(`${c(yellow, '⧗')} ${result.summary}`);
    }
  } else {
    lines.push(result.summary);
  }

  if (result.requiredInvariants.length > 0) {
    if (result.appliedInvariants !== undefined && result.missingInvariants !== undefined) {
      lines.push(`${c(dim, 'applied  ')}${formatInvariantList(result.appliedInvariants)}`);
      lines.push(`${c(dim, 'missing  ')}${formatInvariantList(result.missingInvariants)}`);
    } else {
      lines.push(`${c(dim, 'applied  ')}(unknown — connect a database to evaluate)`);
    }
  }

  const warnings = result.diagnostics?.filter((d) => d.severity === 'warn') ?? [];
  for (const diag of warnings) {
    lines.push(`${c(yellow, '⚠')} ${diag.message}`);
    for (const hint of diag.hints) {
      lines.push(`  ${c(dim, hint)}`);
    }
  }

  // Per-space section. Suppressed when there's no extension space —
  // the top-level output already covers the app member.
  // When extensions exist, render every space (including the app)
  // for consistency, plus a cross-space pending total + apply hint.
  if (result.spaces?.some((s) => s.kind === 'extension')) {
    const total = result.totalPendingAcrossSpaces ?? 0;
    lines.push('');
    lines.push(c(dim, 'spaces'));
    for (const space of result.spaces) {
      lines.push(formatSpaceLine(space, c));
    }
    if (total > 0) {
      lines.push('');
      lines.push(
        `${c(yellow, '⧗')} ${total} pending migration(s) across ${result.spaces.length} space(s) — run 'prisma-next migrate' to apply`,
      );
    }
  }

  return lines.join('\n');
}

function formatSpaceLine(
  space: MigrationStatusSpaceEntry,
  c: (fn: (s: string) => string, s: string) => string,
): string {
  const glyph = (() => {
    if (space.status === 'up-to-date' || space.status === 'no-marker') return c(cyan, '✓');
    if (space.status === 'pending') return c(yellow, '⧗');
    if (space.status === 'unreachable' || space.status === 'never-planned') return c(magenta, '✗');
    return ' ';
  })();
  const tag = space.kind === 'app' ? '[app]' : '[ext]';
  const head = space.headHash.slice(0, 8);
  const marker =
    space.markerHash === undefined
      ? '(unknown)'
      : space.markerHash === null
        ? '(no marker)'
        : space.markerHash.slice(0, 8);
  const pending =
    space.pendingCount === undefined
      ? ''
      : space.pendingCount === 0
        ? c(dim, ' (up to date)')
        : c(yellow, ` (${space.pendingCount} pending)`);
  return `  ${glyph} ${c(dim, tag)} ${space.spaceId} → head ${c(dim, head)}, marker ${c(dim, marker)}${pending}`;
}

function formatInvariantList(ids: readonly string[]): string {
  return ids.length === 0 ? '(none)' : ids.join(', ');
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
