import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createControlStack } from '@prisma-next/framework-components/control';
import type {
  ContractSpaceAggregate,
  IntegrityViolation,
} from '@prisma-next/migration-tools/aggregate';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { verifyMigrationHash } from '@prisma-next/migration-tools/hash';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { parseMigrationRef } from '@prisma-next/migration-tools/ref-resolution';
import type { Refs } from '@prisma-next/migration-tools/refs';
import {
  isValidSpaceId,
  listContractSpaceDirectories,
  RESERVED_SPACE_SUBDIR_NAMES,
  spaceMigrationDirectory,
  spaceRefsDirectory,
} from '@prisma-next/migration-tools/spaces';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { join, relative } from 'pathe';
import { loadConfig } from '../config-loader';
import {
  type CliStructuredError,
  errorAmbiguousMigrationRef,
  errorInvalidSpaceId,
  errorSpaceNotFound,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { buildReadAggregate } from '../utils/contract-space-aggregate-loader';
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
  resolveTargetPathAcrossSpaces,
} from '../utils/migration-path-target';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';
import { INTEGRITY_FAILED, OK, PRECONDITION } from './migration-check/exit-codes';

interface MigrationCheckOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly space?: string;
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

/**
 * One contract space's on-disk state, resolved for the explicit graph
 * checks `runMigrationCheck` runs per space: the space's migration
 * packages, its user-authored refs, its induced graph, and the absolute
 * `migrations/<space>/` + `migrations/<space>/refs/` directories the
 * file-existence and dangling-ref `where` paths are derived from.
 */
export interface CheckSpace {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly graph: MigrationGraph;
  readonly migrationsDir: string;
  readonly refsDir: string;
}

/**
 * Project the loaded {@link ContractSpaceAggregate} into the
 * {@link CheckSpace} rows the multi-space check iterates — one per on-disk
 * contract-space directory, in the aggregate's `app`-first ordering. Mirrors
 * `migration list`'s `migrationSpaceListEntriesFromAggregate`: space
 * membership matches the on-disk directories, package / ref / graph data come
 * from `aggregate.space(id)`.
 */
export async function enumerateCheckSpaces(
  aggregate: ContractSpaceAggregate,
  projectMigrationsDir: string,
): Promise<readonly CheckSpace[]> {
  const candidateDirs = await listContractSpaceDirectories(projectMigrationsDir);
  const onDiskSpaceIds = new Set(
    candidateDirs.filter((name) => !RESERVED_SPACE_SUBDIR_NAMES.has(name)).filter(isValidSpaceId),
  );
  const spaces: CheckSpace[] = [];
  for (const member of aggregate.spaces()) {
    const spaceId = member.spaceId;
    if (!isValidSpaceId(spaceId)) continue;
    if (!onDiskSpaceIds.has(spaceId)) continue;
    const migrationsDir = spaceMigrationDirectory(projectMigrationsDir, spaceId);
    spaces.push({
      spaceId,
      packages: member.packages,
      refs: member.refs,
      graph: member.graph(),
      migrationsDir,
      refsDir: spaceRefsDirectory(migrationsDir),
    });
  }
  return spaces;
}

function checkManifestFilesPresent(space: CheckSpace): readonly CheckFailure[] {
  if (!existsSync(space.migrationsDir)) return [];
  const loadedDirNames = new Set(space.packages.map((p) => p.dirName));
  const failures: CheckFailure[] = [];
  let entries: string[];
  try {
    entries = readdirSync(space.migrationsDir);
  } catch {
    return failures;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_') || entry === 'refs') continue;
    const entryPath = join(space.migrationsDir, entry);
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
  return failures;
}

function checkReachability(space: CheckSpace): readonly CheckFailure[] {
  const allToHashes = new Set(space.packages.map((p) => p.metadata.to));
  const failures: CheckFailure[] = [];
  for (const pkg of space.packages) {
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
  return failures;
}

function checkDanglingRefs(space: CheckSpace): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const [name, entry] of Object.entries(space.refs)) {
    if (!space.graph.nodes.has(entry.hash)) {
      failures.push({
        pnCode: 'PN-MIG-CHECK-004',
        where: relative(process.cwd(), join(space.refsDir, `${name}.json`)),
        why: `Ref "${name}" points at ${entry.hash} which does not exist in the migration graph`,
        fix: `Update the ref with \`prisma-next ref set ${name} <valid-hash>\` or delete it.`,
      });
    }
  }
  return failures;
}

function checkSpace(space: CheckSpace): readonly CheckFailure[] {
  return [
    ...checkManifestFilesPresent(space),
    ...space.packages.map(checkSnapshotConsistency).filter((f): f is CheckFailure => f !== null),
    ...checkReachability(space),
    ...checkDanglingRefs(space),
  ];
}

