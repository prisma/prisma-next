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
import { postgresPlannerStrategies } from './planner-strategies';
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
 * migration object that both the CLI (via `renderTypeScript()`) and the
 * SQL-typed callers (via `operations`, `describe()`, etc.) consume
 * uniformly.
 */
export type PostgresPlanResult =
  | { readonly kind: 'success'; readonly plan: TypeScriptRenderablePostgresMigration }
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
  constructor(private readonly config: PlannerConfig) {}

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly fromHash?: string;
    /**
     * The "from" contract (state the planner assumes the database starts
     * at). Only `migration plan` supplies this; `db update` / `db init`
     * reconcile against the live schema with no old contract. When present
     * alongside the `'data'` operation class, strategies that need from/to
     * column shape comparisons (unsafe type change, nullability tightening)
     * activate.
     */
    readonly fromContract?: unknown;
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
      // `fromContract` is only supplied by `migration plan`. It is `null` for
      // `db update` / `db init`, which means data-safety strategies needing
      // from/to comparisons (unsafe type change, nullable tightening) are
      // inapplicable there — reconciliation falls through to
      // `mapIssueToCall`'s direct destructive handlers.
      fromContract: options.fromContract ?? null,
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
