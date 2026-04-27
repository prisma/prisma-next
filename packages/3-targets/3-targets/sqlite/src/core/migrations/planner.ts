import { normalizeSqliteNativeType, parseSqliteDefault } from '@prisma-next/adapter-sqlite/control';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlPlannerFailureResult,
} from '@prisma-next/family-sql/control';
import { extractCodecControlHooks, plannerFailure } from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanner,
  MigrationScaffoldContext,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { planIssues } from './issue-planner';
import {
  type SqliteMigrationDestinationInfo,
  TypeScriptRenderableSqliteMigration,
} from './planner-produced-sqlite-migration';
import { sqlitePlannerStrategies } from './planner-strategies';
import type { SqlitePlanTargetDetails } from './planner-target-details';

export function createSqliteMigrationPlanner(): SqliteMigrationPlanner {
  return new SqliteMigrationPlanner();
}

export type SqlitePlanResult =
  | { readonly kind: 'success'; readonly plan: TypeScriptRenderableSqliteMigration }
  | SqlPlannerFailureResult;

/**
 * SQLite migration planner — a thin wrapper over `planIssues`.
 *
 * `plan()` verifies the live schema against the target contract (producing
 * `SchemaIssue[]`) and delegates to `planIssues` with
 * `sqlitePlannerStrategies`. The only strategy is `recreateTableStrategy`,
 * which absorbs type/nullability/default/constraint mismatches for each
 * table into a single recreate-table operation. Everything else (creates,
 * adds, drops) flows through `mapIssueToCall` in the issue planner.
 *
 * FK-backing indexes are surfaced by `verifySqlSchema`'s index expansion
 * (see `verify-sql-schema.ts:459-469`), so `mapIssueToCall` handles them
 * uniformly alongside user-declared indexes.
 */
export class SqliteMigrationPlanner
  implements SqlMigrationPlanner<SqlitePlanTargetDetails>, MigrationPlanner<'sql', 'sqlite'>
{
  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly fromHash?: string;
    readonly fromContract?: unknown;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  }): SqlitePlanResult {
    return this.planSql(options as SqlMigrationPlannerPlanOptions, options.fromHash ?? '');
  }

  emptyMigration(context: MigrationScaffoldContext): TypeScriptRenderableSqliteMigration {
    return new TypeScriptRenderableSqliteMigration([], {
      from: context.fromHash,
      to: context.toHash,
    });
  }

  private planSql(options: SqlMigrationPlannerPlanOptions, fromHash: string): SqlitePlanResult {
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) return policyResult;

    const schemaIssues = this.collectSchemaIssues(options);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const storageTypes = options.contract.storage.types ?? {};

    const result = planIssues({
      issues: schemaIssues,
      toContract: options.contract,
      fromContract: options.fromContract ?? null,
      codecHooks,
      storageTypes,
      schema: options.schema,
      policy: options.policy,
      frameworkComponents: options.frameworkComponents,
      strategies: sqlitePlannerStrategies,
    });

    if (!result.ok) {
      return plannerFailure(result.failure);
    }

    const destination: SqliteMigrationDestinationInfo = {
      storageHash: options.contract.storage.storageHash,
      ...(options.contract.profileHash !== undefined
        ? { profileHash: options.contract.profileHash }
        : {}),
    };

    return Object.freeze({
      kind: 'success' as const,
      plan: new TypeScriptRenderableSqliteMigration(
        result.value.calls,
        { from: fromHash, to: options.contract.storage.storageHash },
        destination,
      ),
    });
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
    const verifyResult = verifySqlSchema({
      contract: options.contract,
      schema: options.schema,
      strict,
      typeMetadataRegistry: new Map(),
      frameworkComponents: options.frameworkComponents,
      normalizeDefault: parseSqliteDefault,
      normalizeNativeType: normalizeSqliteNativeType,
    });
    return verifyResult.schema.issues;
  }
}
