import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import type {
  ContractMarkerRecordLike,
  ContractSpaceMember,
} from '@prisma-next/migration-tools/aggregate';
import { requireHeadRef } from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import {
  errorNoInvariantPath,
  errorUnknownInvariant,
  MigrationToolsError,
} from '@prisma-next/migration-tools/errors';
import {
  findPath,
  findPathWithDecision,
  findReachableLeaves,
} from '@prisma-next/migration-tools/migration-graph';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import type { RefEntry, Refs } from '@prisma-next/migration-tools/refs';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { dim, yellow } from 'colorette';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
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
  toStructuralEdge,
} from '../utils/command-helpers';
import {
  buildReadAggregate,
  loadContractRawSafely,
  refusePackageCorruptionOnAggregate,
} from '../utils/contract-space-aggregate-loader';
import { buildMigrationGraphLayout } from '../utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../utils/formatters/migration-graph-rows';
import {
  type MigrationEdgeAnnotation,
  renderMigrationGraphTree,
} from '../utils/formatters/migration-graph-tree-render';
import type { MigrationListEntry } from '../utils/formatters/migration-list-types';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import type { StatusDiagnostic } from '../utils/migration-types';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';
import {
  listRefsByContractHash,
  migrationSpaceListEntriesFromAggregate,
  runMigrationList,
} from './migration-list';
import {
  appliedHashesFromLedger,
  deriveStatusEdgeAnnotations,
  statusForMigrationHash,
} from './migration-status-overlay';

interface MigrationStatusOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly to?: string;
  readonly from?: string;
  readonly space?: string;
}

export interface MigrationStatusMigrationEntry extends MigrationListEntry {
  readonly status: 'applied' | 'pending' | null;
}

export interface MigrationStatusSpaceResult {
  readonly spaceId: string;
  readonly markerHash: string | null;
  readonly targetHash: string;
  readonly migrations: readonly MigrationStatusMigrationEntry[];
}

export interface MigrationStatusResult {
  readonly ok: true;
  readonly spaces: readonly MigrationStatusSpaceResult[];
  readonly summary: string;
  readonly missingInvariantsLine?: string;
  readonly diagnostics: readonly StatusDiagnostic[];
  readonly treeSections: readonly MigrationStatusTreeSection[];
}

export interface MigrationStatusTreeSection {
  readonly spaceId: string;
  readonly tree: string;
  readonly showHeading: boolean;
}

export type { StatusDiagnostic, StatusRef } from '../utils/migration-types';

function shortDisplayHash(hash: string): string {
  const stripped = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return stripped.slice(0, 12);
}

function resolveTargetHashForSpace(
  member: ContractSpaceMember,
  contractHash: string,
  activeRefHash: string | undefined,
): string | undefined {
  const graph = member.graph();
  if (activeRefHash !== undefined && graph.nodes.has(activeRefHash)) {
    return activeRefHash;
  }
  if (graph.nodes.has(contractHash)) {
    return contractHash;
  }
  if (graph.nodes.size === 0) {
    return requireHeadRef(member).hash;
  }
  const leaves = findReachableLeaves(graph, EMPTY_CONTRACT_HASH);
  if (leaves.length === 1) {
    return leaves[0];
  }
  return undefined;
}

function buildStatusMigrations(
  listMigrations: readonly MigrationListEntry[],
  annotations: ReadonlyMap<string, MigrationEdgeAnnotation>,
): readonly MigrationStatusMigrationEntry[] {
  return listMigrations.map((migration) => ({
    ...migration,
    status: statusForMigrationHash(migration.migrationHash, annotations),
  }));
}

function renderSpaceTree(args: {
  readonly member: ContractSpaceMember;
  readonly contractHash: string;
  readonly markerHash: string | undefined;
  readonly showDbMarker: boolean;
  readonly targetHash: string;
  readonly originHash: string;
  readonly appliedHashes: ReadonlySet<string>;
  readonly showAppliedOverlay: boolean;
  readonly colorize: boolean;
  readonly glyphMode: 'unicode' | 'ascii';
}): string {
  const graph = args.member.graph();
  if (graph.nodes.size === 0) {
    return '';
  }
  const annotations = deriveStatusEdgeAnnotations({
    graph,
    targetHash: args.targetHash,
    originHash: args.originHash,
    appliedMigrationHashes: args.appliedHashes,
    showAppliedOverlay: args.showAppliedOverlay,
  });
  const refsByHash = listRefsByContractHash(args.member);
  const rowModel = buildMigrationGraphRows(graph, { contractHash: args.contractHash });
  const layout = buildMigrationGraphLayout(rowModel);
  return renderMigrationGraphTree(layout, {
    refsByHash,
    ...(args.showDbMarker && args.markerHash !== undefined ? { dbHash: args.markerHash } : {}),
    contractHash: args.contractHash,
    edgeAnnotationsByHash: annotations,
    colorize: args.colorize,
    glyphMode: args.glyphMode,
  });
}

