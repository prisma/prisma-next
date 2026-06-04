import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { IntegrityViolation } from '@prisma-next/migration-tools/aggregate';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import { verifyMigrationHash } from '@prisma-next/migration-tools/hash';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import { reconstructGraph } from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { parseMigrationRef } from '@prisma-next/migration-tools/ref-resolution';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { Command } from 'commander';
import { join, relative } from 'pathe';
import { loadConfig } from '../config-loader';
import { type CliStructuredError, mapRefResolutionError } from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { toDeclaredExtensionsFromRaw } from '../utils/extension-pack-inputs';
import { formatErrorJson, formatErrorOutput } from '../utils/formatters/errors';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import {
  type CheckFailure,
  integrityViolationToCheckFailure,
} from '../utils/integrity-violation-to-check-failure';
import {
  findPackageByDirPath,
  looksLikePath,
  resolveAppTargetPath,
} from '../utils/migration-path-target';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';
import { INTEGRITY_FAILED, OK, PRECONDITION } from './migration-check/exit-codes';

interface MigrationCheckOptions extends CommonCommandOptions {
  readonly config?: string;
}

export type { CheckFailure } from '../utils/integrity-violation-to-check-failure';

export interface MigrationCheckResult {
  readonly ok: boolean;
  readonly failures: readonly CheckFailure[];
  readonly summary: string;
}

function migrationPathRelative(dirPath: string): string {
  return relative(process.cwd(), dirPath);
}

function migrationFileRelative(dirPath: string, fileName: string): string {
  return join(migrationPathRelative(dirPath), fileName);
}

function checkFileExists(dirPath: string, dirName: string, fileName: string): CheckFailure | null {
  if (!existsSync(join(dirPath, fileName))) {
    return {
      pnCode: 'PN-MIG-CHECK-002',
      where: migrationFileRelative(dirPath, fileName),
      why: `${fileName} is missing from ${dirName}`,
      fix: 'Re-emit the migration package or restore from version control.',
    };
  }
  return null;
}

function checkSnapshotConsistency(pkg: OnDiskMigrationPackage): CheckFailure | null {
  const endContractPath = join(pkg.dirPath, 'end-contract.json');
  if (!existsSync(endContractPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(endContractPath, 'utf-8')) as Record<string, unknown>;
    const storage = raw['storage'] as Record<string, unknown> | undefined;
    const snapshotHash = storage?.['storageHash'];
    if (typeof snapshotHash === 'string' && snapshotHash !== pkg.metadata.to) {
      return {
        pnCode: 'PN-MIG-CHECK-005',
        where: migrationPathRelative(pkg.dirPath),
        why: `Migration "${pkg.dirName}" declares to=${pkg.metadata.to} but end-contract.json has storageHash=${snapshotHash}`,
        fix: 'Re-emit the migration package so migration.json and end-contract.json agree.',
      };
    }
  } catch {
    return {
      pnCode: 'PN-MIG-CHECK-006',
      where: migrationPathRelative(pkg.dirPath),
      why: `Migration "${pkg.dirName}" has an unparseable end-contract.json.`,
      fix: 'Re-emit the migration package to repair the snapshot file.',
    };
  }
  return null;
}

async function loadAggregateIntegrityViolations(
  config: Awaited<ReturnType<typeof loadConfig>>,
  migrationsDir: string,
): Promise<readonly IntegrityViolation[]> {
  try {
    const contractJsonContent = await readFile(resolveContractPath(config), 'utf-8');
    const familyInstance = config.family.create(createControlStack(config));
    const declaredExtensions = toDeclaredExtensionsFromRaw(config.extensionPacks ?? []);

    const parsedAppContract: unknown = JSON.parse(contractJsonContent);
    const aggregate = await loadContractSpaceAggregate({
      migrationsDir,
      deserializeContract: (json: unknown) => familyInstance.deserializeContract(json),
      appContract: familyInstance.deserializeContract(parsedAppContract),
    });
    return aggregate.checkIntegrity({ declaredExtensions, checkContracts: true });
  } catch {
    return [];
  }
}

interface MigrationCheckOutcome {
  readonly result?: MigrationCheckResult;
  readonly error?: CliStructuredError;
  readonly exitCode: number;
}

