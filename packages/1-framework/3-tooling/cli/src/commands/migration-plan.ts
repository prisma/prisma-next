import { readFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { getEmittedArtifactPaths } from '@prisma-next/emitter';
import {
  createControlStack,
  hasOperationPreview,
  type MigrationPlanOperation,
  type OperationPreview,
} from '@prisma-next/framework-components/control';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { deriveProvidedInvariants } from '@prisma-next/migration-tools/invariants';
import {
  copyFilesWithRename,
  formatMigrationDirName,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { findLatestMigration } from '@prisma-next/migration-tools/migration-graph';
import { writeMigrationTs } from '@prisma-next/migration-tools/migration-ts';
import { parseContractRef } from '@prisma-next/migration-tools/ref-resolution';
import { readRefs } from '@prisma-next/migration-tools/refs';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { join, relative } from 'pathe';
import { loadConfig } from '../config-loader';
import {
  type CliErrorConflict,
  CliStructuredError,
  errorContractValidationFailed,
  errorFileNotFound,
  errorMigrationPlanningFailed,
  errorTargetMigrationNotSupported,
  errorUnexpected,
  mapMigrationToolsError,
  mapRefResolutionError,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  getTargetMigrations,
  loadMigrationPackages,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { buildContractSpaceAggregate } from '../utils/contract-space-aggregate-loader';
import { runContractSpaceSeedPhase } from '../utils/contract-space-seed-phase';
import { toExtensionInputs } from '../utils/extension-pack-inputs';
import { formatStyledHeader } from '../utils/formatters/styled';
import { assertFrameworkComponentsCompatible } from '../utils/framework-components';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationPlanOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly name?: string;
  readonly from?: string;
}

/**
 * Load a predecessor migration's destination contract from its sibling
 * `end-contract.json` on disk. The manifest no longer inlines the
 * contract; the planner reads it from the canonical on-disk artefact
 * authored by a previous `migration plan` run.
 *
 * Throws `CliStructuredError` with `errorFileNotFound` when the
 * sibling file is missing — the user has likely deleted or never
 * authored the snapshot, and the message names the file and points
 * them at re-emitting from the source.
 */
async function readPredecessorEndContract(migrationDir: string): Promise<Contract> {
  const path = join(migrationDir, 'end-contract.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      throw errorFileNotFound(path, {
        why: `Predecessor migration is missing its destination contract snapshot at ${path}`,
        fix: 'Re-emit the predecessor migration (`prisma-next migration plan` from its source) so its sibling `end-contract.json` is restored, then re-run this command.',
      });
    }
    throw error;
  }
  return JSON.parse(raw) as Contract;
}

export interface MigrationPlanResult {
  readonly ok: boolean;
  readonly noOp: boolean;
  readonly from: string | null;
  readonly to: string;
  readonly dir?: string;
  /**
   * Extension-space migration packages materialised onto disk during this
   * `plan` run. Each entry names a `migrations/<spaceId>/<dirName>/`
   * tree the framework wrote alongside the app-space migration directory.
   * Empty when the project has no extension packs declaring a contract
   * space, or when every extension-space package is already on disk.
   *
   * Surfacing these in the result (rather than only via `ui.step` log
   * lines) makes the cross-space side effect explicit to JSON consumers
   * and the success-summary renderer — the same multi-space side effect
   * that `migration apply` will replay.
   */
  readonly emittedExtensionDirs: readonly { readonly spaceId: string; readonly dirName: string }[];
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  /**
   * Family-agnostic textual preview of the migration plan operations.
   * Replaces the previous `sql?: readonly string[]` field; consumers should
   * read `result.preview?.statements`.
   */
  readonly preview?: OperationPreview;
  readonly summary: string;
  /**
   * When true, `migration.ts` was written but contains unfilled
   * `placeholder(...)` calls. The user must edit the file and then run
   * `node migration.ts` to self-emit `ops.json` / `migration.json`.
   */
  readonly pendingPlaceholders?: boolean;
  readonly timings: {
    readonly total: number;
  };
}

