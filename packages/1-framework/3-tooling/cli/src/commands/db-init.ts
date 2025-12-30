import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ControlDriverInstance, FamilyInstance } from '@prisma-next/core-control-plane/types';
import type { Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import {
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorFileNotFound,
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
import { performAction } from '../utils/result';
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

// ---------------------------------------------------------------------------
// Local migration types (duck-typed)
//
// These types capture the structural contracts for migration planner/runner
// without adding them to the core SPI. This is a partial migration that will
// be completed in task 7.3 (see agent-os/specs/2025-12-05-db-init-command/tasks.md)
// which will move these types to @prisma-next/core-control-plane and make
// migration support an explicit optional target capability.
// See also: agent-os/specs/2025-12-05-db-init-command/planning/migration-cli-base-types.plan.md
// ---------------------------------------------------------------------------

interface MigrationPlanOperation {
  readonly id: string;
  readonly label: string;
  readonly operationClass: string;
}

interface MigrationPlan {
  readonly targetId: string;
  readonly destination: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly operations: readonly MigrationPlanOperation[];
}

interface PlannerConflict {
  readonly kind: string;
  readonly summary: string;
  readonly why?: string;
}

interface PlannerSuccessResult {
  readonly kind: 'success';
  readonly plan: MigrationPlan;
}

interface PlannerFailureResult {
  readonly kind: 'failure';
  readonly conflicts: readonly PlannerConflict[];
}

type PlannerResult = PlannerSuccessResult | PlannerFailureResult;

interface RunnerSuccessValue {
  readonly operationsPlanned: number;
  readonly operationsExecuted: number;
}

interface RunnerFailureDetails {
  readonly code: string;
  readonly summary: string;
  readonly why?: string;
}

type RunnerResult = Result<RunnerSuccessValue, RunnerFailureDetails>;

interface MigrationPlanner {
  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: { readonly allowedOperationClasses: readonly string[] };
  }): PlannerResult;
}

interface MigrationRunner {
  execute(options: {
    readonly plan: MigrationPlan;
    readonly driver: ControlDriverInstance;
    readonly destinationContract: unknown;
    readonly policy: { readonly allowedOperationClasses: readonly string[] };
    readonly callbacks?: {
      onOperationStart?(op: MigrationPlanOperation): void;
      onOperationComplete?(op: MigrationPlanOperation): void;
    };
  }): Promise<RunnerResult>;
}

interface MigrationSupportTarget {
  createPlanner: (family: unknown) => MigrationPlanner;
  createRunner: (family: unknown) => MigrationRunner;
}

function hasMigrationSupport(target: unknown): target is MigrationSupportTarget {
  return (
    typeof target === 'object' &&
    target !== null &&
    Object.hasOwn(target, 'createPlanner') &&
    typeof (target as Record<string, unknown>)['createPlanner'] === 'function' &&
    Object.hasOwn(target, 'createRunner') &&
    typeof (target as Record<string, unknown>)['createRunner'] === 'function'
  );
}

export function createDbInitCommand(): Command {
  const command = new Command('init');
  setCommandDescriptions(
    command,
    'Bootstrap a database to match the current contract and write the contract marker',
    'Initializes a database to match your emitted contract using additive-only operations.\n' +
      'Creates tables, columns, indexes, and constraints defined in your contract.\n' +
      'Writes a contract marker to track the database state. This operation is idempotent.\n' +
      '\n' +
      'Currently supports empty databases only. Use --plan to preview changes without applying.',
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
    .option('--json [format]', 'Output as JSON (object or ndjson)', false)
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
          throw errorUnexpected(error instanceof Error ? error.message : String(error), {
            why: `Failed to parse contract JSON at ${contractPathAbsolute}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }

        // Resolve database URL
        const dbUrl = options.db ?? config.db?.url;
        if (!dbUrl) {
          throw errorDatabaseUrlRequired({ why: 'Database URL is required for db init' });
        }

        // Check for driver
        if (!config.driver) {
          throw errorDriverRequired({ why: 'Config.driver is required for db init' });
        }
        const driverDescriptor = config.driver;

        // Check target supports migrations
        if (!hasMigrationSupport(config.target)) {
          throw errorTargetMigrationNotSupported({
            why: `Target "${config.target.id}" does not support migrations (missing createPlanner/createRunner)`,
          });
        }

        // Create driver
        const driver = await withSpinner(() => driverDescriptor.create(dbUrl), {
          message: 'Connecting to database...',
          flags,
        });

        try {
          // Create family instance
          const familyInstance = config.family.create({
            target: config.target,
            adapter: config.adapter,
            driver: driverDescriptor,
            extensions: config.extensions ?? [],
          });
          const typedFamilyInstance = familyInstance as FamilyInstance<string>;

          // Validate contract
          const contractIR = typedFamilyInstance.validateContractIR(contractJson) as ContractIR;

          // Create planner and runner from target (typed via local interfaces)
          const planner = config.target.createPlanner(familyInstance);
          const runner = config.target.createRunner(familyInstance);

          // Introspect live schema
          const schemaIR = await withSpinner(() => typedFamilyInstance.introspect({ driver }), {
            message: 'Introspecting database schema...',
            flags,
          });

          // Policy for init mode (additive only)
          const policy = { allowedOperationClasses: ['additive'] as const };

          // Plan migration
          const plannerResult = await withSpinner(
            () =>
              Promise.resolve(
                planner.plan({
                  contract: contractIR,
                  schema: schemaIR,
                  policy,
                }),
              ),
            {
              message: 'Planning migration...',
              flags,
            },
          );

          if (plannerResult.kind === 'failure') {
            throw errorMigrationPlanningFailed({ conflicts: plannerResult.conflicts });
          }

          const migrationPlan = plannerResult.plan;

          // Add blank line after spinners
          if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
            console.log('');
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

          const runnerResult = await withSpinner(
            () =>
              runner.execute({
                plan: migrationPlan,
                driver,
                destinationContract: contractIR,
                policy,
                callbacks,
              }),
            {
              message: 'Applying migration plan...',
              flags,
            },
          );

          if (!runnerResult.ok) {
            throw errorRuntime(runnerResult.failure.summary, {
              why:
                runnerResult.failure.why ?? `Migration runner failed: ${runnerResult.failure.code}`,
              meta: { code: runnerResult.failure.code },
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
