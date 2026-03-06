import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { findLatestMigration, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { readMigrationPackage, readMigrationsDir } from '@prisma-next/migration-tools/io';
import type { MigrationPackage } from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { extractSqlDdl } from '../control-api/operations/extract-sql-ddl';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatCommandHelp, formatMigrationShowOutput, formatStyledHeader } from '../utils/output';
import { handleResult } from '../utils/result-handler';

interface MigrationShowOptions {
  readonly config?: string;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly vv?: boolean;
  readonly trace?: boolean;
  readonly timestamps?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
}

export interface MigrationShowResult {
  readonly ok: true;
  readonly dirName: string;
  readonly dirPath: string;
  readonly from: string;
  readonly to: string;
  readonly migrationId: string | null;
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
  const attested = packages.filter((p) => typeof p.manifest.migrationId === 'string');
  const matches = attested.filter((p) => p.manifest.migrationId!.startsWith(normalizedPrefix));

  if (matches.length === 1) {
    return ok(matches[0]!);
  }

  if (matches.length === 0) {
    return notOk(
      errorRuntime('No migration found matching prefix', {
        why: `No attested migration has a migrationId starting with "${normalizedPrefix}"`,
        fix: 'Run `prisma-next migration show` (no argument) to see the latest migration, or check the migrations directory for available packages.',
      }),
    );
  }

  const candidates = matches.map((p) => `  ${p.dirName}  ${p.manifest.migrationId}`).join('\n');
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

  if (flags.json !== 'object' && !flags.quiet) {
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
    console.log(header);
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
        const attested = allPackages.filter((p) => typeof p.manifest.migrationId === 'string');
        if (attested.length === 0) {
          return notOk(
            errorRuntime('No attested migrations found', {
              why: `All migrations in ${migrationsRelative} are drafts (migrationId: null)`,
              fix: 'Run `prisma-next migration verify --dir <path>` to attest a draft migration.',
            }),
          );
        }
        const graph = reconstructGraph(attested);
        const latestMigration = findLatestMigration(graph);
        if (!latestMigration) {
          return notOk(
            errorRuntime('Could not resolve latest migration', {
              why: 'No latest migration found in the migration chain',
              fix: 'The migrations directory may be corrupted. Inspect the migration.json files.',
            }),
          );
        }
        const leafPkg = attested.find(
          (p) => p.manifest.migrationId === latestMigration.migrationId,
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
        why: `Failed to read migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  const ops = pkg.ops as readonly MigrationPlanOperation[];
  const sql = extractSqlDdl(ops);

  const result: MigrationShowResult = {
    ok: true,
    dirName: pkg.dirName,
    dirPath: relative(process.cwd(), pkg.dirPath),
    from: pkg.manifest.from,
    to: pkg.manifest.to,
    migrationId: pkg.manifest.migrationId,
    kind: pkg.manifest.kind,
    createdAt: pkg.manifest.createdAt,
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
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const defaultFlags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags: defaultFlags });
      },
    })
    .argument(
      '[target]',
      'Migration directory path or migrationId hash prefix (defaults to latest)',
    )
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output')
    .option('-vv, --trace', 'Trace output')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (target: string | undefined, options: MigrationShowOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await executeMigrationShowCommand(target, options, flags);

      const exitCode = handleResult(result, flags, (showResult) => {
        if (flags.json === 'object') {
          console.log(JSON.stringify(showResult, null, 2));
        } else if (!flags.quiet) {
          console.log(formatMigrationShowOutput(showResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
