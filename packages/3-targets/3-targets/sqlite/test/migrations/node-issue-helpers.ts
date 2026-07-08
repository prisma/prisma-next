/**
 * Test-only builders for hand-crafted node-typed schema-diff issues
 * (`SchemaDiffIssue`) over concrete SQLite schema-IR nodes. Used across the
 * issue-planner / planner-strategies / recreate-postcheck unit suites so
 * each test constructs real `SqlTableIR`/`SqlColumnIR`/... instances instead
 * of loose object literals, matching the shapes `diffSchemas` actually
 * produces.
 */

import type { ColumnDefault } from '@prisma-next/contract/types';
import type {
  ExpectationFailureReason,
  SchemaDiffIssue,
} from '@prisma-next/framework-components/control';
import { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import {
  PrimaryKey,
  SqlCheckConstraintIR,
  SqlColumnDefaultIR,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import type { SqliteColumnSpec } from '../../src/core/migrations/operations/shared';
import type { SqliteColumnOpRender } from '../../src/core/migrations/sqlite-column-op-render';

/** Builds the op-render payload a real derivation would stamp on an expected column — mirrors `buildSqliteColumnOpRender`'s output shape. */
export function opRenderFor(input: {
  readonly name: string;
  readonly typeSql: string;
  readonly nullable: boolean;
  readonly defaultSql?: string;
  readonly inlineAutoincrementPrimaryKey?: boolean;
}): SqliteColumnOpRender {
  const columnSpec: SqliteColumnSpec = {
    name: input.name,
    typeSql: input.typeSql,
    defaultSql: input.defaultSql ?? '',
    nullable: input.nullable,
    ...(input.inlineAutoincrementPrimaryKey ? { inlineAutoincrementPrimaryKey: true } : {}),
  };
  const ddlColumn = new DdlColumn({
    name: input.name,
    type: input.typeSql,
    ...(!input.nullable ? { notNull: true } : {}),
  });
  return { columnSpec, ddlColumn };
}

/** An expected (desired-side) column, carrying `opRender` the way derivation stamps it. */
export function expectedColumn(input: {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly resolvedNativeType?: string;
  readonly many?: boolean;
  readonly resolvedDefault?: ColumnDefault;
  readonly defaultSql?: string;
  readonly inlineAutoincrementPrimaryKey?: boolean;
}): SqlColumnIR {
  return new SqlColumnIR({
    name: input.name,
    nativeType: input.nativeType,
    nullable: input.nullable,
    resolvedNativeType: input.resolvedNativeType ?? input.nativeType,
    ...(input.many !== undefined ? { many: input.many } : {}),
    ...(input.resolvedDefault !== undefined ? { resolvedDefault: input.resolvedDefault } : {}),
    opRender: opRenderFor({
      name: input.name,
      typeSql: input.nativeType,
      nullable: input.nullable,
      ...(input.defaultSql !== undefined ? { defaultSql: input.defaultSql } : {}),
      ...(input.inlineAutoincrementPrimaryKey ? { inlineAutoincrementPrimaryKey: true } : {}),
    }),
  });
}

/** A live (actual-side) column, as introspection would build it — no `opRender`. */
export function actualColumn(input: {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly resolvedNativeType?: string;
  readonly many?: boolean;
  readonly resolvedDefault?: ColumnDefault;
}): SqlColumnIR {
  return new SqlColumnIR({
    name: input.name,
    nativeType: input.nativeType,
    nullable: input.nullable,
    resolvedNativeType: input.resolvedNativeType ?? input.nativeType,
    ...(input.many !== undefined ? { many: input.many } : {}),
    ...(input.resolvedDefault !== undefined ? { resolvedDefault: input.resolvedDefault } : {}),
  });
}

export function primaryKey(columns: readonly string[]): PrimaryKey {
  return new PrimaryKey({ columns });
}

export function foreignKey(input: {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly name?: string;
  readonly onDelete?: SqlForeignKeyIR['onDelete'];
  readonly onUpdate?: SqlForeignKeyIR['onUpdate'];
}): SqlForeignKeyIR {
  return new SqlForeignKeyIR({
    columns: input.columns,
    referencedTable: input.referencedTable,
    referencedColumns: input.referencedColumns,
    resolvedReferencedNamespace: '',
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.onDelete !== undefined ? { onDelete: input.onDelete } : {}),
    ...(input.onUpdate !== undefined ? { onUpdate: input.onUpdate } : {}),
  });
}

export function columnDefault(input: {
  readonly resolved?: ColumnDefault;
  readonly raw?: string;
}): SqlColumnDefaultIR {
  return new SqlColumnDefaultIR({
    ...(input.resolved !== undefined ? { resolved: input.resolved } : {}),
    ...(input.raw !== undefined ? { raw: input.raw } : {}),
  });
}

export function checkConstraint(input: {
  readonly name: string;
  readonly column: string;
  readonly permittedValues: readonly string[];
}): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR(input);
}

export function unique(columns: readonly string[], name?: string): SqlUniqueIR {
  return new SqlUniqueIR({ columns, ...(name !== undefined ? { name } : {}) });
}

export function index(
  columns: readonly string[],
  overrides: { readonly name?: string; readonly unique?: boolean } = {},
): SqlIndexIR {
  return new SqlIndexIR({
    columns,
    unique: overrides.unique ?? false,
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
  });
}

export function table(input: {
  readonly name: string;
  readonly columns: Record<string, SqlColumnIR>;
  readonly primaryKey?: PrimaryKey;
  readonly foreignKeys?: readonly SqlForeignKeyIR[];
  readonly uniques?: readonly SqlUniqueIR[];
  readonly indexes?: readonly SqlIndexIR[];
}): SqlTableIR {
  return new SqlTableIR({
    name: input.name,
    columns: input.columns,
    ...(input.primaryKey !== undefined ? { primaryKey: input.primaryKey } : {}),
    foreignKeys: input.foreignKeys ?? [],
    uniques: input.uniques ?? [],
    indexes: input.indexes ?? [],
  });
}

/** Builds a `SchemaDiffIssue` directly — the shape `diffSchemas` produces, minus needing a real tree to diff. */
export function issue(input: {
  readonly path: readonly string[];
  readonly reason: ExpectationFailureReason;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly message?: string;
}): SchemaDiffIssue {
  return {
    path: input.path,
    reason: input.reason,
    message: input.message ?? `${input.reason}: ${input.path.join('/')}`,
    ...(input.expected !== undefined ? { expected: input.expected } : {}),
    ...(input.actual !== undefined ? { actual: input.actual } : {}),
  } as SchemaDiffIssue;
}
