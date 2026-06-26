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
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
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
import { assertPostgresRlsPolicy } from '../postgres-rls-policy';
import { isPostgresSchemaIR } from '../postgres-schema-ir';
import { resolveDdlSchemaForNamespaceStorage } from '../postgres-schema-ir-annotations';
import {
  formatPostgresControlPolicySubjectLabel,
  resolvePostgresCallControlPolicySubject,
  resolvePostgresIssueControlPolicySubject,
  resolvePostgresIssueCreationFactoryName,
} from './control-policy';
import { diffPostgresSchema } from './diff-postgres-schema';
import { planIssues } from './issue-planner';
import type { PostgresOpFactoryCall } from './op-factory-call';
import {
  CreatePostgresRlsPolicyCall,
  DropPostgresRlsPolicyCall,
  EnableRowLevelSecurityCall,
} from './op-factory-call';
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

export function createPostgresMigrationPlanner(
  lowerer: ExecuteRequestLowerer,
): PostgresMigrationPlanner {
  return new PostgresMigrationPlanner(lowerer);
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
  readonly #lowerer: ExecuteRequestLowerer | undefined;

  constructor(lowerer?: ExecuteRequestLowerer) {
    this.#lowerer = lowerer;
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
      this.#lowerer,
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

    // Translate RLS diff issues to DDL calls and run through control-policy
    // partition. This runs AFTER the structural planIssues pass so the RLS
    // calls can refer to tables that may have been created in this plan. Every
    // command supplies a `PostgresSchemaIR` here — introspection on the live
    // paths, `contractToSchema` on `migration plan` — so the diff runs the same
    // way on each.
    const rlsCalls = this.planPostgresSchemaDiff(options);
    const rlsPartition = partitionCallsByControlPolicy({
      calls: rlsCalls,
      contract: options.contract,
      resolveControlPolicySubject: (call) =>
        resolvePostgresCallControlPolicySubject(call, options.contract),
      resolveFactoryName: (call) => call.factoryName,
      formatSubjectLabel: (factoryName, subject) =>
        formatPostgresControlPolicySubjectLabel(factoryName, subject, options.contract),
    });

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
    const calls = [...result.value.calls, ...rlsPartition.kept, ...fieldEventPartition.kept];
    const warnings: SqlPlannerConflict[] = [
      ...issuePartition.warnings,
      ...rlsPartition.warnings,
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
        this.#lowerer,
      ),
      ...(warnings.length > 0 ? { warnings: Object.freeze(warnings) } : {}),
    });
  }

  private planPostgresSchemaDiff(
    options: PlannerOptionsWithComponents,
  ): readonly PostgresOpFactoryCall[] {
    if (!isPostgresSchemaIR(options.schema)) {
      // Every command supplies a PostgresSchemaIR here — introspection on the
      // live paths, the contract projection on `migration plan` — so this guard
      // is unreachable in production.
      throw new Error('planPostgresSchemaDiff: options.schema must be a PostgresSchemaIR');
    }
    const diffIssues = diffPostgresSchema({
      contract: options.contract,
      schema: options.schema,
    });

    const allowsDestructive = options.policy.allowedOperationClasses.includes('destructive');
    const calls: PostgresOpFactoryCall[] = [];
    const seenEnableTables = new Set<string>();

    for (const issue of diffIssues) {
      // 'mismatch' is unreachable for content-addressed policies: the wire name
      // encodes the body hash, so two policies sharing a local key (same name)
      // are always equal and isEqualTo never returns false.
      if (issue.outcome === 'missing') {
        assertPostgresRlsPolicy(issue.expected);
        const schemaForTable = resolveDdlSchemaForNamespaceStorage(
          options.contract.storage,
          issue.expected.namespaceId,
          options.schema,
        );
        const tableKey = `${schemaForTable}.${issue.expected.tableName}`;
        if (!seenEnableTables.has(tableKey)) {
          seenEnableTables.add(tableKey);
          calls.push(new EnableRowLevelSecurityCall(schemaForTable, issue.expected.tableName));
        }
        calls.push(
          new CreatePostgresRlsPolicyCall(schemaForTable, issue.expected.tableName, issue.expected),
        );
      } else if (issue.outcome === 'extra' && allowsDestructive) {
        assertPostgresRlsPolicy(issue.actual);
        const schemaForTable = resolveDdlSchemaForNamespaceStorage(
          options.contract.storage,
          issue.actual.namespaceId,
          options.schema,
        );
        calls.push(
          new DropPostgresRlsPolicyCall(schemaForTable, issue.actual.tableName, issue.actual.name),
        );
      }
    }

    return calls;
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
    };
    const verifyResult = verifySqlSchema(verifyOptions);
    // Schema presence is a Postgres-specific concern (no equivalent in
    // SQLite / Mongo), so the issue emission lives in the target layer
    // rather than in the family verifier. Stitch it in here so a single
    // `SchemaIssue[]` flows through `planIssues` and the planner emits
    // CREATE SCHEMA in the dep bucket before any CreateTableCall.
    // RLS policy drift is handled separately via diffPostgresSchema → planPostgresSchemaDiff.
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
