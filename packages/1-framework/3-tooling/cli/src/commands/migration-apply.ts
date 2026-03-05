import { readFile } from 'node:fs/promises';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import type { MigrationGraph, MigrationPackage } from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { relative, resolve } from 'pathe';
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
  maskConnectionUrl,
  resolveContractPath,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatMigrationApplyCommandOutput, formatStyledHeader } from '../utils/output';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationApplyCommandOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
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

function packageToStep(pkg: MigrationPackage): MigrationApplyStep {
  return {
    dirName: pkg.dirName,
    from: pkg.manifest.from,
    to: pkg.manifest.to,
    toContract: pkg.manifest.toContract,
    operations: pkg.ops as MigrationApplyStep['operations'],
  };
}

async function executeMigrationApplyCommand(
  options: MigrationApplyCommandOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<MigrationApplyResult, CliStructuredErrorType>> {
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
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for migration apply (set db.connection in ${configPath}, or pass --db <url>)`,
      }),
    );
  }

  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for migration apply' }));
  }

  const targetWithMigrations = config.target as typeof config.target & {
    readonly migrations?: unknown;
  };
  if (!targetWithMigrations.migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  let destinationHash: string;
  try {
    const contractPathAbsolute = resolveContractPath(config);
    const contractRaw = JSON.parse(await readFile(contractPathAbsolute, 'utf-8')) as Record<
      string,
      unknown
    >;
    const contractHash = contractRaw['storageHash'];
    if (typeof contractHash !== 'string') {
      return notOk(
        errorRuntime('Current contract is missing storage hash', {
          why: `The contract at ${relative(process.cwd(), contractPathAbsolute)} does not contain a valid storageHash`,
          fix: 'Run `prisma-next contract emit` and re-run `prisma-next migration apply`.',
        }),
      );
    }
    destinationHash = contractHash;
  } catch (error) {
    return notOk(
      errorRuntime('Current contract is unavailable', {
        why: `Failed to read contract hash before apply: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Run `prisma-next contract emit` to generate a valid contract.json, then retry apply.',
      }),
    );
  }

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
    ];
    if (typeof dbConnection === 'string') {
      details.push({ label: 'database', value: maskConnectionUrl(dbConnection) });
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
  let packages: readonly MigrationPackage[];
  try {
    const allPackages = await readMigrationsDir(migrationsDir);
    packages = allPackages.filter((p) => typeof p.manifest.migrationId === 'string');
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

  if (packages.length === 0) {
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
      const markerHash = marker?.storageHash ?? EMPTY_CONTRACT_HASH;
      if (markerHash !== EMPTY_CONTRACT_HASH) {
        return notOk(
          errorRuntime('Database has state but no migrations exist', {
            why: `The database marker hash "${markerHash}" exists but no attested migrations were found in ${migrationsRelative}`,
            fix: 'Ensure the migrations directory is correct, or reset the database with `prisma-next db init`.',
            meta: { markerHash, migrationsDir: migrationsRelative },
          }),
        );
      }
      if (destinationHash !== EMPTY_CONTRACT_HASH) {
        return notOk(
          errorRuntime('Current contract has no planned migrations', {
            why: `No attested migrations were found in ${migrationsRelative}, but current contract hash is "${destinationHash}"`,
            fix: 'Run `prisma-next migration plan` to create an attested migration for the current contract.',
            meta: { destinationHash, migrationsDir: migrationsRelative },
          }),
        );
      }
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

  let graph: MigrationGraph;
  try {
    graph = reconstructGraph(packages);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

  // Create control client for all DB operations
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

    // Distinguish "no marker row" (null) from "marker row exists with the
    // empty sentinel". The sentinel should never appear in a real marker row —
    // if it does, the marker was corrupted and replaying all migrations would
    // be dangerous (the DB likely already has tables).
    if (marker?.storageHash === EMPTY_CONTRACT_HASH) {
      return notOk(
        errorRuntime('Database marker contains the empty sentinel hash', {
          why: `The marker row exists but contains the empty sentinel value "${EMPTY_CONTRACT_HASH}". This should never happen — the marker should contain the hash of the last applied contract.`,
          fix: 'The marker is corrupted. Reset the database with `prisma-next db init`, or manually update the marker to the correct contract hash.',
          meta: { markerHash: EMPTY_CONTRACT_HASH },
        }),
      );
    }

    const markerHash = marker?.storageHash ?? EMPTY_CONTRACT_HASH;

    if (markerHash !== EMPTY_CONTRACT_HASH && !graph.nodes.has(markerHash)) {
      return notOk(
        errorRuntime('Database marker does not match any known migration', {
          why: `The database marker hash "${markerHash}" is not found in the migration history at ${migrationsRelative}`,
          fix: 'Ensure the migrations directory matches this database, or reset the database with `prisma-next db init`.',
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

    const pendingPath = findPath(graph, markerHash, destinationHash);
    if (!pendingPath) {
      return notOk(
        errorRuntime('No migration path from current state to target', {
          why: `Cannot find a path from marker hash "${markerHash}" to target "${destinationHash}"`,
          fix: 'Check the migration history for gaps or inconsistencies.',
          meta: { markerHash, destinationHash },
        }),
      );
    }

    if (pendingPath.length === 0) {
      return ok({
        ok: true,
        migrationsApplied: 0,
        migrationsTotal: 0,
        markerHash,
        applied: [],
        summary: 'Already up to date',
        timings: { total: Date.now() - startTime },
      });
    }

    // Resolve graph edges to full apply-ready edges
    const packageByDir = new Map(packages.map((pkg) => [pkg.dirName, pkg]));
    const pendingMigrations: MigrationApplyStep[] = [];
    for (const migration of pendingPath) {
      const pkg = packageByDir.get(migration.dirName);
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
        ui.step(`Applying ${migration.dirName}...`);
      }
    }

    const applyResult = await client.migrationApply({
      originHash: markerHash,
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
  setCommandExamples(command, [
    'prisma-next migration apply --db $DATABASE_URL',
    'prisma-next migration apply --db $DATABASE_URL --yes',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: MigrationApplyCommandOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeMigrationApplyCommand(options, flags, ui, startTime);

      const exitCode = handleResult(result, flags, (applyResult) => {
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
