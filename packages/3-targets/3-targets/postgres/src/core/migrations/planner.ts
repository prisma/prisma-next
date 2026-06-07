import type { Contract } from '@prisma-next/contract/types';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlannerPlanOptions,
  SqlPlannerConflict,
  SqlPlannerFailureResult,
} from '@prisma-next/family-sql/control';
import {
  extractCodecControlHooks,
  partitionCallsByControlPolicy,
  partitionIssuesByControlPolicy,
  planFieldEventOperations,
  plannerFailure,
} from '@prisma-next/family-sql/control';
import type { Lowerer } from '@prisma-next/family-sql/control-adapter';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  MigrationScaffoldContext,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { parsePostgresDefault } from '../default-normalizer';
import { normalizeSchemaNativeType } from '../native-type-normalizer';
import {
  formatPostgresControlPolicySubjectLabel,
  resolvePostgresCallControlPolicySubject,
  resolvePostgresIssueControlPolicySubject,
  resolvePostgresIssueCreationFactoryName,
} from './control-policy';
import { createResolveExistingEnumValues } from './enum-planning';
import { planIssues } from './issue-planner';
import type { PostgresOpFactoryCall } from './op-factory-call';
import { TypeScriptRenderablePostgresMigration } from './planner-produced-postgres-migration';
import { postgresPlannerStrategies } from './planner-strategies';
import { verifyPostgresNamespacePresence } from './verify-postgres-namespaces';

type PlannerFrameworkComponents = SqlMigrationPlannerPlanOptions extends {
  readonly frameworkComponents: infer T;
}
  ? T
  : ReadonlyArray<unknown>;

type PlannerOptionsWithComponents = SqlMigrationPlannerPlanOptions & {
  readonly frameworkComponents: PlannerFrameworkComponents;
};

type VerifySqlSchemaOptionsWithComponents = Parameters<typeof verifySqlSchema>[0] & {
  readonly frameworkComponents: PlannerFrameworkComponents;
};

export function createPostgresMigrationPlanner(lower: Lowerer): PostgresMigrationPlanner {
  return new PostgresMigrationPlanner(lower);
}

/**
 * Result of `PostgresMigrationPlanner.plan()`. A discriminated union whose
 * success variant carries a `TypeScriptRenderablePostgresMigration` — a
 * migration object that both the CLI (via `renderTypeScript()`) and the
 * SQL-typed callers (via `operations`, `describe()`, etc.) consume
 * uniformly.
 */
export type PostgresPlanResult =
  | {
      readonly kind: 'success';
      readonly plan: TypeScriptRenderablePostgresMigration;
      readonly warnings?: readonly SqlPlannerConflict[];
    }
  | SqlPlannerFailureResult;

/**
 * Postgres migration planner — a thin wrapper over `planIssues`.
 *
 * `plan()` verifies the live schema against the target contract (producing
 * `SchemaIssue[]`) and delegates to `planIssues` with the unified
 * `postgresPlannerStrategies` list: enum-change, NOT-NULL backfill,
 * type-change, nullable-tightening, codec-hook storage types,
 * component-declared dependency installs, and shared-temp-default /
 * empty-table-guarded NOT-NULL add-column. The same strategy list runs for
 * `migration plan`, `db update`, and `db init`; behavior diverges purely on
 * `policy.allowedOperationClasses` (the data-safe strategies short-circuit
 * when `'data'` is excluded). The issue planner applies operation-class
 * policy gates and emits a single `PostgresOpFactoryCall[]` that drives both
 * the runtime-ops view (via `renderOps`) and the `renderTypeScript()`
 * authoring surface.
 */
export class PostgresMigrationPlanner implements MigrationPlanner<'sql', 'postgres'> {
  readonly #lower: Lowerer | undefined;

