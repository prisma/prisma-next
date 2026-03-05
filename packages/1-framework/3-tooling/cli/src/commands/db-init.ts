import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { ContractValidationError } from '../control-api/errors';
import type { DbInitFailure } from '../control-api/types';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorMigrationPlanningFailed,
  errorRunnerFailed,
  errorRuntime,
  errorUnexpected,
} from '../utils/cli-errors';
import type { MigrationCommandOptions } from '../utils/command-helpers';
import { sanitizeErrorMessage, setCommandDescriptions } from '../utils/command-helpers';
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
import { TerminalUI } from '../utils/terminal-ui';

type DbInitOptions = MigrationCommandOptions;

/**
 * Maps a DbInitFailure to a CliStructuredError for consistent error handling.
 */
function mapDbInitFailure(failure: DbInitFailure): CliStructuredError {
  if (failure.code === 'PLANNING_FAILED') {
    return errorMigrationPlanningFailed({ conflicts: failure.conflicts ?? [] });
  }

  if (failure.code === 'MARKER_ORIGIN_MISMATCH') {
    const mismatchParts: string[] = [];
    if (
      failure.marker?.storageHash !== failure.destination?.storageHash &&
      failure.marker?.storageHash &&
      failure.destination?.storageHash
    ) {
      mismatchParts.push(
        `storageHash (marker: ${failure.marker.storageHash}, destination: ${failure.destination.storageHash})`,
      );
    }
    if (
      failure.marker?.profileHash !== failure.destination?.profileHash &&
      failure.marker?.profileHash &&
      failure.destination?.profileHash
    ) {
      mismatchParts.push(
        `profileHash (marker: ${failure.marker.profileHash}, destination: ${failure.destination.profileHash})`,
      );
    }

    return errorRuntime(
      `Existing database signature does not match plan destination.${mismatchParts.length > 0 ? ` Mismatch in ${mismatchParts.join(' and ')}.` : ''}`,
      {
        why: 'Database has an existing signature (marker) that does not match the target contract',
        fix: 'If bootstrapping, drop/reset the database then re-run `prisma-next db init`; otherwise reconcile schema/marker using your migration workflow',
        meta: {
          code: 'MARKER_ORIGIN_MISMATCH',
          ...ifDefined('markerStorageHash', failure.marker?.storageHash),
          ...ifDefined('destinationStorageHash', failure.destination?.storageHash),
          ...ifDefined('markerProfileHash', failure.marker?.profileHash),
          ...ifDefined('destinationProfileHash', failure.destination?.profileHash),
        },
      },
    );
  }

  if (failure.code === 'RUNNER_FAILED') {
    return errorRunnerFailed(failure.summary, {
      why: failure.why ?? 'Migration runner failed',
      fix: 'Fix the schema mismatch (db init is additive-only), or drop/reset the database and re-run `prisma-next db init`',
      ...(failure.meta
        ? { meta: { code: 'RUNNER_FAILED', ...failure.meta } }
        : { meta: { code: 'RUNNER_FAILED' } }),
    });
  }

  // Exhaustive check - TypeScript will error if a new code is added but not handled
  const exhaustive: never = failure.code;
  throw new Error(`Unhandled DbInitFailure code: ${exhaustive}`);
}

/**
 * Executes the db init command and returns a structured Result.
 */
async function executeDbInitCommand(
  options: DbInitOptions,
  flags: GlobalFlags,
  startTime: number,
): Promise<Result<MigrationCommandResult, CliStructuredError>> {
  // Prepare shared migration context (config, contract, connection, client)
  const ctxResult = await prepareMigrationContext(options, flags, {
    commandName: 'db init',
    description: 'Bootstrap a database to match the current contract',
    url: 'https://pris.ly/db-init',
  });
  if (!ctxResult.ok) {
    return ctxResult;
  }
  const { client, contractJson, dbConnection, onProgress, contractPathAbsolute } = ctxResult.value;

  try {
    // Call dbInit with connection and progress callback
    const result = await client.dbInit({
      contractIR: contractJson,
      mode: options.plan ? 'plan' : 'apply',
      connection: dbConnection,
      onProgress,
    });

    // Handle failures by mapping to CLI structured error
    if (!result.ok) {
      return notOk(mapDbInitFailure(result.failure));
    }

    // Convert success result to CLI output format
    const dbInitResult: MigrationCommandResult = {
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

    return ok(dbInitResult);
  } catch (error) {
    // Driver already throws CliStructuredError for connection failures
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
        why: `Unexpected error during db init: ${safeMessage}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createDbInitCommand(): Command {
  const command = new Command('init');
  setCommandDescriptions(
    command,
    'Bootstrap a database to match the current contract and sign it',
    'Initializes a database to match your emitted contract using additive-only operations.\n' +
      'Creates any missing tables, columns, indexes, and constraints defined in your contract.\n' +
      'Leaves existing compatible structures in place, surfaces conflicts when destructive changes\n' +
      'would be required, and signs the database to track contract state. Use --plan to\n' +
      'preview changes without applying.',
  );
  addMigrationCommandOptions(command);
  command.configureHelp({
    formatHelp: (cmd) => {
      const flags = parseGlobalFlags({});
      return formatCommandHelp({ command: cmd, flags });
    },
  });
  command.action(async (options: DbInitOptions) => {
    const flags = parseGlobalFlags(options);
    const startTime = Date.now();

    const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

    const result = await executeDbInitCommand(options, flags, startTime);

    const exitCode = handleResult(result, flags, (dbInitResult) => {
      if (flags.json) {
        ui.output(formatMigrationJson(dbInitResult));
      } else {
        const output =
          dbInitResult.mode === 'plan'
            ? formatMigrationPlanOutput(dbInitResult, flags)
            : formatMigrationApplyOutput(dbInitResult, flags);
        if (output) {
          ui.log(output);
        }
      }
    });

    process.exit(exitCode);
  });

  return command;
}
