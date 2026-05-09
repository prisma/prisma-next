import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
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
 * Span IDs emitted via `onProgress` for the per-space apply flow. The
 * orchestrator opens / closes spans by id; consumers (notably the
 * structured-output renderer in `output.test.ts`) match against these
 * literal strings, so a single source of truth keeps the literals in
 * step.
 */
const SPAN_IDS = {
  introspect: 'introspect',
  plan: 'plan',
  apply: 'apply',
} as const;

/**
 * Information about an extension contract space that the CLI threads
 * through to the per-space `db init` / `db update` flow. Only the
 * `id` is mandatory — the rest is read from on-disk pinned artefacts
 * at apply time so the descriptor module is not required at runtime.
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
 * 2. Read every extension's pinned destination contract (so the
 *    app-space planner can prune extension-owned tables out of the
 *    introspected schema before planning).
 * 3. Introspect the live database schema once (app-only work, hoisted
 *    out of the per-space loop).
 * 4. Build a {@link SpacePathResolver} per space. For an extension,
 *    the resolver wraps {@link computeExtensionSpaceApplyPath} (ADR
 *    208). For the app, it wraps `planner.plan` against the pruned
 *    introspected slice. Order: extensions alphabetically by space
 *    id, then app — matching {@link concatenateSpaceApplyInputs}'s
 *    cross-space convention.
 * 5. Iterate resolvers in order, invoking `resolve(currentMarker)` on
 *    each. Failures (planning conflicts on app, path-resolution
 *    failures on extensions) short-circuit the entire flow.
 * 6. Apply every space inside one outer transaction via
 *    `runner.executeAcrossSpaces({ driver, perSpaceOptions })` — a
 *    failure on any space rolls back every space's writes (the
 *    cross-space rollback guarantee, CLI-level half).
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 *   — `db init` / `db update` per-space.
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
 * Per-space resolution outcome. Every space — app or extension —
 * produces one of three shapes via its {@link SpacePathResolver}:
 *
 * - `ok`: a {@link MigrationPlan} ready to feed into the runner,
 *   alongside the destination contract for runner-level verification
 *   and the operations to surface in the aggregate plan output.
 * - `planning-failure`: the planner refused to emit a plan (today
 *   only the app resolver can produce this).
 * - `extension-path-failure`: the on-disk migration graph cannot
 *   reach the pinned head ref (today only extension resolvers can
 *   produce this).
 *
 * The orchestrator dispatches on `kind` and translates each failure
 * into the action-appropriate failure envelope via the existing
 * `build*Failure` helpers.
 */
type SpaceResolution =
  | {
      readonly kind: 'ok';
      readonly destinationContract: unknown;
      readonly plan: MigrationPlan;
      readonly displayOps: readonly MigrationPlanOperation[];
    }
  | {
      readonly kind: 'planning-failure';
      readonly conflicts: readonly MigrationPlannerConflict[] | undefined;
    }
  | {
      readonly kind: 'extension-path-failure';
      readonly why: string;
    };

/**
 * Per-space path resolver — the seam that lets the orchestrator drive
 * one symmetric loop over every space rather than maintaining
 * separate code paths for app vs extension. The asymmetry between
 * "synthesise a plan from introspected schema" (app) and "walk the
 * on-disk migration graph from `currentMarker → pinnedHeadRef`"
 * (extension) lives entirely inside the resolver factories
 * ({@link makeAppResolver}, {@link makeExtensionResolver}).
 */
interface SpacePathResolver {
  readonly spaceId: string;
  readonly migrationsDir: string;
  readonly resolve: (
    currentMarkerHash: string | null,
    currentMarkerInvariants: readonly string[],
  ) => Promise<SpaceResolution>;
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

  // Read every marker row up-front so each resolver call has the
  // current marker available without re-querying.
  const markerRows = await familyInstance.readAllMarkers({ driver });

