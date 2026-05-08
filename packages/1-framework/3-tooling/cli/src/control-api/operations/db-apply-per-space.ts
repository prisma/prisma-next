import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerResult,
  MigrationPlanOperation,
  MultiSpaceCapableRunner,
  MultiSpaceRunnerPerSpaceOptions,
  OperationPreview,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import {
  hasMultiSpaceRunner,
  hasOperationPreview,
} from '@prisma-next/framework-components/control';
import {
  APP_SPACE_ID,
  computeExtensionSpaceApplyPath,
  concatenateSpaceApplyInputs,
  readPinnedSpaceContract,
  type SpaceApplyInput,
} from '@prisma-next/migration-tools/spaces';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import type {
  DbInitFailure,
  DbInitResult,
  DbInitSuccess,
  DbUpdateFailure,
  DbUpdateResult,
  DbUpdateSuccess,
  OnControlProgress,
} from '../types';
import { stripOperations } from './migration-helpers';

/**
 * Information about an extension contract space that the CLI threads
 * through to the per-space `db init` / `db update` flow. Only the
 * `id` is mandatory — the rest is read from on-disk pinned artefacts
 * at apply time so the descriptor module is not required at runtime
 * (project spec § Non-goals; AM11).
 */
export interface PerSpaceExtensionInput {
  readonly id: string;
}

/**
 * Shared options for both `db init` and `db update` per-space flows.
 *
 * The flow:
 *
 * 1. Read every marker row keyed by `space`.
 * 2. For each declared extension space, walk its on-disk migration
 *    graph from `currentMarker → pinnedHeadRef.hash` via
 *    {@link computeExtensionSpaceApplyPath} (ADR 208).
 * 3. Plan the app space against the live introspected schema (today's
 *    single-space `db init` / `db update` behaviour).
 * 4. Concatenate per cross-space ordering (extensions alphabetically
 *    by space id, then app-space) via
 *    {@link concatenateSpaceApplyInputs}.
 * 5. Apply every space inside one outer transaction via
 *    `runner.executeAcrossSpaces({ driver, perSpaceOptions })` — a
 *    failure on any space rolls back every space's writes
 *    (AM4-rollback CLI-level half).
 *
 * @see projects/extension-contract-spaces/specs/framework-mechanism.spec.md
 *   § 6 — `db init` / `db update` per-space.
 */
export interface ExecutePerSpaceDbApplyOptions<TFamilyId extends string, TTargetId extends string> {
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
  readonly migrationsDir: string;
  readonly extensionContractSpaces: ReadonlyArray<PerSpaceExtensionInput>;
  readonly policy: MigrationOperationPolicy;
  readonly action: 'dbInit' | 'dbUpdate';
  readonly onProgress?: OnControlProgress;
}

/**
 * Execute `db init` or `db update` against multiple contract spaces.
 *
 * Returns either a `DbInitResult` (when `action === 'dbInit'`) or a
 * `DbUpdateResult` (when `action === 'dbUpdate'`); the caller
 * dispatches based on the action it kicked off. The two surfaces
 * share most of the logic — the only divergences are policy (init is
 * additive-only, update allows widening / destructive) and result
 * envelope.
 */