async function executeMigrationCheckCommand(
  target: string | undefined,
  options: MigrationCheckOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<MigrationCheckOutcome> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, appMigrationsDir, appMigrationsRelative, refsDir } =
    resolveMigrationPaths(options.config, config);

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'migrations', value: appMigrationsRelative },
    ];
    if (target) {
      details.push({ label: 'target', value: target });
    }
    const header = formatStyledHeader({
      command: 'migration check',
      description: 'Verify artifact and graph integrity',
      details,
      flags,
    });
    ui.stderr(header);
  }

  const failures: CheckFailure[] = [];

  const loaded = await readMigrationsDir(appMigrationsDir);
  const bundles: readonly OnDiskMigrationPackage[] = loaded.packages;
  const graph = reconstructGraph(bundles);

  if (existsSync(appMigrationsDir)) {
    const loadedDirNames = new Set(bundles.map((p) => p.dirName));
    try {
      const entries = readdirSync(appMigrationsDir);
      for (const entry of entries) {
        if (entry.startsWith('.') || entry.startsWith('_') || entry === 'refs') continue;
        const entryPath = join(appMigrationsDir, entry);
        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }
        if (!loadedDirNames.has(entry)) {
          for (const f of ['migration.json', 'ops.json']) {
            const fail = checkFileExists(entryPath, entry, f);
            if (fail) failures.push(fail);
          }
        }
      }
    } catch {
      // migrations dir unreadable — skip
    }
  }

  if (target) {
    let matchedPkg: OnDiskMigrationPackage | undefined;
    if (looksLikePath(target)) {
      const resolved = resolveAppTargetPath(target, appMigrationsDir, appMigrationsRelative);
      if (!resolved.ok) {
        return { error: resolved.failure, exitCode: PRECONDITION };
      }
      matchedPkg = findPackageByDirPath(bundles, resolved.value);
    } else {
      const refs = await readRefs(refsDir);
      const migResult = parseMigrationRef(target, { graph, refs });
      if (!migResult.ok) {
        return {
          error: mapRefResolutionError(migResult.failure),
          exitCode: PRECONDITION,
        };
      }
      matchedPkg = bundles.find((p) => p.metadata.migrationHash === migResult.value.migrationHash);
    }

    if (!matchedPkg) {
      return {
        result: {
          ok: false,
          failures: [],
          summary: `Migration package for "${target}" not found on disk`,
        },
        exitCode: PRECONDITION,
      };
    }

    for (const f of ['migration.json', 'ops.json']) {
      const fail = checkFileExists(matchedPkg.dirPath, matchedPkg.dirName, f);
      if (fail) failures.push(fail);
    }

    const verification = verifyMigrationHash(matchedPkg);
    if (!verification.ok) {
      failures.push({
        pnCode: 'PN-MIG-CHECK-001',
        where: migrationFileRelative(matchedPkg.dirPath, 'migration.json'),
        why: `Stored hash ${verification.storedHash} does not match recomputed hash ${verification.computedHash}`,
        fix: 'Re-emit the migration package or restore from version control.',
      });
    }

    const snapshotFailure = checkSnapshotConsistency(matchedPkg);
    if (snapshotFailure) failures.push(snapshotFailure);
  } else {
    for (const pkg of bundles) {
      const snapshotFailure = checkSnapshotConsistency(pkg);
      if (snapshotFailure) failures.push(snapshotFailure);
    }

    const allToHashes = new Set(bundles.map((p) => p.metadata.to));
    for (const pkg of bundles) {
      const isReachable =
        pkg.metadata.from === null ||
        allToHashes.has(pkg.metadata.from) ||
        pkg.metadata.from === 'sha256:empty';
      if (!isReachable) {
        failures.push({
          pnCode: 'PN-MIG-CHECK-003',
          where: migrationPathRelative(pkg.dirPath),
          why: `Migration "${pkg.dirName}" starts from ${pkg.metadata.from} which no other migration produces`,
          fix: 'This migration is unreachable in the graph. Delete it or re-emit a connecting migration.',
        });
      }
    }

    try {
      const refs = await readRefs(refsDir);
      for (const [name, entry] of Object.entries(refs)) {
        if (!graph.nodes.has(entry.hash)) {
          failures.push({
            pnCode: 'PN-MIG-CHECK-004',
            where: relative(process.cwd(), join(refsDir, `${name}.json`)),
            why: `Ref "${name}" points at ${entry.hash} which does not exist in the migration graph`,
            fix: `Update the ref with \`prisma-next ref set ${name} <valid-hash>\` or delete it.`,
          });
        }
      }
    } catch {
      // Refs unreadable — skip ref checks
    }

    for (const violation of await loadAggregateIntegrityViolations(config, migrationsDir)) {
      failures.push(integrityViolationToCheckFailure(violation, migrationsDir));
    }
  }

  if (failures.length === 0) {
    return {
      result: { ok: true, failures: [], summary: 'All checks passed' },
      exitCode: OK,
    };
  }

  return {
    result: { ok: false, failures, summary: `${failures.length} integrity failure(s)` },
    exitCode: INTEGRITY_FAILED,
  };
}

export function createMigrationCheckCommand(): Command {
  const command = new Command('check');
  setCommandDescriptions(
    command,
    'Verify artifact and graph integrity',
    'Validates that on-disk migration packages are internally consistent\n' +
      '(hashes match, manifests are complete) and that the graph is well-formed\n' +
      '(edges connect, refs point at valid nodes). Offline — does not consult\n' +
      'the database.',
  );
  setCommandExamples(command, [
    'prisma-next migration check',
    'prisma-next migration check 20260101-add-users',
    'prisma-next migration check --json',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration list', oneLiner: 'List on-disk migrations' },
    { verb: 'migration graph', oneLiner: 'Show the migration graph topology' },
  ]);
  command.exitOverride();
  addGlobalOptions(command)
    .argument('[target]', 'Migration reference: directory name, hash/prefix, ref, or path')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (target: string | undefined, options: MigrationCheckOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);

      let outcome: MigrationCheckOutcome;
      try {
        outcome = await executeMigrationCheckCommand(target, options, flags, ui);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outcome = {
          result: { ok: false, failures: [], summary: msg },
          exitCode: PRECONDITION,
        };
      }

      if (outcome.error) {
        const envelope = outcome.error.toEnvelope();
        if (flags.json) {
          ui.output(formatErrorJson(envelope));
        } else if (!flags.quiet) {
          ui.error(formatErrorOutput(envelope, flags));
        }
        process.exit(outcome.exitCode);
      }

      const result = outcome.result ?? {
        ok: false,
        failures: [],
        summary: 'No check result produced',
      };

      if (flags.json) {
        ui.output(JSON.stringify(result, null, 2));
      } else if (!flags.quiet) {
        if (result.ok) {
          ui.log(`✔ ${result.summary}`);
        } else {
          for (const f of result.failures) {
            ui.log(`✗ [${f.pnCode}] ${f.where}: ${f.why}`);
            ui.log(`  fix: ${f.fix}`);
          }
          ui.log(`\n${result.summary}`);
        }
      }

      process.exit(outcome.exitCode);
    });

  return command;
}