  // App-only work, hoisted out of the per-space loop: introspect once
  // and prune extension-owned tables out of the result. Without the
  // prune the app-space planner would treat extension-owned tables as
  // "extras" and emit destructive ops to drop them — defeating
  // disjoint per-space ownership.
  const destinationByExtId = new Map<string, unknown>();
  for (const ext of extensionContractSpaces) {
    destinationByExtId.set(ext.id, await readPinnedSpaceContract(migrationsDir, ext.id));
  }

  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: SPAN_IDS.introspect,
    label: 'Introspecting database schema',
  });
  const schemaIR = await familyInstance.introspect({ driver });
  onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.introspect, outcome: 'ok' });

  const prunedSchemaIR = pruneSchemaByOtherSpaceContracts(schemaIR, [
    ...destinationByExtId.values(),
  ]);

  // Build the per-space resolver list. The order — extensions
  // alphabetically by space id, then app — mirrors
  // `concatenateSpaceApplyInputs`'s convention; the runner reports
  // `failingSpace` against this ordering, and existing tests pin it.
  const sortedExtensions = [...extensionContractSpaces].sort((a, b) => a.id.localeCompare(b.id));
  const resolvers: SpacePathResolver[] = [
    ...sortedExtensions.map(
      (ext): SpacePathResolver =>
        makeExtensionResolver({
          spaceId: ext.id,
          migrationsDir,
          destinationContract: destinationByExtId.get(ext.id),
        }),
    ),
    makeAppResolver({
      spaceId: APP_SPACE_ID,
      migrationsDir,
      contract,
      planner,
      prunedSchemaIR,
      frameworkComponents,
      policy,
    }),
  ];

  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: SPAN_IDS.plan,
    label: 'Planning migration',
  });

  const resolutions: Array<{
    readonly spaceId: string;
    readonly destinationContract: unknown;
    readonly plan: MigrationPlan;
    readonly displayOps: readonly MigrationPlanOperation[];
  }> = [];
  for (const resolver of resolvers) {
    const marker = markerRows.get(resolver.spaceId);
    const resolution = await resolver.resolve(
      marker?.storageHash ?? null,
      marker?.invariants ?? [],
    );
    if (resolution.kind === 'extension-path-failure') {
      onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.plan, outcome: 'error' });
      return buildExtensionPathFailure({
        spaceId: resolver.spaceId,
        why: resolution.why,
      });
    }
    if (resolution.kind === 'planning-failure') {
      onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.plan, outcome: 'error' });
      return buildPlanningFailure(resolution.conflicts);
    }
    resolutions.push({
      spaceId: resolver.spaceId,
      destinationContract: resolution.destinationContract,
      plan: resolution.plan,
      displayOps: resolution.displayOps,
    });
  }
  onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.plan, outcome: 'ok' });

  // Patch each extension plan's targetId to match the app plan's now
  // that we know it (extension paths walk operations rendered against
  // the same target as the app contract). The placeholder-then-patch
  // sequence is documented as awkward-but-contained; out of scope to
  // remove here.
  const appPlan = resolutions.find((r) => r.spaceId === APP_SPACE_ID)?.plan;
  if (!appPlan) {
    // Unreachable — the app resolver is always last in `resolvers`.
    throw new Error('App-space plan missing from resolver outputs');
  }
  const patchedResolutions = resolutions.map((r) =>
    r.spaceId === APP_SPACE_ID ? r : { ...r, plan: { ...r.plan, targetId: appPlan.targetId } },
  );

  // Concatenate via the framework-level helper for cross-space
  // ordering and duplicate-id rejection.
  const orderedInputs: readonly SpaceApplyInput<MigrationPlanOperation>[] =
    concatenateSpaceApplyInputs(
      patchedResolutions.map(
        (r): SpaceApplyInput<MigrationPlanOperation> => ({
          spaceId: r.spaceId,
          // The runner does not consume `migrationDirectory` directly
          // for app-space synthesis paths, but the field is part of
          // the canonical `SpaceApplyInput` shape — surface it for
          // parity with how `migrate apply` shapes its inputs.
          migrationDirectory: migrationsDir,
          currentMarkerHash: markerRows.get(r.spaceId)?.storageHash ?? null,
          currentMarkerInvariants: markerRows.get(r.spaceId)?.invariants ?? [],
          path: r.displayOps,
        }),
      ),
    );
  // Build a single index over `patchedResolutions` keyed by space id so
  // re-mapping in `concatenateSpaceApplyInputs` order is O(N) instead
  // of O(N²) (the input list is canonically the same set of space ids
  // — `concatenateSpaceApplyInputs` rejects unknowns and preserves
  // identity, so the `.get(...)!` is sound).
  const patchedBySpaceId = new Map(patchedResolutions.map((r) => [r.spaceId, r]));
  const orderedResolutions = orderedInputs.map((input) => {
    const r = patchedBySpaceId.get(input.spaceId);
    if (!r) {
      throw new Error(`Per-space resolution missing for space "${input.spaceId}"`);
    }
    return r;
  });

  // Plan-mode: surface aggregate operations without applying.
  if (mode === 'plan') {
    const aggregateOps = orderedResolutions.flatMap((r) => r.displayOps);
    const preview = hasOperationPreview(familyInstance)
      ? familyInstance.toOperationPreview(aggregateOps)
      : undefined;
    const summary = `Planned ${aggregateOps.length} operation(s) across ${orderedResolutions.length} space(s)`;
    return wrapPlanResult({
      operations: aggregateOps,
      destination: appPlan.destination,
      preview,
      summary,
    });
  }

  // Apply-mode: route through `runner.executeAcrossSpaces` for atomic
  // multi-space transaction with rollback on any failure. Every
  // `db init` / `db update` walks this path now (the n=1 app-only
  // case calls `executeAcrossSpaces` with a single per-space input),
  // so the capability check fires unconditionally.
  if (!hasMultiSpaceRunner(runner)) {
    return buildExtensionPathFailure({
      spaceId: '<runner>',
      why: `Runner for target "${appPlan.targetId}" does not implement \`executeAcrossSpaces\`. \`${action === 'dbInit' ? 'db init' : 'db update'}\` requires multi-space-capable runners (today: every SQL family runner).`,
    });
  }

  onProgress?.({
    action,
    kind: 'spanStart',
    spanId: SPAN_IDS.apply,
    label: 'Applying migration plan across spaces',
  });

  const perSpaceOptions: MultiSpaceRunnerPerSpaceOptions<TFamilyId, TTargetId>[] =
    orderedResolutions.map((r) => ({
      space: r.spaceId,
      plan: r.plan,
      driver,
      destinationContract: r.destinationContract,
      policy,
      executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
      frameworkComponents,
      // Multi-space post-apply verification is intentionally non-strict
      // per-space: each space's `destinationContract` describes only
      // its own tables, so without this every space's verifier would
      // treat every other space's tables as "extras". The tolerant
      // mode still catches missing tables / columns / wrong types —
      // only the "extras" gate is disabled. SQL-family runners read
      // this via structural typing on
      // `MultiSpaceRunnerPerSpaceOptions` (sub-spec § 4 — Runner
      // protocol).
      strictVerification: false,
    })) as MultiSpaceRunnerPerSpaceOptions<TFamilyId, TTargetId>[];

  const runnerResult = await (
    runner as MultiSpaceCapableRunner<TFamilyId, TTargetId>
  ).executeAcrossSpaces({ driver, perSpaceOptions });

  if (!runnerResult.ok) {
    onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.apply, outcome: 'error' });
    return buildRunnerFailure({
      summary: runnerResult.failure.summary,
      ...ifDefined('why', runnerResult.failure.why),
      meta: {
        ...(runnerResult.failure.meta ?? {}),
        failingSpace: runnerResult.failure.failingSpace,
      },
    });
  }

  onProgress?.({ action, kind: 'spanEnd', spanId: SPAN_IDS.apply, outcome: 'ok' });

  const totalOpsPlanned = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsPlanned,
    0,
  );
  const totalOpsExecuted = runnerResult.value.perSpaceResults.reduce(
    (sum, r) => sum + r.value.operationsExecuted,
    0,
  );

  const aggregateOps = orderedResolutions.flatMap((r) => r.displayOps);
  const summary =
    action === 'dbInit'
      ? `Applied ${totalOpsExecuted} operation(s) across ${orderedResolutions.length} space(s), database signed`
      : totalOpsExecuted === 0
        ? `Database already matches contract across ${orderedResolutions.length} space(s), signature updated`
        : `Applied ${totalOpsExecuted} operation(s) across ${orderedResolutions.length} space(s), signature updated`;

  return wrapApplyResult({
    operations: aggregateOps,
    destination: appPlan.destination,
    operationsPlanned: totalOpsPlanned,
    operationsExecuted: totalOpsExecuted,
    summary,
  });
}

