import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { findLatestMigration, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { readMigrationPackage, readMigrationsDir } from '@prisma-next/migration-tools/io';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { extractOperationStatements } from '../control-api/operations/extract-operation-statements';
import {
  type CliStructuredError,
  errorRuntime,
  errorUnexpected,
  mapMigrationToolsError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatMigrationShowOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationShowOptions extends CommonCommandOptions {
  readonly config?: string;
}

export interface MigrationShowResult {
  readonly ok: true;
  readonly dirName: string;
  readonly dirPath: string;
  readonly from: string;
  readonly to: string;
  readonly migrationHash: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  readonly sql: readonly string[];
  readonly summary: string;
}

function looksLikePath(target: string): boolean {
  return target.includes('/') || target.includes('\\');
}

export function resolveByHashPrefix(
  packages: readonly MigrationPackage[],
  prefix: string,
): Result<MigrationPackage, CliStructuredError> {
  const normalizedPrefix = prefix.startsWith('sha256:') ? prefix : `sha256:${prefix}`;
  const matches = packages.filter((p) => p.metadata.migrationHash.startsWith(normalizedPrefix));

  if (matches.length === 1) {
    return ok(matches[0]!);
  }

  if (matches.length === 0) {
    return notOk(
      errorRuntime('No migration found matching prefix', {
        why: `No migration has a migrationHash starting with "${normalizedPrefix}"`,
        fix: 'Run `prisma-next migration show` (no argument) to see the latest migration, or check the migrations directory for available packages.',
      }),
    );
  }

  const candidates = matches.map((p) => `  ${p.dirName}  ${p.metadata.migrationHash}`).join('\n');
  return notOk(
    errorRuntime('Ambiguous hash prefix', {
      why: `Multiple migrations match prefix "${normalizedPrefix}":\n${candidates}`,
      fix: 'Provide a longer prefix to uniquely identify the migration.',
    }),
  );
}

async function executeMigrationShowCommand(
  target: string | undefined,
  options: MigrationShowOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationShowResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  const migrationsDir = resolve(
    options.config ? resolve(options.config, '..') : process.cwd(),
    config.migrations?.dir ?? 'migrations',
  );
  const migrationsRelative = relative(process.cwd(), migrationsDir);

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: migrationsRelative },
    ];
    if (target) {
      details.push({ label: 'target', value: target });
    }
    const header = formatStyledHeader({
      command: 'migration show',
      description: 'Display migration package contents',
      details,
      flags,
    });
    ui.stderr(header);
  }

  let pkg: MigrationPackage;

  try {
    if (target && looksLikePath(target)) {
      pkg = await readMigrationPackage(resolve(target));
    } else {
      const allPackages = await readMigrationsDir(migrationsDir);
      if (allPackages.length === 0) {
        return notOk(
          errorRuntime('No migrations found', {
            why: `No migration packages found in ${migrationsRelative}`,
            fix: 'Run `prisma-next migration plan` to create a migration first.',
          }),
        );
      }

      if (target) {
        const resolved = resolveByHashPrefix(allPackages, target);
        if (!resolved.ok) return resolved;
        pkg = resolved.value;
      } else {
        const graph = reconstructGraph(allPackages);
        const latestMigration = findLatestMigration(graph);
        if (!latestMigration) {
          return notOk(
            errorRuntime('Could not resolve latest migration', {
              why: 'No latest migration found in the migration history',
              fix: 'The migrations directory may be corrupted. Inspect the migration.json files.',
            }),
          );
        }
        const leafPkg = allPackages.find(
          (p) => p.metadata.migrationHash === latestMigration.migrationHash,
        );
        if (!leafPkg) {
          return notOk(
            errorRuntime('Could not resolve latest migration', {
              why: `Latest migration ${latestMigration.dirName} does not match any package`,
              fix: 'The migrations directory may be corrupted. Inspect the migration.json files.',
            }),
          );
        }
        pkg = leafPkg;
      }
    }
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  const ops = pkg.ops as readonly MigrationPlanOperation[];
  const sql = extractOperationStatements(config.family.familyId, ops) ?? [];

  const result: MigrationShowResult = {
    ok: true,
    dirName: pkg.dirName,
    dirPath: relative(process.cwd(), pkg.dirPath),
    from: pkg.metadata.from,
    to: pkg.metadata.to,
    migrationHash: pkg.metadata.migrationHash,
    kind: pkg.metadata.kind,
    createdAt: pkg.metadata.createdAt,
    operations: ops.map((op) => ({
      id: op.id,
      label: op.label,
      operationClass: op.operationClass,
    })),
    sql,
    summary: `${ops.length} operation(s)`,
  };
  return ok(result);
}

export function createMigrationShowCommand(): Command {
  const command = new Command('show');
  setCommandDescriptions(
    command,
    'Display migration package contents',
    'Shows the operations, DDL preview, and metadata for a migration package.\n' +
      'Accepts a directory path, a hash prefix (git-style), or defaults to the\n' +
      'latest migration.',
  );
  setCommandExamples(command, [
    'prisma-next migration show',
    'prisma-next migration show sha256:a1b2c3',
  ]);
  addGlobalOptions(command)
    .argument('[target]', 'Migration directory path or migrationHash prefix (defaults to latest)')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (target: string | undefined, options: MigrationShowOptions) => {
      const flags = parseGlobalFlags(options);

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeMigrationShowCommand(target, options, flags, ui);

      const exitCode = handleResult(result, flags, ui, (showResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(showResult, null, 2));
        } else if (!flags.quiet) {
          ui.log(formatMigrationShowOutput(showResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
