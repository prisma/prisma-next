import {
  normalizeSchemaNativeType,
  parsePostgresDefault,
} from '@prisma-next/adapter-postgres/control';
import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  ComponentDatabaseDependency,
  MigrationOperationPolicy,
  SqlMigrationPlannerPlanOptions,
  SqlMigrationPlanOperation,
  SqlPlannerConflict,
  SqlPlannerFailureResult,
} from '@prisma-next/family-sql/control';
import {
  collectInitDependencies,
  extractCodecControlHooks,
  plannerFailure,
} from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  MigrationScaffoldContext,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import type {
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { planIssues } from './issue-planner';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  CreateIndexCall,
  CreateTableCall,
  type PostgresOpFactoryCall,
  RawSqlCall,
} from './op-factory-call';
import type { ColumnSpec, ForeignKeySpec } from './operations/shared';
import {
  buildAddColumnSql,
  buildColumnDefaultSql,
  buildColumnTypeSql,
} from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';
import { TypeScriptRenderablePostgresMigration } from './planner-produced-postgres-migration';
import {
  buildAddColumnOperationIdentity,
  buildAddNotNullColumnWithTemporaryDefaultOperation,
} from './planner-recipes';
import { buildReconciliationPlan } from './planner-reconciliation';
import {
  buildSchemaLookupMap,
  hasForeignKey,
  hasIndex,
  hasUniqueConstraint,
  type SchemaTableLookup,
} from './planner-schema-lookup';
import {
  columnExistsCheck,
  columnNullabilityCheck,
  qualifyTableName,
  tableIsEmptyCheck,
} from './planner-sql-checks';
import {
  buildTargetDetails,
  type OperationClass,
  type PlanningMode,
  type PostgresPlanTargetDetails,
} from './planner-target-details';

/**
 * Lift a pre-built `SqlMigrationPlanOperation` into class-flow IR.
 *
 * Ops produced outside the planner's direct IR emission — by codec control
 * hooks (`planTypeOperations`), component database dependency install
 * arrays, the multi-step add-NOT-NULL-with-temporary-default recipe, and any
 * other raw-op escape hatch — are wrapped in a `RawSqlCall` so the entire
 * plan can flow through a single `PostgresOpFactoryCall[]` pipeline.
 *
 * As upstream producers are retargeted to emit structured call classes
 * (`CreateExtensionCall`, `CreateSchemaCall`, etc.) directly, call sites here
 * shrink and this helper narrows to a last-resort launderer for truly opaque
 * SQL snippets.
 */
function liftOpToCall(op: SqlMigrationPlanOperation<PostgresPlanTargetDetails>): RawSqlCall {
  return new RawSqlCall(op);
}

function toColumnSpec(
  name: string,
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance>,
): ColumnSpec {
  return {
    name,
    typeSql: buildColumnTypeSql(column, codecHooks, storageTypes),
    defaultSql: buildColumnDefaultSql(column.default, column),
    nullable: column.nullable,
  };
}

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

type PlannerDatabaseDependency = {
  readonly id: string;
  readonly label: string;
  readonly install: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
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
 * Postgres migration planner.
 *
 * Implements the framework's `MigrationPlanner<'sql', 'postgres'>` directly.
 * Both `plan()` and `emptyMigration()` return a
 * `TypeScriptRenderablePostgresMigration`: the class-flow IR
 * (`PostgresOpFactoryCall[]`) drives both the runtime-ops view
 * (via `renderOps`) and the `renderTypeScript()` authoring surface.
 *
 * `plan()` accepts the framework's option shape (with `contract`/`schema`
 * typed as `unknown`); SQL-typed callers may pass the more specific
 * `SqlMigrationPlannerPlanOptions`, since those structurally satisfy the
 * looser framework contract. Internally we treat options as the SQL-typed
 * superset so the existing planner logic stays identical.
 */
