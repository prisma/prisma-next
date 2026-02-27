import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { ContractValidationError } from '../control-api/errors';
import type { DbUpdateFailure } from '../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorDestructiveChanges,
  errorJsonFormatNotSupported,
  errorMarkerRequired,
  errorMigrationPlanningFailed,
  errorRunnerFailed,
  errorUnexpected,
} from '../utils/cli-errors';
import type { MigrationCommandOptions } from '../utils/command-helpers';
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  addMigrationCommandOptions,
  prepareMigrationContext,
} from '../utils/migration-command-scaffold';
import {
  formatCommandHelp,
  formatMigrationApplyOutput,
  formatMigrationJson,
  formatMigrationPlanOutput,
  type MigrationCommandResult,
} from '../utils/output';
import { handleResult } from '../utils/result-handler';

type DbUpdateOptions = MigrationCommandOptions & {
  readonly acceptDataLoss?: boolean;
};

/**
 * Maps a DbUpdateFailure to a CliStructuredError for consistent error handling.
 */
function mapDbUpdateFailure(failure: DbUpdateFailure): CliStructuredError {
  if (failure.code === 'PLANNING_FAILED') {
    return errorMigrationPlanningFailed({ conflicts: failure.conflicts ?? [] });
  }

  if (failure.code === 'MARKER_REQUIRED') {
    return errorMarkerRequired({
      why: failure.why ?? 'Contract marker not found in database',
      fix: 'Run `prisma-next db init` first to sign the database, then re-run `prisma-next db update`',
    });
  }

  if (failure.code === 'RUNNER_FAILED') {
    return errorRunnerFailed(failure.summary, {
      why: failure.why ?? 'Migration runner failed',
      fix: 'Inspect the reported conflict, reconcile schema drift if needed, then re-run `prisma-next db update`',
      ...(failure.meta ? { meta: failure.meta } : {}),
    });
  }

  if (failure.code === 'DESTRUCTIVE_CHANGES') {
    return errorDestructiveChanges(failure.summary, {
      ...(failure.why ? { why: failure.why } : {}),
      fix: 'Use `prisma-next db update --plan` to preview, then re-run with `--accept-data-loss` to apply destructive changes',
      ...(failure.meta ? { meta: failure.meta } : {}),
    });
  }

  const exhaustive: never = failure.code;
  throw new Error(`Unhandled DbUpdateFailure code: ${exhaustive}`);
}

/**
 * Executes the db update command and returns a structured Result.
 */
async function executeDbUpdateCommand(
  options: DbUpdateOptions,
  flags: GlobalFlags,
  startTime: number,
): Promise<Result<MigrationCommandResult, CliStructuredError>> {
  // Prepare shared migration context (config, contract, connection, client)
  const ctxResult = await prepareMigrationContext(options, flags, {
    commandName: 'db update',
    description: 'Reconcile a marker-managed database to the current contract',
    url: 'https://pris.ly/db-update',
  });
  if (!ctxResult.ok) {
    return ctxResult;
  }
  const { client, contractJson, dbConnection, onProgress, contractPathAbsolute } = ctxResult.value;

  try {
    // Call dbUpdate with connection and progress callback
    const result = await client.dbUpdate({
      contractIR: contractJson,
      mode: options.plan ? 'plan' : 'apply',
      connection: dbConnection,
      ...(options.acceptDataLoss ? { acceptDataLoss: true } : {}),
      onProgress,
    });

    // Handle failures by mapping to CLI structured error
    if (!result.ok) {
      return notOk(mapDbUpdateFailure(result.failure));
    }

    // Convert success result to CLI output format
    const dbUpdateResult: MigrationCommandResult = {
      ok: true,
      mode: result.value.mode,
      plan: {
        targetId: ctxResult.value.config.target.targetId,
        destination: {
          storageHash: result.value.destination.storageHash,
          ...ifDefined('profileHash', result.value.destination.profileHash),
        },
        operations: result.value.plan.operations.map((op) => ({
          id: op.id,
          label: op.label,
          operationClass: op.operationClass,
        })),
        ...(result.value.plan.sql !== undefined ? { sql: result.value.plan.sql } : {}),
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
  addMigrationCommandOptions(command);
  command.option(
    '--accept-data-loss',
    'Confirm destructive operations (required when plan includes drops or type changes)',
    false,
  );
  command.configureHelp({
    formatHelp: (cmd) => {
      const flags = parseGlobalFlags({});
      return formatCommandHelp({ command: cmd, flags });
    },
  });
  command.action(async (options: DbUpdateOptions) => {
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