/**
 * Inputs for {@link runMigrationCheck} — the multi-space policy core of
 * the holistic (no-arg) `migration check`. Enumeration is supplied by the
 * caller (the CLI shell builds it from {@link enumerateCheckSpaces}); the
 * core does not touch config, flags, or streams.
 */
export interface RunMigrationCheckInputs {
  readonly spaces: readonly CheckSpace[];
  readonly spaceFilter?: string;
}

/**
 * Policy core of the holistic `migration check`: validates `--space`,
 * narrows the pre-enumerated spaces, and runs the per-space explicit graph
 * checks (file-existence, snapshot consistency, reachability, dangling
 * refs), aggregating every failure into one {@link MigrationCheckResult}.
 *
 * `--space` validation mirrors `migration list`: an invalid id →
 * {@link errorInvalidSpaceId}; an id with no on-disk space →
 * {@link errorSpaceNotFound}. Both map to exit `PRECONDITION` at the shell.
 * Aggregate-integrity violations (which already span every space) are folded
 * in by the caller, not here.
 */
export function runMigrationCheck(
  inputs: RunMigrationCheckInputs,
): Result<MigrationCheckResult, CliStructuredError> {
  const { spaces, spaceFilter } = inputs;

  if (spaceFilter !== undefined && !isValidSpaceId(spaceFilter)) {
    return notOk(errorInvalidSpaceId(spaceFilter));
  }
  if (spaceFilter !== undefined && !spaces.some((s) => s.spaceId === spaceFilter)) {
    return notOk(errorSpaceNotFound(spaceFilter, spaces.map((s) => s.spaceId).sort()));
  }

  const scopedSpaces =
    spaceFilter !== undefined ? spaces.filter((s) => s.spaceId === spaceFilter) : spaces;

  const failures = scopedSpaces.flatMap(checkSpace);
  if (failures.length === 0) {
    return ok({ ok: true, failures: [], summary: 'All checks passed' });
  }
  return ok({ ok: false, failures, summary: `${failures.length} integrity failure(s)` });
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
  readonly resolvedSpaceId?: string;
}

