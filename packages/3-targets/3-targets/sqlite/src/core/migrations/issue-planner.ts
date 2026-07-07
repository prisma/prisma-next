/**
 * SQLite migration issue planner.
 *
 * Takes schema issues (from `collectSqlSchemaIssues`) and emits migration IR
 * (`SqliteOpFactoryCall[]`). Strategies consume issues they recognize and
 * produce specialized call sequences (e.g. recreateTableStrategy absorbs
 * type/nullability/default/constraint mismatches into a single recreate op);
 * remaining issues flow through `mapIssueToCall` for the default case.
 */

import type { Contract, JsonValue } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlPlannerConflict,
  SqlPlannerConflictLocation,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
// Node-based flip (W5) — additive, not yet wired into `planIssues` below.
// `mapNodeIssueToCall` + friends read `SchemaDiffIssue` nodes directly; they
// coexist with the coordinate-based `mapIssueToCall` until the cutover
// deletes it and switches `planIssues`' input.
import type { SchemaDiffIssue, SchemaIssue } from '@prisma-next/framework-components/control';
import type {
  SqlStorage,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { CodecRef, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import {
  DdlColumn,
  ForeignKeyConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@prisma-next/sql-relational-core/ast';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import {
  RelationalSchemaNodeKind,
  type SqlColumnIR,
  type SqlIndexIR,
  SqlSchemaIR,
  type SqlSchemaIRNode,
  type SqlTableIR,
} from '@prisma-next/sql-schema-ir/types';
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
  resolveColumnTypeMetadata,
} from './planner-ddl-builders';
import type { NodeStrategyContext } from './planner-strategies';
import {
  type CallMigrationStrategy,
  resolveNamespaceIdForIssue,
  type StrategyContext,
  sqlitePlannerStrategies,
  tableAt,
} from './planner-strategies';
import { columnOpRenderOf } from './sqlite-column-op-render';

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
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
  inlineAutoincrementPrimaryKey = false,
): SqliteColumnSpec {
  const typeSql = buildColumnTypeSql(
    column,
    blindCast<
      Record<string, StorageTypeInstance>,
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
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
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
  storageTypes: Record<string, StorageTypeInstance>,
): { columns: DdlColumn[]; constraints: DdlTableConstraint[] } {
  const columns: DdlColumn[] = Object.entries(table.columns).map(([name, column]) => {
    const inlineAutoincrement = isInlineAutoincrementPrimaryKey(table, name);
    const typeSql = buildColumnTypeSql(
      column,
      blindCast<
        Record<string, StorageTypeInstance>,
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
    const resolved = resolveColumnTypeMetadata(
      column,
      blindCast<
        Record<string, StorageTypeInstance>,
        'resolveColumnTypeMetadata declares its storageTypes parameter as mutable Record while the planner stores it readonly; the helper does not mutate, so the readonly→mutable narrowing is sound'
      >(storageTypes),
    );
    const codecRef: CodecRef | undefined = resolved.codecId
      ? {
          codecId: resolved.codecId,
          ...(resolved.typeParams !== undefined
            ? {
                typeParams: blindCast<
                  JsonValue,
                  'resolved.typeParams is JsonValue-shaped storage metadata; the narrowed (non-undefined) value lands in CodecRef.typeParams which is JsonValue'
                >(resolved.typeParams),
              }
            : {}),
        }
      : undefined;
    return new DdlColumn({
      name,
      type: typeSql,
      ...(!column.nullable ? { notNull: true } : {}),
      ...(colDefault !== undefined ? { default: colDefault } : {}),
      ...(codecRef !== undefined ? { codecRef } : {}),
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
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
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
  return new SqlSchemaIR({ tables: {} });
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

// ============================================================================
// The node-based flip (W5) — additive, unwired
// ============================================================================
//
// Everything below reads the diff node an issue carries (`issue.expected` /
// `issue.actual`) — never the contract, never `storageTypes`, never codec
// hooks. The expected tree's columns already carry the op-render payload
// (`opRender`, stamped at derivation), so op construction here is a direct
// read, not a recomputation. None of this is called by `planIssues` above
// yet — the cutover commit switches `planIssues`' input to `SchemaDiffIssue[]`,
// deletes `mapIssueToCall` + `ISSUE_KIND_ORDER` + the coordinate helpers
// above, and wires these in.

/**
 * Re-keys the legacy `ISSUE_KIND_ORDER` (kind string → priority number) on
 * `(nodeKind, reason)`. Numbers are preserved from the legacy table so the
 * dependency intent stays legible; the final emission order is actually
 * fixed downstream by category bucketing (create-table → add-column →
 * create-index → recreate → drop-column → drop-index → drop-table), so this
 * only breaks ties within a single bucket.
 */
export function nodeIssueOrder(issue: SchemaDiffIssue): number {
  const node = issueNode(issue);
  if (node === undefined) return 99;
  switch (node.nodeKind) {
    case RelationalSchemaNodeKind.foreignKey:
      return issue.reason === 'not-expected' ? 10 : 60;
    case RelationalSchemaNodeKind.unique:
      return issue.reason === 'not-expected' ? 11 : 51;
    case RelationalSchemaNodeKind.primaryKey:
      return issue.reason === 'not-expected' ? 12 : 50;
    case RelationalSchemaNodeKind.index:
      return issue.reason === 'not-expected' ? 13 : 52;
    case RelationalSchemaNodeKind.columnDefault:
      if (issue.reason === 'not-expected') return 14;
      return issue.reason === 'not-found' ? 42 : 43;
    case RelationalSchemaNodeKind.column:
      if (issue.reason === 'not-expected') return 15;
      return issue.reason === 'not-found' ? 30 : 40;
    case RelationalSchemaNodeKind.table:
      return issue.reason === 'not-expected' ? 16 : 20;
    case RelationalSchemaNodeKind.check:
      if (issue.reason === 'not-found') return 53;
      return issue.reason === 'not-expected' ? 54 : 55;
    default:
      return 99;
  }
}

/** Deterministic tiebreak within an order bucket: the diff path itself already encodes table → child → grandchild. */
export function nodeIssueKey(issue: SchemaDiffIssue): string {
  return issue.path.join(' ');
}

/**
 * The generic differ is total: a missing/extra table (or column) emits an
 * issue for itself AND for every node in its subtree (columns, defaults,
 * constraints, indexes). `CreateTableCall`/`DropTableCall` and
 * `AddColumnCall`/`DropColumnCall` already account for the whole subtree
 * (reading it directly off the table/column node), so the nested issues are
 * redundant — coalescing them is "the planner's responsibility" the differ's
 * own contract assigns (`schema-diff.ts`). Drops any issue whose path is a
 * strict descendant of a `not-found`/`not-expected` issue's path.
 */
export function coalesceSubtreeIssues(
  issues: readonly SchemaDiffIssue[],
): readonly SchemaDiffIssue[] {
  const collapsingPaths = issues
    .filter((issue) => issue.reason === 'not-found' || issue.reason === 'not-expected')
    .map((issue) => issue.path);
  if (collapsingPaths.length === 0) return issues;
  return issues.filter(
    (issue) => !collapsingPaths.some((ancestor) => isStrictDescendantPath(issue.path, ancestor)),
  );
}

function isStrictDescendantPath(path: readonly string[], ancestor: readonly string[]): boolean {
  if (path.length <= ancestor.length) return false;
  for (let i = 0; i < ancestor.length; i += 1) {
    if (path[i] !== ancestor[i]) return false;
  }
  return true;
}

function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a SQL schema diff tree is a SqlSchemaIRNode; nodeKind is its required discriminant'
  >(node);
}

/** Whether the expected/actual native type (resolved, or raw+many fallback) differs — mirrors `SqlColumnIR.isEqualTo`'s type comparison. */
export function columnTypeChanged(expected: SqlColumnIR, actual: SqlColumnIR): boolean {
  if (expected.resolvedNativeType !== undefined && actual.resolvedNativeType !== undefined) {
    return expected.resolvedNativeType !== actual.resolvedNativeType;
  }
  return (
    expected.nativeType !== actual.nativeType || Boolean(expected.many) !== Boolean(actual.many)
  );
}

/**
 * Builds the flat `SqliteTableSpec` `RecreateTableCall` needs from the
 * expected table node — the node-sourced equivalent of `toTableSpec` (which
 * reads a raw contract `StorageTable`). Every column's spec comes directly
 * off its `opRender` payload.
 */
export function tableSpecFromNode(table: SqlTableIR): SqliteTableSpec {
  const columns: SqliteColumnSpec[] = Object.values(table.columns).map(
    (c) => columnOpRenderOf(c).columnSpec,
  );
  const uniques: SqliteUniqueSpec[] = table.uniques.map((u) => ({
    columns: u.columns,
    ...(u.name !== undefined ? { name: u.name } : {}),
  }));
  // Every FK node on the expected tree is constraint-bearing by construction
  // (contractToSchemaIR filters `constraint: false` FKs out before they ever
  // become nodes — those only ever contribute an index, never an FK node).
  const foreignKeys: SqliteForeignKeySpec[] = table.foreignKeys.map((fk) => ({
    columns: fk.columns,
    references: { table: fk.referencedTable, columns: fk.referencedColumns },
    constraint: true,
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

/**
 * Conflict kind for a node kind that `recreateTableStrategy`'s node-based
 * sibling absorbs for every reachable production issue. Reaching
 * `mapNodeIssueToCall` for one of these means the recreate strategy didn't
 * run — mirrors the legacy `conflictKindForIssue` per-kind categorization.
 */
function absorbedConflictKind(nodeKind: string): SqlPlannerConflict['kind'] {
  switch (nodeKind) {
    case RelationalSchemaNodeKind.primaryKey:
    case RelationalSchemaNodeKind.unique:
      return 'indexIncompatible';
    case RelationalSchemaNodeKind.foreignKey:
      return 'foreignKeyConflict';
    default:
      return 'missingButNonAdditive';
  }
}

/**
 * Builds the `CreateTableCall` + per-index `CreateIndexCall`s for a
 * newly-expected table. Reads only the table node's own children — indexes
 * (declared + FK-backing, deduped) are already merged and ordered at
 * derivation (`contractToSchemaIR`'s `convertTable`).
 */
function buildCreateTableCallsFromNode(table: SqlTableIR): SqliteOpFactoryCall[] {
  const columns = Object.values(table.columns).map((c) => columnOpRenderOf(c).ddlColumn);
  const constraints = buildTableConstraintsFromNode(table);
  const calls: SqliteOpFactoryCall[] = [
    new CreateTableCall(table.name, columns, constraints.length > 0 ? constraints : undefined),
  ];
  for (const idx of table.indexes) {
    const indexName = idx.name ?? defaultIndexName(table.name, idx.columns);
    calls.push(new CreateIndexCall(table.name, indexName, idx.columns));
  }
  return calls;
}

function buildTableConstraintsFromNode(table: SqlTableIR): DdlTableConstraint[] {
  const constraints: DdlTableConstraint[] = [];
  const hasInlinePk = Object.values(table.columns).some(
    (c) => columnOpRenderOf(c).columnSpec.inlineAutoincrementPrimaryKey === true,
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
    constraints.push(
      new ForeignKeyConstraint({
        columns: fk.columns,
        refTable: fk.referencedTable,
        refColumns: fk.referencedColumns,
        ...(fk.name !== undefined ? { name: fk.name } : {}),
        ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
        ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
      }),
    );
  }
  return constraints;
}

function mapTableIssueNode(
  issue: SchemaDiffIssue,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  if (issue.reason === 'not-found') {
    const table = blindCast<
      SqlTableIR,
      'a not-found table issue always carries the expected table node'
    >(issue.expected);
    return ok(buildCreateTableCallsFromNode(table));
  }
  if (issue.reason === 'not-expected') {
    const table = blindCast<
      SqlTableIR,
      'a not-expected table issue always carries the actual table node'
    >(issue.actual);
    // Runner-owned control tables must never be dropped.
    if (CONTROL_TABLE_NAMES.has(table.name)) return ok([]);
    return ok([new DropTableCall(table.name)]);
  }
  // Unreachable: SqlTableIR.isEqualTo is identity, so a paired table can
  // never mismatch — kept for exhaustiveness against a future node change.
  return notOk(issueConflict('unsupportedOperation', `Unexpected table drift: ${issue.message}`));
}

function mapColumnIssueNode(
  issue: SchemaDiffIssue,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  const tableName = issue.path[1];
  if (tableName === undefined) {
    return notOk(
      issueConflict(
        'unsupportedOperation',
        `Column issue has no table in its path: ${issue.message}`,
      ),
    );
  }
  if (issue.reason === 'not-found') {
    const column = blindCast<
      SqlColumnIR,
      'a not-found column issue always carries the expected column node'
    >(issue.expected);
    return ok([new AddColumnCall(tableName, columnOpRenderOf(column).columnSpec)]);
  }
  if (issue.reason === 'not-expected') {
    const column = blindCast<
      SqlColumnIR,
      'a not-expected column issue always carries the actual column node'
    >(issue.actual);
    return ok([new DropColumnCall(tableName, column.name)]);
  }
  // not-equal: absorbed by the node-based recreate strategy for every
  // reachable production issue (SQLite can't ALTER a column type/nullability
  // in place). Reaching here means the strategy didn't run — conflict.
  const expected = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the expected column node'
  >(issue.expected);
  const actual = blindCast<
    SqlColumnIR,
    'a not-equal column issue always carries the actual column node'
  >(issue.actual);
  const kind = columnTypeChanged(expected, actual) ? 'typeMismatch' : 'nullabilityConflict';
  return notOk(issueConflict(kind, issue.message, { table: tableName, column: expected.name }));
}

function mapIndexIssueNode(
  issue: SchemaDiffIssue,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  const tableName = issue.path[1];
  if (tableName === undefined) {
    return notOk(
      issueConflict(
        'unsupportedOperation',
        `Index issue has no table in its path: ${issue.message}`,
      ),
    );
  }
  if (issue.reason === 'not-found') {
    const idx = blindCast<
      SqlIndexIR,
      'a not-found index issue always carries the expected index node'
    >(issue.expected);
    const indexName = idx.name ?? defaultIndexName(tableName, idx.columns);
    return ok([new CreateIndexCall(tableName, indexName, idx.columns)]);
  }
  if (issue.reason === 'not-expected') {
    const idx = blindCast<
      SqlIndexIR,
      'a not-expected index issue always carries the actual index node'
    >(issue.actual);
    const indexName = idx.name ?? defaultIndexName(tableName, idx.columns);
    return ok([new DropIndexCall(tableName, indexName)]);
  }
  // not-equal: index type/options/uniqueness drift. SQLite can't ALTER an
  // index in place and the legacy planner never absorbed this into a
  // recreate either — surfaces as a conflict, matching `index_mismatch`.
  return notOk(issueConflict('indexIncompatible', issue.message, { table: tableName }));
}

/**
 * Node-based sibling of `mapIssueToCall`. Dispatches on the diff node's
 * `nodeKind` + `issue.reason`, reading nodes + `opRender` — never the
 * contract, never `storageTypes`, never codec hooks. Not yet wired into
 * `planIssues` above; the cutover commit switches the input and deletes
 * `mapIssueToCall`.
 */
export function mapNodeIssueToCall(
  issue: SchemaDiffIssue,
  _ctx: NodeStrategyContext,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  const node = issueNode(issue);
  if (node === undefined) {
    return notOk(
      issueConflict(
        'unsupportedOperation',
        `Issue carries neither an expected nor an actual node: ${issue.message}`,
      ),
    );
  }
  switch (node.nodeKind) {
    case RelationalSchemaNodeKind.table:
      return mapTableIssueNode(issue);
    case RelationalSchemaNodeKind.column:
      return mapColumnIssueNode(issue);
    case RelationalSchemaNodeKind.index:
      return mapIndexIssueNode(issue);
    case RelationalSchemaNodeKind.columnDefault:
    case RelationalSchemaNodeKind.primaryKey:
    case RelationalSchemaNodeKind.foreignKey:
    case RelationalSchemaNodeKind.unique:
      return notOk(issueConflict(absorbedConflictKind(node.nodeKind), issue.message));
    case RelationalSchemaNodeKind.check:
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `SQLite does not support CHECK constraint DDL: ${issue.message}`,
        ),
      );
    default:
      return notOk(issueConflict('unsupportedOperation', `Unhandled node kind: ${node.nodeKind}`));
  }
}
