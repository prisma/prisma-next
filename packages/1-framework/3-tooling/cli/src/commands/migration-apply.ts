import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { errorUnknownInvariant, MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { RefEntry } from '@prisma-next/migration-tools/refs';
import { readRefs, resolveRef } from '@prisma-next/migration-tools/refs';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';

import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import type { AggregatePerSpaceExecutionEntry, MigrationApplyFailure } from '../control-api/types';
import {
  CliStructuredError,
  type CliStructuredError as CliStructuredErrorType,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
  mapMigrationToolsError,
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
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationApplyCommandOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly ref?: string;
}

/**
 * Per-space breakdown of an apply run. The CLI command surfaces these
 * for both the JSON shape (`appliedSpaces[]`) and the human-readable
 * formatter (per-space block — same shape `db init` / `db update`
 * use, M6 sub-spec § Output shape contract).
 */
export interface MigrationApplyResult {
  readonly ok: boolean;
  /** Number of contract spaces that had non-zero pending operations applied. */
  readonly migrationsApplied: number;
  /** Total contract spaces visible in the aggregate (pending + already-up-to-date). */
  readonly migrationsTotal: number;
  /**
   * Marker hash for the **app member** post-apply. Surfaced for
   * back-compat with single-space callers; per-space markers live on
   * `perSpace[].marker.storageHash`.
   */
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
  /**
   * Per-space breakdown in canonical schedule order (extensions
   * alphabetically, then app). Always present for the aggregate-walking
   * apply path.
   */
  readonly perSpace: readonly AggregatePerSpaceExecutionEntry[];
  readonly timings: {
    readonly total: number;
  };
}

function mapApplyFailure(failure: MigrationApplyFailure): CliStructuredErrorType {
  return errorRuntime(failure.summary, {
    why: failure.why ?? 'Migration runner failed',
    fix: 'Fix the issue and re-run `prisma-next migration apply` — previously applied migrations are preserved.',
    meta: failure.meta ?? {},
  });
}

async function executeMigrationApplyCommand(
  options: MigrationApplyCommandOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<MigrationApplyResult, CliStructuredErrorType>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, appMigrationsDir, appMigrationsRelative, refsDir } =
    resolveMigrationPaths(options.config, config);

  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for migration apply (set db.connection in ${configPath}, or pass --db <url>)`,
        commandName: 'migration apply',
      }),
    );
  }

  if (!config.driver) {
    return notOk(
      errorDriverRequired({
        why: 'Config.driver is required for migration apply',
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
  const refName = options.ref;

  if (refName) {
    try {
      const refs = await readRefs(refsDir);
      refEntry = resolveRef(refs, refName);
    } catch (error) {
      if (MigrationToolsError.is(error)) {
        return notOk(mapMigrationToolsError(error));
      }
      throw error;
    }
  }

  // Resolve and parse the contract envelope. The aggregate-walking
  // operation needs the validated app contract to load the aggregate.
  const contractPathAbsolute = resolveContractPath(config);
  let contractRaw: Contract;
  try {
    const contractContent = await readFile(contractPathAbsolute, 'utf-8');
    contractRaw = JSON.parse(contractContent) as Contract;
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return notOk(
        errorFileNotFound(contractPathAbsolute, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: 'Run `prisma-next contract emit` to generate a valid contract.json, then retry apply.',
        }),
      );
    }
    return notOk(
      errorContractValidationFailed(
        `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
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
    if (refName) {
      details.push({ label: 'ref', value: refName });
    }
    const header = formatStyledHeader({
      command: 'migration apply',
      description: 'Apply planned migrations to the database',
      url: 'https://pris.ly/migration-apply',
      details,
      flags,
    });
    ui.stderr(header);
  }

  // Load app-space migration packages — the aggregate operation
  // needs them to hydrate the app member's graph for graph-walk.
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

    // Pre-check unknown invariants against `(declared by app graph) ∪
    // (already on the app marker)`. The marker side of the union
    // catches the case where the ref carries an invariant whose
    // declaring migration was retired (history rewritten) but whose
    // id is recorded on the marker — surfacing UNKNOWN_INVARIANT
    // there would be misleading because the database has already
    // satisfied the requirement.
    if (refEntry && refEntry.invariants.length > 0) {
      const allMarkers = await client.readAllMarkers();
      const appMarker = allMarkers.get('app') ?? null;
      const declared = collectDeclaredInvariants(appPackages.graph);
      const known = new Set<string>(declared);
      for (const id of appMarker?.invariants ?? []) known.add(id);
      const unknown = refEntry.invariants.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        return notOk(
          mapMigrationToolsError(
            errorUnknownInvariant({
              ...ifDefined('refName', refName),
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

    const applyResult = await client.migrationApply({
      contract: contractRaw,
      migrationsDir,
      appMigrationPackages: appPackages.bundles,
      ...ifDefined('refHash', refEntry?.hash),
    });

    if (!applyResult.ok) {
      return notOk(mapApplyFailure(applyResult.failure));
    }

    const { value } = applyResult;

    return ok({
      ok: true,
      migrationsApplied: value.migrationsApplied,
      migrationsTotal: value.perSpace.length,
      markerHash: value.markerHash,
      applied: value.applied,
      summary: value.summary,
      perSpace: value.perSpace,
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
    'Apply planned migrations to the database',
    'Walks every contract space (app + extensions) and applies pending\n' +
      'on-disk migrations in canonical order (extensions alphabetically,\n' +
      'then app). Graph-walks the on-disk migration graph for every space —\n' +
      "no introspection, no synth. Each space's marker advances inside its\n" +
      "transaction; per-space failure rolls back every space's writes.",
  );
  setCommandExamples(command, ['prisma-next migration apply --db $DATABASE_URL']);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--ref <name>', 'App-space target ref name from migrations/app/refs/')
    .action(async (options: MigrationApplyCommandOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      const ui = new TerminalUI({
        color: flags.color,
        interactive: flags.interactive,
      });

      const result = await executeMigrationApplyCommand(options, flags, ui, startTime);

      const exitCode = handleResult(result, flags, ui, (applyResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(applyResult, null, 2));
        } else if (!flags.quiet) {
          ui.log(formatMigrationApplyCommandOutput(applyResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