export async function executePerSpaceDbApply<TFamilyId extends string, TTargetId extends string>(
  options: ExecutePerSpaceDbApplyOptions<TFamilyId, TTargetId>,
): Promise<DbInitResult | DbUpdateResult> {
  const {
    driver,
    familyInstance,
    contract,
    mode,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensionContractSpaces,
    policy,
    action,
    onProgress,
  } = options;

  const planner = migrations.createPlanner(familyInstance);
  const runner = migrations.createRunner(familyInstance);

  // Read every marker row up-front so the per-space pathfinding has
  // each space's `currentMarker` available without re-querying.
  const markerRows = await familyInstance.readAllMarkers({ driver });

  // ---------------------------------------------------------------------------
  // Extension-space path resolution: walk each space's pinned migration
  // graph from `currentMarker → pinnedHeadRef.hash`. Done BEFORE
  // app-space planning so the extensions' destination contracts are
  // available to filter the introspected schema (otherwise the
  // app-space planner would treat extension-owned tables as extras and
  // emit destructive ops to drop them).
  // ---------------------------------------------------------------------------
  interface PerSpaceContext {
    readonly spaceId: string;
    readonly destinationContract: unknown;
    readonly plan: MigrationPlan;
    readonly displayOps: readonly MigrationPlanOperation[];
  }

  const extensionContexts: PerSpaceContext[] = [];

  for (const ext of extensionContractSpaces) {
    const spaceId = ext.id;
    const marker = markerRows.get(spaceId);
    const currentMarkerHash = marker?.storageHash ?? null;
    const currentMarkerInvariants = marker?.invariants ?? [];

    const outcome = await computeExtensionSpaceApplyPath({
      projectMigrationsDir: migrationsDir,
      spaceId,
      currentMarkerHash,
      currentMarkerInvariants,
    });

    if (outcome.kind === 'pinnedHeadRefMissing') {
      // Verifier precheck should have caught this, but the operation
      // is the last line of defence — surface a coherent failure
      // rather than throw.
      return buildExtensionPathFailure(action, {
        spaceId,
        why: `Extension space "${spaceId}" has no pinned \`refs/head.json\`. Re-run \`prisma-next migrate\` before \`${action === 'dbInit' ? 'db init' : 'db update'}\`.`,
      });
    }
    if (outcome.kind === 'unreachable') {
      return buildExtensionPathFailure(action, {
        spaceId,
        why: `No path in the on-disk migration graph for extension space "${spaceId}" reaches the pinned head ref hash "${outcome.pinnedHeadRef.hash}".`,
      });
    }
    if (outcome.kind === 'unsatisfiable') {
      return buildExtensionPathFailure(action, {
        spaceId,
        why: `On-disk migration graph for extension space "${spaceId}" reaches the pinned head ref hash but does not cover required invariants: ${outcome.missing.join(', ')}.`,
      });
    }

    const destinationContract = await readPinnedSpaceContract(migrationsDir, spaceId);

    const extPlan: MigrationPlan = {
      targetId: '' as unknown as MigrationPlan['targetId'], // patched below once app-space plan is known
      origin: currentMarkerHash === null ? null : { storageHash: currentMarkerHash },
      destination: { storageHash: outcome.pinnedHeadRef.hash },
      operations: outcome.pathOps,
      providedInvariants: outcome.providedInvariants,
    };

    extensionContexts.push({
      spaceId,
      destinationContract,
      plan: extPlan,
      displayOps: outcome.pathOps,
    });
  }

  // ---------------------------------------------------------------------------
  // App-space planning (today's single-space `db init` / `db update` flow).
  // The introspected schema is pruned to exclude tables owned by other
  // (extension) spaces so the planner does not emit destructive ops to
  // drop them as "extras". This mirrors the runner's
  // `strictVerification: false` setting at apply time — each space owns
  // a disjoint slice of the live schema (sub-spec § 1).
  // ---------------------------------------------------------------------------
  const introspectSpanId = 'introspect';
  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: introspectSpanId,
    label: 'Introspecting database schema',
  });
  const schemaIR = await familyInstance.introspect({ driver });
  onProgress?.({ action, kind: 'spanEnd', spanId: introspectSpanId, outcome: 'ok' });

  const prunedSchemaIR = pruneSchemaByOtherSpaceContracts(
    schemaIR,
    extensionContexts.map((ctx) => ctx.destinationContract),
  );

  const planSpanId = 'plan';
  onProgress?.({ action, kind: 'spanStart', spanId: planSpanId, label: 'Planning migration' });
  const plannerResult: MigrationPlannerResult = await planner.plan({
    contract,
    schema: prunedSchemaIR,
    policy,
    fromContract: null,
    frameworkComponents,
  });
  if (plannerResult.kind === 'failure') {
    onProgress?.({ action, kind: 'spanEnd', spanId: planSpanId, outcome: 'error' });
    return buildPlanningFailure(action, plannerResult.conflicts);
  }
  onProgress?.({ action, kind: 'spanEnd', spanId: planSpanId, outcome: 'ok' });

  const appPlan: MigrationPlan = plannerResult.plan;

  // Patch each extension plan's targetId to match the app plan's now
  // that we know it (extension paths walk operations rendered against
  // the same target as the app contract).
  const perSpaceContexts: PerSpaceContext[] = extensionContexts.map((ctx) => ({
    ...ctx,
    plan: { ...ctx.plan, targetId: appPlan.targetId },
  }));

  const appSpaceContext: PerSpaceContext = {
    spaceId: APP_SPACE_ID,
    destinationContract: contract,
    plan: appPlan,
    displayOps: appPlan.operations,
  };

  perSpaceContexts.push(appSpaceContext);

  // Concatenate via the framework-level helper for cross-space ordering
  // (extensions alphabetical first, then app-space) and duplicate-id
  // rejection.
  const orderedInputs: readonly SpaceApplyInput<MigrationPlanOperation>[] =
    concatenateSpaceApplyInputs(
      perSpaceContexts.map(
        (ctx): SpaceApplyInput<MigrationPlanOperation> => ({
          spaceId: ctx.spaceId,
          // The runner does not consume `migrationDirectory` directly
          // for app-space synthesis paths, but the field is part of the
          // canonical `SpaceApplyInput` shape — surface it for parity
          // with how `migrate apply` shapes its inputs.
          migrationDirectory: migrationsDir,
          currentMarkerHash: markerRows.get(ctx.spaceId)?.storageHash ?? null,
          currentMarkerInvariants: markerRows.get(ctx.spaceId)?.invariants ?? [],
          path: ctx.displayOps,
        }),
      ),
    );
  const orderedContexts: PerSpaceContext[] = orderedInputs.map((input) => {
    const ctx = perSpaceContexts.find((c) => c.spaceId === input.spaceId);
    if (!ctx) {
      // Unreachable — concatenateSpaceApplyInputs preserves identity.
      throw new Error(`Per-space context missing for space "${input.spaceId}"`);
    }
    return ctx;
  });

  // ---------------------------------------------------------------------------
  // Plan-mode: surface aggregate operations without applying.
  // ---------------------------------------------------------------------------
  if (mode === 'plan') {
    const aggregateOps = orderedContexts.flatMap((ctx) => ctx.displayOps);
    const preview = hasOperationPreview(familyInstance)
      ? familyInstance.toOperationPreview(aggregateOps)
      : undefined;
    const summary = `Planned ${aggregateOps.length} operation(s) across ${orderedContexts.length} space(s)`;
    return wrapPlanResult(action, {
      operations: aggregateOps,
      destination: appPlan.destination,
      preview,
      summary,
    });
  }

  // ---------------------------------------------------------------------------
  // Apply-mode: route through `runner.executeAcrossSpaces` for atomic
  // multi-space transaction with rollback on any failure.
  // ---------------------------------------------------------------------------
  if (!hasMultiSpaceRunner(runner)) {
    return buildExtensionPathFailure(action, {
      spaceId: '<runner>',
      why: `Runner for target "${appPlan.targetId}" does not implement \`executeAcrossSpaces\`. Per-space \`${action === 'dbInit' ? 'db init' : 'db update'}\` requires multi-space-capable runners (today: every SQL family runner).`,
    });
  }

  const applySpanId = 'apply';
  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: applySpanId,
    label: 'Applying migration plan across spaces',
  });

  const perSpaceOptions: MultiSpaceRunnerPerSpaceOptions<TFamilyId, TTargetId>[] =
    orderedContexts.map((ctx) => ({
      space: ctx.spaceId,
      plan: ctx.plan,
      driver,
      destinationContract: ctx.destinationContract,
      policy,
      executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
      frameworkComponents,
      // Multi-space post-apply verification is intentionally non-strict
      // per-space: each space's `destinationContract` describes only its
      // own tables, so without this every space's verifier would treat
      // every other space's tables as "extras". The tolerant mode still
      // catches missing tables / columns / wrong types — only the
      // "extras" gate is disabled. SQL-family runners read this via
      // structural typing on `MultiSpaceRunnerPerSpaceOptions`
      // (sub-spec § 4 — Runner protocol).
      strictVerification: false,
    })) as MultiSpaceRunnerPerSpaceOptions<TFamilyId, TTargetId>[];

  const runnerResult = await (
    runner as MultiSpaceCapableRunner<TFamilyId, TTargetId>
  ).executeAcrossSpaces({ driver, perSpaceOptions });

  if (!runnerResult.ok) {
    onProgress?.({ action, kind: 'spanEnd', spanId: applySpanId, outcome: 'error' });
    return buildRunnerFailure(action, {
      summary: runnerResult.failure.summary,
      ...ifDefined('why', runnerResult.failure.why),
      meta: {
        ...(runnerResult.failure.meta ?? {}),
        failingSpace: runnerResult.failure.failingSpace,
      },
    });
  }

  onProgress?.({ action, kind: 'spanEnd', spanId: applySpanId, outcome: 'ok' });

  const totalOpsPlanned = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsPlanned,
    0,
  );
  const totalOpsExecuted = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsExecuted,
    0,
  );

  const aggregateOps = orderedContexts.flatMap((ctx) => ctx.displayOps);
  const summary =
    action === 'dbInit'
      ? `Applied ${totalOpsExecuted} operation(s) across ${orderedContexts.length} space(s), database signed`
      : totalOpsExecuted === 0
        ? `Database already matches contract across ${orderedContexts.length} space(s), signature updated`
        : `Applied ${totalOpsExecuted} operation(s) across ${orderedContexts.length} space(s), signature updated`;

  return wrapApplyResult(action, {
    operations: aggregateOps,
    destination: appPlan.destination,
    operationsPlanned: totalOpsPlanned,
    operationsExecuted: totalOpsExecuted,
    summary,
  });
}

