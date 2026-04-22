/**
 * Migration strategies.
 *
 * Each strategy examines the issue list, consumes issues it handles, and
 * returns the `PostgresOpFactoryCall[]` to address them. The issue planner
 * chains strategies and routes whatever's left through `mapIssueToCall`.
 *
 * - `migrationPlanCallStrategies` — data-safe strategies (dataTransform for
 *   NOT NULL, type changes, etc.) for `migration plan`.
 * - `dbUpdateCallStrategies` — dev-push strategies (temp defaults,
 *   component install ops, codec-hook type ops) for `db update`.
 */

import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  ComponentDatabaseDependency,
  MigrationOperationPolicy,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { collectInitDependencies } from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import {
  AddColumnCall,
  AddEnumValuesCall,
  AlterColumnTypeCall,
  CreateEnumTypeCall,
  DataTransformCall,
  DropEnumTypeCall,
  type PostgresOpFactoryCall,
  RawSqlCall,
  RenameTypeCall,
  SetNotNullCall,
} from './op-factory-call';
import {
  buildAddColumnSql,
  buildColumnDefaultSql,
  buildColumnTypeSql,
} from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';
import {
  buildAddColumnOperationIdentity,
  buildAddNotNullColumnWithTemporaryDefaultOperation,
} from './planner-recipes';
import { buildSchemaLookupMap, hasForeignKey, hasUniqueConstraint } from './planner-schema-lookup';
import {
  buildExpectedFormatType,
  columnExistsCheck,
  columnNullabilityCheck,
  qualifyTableName,
  tableIsEmptyCheck,
} from './planner-sql-checks';
import { buildTargetDetails, type PostgresPlanTargetDetails } from './planner-target-details';

const REBUILD_SUFFIX = '__prisma_next_new';

// ============================================================================
// Strategy types
// ============================================================================

/**
 * Context passed to each migration strategy.
 *
 * Strategies read the source (`fromContract`), target (`toContract`), current
 * database state (`schema`), operation policy (`policy`), and component list
 * (`frameworkComponents`) to make planning decisions. `fromContract` is null
 * when no prior contract is available (e.g. `db update`, where the current
 * DB state is approximated via `schema`).
 */
