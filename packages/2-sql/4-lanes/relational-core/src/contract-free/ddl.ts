import {
  type ColumnDefault,
  type ColumnType,
  CreateSchemaAst,
  CreateTableAst,
  type CreateTableColumn,
} from '../ast/types';

export type { ColumnDefault, ColumnType, CreateTableColumn };
export { CreateSchemaAst, CreateTableAst };

/**
 * Constructs a `CREATE SCHEMA [IF NOT EXISTS] <name>` AST node.
 *
 * No contract, codec, or storage-hash dependency — suitable for
 * control-plane bootstrap DDL that runs outside a contract context.
 */
export function createSchema(
  name: string,
  opts?: { readonly ifNotExists?: boolean },
): CreateSchemaAst {
  return CreateSchemaAst.of(name, opts?.ifNotExists ?? false);
}

/**
 * Constructs a `CREATE TABLE [IF NOT EXISTS] <table> (<columns>)` AST node.
 *
 * `table` may be a dotted string (`'schema.name'`) or a descriptor object.
 * No contract, codec, or storage-hash dependency.
 */
export function createTable(
  table: string | { readonly schema?: string; readonly name: string },
  columns: readonly CreateTableColumn[],
  opts?: { readonly ifNotExists?: boolean },
): CreateTableAst {
  const tableRef = typeof table === 'string' ? parseTableName(table) : table;
  return CreateTableAst.of(tableRef, columns, { ifNotExists: opts?.ifNotExists ?? false });
}

/**
 * Constructs a {@link CreateTableColumn} descriptor.
 *
 * Only the fields actually provided are included; optional fields are
 * omitted from the returned object rather than set to `undefined`, so
 * renderers can reliably check for their presence with `in` or `?.`.
 */
export function col(
  name: string,
  type: ColumnType,
  opts?: {
    readonly primaryKey?: boolean;
    readonly notNull?: boolean;
    readonly default?: ColumnDefault;
  },
): CreateTableColumn {
  const descriptor: {
    name: string;
    type: ColumnType;
    primaryKey?: boolean;
    notNull?: boolean;
    default?: ColumnDefault;
  } = { name, type };
  if (opts?.primaryKey !== undefined) descriptor.primaryKey = opts.primaryKey;
  if (opts?.notNull !== undefined) descriptor.notNull = opts.notNull;
  if (opts?.default !== undefined) descriptor.default = opts.default;
  return descriptor;
}

/** Literal-value column default (e.g. `'app'`, `'{}'`, `'[]'`). */
export function lit(value: string): { readonly kind: 'literal'; readonly value: string } {
  return { kind: 'literal', value };
}

/** Current-timestamp column default (`now()` / `datetime('now')`). */
export function now(): { readonly kind: 'now' } {
  return { kind: 'now' };
}

function parseTableName(name: string): { schema?: string; name: string } {
  const dotIndex = name.indexOf('.');
  if (dotIndex === -1) return { name };
  return { schema: name.slice(0, dotIndex), name: name.slice(dotIndex + 1) };
}