// ============================================================================
// Result builders — keep the action-conditional envelope shape collapsed
// at the boundary so the apply / plan paths above stay readable.
// ============================================================================

function wrapPlanResult(
  action: 'dbInit' | 'dbUpdate',
  args: {
    readonly operations: readonly MigrationPlanOperation[];
    readonly destination: { readonly storageHash: string; readonly profileHash?: string };
    readonly preview: OperationPreview | undefined;
    readonly summary: string;
  },
): DbInitResult | DbUpdateResult {
  const success: DbInitSuccess | DbUpdateSuccess = {
    mode: 'plan',
    plan: {
      operations: stripOperations(args.operations),
      ...ifDefined('preview', args.preview),
    },
    destination: {
      storageHash: args.destination.storageHash,
      ...ifDefined('profileHash', args.destination.profileHash),
    },
    summary: args.summary,
  };
  return action === 'dbInit' ? ok(success) : ok(success);
}

function wrapApplyResult(
  action: 'dbInit' | 'dbUpdate',
  args: {
    readonly operations: readonly MigrationPlanOperation[];
    readonly destination: { readonly storageHash: string; readonly profileHash?: string };
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
    readonly summary: string;
  },
): DbInitResult | DbUpdateResult {
  const success: DbInitSuccess | DbUpdateSuccess = {
    mode: 'apply',
    plan: { operations: stripOperations(args.operations) },
    destination: {
      storageHash: args.destination.storageHash,
      ...ifDefined('profileHash', args.destination.profileHash),
    },
    execution: {
      operationsPlanned: args.operationsPlanned,
      operationsExecuted: args.operationsExecuted,
    },
    marker: args.destination.profileHash
      ? { storageHash: args.destination.storageHash, profileHash: args.destination.profileHash }
      : { storageHash: args.destination.storageHash },
    summary: args.summary,
  };
  return action === 'dbInit' ? ok(success) : ok(success);
}

