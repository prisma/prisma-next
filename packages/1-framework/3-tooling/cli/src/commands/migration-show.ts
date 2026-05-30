import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import {
  APP_SPACE_ID,
  createControlStack,
  type MigrationPlanOperation,
  type OperationPreview,
} from '@prisma-next/framework-components/control';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { parseMigrationRef } from '@prisma-next/migration-tools/ref-resolution';
import { castAs } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { isAbsolute, relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  type CliStructuredError,
  errorContractValidationFailed,
  errorFileNotFound,
  errorRuntime,
  errorUnexpected,
  mapRefResolutionError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { formatMigrationShowOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface MigrationShowOptions extends CommonCommandOptions {
  readonly config?: string;
}

export interface MigrationShowPresent {
  readonly spaceId: string;
  readonly dirName: string;
  readonly dirPath: string;
  readonly from: string | null;
  readonly to: string;
  readonly migrationHash: string;
  readonly createdAt: string;
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  readonly preview: OperationPreview;
  readonly summary: string;
}

export interface MigrationShowResult {
  readonly ok: true;
  readonly migration: MigrationShowPresent;
}

function looksLikePath(target: string): boolean {
  return target.includes('/') || target.includes('\\');
}

export function resolveAppTargetPath(
  target: string,
  appMigrationsDir: string,
  appMigrationsRelative: string,
): Result<string, CliStructuredError> {
  const targetPath = resolve(target);
  const relativeToApp = relative(appMigrationsDir, targetPath);
  const isOutsideAppDir =
    relativeToApp === '' ||
    relativeToApp === '.' ||
    relativeToApp.startsWith('..') ||
    isAbsolute(relativeToApp);
  if (isOutsideAppDir) {
    return notOk(
      errorRuntime('Target must point to an app-space migration', {
        why: `Expected a path under ${appMigrationsRelative}, got ${target}`,
        fix: 'Pass an app-space migration directory or use a hash prefix.',
      }),
    );
  }
  return ok(targetPath);
}

function pkgToPresent(
  spaceId: string,
  pkg: OnDiskMigrationPackage,
  client: ReturnType<typeof createControlClient>,
): MigrationShowPresent {
  const ops = castAs<readonly MigrationPlanOperation[]>(pkg.ops);
  const preview: OperationPreview = client.toOperationPreview(ops) ?? { statements: [] };
  return {
    spaceId,
    dirName: pkg.dirName,
    dirPath: relative(process.cwd(), pkg.dirPath),
    from: pkg.metadata.from,
    to: pkg.metadata.to,
    migrationHash: pkg.metadata.migrationHash,
    createdAt: pkg.metadata.createdAt,
    operations: ops.map((op) => ({
      id: op.id,
      label: op.label,
      operationClass: op.operationClass,
    })),
    preview,
    summary: `${ops.length} operation(s)`,
  };
}

function findPackageByDirPath(
  packages: readonly OnDiskMigrationPackage[],
  resolvedDirPath: string,
): OnDiskMigrationPackage | undefined {
  const normalized = resolve(resolvedDirPath);
  return packages.find((p) => resolve(p.dirPath) === normalized);
}

async function executeMigrationShowCommand(
  target: string,
  options: MigrationShowOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationShowResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, appMigrationsDir, appMigrationsRelative } =
    resolveMigrationPaths(options.config, config);

  const contractPathAbsolute = resolveContractPath(config);
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration show',
      description: 'Display migration package contents',
      details: [
        { label: 'config', value: configPath },
        { label: 'contract', value: contractPath },
        { label: 'migrations', value: appMigrationsRelative },
        { label: 'target', value: target },
      ],
      flags,
    });
    ui.stderr(header);
  }

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    ...ifDefined('driver', config.driver),
    extensionPacks: config.extensionPacks ?? [],
  });

  let contractJsonContent: string;
  try {
    contractJsonContent = await readFile(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return notOk(
        errorFileNotFound(contractPathAbsolute, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: `Run \`prisma-next contract emit\` to generate ${contractPath}`,
        }),
      );
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: 'Failed to read contract file',
      }),
    );
  }

  const stack = createControlStack(config);
  const familyInstance = config.family.create(stack);

  let appContract: Contract;
  try {
    appContract = familyInstance.deserializeContract(
      castAs<unknown>(JSON.parse(contractJsonContent)),
    );
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract at ${contractPathAbsolute} failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  const aggregate = await loadContractSpaceAggregate({
    migrationsDir,
    appContract,
    deserializeContract: (json: unknown) => familyInstance.deserializeContract(json),
  });

  const packages = aggregate.app.packages;
  const graph = aggregate.app.graph();
  const refs = aggregate.app.refs;

  let appPkg: OnDiskMigrationPackage;
  if (looksLikePath(target)) {
    const resolved = resolveAppTargetPath(target, appMigrationsDir, appMigrationsRelative);
    if (!resolved.ok) return resolved;
    const matched = findPackageByDirPath(packages, resolved.value);
    if (!matched) {
      return notOk(
        errorRuntime('Migration package not found', {
          why: `No loaded migration package at ${relative(process.cwd(), resolved.value)}`,
          fix: 'Pass a directory name, hash prefix, or path to an on-disk app-space migration package.',
        }),
      );
    }
    appPkg = matched;
  } else {
    if (packages.length === 0) {
      return notOk(
        errorRuntime('No migrations found', {
          why: `No migration packages found in ${appMigrationsRelative}`,
          fix: 'Run `prisma-next migration plan` to create a migration first.',
        }),
      );
    }
    const migResult = parseMigrationRef(target, { graph, refs });
    if (!migResult.ok) {
      return notOk(mapRefResolutionError(migResult.failure));
    }
    const matchedPkg = packages.find(
      (p) => p.metadata.migrationHash === migResult.value.migrationHash,
    );
    if (!matchedPkg) {
      return notOk(
        errorRuntime('Migration package not found', {
          why: `Resolved migration "${migResult.value.dirName}" but the package was not loaded`,
          fix: 'The migrations directory may be corrupted. Inspect the migration.json files.',
        }),
      );
    }
    appPkg = matchedPkg;
  }

  return ok({
    ok: true,
    migration: pkgToPresent(APP_SPACE_ID, appPkg, client),
  });
}

export function createMigrationShowCommand(): Command {
  const command = new Command('show');
  setCommandDescriptions(
    command,
    'Display migration package contents',
    'Shows the operations, statement preview, and metadata for one app-space migration.\n' +
      'Accepts a directory path, directory name, or hash prefix.',
  );
  setCommandExamples(command, [
    'prisma-next migration show 20260101_100000_add_user',
    'prisma-next migration show sha256:a1b2c3',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration log', oneLiner: 'Show executed migration history' },
    { verb: 'migration list', oneLiner: 'List on-disk migrations' },
    { verb: 'migration graph', oneLiner: 'Show the migration graph topology' },
  ]);
  addGlobalOptions(command)
    .argument('<target>', 'Migration reference: directory name, hash/prefix, or path')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (target: string, options: MigrationShowOptions) => {
      const flags = parseGlobalFlagsOrExit(options);

      const ui = createTerminalUI(flags);

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