export interface StrategyContext {
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

// ============================================================================
// Call strategies (for issue planner)
// ============================================================================

export type CallMigrationStrategy = (
  issues: readonly SchemaIssue[],
  context: StrategyContext,
) =>
  | {
      kind: 'match';
      issues: readonly SchemaIssue[];
      calls: readonly PostgresOpFactoryCall[];
      /**
       * `true` for strategies that emit cohesive sequential recipes whose
       * calls must stay contiguous and in the returned order — e.g.
       * `enumChangeCallStrategy` (dataTransform → createEnumType →
       * dropEnumType), `notNullBackfillCallStrategy` (addColumn →
       * dataTransform → setNotNull). Defaults to `false`, which lets
       * `planIssues` hoist individual calls into their DDL sequencing bucket.
       */
      recipe?: boolean;
    }
  | { kind: 'no_match' };

function buildColumnSpec(
  table: string,
  column: string,
  ctx: StrategyContext,
  overrides?: { nullable?: boolean },
) {
  const col = ctx.toContract.storage.tables[table]?.columns[column];
  if (!col) throw new Error(`Column "${table}"."${column}" not found in destination contract`);
  const mutableHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
  const mutableTypes = ctx.storageTypes as Record<string, StorageTypeInstance>;
  return {
    name: column,
    typeSql: buildColumnTypeSql(col, mutableHooks, mutableTypes),
    defaultSql: buildColumnDefaultSql(col.default, col),
    nullable: overrides?.nullable ?? col.nullable,
  };
}

function buildAlterTypeOptions(
  table: string,
  column: string,
  ctx: StrategyContext,
  using?: string,
) {
  const col = ctx.toContract.storage.tables[table]?.columns[column];
  if (!col) throw new Error(`Column "${table}"."${column}" not found in destination contract`);
  const mutableHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
  const mutableTypes = ctx.storageTypes as Record<string, StorageTypeInstance>;
  const qualifiedTargetType = buildColumnTypeSql(col, mutableHooks, mutableTypes, false);
  const formatTypeExpected = buildExpectedFormatType(col, mutableHooks, mutableTypes);
  return {
    qualifiedTargetType,
    formatTypeExpected,
    rawTargetTypeForLabel: qualifiedTargetType,
    ...(using !== undefined ? { using } : {}),
  };
}

export const notNullBackfillCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'missing_column' || !issue.table || !issue.column) continue;

    const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
    if (!column) continue;
    if (column.nullable === true || column.default !== undefined) continue;

    matched.push(issue);
    const spec = buildColumnSpec(issue.table, issue.column, ctx, { nullable: true });
    calls.push(
      new AddColumnCall(ctx.schemaName, issue.table, spec),
      new DataTransformCall(
        `backfill-${issue.table}-${issue.column}`,
        `backfill-${issue.table}-${issue.column}:check`,
        `backfill-${issue.table}-${issue.column}:run`,
      ),
      new SetNotNullCall(ctx.schemaName, issue.table, issue.column),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

const SAFE_WIDENINGS = new Set(['int2→int4', 'int2→int8', 'int4→int8', 'float4→float8']);

export const typeChangeCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'type_mismatch') continue;
    if (!issue.table || !issue.column) continue;
    const fromColumn = ctx.fromContract?.storage.tables[issue.table]?.columns[issue.column];
    const toColumn = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
    if (!fromColumn || !toColumn) continue;
    const fromType = fromColumn.nativeType;
    const toType = toColumn.nativeType;
    if (fromType === toType) continue;
    matched.push(issue);
    const alterOpts = buildAlterTypeOptions(issue.table, issue.column, ctx);
    if (SAFE_WIDENINGS.has(`${fromType}→${toType}`)) {
      calls.push(new AlterColumnTypeCall(ctx.schemaName, issue.table, issue.column, alterOpts));
    } else {
      calls.push(
        new DataTransformCall(
          `typechange-${issue.table}-${issue.column}`,
          `typechange-${issue.table}-${issue.column}:check`,
          `typechange-${issue.table}-${issue.column}:run`,
        ),
        new AlterColumnTypeCall(ctx.schemaName, issue.table, issue.column, alterOpts),
      );
    }
  }
  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

export const nullableTighteningCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'nullability_mismatch' || !issue.table || !issue.column) continue;

    const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
    if (!column) continue;
    if (column.nullable === true) continue;

    matched.push(issue);
    calls.push(
      new DataTransformCall(
        `handle-nulls-${issue.table}-${issue.column}`,
        `handle-nulls-${issue.table}-${issue.column}:check`,
        `handle-nulls-${issue.table}-${issue.column}:run`,
      ),
      new SetNotNullCall(ctx.schemaName, issue.table, issue.column),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

function enumRebuildCallRecipe(
  typeName: string,
  ctx: StrategyContext,
): readonly PostgresOpFactoryCall[] {
  const toType = ctx.toContract.storage.types?.[typeName];
  if (!toType) return [];
  const nativeType = toType.nativeType;
  const desiredValues = (toType.typeParams['values'] ?? []) as readonly string[];
  const tempName = `${nativeType}${REBUILD_SUFFIX}`;

  const columnRefs: { table: string; column: string }[] = [];
  for (const [tableName, table] of Object.entries(ctx.toContract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.typeRef === typeName) {
        columnRefs.push({ table: tableName, column: columnName });
      }
    }
  }

  return [
    new CreateEnumTypeCall(ctx.schemaName, tempName, desiredValues),
    ...columnRefs.map((ref) => {
      const using = `${ref.column}::text::${tempName}`;
      return new AlterColumnTypeCall(ctx.schemaName, ref.table, ref.column, {
        qualifiedTargetType: tempName,
        formatTypeExpected: tempName,
        rawTargetTypeForLabel: tempName,
        using,
      });
    }),
    new DropEnumTypeCall(ctx.schemaName, nativeType),
    new RenameTypeCall(ctx.schemaName, tempName, nativeType),
  ];
}

