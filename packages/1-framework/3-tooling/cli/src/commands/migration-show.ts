import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import {
  createControlStack,
  type MigrationPlanOperation,
  type OperationPreview,
} from '@prisma-next/framework-components/control';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { readMigrationPackage, readMigrationsDir } from '@prisma-next/migration-tools/io';
import {
  findLatestMigration,
  reconstructGraph,
} from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { spaceMigrationDirectory } from '@prisma-next/migration-tools/spaces';
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
  mapMigrationToolsError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { buildContractSpaceAggregate } from '../utils/contract-space-aggregate-loader';
import { formatMigrationShowOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationShowOptions extends CommonCommandOptions {
  readonly config?: string;
}

/**
 * Details of one space's latest (or targeted) migration package.
 */
export interface MigrationShowSpacePresent {
  readonly kind: 'present';
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
  /**
   * Family-agnostic textual preview of the migration's operations. Always
   * defined; statements is empty for a no-op migration or a family that does
   * not implement the `OperationPreviewCapable` capability.
   */
  readonly preview: OperationPreview;
  readonly summary: string;
}

/**
 * Placeholder for a loaded contract space that has no on-disk migration
 * package — the extension descriptor declared the space but no migrations
 * directory has been materialised for it yet. Surfaces the space in the
 * response so JSON consumers see every loaded extension instead of having
 * silently-skipped entries.
 */
export interface MigrationShowSpaceMissing {
  readonly kind: 'missing';
  readonly spaceId: string;
  readonly summary: string;
}

export type MigrationShowSpaceResult = MigrationShowSpacePresent | MigrationShowSpaceMissing;

export interface MigrationShowResult {
  readonly ok: true;
  /**
   * Per-space results, ordered: app first, then extensions alphabetically
   * (matching the aggregate's canonical ordering).
   */
  readonly spaces: readonly MigrationShowSpaceResult[];
}

function looksLikePath(target: string): boolean {
  return target.includes('/') || target.includes('\\');
}

/**
 * Validate that a path-like `migration show` target resolves inside the app
 * migrations directory. The returned result is always emitted under
 * `aggregate.app.spaceId`, so accepting an extension-space (or otherwise
 * external) path here would silently mislabel the result. Returns the
 * resolved absolute path on success.
 *
 * `pathe.relative` can return an absolute path when the target cannot be
 * expressed relative to the base (e.g. on Windows when `target` is on a
 * different drive than `appMigrationsDir`). That case does not start with
 * `..`, so the absolute-check below is required to reject cross-drive
 * targets rather than mislabeling them as app-space.
 */
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

export function resolveByHashPrefix(
  packages: readonly OnDiskMigrationPackage[],
  prefix: string,
): Result<OnDiskMigrationPackage, CliStructuredError> {
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

/**
 * Resolve the latest migration from a space directory.
 *
 * Returns `ok(null)` only when the directory is empty or absent (ENOENT is
 * absorbed by `readMigrationsDir`). If `readMigrationsDir` returned packages
 * but `findLatestMigration` cannot pick a leaf, the on-disk history is
 * corrupt — return a runtime error rather than collapsing it to a `missing`
 * placeholder, which would hide the corruption from the caller.
 */
export async function resolveLatestFromDir(
  spaceDir: string,
): Promise<Result<OnDiskMigrationPackage | null, CliStructuredError>> {
  try {
    const allPackages = await readMigrationsDir(spaceDir);
    if (allPackages.length === 0) return ok(null);
    const graph = reconstructGraph(allPackages);
    const latestMigration = findLatestMigration(graph);
    if (!latestMigration) {
      return notOk(
        errorRuntime('Could not resolve latest migration', {
          why: `No latest migration found in ${relative(process.cwd(), spaceDir)}`,
          fix: 'The migrations directory may be corrupted. Inspect the migration.json files.',
        }),
      );
    }
    const leafPkg = allPackages.find(
      (p) => p.metadata.migrationHash === latestMigration.migrationHash,
    );
    return ok(leafPkg ?? null);
  } catch (error) {
    if (MigrationToolsError.is(error)) return notOk(mapMigrationToolsError(error));
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read migrations: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

function pkgToSpaceResult(
  spaceId: string,
  pkg: OnDiskMigrationPackage,
  client: ReturnType<typeof createControlClient>,
): MigrationShowSpacePresent {
  const ops = pkg.ops as readonly MigrationPlanOperation[];
  const preview: OperationPreview = client.toOperationPreview(ops) ?? { statements: [] };
  return {
    kind: 'present',
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

async function executeMigrationShowCommand(
  target: string | undefined,
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
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'contract', value: contractPath },
      { label: 'migrations', value: appMigrationsRelative },
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

  // Load the app contract so the aggregate loader can validate it.
  let contractJsonContent: string;
  try {
    contractJsonContent = await readFile(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
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

  // Route the on-disk contract read through the family
  // `ContractSerializer` seam: structural validation + IR-class
  // hydration happen at the boundary, not at each downstream consumer.
  // The aggregate loader's `validateContract` callback below shares
  // the same family instance, so every space's contract crosses the
  // same seam.
  const stack = createControlStack(config);
  const familyInstance = config.family.create(stack);
  let appContract: Contract;
  try {
    appContract = familyInstance.validateContract(JSON.parse(contractJsonContent) as unknown);
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract validation failed: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  // Build the aggregate against current disk state to enumerate all spaces.
  const aggregateResult = await buildContractSpaceAggregate({
    targetId: config.target.targetId,
    migrationsDir,
    appContract,
    extensionPacks: config.extensionPacks ?? [],
    validateContract: (json: unknown) => familyInstance.validateContract(json),
  });
  if (!aggregateResult.ok) {
    return notOk(aggregateResult.failure);
  }
  const aggregate = aggregateResult.value;

  // `migration show` is an offline command; the control client is constructed
  // purely to dispatch the family-specific `toOperationPreview` capability and
  // is not connected to a database.
  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    ...ifDefined('driver', config.driver),
    extensionPacks: config.extensionPacks ?? [],
  });

  const spaces: MigrationShowSpaceResult[] = [];

  // App space: honour the `target` argument (path or hash prefix) when provided.
  try {
    let appPkg: OnDiskMigrationPackage;
    if (target && looksLikePath(target)) {
      const resolved = resolveAppTargetPath(target, appMigrationsDir, appMigrationsRelative);
      if (!resolved.ok) return resolved;
      appPkg = await readMigrationPackage(resolved.value);
    } else {
      const allPackages = await readMigrationsDir(appMigrationsDir);
      if (allPackages.length === 0) {
        return notOk(
          errorRuntime('No migrations found', {
            why: `No migration packages found in ${appMigrationsRelative}`,
            fix: 'Run `prisma-next migration plan` to create a migration first.',
          }),
        );
      }
      if (target) {
        const resolved = resolveByHashPrefix(allPackages, target);
        if (!resolved.ok) return resolved;
        appPkg = resolved.value;
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
        appPkg = leafPkg;
      }
    }
    spaces.push(pkgToSpaceResult(aggregate.app.spaceId, appPkg, client));
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read app-space migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  // Extension spaces: always emit one entry per loaded extension so the
  // response enumerates every space the aggregate knows about. Spaces
  // with no on-disk migration package yet (e.g. an extension was declared
  // but never `migrate`d) become `kind: 'missing'` placeholders instead
  // of being silently skipped.
  for (const ext of aggregate.extensions) {
    const extSpaceDir = spaceMigrationDirectory(migrationsDir, ext.spaceId);
    const extPkgResult = await resolveLatestFromDir(extSpaceDir);
    if (!extPkgResult.ok) return extPkgResult;
    if (extPkgResult.value !== null) {
      spaces.push(pkgToSpaceResult(ext.spaceId, extPkgResult.value, client));
    } else {
      spaces.push({
        kind: 'missing',
        spaceId: ext.spaceId,
        summary: 'No on-disk migration package for this space',
      });
    }
  }

  return ok({ ok: true, spaces });
}

export function createMigrationShowCommand(): Command {
  const command = new Command('show');
  setCommandDescriptions(
    command,
    'Display migration package contents',
    'Shows the operations, statement preview, and metadata for every loaded contract\n' +
      'space (app + extensions). Accepts a directory path or hash prefix to target a\n' +
      'specific app-space migration; defaults to the latest per space.',
  );
  setCommandExamples(command, [
    'prisma-next migration show',
    'prisma-next migration show sha256:a1b2c3',
  ]);
  addGlobalOptions(command)
    .argument('[target]', 'App-space migration path or migrationHash prefix (defaults to latest)')
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
