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
  const fkKeys = new Set(
    table.foreignKeys.map(
      (fk) => `${fk.columns.join(',')}|${fk.referencedTable}|${fk.referencedColumns.join(',')}`,
    ),
  );
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
  return lookup.fkKeys.has(
    `${fk.columns.join(',')}|${fk.references.table}|${fk.references.columns.join(',')}`,
  );
}