  constructor(lower?: Lowerer) {
    this.#lower = lower;
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /**
     * The "from" contract (state the planner assumes the database starts
     * at), or `null` for reconciliation flows. Only `migration plan` ever
     * supplies a non-null value; `db update` / `db init` reconcile against
     * the live schema and pass `null`. When present alongside the
     * `'data'` operation class, strategies that need from/to column-shape
     * comparisons (unsafe type change, nullability tightening) activate.
     *
     * Typed as the framework `Contract | null` to satisfy the
     * `MigrationPlanner` interface contract; `planSql` narrows to the SQL
     * shape via `SqlMigrationPlannerPlanOptions`. Used to populate
     * `describe().from` on the produced plan as
     * `fromContract?.storage.storageHash ?? null`.
     */
    readonly fromContract: Contract | null;
    readonly schemaName?: string;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
    /**
     * Contract space this plan applies to. Stamped onto the produced
     * {@link TypeScriptRenderablePostgresMigration.spaceId} so the runner keys
     * the marker row by the right space.
     */
    readonly spaceId: string;
  }): PostgresPlanResult {
    return this.planSql(options as SqlMigrationPlannerPlanOptions);
  }

  emptyMigration(
    context: MigrationScaffoldContext,
    spaceId: string,
  ): MigrationPlanWithAuthoringSurface {
    return new TypeScriptRenderablePostgresMigration(
      [],
      {
        from: context.fromHash,
        to: context.toHash,
      },
      spaceId,
      this.#lower,
    );
  }

  private planSql(options: SqlMigrationPlannerPlanOptions): PostgresPlanResult {
    const schemaName =
      options.schemaName ??
      Object.keys(options.contract.storage.namespaces).find((id) => id !== UNBOUND_NAMESPACE_ID) ??
      UNBOUND_NAMESPACE_ID;
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) {
      return policyResult;
    }

    const schemaIssues = this.collectSchemaIssues(options);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const storageTypes = options.contract.storage.types ?? {};

    // Input-side control-policy partition. `external` / `observed` subjects
    // — and non-creation issues for `tolerated` subjects — are dropped from
    // the planner's input entirely; the planner never observes them, never
    // diffs them, never generates DDL for them. Suppression warnings are
    // built directly from the suppressed partition (one per subject), so the
    // user-visible message survives even when the planner would have failed
    // to model the subject's live shape.
    const issuePartition = partitionIssuesByControlPolicy({
      issues: schemaIssues,
      contract: options.contract,
      resolveControlPolicySubject: (issue) =>
        resolvePostgresIssueControlPolicySubject(issue, options.contract),
      resolveCreationFactoryName: resolvePostgresIssueCreationFactoryName,
      formatSubjectLabel: (factoryName, subject) =>
        formatPostgresControlPolicySubjectLabel(factoryName, subject, options.contract),
    });

    const result = planIssues({
      issues: issuePartition.plannable,
      toContract: options.contract,
      // `fromContract` is only supplied by `migration plan`. It is `null` for
      // `db update` / `db init`, which means data-safety strategies needing
      // from/to comparisons (unsafe type change, nullable tightening) are
      // inapplicable there — reconciliation falls through to
      // `mapIssueToCall`'s direct destructive handlers.
      fromContract: options.fromContract,
      schemaName,
      codecHooks,
      storageTypes,
      schema: options.schema,
      policy: options.policy,
      frameworkComponents: options.frameworkComponents,
      strategies: postgresPlannerStrategies,
    });

    if (!result.ok) {
      return plannerFailure(result.failure);
    }

    // Inline `onFieldEvent`-emitted ops after structural DDL. The fixed
    // ordering is `structural → added → dropped → altered`, with
    // within-group sorting by `(tableName, fieldName)` so re-emits are
    // byte-stable. The hook fires only at the application emitter —
    // extension-space planning never reaches this helper.
    const fieldEventOps = planFieldEventOperations({
      priorContract: options.fromContract,
      newContract: options.contract,
      codecHooks,
    });
    // Codec hook ops are target-agnostic `OpFactoryCall`; Postgres planning
    // lifts them at this integration boundary (see field-event-planner JSDoc).
    const fieldEventPostgresCalls = blindCast<
      readonly PostgresOpFactoryCall[],
      'Codec hook ops conform to PostgresOpFactoryCall at the app emitter boundary'
    >(fieldEventOps);
    const fieldEventPartition = partitionCallsByControlPolicy({
      calls: fieldEventPostgresCalls,
      contract: options.contract,
      resolveControlPolicySubject: (call) =>
        resolvePostgresCallControlPolicySubject(call, options.contract),
      resolveFactoryName: (call) => call.factoryName,
      formatSubjectLabel: (factoryName, subject) =>
        formatPostgresControlPolicySubjectLabel(factoryName, subject, options.contract),
    });
    const calls = [...result.value.calls, ...fieldEventPartition.kept];
    const warnings: SqlPlannerConflict[] = [
      ...issuePartition.warnings,
      ...fieldEventPartition.warnings,
    ];

    return Object.freeze({
      kind: 'success' as const,
      plan: new TypeScriptRenderablePostgresMigration(
        calls,
        {
          from: options.fromContract?.storage.storageHash ?? null,
          to: options.contract.storage.storageHash,
        },
        options.spaceId,
        this.#lower,
      ),
      ...(warnings.length > 0 ? { warnings: Object.freeze(warnings) } : {}),
    });
  }

  private ensureAdditivePolicy(policy: MigrationOperationPolicy) {
    if (!policy.allowedOperationClasses.includes('additive')) {
      return plannerFailure([
        {
          kind: 'unsupportedOperation',
          summary: 'Migration planner requires additive operations be allowed',
          why: 'The planner requires the "additive" operation class to be allowed in the policy.',
        },
      ]);
    }
    return null;
  }

  private collectSchemaIssues(options: PlannerOptionsWithComponents): readonly SchemaIssue[] {
    // `db init` uses additive-only policy and intentionally ignores extra
    // schema objects. Any reconciliation-capable policy (widening or
    // destructive) must inspect extras to reconcile strict equality.
    const allowed = options.policy.allowedOperationClasses;
    const strict = allowed.includes('widening') || allowed.includes('destructive');
    const verifyOptions: VerifySqlSchemaOptionsWithComponents = {
      contract: options.contract,
      schema: options.schema,
      strict,
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
      normalizeDefault: parsePostgresDefault,
      normalizeNativeType: normalizeSchemaNativeType,
      resolveExistingEnumValues: createResolveExistingEnumValues(options.contract.storage),
    };
    const verifyResult = verifySqlSchema(verifyOptions);
    // Schema presence is a Postgres-specific concern (no equivalent in
    // SQLite / Mongo), so the issue emission lives in the target layer
    // rather than in the family verifier. Stitch it in here so a single
    // `SchemaIssue[]` flows through `planIssues` and the planner emits
    // CREATE SCHEMA in the dep bucket before any CreateTableCall.
    const namespaceIssues = verifyPostgresNamespacePresence({
      contract: options.contract,
      schema: options.schema,
    });
    if (namespaceIssues.length === 0) {
      return verifyResult.schema.issues;
    }
    return [...namespaceIssues, ...verifyResult.schema.issues];
  }
}
