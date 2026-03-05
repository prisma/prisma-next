import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { ContractValidationError } from '../control-api/errors';
import type { DbUpdateFailure } from '../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorDestructiveChanges,
  errorMigrationPlanningFailed,
  errorRunnerFailed,
  errorUnexpected,
} from '../utils/cli-errors';
import type { MigrationCommandOptions } from '../utils/command-helpers';
import {
  sanitizeErrorMessage,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  addMigrationCommandOptions,
  prepareMigrationContext,
} from '../utils/migration-command-scaffold';
import {
  formatMigrationApplyOutput,
  formatMigrationJson,
  formatMigrationPlanOutput,
  type MigrationCommandResult,
} from '../utils/output';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

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

  if (failure.code === 'RUNNER_FAILED') {
    return errorRunnerFailed(failure.summary, {
      why: failure.why ?? 'Migration runner failed',
      fix: 'Inspect the reported conflict, reconcile schema drift if needed, then re-run `prisma-next db update`',
      ...ifDefined('meta', failure.meta),
    });
  }

  if (failure.code === 'DESTRUCTIVE_CHANGES') {
    return errorDestructiveChanges(failure.summary, {
      ...ifDefined('why', failure.why),
      fix: 'Use `prisma-next db update --plan` to preview, then re-run with `--accept-data-loss` to apply destructive changes',
      ...ifDefined('meta', failure.meta),
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
  ui: TerminalUI,
  startTime: number,
): Promise<Result<MigrationCommandResult, CliStructuredError>> {
  // Prepare shared migration context (config, contract, connection, client)
  const ctxResult = await prepareMigrationContext(options, flags, ui, {
    commandName: 'db update',
    description: 'Update your database schema to match your contract',
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
        ...ifDefined('sql', result.value.plan.sql),
      },
      ...ifDefined(
        'execution',
        result.value.execution
          ? {
              operationsPlanned: result.value.execution.operationsPlanned,
              operationsExecuted: result.value.execution.operationsExecuted,
            }
          : undefined,
      ),
      ...ifDefined(
        'marker',
        result.value.marker
          ? {
              storageHash: result.value.marker.storageHash,
              ...ifDefined('profileHash', result.value.marker.profileHash),
            }
          : undefined,
      ),
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

    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeMessage = sanitizeErrorMessage(
      rawMessage,
      typeof dbConnection === 'string' ? dbConnection : undefined,
    );
    return notOk(
      errorUnexpected(safeMessage, {
        why: `Unexpected error during db update: ${safeMessage}`,
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
    'Update your database schema to match your contract',
    'Compares your database schema to the emitted contract and applies the necessary\n' +
      'changes. Works on any database, whether or not it has been initialized with `db init`.\n' +
      'Use --plan to preview operations before applying.',
  );
  setCommandExamples(command, [
    'prisma-next db update --db $DATABASE_URL',
    'prisma-next db update --db $DATABASE_URL --plan',
  ]);
  addMigrationCommandOptions(command);
  command.option(
    '--accept-data-loss',
    'Confirm destructive operations (required when plan includes drops or type changes)',
    false,
  );
  command.action(async (options: DbUpdateOptions) => {
    const flags = parseGlobalFlags(options);
    const startTime = Date.now();

    const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

    const result = await executeDbUpdateCommand(options, flags, ui, startTime);
    const exitCode = handleResult(result, flags, (dbUpdateResult) => {
      if (flags.json) {
        ui.output(formatMigrationJson(dbUpdateResult));
      } else {
        const output =
          dbUpdateResult.mode === 'plan'
            ? formatMigrationPlanOutput(dbUpdateResult, flags)
            : formatMigrationApplyOutput(dbUpdateResult, flags);
        if (output) {
          ui.log(output);
        }
      }
    });
    process.exit(exitCode);
  });

  return command;
}