function countPending(migrations: readonly MigrationStatusMigrationEntry[]): number {
  return migrations.filter((m) => m.status === 'pending').length;
}

export function buildStatusHeadline(args: {
  readonly pendingCount: number;
  readonly targetHash: string;
  readonly markerDiverged: boolean;
  readonly markerHash: string | undefined;
}): string {
  if (args.markerDiverged && args.markerHash !== undefined) {
    return `Database marker ${shortDisplayHash(args.markerHash)} is not in the on-disk migration graph`;
  }
  if (args.pendingCount === 0) {
    return 'up to date';
  }
  return `${args.pendingCount} pending — run \`prisma-next migrate --to ${shortDisplayHash(args.targetHash)}\``;
}

export function formatStatusSummary(result: MigrationStatusResult, colorize: boolean): string {
  const c = (fn: (s: string) => string, s: string) => (colorize ? fn(s) : s);
  const lines: string[] = [];
  const pendingTotal = result.spaces.reduce(
    (sum, space) => sum + countPending(space.migrations),
    0,
  );
  const hasDivergence = result.diagnostics.some(
    (d) => d.code === 'MIGRATION.MARKER_NOT_IN_HISTORY',
  );
  if (hasDivergence || pendingTotal > 0) {
    lines.push(c(yellow, result.summary));
  } else {
    lines.push(result.summary);
  }
  if (result.missingInvariantsLine !== undefined) {
    lines.push(c(dim, result.missingInvariantsLine));
  }
  return lines.join('\n');
}

export function formatStatusHumanOutput(result: MigrationStatusResult, colorize: boolean): string {
  const sections: string[] = [];
  for (const section of result.treeSections) {
    if (section.showHeading) {
      sections.push(`${section.spaceId}:`);
    }
    if (section.tree.length > 0) {
      sections.push(section.tree);
    } else {
      sections.push('(no migrations)');
    }
    sections.push('');
  }
  sections.push(formatStatusSummary(result, colorize));
  return sections.join('\n').trimEnd();
}

async function readMarkersAndLedgers(args: {
  readonly client: ReturnType<typeof createControlClient>;
  readonly spaceIds: readonly string[];
}): Promise<{
  readonly markersBySpace: ReadonlyMap<string, ContractMarkerRecordLike>;
  readonly ledgersBySpace: ReadonlyMap<string, readonly LedgerEntryRecord[]>;
}> {
  const markersBySpace = new Map<string, ContractMarkerRecordLike>();
  if (typeof args.client.readAllMarkers === 'function') {
    const all = await args.client.readAllMarkers();
    for (const [spaceId, marker] of all) {
      markersBySpace.set(spaceId, marker);
    }
  }
  const ledgersBySpace = new Map<string, readonly LedgerEntryRecord[]>();
  for (const spaceId of args.spaceIds) {
    ledgersBySpace.set(spaceId, await args.client.readLedger(spaceId));
  }
  return { markersBySpace, ledgersBySpace };
}

