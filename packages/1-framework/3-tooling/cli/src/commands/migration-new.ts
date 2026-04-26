/**
 * `migration new` — scaffolds a migration package with a `migration.ts` file
 * for manual authoring.
 *
 * The planner's `emptyMigration(context)` returns a
 * `MigrationPlanWithAuthoringSurface`, whose `renderTypeScript()` produces
 * the target-appropriate empty stub. The CLI writes the returned source
 * verbatim.
 */

import { readFileSync } from 'node:fs';
import type { Contract } from '@prisma-next/contract/types';
import { getEmittedArtifactPaths } from '@prisma-next/emitter';
import { createControlStack } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { findLatestMigration, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import {
  copyFilesWithRename,
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { writeMigrationTs } from '@prisma-next/migration-tools/migration-ts';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { join, relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import {
  CliStructuredError,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  getTargetMigrations,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatStyledHeader } from '../utils/formatters/styled';
import { assertFrameworkComponentsCompatible } from '../utils/framework-components';
import type { CommonCommandOptions } from '../utils/global-flags';
import { parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationNewOptions extends CommonCommandOptions {
  readonly name?: string;
  readonly from?: string;
  readonly config?: string;
}

interface MigrationNewResult {
  readonly ok: true;
  readonly dir: string;
  readonly from: string;
  readonly to: string;
  readonly summary: string;
}

async function executeMigrationNewCommand(
  options: MigrationNewOptions,
): Promise<Result<MigrationNewResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { migrationsDir, migrationsRelative } = resolveMigrationPaths(options.config, config);

  const contractPath = config.contract?.output ?? 'contract.json';
  const contractPathAbsolute = resolve(
    options.config ? resolve(options.config, '..') : process.cwd(),
    contractPath,
  );

  let contractJsonContent: string;
  try {
    contractJsonContent = readFileSync(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return notOk(
        errorRuntime(`Contract file not found at ${contractPathAbsolute}`, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: 'Run `prisma-next contract emit` first to generate the contract',
        }),
      );
    }
    throw error;
  }

  let toContractJson: Contract;
  try {
    toContractJson = JSON.parse(contractJsonContent) as Contract;
  } catch (error) {
    return notOk(
      errorRuntime('Contract JSON is invalid', {
        why: `Failed to parse ${contractPathAbsolute}: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Run `prisma-next contract emit` to regenerate the contract',
      }),
    );
  }

  const toStorageHash = (
    (toContractJson as unknown as Record<string, unknown>)['storage'] as
      | Record<string, unknown>
      | undefined
  )?.['storageHash'] as string | undefined;
  if (!toStorageHash) {
    return notOk(
      errorRuntime('Contract is missing storageHash', {
        why: `Contract at ${contractPathAbsolute} has no storageHash`,
        fix: 'Run `prisma-next contract emit` to regenerate the contract',
      }),
    );
  }

  let fromContract: Contract | null = null;
  let fromHash: string = EMPTY_CONTRACT_HASH;
  let fromContractSourceDir: string | null = null;

  try {
    const packages = await readMigrationsDir(migrationsDir);

    if (packages.length > 0) {
      const graph = reconstructGraph(packages);

      if (options.from) {
        const match = packages.find((p) => p.metadata.to.startsWith(options.from!));
        if (!match) {
          return notOk(
            errorRuntime('Starting contract not found', {
              why: `No migration with to hash matching "${options.from}" exists in ${migrationsRelative}`,
              fix: 'Check that the --from hash matches a known migration target hash.',
            }),
          );
        }
        fromHash = match.metadata.to;
        fromContract = match.metadata.toContract;
        fromContractSourceDir = match.dirPath;
      } else {
        const latestMigration = findLatestMigration(graph);
        if (latestMigration) {
          fromHash = latestMigration.to;
          const leafPkg = packages.find(
            (p) => p.metadata.migrationHash === latestMigration.migrationHash,
          );
          if (leafPkg) {
            fromContract = leafPkg.metadata.toContract;
            fromContractSourceDir = leafPkg.dirPath;
          }
        }
      }
    }
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(
        errorRuntime(error.message, {
          why: error.why,
          fix: error.fix,
          meta: { code: error.code },
        }),
      );
    }
    throw error;
  }

  if (fromHash === toStorageHash) {
    return notOk(
      errorRuntime('No changes detected', {
        why: 'The from and to contract hashes are identical — there is nothing to migrate.',
        fix: 'Change the contract and run `prisma-next contract emit` before creating a new migration.',
      }),
    );
  }

  const timestamp = new Date();
  const slug = options.name ?? 'migration';
  const dirName = formatMigrationDirName(timestamp, slug);
  const packageDir = join(migrationsDir, dirName);

  // `migration new` scaffolds an empty `migration.ts` for the user to
  // fill, so we attest over `ops: []`. Re-running self-emit after the
  // user adds operations will produce a different `migrationHash` (over
  // the real ops). This is intentional — there is no on-disk draft.
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: fromHash,
    to: toStorageHash,
    kind: 'regular',
    fromContract,
    toContract: toContractJson,
    hints: {
      used: [],
      applied: [],
      plannerVersion: '1.0.0',
    },
    labels: [],
    createdAt: timestamp.toISOString(),
  };
  const metadata: MigrationMetadata = {
    ...baseMetadata,
    migrationHash: computeMigrationHash(baseMetadata, []),
  };

  const migrations = getTargetMigrations(config.target);
  if (!migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.targetId}" does not support migrations`,
      }),
    );
  }

  try {
    assertFrameworkComponentsCompatible(config.family.familyId, config.target.targetId, [
      config.target,
      config.adapter,
      ...(config.extensionPacks ?? []),
    ]);

    await writeMigrationPackage(packageDir, metadata, []);
    const destinationArtifacts = getEmittedArtifactPaths(contractPathAbsolute);
    await copyFilesWithRename(packageDir, [
      { sourcePath: destinationArtifacts.jsonPath, destName: 'end-contract.json' },
      { sourcePath: destinationArtifacts.dtsPath, destName: 'end-contract.d.ts' },
    ]);
    if (fromContractSourceDir !== null) {
      const sourceArtifacts = getEmittedArtifactPaths(
        join(fromContractSourceDir, 'end-contract.json'),
      );
      await copyFilesWithRename(packageDir, [
        { sourcePath: sourceArtifacts.jsonPath, destName: 'start-contract.json' },
        { sourcePath: sourceArtifacts.dtsPath, destName: 'start-contract.d.ts' },
      ]);
    }

    const stack = createControlStack(config);
    const familyInstance = config.family.create(stack);
    const planner = migrations.createPlanner(familyInstance);
    const emptyPlan = planner.emptyMigration({
      packageDir,
      contractJsonPath: join(packageDir, 'end-contract.json'),
      fromHash,
      toHash: toStorageHash,
    });
    await writeMigrationTs(packageDir, emptyPlan.renderTypeScript());

    return ok({
      ok: true as const,
      dir: relative(process.cwd(), packageDir),
      from: fromHash,
      to: toStorageHash,
      summary: `Scaffolded migration at ${relative(process.cwd(), packageDir)}`,
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to scaffold migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

export function createMigrationNewCommand(): Command {
  const command = new Command('new');
  setCommandDescriptions(
    command,
    'Scaffold a new migration for manual authoring',
    'Creates a migration package with a migration.ts file for manual authoring.\n' +
      'Write the migration body in migration.ts, then run the file with Node\n' +
      '(`node migration.ts`) to self-emit ops.json and attest the package.',
  );
  setCommandExamples(command, [
    'prisma-next migration new --name split-name',
    'prisma-next migration new --name custom-fk --from sha256:abc...',
  ]);
  addGlobalOptions(command)
    .option('--name <slug>', 'Migration name (used in directory name)')
    .option('--from <hash>', 'Starting contract hash (default: latest migration target)')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: MigrationNewOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      if (!flags.json && !flags.quiet) {
        const header = formatStyledHeader({
          command: 'migration new',
          description: 'Scaffold a new migration',
          details: [],
          flags,
        });
        ui.stderr(header);
      }

      const result = await executeMigrationNewCommand(options);

      const exitCode = handleResult(result, flags, ui, (value) => {
        if (flags.json) {
          ui.output(JSON.stringify(value, null, 2));
        } else if (!flags.quiet) {
          ui.output(`\nScaffolded migration at ${value.dir}`);
          ui.output(`  from: ${value.from}`);
          ui.output(`  to:   ${value.to}`);
          ui.output(
            `\nEdit migration.ts, then run it directly (\`node "${value.dir}/migration.ts"\`) to self-emit and attest.`,
          );
        }
      });

      process.exit(exitCode);
    });

  return command;
}
