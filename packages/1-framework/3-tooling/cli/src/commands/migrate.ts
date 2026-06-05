import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { createControlStack } from '@prisma-next/framework-components/control';
import { type ContractSpaceMember, requireHeadRef } from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { errorUnknownInvariant, MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { findLatestMigration, isGraphNode } from '@prisma-next/migration-tools/migration-graph';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import type { RefEntry, Refs } from '@prisma-next/migration-tools/refs';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { bold, greenBright } from 'colorette';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import { planMemberPath } from '../control-api/operations/migrate';
import type {
  MigrateFailure,
  MigratePathDecision,
  PerSpaceExecutionEntry,
} from '../control-api/types';
import {
  CliStructuredError,
  type CliStructuredError as CliStructuredErrorType,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorMarkerMismatch,
  errorPathUnreachable,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
  mapMigrationToolsError,
  mapRefResolutionError,
  requireLiveDatabase,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  collectDeclaredInvariants,
  maskConnectionUrl,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  targetSupportsMigrations,
} from '../utils/command-helpers';
import { mapContractAtError } from '../utils/contract-at-errors';
import {
  buildReadAggregate,
  loadContractSpaceAggregateForCli,
  refuseContractSpaceIntegrity,
} from '../utils/contract-space-aggregate-loader';
import { toDeclaredExtensionsFromRaw } from '../utils/extension-pack-inputs';
import { buildMigrationGraphLayout } from '../utils/formatters/migration-graph-layout';
import { buildMigrationGraphRows } from '../utils/formatters/migration-graph-rows';
import { indentMigrationGraphTreeBlock } from '../utils/formatters/migration-graph-space-render';
import type { MigrationEdgeAnnotation } from '../utils/formatters/migration-graph-tree-render';
import { renderMigrationGraphTree } from '../utils/formatters/migration-graph-tree-render';
import {
  abbreviateContractHash,
  MIGRATION_LIST_HASH_WIDTH,
  migrationListEmptySource,
  migrationListForwardArrow,
  padFromHashColumn,
} from '../utils/formatters/migration-list-data-column';
import { formatMigrationApplyCommandOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { executeRefAdvancement, readContractIR } from '../utils/ref-advancement';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';
import { listRefsByContractHash } from './migration-list';

interface MigrateCommandOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly to?: string;
  readonly advanceRef?: string;
  readonly show?: boolean;
  readonly from?: string;
}

/**
 * One migration that will run in a `migrate --show` preview, in execution order.
 */
export interface MigrateShowMigration {
  readonly spaceId: string;
  readonly dirName: string;
  readonly migrationHash: string;
  readonly from: string;
  readonly to: string;
}

/** Result returned by `migrate --show`. Read-only; no writes performed. */
export interface MigrateShowResult {
  readonly ok: true;
  readonly migrations: readonly MigrateShowMigration[];
  readonly summary: string;
  /**
   * Pre-rendered Tier-3 graph tree for human output. On-path migrations are
   * highlighted bright green (nodes, hashes, names, lane lines); off-path
   * migrations are fully drawn in dim grey. Only present in human (non-JSON) mode.
   */
  readonly graphOutput?: string;
}

export interface MigrateResult {
  readonly ok: boolean;
  readonly migrationsApplied: number;
  readonly migrationsTotal: number;
  readonly markerHash: string;
  readonly applied: readonly {
    readonly spaceId: string;
    readonly dirName: string;
    readonly migrationHash: string;
    readonly from: string;
    readonly to: string;
    readonly operationsExecuted: number;
  }[];
  readonly summary: string;
  readonly perSpace: readonly PerSpaceExecutionEntry[];
  readonly pathDecision?: MigratePathDecision;
  readonly timings: {
    readonly total: number;
  };
  readonly advancedRef?: { readonly name: string; readonly hash: string } | null;
}

/**
 * Read-only preview of the migration path `migrate` will take.
 *
 * Computes the path through the SAME seam as `executeMigrate`:
 * - `readAllMarkers()` for the from-state (when no `--from` is given), preserving
 *   the full marker including `invariants` (not just `storageHash`).
 * - `planMemberPath()` (shared with `executeMigrate`) for per-member path selection,
 *   which feeds `graphWalkStrategy()` with the same target hash, target invariants,
 *   and current marker as the real apply path uses.
 *
 * Returns BEFORE any write boundary (`runMigration` / marker / DDL). No
 * DB state is mutated.
 */
async function executeMigrateShowCommand(
  options: MigrateCommandOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrateShowResult, CliStructuredErrorType>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, migrationsRelative, refsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

  const dbConnection = options.db ?? config.db?.connection;
  const hasDriver = !!config.driver;
  const hasExplicitFrom = options.from !== undefined;

  // When --from is omitted we read the live DB marker (same as migrate's default).
  // When --from is given, we're in offline hypothetical mode — no connection needed.
  if (!hasExplicitFrom) {
    const missingDb = requireLiveDatabase({
      dbConnection,
      hasDriver,
      why: 'migrate --show needs a database connection to read the live marker (or pass --from <contract> for an offline preview)',
      retryCommand: 'prisma-next migrate --show --from <contract>',
    });
    if (missingDb) {
      return notOk(missingDb);
    }
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

  const loaded = await buildReadAggregate(config, { migrationsDir });
  if (!loaded.ok) {
    return notOk(loaded.failure);
  }
  const { aggregate, contractHash } = loaded.value;
  const appGraph = aggregate.app.graph();

  // Resolve the --to target (defaults to the on-disk contract, same as migrate).
  // Also capture the ref's invariants so planMemberPath feeds graphWalkStrategy the
  // same target invariants that real migrate would use (refInvariants ?? headRef.invariants).
  let targetHash: string = contractHash;
  let refInvariants: readonly string[] | undefined;
  if (options.to) {
    const toResult = parseContractRef(options.to, {
      graph: appGraph,
      refs: allRefs,
      contractHash,
    });
    if (!toResult.ok) {
      return notOk(mapRefResolutionError(toResult.failure));
    }
    if (toResult.value.provenance.kind === 'reserved-db') {
      return notOk(
        errorDatabaseConnectionRequired({
          why: '@db is not valid as a --to target; it names the live database state, not a target contract.',
          commandName: 'migrate --show',
        }),
      );
    }
    targetHash = toResult.value.hash;
    if (toResult.value.provenance.kind === 'ref') {
      const refEntry = allRefs[toResult.value.provenance.refName];
      if (refEntry) refInvariants = refEntry.invariants;
    }
  }

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
    ];
    if (dbConnection && !hasExplicitFrom) {
      details.push({ label: 'database', value: maskConnectionUrl(String(dbConnection)) });
    }
    if (options.from) {
      details.push({ label: 'from', value: options.from });
    }
    if (options.to) {
      details.push({ label: 'to', value: options.to });
    }
    const header = formatStyledHeader({
      command: 'migrate --show',
      description: 'Preview the migration path migrate will take (read-only)',
      details,
      flags,
    });
    ui.stderr(header);
  }

  // Resolve the from-state.
  // - Explicit --from: parse it offline (no connection).
  // - Omitted: read the live DB marker via readAllMarkers() — the same source migrate uses.
  //
  // Full marker records (storageHash + invariants) are preserved so planMemberPath
  // can feed graphWalkStrategy the complete currentMarker — exactly as executeMigrate
  // does via familyInstance.readAllMarkers(). A stripped { storageHash, invariants: [] }
  // marker would produce a different `required` set and a different (incorrect) path.
  type LiveMarker = { readonly storageHash: string; readonly invariants: readonly string[] };
  const markerBySpace = new Map<string, LiveMarker | null>();
  const allMembers: ReadonlyArray<ContractSpaceMember> = [aggregate.app, ...aggregate.extensions];

  if (hasExplicitFrom) {
    // @db with explicit --from requires a connection
    if (options.from === '@db') {
      const missingDb = requireLiveDatabase({
        dbConnection,
        hasDriver,
        why: '@db resolves to the live database marker and requires a --db connection',
        retryCommand: 'prisma-next migrate --show --from @db --db $DATABASE_URL',
      });
      if (missingDb) {
        return notOk(missingDb);
      }
      // Fall through to the connection path below
    } else {
      const fromResult = parseContractRef(options.from, {
        graph: appGraph,
        refs: allRefs,
        contractHash,
      });
      if (!fromResult.ok) {
        return notOk(mapRefResolutionError(fromResult.failure));
      }
      if (fromResult.value.provenance.kind === 'reserved-db') {
        // Unreachable given the @db branch above, but guard for safety
        const missingDb = requireLiveDatabase({
          dbConnection,
          hasDriver,
          why: '@db resolves to the live database marker and requires a --db connection',
        });
        if (missingDb) {
          return notOk(missingDb);
        }
      } else {
        // Offline hypothetical: the --from ref only carries a hash (no live invariants).
        // Apply the from-hash marker to the APP space only. Extension spaces are left
        // absent from markerBySpace (treated as null / greenfield by planMemberPath),
        // so they plan from their own marker → own head — exactly as executeMigrate does.
        const fromHash = fromResult.value.hash;
        const offlineMarker: LiveMarker | null =
          fromHash === EMPTY_CONTRACT_HASH ? null : { storageHash: fromHash, invariants: [] };
        markerBySpace.set(aggregate.app.spaceId, offlineMarker);
      }
    }
  }

  // If we need the live DB marker (no --from, or --from @db), connect and read.
  const needsLiveMarker = !hasExplicitFrom || options.from === '@db';
  if (needsLiveMarker) {
    if (!dbConnection || !hasDriver) {
      return notOk(
        errorDatabaseConnectionRequired({
          why: 'A database connection is required to read the live marker for migrate --show',
          commandName: 'migrate --show',
        }),
      );
    }
    const client = createControlClient({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver!,
      extensionPacks: config.extensionPacks ?? [],
    });
    try {
      await client.connect(dbConnection);
      const allMarkers = await client.readAllMarkers();
      // Store the full marker record (storageHash + invariants) per space.
      // This is the same data executeMigrate uses via familyInstance.readAllMarkers().
      for (const member of allMembers) {
        const marker = allMarkers.get(member.spaceId);
        markerBySpace.set(member.spaceId, marker ?? null);
      }
    } catch (error) {
      if (CliStructuredError.is(error)) {
        return notOk(error);
      }
      if (MigrationToolsError.is(error)) {
        return notOk(mapMigrationToolsError(error));
      }
      return notOk(
        errorUnexpected(error instanceof Error ? error.message : String(error), {
          why: `Failed to read live DB marker: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    } finally {
      await client.close();
    }
  }

  // Walk the path via planMemberPath — the same helper executeMigrate uses.
  // planMemberPath feeds graphWalkStrategy identical inputs (targetHash, targetInvariants,
  // currentMarker with full invariants), so the preview path is always the path migrate runs.
  //
  // Canonical schedule order: extensions alphabetically first, then app — mirroring the
  // runner's `applyOrder` in operations/migrate.ts so the "Will run, in order:" list
  // reflects the actual execution sequence (extensions install first, app last).
  const canonicalOrderMembers: ReadonlyArray<ContractSpaceMember> = [
    ...aggregate.extensions,
    aggregate.app,
  ];
  const orderedMigrations: MigrateShowMigration[] = [];
  for (const member of canonicalOrderMembers) {
    const isAppMember = member.spaceId === aggregate.app.spaceId;
    const headRef = requireHeadRef(member);
    const memberTargetHash = isAppMember ? targetHash : headRef.hash;
    const memberRefInvariants = isAppMember ? refInvariants : undefined;
    const liveMarker = markerBySpace.get(member.spaceId) ?? null;

    const outcome = planMemberPath({
      member,
      aggregate,
      targetHash: memberTargetHash,
      refInvariants: memberRefInvariants,
      liveMarker,
    });

    if (outcome.kind === 'at-head') {
      // Empty-graph member already at target — nothing to run for this space.
      continue;
    }
    if (outcome.kind === 'never-planned') {
      return notOk(
        errorPathUnreachable({
          code: 'MIGRATION_PATH_NOT_FOUND',
          summary: `No on-disk migrations for contract space "${outcome.spaceId}"`,
          why: `migrate is replay-only: space "${outcome.spaceId}" has no on-disk migrations but its head ref targets "${outcome.targetHash}".`,
          meta: { spaceId: outcome.spaceId, target: outcome.targetHash, kind: 'neverPlanned' },
        }),
      );
    }
    if (outcome.kind === 'unreachable') {
      const fromHash = outcome.liveMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
      return notOk(
        errorPathUnreachable({
          code: 'MIGRATION_PATH_NOT_FOUND',
          summary: `No migration path from ${fromHash.slice(0, 14)} to ${outcome.targetHash.slice(0, 14)} in space "${outcome.spaceId}".`,
          why: `The migration graph has no path from the from-state to the target in space "${outcome.spaceId}".`,
          meta: { spaceId: outcome.spaceId, from: fromHash, to: outcome.targetHash },
        }),
      );
    }
    if (outcome.kind === 'unsatisfiable') {
      return notOk(
        errorRuntime(`Missing required invariants for space "${outcome.spaceId}"`, {
          why: `The path requires invariants not available on disk: ${outcome.missing.join(', ')}`,
        }),
      );
    }

    for (const edge of outcome.plan.migrationEdges) {
      orderedMigrations.push({
        spaceId: member.spaceId,
        dirName: edge.dirName,
        migrationHash: edge.migrationHash,
        from: edge.from,
        to: edge.to,
      });
    }
  }

  const count = orderedMigrations.length;
  const summary =
    count === 0
      ? 'Already up to date — nothing to run'
      : `${count} migration${count === 1 ? '' : 's'} will run`;

  // Build the Tier-3 graph visualization (human mode only; skipped for --json).
  // Reuses the existing annotation hook — no parallel renderer.
  let graphOutput: string | undefined;
  if (!flags.json) {
    const onPathHashes = new Set(orderedMigrations.map((m) => m.migrationHash));
    const colorize = flags.color !== false;

    // Render each space (app + extensions) as its own section, with a heading
    // when more than one space is present.
    const renderSpaceTree = (member: ContractSpaceMember, isApp: boolean): string => {
      const memberGraph = member.graph();
      const edgeAnnotations = new Map<string, MigrationEdgeAnnotation>();
      for (const edge of memberGraph.migrationByHash.values()) {
        edgeAnnotations.set(edge.migrationHash, {
          pathHighlight: onPathHashes.has(edge.migrationHash) ? 'on-path' : 'off-path',
        });
      }
      const rowModel = buildMigrationGraphRows(memberGraph, isApp ? { contractHash } : {});
      const layout = buildMigrationGraphLayout(rowModel);
      const liveMarker = markerBySpace.get(member.spaceId) ?? null;
      const liveMarkerHash = liveMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
      return renderMigrationGraphTree(layout, {
        contractHash,
        isAppSpace: isApp,
        ...(needsLiveMarker ? { dbHash: liveMarkerHash } : {}),
        refsByHash: listRefsByContractHash(member),
        edgeAnnotationsByHash: edgeAnnotations,
        colorize,
      });
    };

    const showSpaceHeadings = allMembers.length > 1;
    const sections: string[] = [];
    for (const member of allMembers) {
      const isApp = member.spaceId === aggregate.app.spaceId;
      const tree = renderSpaceTree(member, isApp);
      if (tree.length === 0) continue;
      if (showSpaceHeadings) {
        sections.push(`${member.spaceId}:\n${indentMigrationGraphTreeBlock(tree, '  ')}`);
      } else {
        sections.push(tree);
      }
    }
    graphOutput = sections.join('\n\n');
  }

  return ok({
    ok: true,
    migrations: orderedMigrations,
    summary,
    ...(graphOutput !== undefined ? { graphOutput } : {}),
  });
}

function formatShowMigrationRow(
  m: MigrateShowMigration,
  dirNameWidth: number,
  colorize: boolean,
): string {
  const arrow = migrationListForwardArrow('unicode');
  const emptySource = migrationListEmptySource('unicode');
  const fromAbbr =
    m.from === EMPTY_CONTRACT_HASH
      ? emptySource.padStart(MIGRATION_LIST_HASH_WIDTH, ' ')
      : abbreviateContractHash(m.from);
  const toAbbr = m.to === EMPTY_CONTRACT_HASH ? emptySource : abbreviateContractHash(m.to);
  const fromPadded = padFromHashColumn(fromAbbr, MIGRATION_LIST_HASH_WIDTH);
  const row = `${m.dirName.padEnd(dirNameWidth)}  ${fromPadded} ${arrow} ${toAbbr}`;
  return colorize ? greenBright(bold(row)) : row;
}

function formatMigrateShowOutput(result: MigrateShowResult, flags: GlobalFlags): string {
  if (flags.quiet) return '';
  const lines: string[] = [];
  // Graph tree first (shows the full topology with on-path highlighted).
  if (result.graphOutput !== undefined && result.graphOutput.length > 0) {
    lines.push(result.graphOutput);
    lines.push('');
  }
  lines.push(result.summary);
  if (result.migrations.length > 0) {
    const colorize = flags.color !== false;
    // Ordered list in graph migration-row format (name + from→to), green, no Clack gutter.
    const dirNameWidth = Math.max(...result.migrations.map((m) => m.dirName.length));
    lines.push('');
    lines.push('Will run, in order:');
    for (const m of result.migrations) {
      lines.push(`  ${formatShowMigrationRow(m, dirNameWidth, colorize)}`);
    }
  }
  return lines.join('\n');
}

function mapApplyFailure(failure: MigrateFailure): CliStructuredErrorType {
  if (failure.code === 'MIGRATION_PATH_NOT_FOUND') {
    return errorPathUnreachable(failure);
  }
  return errorRuntime(failure.summary, {
    why: failure.why ?? 'Migration runner failed',
    fix: 'Fix the issue and re-run `prisma-next migrate --to <contract>` — previously applied migrations are preserved.',
    meta: failure.meta ?? {},
  });
}

async function executeMigrateCommand(
  options: MigrateCommandOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<MigrateResult, CliStructuredErrorType>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, appMigrationsRelative, refsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for migrate (set db.connection in ${configPath}, or pass --db <url>)`,
        commandName: 'migrate',
      }),
    );
  }

  if (!config.driver) {
    return notOk(
      errorDriverRequired({
        why: 'Config.driver is required for migrate',
      }),
    );
  }

  if (!targetSupportsMigrations(config.target)) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  const toArg = options.to;

  // Construct the family instance up-front so the on-disk contract read
  // crosses the serializer seam (`familyInstance.deserializeContract`) at
  // the read site. The downstream `client.migrate({ contract })`
  // re-validates internally (no harm — validation is idempotent), but
  // closing the gap at the read site is what makes the cast-pattern
  // lint enforceable and matches the other CLI commands. See TML-2536.
  const stack = createControlStack(config);
  const familyInstance = config.family.create(stack);

  const contractPathAbsolute = resolveContractPath(config);
  let contractRaw: Contract;
  let contractContent: string;
  try {
    contractContent = await readFile(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return notOk(
        errorFileNotFound(contractPathAbsolute, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: 'Run `prisma-next contract emit` to generate a valid contract.json, then retry.',
        }),
      );
    }
    return notOk(
      errorContractValidationFailed(
        `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }
  try {
    contractRaw = familyInstance.deserializeContract(JSON.parse(contractContent) as unknown);
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract at ${contractPathAbsolute} failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  const loadedAggregate = await loadContractSpaceAggregateForCli({
    targetId: config.target.targetId,
    migrationsDir,
    appContract: contractRaw,
    extensionPacks: config.extensionPacks ?? [],
    deserializeContract: (json) => familyInstance.deserializeContract(json),
  });
  if (!loadedAggregate.ok) {
    return notOk(loadedAggregate.failure);
  }
  const aggregate = loadedAggregate.value;
  const integrityFailure = refuseContractSpaceIntegrity(aggregate, {
    declaredExtensions: toDeclaredExtensionsFromRaw(
      (config.extensionPacks ?? []) as ReadonlyArray<unknown>,
    ),
    checkContracts: true,
  });
  if (integrityFailure) {
    return notOk(integrityFailure);
  }

  let refEntry: RefEntry | undefined;
  let refName: string | undefined;
  if (toArg) {
    const refs = aggregate.app.refs;
    const refResult = parseContractRef(toArg, { graph: aggregate.app.graph(), refs });
    if (!refResult.ok) {
      return notOk(mapRefResolutionError(refResult.failure));
    }
    if (refResult.value.provenance.kind === 'ref') {
      refName = refResult.value.provenance.refName;
      const resolved = refs[refName];
      if (resolved) refEntry = resolved;
    } else {
      refEntry = { hash: refResult.value.hash, invariants: [] };
    }
  }

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: appMigrationsRelative },
    ];
    if (typeof dbConnection === 'string') {
      details.push({
        label: 'database',
        value: maskConnectionUrl(dbConnection),
      });
    }
    if (toArg) {
      details.push({ label: 'to', value: toArg });
    }
    const header = formatStyledHeader({
      command: 'migrate',
      description: 'Apply planned migrations to advance the database',
      url: 'https://pris.ly/migrate',
      details,
      flags,
    });
    ui.stderr(header);
  }

  const appGraph = aggregate.app.graph();

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });

  try {
    await client.connect(dbConnection);

    const allMarkers = await client.readAllMarkers();
    const appMarker = allMarkers.get('app') ?? null;

    if (appMarker !== null && !isGraphNode(appMarker.storageHash, appGraph)) {
      return notOk(
        errorMarkerMismatch(
          appMarker.storageHash,
          [...appGraph.nodes].sort(),
          findLatestMigration(appGraph)?.to ?? null,
        ),
      );
    }

    if (refEntry && refEntry.invariants.length > 0) {
      const declared = collectDeclaredInvariants(appGraph);
      const known = new Set<string>(declared);
      for (const id of appMarker?.invariants ?? []) known.add(id);
      const unknown = refEntry.invariants.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        return notOk(
          mapMigrationToolsError(
            errorUnknownInvariant({
              ...ifDefined('refName', toArg),
              unknown,
              declared: [...declared].sort(),
            }),
          ),
        );
      }
    }

    if (!flags.quiet && !flags.json) {
      ui.step('Loading contract spaces…');
    }

    // When `--to` resolves to an on-disk graph node with a matching bundle,
    // verify and apply against THAT bundle's destination contract via
    // `contractAt` — not the emitted `contract.json`. With `--to` omitted,
    // or a target with no matching bundle, the emitted contract stays the
    // apply contract (the only migrate-specific default). The same
    // `contractAt` artifacts feed the optional ref-advancement snapshot.
    let applyContract: Contract = contractRaw;
    let snapshotContractJson: Record<string, unknown> = JSON.parse(contractContent);
    let snapshotContractDts: string | undefined;
    if (toArg && refEntry) {
      const targetHash = refEntry.hash;
      const matchingBundle = aggregate.app.packages.find((p) => p.metadata.to === targetHash);
      if (matchingBundle) {
        try {
          const at = await aggregate.app.contractAt(
            targetHash,
            refName !== undefined ? { refName } : undefined,
          );
          applyContract = at.contract;
          snapshotContractJson = at.contractJson as Record<string, unknown>;
          snapshotContractDts = at.contractDts;
        } catch (error) {
          return mapContractAtError(error, { artifactRole: 'to' });
        }
      }
    }

    const applyResult = await client.migrate({
      contract: applyContract,
      migrationsDir,
      ...ifDefined('refHash', refEntry?.hash),
      ...(refEntry?.invariants ? { refInvariants: refEntry.invariants } : {}),
      ...(refEntry !== undefined ? ifDefined('refName', toArg) : {}),
    });

    if (!applyResult.ok) {
      return notOk(mapApplyFailure(applyResult.failure));
    }

    const { value } = applyResult;

    let advancedRef: { name: string; hash: string } | null = null;
    if (options.advanceRef !== undefined) {
      try {
        const contractIR =
          snapshotContractDts !== undefined
            ? { contract: snapshotContractJson, contractDts: snapshotContractDts }
            : await readContractIR(snapshotContractJson, contractPathAbsolute);
        advancedRef = await executeRefAdvancement(
          refsDir,
          options.advanceRef,
          value.markerHash,
          contractIR,
        );
      } catch (error) {
        if (MigrationToolsError.is(error)) {
          return notOk(mapMigrationToolsError(error));
        }
        throw error;
      }
    }

    return ok({
      ok: true,
      migrationsApplied: value.migrationsApplied,
      migrationsTotal: value.perSpace.length,
      markerHash: value.markerHash,
      applied: value.applied,
      summary: value.summary,
      perSpace: value.perSpace,
      ...ifDefined('pathDecision', value.pathDecision),
      timings: { total: Date.now() - startTime },
      advancedRef,
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during migrate: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createMigrateCommand(): Command {
  const command = new Command('migrate');
  setCommandDescriptions(
    command,
    'Apply planned migrations to advance the database',
    'Walks every contract space (app + extensions) and applies pending\n' +
      'on-disk migrations in canonical order (extensions alphabetically,\n' +
      'then app). Graph-walks the on-disk migration graph for every space.\n' +
      'Use --to to target a specific contract (hash, ref name, migration dir).\n' +
      'Use --show for a read-only preview of the path that would run.',
  );
  setCommandExamples(command, [
    'prisma-next migrate --db $DATABASE_URL',
    'prisma-next migrate --to production --db $DATABASE_URL',
    'prisma-next migrate --to sha256:abc123 --db $DATABASE_URL',
    'prisma-next migrate --show --db $DATABASE_URL',
    'prisma-next migrate --show --from @contract --to production',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option(
      '--to <contract>',
      'Target contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path)',
    )
    .option('--advance-ref <name>', 'Advance the named ref to the post-apply marker after success')
    .option('--show', 'Preview the migration path without applying (read-only)')
    .option(
      '--from <contract>',
      'From-state for --show preview (@contract, @db, hash, ref name, or migration dir)',
    )
    .action(async (options: MigrateCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const startTime = Date.now();

      const ui = createTerminalUI(flags);

      if (options.show) {
        // Read-only path: compute the migration plan and print the ordered list.
        // NEVER reaches runMigration() or any write boundary.
        const result = await executeMigrateShowCommand(options, flags, ui);

        const exitCode = handleResult(result, flags, ui, (showResult) => {
          if (flags.json) {
            ui.output(JSON.stringify(showResult, null, 2));
          } else {
            // Print directly to stdout — not via ui.log() which injects Clack's │ gutter.
            ui.output(formatMigrateShowOutput(showResult, flags));
          }
        });

        process.exit(exitCode);
        return;
      }

      const result = await executeMigrateCommand(options, flags, ui, startTime);

      const exitCode = handleResult(result, flags, ui, (migrateResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(migrateResult, null, 2));
        } else if (!flags.quiet) {
          ui.log(formatMigrationApplyCommandOutput(migrateResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