export const enumChangeCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'enum_values_changed') continue;
    matched.push(issue);

    if (issue.removedValues.length > 0) {
      calls.push(
        new DataTransformCall(
          `migrate-${issue.typeName}-values`,
          `migrate-${issue.typeName}-values:check`,
          `migrate-${issue.typeName}-values:run`,
        ),
        ...enumRebuildCallRecipe(issue.typeName, ctx),
      );
    } else if (issue.addedValues.length === 0) {
      calls.push(...enumRebuildCallRecipe(issue.typeName, ctx));
    } else {
      const toType = ctx.toContract.storage.types?.[issue.typeName];
      if (toType) {
        calls.push(
          new AddEnumValuesCall(
            ctx.schemaName,
            issue.typeName,
            toType.nativeType,
            issue.addedValues,
          ),
        );
      }
    }
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

export const migrationPlanCallStrategies: readonly CallMigrationStrategy[] = [
  enumChangeCallStrategy,
  notNullBackfillCallStrategy,
  typeChangeCallStrategy,
  nullableTighteningCallStrategy,
];

// ============================================================================
// db-update strategies (absorbed from the walk-schema planner)
// ============================================================================

/**
 * Dispatches storage types through their codec's `planTypeOperations` hook.
 * Replaces the walk-schema `buildStorageTypeOperations` path: the hook is
 * the authoritative source for codec-driven DDL (enum create/rebuild/add-
 * value, custom type creation, etc.).
 *
 * Runs AFTER `enumChangeCallStrategy` in the `db update` chain so the
 * structured enum path (value add, rebuild recipe) gets first pick at
 * `enum_values_changed` issues; this strategy then handles remaining
 * `type_missing` / `enum_values_changed` issues for types whose hook
 * produced at least one op.
 */
export const storageTypePlanCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const storageTypes = ctx.toContract.storage.types ?? {};
  if (Object.keys(storageTypes).length === 0) return { kind: 'no_match' };

  const calls: PostgresOpFactoryCall[] = [];
  const handledTypeNames = new Set<string>();

  for (const [typeName, typeInstance] of Object.entries(storageTypes).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const hook = ctx.codecHooks.get(typeInstance.codecId);
    if (!hook?.planTypeOperations) continue;
    const planResult = hook.planTypeOperations({
      typeName,
      typeInstance,
      contract: ctx.toContract,
      schema: ctx.schema,
      schemaName: ctx.schemaName,
      policy: ctx.policy,
    });
    if (!planResult) continue;
    if (planResult.operations.length === 0) {
      handledTypeNames.add(typeName);
      continue;
    }
    handledTypeNames.add(typeName);
    for (const op of planResult.operations) {
      calls.push(
        new RawSqlCall({
          ...op,
          target: {
            id: op.target.id,
            details: buildTargetDetails('type', typeName, ctx.schemaName),
          },
        } as SqlMigrationPlanOperation<PostgresPlanTargetDetails>),
      );
    }
  }

  const remaining = issues.filter(
    (issue) =>
      !(
        (issue.kind === 'type_missing' || issue.kind === 'enum_values_changed') &&
        issue.typeName &&
        handledTypeNames.has(issue.typeName)
      ),
  );

  if (calls.length === 0 && remaining.length === issues.length) {
    return { kind: 'no_match' };
  }

  return { kind: 'match', issues: remaining, calls };
};

/**
 * Dispatches component-declared database dependencies. Replaces the
 * walk-schema `buildDatabaseDependencyOperations` path. Rather than consuming
 * `dependency_missing` issues (which only carry the id), this strategy
 * re-invokes `collectInitDependencies(frameworkComponents)` at plan time so
 * the handler has access to the structured `install` ops each component
 * declared — including arbitrary SQL launders — and dedupes by dependency id
 * plus per-op id.
 */
