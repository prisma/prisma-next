import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { IntegrityViolation } from '@prisma-next/migration-tools/aggregate';
import {
  loadContractSpaceAggregate,
  loadProblemToViolation,
} from '@prisma-next/migration-tools/aggregate';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { verifyMigrationHash } from '@prisma-next/migration-tools/hash';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import { reconstructGraph } from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { parseMigrationRef } from '@prisma-next/migration-tools/ref-resolution';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { APP_SPACE_ID } from '@prisma-next/migration-tools/spaces';
import { Command } from 'commander';
import { join, relative } from 'pathe';
import { loadConfig } from '../config-loader';
import {
  addGlobalOptions,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { toDeclaredExtensionsFromRaw } from '../utils/extension-pack-inputs';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlagsOrExit } from '../utils/global-flags';
import {
  type CheckFailure,
  integrityViolationToCheckFailure,
} from '../utils/integrity-violation-to-check-failure';
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

/**
 * Canonical user-facing locator for a check failure: the cwd-relative path
 * to the migration package directory. Surfacing the same shape across every
 * PN code means `--json` consumers can branch uniformly on `where`.
 */
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

/**
 * Within-migration snapshot-consistency check (PN-MIG-CHECK-005).
 *
 * Compares the migration's stored `metadata.to` against the `storageHash`
 * recorded in its on-disk `end-contract.json` snapshot. The two values are
 * independent on-disk records of the same fact (the migration's destination
 * contract); drift between them indicates the package is internally
 * corrupt. Cross-migration consistency (one migration's end-contract.json
 * agreeing with the next migration's start-contract.json) is a separate
 * check that requires shadow execution and is deferred to
 * `migration preflight`.
 *
 * Shared between the graph-wide and per-migration code paths so both report
 * the same failure for the same on-disk state.
 */
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

/**
 * Integrity-violation kinds `migration check` already reports through its
 * own legacy on-disk checks: package hash mismatch (`PN-MIG-CHECK-001`)
 * and the manifest-disagreement / unloadable cases (`PN-MIG-CHECK-002`).
 * These are skipped when folding in the `checkIntegrity()` view so the
 * same on-disk fault is never reported twice — but only for the **app
 * space**, since the legacy pass reads `appMigrationsDir` exclusively.
 * The identical kinds in an extension or orphan space are seen by neither
 * path, so the fold must report those (see {@link isAppSpaceLegacyCovered}).
 */
const COVERED_BY_LEGACY_CHECKS: ReadonlySet<IntegrityViolation['kind']> = new Set([
  'hashMismatch',
  'providedInvariantsMismatch',
  'packageUnloadable',
]);

/**
 * Whether the legacy on-disk pass already reported this violation, making
 * the fold's row a duplicate. True only for the covered kinds **in the app
 * space**: the legacy pass walks `appMigrationsDir` alone, so the same kind
 * in an extension or orphan space is invisible to it and must surface
 * through the fold. All covered kinds carry `spaceId`, so the `in` guard
 * both narrows the union and excludes the (spaceId-less) `disjointness`.
 */
function isAppSpaceLegacyCovered(violation: IntegrityViolation): boolean {
  return (
    COVERED_BY_LEGACY_CHECKS.has(violation.kind) &&
    'spaceId' in violation &&
    violation.spaceId === APP_SPACE_ID
  );
}

/**
 * The aggregate-level integrity view for the graph-wide check: build the
 * tolerant {@link loadContractSpaceAggregate} from the live app contract +
 * on-disk state and return the full `checkIntegrity` violation set. This
 * re-acquires the checks the prior throw-on-load loader enforced that
 * `check`'s app-space-only on-disk pass cannot see — the `from === to`
 * self-edge and the cross-space layout / contract violations.
 *
 * Best-effort: if the live contract cannot be read or deserialized the
 * aggregate cannot be built, and the file-level checks above still run and
 * report on their own. (A missing/invalid contract is surfaced by the
 * commands that require it, not by this offline diagnostic.)
 */
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

async function executeMigrationCheckCommand(
  target: string | undefined,
  options: MigrationCheckOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<{ result: MigrationCheckResult; exitCode: number }> {
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

  // Load tolerantly and report every problem, rather than bailing on the
  // first. `readMigrationsDir` retains hash-/invariant-mismatched packages
  // (the per-package checks below re-derive those) and omits unparseable
  // ones, recording each as a `problem`. Surfacing the omitted/invariant
  // problems here keeps `check` reporting them as `PN-MIG-CHECK-002`
  // instead of silently dropping them.
  const loaded = await readMigrationsDir(appMigrationsDir);
  const bundles: readonly OnDiskMigrationPackage[] = loaded.packages;
  let graph: MigrationGraph;
  try {
    graph = reconstructGraph(bundles);
  } catch (error) {
    // `reconstructGraph` only throws on structural impossibilities the
    // per-package checks can't express (e.g. duplicate migration hashes).
    // Record it as an integrity failure and continue with an empty graph
    // so the file-level checks below still run and report.
    const why = MigrationToolsError.is(error)
      ? error.why
      : error instanceof Error
        ? error.message
        : String(error);
    const fix = MigrationToolsError.is(error)
      ? error.fix
      : 'Inspect the migration packages for structural inconsistencies.';
    failures.push({ pnCode: 'PN-MIG-CHECK-002', where: appMigrationsRelative, why, fix });
    graph = {
      nodes: new Set<string>(),
      forwardChain: new Map(),
      reverseChain: new Map(),
      migrationByHash: new Map(),
    };
  }

  for (const problem of loaded.problems) {
    // Hash mismatches are retained in `bundles` and re-derived by the
    // per-package hash check below, so skip them here to avoid
    // double-reporting the same `PN-MIG-CHECK-001`.
    if (problem.kind === 'hashMismatch') continue;
    failures.push(
      integrityViolationToCheckFailure(
        loadProblemToViolation(APP_SPACE_ID, problem),
        migrationsDir,
      ),
    );
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
        where: migrationFileRelative(matchedPkg.dirPath, 'migration.json'),
        why: `Stored hash ${verification.storedHash} does not match recomputed hash ${verification.computedHash}`,
        fix: 'Re-emit the migration package or restore from version control.',
      });
    }

    // PN-MIG-CHECK-005 must fire per-migration as well as graph-wide; both
    // call sites delegate to the shared helper so the same on-disk drift
    // produces the same failure regardless of how the user invoked check.
    const snapshotFailure = checkSnapshotConsistency(matchedPkg);
    if (snapshotFailure) failures.push(snapshotFailure);
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
          where: migrationFileRelative(pkg.dirPath, 'migration.json'),
          why: `Stored hash ${verification.storedHash} does not match recomputed hash ${verification.computedHash}`,
          fix: 'Re-emit the migration package or restore from version control.',
        });
      }
    }

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

    // Fold in the aggregate-level integrity view. `check`'s on-disk pass
    // above only walks the app space; `checkIntegrity` reports the full set
    // across every space — re-acquiring the relocated `from === to` self-edge
    // and the cross-space layout / contract checks the prior throw-on-load
    // loader enforced. Only app-space duplicates of the legacy pass are
    // skipped; the same kinds in an extension/orphan space are seen by
    // neither path, so the fold must report them.
    for (const violation of await loadAggregateIntegrityViolations(config, migrationsDir)) {
      if (isAppSpaceLegacyCovered(violation)) continue;
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
    .argument('[migration]', 'Migration reference (directory name or hash) to check')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (target: string | undefined, options: MigrationCheckOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);

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