// ============================================================================
// Resolver factories
// ============================================================================

interface MakeExtensionResolverArgs {
  readonly spaceId: string;
  readonly migrationsDir: string;
  readonly destinationContract: unknown;
}

function makeExtensionResolver(args: MakeExtensionResolverArgs): SpacePathResolver {
  return {
    spaceId: args.spaceId,
    migrationsDir: args.migrationsDir,
    resolve: async (currentMarkerHash, currentMarkerInvariants): Promise<SpaceResolution> => {
      const outcome = await computeExtensionSpaceApplyPath({
        projectMigrationsDir: args.migrationsDir,
        spaceId: args.spaceId,
        currentMarkerHash,
        currentMarkerInvariants,
      });

      if (outcome.kind === 'pinnedHeadRefMissing') {
        return {
          kind: 'extension-path-failure',
          why: `Extension space "${args.spaceId}" has no pinned \`refs/head.json\`. Re-run \`prisma-next migrate\` before \`db init\` / \`db update\`.`,
        };
      }
      if (outcome.kind === 'unreachable') {
        return {
          kind: 'extension-path-failure',
          why: `No path in the on-disk migration graph for extension space "${args.spaceId}" reaches the pinned head ref hash "${outcome.pinnedHeadRef.hash}".`,
        };
      }
      if (outcome.kind === 'unsatisfiable') {
        return {
          kind: 'extension-path-failure',
          why: `On-disk migration graph for extension space "${args.spaceId}" reaches the pinned head ref hash but does not cover required invariants: ${outcome.missing.join(', ')}.`,
        };
      }

      const extPlan: MigrationPlan = {
        // `targetId` is patched at the orchestrator level once the
        // app-space plan is known. Documented as awkward-but-contained;
        // out of scope.
        targetId: '' as unknown as MigrationPlan['targetId'],
        origin: currentMarkerHash === null ? null : { storageHash: currentMarkerHash },
        destination: { storageHash: outcome.pinnedHeadRef.hash },
        operations: outcome.pathOps,
        providedInvariants: outcome.providedInvariants,
      };

      return {
        kind: 'ok',
        destinationContract: args.destinationContract,
        plan: extPlan,
        displayOps: outcome.pathOps,
      };
    },
  };
}