function buildPlanningFailure(
  action: 'dbInit' | 'dbUpdate',
  conflicts: DbInitFailure['conflicts'],
): DbInitResult | DbUpdateResult {
  const failure: DbInitFailure | DbUpdateFailure = {
    code: 'PLANNING_FAILED',
    summary: 'Migration planning failed due to conflicts',
    conflicts,
    why: undefined,
    meta: undefined,
  };
  return action === 'dbInit' ? notOk(failure as DbInitFailure) : notOk(failure as DbUpdateFailure);
}

function buildRunnerFailure(
  action: 'dbInit' | 'dbUpdate',
  args: {
    readonly summary: string;
    readonly why?: string;
    readonly meta: Record<string, unknown>;
  },
): DbInitResult | DbUpdateResult {
  const failure: DbInitFailure | DbUpdateFailure = {
    code: 'RUNNER_FAILED',
    summary: args.summary,
    why: args.why,
    meta: args.meta,
    conflicts: undefined,
  };
  return action === 'dbInit' ? notOk(failure as DbInitFailure) : notOk(failure as DbUpdateFailure);
}

function buildExtensionPathFailure(
  action: 'dbInit' | 'dbUpdate',
  args: { readonly spaceId: string; readonly why: string },
): DbInitResult | DbUpdateResult {
  const failure: DbInitFailure | DbUpdateFailure = {
    code: 'RUNNER_FAILED',
    summary: `Cannot resolve apply path for extension space "${args.spaceId}"`,
    why: args.why,
    meta: { spaceId: args.spaceId },
    conflicts: undefined,
  };
  return action === 'dbInit' ? notOk(failure as DbInitFailure) : notOk(failure as DbUpdateFailure);
}