export const dependencyInstallCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const installedIds = new Set(ctx.schema.dependencies.map((d) => d.id));
  const dependencies = sortDependencies(
    collectInitDependencies(ctx.frameworkComponents).filter(isPostgresPlannerDependency),
  );

  const calls: PostgresOpFactoryCall[] = [];
  const handledDependencyIds = new Set<string>();
  const seenOperationIds = new Set<string>();

  for (const dep of dependencies) {
    handledDependencyIds.add(dep.id);
    if (installedIds.has(dep.id)) continue;
    for (const installOp of dep.install) {
      if (seenOperationIds.has(installOp.id)) continue;
      seenOperationIds.add(installOp.id);
      calls.push(liftInstallOpToCall(installOp));
    }
  }

  // Consume ALL `dependency_missing` issues — even non-postgres ones. The
  // walk-schema predecessor silently skipped non-postgres deps; leaving those
  // issues in the stream would let `mapIssueToCall` reject them as
  // "Unknown dependency type".
  const remaining = issues.filter((issue) => issue.kind !== 'dependency_missing');

  if (calls.length === 0 && remaining.length === issues.length) {
    return { kind: 'no_match' };
  }
  return { kind: 'match', issues: remaining, calls };
};

/**
 * Handles `missing_column` issues for NOT NULL columns without a contract
 * default. Replaces the walk-schema `buildAddColumnItem` non-default branches.
 *
 * Two shapes:
 *  - Shared-temp-default safe: emit a single atomic composite op (add
 *    nullable → backfill identity value → `SET NOT NULL` → `DROP DEFAULT`).
 *  - Empty-table guarded: emit a hand-built op with a `tableIsEmptyCheck`
 *    precheck so the failure message is "table is not empty" rather than the
 *    raw PG NOT NULL violation.
 *
 * "Normal" missing_column cases (nullable or has a contract default) are left
 * for `mapIssueToCall`'s default `AddColumnCall` emission.
 */
export const notNullAddColumnCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  const schemaLookups = buildSchemaLookupMap(ctx.schema);

  const mutableCodecHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
  const mutableStorageTypes = ctx.storageTypes as Record<string, StorageTypeInstance>;

  for (const issue of issues) {
    if (issue.kind !== 'missing_column' || !issue.table || !issue.column) continue;
    const contractTable = ctx.toContract.storage.tables[issue.table];
    const column = contractTable?.columns[issue.column];
    if (!column) continue;

    const notNull = column.nullable !== true;
    const hasDefault = column.default !== undefined;
    if (!notNull || hasDefault) continue;

    const schemaTable = ctx.schema.tables[issue.table];
    if (!schemaTable) continue;

    const temporaryDefault = resolveIdentityValue(column, mutableCodecHooks, mutableStorageTypes);
    const schemaLookup = schemaLookups.get(issue.table);
    const canUseSharedTempDefault =
      temporaryDefault !== null &&
      canUseSharedTemporaryDefaultStrategy({
        table: contractTable,
        schemaTable,
        schemaLookup,
        columnName: issue.column,
      });

    matched.push(issue);

    if (canUseSharedTempDefault && temporaryDefault !== null) {
      calls.push(
        new RawSqlCall(
          buildAddNotNullColumnWithTemporaryDefaultOperation({
            schema: ctx.schemaName,
            tableName: issue.table,
            columnName: issue.column,
            column,
            codecHooks: mutableCodecHooks,
            storageTypes: mutableStorageTypes,
            temporaryDefault,
          }),
        ),
      );
      continue;
    }

    const qualified = qualifyTableName(ctx.schemaName, issue.table);
    calls.push(
      new RawSqlCall({
        ...buildAddColumnOperationIdentity(ctx.schemaName, issue.table, issue.column),
        operationClass: 'additive',
        precheck: [
          {
            description: `ensure column "${issue.column}" is missing`,
            sql: columnExistsCheck({
              schema: ctx.schemaName,
              table: issue.table,
              column: issue.column,
              exists: false,
            }),
          },
          {
            description: `ensure table "${issue.table}" is empty before adding NOT NULL column without default`,
            sql: tableIsEmptyCheck(qualified),
          },
        ],
        execute: [
          {
            description: `add column "${issue.column}"`,
            sql: buildAddColumnSql(
              qualified,
              issue.column,
              column,
              mutableCodecHooks,
              undefined,
              mutableStorageTypes,
            ),
          },
        ],
        postcheck: [
          {
            description: `verify column "${issue.column}" exists`,
            sql: columnExistsCheck({
              schema: ctx.schemaName,
              table: issue.table,
              column: issue.column,
            }),
          },
          {
            description: `verify column "${issue.column}" is NOT NULL`,
            sql: columnNullabilityCheck({
              schema: ctx.schemaName,
              table: issue.table,
              column: issue.column,
              nullable: false,
            }),
          },
        ],
      }),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
  };
};

