import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import {
  type ControlDriverInstance,
  type ControlFamilyInstance,
  INIT_ADDITIVE_POLICY,
  type MigrationPlan,
  type MigrationPlannerResult,
  type MigrationRunnerResult,
  type TargetMigrationsCapability,
} from '@prisma-next/core-control-plane/types';
import { notOk, ok } from '@prisma-next/utils/result';
import type { DbInitResult } from '../types';

/**
 * Options for executeDbInit.
 */
export interface ExecuteDbInitOptions {
  readonly driver: ControlDriverInstance<string, string>;
  readonly familyInstance: ControlFamilyInstance<string>;
  readonly contractIR: ContractIR;
  readonly mode: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<string, string, ControlFamilyInstance<string>>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>;
}

/**
 * Executes the dbInit operation.
 *
 * This is the core logic extracted from the db-init CLI command, without:
 * - File I/O (reading contract files)
 * - Console output (formatters, spinners)
 * - CLI error handling (structured CLI errors)
 * - Process exit codes
 *
 * Domain failures (planning conflicts, marker mismatches, runner failures) are returned
 * as NotOk results. Infrastructure failures (database connection errors) are thrown.
 *
 * @param options - Options for the dbInit operation
 * @returns Result with DbInitSuccess on success, DbInitFailure on domain failure
 * @throws Error for infrastructure failures (e.g., connection errors)
 */
export async function executeDbInit(options: ExecuteDbInitOptions): Promise<DbInitResult> {
  const { driver, familyInstance, contractIR, mode, migrations, frameworkComponents } = options;

  // Create planner and runner from target migrations capability
  const planner = migrations.createPlanner(familyInstance);
  const runner = migrations.createRunner(familyInstance);

  // Introspect live schema
  const schemaIR = await familyInstance.introspect({ driver });

  // Policy for init mode (additive only)
  const policy = INIT_ADDITIVE_POLICY;

  // Plan migration
  const plannerResult: MigrationPlannerResult = planner.plan({
    contract: contractIR,
    schema: schemaIR,
    policy,
    frameworkComponents,
  });

  if (plannerResult.kind === 'failure') {
    return notOk({
      code: 'PLANNING_FAILED' as const,
      summary: `Migration planning failed: ${plannerResult.conflicts.map((c) => `${c.kind}: ${c.summary}`).join('; ')}`,
      conflicts: plannerResult.conflicts,
    });
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
      return ok({
        mode,
        plan: { operations: [] },
        ...(mode === 'apply'
          ? {
              execution: { operationsPlanned: 0, operationsExecuted: 0 },
              marker: {
                coreHash: existingMarker.coreHash,
                ...(existingMarker.profileHash ? { profileHash: existingMarker.profileHash } : {}),
              },
            }
          : {}),
        summary: 'Database already at target contract state',
      });
    }

    // Marker exists but doesn't match destination - return failure
    return notOk({
      code: 'MARKER_ORIGIN_MISMATCH' as const,
      summary: 'Existing contract marker does not match plan destination',
      marker: {
        coreHash: existingMarker.coreHash,
        ...(existingMarker.profileHash ? { profileHash: existingMarker.profileHash } : {}),
      },
      destination: {
        coreHash: migrationPlan.destination.coreHash,
        ...(migrationPlan.destination.profileHash
          ? { profileHash: migrationPlan.destination.profileHash }
          : {}),
      },
    });
  }

  // Plan mode - don't execute
  if (mode === 'plan') {
    return ok({
      mode: 'plan' as const,
      plan: {
        operations: migrationPlan.operations.map((op) => ({
          id: op.id,
          label: op.label,
          operationClass: op.operationClass,
        })),
      },
      summary: `Planned ${migrationPlan.operations.length} operation(s)`,
    });
  }

  // Apply mode - execute runner
  const runnerResult: MigrationRunnerResult = await runner.execute({
    plan: migrationPlan,
    driver,
    destinationContract: contractIR,
    policy,
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
    return notOk({
      code: 'RUNNER_FAILED' as const,
      summary: `Migration runner failed: ${runnerResult.failure.summary}`,
    });
  }

  const execution = runnerResult.value;

  return ok({
    mode: 'apply' as const,
    plan: {
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
  });
}
