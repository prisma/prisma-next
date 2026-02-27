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
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import type { DbUpdateResult, DbUpdateSuccess, OnControlProgress } from '../types';

// F12: db update uses a lossy policy that allows additive, widening, and destructive operations.
const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
} as const;

function isDdlStatement(sqlStatement: string): boolean {
  const trimmed = sqlStatement.trim().toLowerCase();
  return (
    trimmed.startsWith('create ') || trimmed.startsWith('alter ') || trimmed.startsWith('drop ')
  );
}

function extractSqlDdl(operations: readonly MigrationPlanOperation[]): string[] {
  const statements: string[] = [];
  for (const operation of operations) {
    const record = operation as unknown as Record<string, unknown>;
    const execute = record['execute'];
    if (!Array.isArray(execute)) {
      continue;
    }
    for (const step of execute) {
      if (typeof step !== 'object' || step === null) {
        continue;
      }
      const sql = (step as Record<string, unknown>)['sql'];
      if (typeof sql !== 'string') {
        continue;
      }
      if (isDdlStatement(sql)) {
        statements.push(sql.trim());
      }
    }
  }
  return statements;
}

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
 * Executes the db update operation: readMarker → introspect → plan → (optionally) apply → marker.
 *
 * Unlike db init, db update requires an existing marker and keeps all runner execution checks
 * enabled because the database may have drifted since the last marker write.
 */
export async function executeDbUpdate<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbUpdateOptions<TFamilyId, TTargetId>,
): Promise<DbUpdateResult> {
  const { driver, familyInstance, contractIR, mode, migrations, frameworkComponents, onProgress } =
    options;

  const planner = migrations.createPlanner(familyInstance);
  const runner = migrations.createRunner(familyInstance);

  // readMarker and introspect are sequential by design:
  // 1. readMarker failure (no marker) triggers an early return, avoiding unnecessary introspection.
  // 2. The Postgres driver serializes queries on a single connection, so Promise.all
  //    would not yield actual I/O parallelism with the current driver architecture.
  const readMarkerSpanId = 'readMarker';
  onProgress?.({
    action: 'dbUpdate',
    kind: 'spanStart',
    spanId: readMarkerSpanId,
    label: 'Reading contract marker',
  });
  const marker = await familyInstance.readMarker({ driver });
  if (!marker) {
    onProgress?.({
      action: 'dbUpdate',
      kind: 'spanEnd',
      spanId: readMarkerSpanId,
      outcome: 'error',
    });
    return notOk({
      code: 'MARKER_REQUIRED' as const,
      summary: 'Database marker is required before running db update',
      why: 'No contract marker found in the database',
      conflicts: undefined,
      meta: undefined,
    });
  }
  onProgress?.({
    action: 'dbUpdate',
    kind: 'spanEnd',
    spanId: readMarkerSpanId,
    outcome: 'ok',
  });

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
      code: 'PLANNING_FAILED' as const,
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

  const migrationPlan: MigrationPlan = {
    ...plannerResult.plan,
    origin: {
      storageHash: marker.storageHash,
      profileHash: marker.profileHash,
    },
  };

  if (mode === 'plan') {
    const planSql =
      familyInstance.familyId === 'sql' ? extractSqlDdl(migrationPlan.operations) : undefined;
    const result: DbUpdateSuccess = {
      mode: 'plan',
      plan: {
        operations: migrationPlan.operations,
        ...(planSql !== undefined ? { sql: planSql } : {}),
      },
      origin: {
        storageHash: marker.storageHash,
        ...ifDefined('profileHash', marker.profileHash),
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
    const hasDestructive = migrationPlan.operations.some(
      (op) => op.operationClass === 'destructive',
    );
    if (hasDestructive) {
      const destructiveOps = migrationPlan.operations
        .filter((op) => op.operationClass === 'destructive')
        .map((op) => ({ id: op.id, label: op.label }));
      return notOk({
        code: 'DESTRUCTIVE_CHANGES' as const,
        summary: `Planned ${destructiveOps.length} destructive operation(s) that require confirmation`,
        why: 'Use --plan to preview destructive operations, then re-run with --accept-data-loss to apply',
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

  const callbacks = onProgress
    ? {
        onOperationStart: (op: MigrationPlanOperation) => {
          onProgress({
            action: 'dbUpdate',
            kind: 'spanStart',
            spanId: `operation:${op.id}`,
            parentSpanId: applySpanId,
            label: op.label,
          });
        },
        onOperationComplete: (op: MigrationPlanOperation) => {
          onProgress({
            action: 'dbUpdate',
            kind: 'spanEnd',
            spanId: `operation:${op.id}`,
            outcome: 'ok',
          });
        },
      }
    : undefined;

  // db update keeps all execution checks enabled (the runner default). Unlike db init, which
  // disables checks because it plans and applies from a fresh introspection, db update operates
  // on existing databases that may have drifted since the last marker write.
  const runnerResult: MigrationRunnerResult = await runner.execute({
    plan: migrationPlan,
    driver,
    destinationContract: contractIR,
    policy,
    ...(callbacks ? { callbacks } : {}),
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
      code: 'RUNNER_FAILED' as const,
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
    plan: { operations: migrationPlan.operations },
    origin: {
      storageHash: marker.storageHash,
      ...ifDefined('profileHash', marker.profileHash),
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
    summary: `Applied ${execution.operationsExecuted} operation(s), marker written`,
  };
  return ok(result);
}
