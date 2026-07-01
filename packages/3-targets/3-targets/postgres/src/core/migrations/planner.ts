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
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  MigrationScaffoldContext,
  SchemaDiffIssue,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { PostgresRlsPolicy } from '../postgres-rls-policy';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import { resolveDdlSchemaForNamespaceStorage } from '../schema-ir/postgres-schema-ir-annotations';
import {
  formatPostgresControlPolicySubjectLabel,
  resolvePostgresCallControlPolicySubject,
  resolvePostgresIssueControlPolicySubject,
  resolvePostgresIssueCreationFactoryName,
} from './control-policy';
import { diffPostgresDatabaseSchema } from './diff-database-schema';
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

    // One combined database-schema diff drives the whole plan: the relational
    // findings (+ namespace presence) become structural DDL via `planIssues`,
    // the policy findings become RLS ops via `planPostgresSchemaDiff`. Verify
    // runs the same `diffPostgresDatabaseSchema` and rejects on non-empty.
    PostgresDatabaseSchemaNode.assert(options.schema);
    const databaseDiff = diffPostgresDatabaseSchema({
      contract: options.contract,
      actualSchema: options.schema,
      strict:
        options.policy.allowedOperationClasses.includes('widening') ||
        options.policy.allowedOperationClasses.includes('destructive'),
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
    });
    const schemaIssues = this.collectSchemaIssues(options, databaseDiff.schema.issues);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const storageTypes = options.contract.storage.types ?? {};
    // The strategy layer reads the live schema by bare table name for
    // existence checks (shared-temp-default safety, FK/unique probes). It
    // takes the per-schema namespace node, never the whole tree root — and
    // never a flat merge of every namespace (that would collide same-named
    // tables across schemas). Single-schema is the one node matching the
    // planner's resolved schema name; multi-schema scoping is CF-2.
    const relationalSchema = relationalNamespaceNode(options.schema, schemaName);

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
      ...ifDefined('schema', relationalSchema),
      policy: options.policy,
      frameworkComponents: options.frameworkComponents,
      strategies: postgresPlannerStrategies,
    });

    if (!result.ok) {
      return plannerFailure(result.failure);
    }

    const schemaDiffCalls = this.planPostgresSchemaDiff(
      options,
      databaseDiff.schema.schemaDiffIssues,
    );
    const schemaDiffPartition = partitionCallsByControlPolicy({
      calls: schemaDiffCalls,
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
    const calls = [...result.value.calls, ...schemaDiffPartition.kept, ...fieldEventPartition.kept];
    const warnings: SqlPlannerConflict[] = [
      ...issuePartition.warnings,
      ...schemaDiffPartition.warnings,
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

  /**
   * Maps the RLS policy presence findings of the shared
   * `diffPostgresDatabaseSchema` (already ownership-filtered) into
   * `ENABLE RLS` / `CREATE POLICY` / `DROP POLICY` ops. It no longer re-diffs —
   * it consumes the `schemaDiffIssues` of the one combined diff.
   */
  private planPostgresSchemaDiff(
    options: PlannerOptionsWithComponents,
    filteredDiffIssues: readonly SchemaDiffIssue[],
  ): readonly PostgresOpFactoryCall[] {
    const allowsDestructive = options.policy.allowedOperationClasses.includes('destructive');
    const calls: PostgresOpFactoryCall[] = [];
    const seenEnableTables = new Set<string>();

    for (const issue of filteredDiffIssues) {
      // 'mismatch' is unreachable for content-addressed policies: the wire name
      // encodes the body hash, so two policies sharing a local key (same name)
      // are always equal and isEqualTo never returns false.
      if (issue.outcome === 'missing') {
        PostgresPolicySchemaNode.assert(issue.expected);
        // issue.expected.namespaceId is the DDL schema name (resolved during projection);
        // this re-resolution is a no-op as long as PostgresSchema.ddlSchemaName() returns this.id.
        const schemaForTable = resolveDdlSchemaForNamespaceStorage(
          options.contract.storage,
          issue.expected.namespaceId,
        );
        const tableKey = `${schemaForTable}.${issue.expected.tableName}`;
        if (!seenEnableTables.has(tableKey)) {
          seenEnableTables.add(tableKey);
          calls.push(new EnableRowLevelSecurityCall(schemaForTable, issue.expected.tableName));
        }
        calls.push(
          new CreatePostgresRlsPolicyCall(
            schemaForTable,
            issue.expected.tableName,
            policyNodeToContractPolicy(issue.expected),
          ),
        );
      } else if (issue.outcome === 'extra' && allowsDestructive) {
        PostgresPolicySchemaNode.assert(issue.actual);
        const schemaForTable = resolveDdlSchemaForNamespaceStorage(
          options.contract.storage,
          issue.actual.namespaceId,
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

  /**
   * The structural issue list `planIssues` consumes: the relational findings
   * from the shared `diffPostgresDatabaseSchema` plus namespace presence.
   *
   * Schema presence (`missing_schema` → `CREATE SCHEMA`) is a planner-only
   * op-generation concern, so it is stitched in here rather than inside the
   * shared diff — verify never needs it (a missing schema already surfaces as
   * `missing_table` in the relational findings). It reads `existingSchemas` off
   * the database root (CF-1) so it takes the whole tree. Policy drift is handled
   * separately via `planPostgresSchemaDiff` from the same shared diff's
   * `schemaDiffIssues`.
   */
  private collectSchemaIssues(
    options: PlannerOptionsWithComponents,
    relationalIssues: readonly SchemaIssue[],
  ): readonly SchemaIssue[] {
    const namespaceIssues = verifyPostgresNamespacePresence({
      contract: options.contract,
      schema: options.schema,
    });
    if (namespaceIssues.length === 0) {
      return relationalIssues;
    }
    return [...namespaceIssues, ...relationalIssues];
  }
}

/**
 * Selects the per-schema namespace node the relational strategy layer probes
 * for live-table existence. Prefers the node matching the planner's resolved
 * schema name; otherwise the sole namespace node (the single-schema common
 * case). Returns `undefined` when the tree carries no namespaces, so the
 * strategy context falls back to its empty-schema default.
 *
 * Multi-schema selection by name is CF-2: the relational strategies key tables
 * by bare name, so only one namespace's tables can be probed at a time.
 */
function relationalNamespaceNode(
  schema: PostgresDatabaseSchemaNode,
  schemaName: string,
): SqlSchemaIR | undefined {
  const namespaceNodes = Object.values(PostgresDatabaseSchemaNode.ensure(schema).namespaces);
  const byName = namespaceNodes.find((node) => node.schemaName === schemaName);
  return byName ?? namespaceNodes[0];
}

/**
 * Rebuilds the serialized `PostgresRlsPolicy` contract entity from a policy
 * schema node. The migration op (`CreatePostgresRlsPolicyCall`) carries the
 * authored contract entity — its `renderTypeScript`/`createRlsPolicy` paths
 * serialize it — so the planner converts the diff node back to the entity the
 * call type expects, preserving byte-identical migration output.
 */
function policyNodeToContractPolicy(node: PostgresPolicySchemaNode): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    name: node.name,
    prefix: node.prefix,
    tableName: node.tableName,
    namespaceId: node.namespaceId,
    operation: node.operation,
    roles: [...node.roles],
    ...ifDefined('using', node.using),
    ...ifDefined('withCheck', node.withCheck),
    permissive: node.permissive,
  });
}