// ============================================================================
// Strategy helpers
// ============================================================================

function canUseSharedTemporaryDefaultStrategy(options: {
  readonly table: NonNullable<Contract<SqlStorage>['storage']['tables'][string]>;
  readonly schemaTable: SqlSchemaIR['tables'][string];
  readonly schemaLookup: ReturnType<typeof buildSchemaLookupMap> extends ReadonlyMap<
    string,
    infer V
  >
    ? V | undefined
    : never;
  readonly columnName: string;
}): boolean {
  const { table, schemaTable, schemaLookup, columnName } = options;

  if (table.primaryKey?.columns.includes(columnName) && !schemaTable.primaryKey) {
    return false;
  }

  for (const unique of table.uniques) {
    if (!unique.columns.includes(columnName)) continue;
    if (!schemaLookup || !hasUniqueConstraint(schemaLookup, unique.columns)) return false;
  }

  for (const foreignKey of table.foreignKeys) {
    if (foreignKey.constraint === false || !foreignKey.columns.includes(columnName)) continue;
    if (!schemaLookup || !hasForeignKey(schemaLookup, foreignKey)) return false;
  }

  return true;
}

type PlannerDatabaseDependency = ComponentDatabaseDependency<unknown> & {
  readonly install: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
};

function isPostgresPlannerDependency(
  dependency: ComponentDatabaseDependency<unknown>,
): dependency is PlannerDatabaseDependency {
  return dependency.install.every((operation) => operation.target.id === 'postgres');
}

function sortDependencies(
  dependencies: ReadonlyArray<PlannerDatabaseDependency>,
): ReadonlyArray<PlannerDatabaseDependency> {
  return [...dependencies].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Lift a component install op into migration IR. Structured shapes — extension
 * and schema installs with predictable SQL — collapse to typed `*Call`
 * subclasses so the scaffolded migration authoring surface stays readable.
 * Everything else (arbitrary SQL) falls through to `RawSqlCall` as an escape
 * hatch.
 */
/**
 * Component-declared install ops are wrapped as `RawSqlCall` so the
 * component's original `label`, `precheck`, `execute`, `postcheck`, and op
 * id are preserved verbatim. Structured conversion (to e.g.
 * `CreateExtensionCall`) would drop the precheck/postcheck pair and
 * change the DDL label, breaking walk-schema output parity. Classification
 * as `'dep'` happens in `classifyCall` via the underlying op's id prefix.
 */
function liftInstallOpToCall(
  op: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
): PostgresOpFactoryCall {
  return new RawSqlCall(op);
}

export const dbUpdateCallStrategies: readonly CallMigrationStrategy[] = [
  storageTypePlanCallStrategy,
  dependencyInstallCallStrategy,
  notNullAddColumnCallStrategy,
];