async function executeMigrationPlanCommand(
  options: MigrationPlanOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<MigrationPlanResult, CliStructuredError>> {
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
    if (options.from) {
      details.push({ label: 'from', value: options.from });
    }
    if (options.name) {
      details.push({ label: 'name', value: options.name });
    }
    const header = formatStyledHeader({
      command: 'migration plan',
      description: 'Plan a migration from contract changes',
      url: 'https://pris.ly/migration-plan',
      details,
      flags,
    });
    ui.stderr(header);
  }

  // Load contract file (the "to" contract)
  let contractJsonContent: string;
  try {
    contractJsonContent = await readFile(contractPathAbsolute, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return notOk(
        errorFileNotFound(contractPathAbsolute, {
          why: `Contract file not found at ${contractPathAbsolute}`,
          fix: `Run \`prisma-next contract emit\` to generate ${contractPath}, or update \`config.contract.output\` in ${configPath}`,
        }),
      );
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }

  let toContractJson: Contract;
  try {
    toContractJson = JSON.parse(contractJsonContent) as Contract;
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  const rawStorageHash = toContractJson.storage?.storageHash;
  if (typeof rawStorageHash !== 'string') {
    return notOk(
      errorContractValidationFailed('Contract is missing storageHash', {
        where: { path: contractPathAbsolute },
      }),
    );
  }
  const toStorageHash = rawStorageHash;

  // Read existing migrations and determine "from" contract
  let fromContract: Contract | null = null;
  let fromHash: string | null = null;
  let fromContractSourceDir: string | null = null;

  try {
    const { bundles, graph } = await loadMigrationPackages(appMigrationsDir);

    if (options.from) {
      const refs = await readRefs(resolveMigrationPaths(options.config, config).refsDir);
      const refResult = parseContractRef(options.from, { graph, refs });
      if (!refResult.ok) {
        return notOk(mapRefResolutionError(refResult.failure));
      }
      fromHash = refResult.value.hash;
      const matchingBundle = bundles.find((p) => p.metadata.to === fromHash);
      if (matchingBundle) {
        fromContractSourceDir = matchingBundle.dirPath;
        fromContract = await readPredecessorEndContract(fromContractSourceDir);
      }
    } else {
      const latestMigration = findLatestMigration(graph);
      if (latestMigration) {
        fromHash = latestMigration.to;
        const leafPkg = bundles.find(
          (p) => p.metadata.migrationHash === latestMigration.migrationHash,
        );
        if (leafPkg) {
          fromContractSourceDir = leafPkg.dirPath;
          fromContract = await readPredecessorEndContract(fromContractSourceDir);
        }
      }
    }
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    // `readPredecessorEndContract` raises a `CliStructuredError` directly
    // for the missing-snapshot case so the operator gets a precise
    // why/fix; pass it through unchanged rather than re-wrapping.
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    // Wrap unexpected (non-MigrationToolsError) failures from the migration
    // load phase in a structured CLI envelope. Letting them throw would
    // bypass `handleResult()` and crash the command — see CLI structured-
    // errors guideline (CliStructuredError + Result pattern).
    const message = error instanceof Error ? error.message : String(error);
    return notOk(
      errorUnexpected(message, {
        why: `Unexpected error while loading migrations: ${message}`,
      }),
    );
  }

  // Phase 1 — seed: unconditionally re-emit per-space pinned artefacts
  // (contract.json / contract.d.ts / refs/head.json) and materialise any
  // descriptor-shipped migration packages not yet on disk. Runs before
  // the no-op check so that an extension bump alone (with no structural
  // app-space change) still re-pins extension artefacts on disk.
  const canonicalExtensionInputs = toExtensionInputs(config.extensionPacks ?? []);
  const seedResult = await runContractSpaceSeedPhase({
    migrationsDir,
    extensionPacks: canonicalExtensionInputs,
  });
  if (!flags.json && !flags.quiet) {
    for (const record of seedResult.seeded) {
      if (record.action === 'updated') {
        const pkgSuffix =
          record.newMigrationDirs.length > 0
            ? `; ${record.newMigrationDirs.length} new migration package(s) materialised`
            : '';
        ui.step(`Updated ${record.spaceId} to ${record.newHash}${pkgSuffix}`);
      }
    }
  }
  const emittedExtensionDirs = seedResult.seeded.flatMap((r) =>
    r.newMigrationDirs.map((dirName) => ({ spaceId: r.spaceId, dirName })),
  );

  // Check for no-op (same hash means no changes)
  if (fromHash === toStorageHash) {
    const result: MigrationPlanResult = {
      ok: true,
      noOp: true,
      from: fromHash,
      to: toStorageHash,
      operations: [],
      emittedExtensionDirs,
      summary: 'No changes detected between contracts',
      timings: { total: Date.now() - startTime },
    };
    return ok(result);
  }

  // Check target supports migrations
  const migrations = getTargetMigrations(config.target);
  if (!migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  // Phase 2 — load: build the aggregate against the now-consistent disk
  // state that phase 1 just seeded. The seed phase guarantees every
  // declared extension has its head ref pinned, so the loader's
  // declaredButUnmigrated precheck always passes here.
  const stack = createControlStack(config);
  const familyInstance = config.family.create(stack);
  let validatedAppContract: Contract;
  try {
    validatedAppContract = familyInstance.validateContract(toContractJson);
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract validation failed: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }
  const aggregateResult = await buildContractSpaceAggregate({
    targetId: config.target.targetId,
    migrationsDir,
    appContract: validatedAppContract,
    extensionPacks: config.extensionPacks ?? [],
    validateContract: (json: unknown) => familyInstance.validateContract(json),
  });
  if (!aggregateResult.ok) {
    return notOk(aggregateResult.failure);
  }
  const aggregate = aggregateResult.value;

  const frameworkComponents = assertFrameworkComponentsCompatible(
    config.family.familyId,
    config.target.targetId,
    [config.target, config.adapter, ...(config.extensionPacks ?? [])],
  );

  // Build manifest and write migration package
  const timestamp = new Date();
  const slug = options.name ?? 'migration';
  const dirName = formatMigrationDirName(timestamp, slug);
  const packageDir = join(appMigrationsDir, dirName);

  const baseMetadata: Omit<MigrationMetadata, 'migrationHash' | 'providedInvariants'> = {
    from: fromHash,
    to: toStorageHash,
    hints: {
      used: [],
      applied: [],
      plannerVersion: '2.0.0',
    },
    labels: [],
    createdAt: timestamp.toISOString(),
  };

  try {
    const planner = migrations.createPlanner(familyInstance);
    const fromSchema = migrations.contractToSchema(fromContract, frameworkComponents);
    const plannerResult = planner.plan({
      contract: aggregate.app.contract,
      schema: fromSchema,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
      fromContract,
      frameworkComponents,
      spaceId: aggregate.app.spaceId,
    });
    if (plannerResult.kind === 'failure') {
      return notOk(
        errorMigrationPlanningFailed({
          conflicts: plannerResult.conflicts as readonly CliErrorConflict[],
        }),
      );
    }

    // Accessing .operations triggers toOp() on each call. If any call
    // is a DataTransformCall with an unfilled placeholder stub, toOp()
    // throws PN-MIG-2001. We catch that here so the migration can still
    // be scaffolded with `ops: []`; the user fills the placeholder, then
    // re-runs `node migration.ts` to attest with the real ops.
    let plannedOps: readonly MigrationPlanOperation[] = [];
    let hasPlaceholders = false;
    try {
      plannedOps = plannerResult.plan.operations;
      if (plannedOps.length === 0) {
        return notOk(
          errorMigrationPlanningFailed({
            conflicts: [
              {
                kind: 'unsupportedChange',
                summary:
                  'Contract changed but planner produced no operations. ' +
                  'This indicates unsupported or ignored changes.',
              },
            ],
          }),
        );
      }
    } catch (e) {
      if (CliStructuredError.is(e) && e.domain === 'MIG' && e.code === '2001') {
        hasPlaceholders = true;
      } else {
        throw e;
      }
    }

    const migrationTsContent = plannerResult.plan.renderTypeScript();

    // Always-attest: compute migrationHash over (metadata, ops). When
    // placeholders blocked lowering, ops is `[]` and the hash is computed
    // over the empty list — re-emitting after the user fills the placeholder
    // produces a different hash (over the real ops). This is intentional;
    // there is no on-disk "draft" state.
    const opsForWrite = hasPlaceholders ? [] : plannedOps;
    const metadataWithInvariants: Omit<MigrationMetadata, 'migrationHash'> = {
      ...baseMetadata,
      providedInvariants: deriveProvidedInvariants(opsForWrite),
    };
    const metadata: MigrationMetadata = {
      ...metadataWithInvariants,
      migrationHash: computeMigrationHash(metadataWithInvariants, opsForWrite),
    };

    await writeMigrationPackage(packageDir, metadata, opsForWrite);
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
    await writeMigrationTs(packageDir, migrationTsContent);

    if (hasPlaceholders) {
      const result: MigrationPlanResult = {
        ok: true,
        noOp: false,
        from: fromHash,
        to: toStorageHash,
        dir: relative(process.cwd(), packageDir),
        operations: [],
        emittedExtensionDirs,
        pendingPlaceholders: true,
        summary:
          'Planned migration with placeholder(s) — edit migration.ts then run `node migration.ts` to self-emit',
        timings: { total: Date.now() - startTime },
      };
      return ok(result);
    }

    const preview = hasOperationPreview(familyInstance)
      ? familyInstance.toOperationPreview(plannedOps)
      : undefined;
    const result: MigrationPlanResult = {
      ok: true,
      noOp: false,
      from: fromHash,
      to: toStorageHash,
      dir: relative(process.cwd(), packageDir),
      operations: plannedOps.map((op) => ({
        id: op.id,
        label: op.label,
        operationClass: op.operationClass,
      })),
      emittedExtensionDirs,
      ...(preview !== undefined ? { preview } : {}),
      summary: buildPlanSummary(plannedOps.length, emittedExtensionDirs.length),
      timings: { total: Date.now() - startTime },
    };
    return ok(result);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    const message = error instanceof Error ? error.message : String(error);
    return notOk(
      errorUnexpected(message, {
        why: `Unexpected error during migration plan: ${message}`,
      }),
    );
  }
}

export function createMigrationPlanCommand(): Command {
  const command = new Command('plan');
  setCommandDescriptions(
    command,
    'Plan a migration from contract changes',
    'Compares the emitted contract against the latest on-disk migration state and\n' +
      'produces a new migration package with the required operations. No database\n' +
      'connection is needed — this is a fully offline operation.',
  );
  setCommandExamples(command, [
    'prisma-next migration plan',
    'prisma-next migration plan --name add-users-table',
  ]);
  addGlobalOptions(command)
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--name <slug>', 'Name slug for the migration directory', 'migration')
    .option(
      '--from <contract>',
      'Starting contract reference (hash, prefix, ref name, or migration dir name)',
    )
    .action(async (options: MigrationPlanOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
      const result = await executeMigrationPlanCommand(options, flags, ui, startTime);

      const exitCode = handleResult(result, flags, ui, (planResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(planResult, null, 2));
        } else if (!flags.quiet) {
          ui.log(formatMigrationPlanOutput(planResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}

/**
 * Compose the success-line summary so the cross-space side effect
 * (extension-space migration packages materialised on disk during
 * this `plan` run) is visible in the top line — not just in the
 * step log above it.
 *
 * Example outputs:
 *   - `Planned 3 operation(s)` (app-space-only project)
 *   - `Planned 3 operation(s); materialised 1 extension-space migration` (one extension)
 *   - `Planned 3 operation(s); materialised 2 extension-space migrations` (two extensions)
 *
 * Locks AC3 at the summary-line level: a reader of the success line
 * can tell that something happened beyond the app space.
 */
function buildPlanSummary(plannedOpsCount: number, emittedExtensionDirsCount: number): string {
  const base = `Planned ${plannedOpsCount} operation(s)`;
  if (emittedExtensionDirsCount === 0) return base;
  const noun =
    emittedExtensionDirsCount === 1 ? 'extension-space migration' : 'extension-space migrations';
  return `${base}; materialised ${emittedExtensionDirsCount} ${noun}`;
}

export function formatMigrationPlanOutput(result: MigrationPlanResult, flags: GlobalFlags): string {
  const lines: string[] = [];
  const useColor = flags.color !== false;

  const green_ = useColor ? (s: string) => `\x1b[32m${s}\x1b[0m` : (s: string) => s;
  const yellow_ = useColor ? (s: string) => `\x1b[33m${s}\x1b[0m` : (s: string) => s;
  const dim_ = useColor ? (s: string) => `\x1b[2m${s}\x1b[0m` : (s: string) => s;

  // Renders the extension-space materialisation block + canonical apply-step
  // hint shared by the no-op, placeholder, and full-plan branches. The app
  // space short-circuits do not skip it: an extension-only bump emits new
  // `migrations/<spaceId>/<dirName>/` directories on disk that the user
  // still has to apply, so the success line must surface them.
  function appendEmittedExtensions(): void {
    if (result.emittedExtensionDirs.length === 0) return;
    lines.push('');
    lines.push(dim_('Emitted extension migrations:'));
    for (const entry of result.emittedExtensionDirs) {
      lines.push(dim_(`  ${entry.spaceId} → migrations/${entry.spaceId}/${entry.dirName}`));
    }
    lines.push('');
    lines.push(
      `Next: review the extension migrations above, then run ${green_('prisma-next migration apply')}.`,
    );
  }

  if (result.noOp) {
    lines.push(`${green_('✔')} No changes detected`);
    lines.push(dim_(`  from: ${result.from}`));
    lines.push(dim_(`  to:   ${result.to}`));
    appendEmittedExtensions();
    return lines.join('\n');
  }

  if (result.pendingPlaceholders) {
    lines.push(`${yellow_('⚠')} ${result.summary}`);
    lines.push('');
    lines.push(dim_(`from: ${result.from}`));
    lines.push(dim_(`to:   ${result.to}`));
    if (result.dir) {
      lines.push(dim_(`dir:  ${result.dir}`));
    }
    lines.push('');
    lines.push(
      'Open migration.ts and replace each `placeholder(...)` call with your actual query.',
    );
    lines.push(`Then run: ${green_(`node ${result.dir ?? '<dir>'}/migration.ts`)}`);
    appendEmittedExtensions();
    return lines.join('\n');
  }

  lines.push(`${green_('✔')} ${result.summary}`);
  lines.push('');

  if (result.operations.length > 0) {
    lines.push(dim_('│'));
    for (let i = 0; i < result.operations.length; i++) {
      const op = result.operations[i]!;
      const isLast = i === result.operations.length - 1;
      const treeChar = isLast ? '└' : '├';
      // operationClass tag is intentionally NOT inlined per spec:
      // a destructive footer warning still surfaces below this list.
      const destructiveMarker =
        op.operationClass === 'destructive' ? ` ${yellow_('(destructive)')}` : '';
      lines.push(`${dim_(treeChar)}─ ${op.label}${destructiveMarker}`);
    }

    const hasDestructive = result.operations.some((op) => op.operationClass === 'destructive');
    if (hasDestructive) {
      lines.push('');
      lines.push(
        `${yellow_('⚠')} This migration contains destructive operations that may cause data loss.`,
      );
    }
    lines.push('');
  }

  lines.push(dim_(`from:   ${result.from}`));
  lines.push(dim_(`to:     ${result.to}`));
  if (result.dir) {
    lines.push(dim_(`App space → ${result.dir}`));
  }
  // Per-space block: surface the extension-space directories materialised
  // alongside the app-space migration. Without this block the cross-space
  // side effect is invisible in the success summary (e2e finding F1).
  for (const entry of result.emittedExtensionDirs) {
    lines.push(
      dim_(`Extension space ${entry.spaceId} → migrations/${entry.spaceId}/${entry.dirName}`),
    );
  }

  lines.push('');
  // The "Next:" hint always points at the canonical apply path
  // (`prisma-next migration apply`) regardless of how many spaces
  // were materialised — `db update` is a dev-time convenience, not
  // the canonical replay step.
  lines.push(
    `Next: review ${green_(result.dir ?? '<dir>')} if needed, then run ${green_('prisma-next migration apply')}.`,
  );

  if (result.preview && result.preview.statements.length > 0) {
    // The non-empty length is already guaranteed by the surrounding check, so
    // a plain `every` here is equivalent to the helper in formatters/migrations.ts.
    const allSql = result.preview.statements.every((s) => s.language === 'sql');
    lines.push('');
    lines.push(dim_(allSql ? 'DDL preview' : 'Operation preview'));
    lines.push('');
    for (const statement of result.preview.statements) {
      const trimmed = statement.text.trim();
      if (!trimmed) continue;
      const line = statement.language === 'sql' && !trimmed.endsWith(';') ? `${trimmed};` : trimmed;
      lines.push(line);
    }
  }

  if (flags.verbose && result.timings) {
    lines.push('');
    lines.push(dim_(`Total time: ${result.timings.total}ms`));
  }

  return lines.join('\n');
}

export type PrefixResolutionFailure =
  | { reason: 'ambiguous'; count: number }
  | { reason: 'not-found' };

/**
 * Resolve a migration package by **target contract hash** (`metadata.to`)
 * using exact match or prefix match.
 *
 * Note: matches `metadata.to` (the contract hash this migration produces),
 * not `metadata.migrationHash` (the package's content-addressed identity).
 * Tries exact match first, then prefix match (auto-prepending `sha256:` when
 * the needle omits the scheme). Returns the matched package on success, or a
 * discriminated failure indicating whether the prefix was ambiguous or simply
 * not found.
 *
 * @internal Exported for testing only.
 */
export function resolveBundleByPrefix<T extends { metadata: { to: string } }>(
  bundles: readonly T[],
  needle: string,
): Result<T, PrefixResolutionFailure> {
  const exact = bundles.find((p) => p.metadata.to === needle);
  if (exact) return ok(exact);

  const prefixWithScheme = needle.startsWith('sha256:') ? needle : `sha256:${needle}`;
  const candidates = bundles.filter((p) => p.metadata.to.startsWith(prefixWithScheme));

  if (candidates.length === 1) return ok(candidates[0]!);
  if (candidates.length > 1) return notOk({ reason: 'ambiguous', count: candidates.length });
  return notOk({ reason: 'not-found' });
}
