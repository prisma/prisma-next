import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { createControlStack } from '@prisma-next/framework-components/control';
import {
  type ContractSpaceMember,
  graphWalkStrategy,
  requireHeadRef,
} from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { errorUnknownInvariant, MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { findLatestMigration, isGraphNode } from '@prisma-next/migration-tools/migration-graph';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import type { RefEntry } from '@prisma-next/migration-tools/refs';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
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
import { formatMigrationApplyCommandOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { executeRefAdvancement, readContractIR } from '../utils/ref-advancement';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

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
 * Computes the path through the SAME seam as `migrate`:
 * - `readAllMarkers()` for the from-state (when no `--from` is given)
 * - `graphWalkStrategy()` for the path selection
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

  let allRefs = {};
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
  let targetHash: string = contractHash;
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
  const fromHashBySpace = new Map<string, string>();
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
        // Offline hypothetical: use the same from-hash for all spaces
        for (const member of allMembers) {
          fromHashBySpace.set(member.spaceId, fromResult.value.hash);
        }
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
      for (const member of allMembers) {
        const marker = allMarkers.get(member.spaceId);
        fromHashBySpace.set(member.spaceId, marker?.storageHash ?? EMPTY_CONTRACT_HASH);
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

  // Walk the path via graphWalkStrategy — the SAME seam migrate uses.
  const orderedMigrations: MigrateShowMigration[] = [];
  for (const member of allMembers) {
    const fromHash = fromHashBySpace.get(member.spaceId) ?? EMPTY_CONTRACT_HASH;
    const headRef = requireHeadRef(member);
    const memberTargetHash = member.spaceId === aggregate.app.spaceId ? targetHash : headRef.hash;

    if (member.graph().nodes.size === 0) {
      // No migrations on disk for this space — nothing to walk.
      continue;
    }

    const memberWithTarget: ContractSpaceMember =
      memberTargetHash === headRef.hash
        ? member
        : { ...member, headRef: { hash: memberTargetHash, invariants: headRef.invariants } };

    const currentMarker =
      fromHash === EMPTY_CONTRACT_HASH ? null : { storageHash: fromHash, invariants: [] };

    // graphWalkStrategy is the exact same function migrate uses to plan its path.
    const walked = graphWalkStrategy({
      aggregateTargetId: aggregate.targetId,
      member: memberWithTarget,
      currentMarker,
    });

    if (walked.kind === 'unreachable') {
      return notOk(
        errorPathUnreachable({
          code: 'MIGRATION_PATH_NOT_FOUND',
          summary: `No migration path from ${fromHash.slice(0, 14)} to ${memberTargetHash.slice(0, 14)} in space "${member.spaceId}".`,
          why: `The migration graph has no path from the from-state to the target in space "${member.spaceId}".`,
          meta: { spaceId: member.spaceId, from: fromHash, to: memberTargetHash },
        }),
      );
    }
    if (walked.kind === 'unsatisfiable') {
      return notOk(
        errorRuntime(`Missing required invariants for space "${member.spaceId}"`, {
          why: `The path requires invariants not available on disk: ${walked.missing.join(', ')}`,
        }),
      );
    }

    for (const edge of walked.result.migrationEdges) {
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

  return ok({ ok: true, migrations: orderedMigrations, summary });
}

function formatMigrateShowOutput(result: MigrateShowResult, flags: GlobalFlags): string {
  if (flags.quiet) return '';
  const lines: string[] = [];
  lines.push(result.summary);
  if (result.migrations.length > 0) {
    lines.push('');
    lines.push('Will run, in order:');
    result.migrations.forEach((m, i) => {
      lines.push(`  ${i + 1}. ${m.dirName}  (${m.from.slice(7, 14)} → ${m.to.slice(7, 14)})`);
    });
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
            ui.log(formatMigrateShowOutput(showResult, flags));
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