async function executeMigrationCheckCommand(
  target: string | undefined,
  options: MigrationCheckOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<MigrationCheckOutcome> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, appMigrationsDir, appMigrationsRelative } =
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

  const loadedAggregate = await buildReadAggregate(config, { migrationsDir });
  if (!loadedAggregate.ok) {
    return { error: loadedAggregate.failure, exitCode: PRECONDITION };
  }

  const spaces = await enumerateCheckSpaces(loadedAggregate.value.aggregate, migrationsDir);

  if (target) {
    return await checkSingleTarget(target, {
      spaces,
      ...(options.space !== undefined ? { spaceFilter: options.space } : {}),
      appMigrationsDir,
      appMigrationsRelative,
    });
  }

  const checkResult = runMigrationCheck({
    spaces,
    ...(options.space !== undefined ? { spaceFilter: options.space } : {}),
  });
  if (!checkResult.ok) {
    return { error: checkResult.failure, exitCode: PRECONDITION };
  }

  const failures: CheckFailure[] = [...checkResult.value.failures];
  const allViolations = await loadAggregateIntegrityViolations(config, migrationsDir);
  const scopedViolations =
    options.space === undefined
      ? allViolations
      : allViolations.filter((v) => v.kind !== 'disjointness' && v.spaceId === options.space);
  for (const violation of scopedViolations) {
    failures.push(integrityViolationToCheckFailure(violation, migrationsDir));
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

interface SingleTargetInputs {
  readonly spaces: readonly CheckSpace[];
  readonly spaceFilter?: string;
  readonly appMigrationsDir: string;
  readonly appMigrationsRelative: string;
}

/**
 * Single-target (`check <ref/path>`) mode — resolves a migration reference
 * across all contract spaces (or the one space narrowed by `--space <id>`).
 *
 * Resolution:
 *   - filesystem path → find the owning space by checking which space's
 *     `migrationsDir` contains the resolved path; falls back to app-relative
 *     validation when the path is outside every space dir.
 *   - ref → `parseMigrationRef` against each in-scope space; collect every
 *     (space, package) hit; 0 hits = not-found, 1 = check it, >1 = ambiguity
 *     error (qualify with `--space`).
 *
 * `--space <id>` is validated the same way the holistic path does it:
 * invalid id → `errorInvalidSpaceId`; no on-disk space → `errorSpaceNotFound`.
 */
async function checkSingleTarget(
  target: string,
  inputs: SingleTargetInputs,
): Promise<MigrationCheckOutcome> {
  const { spaces, spaceFilter, appMigrationsDir, appMigrationsRelative } = inputs;

  if (spaceFilter !== undefined && !isValidSpaceId(spaceFilter)) {
    return { error: errorInvalidSpaceId(spaceFilter), exitCode: PRECONDITION };
  }
  if (spaceFilter !== undefined && !spaces.some((s) => s.spaceId === spaceFilter)) {
    return {
      error: errorSpaceNotFound(spaceFilter, spaces.map((s) => s.spaceId).sort()),
      exitCode: PRECONDITION,
    };
  }

  const scopedSpaces =
    spaceFilter !== undefined ? spaces.filter((s) => s.spaceId === spaceFilter) : spaces;

  let matchedSpace: CheckSpace | undefined;
  let matchedPkg: OnDiskMigrationPackage | undefined;

  if (looksLikePath(target)) {
    const resolvedPath = resolveTargetPathAcrossSpaces(target, scopedSpaces);
    if (resolvedPath !== null) {
      for (const space of scopedSpaces) {
        const found = findPackageByDirPath(space.packages, resolvedPath);
        if (found) {
          matchedSpace = space;
          matchedPkg = found;
          break;
        }
      }
    } else {
      // Path outside every space dir — fall back to app-relative validation
      const resolved = resolveAppTargetPath(target, appMigrationsDir, appMigrationsRelative);
      if (!resolved.ok) {
        return { error: resolved.failure, exitCode: PRECONDITION };
      }
      const appSpace = scopedSpaces.find((s) => s.spaceId === 'app');
      if (appSpace) {
        matchedSpace = appSpace;
        matchedPkg = findPackageByDirPath(appSpace.packages, resolved.value);
      }
    }
  } else {
    // Ref resolution: try each in-scope space, collect all hits.
    const hits: Array<{ space: CheckSpace; pkg: OnDiskMigrationPackage }> = [];
    for (const space of scopedSpaces) {
      const migResult = parseMigrationRef(target, { graph: space.graph, refs: space.refs });
      if (!migResult.ok) continue;
      const pkg = space.packages.find(
        (p) => p.metadata.migrationHash === migResult.value.migrationHash,
      );
      if (pkg) {
        hits.push({ space, pkg });
      }
    }

    if (hits.length > 1) {
      const spaceIds = hits.map((h) => h.space.spaceId);
      return {
        error: errorAmbiguousMigrationRef(target, spaceIds),
        exitCode: PRECONDITION,
      };
    }

    if (hits.length === 1) {
      matchedSpace = hits[0]!.space;
      matchedPkg = hits[0]!.pkg;
    }
  }

  if (!matchedPkg || !matchedSpace) {
    return {
      result: {
        ok: false,
        failures: [],
        summary: `Migration package for "${target}" not found on disk`,
      },
      exitCode: PRECONDITION,
    };
  }

  const failures: CheckFailure[] = [...checkManifestFilesPresent(matchedSpace)];

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

  const resolvedSpaceId = matchedSpace.spaceId !== 'app' ? matchedSpace.spaceId : undefined;

  if (failures.length === 0) {
    return {
      result: { ok: true, failures: [], summary: 'All checks passed' },
      exitCode: OK,
      ...ifDefined('resolvedSpaceId', resolvedSpaceId),
    };
  }
  return {
    result: { ok: false, failures, summary: `${failures.length} integrity failure(s)` },
    exitCode: INTEGRITY_FAILED,
    ...ifDefined('resolvedSpaceId', resolvedSpaceId),
  };
}

export function createMigrationCheckCommand(): Command {
  const command = new Command('check');
  setCommandDescriptions(
    command,
    'Verify artifact and graph integrity',
    'Validates that on-disk migration packages are internally consistent\n' +
      '(hashes match, manifests are complete) and that the graph is well-formed\n' +
      '(edges connect, refs point at valid nodes). The whole-graph check spans\n' +
      'every contract space by default; pass --space <id> to narrow to one, or\n' +
      'a migration reference to check a single app-space package.\n' +
      'Offline — does not consult the database.\n' +
      'Exit codes: 0 = all checks passed, 2 = precondition failed\n' +
      '(unresolved target or unknown --space), 4 = integrity failure(s) found.',
  );
  setCommandExamples(command, [
    'prisma-next migration check',
    'prisma-next migration check --space app',
    'prisma-next migration check 20260101-add-users',
    'prisma-next migration check --json',
  ]);
  setCommandSeeAlso(command, [
    { verb: 'migration status', oneLiner: 'Show migration path and pending status' },
    { verb: 'migration list', oneLiner: 'List on-disk migrations' },
    { verb: 'migration graph', oneLiner: 'Show the migration graph topology' },
    { verb: 'migration show', oneLiner: 'Display migration package contents' },
  ]);
  command.exitOverride();
  addGlobalOptions(command)
    .argument('[target]', 'Migration reference: directory name, hash/prefix, ref, or path')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--space <id>', 'Narrow output to a single contract space')
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
          const spaceSuffix =
            outcome.resolvedSpaceId !== undefined ? `  (space: ${outcome.resolvedSpaceId})` : '';
          ui.log(`✔ ${result.summary}${spaceSuffix}`);
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
