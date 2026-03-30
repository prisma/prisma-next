import { readFile } from 'node:fs/promises';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { findLatestMigration } from '@prisma-next/migration-tools/dag';
import { formatMigrationDirName, writeMigrationPackage } from '@prisma-next/migration-tools/io';
import { type MigrationManifest, MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { join, relative } from 'pathe';
import { loadConfig } from '../config-loader';
import { extractSqlDdl } from '../control-api/operations/extract-sql-ddl';
import {
  type CliErrorConflict,
  type CliStructuredError,
  errorContractValidationFailed,
  errorFileNotFound,
  errorMigrationPlanningFailed,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  getTargetMigrations,
  loadMigrationBundles,
  resolveContractPath,
  resolveMigrationPaths,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
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

export interface MigrationPlanResult {
  readonly ok: boolean;
  readonly noOp: boolean;
  readonly from: string;
  readonly to: string;
  readonly migrationId?: string;
  readonly dir?: string;
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
    readonly operationClass: string;
  }[];
  readonly sql?: readonly string[];
  readonly summary: string;
  readonly timings: {
    readonly total: number;
  };
}

function mapMigrationToolsError(error: unknown): CliStructuredError {
  if (MigrationToolsError.is(error)) {
    return errorRuntime(error.message, {
      why: error.why,
      fix: error.fix,
      meta: { code: error.code, ...(error.details ?? {}) },
    });
  }
  return errorUnexpected(error instanceof Error ? error.message : String(error), {
    why: `Unexpected error during migration plan: ${error instanceof Error ? error.message : String(error)}`,
  });
}

async function executeMigrationPlanCommand(
  options: MigrationPlanOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<MigrationPlanResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const { configPath, migrationsDir, migrationsRelative } = resolveMigrationPaths(
    options.config,
    config,
  );

  const contractPathAbsolute = resolveContractPath(config);
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'contract', value: contractPath },
      { label: 'migrations', value: migrationsRelative },
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

  let toContractJson: ContractIR;
  try {
    toContractJson = JSON.parse(contractJsonContent) as ContractIR;
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  const toStorageHash = (toContractJson as unknown as Record<string, unknown>)['storageHash'] as
    | string
    | undefined;
  if (!toStorageHash) {
    return notOk(
      errorContractValidationFailed('Contract is missing storageHash', {
        where: { path: contractPathAbsolute },
      }),
    );
  }

  // Read existing migrations and determine "from" contract
  let fromContract: ContractIR | null = null;
  let fromHash: string = EMPTY_CONTRACT_HASH;

  try {
    const { bundles, graph } = await loadMigrationBundles(migrationsDir);

    if (options.from) {
      const resolved = resolveBundleByPrefix(bundles, options.from);
      if (!resolved.ok) {
        const f = resolved.failure;
        return notOk(
          f.reason === 'ambiguous'
            ? errorRuntime('Multiple matching migrations found', {
                why: `Prefix "${options.from}" matches ${f.count} migrations in ${migrationsRelative}`,
                fix: 'Provide a longer prefix to disambiguate, or omit --from to use the latest migration leaf.',
              })
            : errorRuntime('Starting contract not found', {
                why: `No migration with to hash matching "${options.from}" exists in ${migrationsRelative}`,
                fix: 'Check that the --from hash matches a known migration target hash, or omit --from to use the latest migration leaf.',
              }),
        );
      }
      fromHash = resolved.value.manifest.to;
      fromContract = resolved.value.manifest.toContract;
    } else {
      const latestMigration = findLatestMigration(graph);
      if (latestMigration) {
        fromHash = latestMigration.to;
        const leafPkg = bundles.find((p) => p.manifest.migrationId === latestMigration.migrationId);
        if (leafPkg) {
          fromContract = leafPkg.manifest.toContract;
        }
      }
    }
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(mapMigrationToolsError(error));
    }
    throw error;
  }

  // Check for no-op (same hash means no changes)
  if (fromHash === toStorageHash) {
    const result: MigrationPlanResult = {
      ok: true,
      noOp: true,
      from: fromHash,
      to: toStorageHash,
      operations: [],
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
  const stack = createControlPlaneStack({
    target: config.target,
    adapter: config.adapter,
    extensionPacks: config.extensionPacks ?? [],
  });
  const familyInstance = config.family.create(stack);
  const frameworkComponents = assertFrameworkComponentsCompatible(
    config.family.familyId,
    config.target.targetId,
    [config.target, config.adapter, ...(config.extensionPacks ?? [])],
  );
  const planner = migrations.createPlanner(familyInstance);
  const fromSchemaIR = migrations.contractToSchema(fromContract, frameworkComponents);
  const plannerResult = planner.plan({
    contract: toContractJson,
    schema: fromSchemaIR,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents,
  });

  if (plannerResult.kind === 'failure') {
    return notOk(
      errorMigrationPlanningFailed({
        conflicts: plannerResult.conflicts as readonly CliErrorConflict[],
      }),
    );
  }

  if (plannerResult.plan.operations.length === 0) {
    return notOk(
      errorMigrationPlanningFailed({
        conflicts: [
          {
            kind: 'unsupportedChange',
            summary:
              'Contract changed but planner produced no operations. ' +
              'This indicates unsupported or ignored changes (e.g. removals, type changes, or a planner/contract mismatch).',
          },
        ],
      }),
    );
  }

  // Build manifest and write migration package
  const timestamp = new Date();
  const slug = options.name ?? 'migration';
  const dirName = formatMigrationDirName(timestamp, slug);
  const packageDir = join(migrationsDir, dirName);

  const manifest: MigrationManifest = {
    from: fromHash,
    to: toStorageHash,
    migrationId: null,
    kind: 'regular',
    fromContract,
    toContract: toContractJson,
    hints: {
      used: [],
      applied: [],
      plannerVersion: '1.0.0',
      planningStrategy: 'diff',
    },
    labels: [],
    createdAt: timestamp.toISOString(),
  };

  try {
    await writeMigrationPackage(packageDir, manifest, plannerResult.plan.operations);
    const migrationId = await attestMigration(packageDir);

    const sql = extractSqlDdl(plannerResult.plan.operations);
    const result: MigrationPlanResult = {
      ok: true,
      noOp: false,
      from: fromHash,
      to: toStorageHash,
      migrationId,
      dir: relative(process.cwd(), packageDir),
      operations: plannerResult.plan.operations.map((op) => ({
        id: op.id,
        label: op.label,
        operationClass: op.operationClass,
      })),
      sql,
      summary: `Planned ${plannerResult.plan.operations.length} operation(s)`,
      timings: { total: Date.now() - startTime },
    };
    return ok(result);
  } catch (error) {
    return notOk(mapMigrationToolsError(error));
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
    .option('--from <hash>', 'Explicit starting contract hash (overrides migration chain leaf)')
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

function formatMigrationPlanOutput(result: MigrationPlanResult, flags: GlobalFlags): string {
  const lines: string[] = [];
  const useColor = flags.color !== false;

  const green_ = useColor ? (s: string) => `\x1b[32m${s}\x1b[0m` : (s: string) => s;
  const yellow_ = useColor ? (s: string) => `\x1b[33m${s}\x1b[0m` : (s: string) => s;
  const dim_ = useColor ? (s: string) => `\x1b[2m${s}\x1b[0m` : (s: string) => s;

  if (result.noOp) {
    lines.push(`${green_('✔')} No changes detected`);
    lines.push(dim_(`  from: ${result.from}`));
    lines.push(dim_(`  to:   ${result.to}`));
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
      const opClassLabel =
        op.operationClass === 'destructive'
          ? yellow_(`[${op.operationClass}]`)
          : dim_(`[${op.operationClass}]`);
      lines.push(`${dim_(treeChar)}─ ${op.label} ${opClassLabel}`);
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
  if (result.migrationId) {
    lines.push(dim_(`migrationId: ${result.migrationId}`));
  }
  if (result.dir) {
    lines.push(dim_(`dir:    ${result.dir}`));
  }

  if (result.sql && result.sql.length > 0) {
    lines.push('');
    lines.push(dim_('DDL preview'));
    lines.push('');
    for (const statement of result.sql) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      const line = trimmed.endsWith(';') ? trimmed : `${trimmed};`;
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
 * Resolve a migration bundle by exact hash or prefix match.
 *
 * Tries exact match first, then prefix match (auto-prepending `sha256:` when
 * the needle omits the scheme). Returns the matched bundle on success, or a
 * discriminated failure indicating whether the prefix was ambiguous or simply
 * not found.
 *
 * @internal Exported for testing only.
 */
export function resolveBundleByPrefix<T extends { manifest: { to: string } }>(
  bundles: readonly T[],
  needle: string,
): Result<T, PrefixResolutionFailure> {
  const exact = bundles.find((p) => p.manifest.to === needle);
  if (exact) return ok(exact);

  const prefixWithScheme = needle.startsWith('sha256:') ? needle : `sha256:${needle}`;
  const candidates = bundles.filter((p) => p.manifest.to.startsWith(prefixWithScheme));

  if (candidates.length === 1) return ok(candidates[0]!);
  if (candidates.length > 1) return notOk({ reason: 'ambiguous', count: candidates.length });
  return notOk({ reason: 'not-found' });
}