interface MakeAppResolverArgs<TFamilyId extends string, TTargetId extends string> {
  readonly spaceId: string;
  readonly migrationsDir: string;
  readonly contract: Contract;
  readonly planner: ReturnType<
    TargetMigrationsCapability<
      TFamilyId,
      TTargetId,
      ControlFamilyInstance<TFamilyId, unknown>
    >['createPlanner']
  >;
  readonly prunedSchemaIR: unknown;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly policy: MigrationOperationPolicy;
}

function makeAppResolver<TFamilyId extends string, TTargetId extends string>(
  args: MakeAppResolverArgs<TFamilyId, TTargetId>,
): SpacePathResolver {
  return {
    spaceId: args.spaceId,
    migrationsDir: args.migrationsDir,
    resolve: async (): Promise<SpaceResolution> => {
      const plannerResult: MigrationPlannerResult = await args.planner.plan({
        contract: args.contract,
        schema: args.prunedSchemaIR,
        policy: args.policy,
        fromContract: null,
        frameworkComponents: args.frameworkComponents,
      });
      if (plannerResult.kind === 'failure') {
        return { kind: 'planning-failure', conflicts: plannerResult.conflicts };
      }
      const appPlan = plannerResult.plan;
      return {
        kind: 'ok',
        destinationContract: args.contract,
        plan: appPlan,
        displayOps: appPlan.operations,
      };
    },
  };
}

