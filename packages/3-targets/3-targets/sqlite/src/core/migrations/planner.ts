import type { Contract } from '@prisma-next/contract/types';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlPlannerFailureResult,
} from '@prisma-next/family-sql/control';
import {
  extractCodecControlHooks,
  planFieldEventOperations,
  plannerFailure,
} from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanner,
  MigrationScaffoldContext,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import type { SqlSchemaIR, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { diffSqliteDatabaseSchema } from './diff-database-schema';
import { planIssues } from './issue-planner';
import {
  type SqliteMigrationDestinationInfo,
  TypeScriptRenderableSqliteMigration,
} from './planner-produced-sqlite-migration';
import { sqlitePlannerStrategies } from './planner-strategies';
import type { SqlitePlanTargetDetails } from './planner-target-details';

export function createSqliteMigrationPlanner(
  lowerer: ExecuteRequestLowerer,
): SqliteMigrationPlanner {
  return new SqliteMigrationPlanner(lowerer);
}

export type SqlitePlanResult =
  | { readonly kind: 'success'; readonly plan: TypeScriptRenderableSqliteMigration }
  | SqlPlannerFailureResult;

/**
 * SQLite migration planner — a thin wrapper over `planIssues`.
 *
 * `plan()` verifies the live schema against the target contract (producing
 * `SchemaIssue[]`) and delegates to `planIssues` with the registered
 * strategies. Strategies absorb groups of related issues into composite
 * recipes (e.g. recreating a table to apply type/nullability/default/
 * constraint changes at once); anything not absorbed by a strategy flows
 * through `mapIssueToCall` in the issue planner as a one-off call.
 *
 * FK-backing indexes are surfaced by `verifySqlSchema`'s index expansion
 * (see `verify-sql-schema.ts:459-469`), so `mapIssueToCall` handles them
 * uniformly alongside user-declared indexes.
 */
export class SqliteMigrationPlanner
  implements SqlMigrationPlanner<SqlitePlanTargetDetails>, MigrationPlanner<'sql', 'sqlite'>
{
  readonly #lowerer: ExecuteRequestLowerer;

  constructor(lowerer: ExecuteRequestLowerer) {
    this.#lowerer = lowerer;
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /**
     * The "from" contract (state the planner assumes the database starts at),
     * or `null` for reconciliation flows.
     *
     * Typed as the framework `Contract | null` to satisfy the
     * `MigrationPlanner` interface contract; `planSql` narrows to the SQL
     * shape via `SqlMigrationPlannerPlanOptions`. Used to populate
     * `describe().from` on the produced plan as
     * `fromContract?.storage.storageHash ?? null`.
     */
    readonly fromContract: Contract | null;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
    /**
     * Contract space this plan applies to. Stamped onto the produced
     * {@link TypeScriptRenderableSqliteMigration.spaceId} so the runner keys
     * the marker row by the right space.
     */
    readonly spaceId: string;
  }): SqlitePlanResult {
    return this.planSql(options as SqlMigrationPlannerPlanOptions);
  }

  emptyMigration(
    context: MigrationScaffoldContext,
    spaceId: string,
  ): TypeScriptRenderableSqliteMigration {
    return new TypeScriptRenderableSqliteMigration(
      [],
      {
        from: context.fromHash,
        to: context.toHash,
      },
      spaceId,
      undefined,
      this.#lowerer,
    );
  }

  private planSql(options: SqlMigrationPlannerPlanOptions): SqlitePlanResult {
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) return policyResult;

    const schemaIssues = this.collectSchemaIssues(options);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const storageTypes = options.contract.storage.types ?? {};

    const result = planIssues({
      issues: schemaIssues,
      toContract: options.contract,
      fromContract: options.fromContract,
      codecHooks,
      storageTypes,
      schema: sqliteFlatSchema(options.schema),
      policy: options.policy,
      frameworkComponents: options.frameworkComponents,
      strategies: sqlitePlannerStrategies,
    });

    if (!result.ok) {
      return plannerFailure(result.failure);
    }

    // Codec lifecycle hook (T2.2): inline `onFieldEvent`-emitted ops after
    // structural DDL. Sub-spec § 5 fixes the ordering as
    // `structural → added → dropped → altered`, with within-group sorting by
    // `(tableName, fieldName)` deterministic for byte-stable re-emits.
    // Hook fires only at the application emitter — extension-space planning
    // (M2 R2) never reaches this helper.
    const fieldEventOps = planFieldEventOperations({
      priorContract: options.fromContract,
      newContract: options.contract,
      codecHooks,
    });
    // Codec-emitted calls already conform to `OpFactoryCall` — render +
    // toOp + importRequirements ride directly through the same emit path
    // as structural ops, no `RawSqlCall` wrap.
    const calls = [...result.value.calls, ...fieldEventOps];

    const destination: SqliteMigrationDestinationInfo = {
      storageHash: options.contract.storage.storageHash,
      ...(options.contract.profileHash !== undefined
        ? { profileHash: options.contract.profileHash }
        : {}),
    };

    return {
      kind: 'success' as const,
      plan: new TypeScriptRenderableSqliteMigration(
        calls,
        {
          from: options.fromContract?.storage.storageHash ?? null,
          to: options.contract.storage.storageHash,
        },
        options.spaceId,
        destination,
        this.#lowerer,
      ),
    };
  }

  private ensureAdditivePolicy(policy: MigrationOperationPolicy): SqlPlannerFailureResult | null {
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

  private collectSchemaIssues(options: SqlMigrationPlannerPlanOptions): readonly SchemaIssue[] {
    const allowed = options.policy.allowedOperationClasses;
    const strict = allowed.includes('widening') || allowed.includes('destructive');
    const verifyResult = diffSqliteDatabaseSchema({
      contract: options.contract,
      actualSchema: options.schema,
      strict,
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
    });
    return verifyResult.schema.issues;
  }
}

/**
 * SQLite has a single, flat schema — its introspected node IS a per-schema
 * `SqlSchemaIR`, never the multi-namespace tree the Postgres target builds. The
 * planner consumes that flat shape directly when building ops.
 */
function sqliteFlatSchema(schema: SqlSchemaIRNode): SqlSchemaIR {
  return blindCast<SqlSchemaIR, 'the SQLite introspected node is a flat per-schema SqlSchemaIR'>(
    schema,
  );
}
