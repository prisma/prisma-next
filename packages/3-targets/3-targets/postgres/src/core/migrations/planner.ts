import {
  normalizeSchemaNativeType,
  parsePostgresDefault,
} from '@prisma-next/adapter-postgres/control';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlannerPlanOptions,
  SqlPlannerFailureResult,
} from '@prisma-next/family-sql/control';
import { extractCodecControlHooks, plannerFailure } from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  MigrationScaffoldContext,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { planIssues } from './issue-planner';
import { TypeScriptRenderablePostgresMigration } from './planner-produced-postgres-migration';
import { dbUpdateCallStrategies } from './planner-strategies';
import type { PlanningMode } from './planner-target-details';

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

interface PlannerConfig {
  readonly defaultSchema: string;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  defaultSchema: 'public',
};

export function createPostgresMigrationPlanner(
  config: Partial<PlannerConfig> = {},
): PostgresMigrationPlanner {
  return new PostgresMigrationPlanner({
    ...DEFAULT_PLANNER_CONFIG,
    ...config,
  });
}

/**
 * Result of `PostgresMigrationPlanner.plan()`. A discriminated union whose
 * success variant carries a `TypeScriptRenderablePostgresMigration` — a
 * class-flow migration object that both the CLI (via
 * `renderTypeScript()`) and the SQL-typed callers (via `operations`,
 * `describe()`, etc.) consume uniformly.
 */
export type PostgresPlanResult =
  | { readonly kind: 'success'; readonly plan: TypeScriptRenderablePostgresMigration }
  | SqlPlannerFailureResult;

/**
 * Postgres migration planner — a thin class-flow wrapper over `planIssues`.
 *
 * `plan()` verifies the live schema against the target contract (producing
 * `SchemaIssue[]`) and delegates to `planIssues` with the full `db update`
 * strategy chain: enum-change, codec-hook storage types, component-declared
 * dependency installs, shared-temp-default / empty-table-guarded NOT-NULL
 * add-column, not-null-backfill, type-change, and nullable-tightening. The
 * issue planner applies operation-class policy gates and emits a single
 * `PostgresOpFactoryCall[]` that drives both the runtime-ops view (via
 * `renderOps`) and the `renderTypeScript()` authoring surface.
 */
export class PostgresMigrationPlanner implements MigrationPlanner<'sql', 'postgres'> {
  constructor(private readonly config: PlannerConfig) {}

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly fromHash?: string;
    readonly schemaName?: string;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  }): PostgresPlanResult {
    return this.planSql(options as SqlMigrationPlannerPlanOptions, options.fromHash ?? '');
  }

  emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface {
    return new TypeScriptRenderablePostgresMigration([], {
      from: context.fromHash,
      to: context.toHash,
    });
  }

  private planSql(options: SqlMigrationPlannerPlanOptions, fromHash: string): PostgresPlanResult {
    const schemaName = options.schemaName ?? this.config.defaultSchema;
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) {
      return policyResult;
    }

    const planningMode = this.resolvePlanningMode(options.policy);
    const schemaIssues = this.collectSchemaIssues(options, planningMode.includeExtraObjects);
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const storageTypes = options.contract.storage.types ?? {};

    const result = planIssues({
      issues: schemaIssues,
      toContract: options.contract,
      // `fromContract` is unavailable at `db update` time; absent old-contract
      // data, strategies like `typeChangeCallStrategy` are inapplicable, so
      // reconciliation is driven by direct destructive ops (via
      // `mapIssueToCall`'s `type_mismatch` / `nullability_mismatch` handlers)
      // rather than data-transform recipes — matching the old walk-schema
      // planner's `db update` behavior.
      fromContract: null,
      schemaName,
      codecHooks,
      storageTypes,
      schema: options.schema,
      policy: options.policy,
      frameworkComponents: options.frameworkComponents,
      strategies: dbUpdateCallStrategies,
    });

    if (!result.ok) {
      return plannerFailure(result.failure);
    }

    return Object.freeze({
      kind: 'success' as const,
      plan: new TypeScriptRenderablePostgresMigration(result.value.calls, {
        from: fromHash,
        to: options.contract.storage.storageHash,
      }),
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

  private resolvePlanningMode(policy: MigrationOperationPolicy): PlanningMode {
    const allowWidening = policy.allowedOperationClasses.includes('widening');
    const allowDestructive = policy.allowedOperationClasses.includes('destructive');
    // `db init` uses additive-only policy and intentionally ignores extras.
    // Any reconciliation-capable policy should inspect extras to reconcile strict equality.
    const includeExtraObjects = allowWidening || allowDestructive;
    return { includeExtraObjects, allowWidening, allowDestructive };
  }

  private collectSchemaIssues(
    options: PlannerOptionsWithComponents,
    strict: boolean,
  ): readonly SchemaIssue[] {
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
    return verifyResult.schema.issues;
  }
}
