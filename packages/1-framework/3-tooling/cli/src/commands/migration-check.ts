import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { verifyMigrationHash } from '@prisma-next/migration-tools/hash';
import { parseMigrationRef } from '@prisma-next/migration-tools/ref-resolution';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { Command } from 'commander';
import { join } from 'pathe';
import { loadConfig } from '../config-loader';
import {
  addGlobalOptions,
  loadMigrationPackages,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { TerminalUI } from '../utils/terminal-ui';
import { INTEGRITY_FAILED, OK, PRECONDITION } from './migration-check/exit-codes';

interface MigrationCheckOptions extends CommonCommandOptions {
  readonly config?: string;
}

export interface CheckFailure {
  readonly pnCode: string;
  readonly where: string;
  readonly why: string;
  readonly fix: string;
}

export interface MigrationCheckResult {
  readonly ok: boolean;
  readonly failures: readonly CheckFailure[];
  readonly summary: string;
}

function checkFileExists(dirPath: string, dirName: string, fileName: string): CheckFailure | null {
  if (!existsSync(join(dirPath, fileName))) {
    return {
      pnCode: 'PN-MIG-CHECK-002',
      where: dirName,
      why: `${fileName} is missing from ${dirName}`,
      fix: 'Re-emit the migration package or restore from version control.',
    };
  }
  return null;
}

async function executeMigrationCheckCommand(
  target: string | undefined,
  options: MigrationCheckOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<{ result: MigrationCheckResult; exitCode: number }> {
  const config = await loadConfig(options.config);
  const { configPath, appMigrationsDir, appMigrationsRelative, refsDir } = resolveMigrationPaths(
    options.config,
    config,
  );

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

  let bundles: Awaited<ReturnType<typeof loadMigrationPackages>>['bundles'];
  let graph: Awaited<ReturnType<typeof loadMigrationPackages>>['graph'];
  try {
    const loaded = await loadMigrationPackages(appMigrationsDir);
    bundles = loaded.bundles;
    graph = loaded.graph;
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      const pnCode =
        error.code === 'MIGRATION.HASH_MISMATCH' ? 'PN-MIG-CHECK-001' : 'PN-MIG-CHECK-002';
      failures.push({
        pnCode,
        where:
          (error.details?.['dir'] as string) ??
          (error.details?.['filePath'] as string) ??
          'unknown',
        why: error.why,
        fix: error.fix,
      });
      return {
        result: { ok: false, failures, summary: `${failures.length} integrity failure(s)` },
        exitCode: INTEGRITY_FAILED,
      };
    }
    throw error;
  }

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
    const refs = await readRefs(refsDir);
    const migResult = parseMigrationRef(target, { graph, refs });
    if (!migResult.ok) {
      const msg =
        migResult.failure.kind === 'not-found'
          ? `Migration "${target}" does not exist`
          : migResult.failure.kind === 'wrong-grammar'
            ? migResult.failure.message
            : `Invalid migration reference: "${target}"`;
      return {
        result: { ok: false, failures: [], summary: msg },
        exitCode: PRECONDITION,
      };
    }

    const matchedPkg = bundles.find(
      (p) => p.metadata.migrationHash === migResult.value.migrationHash,
    );
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
        where: matchedPkg.dirName,
        why: `Stored hash ${verification.storedHash} does not match recomputed hash ${verification.computedHash}`,
        fix: 'Re-emit the migration package or restore from version control.',
      });
    }
  } else {
    for (const pkg of bundles) {
      for (const f of ['migration.json', 'ops.json']) {
        const fail = checkFileExists(pkg.dirPath, pkg.dirName, f);
        if (fail) failures.push(fail);
      }

      const verification = verifyMigrationHash(pkg);
      if (!verification.ok) {
        failures.push({
          pnCode: 'PN-MIG-CHECK-001',
          where: pkg.dirName,
          why: `Stored hash ${verification.storedHash} does not match recomputed hash ${verification.computedHash}`,
          fix: 'Re-emit the migration package or restore from version control.',
        });
      }
    }

    for (const pkg of bundles) {
      const endContractPath = join(pkg.dirPath, 'end-contract.json');
      if (existsSync(endContractPath)) {
        try {
          const raw = JSON.parse(readFileSync(endContractPath, 'utf-8')) as Record<string, unknown>;
          const storage = raw['storage'] as Record<string, unknown> | undefined;
          const snapshotHash = storage?.['storageHash'];
          if (typeof snapshotHash === 'string' && snapshotHash !== pkg.metadata.to) {
            failures.push({
              pnCode: 'PN-MIG-CHECK-005',
              where: pkg.dirName,
              why: `Migration "${pkg.dirName}" declares to=${pkg.metadata.to} but end-contract.json has storageHash=${snapshotHash}`,
              fix: 'Re-emit the migration package so migration.json and end-contract.json agree.',
            });
          }
        } catch {
          // end-contract.json unparseable — the file check already covers this
        }
      }
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
          where: pkg.dirName,
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
            where: `ref "${name}"`,
            why: `Ref "${name}" points at ${entry.hash} which does not exist in the migration graph`,
            fix: `Update the ref with \`prisma-next ref set ${name} <valid-hash>\` or delete it.`,
          });
        }
      }
    } catch {
      // Refs unreadable — skip ref checks
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
    .argument('[migration]', 'Migration reference (directory name or hash) to check')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (target: string | undefined, options: MigrationCheckOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      let result: MigrationCheckResult;
      let exitCode: number;
      try {
        ({ result, exitCode } = await executeMigrationCheckCommand(target, options, flags, ui));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result = { ok: false, failures: [], summary: msg };
        exitCode = PRECONDITION;
      }

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

      process.exit(exitCode);
    });

  return command;
}
