import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { findLeaf, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { join } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
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
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { formatCommandHelp, formatStyledHeader } from '../utils/output';
import { handleResult } from '../utils/result-handler';

interface MigrationPlanOptions {
  readonly config?: string;
  readonly name?: string;
  readonly from?: string;
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

export interface MigrationPlanResult {
  readonly ok: boolean;
  readonly noOp: boolean;
  readonly from: string;
  readonly to: string;
  readonly edgeId?: string;
  readonly dir?: string;
  readonly operations: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly summary: string;
  readonly timings: {
    readonly total: number;
  };
}

interface MigrationToolsErrorLike extends Error {
  readonly code: string;
  readonly why: string;
  readonly fix: string;
  readonly details?: Record<string, unknown>;
}

function isMigrationToolsError(error: unknown): error is MigrationToolsErrorLike {
  return (
    error instanceof Error &&
    error.name === 'MigrationToolsError' &&
    'code' in error &&
    typeof (error as unknown as Record<string, unknown>)['code'] === 'string'
  );
}

function mapMigrationToolsError(error: unknown): CliStructuredError {
  if (isMigrationToolsError(error)) {
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
  startTime: number,
): Promise<Result<MigrationPlanResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  const migrationsDir = resolve(
    options.config ? resolve(options.config, '..') : process.cwd(),
    config.migrations?.dir ?? 'migrations',
  );
  const migrationsRelative = relative(process.cwd(), migrationsDir);

  const contractPathAbsolute = config.contract?.output
    ? resolve(config.contract.output)
    : resolve('src/prisma/contract.json');
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  if (flags.json !== 'object' && !flags.quiet) {
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
    console.log(header);
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
    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leafHash = findLeaf(graph);

    if (options.from) {
      fromHash = options.from;
      const sourcePkg = packages.find((p) => p.manifest.to === fromHash);
      if (sourcePkg) {
        fromContract = sourcePkg.manifest.toContract;
      }
    } else if (leafHash !== EMPTY_CONTRACT_HASH) {
      fromHash = leafHash;
      const leafPkg = packages.find((p) => p.manifest.to === leafHash);
      if (leafPkg) {
        fromContract = leafPkg.manifest.toContract;
      }
    }
  } catch (error) {
    if (isMigrationToolsError(error)) {
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

  // Check target supports contract diffing
  if (!config.target.migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  // Diff contracts
  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    extensionPacks: config.extensionPacks ?? [],
  });

  const diffResult = client.contractDiff(fromContract, toContractJson);

  if (diffResult.kind === 'failure') {
    return notOk(
      errorMigrationPlanningFailed({
        conflicts: diffResult.conflicts as readonly CliErrorConflict[],
      }),
    );
  }

  const ops: readonly MigrationPlanOperation[] = diffResult.ops;

  if (ops.length === 0) {
    const result: MigrationPlanResult = {
      ok: true,
      noOp: true,
      from: fromHash,
      to: toStorageHash,
      operations: [],
      summary: 'No operations needed',
      timings: { total: Date.now() - startTime },
    };
    return ok(result);
  }

  // Build manifest and write migration package
  const timestamp = new Date();
  const slug = options.name ?? 'migration';
  const dirName = formatMigrationDirName(timestamp, slug);
  const packageDir = join(migrationsDir, dirName);

  const manifest: MigrationManifest = {
    from: fromHash,
    to: toStorageHash,
    edgeId: null,
    kind: 'regular',
    fromContract,
    toContract: toContractJson,
    hints: {
      used: [],
      applied: ['additive_only'],
      plannerVersion: '1.0.0',
      planningStrategy: 'additive',
    },
    labels: [],
    createdAt: timestamp.toISOString(),
  };

  try {
    await writeMigrationPackage(packageDir, manifest, ops);
    const edgeId = await attestMigration(packageDir);

    const result: MigrationPlanResult = {
      ok: true,
      noOp: false,
      from: fromHash,
      to: toStorageHash,
      edgeId,
      dir: relative(process.cwd(), packageDir),
      operations: ops.map((op) => ({ id: op.id, label: op.label })),
      summary: `Planned ${ops.length} operation(s)`,
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
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--name <slug>', 'Name slug for the migration directory', 'migration')
    .option('--from <hash>', 'Explicit starting contract hash (overrides DAG leaf)')
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: MigrationPlanOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      const result = await executeMigrationPlanCommand(options, flags, startTime);

      const exitCode = handleResult(result, flags, (planResult) => {
        if (flags.json === 'object') {
          console.log(JSON.stringify(planResult, null, 2));
        } else if (!flags.quiet) {
          console.log(formatMigrationPlanOutput(planResult, flags));
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
    for (let i = 0; i < result.operations.length; i++) {
      const op = result.operations[i]!;
      const isLast = i === result.operations.length - 1;
      const treeChar = isLast ? '└' : '├';
      lines.push(`${dim_(treeChar)}─ ${op.id} ${dim_(`[${op.label}]`)}`);
    }
    lines.push('');
  }

  lines.push(dim_(`from:   ${result.from}`));
  lines.push(dim_(`to:     ${result.to}`));
  if (result.edgeId) {
    lines.push(dim_(`edgeId: ${result.edgeId}`));
  }
  if (result.dir) {
    lines.push(dim_(`dir:    ${result.dir}`));
  }

  if (flags.verbose && result.timings) {
    lines.push('');
    lines.push(dim_(`Total time: ${result.timings.total}ms`));
  }

  return lines.join('\n');
}
