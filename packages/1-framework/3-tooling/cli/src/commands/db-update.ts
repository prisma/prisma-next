import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import { ContractValidationError } from '../control-api/errors';
import type { DbUpdateFailure } from '../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorJsonFormatNotSupported,
  errorMigrationPlanningFailed,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  type MigrationCommandOptions,
  maskConnectionUrl,
  setCommandDescriptions,
} from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatMigrationApplyOutput,
  formatMigrationJson,
  formatMigrationPlanOutput,
  formatStyledHeader,
  type MigrationCommandResult,
} from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';

type DbUpdateOptions = MigrationCommandOptions;

function mapDbUpdateFailure(failure: DbUpdateFailure): CliStructuredError {
  if (failure.code === 'PLANNING_FAILED') {
    return errorMigrationPlanningFailed({ conflicts: failure.conflicts ?? [] });
  }

  if (failure.code === 'MARKER_REQUIRED') {
    return errorRuntime('Database marker is required before db update', {
      why: failure.why ?? 'Contract marker not found in database',
      fix: 'Run `prisma-next db init` first to adopt the database, then re-run `prisma-next db update`',
      meta: { code: 'MARKER_REQUIRED' },
    });
  }

  if (failure.code === 'RUNNER_FAILED') {
    return errorRuntime(failure.summary, {
      why: failure.why ?? 'Migration runner failed',
      fix: 'Inspect the reported conflict, reconcile schema drift if needed, then re-run `prisma-next db update`',
      meta: {
        code: 'RUNNER_FAILED',
        ...(failure.meta ?? {}),
      },
    });
  }

  const exhaustive: never = failure.code;
  throw new Error(`Unhandled DbUpdateFailure code: ${exhaustive}`);
}

async function executeDbUpdateCommand(
  options: DbUpdateOptions,
  flags: GlobalFlags,
  startTime: number,
): Promise<Result<MigrationCommandResult, CliStructuredError>> {
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';
  const contractPathAbsolute = config.contract?.output
    ? resolve(config.contract.output)
    : resolve('src/prisma/contract.json');
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  if (flags.json !== 'object' && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'contract', value: contractPath },
    ];
    if (options.db) {
      details.push({ label: 'database', value: maskConnectionUrl(options.db) });
    }
    if (options.plan) {
      details.push({ label: 'mode', value: 'plan (dry run)' });
    }
    const header = formatStyledHeader({
      command: 'db update',
      description: 'Reconcile a marker-managed database to the current contract',
      url: 'https://pris.ly/db-update',
      details,
      flags,
    });
    console.log(header);
  }

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

  let contractJson: Record<string, unknown>;
  try {
    contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
  } catch (error) {
    return notOk(
      errorContractValidationFailed(
        `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        { where: { path: contractPathAbsolute } },
      ),
    );
  }

  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for db update (set db.connection in ${configPath}, or pass --db <url>)`,
      }),
    );
  }

  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for db update' }));
  }

  if (!config.target.migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });
  const onProgress = createProgressAdapter({ flags });

  try {
    const result = await client.dbUpdate({
      contractIR: contractJson,
      mode: options.plan ? 'plan' : 'apply',
      connection: dbConnection,
      onProgress,
    });

    if (!result.ok) {
      return notOk(mapDbUpdateFailure(result.failure));
    }

    const dbUpdateResult: MigrationCommandResult = {
      ok: true,
      mode: result.value.mode,
      plan: {
        targetId: config.target.targetId,
        destination: {
          storageHash: result.value.destination.storageHash,
          ...ifDefined('profileHash', result.value.destination.profileHash),
        },
        operations: result.value.plan.operations.map((op) => ({
          id: op.id,
          label: op.label,
          operationClass: op.operationClass,
        })),
      },
      origin: {
        storageHash: result.value.origin.storageHash,
        ...ifDefined('profileHash', result.value.origin.profileHash),
      },
      ...(result.value.execution
        ? {
            execution: {
              operationsPlanned: result.value.execution.operationsPlanned,
              operationsExecuted: result.value.execution.operationsExecuted,
            },
          }
        : {}),
      ...(result.value.marker
        ? {
            marker: {
              storageHash: result.value.marker.storageHash,
              ...ifDefined('profileHash', result.value.marker.profileHash),
            },
          }
        : {}),
      summary: result.value.summary,
      timings: { total: Date.now() - startTime },
    };

    return ok(dbUpdateResult);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }

    if (error instanceof ContractValidationError) {
      return notOk(
        errorContractValidationFailed(`Contract validation failed: ${error.message}`, {
          where: { path: contractPathAbsolute },
        }),
      );
    }

    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db update: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createDbUpdateCommand(): Command {
  const command = new Command('update');
  setCommandDescriptions(
    command,
    'Reconcile a marker-managed database to the current contract',
    'Updates a marker-managed database to match your emitted contract using additive,\n' +
      'widening, and destructive operations when required. Requires an existing contract marker.\n' +
      'Use --plan to preview operations before applying.',
  );
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--plan', 'Preview planned operations without applying', false)
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbUpdateOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      if (flags.json === 'ndjson') {
        const result = notOk(
          errorJsonFormatNotSupported({
            command: 'db update',
            format: 'ndjson',
            supportedFormats: ['object'],
          }),
        );
        const exitCode = handleResult(result, flags);
        process.exit(exitCode);
      }

      const result = await executeDbUpdateCommand(options, flags, startTime);
      const exitCode = handleResult(result, flags, (dbUpdateResult) => {
        if (flags.json === 'object') {
          console.log(formatMigrationJson(dbUpdateResult));
        } else {
          const output =
            dbUpdateResult.mode === 'plan'
              ? formatMigrationPlanOutput(dbUpdateResult, flags)
              : formatMigrationApplyOutput(dbUpdateResult, flags);
          if (output) {
            console.log(output);
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
