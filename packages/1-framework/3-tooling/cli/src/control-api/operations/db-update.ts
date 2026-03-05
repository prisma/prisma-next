import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@prisma-next/core-control-plane/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import type { DbUpdateResult, DbUpdateSuccess, OnControlProgress } from '../types';
import { extractSqlDdl } from './extract-sql-ddl';
import { createOperationCallbacks, stripOperations } from './migration-helpers';

// F12: db update allows additive, widening, and destructive operations.
const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
} as const;

/**
 * Options for the executeDbUpdate operation.
 * Config-agnostic: receives pre-resolved driver, family, contract, and migrations capability.
 */
export interface ExecuteDbUpdateOptions<TFamilyId extends string, TTargetId extends string> {
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
  readonly acceptDataLoss?: boolean;
  /** Optional progress callback for observing operation progress. */
  readonly onProgress?: OnControlProgress;
}

/**
 * Executes the db update operation: introspect → plan → (optionally) apply → marker.
 *
 * db update is a pure reconciliation command: it introspects the live schema, plans the diff
 * to the destination contract, and applies operations. The marker is bookkeeping only — written
 * after apply so that `verify` and `db init` can reference it, but never read or validated
 * by db update itself. The runner creates the marker table if it does not exist.
 */
export async function executeDbUpdate<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbUpdateOptions<TFamilyId, TTargetId>,
): Promise<DbUpdateResult> {
  const { driver, familyInstance, contractIR, mode, migrations, frameworkComponents, onProgress } =
    options;

  const planner = migrations.createPlanner(familyInstance);
  const runner = migrations.createRunner(familyInstance);

  const introspectSpanId = 'introspect';
  onProgress?.({
    action: 'dbUpdate',
    kind: 'spanStart',
    spanId: introspectSpanId,
    label: 'Introspecting database schema',
  });
  const schemaIR = await familyInstance.introspect({ driver });
  onProgress?.({
    action: 'dbUpdate',
    kind: 'spanEnd',
    spanId: introspectSpanId,
    outcome: 'ok',
  });

  const policy = DB_UPDATE_POLICY;

  const planSpanId = 'plan';
  onProgress?.({
    action: 'dbUpdate',
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
      action: 'dbUpdate',
      kind: 'spanEnd',
      spanId: planSpanId,
      outcome: 'error',
    });
    return notOk({
      code: 'PLANNING_FAILED',
      summary: 'Migration planning failed due to conflicts',
      conflicts: plannerResult.conflicts,
      why: undefined,
      meta: undefined,
    });
  }
  onProgress?.({
    action: 'dbUpdate',
    kind: 'spanEnd',
    spanId: planSpanId,
    outcome: 'ok',
  });

  const migrationPlan = plannerResult.plan;

  if (mode === 'plan') {
    const planSql =
      familyInstance.familyId === 'sql' ? extractSqlDdl(migrationPlan.operations) : undefined;
    const result: DbUpdateSuccess = {
      mode: 'plan',
      plan: {
        operations: stripOperations(migrationPlan.operations),
        ...(planSql !== undefined ? { sql: planSql } : {}),
      },
      destination: {
        storageHash: migrationPlan.destination.storageHash,
        ...ifDefined('profileHash', migrationPlan.destination.profileHash),
      },
      summary: `Planned ${migrationPlan.operations.length} operation(s)`,
    };
    return ok(result);
  }

  // When applying, require explicit acceptance for destructive operations
  if (!options.acceptDataLoss) {
    const destructiveOps = migrationPlan.operations
      .filter((op) => op.operationClass === 'destructive')
      .map((op) => ({ id: op.id, label: op.label }));
    if (destructiveOps.length > 0) {
      return notOk({
        code: 'DESTRUCTIVE_CHANGES',
        summary: `Planned ${destructiveOps.length} destructive operation(s) that require confirmation`,
        why: 'Use --dry-run to preview destructive operations, then re-run with --accept-data-loss to apply',
        conflicts: undefined,
        meta: { destructiveOperations: destructiveOps },
      });
    }
  }

  const applySpanId = 'apply';
  onProgress?.({
    action: 'dbUpdate',
    kind: 'spanStart',
    spanId: applySpanId,
    label: 'Applying migration plan',
  });

  const callbacks = createOperationCallbacks(onProgress, 'dbUpdate', applySpanId);

  const runnerResult: MigrationRunnerResult = await runner.execute({
    plan: migrationPlan,
    driver,
    destinationContract: contractIR,
    policy,
    ...(callbacks ? { callbacks } : {}),
    // db update plans and applies from a single introspection pass, so per-operation pre/postchecks
    // and idempotency probes are intentionally disabled to avoid redundant roundtrips.
    executionChecks: {
      prechecks: false,
      postchecks: false,
      idempotencyChecks: false,
    },
    frameworkComponents,
  });

  if (!runnerResult.ok) {
    onProgress?.({
      action: 'dbUpdate',
      kind: 'spanEnd',
      spanId: applySpanId,
      outcome: 'error',
    });
    return notOk({
      code: 'RUNNER_FAILED',
      summary: runnerResult.failure.summary,
      why: runnerResult.failure.why,
      meta: runnerResult.failure.meta,
      conflicts: undefined,
    });
  }

  const execution = runnerResult.value;
  onProgress?.({
    action: 'dbUpdate',
    kind: 'spanEnd',
    spanId: applySpanId,
    outcome: 'ok',
  });

  const result: DbUpdateSuccess = {
    mode: 'apply',
    plan: {
      operations: stripOperations(migrationPlan.operations),
    },
    destination: {
      storageHash: migrationPlan.destination.storageHash,
      ...ifDefined('profileHash', migrationPlan.destination.profileHash),
    },
    execution: {
      operationsPlanned: execution.operationsPlanned,
      operationsExecuted: execution.operationsExecuted,
    },
    marker: migrationPlan.destination.profileHash
      ? {
          storageHash: migrationPlan.destination.storageHash,
          profileHash: migrationPlan.destination.profileHash,
        }
      : { storageHash: migrationPlan.destination.storageHash },
    summary:
      execution.operationsExecuted === 0
        ? 'Database already matches contract, signature updated'
        : `Applied ${execution.operationsExecuted} operation(s), signature updated`,
  };
  return ok(result);
}
