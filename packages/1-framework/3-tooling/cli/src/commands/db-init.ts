import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import type { DbInitFailure } from '../control-api/types';
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
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  type DbInitResult,
  formatCommandHelp,
  formatDbInitApplyOutput,
  formatDbInitJson,
  formatDbInitPlanOutput,
  formatStyledHeader,
} from '../utils/output';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';

interface DbInitOptions {
  readonly db?: string;
  readonly config?: string;
  readonly plan?: boolean;
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
      failure.marker?.coreHash !== failure.destination?.coreHash &&
      failure.marker?.coreHash &&
      failure.destination?.coreHash
    ) {
      mismatchParts.push(
        `coreHash (marker: ${failure.marker.coreHash}, destination: ${failure.destination.coreHash})`,
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
      `Existing contract marker does not match plan destination.${mismatchParts.length > 0 ? ` Mismatch in ${mismatchParts.join(' and ')}.` : ''}`,
      {
        why: 'Database has an existing contract marker that does not match the target contract',
        fix: 'If bootstrapping, drop/reset the database then re-run `prisma-next db init`; otherwise reconcile schema/marker using your migration workflow',
        meta: {
          code: 'MARKER_ORIGIN_MISMATCH',
          ...(failure.marker?.coreHash ? { markerCoreHash: failure.marker.coreHash } : {}),
          ...(failure.destination?.coreHash
            ? { destinationCoreHash: failure.destination.coreHash }
            : {}),
          ...(failure.marker?.profileHash ? { markerProfileHash: failure.marker.profileHash } : {}),
          ...(failure.destination?.profileHash
            ? { destinationProfileHash: failure.destination.profileHash }
            : {}),
        },
      },
    );
  }

  if (failure.code === 'RUNNER_FAILED') {
    return errorRuntime(failure.summary, {
      why: failure.why ?? 'Migration runner failed',
      fix: 'Fix the schema mismatch (db init is additive-only), or drop/reset the database and re-run `prisma-next db init`',
      meta: {
        code: 'RUNNER_FAILED',
        ...(failure.meta ?? {}),
      },
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
): Promise<Result<DbInitResult, CliStructuredError>> {
  // Load config
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';
  const contractPathAbsolute = config.contract?.output
    ? resolve(config.contract.output)
    : resolve('src/prisma/contract.json');
  const contractPath = relative(process.cwd(), contractPathAbsolute);

  // Output header
  if (flags.json !== 'object' && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
      { label: 'contract', value: contractPath },
    ];
    if (options.db) {
      details.push({ label: 'database', value: options.db });
    }
    if (options.plan) {
      details.push({ label: 'mode', value: 'plan (dry run)' });
    }
    const header = formatStyledHeader({
      command: 'db init',
      description: 'Bootstrap a database to match the current contract',
      url: 'https://pris.ly/db-init',
      details,
      flags,
    });
    console.log(header);
  }

  // Load contract file
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

  // Resolve database connection (--db flag or config.db.connection)
  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for db init (set db.connection in ${configPath}, or pass --db <url>)`,
      }),
    );
  }

  // Check for driver
  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for db init' }));
  }

  // Check target supports migrations via the migrations capability
  if (!config.target.migrations) {
    return notOk(
      errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      }),
    );
  }

  // Create control client
  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });

  // Create progress adapter
  const onProgress = createProgressAdapter({ flags });

  try {
    // Call dbInit with connection and progress callback
    // Connection happens inside dbInit with a 'connect' progress span
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
    const profileHash = result.value.marker?.profileHash;
    const dbInitResult: DbInitResult = {
      ok: true,
      mode: result.value.mode,
      plan: {
        targetId: config.target.targetId,
        destination: {
          coreHash: result.value.marker?.coreHash ?? '',
          ...(profileHash ? { profileHash } : {}),
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
              coreHash: result.value.marker.coreHash,
              ...(result.value.marker.profileHash
                ? { profileHash: result.value.marker.profileHash }
                : {}),
            },
          }
        : {}),
      summary: result.value.summary,
      timings: { total: Date.now() - startTime },
    };

    return ok(dbInitResult);
  } catch (error) {
    // Driver already throws CliStructuredError for connection failures
    // Use static type guard to work across module boundaries
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }

    // Wrap unexpected errors
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db init: ${error instanceof Error ? error.message : String(error)}`,
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
    'Bootstrap a database to match the current contract and write the contract marker',
    'Initializes a database to match your emitted contract using additive-only operations.\n' +
      'Creates any missing tables, columns, indexes, and constraints defined in your contract.\n' +
      'Leaves existing compatible structures in place, surfaces conflicts when destructive changes\n' +
      'would be required, and writes a contract marker to track the database state. Use --plan to\n' +
      'preview changes without applying.',
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
    .action(async (options: DbInitOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      // Validate JSON format option
      if (flags.json === 'ndjson') {
        const result = notOk(
          errorJsonFormatNotSupported({
            command: 'db init',
            format: 'ndjson',
            supportedFormats: ['object'],
          }),
        );
        const exitCode = handleResult(result, flags);
        process.exit(exitCode);
      }

      const result = await executeDbInitCommand(options, flags, startTime);

      const exitCode = handleResult(result, flags, (dbInitResult) => {
        if (flags.json === 'object') {
          console.log(formatDbInitJson(dbInitResult));
        } else {
          const output =
            dbInitResult.mode === 'plan'
              ? formatDbInitPlanOutput(dbInitResult, flags)
              : formatDbInitApplyOutput(dbInitResult, flags);
          if (output) {
            console.log(output);
          }
        }
      });

      process.exit(exitCode);
    });

  return command;
}
