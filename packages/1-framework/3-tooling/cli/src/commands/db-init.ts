import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { redactDatabaseUrl } from '@prisma-next/utils/redact-db-url';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import { performAction } from '../utils/action';
import {
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
import { parseGlobalFlags } from '../utils/global-flags';
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

      const result = await performAction(async () => {
        if (flags.json === 'ndjson') {
          throw errorJsonFormatNotSupported({
            command: 'db init',
            format: 'ndjson',
            supportedFormats: ['object'],
          });
        }

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
            throw errorFileNotFound(contractPathAbsolute, {
              why: `Contract file not found at ${contractPathAbsolute}`,
              fix: `Run \`prisma-next contract emit\` to generate ${contractPath}, or update \`config.contract.output\` in ${configPath}`,
            });
          }
          throw errorUnexpected(error instanceof Error ? error.message : String(error), {
            why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
          });
        }

        let contractJson: Record<string, unknown>;
        try {
          contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
        } catch (error) {
          throw errorContractValidationFailed(
            `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
            { where: { path: contractPathAbsolute } },
          );
        }

        // Resolve database connection (--db flag or config.db.connection)
        const dbConnection = options.db ?? config.db?.connection;
        if (!dbConnection) {
          throw errorDatabaseConnectionRequired({
            why: `Database connection is required for db init (set db.connection in ${configPath}, or pass --db <url>)`,
          });
        }

        // Check for driver
        if (!config.driver) {
          throw errorDriverRequired({ why: 'Config.driver is required for db init' });
        }

        // Check target supports migrations via the migrations capability
        if (!config.target.migrations) {
          throw errorTargetMigrationNotSupported({
            why: `Target "${config.target.id}" does not support migrations`,
          });
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

          // Map control-api DbInitResult to CLI output format
          if (!result.ok) {
            const failure = result.failure;
            // Map failures to CLI structured errors
            if (failure.code === 'PLANNING_FAILED') {
              throw errorMigrationPlanningFailed({ conflicts: failure.conflicts ?? [] });
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

              throw errorRuntime(
                `Existing contract marker does not match plan destination.${mismatchParts.length > 0 ? ` Mismatch in ${mismatchParts.join(' and ')}.` : ''}`,
                {
                  why: 'Database has an existing contract marker that does not match the target contract',
                  fix: 'If bootstrapping, drop/reset the database then re-run `prisma-next db init`; otherwise reconcile schema/marker using your migration workflow',
                  meta: {
                    code: 'MARKER_ORIGIN_MISMATCH',
                    ...(failure.marker?.coreHash
                      ? { markerCoreHash: failure.marker.coreHash }
                      : {}),
                    ...(failure.destination?.coreHash
                      ? { destinationCoreHash: failure.destination.coreHash }
                      : {}),
                    ...(failure.marker?.profileHash
                      ? { markerProfileHash: failure.marker.profileHash }
                      : {}),
                    ...(failure.destination?.profileHash
                      ? { destinationProfileHash: failure.destination.profileHash }
                      : {}),
                  },
                },
              );
            }

            if (failure.code === 'RUNNER_FAILED') {
              throw errorRuntime(failure.summary, {
                why: 'Migration runner failed',
                fix: 'Fix the schema mismatch (db init is additive-only), or drop/reset the database and re-run `prisma-next db init`',
                meta: {
                  code: 'RUNNER_FAILED',
                },
              });
            }

            // Fallback for unknown failure codes
            throw errorRuntime(failure.summary, {
              why: `db init failed: ${failure.code}`,
              meta: {
                code: failure.code,
              },
            });
          }

          // Convert success result to CLI output format
          // Note: control-api DbInitSuccess doesn't include targetId/destination in plan,
          // but CLI output format expects it. We'll need to get this from the migration plan
          // if available, or omit it for now.
          const profileHash = result.value.marker?.profileHash;
          const dbInitResult: DbInitResult = {
            ok: true,
            mode: result.value.mode,
            plan: {
              targetId: '', // Not available in control-api result
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

          return dbInitResult;
        } catch (error) {
          // Handle connection errors with specific formatting
          const message = error instanceof Error ? error.message : String(error);
          const code = (error as { code?: unknown }).code;

          // Check if this is a connection error (thrown during connect phase)
          // Connection errors typically have codes like ECONNREFUSED, ENOTFOUND, etc.
          const isConnectionError =
            typeof code === 'string' &&
            ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH'].includes(code);

          if (isConnectionError) {
            // Only redact if connection is a string (URL)
            const redacted =
              typeof dbConnection === 'string' ? redactDatabaseUrl(dbConnection) : undefined;
            throw errorRuntime('Database connection failed', {
              why: message,
              fix: 'Verify the database connection, ensure the database is reachable, and confirm credentials/permissions',
              meta: {
                ...(typeof code !== 'undefined' ? { code } : {}),
                ...(redacted ?? {}),
              },
            });
          }

          // Re-throw other errors
          throw error;
        } finally {
          await client.close();
        }
      });

      // Handle result
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
