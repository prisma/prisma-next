import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { ForeignKey } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

/**
 * Pre-computed lookup sets for a schema table's constraints.
 * Converts O(n*m) linear scans to O(1) Set lookups per constraint check.
 */
export interface SchemaTableLookup {
  readonly uniqueKeys: Set<string>;
  readonly indexKeys: Set<string>;
  readonly uniqueIndexKeys: Set<string>;
  readonly fkKeys: Set<string>;
}

export function buildSchemaLookupMap(schema: SqlSchemaIR): ReadonlyMap<string, SchemaTableLookup> {
  const map = new Map<string, SchemaTableLookup>();
  for (const [tableName, table] of Object.entries(schema.tables)) {
    map.set(tableName, buildSchemaTableLookup(table));
  }
  return map;
}

function buildSchemaTableLookup(table: SqlSchemaIR['tables'][string]): SchemaTableLookup {
  const uniqueKeys = new Set(table.uniques.map((u) => u.columns.join(',')));
  const indexKeys = new Set(table.indexes.map((i) => i.columns.join(',')));
  const uniqueIndexKeys = new Set(
    table.indexes.filter((i) => i.unique).map((i) => i.columns.join(',')),
  );
  const fkKeys = new Set<string>();
  for (const fk of table.foreignKeys) {
    const cols = fk.columns.join(',');
    const refCols = fk.referencedColumns.join(',');
    // Always store the unqualified key so that unbound-namespace contract FKs
    // can match via hasForeignKey's fallback path.
    fkKeys.add(`${cols}||${fk.referencedTable}|${refCols}`);
    // Also store the qualified key when referencedSchema is present so that
    // cross-namespace contract FKs can match precisely by (schema, table).
    if (fk.referencedSchema !== undefined) {
      fkKeys.add(`${cols}|${fk.referencedSchema}|${fk.referencedTable}|${refCols}`);
    }
  }
  return { uniqueKeys, indexKeys, uniqueIndexKeys, fkKeys };
}

export function hasUniqueConstraint(
  lookup: SchemaTableLookup,
  columns: readonly string[],
): boolean {
  const key = columns.join(',');
  return lookup.uniqueKeys.has(key) || lookup.uniqueIndexKeys.has(key);
}

export function hasIndex(lookup: SchemaTableLookup, columns: readonly string[]): boolean {
  const key = columns.join(',');
  return lookup.indexKeys.has(key) || lookup.uniqueKeys.has(key);
}

export function hasForeignKey(lookup: SchemaTableLookup, fk: ForeignKey): boolean {
  const cols = fk.source.columns.join(',');
  const refCols = fk.target.columns.join(',');
  // For unbound-namespace FKs, use the unqualified key (matches any schema).
  // For bound-namespace FKs, use the qualified key (exact schema match).
  if (fk.target.namespaceId === UNBOUND_NAMESPACE_ID) {
    return lookup.fkKeys.has(`${cols}||${fk.target.tableName}|${refCols}`);
  }
  return lookup.fkKeys.has(`${cols}|${fk.target.namespaceId}|${fk.target.tableName}|${refCols}`);
}
