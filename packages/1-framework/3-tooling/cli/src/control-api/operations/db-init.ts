import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlan,
  MigrationPlannerResult,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { hasOperationPreview } from '@prisma-next/framework-components/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import type { DbInitResult, DbInitSuccess, OnControlProgress } from '../types';
import { executePerSpaceDbApply, type PerSpaceExtensionInput } from './db-apply-per-space';
import { createOperationCallbacks, stripOperations } from './migration-helpers';

/**
 * Options for executing dbInit operation.
 */
export interface ExecuteDbInitOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly contract: Contract;
  readonly mode: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  /**
   * On-disk migrations directory the per-space wiring reads pinned
   * artefacts from. Required when {@link extensionContractSpaces} is
   * non-empty; ignored otherwise.
   *
   * @see specs/framework-mechanism.spec.md § 6 — `db init` per-space.
   */
  readonly migrationsDir?: string;
  /**
   * Declared extension contract spaces. When non-empty, `db init` routes
   * through the per-space flow (extension graphs walked from
   * `currentMarker → pinnedHeadRef.hash`, app-space synthesised from
   * contract IR, all applied in a single transaction). When empty,
   * today's single-space flow is preserved unchanged.
   */
  readonly extensionContractSpaces?: ReadonlyArray<PerSpaceExtensionInput>;
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
  const {
    driver,
    familyInstance,
    contract,
    mode,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionContractSpaces,
    onProgress,
  } = options;

  // Per-space `db init` (sub-spec § 6): when at least one extension
  // declares a `contractSpace`, fan out across (extensions
  // alphabetically + app-space) inside a single transaction via
  // `runner.executeAcrossSpaces` so a failure on any space rolls back
  // every space's writes (AM4-rollback CLI-level half).
  //
  // Falls back to today's single-space path when no extension contract
  // spaces are declared, preserving existing behaviour for projects
  // that don't load schema-contributing extensions.
  if (extensionContractSpaces && extensionContractSpaces.length > 0) {
    if (!migrationsDir) {
      throw new Error(
        'executeDbInit: `migrationsDir` is required when `extensionContractSpaces` is non-empty.',
      );
    }
    const result = await executePerSpaceDbApply<TFamilyId, TTargetId>({
      driver,
      familyInstance,
      contract,
      mode,
      migrations,
      frameworkComponents,
      migrationsDir,
      extensionContractSpaces,
      // db init is additive-only; per-space flow uses the same policy
      // as the single-space path so error messages line up.
      policy: { allowedOperationClasses: ['additive'] },
      action: 'dbInit',
      ...ifDefined('onProgress', onProgress),
    });
    return result as DbInitResult;
  }

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
    contract,
    schema: schemaIR,
    policy,
    // `db init` reconciles against the live introspected schema; there is no
    // prior contract to derive a "from" identity from. The required
    // `fromContract: null` makes that structural fact visible at the call
    // site (vs. silently letting the planner default to a baseline plan).
    fromContract: null,
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
    label: 'Checking database signature',
  });
  const existingMarker = await familyInstance.readMarker({ driver });
  if (existingMarker) {
    const markerMatchesDestination =
      existingMarker.storageHash === migrationPlan.destination.storageHash &&
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
        destination: {
          storageHash: migrationPlan.destination.storageHash,
          ...ifDefined('profileHash', migrationPlan.destination.profileHash),
        },
        ...ifDefined(
          'execution',
          mode === 'apply' ? { operationsPlanned: 0, operationsExecuted: 0 } : undefined,
        ),
        ...ifDefined(
          'marker',
          mode === 'apply'
            ? {
                storageHash: existingMarker.storageHash,
                profileHash: existingMarker.profileHash,
              }
            : undefined,
        ),
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
        storageHash: existingMarker.storageHash,
        profileHash: existingMarker.profileHash,
      },
      destination: {
        storageHash: migrationPlan.destination.storageHash,
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
    const preview = hasOperationPreview(familyInstance)
      ? familyInstance.toOperationPreview(migrationPlan.operations)
      : undefined;
    const result: DbInitSuccess = {
      mode: 'plan',
      plan: {
        operations: stripOperations(migrationPlan.operations),
        ...ifDefined('preview', preview),
      },
      destination: {
        storageHash: migrationPlan.destination.storageHash,
        ...ifDefined('profileHash', migrationPlan.destination.profileHash),
      },
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

  const callbacks = createOperationCallbacks(onProgress, 'dbInit', applySpanId);

  const runnerResult: MigrationRunnerResult = await runner.execute({
    plan: migrationPlan,
    driver,
    destinationContract: contract,
    policy,
    ...ifDefined('callbacks', callbacks),
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
    summary: `Applied ${execution.operationsExecuted} operation(s), database signed`,
  };
  return ok(result);
}
