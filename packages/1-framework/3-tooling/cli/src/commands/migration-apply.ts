import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { findPathWithDecision } from '@prisma-next/migration-tools/dag';
import { readRefs, resolveRef } from '@prisma-next/migration-tools/refs';
import type { AttestedMigrationBundle, MigrationGraph } from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';

import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import type { MigrationApplyFailure, MigrationApplyStep } from '../control-api/types';
import {
  CliStructuredError,
  type CliStructuredError as CliStructuredErrorType,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  loadMigrationBundles,
  maskConnectionUrl,
  readContractEnvelope,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  targetSupportsMigrations,
  toPathDecisionResult,
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

function packageToStep(pkg: AttestedMigrationBundle): MigrationApplyStep {
  return {
    dirName: pkg.dirName,
    from: pkg.manifest.from,
    to: pkg.manifest.to,
    toContract: pkg.manifest.toContract,
    operations: pkg.ops,
  };
}

async function executeMigrationApplyCommand(
  options: MigrationApplyCommandOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<MigrationApplyResult, CliStructuredErrorType>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, migrationsRelative, refsPath } = resolveMigrationPaths(
    options.config,
    config,
  );

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

  let destinationHash: string;
  let refName: string | undefined;

  if (options.ref) {
    refName = options.ref;
    try {
      const refs = await readRefs(refsPath);
      destinationHash = resolveRef(refs, refName);
    } catch (error) {
      if (MigrationToolsError.is(error)) {
        return notOk(mapMigrationToolsError(error));
      }
      throw error;
    }
  } else {
    try {
      const envelope = await readContractEnvelope(config);
      destinationHash = envelope.storageHash;
    } catch (error) {
      return notOk(
        errorRuntime('Current contract is unavailable', {
          why: `Failed to read contract: ${error instanceof Error ? error.message : String(error)}`,
          fix: 'Run `prisma-next contract emit` to generate a valid contract.json, then retry apply.',
        }),
      );
    }
  }

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
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

  // Read migrations and build migration chain model (offline — no DB needed)
  let bundles: readonly AttestedMigrationBundle[];
  let graph: MigrationGraph;
  try {
    ({ bundles, graph } = await loadMigrationBundles(migrationsDir));
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
    const marker = await client.readMarker();

    // --- No attested migrations on disk ---
    if (bundles.length === 0) {
      if (marker?.storageHash) {
        return notOk(
          errorRuntime('Database has state but no migrations exist', {
            why: `The database marker hash "${marker.storageHash}" exists but no attested migrations were found in ${migrationsRelative}`,
            fix: 'Ensure the migrations directory is correct. If the database was managed with `db init` or `db update`, run `prisma-next db sign` to update the marker.',
            meta: { markerHash: marker.storageHash, migrationsDir: migrationsRelative },
          }),
        );
      }
      // Non-empty contract + no migrations = user needs to plan first.
      if (destinationHash !== EMPTY_CONTRACT_HASH) {
        return notOk(
          errorRuntime('Current contract has no planned migrations', {
            why: `No attested migrations were found in ${migrationsRelative}, but current contract hash is "${destinationHash}"`,
            fix: 'Run `prisma-next migration plan` to create an attested migration for the current contract.',
            meta: { destinationHash, migrationsDir: migrationsRelative },
          }),
        );
      }
      // Empty contract + no migrations = nothing to do.
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

    // --- Validate marker state ---

    // The empty sentinel should never appear in a real marker row — if it does,
    // the marker was corrupted and replaying all migrations would be dangerous.
    if (marker?.storageHash === EMPTY_CONTRACT_HASH) {
      return notOk(
        errorRuntime('Database marker contains the empty sentinel hash', {
          why: `The marker row exists but contains the empty sentinel value "${EMPTY_CONTRACT_HASH}". This should never happen — the marker should contain the hash of the last applied contract.`,
          fix: 'The marker is corrupted. Run `prisma-next db sign` to overwrite it with the correct contract hash, or drop and recreate the database.',
          meta: { markerHash: EMPTY_CONTRACT_HASH },
        }),
      );
    }

    const markerHash = marker?.storageHash;

    if (markerHash !== undefined && !graph.nodes.has(markerHash)) {
      return notOk(
        errorRuntime('Database marker does not match any known migration', {
          why: `The database marker hash "${markerHash}" is not found in the migration history at ${migrationsRelative}`,
          fix: 'Ensure the migrations directory matches this database. If the database was managed with `db init` or `db update`, run `prisma-next db sign` to update the marker.',
          meta: { markerHash, knownNodes: [...graph.nodes] },
        }),
      );
    }

    if (!graph.nodes.has(destinationHash)) {
      return notOk(
        errorRuntime('Current contract has no planned migration path', {
          why: `Current contract hash "${destinationHash}" is not present in the migration history at ${migrationsRelative}`,
          fix: 'Run `prisma-next migration plan` to create a migration for the current contract, then re-run apply.',
          meta: { destinationHash, knownNodes: [...graph.nodes] },
        }),
      );
    }

    // --- Resolve path and apply ---

    // "No marker" means the database is fresh — start from the empty contract hash.
    const originHash = markerHash ?? EMPTY_CONTRACT_HASH;

    const decision = findPathWithDecision(graph, originHash, destinationHash, refName);
    if (!decision) {
      return notOk(
        errorRuntime('No migration path from current state to target', {
          why: `Cannot find a path from "${originHash}" to target "${destinationHash}"`,
          fix: 'Check the migration history for gaps or inconsistencies.',
          meta: { markerHash: originHash, destinationHash },
        }),
      );
    }

    const pendingPath = decision.selectedPath;
    const pathDecision = toPathDecisionResult(decision);

    if (pendingPath.length === 0) {
      return ok({
        ok: true,
        migrationsApplied: 0,
        migrationsTotal: 0,
        markerHash: originHash,
        applied: [],
        summary: 'Already up to date',
        pathDecision,
        timings: { total: Date.now() - startTime },
      });
    }

    const bundleByDir = new Map(bundles.map((b) => [b.dirName, b]));
    const pendingMigrations: MigrationApplyStep[] = [];
    for (const migration of pendingPath) {
      const pkg = bundleByDir.get(migration.dirName);
      if (!pkg) {
        return notOk(
          errorRuntime(`Migration package not found: ${migration.dirName}`, {
            why: `The migration directory for path segment ${migration.from} → ${migration.to} was not found`,
            fix: 'Ensure all migration directories are present and intact.',
          }),
        );
      }
      pendingMigrations.push(packageToStep(pkg));
    }

    if (!flags.quiet && !flags.json) {
      for (const migration of pendingMigrations) {
        ui.step(`Pending ${migration.dirName}`);
      }
    }

    const applyResult = await client.migrationApply({
      originHash,
      destinationHash,
      pendingMigrations,
    });

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
      pathDecision,
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
    'Applies previously planned migrations (created by `migration plan`) to a live database.\n' +
      'Compares the database marker against the migration chain to determine which\n' +
      'migrations are pending, then executes them sequentially. Each migration runs\n' +
      'in its own transaction. Does not plan new migrations — run `migration plan` first.',
  );
  setCommandExamples(command, ['prisma-next migration apply --db $DATABASE_URL']);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--ref <name>', 'Target ref name from migrations/refs.json')
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