async function executeMigrationStatusCommand(
  options: MigrationStatusOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationStatusResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, migrationsRelative, refsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

  const dbConnection = options.db ?? config.db?.connection;
  const hasDriver = !!config.driver;
  const usingFromOverride = options.from !== undefined;

  if (!usingFromOverride && (!dbConnection || !hasDriver)) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: 'migration status needs a database connection to read the marker and ledger (or pass --from for offline path preview)',
        retryCommand: 'prisma-next migration status --from <contract>',
      }),
    );
  }

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

  const loaded = await buildReadAggregate(config, { migrationsDir });
  if (!loaded.ok) {
    return notOk(loaded.failure);
  }

  const { aggregate } = loaded.value;
  const contractRawForAggregate = await loadContractRawSafely(config);
  if (contractRawForAggregate !== null) {
    const corruptionFailure = refusePackageCorruptionOnAggregate(aggregate);
    if (corruptionFailure) {
      return notOk(corruptionFailure);
    }
  }
  const appGraph = aggregate.app.graph();

  let activeRefHash: string | undefined;
  let activeRefName: string | undefined;
  let activeRefEntry: RefEntry | undefined;
  let fromOverrideHash: string | undefined;

  if (options.to) {
    const refResult = parseContractRef(options.to, { graph: appGraph, refs: allRefs });
    if (!refResult.ok) {
      return notOk(mapRefResolutionError(refResult.failure));
    }
    activeRefHash = refResult.value.hash;
    if (refResult.value.provenance.kind === 'ref') {
      activeRefName = refResult.value.provenance.refName;
      activeRefEntry = allRefs[activeRefName];
    }
  }

  if (options.from) {
    const fromResult = parseContractRef(options.from, { graph: appGraph, refs: allRefs });
    if (!fromResult.ok) {
      return notOk(mapRefResolutionError(fromResult.failure));
    }
    fromOverrideHash = fromResult.value.hash;
  }

  const requiredInvariants: readonly string[] = [...(activeRefEntry?.invariants ?? [])].sort();

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
    if (options.from) {
      details.push({ label: 'from', value: options.from });
    }
    if (options.space) {
      details.push({ label: 'space', value: options.space });
    }
    const header = formatStyledHeader({
      command: 'migration status',
      description: 'Show migration history and applied status',
      details,
      flags,
    });
    ui.stderr(header);
  }

  const listSpaces = await migrationSpaceListEntriesFromAggregate(aggregate, migrationsDir);
  const listResult = runMigrationList({
    spaces: listSpaces,
    ...ifDefined('spaceFilter', options.space),
  });
  if (!listResult.ok) {
    return listResult;
  }

  const scopedSpaces = listResult.value.spaces;
  const showSpaceHeadings = scopedSpaces.length > 1;

  let markersBySpace = new Map<string, ContractMarkerRecordLike>();
  let ledgersBySpace = new Map<string, readonly LedgerEntryRecord[]>();
  let connected = false;

  if (dbConnection && hasDriver && !usingFromOverride) {
    const client = createControlClient({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver,
      extensionPacks: config.extensionPacks ?? [],
    });
    try {
      await client.connect(dbConnection);
      connected = true;
      const read = await readMarkersAndLedgers({
        client,
        spaceIds: scopedSpaces.map((s) => s.spaceId),
      });
      markersBySpace = new Map(read.markersBySpace);
      ledgersBySpace = new Map(read.ledgersBySpace);
    } catch (error) {
      if (CliStructuredError.is(error)) {
        return notOk(error);
      }
      return notOk(
        errorUnexpected(error instanceof Error ? error.message : String(error), {
          why: `Failed to read database state: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    } finally {
      await client.close();
    }
  }

  if (activeRefEntry && activeRefEntry.invariants.length > 0 && connected) {
    const declared = collectDeclaredInvariants(appGraph);
    const markerInvariants = markersBySpace.get(aggregate.app.spaceId)?.invariants ?? [];
    const known = new Set<string>(declared);
    for (const id of markerInvariants) known.add(id);
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

  const showAppliedOverlay = connected && !usingFromOverride;
  const showDbMarker = connected && !usingFromOverride;
  const glyphMode = ui.resolveGlyphMode(false);
  const colorize = flags.color !== false;

  const statusSpaces: MigrationStatusSpaceResult[] = [];
  const treeSections: MigrationStatusTreeSection[] = [];
  let markerDiverged = false;
  let markerCannotReachTarget = false;
  let headlineTargetHash = contractHash;
  let totalPending = 0;

  for (const spaceEntry of scopedSpaces) {
    const member = aggregate.space(spaceEntry.spaceId);
    if (member === undefined) {
      continue;
    }
    const graph = member.graph();
    const spaceContractHash = member.contract().storage.storageHash;
    const targetHash = resolveTargetHashForSpace(member, contractHash, activeRefHash);
    if (targetHash === undefined) {
      diagnostics.push({
        code: 'MIGRATION.DIVERGED',
        severity: 'warn',
        message: 'There are multiple valid migration paths — you must select a target',
        hints: [
          "Use '--to <contract>' to select a target",
          "Or 'prisma-next ref set <name> <hash>' to create one",
        ],
      });
      continue;
    }
    headlineTargetHash = targetHash;

    const markerRecord = markersBySpace.get(spaceEntry.spaceId);
    const markerHash = usingFromOverride
      ? fromOverrideHash
      : (markerRecord?.storageHash ?? undefined);
    const originHash = markerHash ?? EMPTY_CONTRACT_HASH;
    const markerInGraph =
      markerHash === undefined || graph.nodes.has(markerHash) || markerHash === spaceContractHash;
    if (
      connected &&
      !usingFromOverride &&
      markerHash !== undefined &&
      markerInGraph &&
      markerHash !== targetHash &&
      findPath(graph, originHash, targetHash) === null
    ) {
      markerCannotReachTarget = true;
    }

    if (connected && !usingFromOverride && markerHash !== undefined && !markerInGraph) {
      markerDiverged = true;
      diagnostics.push({
        code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
        severity: 'warn',
        message:
          'Database was updated outside the migration system (marker does not match any migration)',
        hints: [
          "Run 'prisma-next db sign' to overwrite the marker if the database already matches the contract",
          "Run 'prisma-next db update' to push the current contract to the database",
        ],
      });
    }

    const ledger = ledgersBySpace.get(spaceEntry.spaceId) ?? [];
    const appliedHashes = showAppliedOverlay ? appliedHashesFromLedger(ledger) : new Set<string>();

    const tree = renderSpaceTree({
      member,
      contractHash: spaceContractHash,
      markerHash,
      showDbMarker,
      targetHash,
      originHash,
      appliedHashes,
      showAppliedOverlay,
      colorize,
      glyphMode,
    });

    const annotations = deriveStatusEdgeAnnotations({
      graph,
      targetHash,
      originHash,
      appliedMigrationHashes: appliedHashes,
      showAppliedOverlay,
    });
    const migrations = buildStatusMigrations(spaceEntry.migrations, annotations);
    const pending = countPending(migrations);
    totalPending += pending;

    statusSpaces.push({
      spaceId: spaceEntry.spaceId,
      markerHash: markerHash ?? null,
      targetHash,
      migrations,
    });
    treeSections.push({
      spaceId: spaceEntry.spaceId,
      tree,
      showHeading: showSpaceHeadings,
    });
  }

  let missingInvariantsLine: string | undefined;
  if (connected && requiredInvariants.length > 0) {
    const markerInvariants = markersBySpace.get(aggregate.app.spaceId)?.invariants ?? [];
    const markerSet = new Set(markerInvariants);
    const missing = requiredInvariants.filter((id) => !markerSet.has(id));
    if (missing.length > 0) {
      missingInvariantsLine = `missing invariant(s): ${missing.join(', ')}`;
      if (activeRefHash !== undefined) {
        const originHash =
          markersBySpace.get(aggregate.app.spaceId)?.storageHash ?? EMPTY_CONTRACT_HASH;
        const outcome = findPathWithDecision(appGraph, originHash, activeRefHash, {
          ...ifDefined('refName', activeRefName),
          required: new Set(missing),
        });
        if (outcome.kind === 'unsatisfiable') {
          return notOk(
            mapMigrationToolsError(
              errorNoInvariantPath({
                ...ifDefined('refName', activeRefName),
                required: [...missing].sort(),
                missing: outcome.missing,
                structuralPath: outcome.structuralPath.map(toStructuralEdge),
              }),
            ),
          );
        }
      }
    }
  }

  const appMarkerHash = markersBySpace.get(aggregate.app.spaceId)?.storageHash;
  const summary = markerCannotReachTarget
    ? 'Database marker cannot reach the selected target'
    : buildStatusHeadline({
        pendingCount: totalPending,
        targetHash: headlineTargetHash,
        markerDiverged,
        markerHash: appMarkerHash,
      });

  if (scopedSpaces.every((s) => s.migrations.length === 0)) {
    return ok({
      ok: true,
      spaces: statusSpaces,
      summary: 'No migrations found',
      diagnostics,
      treeSections,
      ...ifDefined('missingInvariantsLine', missingInvariantsLine),
    });
  }

  return ok({
    ok: true,
    spaces: statusSpaces,
    summary,
    diagnostics,
    treeSections,
    ...ifDefined('missingInvariantsLine', missingInvariantsLine),
  });
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
    'prisma-next migration status --from sha256:abc --to production',
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
    .option('--space <id>', 'Narrow output to a single contract space')
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
          ui.output(
            JSON.stringify(
              {
                ok: true,
                spaces: statusResult.spaces,
                summary: statusResult.summary,
                ...(statusResult.diagnostics.length > 0
                  ? { diagnostics: statusResult.diagnostics }
                  : {}),
                ...(statusResult.missingInvariantsLine
                  ? { missingInvariants: statusResult.missingInvariantsLine }
                  : {}),
              },
              null,
              2,
            ),
          );
        } else if (!flags.quiet) {
          ui.output(formatStatusHumanOutput(statusResult, flags.color !== false));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
