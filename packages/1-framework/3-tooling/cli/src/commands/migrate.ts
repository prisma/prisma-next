import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { createControlStack } from '@prisma-next/framework-components/control';
import { errorUnknownInvariant, MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { findLatestMigration, isGraphNode } from '@prisma-next/migration-tools/migration-graph';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import type { RefEntry } from '@prisma-next/migration-tools/refs';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { join } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import type {
  AggregatePerSpaceExecutionEntry,
  MigrationApplyFailure,
  MigrationApplyPathDecision,
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
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  collectDeclaredInvariants,
  loadMigrationPackages,
  maskConnectionUrl,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  targetSupportsMigrations,
} from '../utils/command-helpers';
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
  readonly perSpace: readonly AggregatePerSpaceExecutionEntry[];
  readonly pathDecision?: MigrationApplyPathDecision;
  readonly timings: {
    readonly total: number;
  };
  readonly advancedRef?: { readonly name: string; readonly hash: string } | null;
}

function mapApplyFailure(failure: MigrationApplyFailure): CliStructuredErrorType {
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
  const { configPath, migrationsDir, appMigrationsDir, appMigrationsRelative, refsDir } =
    resolveMigrationPaths(options.config, config);

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

  let refEntry: RefEntry | undefined;
  const toArg = options.to;

  if (toArg) {
    try {
      const refs = await readRefs(refsDir);
      const { graph } = await loadMigrationPackages(appMigrationsDir);
      const refResult = parseContractRef(toArg, { graph, refs });
      if (!refResult.ok) {
        return notOk(mapRefResolutionError(refResult.failure));
      }
      if (refResult.value.provenance.kind === 'ref') {
        const resolved = refs[refResult.value.provenance.refName];
        if (resolved) refEntry = resolved;
      } else {
        refEntry = { hash: refResult.value.hash, invariants: [] };
      }
    } catch (error) {
      if (MigrationToolsError.is(error)) {
        return notOk(mapMigrationToolsError(error));
      }
      throw error;
    }
  }

  // Construct the family instance up-front so the on-disk contract read
  // crosses the serializer seam (`familyInstance.deserializeContract`) at
  // the read site. The downstream `client.migrationApply({ contract })`
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

  let appPackages: Awaited<ReturnType<typeof loadMigrationPackages>>;
  try {
    appPackages = await loadMigrationPackages(appMigrationsDir);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

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
    const { graph } = appPackages;

    if (appMarker !== null && !isGraphNode(appMarker.storageHash, graph)) {
      return notOk(
        errorMarkerMismatch(
          appMarker.storageHash,
          [...graph.nodes].sort(),
          findLatestMigration(graph)?.to ?? null,
        ),
      );
    }

    if (refEntry && refEntry.invariants.length > 0) {
      const declared = collectDeclaredInvariants(appPackages.graph);
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

    // When `--to` resolves to an on-disk graph node, verify and apply against
    // THAT bundle's destination contract — not the emitted `contract.json` — so
    // a rollback or arbitrary-target migrate checks the path's true destination
    // rather than the (newer) emitted contract. With `--to` omitted, or a
    // target with no matching bundle, the emitted contract stays the apply
    // contract (byte-identical to prior behaviour). The same read feeds the
    // optional ref-advancement snapshot below, so the apply contract and the
    // snapshot contract are always sourced identically. This runs after the
    // marker / invariant pre-checks so those diagnostics fire first.
    let applyContract: Contract = contractRaw;
    let snapshotContractJson: Record<string, unknown> = JSON.parse(contractContent);
    let snapshotContractPath = contractPathAbsolute;
    if (toArg && refEntry) {
      const targetHash = refEntry.hash;
      const matchingBundle = appPackages.bundles.find((p) => p.metadata.to === targetHash);
      if (matchingBundle) {
        const endContractPath = join(matchingBundle.dirPath, 'end-contract.json');
        let endContractRaw: string;
        try {
          endContractRaw = await readFile(endContractPath, 'utf-8');
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return notOk(
              errorFileNotFound(endContractPath, {
                why: `Target migration bundle is missing its destination contract snapshot at ${endContractPath}`,
                fix: 'Re-emit the target migration so its sibling `end-contract.json` is restored, or pick a different --to target.',
              }),
            );
          }
          throw error;
        }
        const parsed: Record<string, unknown> = JSON.parse(endContractRaw);
        try {
          applyContract = familyInstance.deserializeContract(parsed);
        } catch (error) {
          return notOk(
            errorContractValidationFailed(
              `Target contract at ${endContractPath} failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
              { where: { path: endContractPath } },
            ),
          );
        }
        snapshotContractJson = parsed;
        snapshotContractPath = endContractPath;
      }
    }

    const applyResult = await client.migrationApply({
      contract: applyContract,
      migrationsDir,
      appMigrationPackages: appPackages.bundles,
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
        const contractIR = await readContractIR(snapshotContractJson, snapshotContractPath);
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
      'Use --to to target a specific contract (hash, ref name, migration dir).',
  );
  setCommandExamples(command, [
    'prisma-next migrate --db $DATABASE_URL',
    'prisma-next migrate --to production --db $DATABASE_URL',
    'prisma-next migrate --to sha256:abc123 --db $DATABASE_URL',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option(
      '--to <contract>',
      'Target contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path)',
    )
    .option('--advance-ref <name>', 'Advance the named ref to the post-apply marker after success')
    .action(async (options: MigrateCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const startTime = Date.now();

      const ui = createTerminalUI(flags);

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
