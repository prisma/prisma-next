import { attestMigration, verifyMigration } from '@prisma-next/migration-tools/attestation';
import {
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationOps,
} from '@prisma-next/migration-tools/io';
import { evaluateMigrationTs, hasMigrationTs } from '@prisma-next/migration-tools/migration-ts';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import {
  addGlobalOptions,
  getTargetMigrations,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatMigrationVerifyCommandOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationVerifyOptions extends CommonCommandOptions {
  readonly dir?: string;
  readonly config?: string;
}

interface PackageVerifyResult {
  readonly dir: string;
  readonly status: 'verified' | 'attested' | 'mismatch' | 'error';
  readonly migrationId?: string;
  readonly storedMigrationId?: string;
  readonly computedMigrationId?: string;
  readonly summary: string;
}

export interface MigrationVerifyResult {
  readonly ok: boolean;
  readonly results: readonly PackageVerifyResult[];
  readonly summary: string;
  // Keep single-package fields for backward compat with existing formatter
  readonly status?: 'verified' | 'attested';
  readonly dir?: string;
  readonly migrationId?: string;
  readonly storedMigrationId?: string;
  readonly computedMigrationId?: string;
}

async function verifyPackage(
  dir: string,
  options: MigrationVerifyOptions,
): Promise<PackageVerifyResult> {
  const result = await verifyMigration(dir);

  if (result.ok) {
    return {
      dir,
      status: 'verified',
      ...ifDefined('migrationId', result.storedMigrationId),
      ...ifDefined('storedMigrationId', result.storedMigrationId),
      ...ifDefined('computedMigrationId', result.computedMigrationId),
      summary: 'migrationId matches',
    };
  }

  if (result.reason === 'draft') {
    if (await hasMigrationTs(dir)) {
      const pkg = await readMigrationPackage(dir);
      const descriptors = await evaluateMigrationTs(dir);

      const config = await loadConfig(options.config);
      const migrations = getTargetMigrations(config.target);
      if (!migrations?.resolveDescriptors) {
        return {
          dir,
          status: 'error',
          summary: 'Target does not support resolveDescriptors — cannot verify migration.ts',
        };
      }

      const resolvedOps = migrations.resolveDescriptors(descriptors, {
        fromContract: pkg.manifest.fromContract,
        toContract: pkg.manifest.toContract,
      });

      await writeMigrationOps(dir, resolvedOps);
    }

    const migrationId = await attestMigration(dir);
    return {
      dir,
      status: 'attested',
      migrationId,
      summary: `Attested with migrationId: ${migrationId}`,
    };
  }

  return {
    dir,
    status: 'mismatch',
    ...ifDefined('storedMigrationId', result.storedMigrationId),
    ...ifDefined('computedMigrationId', result.computedMigrationId),
    summary: `migrationId mismatch — stored=${result.storedMigrationId}, computed=${result.computedMigrationId}`,
  };
}

async function executeMigrationVerifyCommand(
  options: MigrationVerifyOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationVerifyResult, CliStructuredError>> {
  try {
    let packageDirs: string[];

    if (options.dir) {
      packageDirs = [options.dir];
    } else {
      const config = await loadConfig(options.config);
      const { migrationsDir } = resolveMigrationPaths(options.config, config);
      const allBundles = await readMigrationsDir(migrationsDir);
      packageDirs = allBundles.map((b) => b.dirPath);

      if (packageDirs.length === 0) {
        return ok({
          ok: true,
          results: [],
          summary: 'No migration packages found',
        });
      }
    }

    if (!flags.json && !flags.quiet) {
      const header = formatStyledHeader({
        command: 'migration verify',
        description: 'Verify migration package integrity',
        details: options.dir ? [{ label: 'dir', value: options.dir }] : [],
        flags,
      });
      ui.stderr(header);
    }

    const results: PackageVerifyResult[] = [];
    for (const dir of packageDirs) {
      try {
        const result = await verifyPackage(dir, options);
        results.push(result);
      } catch (error) {
        results.push({
          dir,
          status: 'error',
          summary: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const hasFailures = results.some((r) => r.status === 'mismatch' || r.status === 'error');

    // For single-package backward compat
    const singleResult = results.length === 1 ? results[0] : undefined;

    if (hasFailures) {
      const mismatches = results.filter((r) => r.status === 'mismatch');
      const errors = results.filter((r) => r.status === 'error');
      return notOk(
        errorRuntime(
          `Verification failed: ${mismatches.length} mismatch(es), ${errors.length} error(s)`,
          {
            why: results
              .filter((r) => r.status === 'mismatch' || r.status === 'error')
              .map((r) => `${r.dir}: ${r.summary}`)
              .join('; '),
            fix: 'For mismatches: set "migrationId" to null in migration.json and rerun `migration verify`. For errors: check the error message.',
            meta: { results },
          },
        ),
      );
    }

    const singleStatus =
      singleResult?.status === 'verified' || singleResult?.status === 'attested'
        ? singleResult.status
        : undefined;

    return ok({
      ok: true,
      results,
      summary:
        results.length === 1
          ? results[0]!.summary
          : `Verified ${results.length} migration package(s)`,
      ...ifDefined('status', singleStatus),
      ...ifDefined('dir', singleResult?.dir),
      ...ifDefined('migrationId', singleResult?.migrationId),
      ...ifDefined('storedMigrationId', singleResult?.storedMigrationId),
      ...ifDefined('computedMigrationId', singleResult?.computedMigrationId),
    });
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(
        errorRuntime(error.message, {
          why: error.why,
          fix: error.fix,
          meta: { code: error.code, ...(error.details ?? {}) },
        }),
      );
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to verify migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

export function createMigrationVerifyCommand(): Command {
  const command = new Command('verify');
  setCommandDescriptions(
    command,
    'Verify migration packages',
    'Scans all migration packages and verifies their content-addressed migrationId.\n' +
      'Draft migrations (migrationId: null) are evaluated and automatically attested.\n' +
      'Use --dir to verify a single package.',
  );
  setCommandExamples(command, [
    'prisma-next migration verify',
    'prisma-next migration verify --dir migrations/20250101-add-users',
  ]);
  addGlobalOptions(command)
    .option('--dir <path>', 'Path to a specific migration package directory')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: MigrationVerifyOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeMigrationVerifyCommand(options, flags, ui);

      const exitCode = handleResult(result, flags, ui, (verifyResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(verifyResult, null, 2));
        } else if (!flags.quiet) {
          if (verifyResult.results.length === 1 && verifyResult.status) {
            ui.log(
              formatMigrationVerifyCommandOutput(
                {
                  status: verifyResult.status,
                  ...ifDefined('migrationId', verifyResult.migrationId),
                },
                flags,
              ),
            );
          } else {
            for (const r of verifyResult.results) {
              ui.output(`${r.dir}: ${r.status} — ${r.summary}`);
            }
          }
        }
      });

      process.exit(exitCode);
    });

  return command;
}
