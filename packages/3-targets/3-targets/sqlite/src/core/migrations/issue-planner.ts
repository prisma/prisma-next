/**
 * SQLite migration issue planner.
 *
 * Takes schema issues (from `verifySqlSchema`) and emits migration IR
 * (`SqliteOpFactoryCall[]`). Strategies consume issues they recognize and
 * produce specialized call sequences (e.g. recreateTableStrategy absorbs
 * type/nullability/default/constraint mismatches into a single recreate op);
 * remaining issues flow through `mapIssueToCall` for the default case.
 */

import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlPlannerConflict,
  SqlPlannerConflictLocation,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type {
  PostgresEnumStorageEntry,
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import {
  DdlColumn,
  ForeignKeyConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@prisma-next/sql-relational-core/ast';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
import { CONTROL_TABLE_NAMES } from '../control-tables';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  type SqliteOpFactoryCall,
} from './op-factory-call';
import type {
  SqliteColumnSpec,
  SqliteForeignKeySpec,
  SqliteTableSpec,
  SqliteUniqueSpec,
} from './operations/shared';
import {
  buildColumnDefaultSql,
  buildColumnTypeSql,
  isInlineAutoincrementPrimaryKey,
} from './planner-ddl-builders';
import {
  type CallMigrationStrategy,
  resolveNamespaceIdForIssue,
  type StrategyContext,
  sqlitePlannerStrategies,
  tableAt,
} from './planner-strategies';

export type { CallMigrationStrategy, StrategyContext };

// ============================================================================
// Issue kind ordering (dependency order)
// ============================================================================

const ISSUE_KIND_ORDER: Record<string, number> = {
  // Drops (reconciliation — clear the way for creates)
  extra_foreign_key: 10,
  extra_unique_constraint: 11,
  extra_primary_key: 12,
  extra_index: 13,
  extra_default: 14,
  extra_column: 15,
  extra_table: 16,

  // Tables before columns
  missing_table: 20,

  // Columns before constraints
  missing_column: 30,

  // Reconciliation alters (on existing objects)
  type_mismatch: 40,
  nullability_mismatch: 41,
  default_missing: 42,
  default_mismatch: 43,

  // Constraints after columns exist
  primary_key_mismatch: 50,
  unique_constraint_mismatch: 51,
  index_mismatch: 52,
  foreign_key_mismatch: 60,
};

function issueOrder(issue: SchemaIssue): number {
  return ISSUE_KIND_ORDER[issue.kind] ?? 99;
}

function issueKey(issue: SchemaIssue): string {
  const table = 'table' in issue && typeof issue.table === 'string' ? issue.table : '';
  const column = 'column' in issue && typeof issue.column === 'string' ? issue.column : '';
  const name =
    'indexOrConstraint' in issue && typeof issue.indexOrConstraint === 'string'
      ? issue.indexOrConstraint
      : '';
  return `${table}\u0000${column}\u0000${name}`;
}

// ============================================================================
// Conflict helpers
// ============================================================================

function issueConflict(
  kind: SqlPlannerConflict['kind'],
  summary: string,
  location?: SqlPlannerConflict['location'],
): SqlPlannerConflict {
  return {
    kind,
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

function conflictKindForIssue(issue: SchemaIssue): SqlPlannerConflict['kind'] {
  switch (issue.kind) {
    case 'type_mismatch':
      return 'typeMismatch';
    case 'nullability_mismatch':
      return 'nullabilityConflict';
    case 'primary_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
    case 'extra_primary_key':
    case 'extra_unique_constraint':
      return 'indexIncompatible';
    case 'foreign_key_mismatch':
    case 'extra_foreign_key':
      return 'foreignKeyConflict';
    default:
      return 'missingButNonAdditive';
  }
}

function issueLocation(issue: SchemaIssue): SqlPlannerConflictLocation | undefined {
  if (issue.kind === 'enum_values_changed') return undefined;
  const location: {
    table?: string;
    column?: string;
    constraint?: string;
  } = {};
  if (issue.table) location.table = issue.table;
  if (issue.column) location.column = issue.column;
  if (issue.indexOrConstraint) location.constraint = issue.indexOrConstraint;
  return Object.keys(location).length > 0 ? (location as SqlPlannerConflictLocation) : undefined;
}

function conflictForDisallowedCall(
  call: SqliteOpFactoryCall,
  allowed: readonly string[],
): SqlPlannerConflict {
  const summary = `Operation "${call.label}" requires class "${call.operationClass}", but policy allows only: ${allowed.join(', ')}`;
  const location = locationForCall(call);
  return {
    kind: conflictKindForCall(call),
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

function conflictKindForCall(call: SqliteOpFactoryCall): SqlPlannerConflict['kind'] {
  switch (call.factoryName) {
    case 'createIndex':
    case 'dropIndex':
      return 'indexIncompatible';
    default:
      return 'missingButNonAdditive';
  }
}

function locationForCall(call: SqliteOpFactoryCall): SqlPlannerConflictLocation | undefined {
  const location: { table?: string; column?: string; index?: string } = {};
  if ('tableName' in call) location.table = call.tableName;
  if ('columnName' in call) location.column = call.columnName;
  if ('indexName' in call) location.index = call.indexName;
  return Object.keys(location).length > 0 ? (location as SqlPlannerConflictLocation) : undefined;
}

function isMissing(issue: SchemaIssue): boolean {
  if (issue.kind === 'enum_values_changed') return false;
  return issue.actual === undefined;
}

// ============================================================================
// StorageTable / StorageColumn → flat SqliteTableSpec
// ============================================================================

/**
 * Resolves codec / `typeRef` / default rendering into a flat
 * `SqliteColumnSpec`. Mirrors Postgres's `toColumnSpec`. Once a column is
 * flattened, downstream Calls and operation factories never see
 * `StorageColumn` again — they deal in pre-rendered SQL fragments.
 */
export function toColumnSpec(
  name: string,
  column: StorageColumn,
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>,
  inlineAutoincrementPrimaryKey = false,
): SqliteColumnSpec {
  const typeSql = buildColumnTypeSql(
    column,
    blindCast<
      Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
      'buildColumnTypeSql declares its storageTypes parameter as mutable Record while the planner stores it readonly; the helper does not mutate, so the readonly→mutable narrowing is sound'
    >(storageTypes),
  );
  const defaultSql = buildColumnDefaultSql(column.default);
  return {
    name,
    typeSql,
    defaultSql,
    nullable: column.nullable,
    ...(inlineAutoincrementPrimaryKey ? { inlineAutoincrementPrimaryKey: true } : {}),
  };
}

/**
 * Flattens a `StorageTable` into a `SqliteTableSpec` ready for
 * `CreateTableCall` / `RecreateTableCall`. Sole-column AUTOINCREMENT
 * primary keys are detected here and marked on the column spec so the
 * renderer emits `INTEGER PRIMARY KEY AUTOINCREMENT` inline.
 */
export function toTableSpec(
  table: StorageTable,
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>,
): SqliteTableSpec {
  const columns: SqliteColumnSpec[] = Object.entries(table.columns).map(([name, column]) =>
    toColumnSpec(name, column, storageTypes, isInlineAutoincrementPrimaryKey(table, name)),
  );
  const uniques: SqliteUniqueSpec[] = table.uniques.map((u) => ({
    columns: u.columns,
    ...(u.name !== undefined ? { name: u.name } : {}),
  }));
  const foreignKeys: SqliteForeignKeySpec[] = table.foreignKeys.map((fk) => ({
    columns: fk.source.columns,
    references: { table: fk.target.tableName, columns: fk.target.columns },
    constraint: fk.constraint !== false,
    ...(fk.name !== undefined ? { name: fk.name } : {}),
    ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
    ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
  }));
  return {
    columns,
    ...(table.primaryKey ? { primaryKey: { columns: table.primaryKey.columns } } : {}),
    uniques,
    foreignKeys,
  };
}

// ============================================================================
// StorageTable / StorageColumn → DdlColumn[] + DdlTableConstraint[] (for CreateTableCall)
// ============================================================================

function sqliteDefaultToDdlColumnDefault(
  columnDefault: StorageColumn['default'],
): DdlColumn['default'] {
  if (!columnDefault) return undefined;
  switch (columnDefault.kind) {
    case 'literal':
      return new LiteralColumnDefault(columnDefault.value);
    case 'function':
      // `autoincrement()` is not a DEFAULT clause — SQLite encodes it as
      // `INTEGER PRIMARY KEY AUTOINCREMENT` inline on the column. Skip it
      // here; the renderer also has a defensive guard for the same case.
      if (columnDefault.expression === 'autoincrement()') return undefined;
      return new FunctionColumnDefault(columnDefault.expression);
    default: {
      const exhaustive: never = columnDefault;
      throw new Error(
        `sqliteDefaultToDdlColumnDefault: unhandled kind "${blindCast<{ kind: string }, 'exhaustiveness: surface the unhandled default kind'>(exhaustive).kind}"`,
      );
    }
  }
}

/**
 * Converts a `StorageTable` to the `DdlColumn[]` + `DdlTableConstraint[]`
 * pair used by `CreateTableCall`. This is the structured form consumed by
 * the DDL lowering path; `toTableSpec` / `toColumnSpec` remain in use for
 * `RecreateTableCall` and `AddColumnCall` (Phase 2).
 */
export function tableToDdlParts(
  table: StorageTable,
  storageTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
): { columns: DdlColumn[]; constraints: DdlTableConstraint[] } {
  const columns: DdlColumn[] = Object.entries(table.columns).map(([name, column]) => {
    const inlineAutoincrement = isInlineAutoincrementPrimaryKey(table, name);
    const typeSql = buildColumnTypeSql(
      column,
      blindCast<
        Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
        'buildColumnTypeSql declares its storageTypes parameter as mutable Record while the planner stores it readonly; the helper does not mutate, so the readonly→mutable narrowing is sound'
      >(storageTypes),
    );

    if (inlineAutoincrement) {
      // `DdlColumn` has no SQLite-specific autoincrement flag, so the full
      // `PRIMARY KEY AUTOINCREMENT` clause is embedded in the `type` string.
      // The DDL renderer (`ddl-renderer.ts`) substring-detects `AUTOINCREMENT`
      // to suppress the normal NOT NULL / PRIMARY KEY / DEFAULT clause rendering
      // and emit the entire type string verbatim. Both sites must stay in sync.
      // The structural fix (a SQLite-specific column option) is tracked in TML-2866.
      return new DdlColumn({ name, type: `${typeSql} PRIMARY KEY AUTOINCREMENT` });
    }
    const colDefault = sqliteDefaultToDdlColumnDefault(column.default);
    return new DdlColumn({
      name,
      type: typeSql,
      ...(!column.nullable ? { notNull: true } : {}),
      ...(colDefault !== undefined ? { default: colDefault } : {}),
    });
  });

  const constraints: DdlTableConstraint[] = [];

  const hasInlinePk = Object.entries(table.columns).some(([name]) =>
    isInlineAutoincrementPrimaryKey(table, name),
  );
  if (table.primaryKey && !hasInlinePk) {
    constraints.push(new PrimaryKeyConstraint({ columns: table.primaryKey.columns }));
  }

  for (const u of table.uniques) {
    constraints.push(
      new UniqueConstraint({
        columns: u.columns,
        ...(u.name !== undefined ? { name: u.name } : {}),
      }),
    );
  }

  for (const fk of table.foreignKeys) {
    if (fk.constraint === false) continue;
    constraints.push(
      new ForeignKeyConstraint({
        columns: fk.source.columns,
        refTable: fk.target.tableName,
        refColumns: fk.target.columns,
        ...ifDefined('name', fk.name),
        ...ifDefined('onDelete', fk.onDelete),
        ...ifDefined('onUpdate', fk.onUpdate),
      }),
    );
  }

  return { columns, constraints };
}

// ============================================================================
// Issue planner
// ============================================================================

export interface IssuePlannerOptions {
  readonly issues: readonly SchemaIssue[];
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;
  readonly schema?: SqlSchemaIR;
  readonly policy?: MigrationOperationPolicy;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly strategies?: readonly CallMigrationStrategy[];
}

export interface IssuePlannerValue {
  readonly calls: readonly SqliteOpFactoryCall[];
}

const DEFAULT_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

function emptySchemaIR(): SqlSchemaIR {
  return { tables: {} };
}

// ============================================================================
// Issue → Call mapping (per-issue default path)
// ============================================================================

function mapIssueToCall(
  issue: SchemaIssue,
  ctx: StrategyContext,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  switch (issue.kind) {
    case 'missing_table': {
      if (!issue.table) {
        return notOk(
          issueConflict('unsupportedOperation', 'Missing table issue has no table name'),
        );
      }
      const namespaceId = resolveNamespaceIdForIssue(issue);
      const contractTable = tableAt(ctx.toContract.storage, namespaceId, issue.table);
      if (!contractTable) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Table "${issue.table}" in namespace "${namespaceId}" reported missing but not found in destination contract`,
          ),
        );
      }
      const { columns: ddlColumns, constraints: ddlConstraints } = tableToDdlParts(
        contractTable,
        ctx.storageTypes,
      );
      const calls: SqliteOpFactoryCall[] = [
        new CreateTableCall(
          issue.table,
          ddlColumns,
          ddlConstraints.length > 0 ? ddlConstraints : undefined,
        ),
      ];
      const declaredIndexColumnKeys = new Set<string>();
      for (const index of contractTable.indexes) {
        const indexName = index.name ?? defaultIndexName(issue.table, index.columns);
        declaredIndexColumnKeys.add(index.columns.join(','));
        calls.push(new CreateIndexCall(issue.table, indexName, index.columns));
      }
      for (const fk of contractTable.foreignKeys) {
        if (fk.index === false) continue;
        if (declaredIndexColumnKeys.has(fk.source.columns.join(','))) continue;
        const indexName = defaultIndexName(issue.table, fk.source.columns);
        calls.push(new CreateIndexCall(issue.table, indexName, fk.source.columns));
      }
      return ok(calls);
    }

    case 'missing_column': {
      if (!issue.table || !issue.column) {
        return notOk(
          issueConflict('unsupportedOperation', 'Missing column issue has no table/column name'),
        );
      }
      const namespaceId = resolveNamespaceIdForIssue(issue);
      const contractTable2 = tableAt(ctx.toContract.storage, namespaceId, issue.table);
      const column = contractTable2?.columns[issue.column];
      if (!column) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Column "${issue.table}"."${issue.column}" not in destination contract`,
          ),
        );
      }
      const contractTable = contractTable2;
      const columnSpec = toColumnSpec(
        issue.column,
        column,
        ctx.storageTypes,
        contractTable ? isInlineAutoincrementPrimaryKey(contractTable, issue.column) : false,
      );
      return ok([new AddColumnCall(issue.table, columnSpec)]);
    }

    case 'index_mismatch': {
      if (!issue.table) {
        return notOk(issueConflict('indexIncompatible', 'Index issue has no table name'));
      }
      if (!isMissing(issue) || !issue.expected) {
        return notOk(
          issueConflict(
            'indexIncompatible',
            `Index on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
            { table: issue.table },
          ),
        );
      }
      const namespaceId = resolveNamespaceIdForIssue(issue);
      const columns = issue.expected.split(', ');
      const contractTable = tableAt(ctx.toContract.storage, namespaceId, issue.table);
      if (!contractTable) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Table "${issue.table}" not found in destination contract`,
          ),
        );
      }
      const explicitIndex = contractTable.indexes.find(
        (idx) => idx.columns.join(',') === columns.join(','),
      );
      const indexName = explicitIndex?.name ?? defaultIndexName(issue.table, columns);
      return ok([new CreateIndexCall(issue.table, indexName, columns)]);
    }

    case 'extra_table': {
      if (!issue.table) {
        return notOk(issueConflict('unsupportedOperation', 'Extra table issue has no table name'));
      }
      // Runner-owned control tables must never be dropped.
      if (CONTROL_TABLE_NAMES.has(issue.table)) return ok([]);
      return ok([new DropTableCall(issue.table)]);
    }

    case 'extra_column': {
      if (!issue.table || !issue.column) {
        return notOk(
          issueConflict('unsupportedOperation', 'Extra column issue has no table/column name'),
        );
      }
      return ok([new DropColumnCall(issue.table, issue.column)]);
    }

    case 'extra_index': {
      if (!issue.table || !issue.indexOrConstraint) {
        return notOk(
          issueConflict('unsupportedOperation', 'Extra index issue has no table/index name'),
        );
      }
      return ok([new DropIndexCall(issue.table, issue.indexOrConstraint)]);
    }

    // SQLite has no enum types (capability `sql.enums: false`). The verifier
    // should never emit `enum_values_changed` against a SQLite schema, so if
    // we receive one it is a verifier bug — surface it as an explicit
    // conflict rather than silently dropping it.
    case 'enum_values_changed':
      return notOk(
        issueConflict(
          'unsupportedOperation',
          'Received enum_values_changed against a SQLite schema (sql.enums: false) — verifier bug',
        ),
      );

    // Everything below is absorbed by recreateTableStrategy. If it falls
    // through here, policy or context didn't allow the recreate — surface as
    // a conflict.
    case 'type_mismatch':
    case 'nullability_mismatch':
    case 'default_mismatch':
    case 'default_missing':
    case 'extra_default':
    case 'primary_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'foreign_key_mismatch':
    case 'extra_foreign_key':
    case 'extra_unique_constraint':
    case 'extra_primary_key':
      return notOk(issueConflict(conflictKindForIssue(issue), issue.message, issueLocation(issue)));

    default:
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Unhandled issue kind: ${(issue as SchemaIssue).kind}`,
        ),
      );
  }
}

// ============================================================================
// Call categorization for final emission order
// ============================================================================

type CallCategory =
  | 'drop-column'
  | 'drop-index'
  | 'drop-table'
  | 'create-table'
  | 'add-column'
  | 'create-index';

function classifyCall(call: SqliteOpFactoryCall): CallCategory | null {
  switch (call.factoryName) {
    case 'createTable':
      return 'create-table';
    case 'addColumn':
      return 'add-column';
    case 'createIndex':
      return 'create-index';
    case 'dropColumn':
      return 'drop-column';
    case 'dropIndex':
      return 'drop-index';
    case 'dropTable':
      return 'drop-table';
    // recreateTable goes into the recipe slot; return null for bucketable.
    case 'recreateTable':
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Top-level planIssues
// ============================================================================

export function planIssues(
  options: IssuePlannerOptions,
): Result<IssuePlannerValue, readonly SqlPlannerConflict[]> {
  const policyProvided = options.policy !== undefined;
  const policy = options.policy ?? DEFAULT_POLICY;
  const schema = options.schema ?? emptySchemaIR();
  const frameworkComponents = options.frameworkComponents ?? [];

  const context: StrategyContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
    codecHooks: options.codecHooks,
    storageTypes: options.storageTypes,
    schema,
    policy,
    frameworkComponents,
  };

  const strategies = options.strategies ?? sqlitePlannerStrategies;

  let remaining = options.issues;
  const recipeCalls: SqliteOpFactoryCall[] = [];
  const bucketableCalls: SqliteOpFactoryCall[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      if (result.recipe) {
        recipeCalls.push(...result.calls);
      } else {
        bucketableCalls.push(...result.calls);
      }
    }
  }

  const sorted = [...remaining].sort((a, b) => {
    const kindDelta = issueOrder(a) - issueOrder(b);
    if (kindDelta !== 0) return kindDelta;
    const keyA = issueKey(a);
    const keyB = issueKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const defaultCalls: SqliteOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapIssueToCall(issue, context);
    if (result.ok) {
      defaultCalls.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  // Policy gating for recipe + bucketable. Default-mapped calls for disallowed
  // classes never get here (they're surfaced as per-issue conflicts above).
  const allowed = policy.allowedOperationClasses;
  let gatedRecipe = recipeCalls;
  let gatedBucketable = bucketableCalls;
  let gatedDefault = defaultCalls;
  if (policyProvided) {
    const sink = (acc: SqliteOpFactoryCall[]) => (call: SqliteOpFactoryCall) => {
      if (allowed.includes(call.operationClass)) {
        acc.push(call);
        return;
      }
      conflicts.push(conflictForDisallowedCall(call, allowed));
    };
    const gatedRecipeBucket: SqliteOpFactoryCall[] = [];
    const gatedBucketableBucket: SqliteOpFactoryCall[] = [];
    const gatedDefaultBucket: SqliteOpFactoryCall[] = [];
    recipeCalls.forEach(sink(gatedRecipeBucket));
    bucketableCalls.forEach(sink(gatedBucketableBucket));
    defaultCalls.forEach(sink(gatedDefaultBucket));
    gatedRecipe = gatedRecipeBucket;
    gatedBucketable = gatedBucketableBucket;
    gatedDefault = gatedDefaultBucket;
  }

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  // Final emission order matches the current monolithic planner:
  //   create-table → add-column → create-index → recreate → drop-column → drop-index → drop-table
  const combined = [...gatedDefault, ...gatedBucketable];
  const byCategory = (cat: CallCategory) => combined.filter((c) => classifyCall(c) === cat);

  const calls: SqliteOpFactoryCall[] = [
    ...byCategory('create-table'),
    ...byCategory('add-column'),
    ...byCategory('create-index'),
    ...gatedRecipe,
    ...byCategory('drop-column'),
    ...byCategory('drop-index'),
    ...byCategory('drop-table'),
  ];

  return ok({ calls });
}
