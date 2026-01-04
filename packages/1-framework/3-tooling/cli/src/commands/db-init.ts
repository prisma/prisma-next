import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type {
  MigrationPlan,
  MigrationPlannerResult,
  MigrationPlanOperation,
  MigrationRunnerResult,
} from '@prisma-next/core-control-plane/types';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/types';
import { redactDatabaseUrl } from '@prisma-next/utils/redact-db-url';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
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
import {
  assertContractRequirementsSatisfied,
  assertFrameworkComponentsCompatible,
} from '../utils/framework-components';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  type DbInitResult,
  formatCommandHelp,
  formatDbInitApplyOutput,
  formatDbInitJson,
  formatDbInitPlanOutput,
  formatStyledHeader,
} from '../utils/output';
import { handleResult } from '../utils/result-handler';
import { withSpinner } from '../utils/spinner';

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
        const driverDescriptor = config.driver;

        // Check target supports migrations via the migrations capability
        if (!config.target.migrations) {
          throw errorTargetMigrationNotSupported({
            why: `Target "${config.target.id}" does not support migrations`,
          });
        }
        const migrations = config.target.migrations;

        // Create driver - the connection type is driver-specific (e.g., string URL for Postgres)
        // but config.db.connection is typed as unknown. Cast required for contravariance.
        let driver: Awaited<ReturnType<(typeof driverDescriptor)['create']>>;
        try {
          // biome-ignore lint/suspicious/noExplicitAny: required for runtime connection type flexibility
          driver = await withSpinner(() => driverDescriptor.create(dbConnection as any), {
            message: 'Connecting to database...',
            flags,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = (error as { code?: unknown }).code;
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

        try {
          // Create family instance
          const stack = createControlPlaneStack({
            target: config.target,
            adapter: config.adapter,
            driver: driverDescriptor,
            extensionPacks: config.extensionPacks,
          });
          const familyInstance = config.family.create(stack);
          const rawComponents = [config.target, config.adapter, ...(config.extensionPacks ?? [])];
          const frameworkComponents = assertFrameworkComponentsCompatible(
            config.family.familyId,
            config.target.targetId,
            rawComponents,
          );

          // Validate contract
          const contractIR = familyInstance.validateContractIR(contractJson);
          assertContractRequirementsSatisfied({ contract: contractIR, stack });

          // Create planner and runner from target migrations capability
          const planner = migrations.createPlanner(familyInstance);
          const runner = migrations.createRunner(familyInstance);

          // Introspect live schema
          const schemaIR = await withSpinner(() => familyInstance.introspect({ driver }), {
            message: 'Introspecting database schema...',
            flags,
          });

          // Policy for init mode (additive only)
          const policy = { allowedOperationClasses: ['additive'] as const };

          // Plan migration
          const plannerResult: MigrationPlannerResult = await withSpinner(
            async () =>
              planner.plan({
                contract: contractIR,
                schema: schemaIR,
                policy,
                frameworkComponents,
              }),
            {
              message: 'Planning migration...',
              flags,
            },
          );

          if (plannerResult.kind === 'failure') {
            throw errorMigrationPlanningFailed({ conflicts: plannerResult.conflicts });
          }

          const migrationPlan: MigrationPlan = plannerResult.plan;

          // Check for existing marker - handle idempotency and mismatch errors
          const existingMarker = await familyInstance.readMarker({ driver });
          if (existingMarker) {
            const markerMatchesDestination =
              existingMarker.coreHash === migrationPlan.destination.coreHash &&
              (!migrationPlan.destination.profileHash ||
                existingMarker.profileHash === migrationPlan.destination.profileHash);

            if (markerMatchesDestination) {
              // Already at destination - return success with no operations
              const dbInitResult: DbInitResult = {
                ok: true,
                mode: options.plan ? 'plan' : 'apply',
                plan: {
                  targetId: migrationPlan.targetId,
                  destination: migrationPlan.destination,
                  operations: [],
                },
                ...(options.plan
                  ? {}
                  : {
                      execution: { operationsPlanned: 0, operationsExecuted: 0 },
                      marker: {
                        coreHash: existingMarker.coreHash,
                        profileHash: existingMarker.profileHash,
                      },
                    }),
                summary: 'Database already at target contract state',
                timings: { total: Date.now() - startTime },
              };
              return dbInitResult;
            }

            // Marker exists but doesn't match destination - fail
            const coreHashMismatch = existingMarker.coreHash !== migrationPlan.destination.coreHash;
            const profileHashMismatch =
              migrationPlan.destination.profileHash &&
              existingMarker.profileHash !== migrationPlan.destination.profileHash;

            const mismatchParts: string[] = [];
            if (coreHashMismatch) {
              mismatchParts.push(
                `coreHash (marker: ${existingMarker.coreHash}, destination: ${migrationPlan.destination.coreHash})`,
              );
            }
            if (profileHashMismatch) {
              mismatchParts.push(
                `profileHash (marker: ${existingMarker.profileHash}, destination: ${migrationPlan.destination.profileHash})`,
              );
            }

            throw errorRuntime(
              `Existing contract marker does not match plan destination. Mismatch in ${mismatchParts.join(' and ')}.`,
              {
                why: 'Database has an existing contract marker that does not match the target contract',
                fix: 'If bootstrapping, drop/reset the database then re-run `prisma-next db init`; otherwise reconcile schema/marker using your migration workflow',
                meta: {
                  code: 'MARKER_ORIGIN_MISMATCH',
                  markerCoreHash: existingMarker.coreHash,
                  destinationCoreHash: migrationPlan.destination.coreHash,
                  ...(existingMarker.profileHash
                    ? { markerProfileHash: existingMarker.profileHash }
                    : {}),
                  ...(migrationPlan.destination.profileHash
                    ? { destinationProfileHash: migrationPlan.destination.profileHash }
                    : {}),
                },
              },
            );
          }

          // Plan mode - don't execute
          if (options.plan) {
            const dbInitResult: DbInitResult = {
              ok: true,
              mode: 'plan',
              plan: {
                targetId: migrationPlan.targetId,
                destination: migrationPlan.destination,
                operations: migrationPlan.operations.map((op) => ({
                  id: op.id,
                  label: op.label,
                  operationClass: op.operationClass,
                })),
              },
              summary: `Planned ${migrationPlan.operations.length} operation(s)`,
              timings: { total: Date.now() - startTime },
            };
            return dbInitResult;
          }

          // Apply mode - execute runner
          // Log main message once, then show individual operations via callbacks
          if (!flags.quiet && flags.json !== 'object') {
            console.log('Applying migration plan and verifying schema...');
          }

          const callbacks = {
            onOperationStart: (op: MigrationPlanOperation) => {
              if (!flags.quiet && flags.json !== 'object') {
                console.log(`  → ${op.label}...`);
              }
            },
            onOperationComplete: (_op: MigrationPlanOperation) => {
              // Could log completion if needed
            },
          };

          const runnerResult: MigrationRunnerResult = await runner.execute({
            plan: migrationPlan,
            driver,
            destinationContract: contractIR,
            policy,
            callbacks,
            // db init plans and applies back-to-back from a fresh introspection, so per-operation
            // pre/postchecks and the idempotency probe are usually redundant overhead. We still
            // enforce marker/origin compatibility and a full schema verification after apply.
            executionChecks: {
              prechecks: false,
              postchecks: false,
              idempotencyChecks: false,
            },
            frameworkComponents,
          });

          if (!runnerResult.ok) {
            const meta: Record<string, unknown> = {
              code: runnerResult.failure.code,
              ...(runnerResult.failure.meta ?? {}),
            };
            const sqlState = typeof meta['sqlState'] === 'string' ? meta['sqlState'] : undefined;
            const fix =
              sqlState === '42501'
                ? 'Grant the database user sufficient privileges (insufficient_privilege), or run db init as a more privileged role'
                : runnerResult.failure.code === 'SCHEMA_VERIFY_FAILED'
                  ? 'Fix the schema mismatch (db init is additive-only), or drop/reset the database and re-run `prisma-next db init`'
                  : undefined;

            throw errorRuntime(runnerResult.failure.summary, {
              why:
                runnerResult.failure.why ?? `Migration runner failed: ${runnerResult.failure.code}`,
              ...(fix ? { fix } : {}),
              meta,
            });
          }

          const execution = runnerResult.value;

          const dbInitResult: DbInitResult = {
            ok: true,
            mode: 'apply',
            plan: {
              targetId: migrationPlan.targetId,
              destination: migrationPlan.destination,
              operations: migrationPlan.operations.map((op) => ({
                id: op.id,
                label: op.label,
                operationClass: op.operationClass,
              })),
            },
            execution: {
              operationsPlanned: execution.operationsPlanned,
              operationsExecuted: execution.operationsExecuted,
            },
            marker: migrationPlan.destination.profileHash
              ? {
                  coreHash: migrationPlan.destination.coreHash,
                  profileHash: migrationPlan.destination.profileHash,
                }
              : { coreHash: migrationPlan.destination.coreHash },
            summary: `Applied ${execution.operationsExecuted} operation(s), marker written`,
            timings: { total: Date.now() - startTime },
          };
          return dbInitResult;
        } finally {
          await driver.close();
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
