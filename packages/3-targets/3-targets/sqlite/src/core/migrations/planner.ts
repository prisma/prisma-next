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
  SchemaDiffIssue,
} from '@prisma-next/framework-components/control';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { buildSqlitePlanDiff } from './diff-database-schema';
import { coalesceSubtreeIssues, filterSiblingOwnedIssues, planIssues } from './issue-planner';
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
 * `plan()` diffs the live schema against the target contract via the one
 * differ (`buildSqlitePlanDiff`, producing node-typed `SchemaDiffIssue[]`)
 * and delegates to `planIssues` with the registered strategies. Strategies
 * absorb groups of related issues into composite recipes (e.g. recreating a
 * table to apply type/nullability/default/constraint changes at once);
 * anything not absorbed by a strategy flows through `mapNodeIssueToCall` in
 * the issue planner as a one-off call.
 *
 * FK-backing indexes are already merged into the expected table node's
 * `indexes` at derivation (`contractToSchemaIR`'s `convertTable`), so
 * `mapNodeIssueToCall` handles them uniformly alongside user-declared
 * indexes — no separate expansion step in the planner.
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
    /**
     * Bare entity names declared by some OTHER contract space in the
     * aggregate (never this plan's own contract) — see
     * {@link SqlMigrationPlannerPlanOptions.siblingOwnedEntityNames}.
     */
    readonly siblingOwnedEntityNames?: ReadonlySet<string>;
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

    const { expected, actual, issues } = this.collectSchemaIssues(options);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);

    const result = planIssues({
      issues,
      expected,
      actual,
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

  /**
   * Diffs the target contract against the live schema via the one differ
   * (the same tree-building `diffSqliteSchemaForVerdict` uses, plus the
   * op-render stamper) and prepares the issue list `planIssues` consumes.
   *
   * Three passes, in order:
   * 1. Subtree coalescing — the differ is total (a missing/extra table also
   *    emits an issue for every column/constraint under it); those nested
   *    issues are redundant once the table-level `CreateTable`/`DropTable`
   *    call already accounts for the whole subtree. Runs FIRST, over the
   *    complete diff: a sibling-owned extra table's column issues must
   *    collapse into its one table-level issue before ownership scoping
   *    runs, because a bare column node carries no table reference to
   *    resolve ownership by — if coalescing ran after scoping filtered the
   *    table-level issue away, the orphaned column issues would survive
   *    and the planner would emit drops against a sibling space's table.
   * 2. `filterSiblingOwnedIssues` — drops `not-expected` findings whose
   *    owning table is declared by a sibling contract space
   *    (`options.siblingOwnedEntityNames`, the orchestration's ownership
   *    query for multi-space plans).
   * 3. Strict-mode extras gating — `not-expected` (extra table/column/
   *    constraint) issues are dropped entirely outside strict mode, mirroring
   *    the retired coordinate walk's `if (strict) { ...extra_* } }` guards:
   *    an additive-only plan must never even consider dropping an unclaimed
   *    object, not just refuse to emit the drop.
   */
  private collectSchemaIssues(options: SqlMigrationPlannerPlanOptions): {
    readonly expected: SqlSchemaIR;
    readonly actual: SqlSchemaIR;
    readonly issues: readonly SchemaDiffIssue[];
  } {
    const allowed = options.policy.allowedOperationClasses;
    const strict = allowed.includes('widening') || allowed.includes('destructive');
    const {
      expected,
      actual,
      issues: rawIssues,
    } = buildSqlitePlanDiff({
      contract: options.contract,
      actualSchema: options.schema,
      frameworkComponents: options.frameworkComponents,
    });
    const coalesced = coalesceSubtreeIssues(rawIssues);
    const scoped = filterSiblingOwnedIssues(coalesced, options.siblingOwnedEntityNames);
    const issues = strict ? scoped : scoped.filter((issue) => issue.reason !== 'not-expected');
    return { expected, actual, issues };
  }
}