// ============================================================================
// Result builders — keep the action-conditional envelope shape collapsed
// at the boundary so the apply / plan paths above stay readable.
// ============================================================================

function wrapPlanResult(args: {
  readonly operations: readonly MigrationPlanOperation[];
  readonly destination: { readonly storageHash: string; readonly profileHash?: string };
  readonly preview: OperationPreview | undefined;
  readonly summary: string;
}): DbInitResult | DbUpdateResult {
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
  return ok(success);
}

function wrapApplyResult(args: {
  readonly operations: readonly MigrationPlanOperation[];
  readonly destination: { readonly storageHash: string; readonly profileHash?: string };
  readonly operationsPlanned: number;
  readonly operationsExecuted: number;
  readonly summary: string;
}): DbInitResult | DbUpdateResult {
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
  return ok(success);
}

function buildPlanningFailure(
  conflicts: DbInitFailure['conflicts'],
): DbInitResult | DbUpdateResult {
  const failure: DbInitFailure | DbUpdateFailure = {
    code: 'PLANNING_FAILED',
    summary: 'Migration planning failed due to conflicts',
    conflicts,
    why: undefined,
    meta: undefined,
  };
  // Single cast at the return boundary: the constructed failure value
  // sits in the runtime intersection of `DbInitFailure` and
  // `DbUpdateFailure`, but TS cannot collapse the union-of-records vs
  // record-of-unions gap (`DbUpdateFailure.code` carries
  // `'DESTRUCTIVE_CHANGES'`, which is not a member of
  // `DbInitFailure.code`). The caller dispatches on the action it
  // kicked off and reads only the narrowed branch.
  return notOk(failure) as DbInitResult | DbUpdateResult;
}

function buildRunnerFailure(args: {
  readonly summary: string;
  readonly why?: string;
  readonly meta: Record<string, unknown>;
}): DbInitResult | DbUpdateResult {
  const failure: DbInitFailure | DbUpdateFailure = {
    code: 'RUNNER_FAILED',
    summary: args.summary,
    why: args.why,
    meta: args.meta,
    conflicts: undefined,
  };
  // See `buildPlanningFailure` for the cast rationale — the runtime
  // value is in the intersection of both failure shapes; TS cannot
  // collapse the union of failure-code literal types across actions.
  return notOk(failure) as DbInitResult | DbUpdateResult;
}

function buildExtensionPathFailure(args: {
  readonly spaceId: string;
  readonly why: string;
}): DbInitResult | DbUpdateResult {
  const failure: DbInitFailure | DbUpdateFailure = {
    code: 'RUNNER_FAILED',
    summary: `Cannot resolve apply path for extension space "${args.spaceId}"`,
    why: args.why,
    meta: { spaceId: args.spaceId },
    conflicts: undefined,
  };
  // See `buildPlanningFailure` for the cast rationale.
  return notOk(failure) as DbInitResult | DbUpdateResult;
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
 * them — defeating the whole point of disjoint per-space ownership.
 */
export function pruneSchemaByOtherSpaceContracts(
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
