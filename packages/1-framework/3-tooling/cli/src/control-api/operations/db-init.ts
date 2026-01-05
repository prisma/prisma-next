import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlan,
  MigrationPlannerResult,
  MigrationPlanOperation,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@prisma-next/core-control-plane/types';
import { notOk, ok } from '@prisma-next/utils/result';
import type { DbInitResult, DbInitSuccess, OnControlProgress } from '../types';

/**
 * Options for executing dbInit operation.
 */
export interface ExecuteDbInitOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId>;
  readonly contractIR: ContractIR;
  readonly mode: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Executes the dbInit operation.
 *
 * This is the core logic extracted from the CLI command, without any file I/O,
 * process.exit(), or console output. It uses the Result pattern to return
 * success or failure details.
 *
 * @param options - The options for executing dbInit
 * @returns Result with DbInitSuccess on success, DbInitFailure on failure
 */
export async function executeDbInit<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbInitOptions<TFamilyId, TTargetId>,
): Promise<DbInitResult> {
  const { driver, familyInstance, contractIR, mode, migrations, frameworkComponents, onProgress } =
    options;

  // Create planner and runner from target migrations capability
  const planner = migrations.createPlanner(familyInstance);
  const runner = migrations.createRunner(familyInstance);

  // Introspect live schema
  const introspectSpanId = 'introspect';
  onProgress?.({
    action: 'dbInit',
    kind: 'spanStart',
    spanId: introspectSpanId,
    label: 'Introspecting database schema',
  });
  const schemaIR = await familyInstance.introspect({ driver });
  onProgress?.({
    action: 'dbInit',
    kind: 'spanEnd',
    spanId: introspectSpanId,
    outcome: 'ok',
  });

  // Policy for init mode (additive only)
  const policy = { allowedOperationClasses: ['additive'] as const };

  // Plan migration
  const planSpanId = 'plan';
  onProgress?.({
    action: 'dbInit',
    kind: 'spanStart',
    spanId: planSpanId,
    label: 'Planning migration',
  });
  const plannerResult: MigrationPlannerResult = await planner.plan({
    contract: contractIR,
    schema: schemaIR,
    policy,
    frameworkComponents,
  });

  if (plannerResult.kind === 'failure') {
    onProgress?.({
      action: 'dbInit',
      kind: 'spanEnd',
      spanId: planSpanId,
      outcome: 'error',
    });
    return notOk({
      code: 'PLANNING_FAILED' as const,
      summary: 'Migration planning failed due to conflicts',
      conflicts: plannerResult.conflicts,
      why: undefined,
      meta: undefined,
    });
  }

  const migrationPlan: MigrationPlan = plannerResult.plan;
  onProgress?.({
    action: 'dbInit',
    kind: 'spanEnd',
    spanId: planSpanId,
    outcome: 'ok',
  });

  // Check for existing marker - handle idempotency and mismatch errors
  const checkMarkerSpanId = 'checkMarker';
  onProgress?.({
    action: 'dbInit',
    kind: 'spanStart',
    spanId: checkMarkerSpanId,
    label: 'Checking contract marker',
  });
  const existingMarker = await familyInstance.readMarker({ driver });
  if (existingMarker) {
    const markerMatchesDestination =
      existingMarker.coreHash === migrationPlan.destination.coreHash &&
      (!migrationPlan.destination.profileHash ||
        existingMarker.profileHash === migrationPlan.destination.profileHash);

    if (markerMatchesDestination) {
      // Already at destination - return success with no operations
      onProgress?.({
        action: 'dbInit',
        kind: 'spanEnd',
        spanId: checkMarkerSpanId,
        outcome: 'skipped',
      });
      const result: DbInitSuccess = {
        mode,
        plan: { operations: [] },
        ...(mode === 'apply'
          ? {
              execution: { operationsPlanned: 0, operationsExecuted: 0 },
              marker: {
                coreHash: existingMarker.coreHash,
                profileHash: existingMarker.profileHash,
              },
            }
          : {}),
        summary: 'Database already at target contract state',
      };
      return ok(result);
    }

    // Marker exists but doesn't match destination - fail
    onProgress?.({
      action: 'dbInit',
      kind: 'spanEnd',
      spanId: checkMarkerSpanId,
      outcome: 'error',
    });
    return notOk({
      code: 'MARKER_ORIGIN_MISMATCH' as const,
      summary: 'Existing contract marker does not match plan destination',
      marker: {
        coreHash: existingMarker.coreHash,
        profileHash: existingMarker.profileHash,
      },
      destination: {
        coreHash: migrationPlan.destination.coreHash,
        profileHash: migrationPlan.destination.profileHash,
      },
      why: undefined,
      conflicts: undefined,
      meta: undefined,
    });
  }

  onProgress?.({
    action: 'dbInit',
    kind: 'spanEnd',
    spanId: checkMarkerSpanId,
    outcome: 'ok',
  });

  // Plan mode - don't execute
  if (mode === 'plan') {
    const result: DbInitSuccess = {
      mode: 'plan',
      plan: { operations: migrationPlan.operations },
      summary: `Planned ${migrationPlan.operations.length} operation(s)`,
    };
    return ok(result);
  }

  // Apply mode - execute runner
  const applySpanId = 'apply';
  onProgress?.({
    action: 'dbInit',
    kind: 'spanStart',
    spanId: applySpanId,
    label: 'Applying migration plan',
  });

  const callbacks = onProgress
    ? {
        onOperationStart: (op: MigrationPlanOperation) => {
          onProgress({
            action: 'dbInit',
            kind: 'spanStart',
            spanId: `operation:${op.id}`,
            parentSpanId: applySpanId,
            label: op.label,
          });
        },
        onOperationComplete: (op: MigrationPlanOperation) => {
          onProgress({
            action: 'dbInit',
            kind: 'spanEnd',
            spanId: `operation:${op.id}`,
            outcome: 'ok',
          });
        },
      }
    : undefined;

  const runnerResult: MigrationRunnerResult = await runner.execute({
    plan: migrationPlan,
    driver,
    destinationContract: contractIR,
    policy,
    ...(callbacks ? { callbacks } : {}),
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
    onProgress?.({
      action: 'dbInit',
      kind: 'spanEnd',
      spanId: applySpanId,
      outcome: 'error',
    });
    return notOk({
      code: 'RUNNER_FAILED' as const,
      summary: runnerResult.failure.summary,
      why: runnerResult.failure.why,
      meta: runnerResult.failure.meta,
      conflicts: undefined,
    });
  }

  const execution = runnerResult.value;

  onProgress?.({
    action: 'dbInit',
    kind: 'spanEnd',
    spanId: applySpanId,
    outcome: 'ok',
  });

  const result: DbInitSuccess = {
    mode: 'apply',
    plan: { operations: migrationPlan.operations },
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
  };
  return ok(result);
}
