import type { JsonValue } from '@prisma-next/contract/types';
import type {
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import {
  type CodecRef,
  DdlColumn,
  type DdlTableConstraint,
  ForeignKeyConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlColumnIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import type { SqliteColumnSpec } from './operations/shared';
import {
  buildColumnDefaultSql,
  buildColumnTypeSql,
  isInlineAutoincrementPrimaryKey,
  resolveColumnTypeMetadata,
} from './planner-ddl-builders';

/**
 * The SQLite op-render payload stamped on an expected column node at
 * contract→IR derivation (via the family `renderColumnOps` callback), mirroring
 * the Postgres opaque-payload discipline. It carries the ALREADY-COMPUTED
 * forms the SQLite op-builders read: the `SqliteColumnSpec` (recreate-table /
 * add-column path) and the structured `DdlColumn` (create-table path). Both
 * come from the same helpers the pre-`plan(start, end)` op-path called, so the
 * planner emits byte-identical DDL by reading the relocated result — including
 * the table-dependent sole-column `AUTOINCREMENT` inline, which is why the
 * owning table is in scope here.
 */
export interface SqliteColumnOpRender {
  readonly columnSpec: SqliteColumnSpec;
  readonly ddlColumn: DdlColumn;
}

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
 * Resolves codec / `typeRef` / default rendering into a flat
 * `SqliteColumnSpec`. Mirrors Postgres's `toColumnSpec`. Once a column is
 * flattened, downstream Calls and operation factories never see
 * `StorageColumn` again — they deal in pre-rendered SQL fragments.
 */
function toColumnSpec(
  name: string,
  column: StorageColumn,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
  inlineAutoincrementPrimaryKey = false,
): SqliteColumnSpec {
  const typeSql = buildColumnTypeSql(
    column,
    blindCast<
      Record<string, StorageTypeInstance>,
      'buildColumnTypeSql declares its storageTypes parameter as mutable Record while the derivation stores it readonly; the helper does not mutate, so the readonly→mutable narrowing is sound'
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
 * Converts a `StorageTable` to the `DdlColumn[]` + `DdlTableConstraint[]`
 * pair the create-table DDL path once consumed directly. Only `.columns` is
 * still read (by {@link buildSqliteColumnOpRender}, to pick the one column's
 * rendered form) — the planner now builds table-level constraints from the
 * expected tree's own PK/unique/FK nodes, never from this function.
 */
function tableToDdlParts(
  table: StorageTable,
  storageTypes: Record<string, StorageTypeInstance>,
): { columns: DdlColumn[]; constraints: DdlTableConstraint[] } {
  const columns: DdlColumn[] = Object.entries(table.columns).map(([name, column]) => {
    const inlineAutoincrement = isInlineAutoincrementPrimaryKey(table, name);
    const typeSql = buildColumnTypeSql(
      column,
      blindCast<
        Record<string, StorageTypeInstance>,
        'buildColumnTypeSql declares its storageTypes parameter as mutable Record while the derivation stores it readonly; the helper does not mutate, so the readonly→mutable narrowing is sound'
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
        'resolveColumnTypeMetadata declares its storageTypes parameter as mutable Record while the derivation stores it readonly; the helper does not mutate, so the readonly→mutable narrowing is sound'
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
        ...(fk.name !== undefined ? { name: fk.name } : {}),
        ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
        ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
      }),
    );
  }

  return { columns, constraints };
}

export function buildSqliteColumnOpRender(
  name: string,
  column: StorageColumn,
  table: StorageTable,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
): SqliteColumnOpRender {
  const typesMap = blindCast<
    Record<string, StorageTypeInstance>,
    'the SQLite DDL builders declare a mutable storageTypes Record but never mutate it; the readonly→mutable narrowing is sound'
  >(storageTypes);
  const inline = isInlineAutoincrementPrimaryKey(table, name);
  const columnSpec = toColumnSpec(name, column, storageTypes, inline);
  // Reuse the exact whole-table builder and pick this column's DdlColumn, so
  // the create-table output is byte-identical to the pre-reshape path.
  const ddlColumn = tableToDdlParts(table, typesMap).columns.find((c) => c.name === name);
  if (ddlColumn === undefined) {
    throw new Error(`buildSqliteColumnOpRender: column "${name}" not found in table parts`);
  }
  return { columnSpec, ddlColumn };
}

/**
 * Narrows an expected column node's opaque `opRender` payload back to
 * {@link SqliteColumnOpRender}. Throws when absent — every expected column
 * reaching the planner must come from a derivation that threaded
 * `renderColumnOps` (see `diffSqliteSchemaForVerdict`'s planning sibling in
 * `diff-database-schema.ts`); a missing payload is a caller bug, not a
 * reachable production state.
 */
export function columnOpRenderOf(column: SqlColumnIR): SqliteColumnOpRender {
  if (column.opRender === undefined) {
    throw new Error(
      `columnOpRenderOf: expected column "${column.name}" carries no opRender payload — the expected tree must be derived with renderColumnOps threaded for planning`,
    );
  }
  return blindCast<
    SqliteColumnOpRender,
    'SqliteColumnOpRender is the only opRender shape sqlite-column-op-render.ts stamps; the planner only ever reads it off expected columns produced by buildSqliteColumnOpRender'
  >(column.opRender);
}