export class PostgresMigrationPlanner implements MigrationPlanner<'sql', 'postgres'> {
  constructor(private readonly config: PlannerConfig) {}

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly fromHash?: string;
    readonly fromContract?: unknown;
    readonly schemaName?: string;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  }): PostgresPlanResult {
    return this.planSql(
      options as SqlMigrationPlannerPlanOptions,
      options.fromHash ?? '',
      (options.fromContract ?? null) as Contract<SqlStorage> | null,
    );
  }

  emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface {
    return new TypeScriptRenderablePostgresMigration([], {
      from: context.fromHash,
      to: context.toHash,
    });
  }

  private planSql(
    options: SqlMigrationPlannerPlanOptions,
    fromHash: string,
    fromContract: Contract<SqlStorage> | null,
  ): PostgresPlanResult {
    const schemaName = options.schemaName ?? this.config.defaultSchema;
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) {
      return policyResult;
    }

    const planningMode = this.resolvePlanningMode(options.policy);
    const schemaIssues = this.collectSchemaIssues(options, planningMode.includeExtraObjects);

    // Extract codec control hooks once at entry point for reuse across all operations.
    // This avoids repeated iteration over frameworkComponents for each method that needs hooks.
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);

    const storageTypes = options.contract.storage.types ?? {};

    // Dispatch on the `'data'` operation class — `migration plan` includes it
    // and wants `DataTransformCall(PlaceholderExpression)` stubs the user
    // hand-fills; `db update` / `db init` do not include it and need the
    // walk-schema planner's auto-fill behavior (e.g. NOT NULL backfill via
    // a temporary default). Phase 4 collapses these two paths.
    if (options.policy.allowedOperationClasses.includes('data')) {
      return this.planViaIssues({
        options,
        fromHash,
        fromContract,
        schemaName,
        schemaIssues,
        codecHooks,
        storageTypes,
      });
    }

    return this.planViaWalkSchema({
      options,
      fromHash,
      schemaName,
      schemaIssues,
      planningMode,
      codecHooks,
      storageTypes,
    });
  }

  /**
   * `migration plan` path: feeds schema issues into `planIssues` so the
   * data-safety strategies (NOT-NULL backfill, type change, nullable
   * tightening, enum rebuild) run and emit `DataTransformCall` placeholders.
   *
   * Database-dependency and storage-type calls are still produced by the
   * walk-schema helpers because the issue planner only handles
   * `dependency_missing` for already-introspected gaps and does not own
   * codec-hook-driven storage-type setup. Those streams are concatenated in
   * the same dependency-first ordering used by the walk-schema path.
   */
  private planViaIssues(args: {
    readonly options: SqlMigrationPlannerPlanOptions;
    readonly fromHash: string;
    readonly fromContract: Contract<SqlStorage> | null;
    readonly schemaName: string;
    readonly schemaIssues: readonly SchemaIssue[];
    readonly codecHooks: Map<string, CodecControlHooks>;
    readonly storageTypes: Record<string, StorageTypeInstance>;
  }): PostgresPlanResult {
    const { options, fromHash, fromContract, schemaName, schemaIssues, codecHooks, storageTypes } =
      args;

    const storageTypePlan = this.buildStorageTypeOperations(options, schemaName, codecHooks);
    if (storageTypePlan.conflicts.length > 0) {
      return plannerFailure(storageTypePlan.conflicts);
    }

    // `dependency_missing` issues are owned by
    // `buildDatabaseDependencyOperations`, which consumes
    // framework-component-declared install operations directly. Filter them
    // out so `planIssues` doesn't double-handle them and so the planner
    // doesn't fail on dependency IDs the issue planner can't classify (e.g.
    // `postgres.extension.vector` declared by the pgvector extension).
    //
    // `type_missing` issues are owned by `buildStorageTypeOperations` via
    // codec hooks — those are the canonical source for storage-type creation
    // (and match walk-schema's behaviour). Letting `planIssues` additionally
    // handle them produces duplicate `CREATE TYPE ...` statements.
    const issuesForPlanIssues = schemaIssues.filter(
      (issue) => issue.kind !== 'dependency_missing' && issue.kind !== 'type_missing',
    );

    const issuePlanResult = planIssues({
      issues: issuesForPlanIssues,
      toContract: options.contract,
      fromContract,
      schemaName,
      codecHooks,
      storageTypes,
    });
    if (!issuePlanResult.ok) {
      return plannerFailure(issuePlanResult.failure);
    }

    const issueCallsPolicy = this.filterCallsByOperationPolicy(
      issuePlanResult.value.calls,
      options.policy,
    );
    if (issueCallsPolicy.conflicts.length > 0) {
      return plannerFailure(issueCallsPolicy.conflicts);
    }

    const calls: PostgresOpFactoryCall[] = [
      ...this.buildDatabaseDependencyOperations(options),
      ...storageTypePlan.operations,
      ...issueCallsPolicy.allowed,
    ];

    return Object.freeze({
      kind: 'success' as const,
      plan: new TypeScriptRenderablePostgresMigration(calls, {
        from: fromHash,
        to: options.contract.storage.storageHash,
      }),
    });
  }

  /**
   * `db update` / `db init` path (legacy walk-schema). Unchanged Phase-1
   * pipeline that emits `PostgresOpFactoryCall[]` via direct contract walk
   * + reconciliation. Auto-fills NOT-NULL backfills with a temporary default
   * so it can be applied without user intervention.
   */
  private planViaWalkSchema(args: {
    readonly options: SqlMigrationPlannerPlanOptions;
    readonly fromHash: string;
    readonly schemaName: string;
    readonly schemaIssues: readonly SchemaIssue[];
    readonly planningMode: PlanningMode;
    readonly codecHooks: Map<string, CodecControlHooks>;
    readonly storageTypes: Record<string, StorageTypeInstance>;
  }): PostgresPlanResult {
    const { options, fromHash, schemaName, schemaIssues, planningMode, codecHooks, storageTypes } =
      args;

    const reconciliationPlan = buildReconciliationPlan({
      contract: options.contract,
      issues: schemaIssues,
      schemaName,
      mode: planningMode,
      policy: options.policy,
      codecHooks,
    });
    if (reconciliationPlan.conflicts.length > 0) {
      return plannerFailure(reconciliationPlan.conflicts);
    }

    const storageTypePlan = this.buildStorageTypeOperations(options, schemaName, codecHooks);
    if (storageTypePlan.conflicts.length > 0) {
      return plannerFailure(storageTypePlan.conflicts);
    }

    // Sort table entries once for reuse across all additive operation builders.
    const sortedTables = sortedEntries(options.contract.storage.tables);

    // Pre-compute constraint lookups once per schema table for O(1) checks across all builders.
    const schemaLookups = buildSchemaLookupMap(options.schema);

    const calls: PostgresOpFactoryCall[] = [
      ...this.buildDatabaseDependencyOperations(options),
      ...storageTypePlan.operations,
      ...reconciliationPlan.operations,
      ...this.buildTableOperations(
        sortedTables,
        options.schema,
        schemaName,
        codecHooks,
        storageTypes,
      ),
      ...this.buildColumnOperations(
        sortedTables,
        options.schema,
        schemaLookups,
        schemaName,
        codecHooks,
        storageTypes,
      ),
      ...this.buildPrimaryKeyOperations(sortedTables, options.schema, schemaName),
      ...this.buildUniqueOperations(sortedTables, schemaLookups, schemaName),
      ...this.buildIndexOperations(sortedTables, schemaLookups, schemaName),
      ...this.buildFkBackingIndexOperations(sortedTables, schemaLookups, schemaName),
      ...this.buildForeignKeyOperations(sortedTables, schemaLookups, schemaName),
    ];

    return Object.freeze({
      kind: 'success' as const,
      plan: new TypeScriptRenderablePostgresMigration(calls, {
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

  /**
   * Enforces {@link MigrationOperationPolicy} on calls from the issue-based
   * planner, matching the filter applied in {@link buildReconciliationPlan}
   * for the walk-schema path.
   */
  private filterCallsByOperationPolicy(
    calls: readonly PostgresOpFactoryCall[],
    policy: MigrationOperationPolicy,
  ): {
    readonly allowed: readonly PostgresOpFactoryCall[];
    readonly conflicts: readonly SqlPlannerConflict[];
  } {
    const allowed: PostgresOpFactoryCall[] = [];
    const conflicts: SqlPlannerConflict[] = [];
    for (const call of calls) {
      if (policy.allowedOperationClasses.includes(call.operationClass)) {
        allowed.push(call);
      } else {
        conflicts.push({
          kind: 'missingButNonAdditive',
          summary: `Planned operation "${call.label}" requires "${call.operationClass}" operations, which are not allowed by the current policy.`,
        });
      }
    }
    return { allowed, conflicts };
  }

  /**
   * Builds migration operations from component-owned database dependencies.
   * These operations install database-side persistence structures declared
   * by components. Each install op is wrapped via `liftOpToCall` so the
   * planner output is a uniform `PostgresOpFactoryCall[]`.
   */
  private buildDatabaseDependencyOperations(
    options: PlannerOptionsWithComponents,
  ): readonly PostgresOpFactoryCall[] {
    const dependencies = this.collectDependencies(options);
    const calls: PostgresOpFactoryCall[] = [];
    const seenDependencyIds = new Set<string>();
    const seenOperationIds = new Set<string>();

    const installedIds = new Set(options.schema.dependencies.map((d) => d.id));

    for (const dependency of dependencies) {
      if (seenDependencyIds.has(dependency.id)) {
        continue;
      }
      seenDependencyIds.add(dependency.id);

      if (installedIds.has(dependency.id)) {
        continue;
      }

      for (const installOp of dependency.install) {
        if (seenOperationIds.has(installOp.id)) {
          continue;
        }
        seenOperationIds.add(installOp.id);
        calls.push(liftOpToCall(installOp as SqlMigrationPlanOperation<PostgresPlanTargetDetails>));
      }
    }

    return calls;
  }

  private buildStorageTypeOperations(
    options: PlannerOptionsWithComponents,
    schemaName: string,
    codecHooks: Map<string, CodecControlHooks>,
  ): {
    readonly operations: readonly PostgresOpFactoryCall[];
    readonly conflicts: readonly SqlPlannerConflict[];
  } {
    const calls: PostgresOpFactoryCall[] = [];
    const conflicts: SqlPlannerConflict[] = [];
    const storageTypes = options.contract.storage.types ?? {};

    for (const [typeName, typeInstance] of sortedEntries(storageTypes)) {
      const hook = codecHooks.get(typeInstance.codecId);
      const planResult = hook?.planTypeOperations?.({
        typeName,
        typeInstance,
        contract: options.contract,
        schema: options.schema,
        schemaName,
        policy: options.policy,
      });
      if (!planResult) {
        continue;
      }
      for (const operation of planResult.operations) {
        if (!options.policy.allowedOperationClasses.includes(operation.operationClass)) {
          conflicts.push({
            kind: 'missingButNonAdditive',
            summary: `Storage type "${typeName}" requires "${operation.operationClass}" operation "${operation.id}"`,
            location: {
              type: typeName,
            },
          });
          continue;
        }
        calls.push(
          liftOpToCall({
            ...operation,
            target: {
              id: operation.target.id,
              details: this.buildTargetDetails('type', typeName, schemaName),
            },
          }),
        );
      }
    }

    return { operations: calls, conflicts };
  }
  private collectDependencies(
    options: PlannerOptionsWithComponents,
  ): ReadonlyArray<PlannerDatabaseDependency> {
    const dependencies = collectInitDependencies(options.frameworkComponents);
    return sortDependencies(dependencies.filter(isPostgresPlannerDependency));
  }

  private buildTableOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    schemaName: string,
    codecHooks: Map<string, CodecControlHooks>,
    storageTypes: Record<string, StorageTypeInstance>,
  ): readonly PostgresOpFactoryCall[] {
    const calls: PostgresOpFactoryCall[] = [];
    for (const [tableName, table] of tables) {
      if (schema.tables[tableName]) {
        continue;
      }
      const columns: ColumnSpec[] = Object.entries(table.columns).map(([name, column]) =>
        toColumnSpec(name, column, codecHooks, storageTypes),
      );
      const primaryKey = table.primaryKey ? { columns: table.primaryKey.columns } : undefined;
      calls.push(new CreateTableCall(schemaName, tableName, columns, primaryKey));
    }
    return calls;
  }

  private buildColumnOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
    codecHooks: Map<string, CodecControlHooks>,
    storageTypes: Record<string, StorageTypeInstance>,
  ): readonly PostgresOpFactoryCall[] {
    const calls: PostgresOpFactoryCall[] = [];
    for (const [tableName, table] of tables) {
      const schemaTable = schema.tables[tableName];
      if (!schemaTable) {
        continue;
      }
      const schemaLookup = schemaLookups.get(tableName);
      for (const [columnName, column] of sortedEntries(table.columns)) {
        if (schemaTable.columns[columnName]) {
          continue;
        }
        calls.push(
          ...this.buildAddColumnItem({
            schema: schemaName,
            tableName,
            table,
            schemaTable,
            schemaLookup,
            columnName,
            column,
            codecHooks,
            storageTypes,
          }),
        );
      }
    }
    return calls;
  }

  /**
   * Add-column flows fall into three shapes, all expressed as
   * `PostgresOpFactoryCall[]` so the overall plan is a single flat IR
   * stream:
   *
   *  - Default: one `AddColumnCall`.
   *  - NOT-NULL + no default, shared-temp-default safe: one `RawSqlCall`
   *    wrapping the atomic composite op produced by
   *    `buildAddNotNullColumnWithTemporaryDefaultOperation` (add nullable
   *    → backfill → `SET NOT NULL` → `DROP DEFAULT`). Splitting the steps
   *    into per-call subclasses would replace a single op's atomic
   *    precheck/postcheck pair with four separate op boundaries, changing
   *    execution semantics, so the composite is laundered as one op.
   *  - NOT-NULL + no default, unsafe (requires empty-table check): one
   *    `RawSqlCall` wrapping the hand-built op carrying the extra
   *    `tableIsEmptyCheck` guard that the plain `AddColumnCall` factory
   *    does not emit.
   *
   * Returning an array keeps the signature amenable to future
   * decomposition if/when the recipe is split into structured calls.
   */
  private buildAddColumnItem(options: {
    readonly schema: string;
    readonly tableName: string;
    readonly table: StorageTable;
    readonly schemaTable: SqlSchemaIR['tables'][string];
    readonly schemaLookup: SchemaTableLookup | undefined;
    readonly columnName: string;
    readonly column: StorageColumn;
    readonly codecHooks: Map<string, CodecControlHooks>;
    readonly storageTypes: Record<string, StorageTypeInstance>;
  }): readonly PostgresOpFactoryCall[] {
    const {
      schema,
      tableName,
      table,
      schemaTable,
      schemaLookup,
      columnName,
      column,
      codecHooks,
      storageTypes,
    } = options;
    const notNull = !column.nullable;
    const hasDefault = column.default !== undefined;
    const needsTemporaryDefault = notNull && !hasDefault;
    const temporaryDefault = needsTemporaryDefault
      ? resolveIdentityValue(column, codecHooks, storageTypes)
      : null;
    const canUseSharedTemporaryDefault =
      needsTemporaryDefault &&
      temporaryDefault !== null &&
      canUseSharedTemporaryDefaultStrategy({
        table,
        schemaTable,
        schemaLookup,
        columnName,
      });

    if (canUseSharedTemporaryDefault) {
      return [
        liftOpToCall(
          buildAddNotNullColumnWithTemporaryDefaultOperation({
            schema,
            tableName,
            columnName,
            column,
            codecHooks,
            storageTypes,
            temporaryDefault,
          }),
        ),
      ];
    }

    // Edge case: NOT-NULL-without-default where shared temp-default is unsafe.
    // Emit a hand-built op with an extra `table is empty` precheck so we
    // fail fast with a clearer error than the raw PG DDL failure. The plain
    // `AddColumnCall` factory doesn't carry this safety guard.
    const requiresEmptyTableCheck = needsTemporaryDefault && !canUseSharedTemporaryDefault;
    if (requiresEmptyTableCheck) {
      const qualified = qualifyTableName(schema, tableName);
      return [
        liftOpToCall({
          ...buildAddColumnOperationIdentity(schema, tableName, columnName),
          operationClass: 'additive',
          precheck: [
            {
              description: `ensure column "${columnName}" is missing`,
              sql: columnExistsCheck({
                schema,
                table: tableName,
                column: columnName,
                exists: false,
              }),
            },
            {
              description: `ensure table "${tableName}" is empty before adding NOT NULL column without default`,
              sql: tableIsEmptyCheck(qualified),
            },
          ],
          execute: [
            {
              description: `add column "${columnName}"`,
              sql: buildAddColumnSql(
                qualified,
                columnName,
                column,
                codecHooks,
                undefined,
                storageTypes,
              ),
            },
          ],
          postcheck: [
            {
              description: `verify column "${columnName}" exists`,
              sql: columnExistsCheck({ schema, table: tableName, column: columnName }),
            },
            {
              description: `verify column "${columnName}" is NOT NULL`,
              sql: columnNullabilityCheck({
                schema,
                table: tableName,
                column: columnName,
                nullable: false,
              }),
            },
          ],
        }),
      ];
    }

    return [
      new AddColumnCall(
        schema,
        tableName,
        toColumnSpec(columnName, column, codecHooks, storageTypes),
      ),
    ];
  }

  private buildPrimaryKeyOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schema: SqlSchemaIR,
    schemaName: string,
  ): readonly PostgresOpFactoryCall[] {
    const calls: PostgresOpFactoryCall[] = [];
    for (const [tableName, table] of tables) {
      if (!table.primaryKey) {
        continue;
      }
      const schemaTable = schema.tables[tableName];
      if (!schemaTable || schemaTable.primaryKey) {
        continue;
      }
      const constraintName = table.primaryKey.name ?? `${tableName}_pkey`;
      calls.push(
        new AddPrimaryKeyCall(schemaName, tableName, constraintName, table.primaryKey.columns),
      );
    }
    return calls;
  }

  private buildUniqueOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly PostgresOpFactoryCall[] {
    const calls: PostgresOpFactoryCall[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      for (const unique of table.uniques) {
        if (lookup && hasUniqueConstraint(lookup, unique.columns)) {
          continue;
        }
        const constraintName = unique.name ?? `${tableName}_${unique.columns.join('_')}_key`;
        calls.push(new AddUniqueCall(schemaName, tableName, constraintName, unique.columns));
      }
    }
    return calls;
  }

  private buildIndexOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly PostgresOpFactoryCall[] {
    const calls: PostgresOpFactoryCall[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      for (const index of table.indexes) {
        if (lookup && hasIndex(lookup, index.columns)) {
          continue;
        }
        const indexName = index.name ?? defaultIndexName(tableName, index.columns);
        calls.push(new CreateIndexCall(schemaName, tableName, indexName, index.columns));
      }
    }
    return calls;
  }

  /**
   * Generates FK-backing index operations for FKs with `index: true`,
   * but only when no matching user-declared index exists in `contractTable.indexes`.
   */
  private buildFkBackingIndexOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly PostgresOpFactoryCall[] {
    const calls: PostgresOpFactoryCall[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      const declaredIndexColumns = new Set(table.indexes.map((idx) => idx.columns.join(',')));

      for (const fk of table.foreignKeys) {
        if (fk.index === false) continue;
        if (declaredIndexColumns.has(fk.columns.join(','))) continue;
        if (lookup && hasIndex(lookup, fk.columns)) continue;

        const indexName = defaultIndexName(tableName, fk.columns);
        calls.push(new CreateIndexCall(schemaName, tableName, indexName, fk.columns));
      }
    }
    return calls;
  }

  private buildForeignKeyOperations(
    tables: ReadonlyArray<[string, StorageTable]>,
    schemaLookups: ReadonlyMap<string, SchemaTableLookup>,
    schemaName: string,
  ): readonly PostgresOpFactoryCall[] {
    const calls: PostgresOpFactoryCall[] = [];
    for (const [tableName, table] of tables) {
      const lookup = schemaLookups.get(tableName);
      for (const foreignKey of table.foreignKeys) {
        if (foreignKey.constraint === false) continue;
        if (lookup && hasForeignKey(lookup, foreignKey)) {
          continue;
        }
        const fkName = foreignKey.name ?? `${tableName}_${foreignKey.columns.join('_')}_fkey`;
        const fkSpec: ForeignKeySpec = {
          name: fkName,
          columns: foreignKey.columns,
          references: {
            table: foreignKey.references.table,
            columns: foreignKey.references.columns,
          },
          ...ifDefined('onDelete', foreignKey.onDelete),
          ...ifDefined('onUpdate', foreignKey.onUpdate),
        };
        calls.push(new AddForeignKeyCall(schemaName, tableName, fkSpec));
      }
    }
    return calls;
  }

  private buildTargetDetails(
    objectType: OperationClass,
    name: string,
    schema: string,
    table?: string,
  ): PostgresPlanTargetDetails {
    return buildTargetDetails(objectType, name, schema, table);
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

function canUseSharedTemporaryDefaultStrategy(options: {
  readonly table: StorageTable;
  readonly schemaTable: SqlSchemaIR['tables'][string];
  readonly schemaLookup: SchemaTableLookup | undefined;
  readonly columnName: string;
}): boolean {
  const { table, schemaTable, schemaLookup, columnName } = options;

  // Shared placeholders are only safe when later plan steps do not require
  // row-specific values for this newly added column.
  if (table.primaryKey?.columns.includes(columnName) && !schemaTable.primaryKey) {
    return false;
  }

  for (const unique of table.uniques) {
    if (!unique.columns.includes(columnName)) {
      continue;
    }
    if (!schemaLookup || !hasUniqueConstraint(schemaLookup, unique.columns)) {
      return false;
    }
  }

  for (const foreignKey of table.foreignKeys) {
    if (foreignKey.constraint === false || !foreignKey.columns.includes(columnName)) {
      continue;
    }
    if (!schemaLookup || !hasForeignKey(schemaLookup, foreignKey)) {
      return false;
    }
  }

  return true;
}

function sortDependencies(
  dependencies: ReadonlyArray<PlannerDatabaseDependency>,
): ReadonlyArray<PlannerDatabaseDependency> {
  return [...dependencies].sort((a, b) => a.id.localeCompare(b.id));
}

function isPostgresPlannerDependency(
  dependency: ComponentDatabaseDependency<unknown>,
): dependency is PlannerDatabaseDependency {
  return dependency.install.every((operation) => operation.target.id === 'postgres');
}

function sortedEntries<V>(record: Readonly<Record<string, V>>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, V]>;
}
