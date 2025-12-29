import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ControlDriverInstance, FamilyInstance } from '@prisma-next/core-control-plane/types';
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

/**
 * Duck-type check for SqlControlTargetDescriptor with migration support.
 */
interface MigrationSupportTarget {
  createPlanner: (family: unknown) => unknown;
  createRunner: (family: unknown) => unknown;
}

function hasMigrationSupport(target: unknown): target is MigrationSupportTarget {
  return (
    typeof target === 'object' &&
    target !== null &&
    'createPlanner' in target &&
    typeof (target as Record<string, unknown>)['createPlanner'] === 'function' &&
    'createRunner' in target &&
    typeof (target as Record<string, unknown>)['createRunner'] === 'function'
  );
}

export interface DbInitResult {
  readonly ok: boolean;
  readonly mode: 'plan' | 'apply';
  readonly plan?: {
    readonly targetId: string;
    readonly destination: {
      readonly coreHash: string;
      readonly profileHash?: string;
    };
    readonly operations: readonly {
      readonly id: string;
      readonly label: string;
      readonly operationClass: string;
    }[];
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly summary: string;
  readonly timings: {
    readonly total: number;
  };
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

          // Create planner and runner from target
          const planner = config.target.createPlanner(familyInstance);
          const runner = config.target.createRunner(familyInstance);

          // Introspect live schema
          const schemaIR = await withSpinner(() => typedFamilyInstance.introspect({ driver }), {
            message: 'Introspecting database schema...',
            flags,
          });

          // Import policy from family-sql (duck-typed, family-agnostic)
          const policy = { allowedOperationClasses: ['additive'] as const };

          // Plan migration
          const plannerResult = (planner as { plan: (opts: unknown) => unknown }).plan({
            contract: contractIR,
            schema: schemaIR,
            policy,
          }) as { kind: 'success' | 'failure'; plan?: unknown; conflicts?: unknown[] };

          if (plannerResult.kind === 'failure') {
            const conflicts = (plannerResult.conflicts ?? []) as Array<{
              kind: string;
              summary: string;
            }>;
            throw errorMigrationPlanningFailed({ conflicts });
          }

          // TODO: this is an indication that the migration CLI commands are SQL specific. Their types are leaking into the CLI. Will be addressed in 7.3 in agent-os/specs/2025-12-05-db-init-command/tasks.md
          const migrationPlan = plannerResult.plan as {
            targetId: string;
            destination: { coreHash: string; profileHash?: string };
            operations: readonly {
              id: string;
              label: string;
              operationClass: string;
            }[];
          };

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
            onOperationStart: (op: { label: string }) => {
              if (!flags.quiet && flags.json !== 'object') {
                console.log(`  → ${op.label}...`);
              }
            },
            onOperationComplete: (_op: { label: string }) => {
              // Could log completion if needed
            },
          };

          const runnerResult = await withSpinner(
            async () => {
              return (
                runner as {
                  execute: (opts: unknown) => Promise<{
                    ok: boolean;
                    value?: { operationsPlanned: number; operationsExecuted: number };
                    failure?: { code: string; summary: string };
                  }>;
                }
              ).execute({
                plan: migrationPlan,
                driver: driver as ControlDriverInstance,
                destinationContract: contractIR,
                policy,
                callbacks,
              });
            },
            {
              message: 'Applying migration plan...',
              flags,
            },
          );

          if (!runnerResult.ok) {
            const failure = runnerResult.failure as { code: string; summary: string; why?: string };
            throw errorRuntime(failure.summary, {
              why: failure.why ?? `Migration runner failed: ${failure.code}`,
              meta: { code: failure.code },
            });
          }

          const execution = runnerResult.value!;

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