/**
 * Remove tables (and other top-level storage entries) owned by other
 * spaces' contracts from the introspected schema before planning the
 * app-space migration.
 *
 * This is a structural duck-typed helper: every family today exposes
 * `storage.tables: Record<string, ...>`, and the introspected schema
 * mirrors the same shape. When a future family has a different shape,
 * the helper falls through and returns the schema unchanged.
 *
 * Without this prune, the app-space planner would treat
 * extension-owned tables as "extras" and emit destructive ops to drop
 * them — defeating the whole point of disjoint per-space ownership
 * (sub-spec § 1, AM2).
 */
function pruneSchemaByOtherSpaceContracts(
  schema: unknown,
  otherSpaceContracts: ReadonlyArray<unknown>,
): unknown {
  if (typeof schema !== 'object' || schema === null) return schema;
  const schemaObj = schema as { readonly tables?: unknown };
  if (typeof schemaObj.tables !== 'object' || schemaObj.tables === null) return schema;
  const schemaTables = schemaObj.tables as Record<string, unknown>;

  const ownedByOthers = new Set<string>();
  for (const ext of otherSpaceContracts) {
    if (typeof ext !== 'object' || ext === null) continue;
    const storage = (ext as { readonly storage?: unknown }).storage;
    if (typeof storage !== 'object' || storage === null) continue;
    const tables = (storage as { readonly tables?: unknown }).tables;
    if (typeof tables !== 'object' || tables === null) continue;
    for (const tableName of Object.keys(tables as Record<string, unknown>)) {
      ownedByOthers.add(tableName);
    }
  }

  if (ownedByOthers.size === 0) return schema;

  const prunedTables: Record<string, unknown> = {};
  for (const [name, table] of Object.entries(schemaTables)) {
    if (!ownedByOthers.has(name)) {
      prunedTables[name] = table;
    }
  }

  return { ...schemaObj, tables: prunedTables };
}
