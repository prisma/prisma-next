import { Schema, ForeignKey, PrimaryKey, Unique, Index } from './schema';

export interface RelationEdge {
  from: { table: string; columns: string[] };
  to: { table: string; columns: string[] };
  cardinality: '1:N' | 'N:1';
  name: string; // inferred from FK column name (e.g., 'user_id' → 'user')
}

export interface RelationGraph {
  edges: Map<string, RelationEdge[]>; // keyed by "from" table
  reverseEdges: Map<string, RelationEdge[]>; // keyed by "to" table
}

/**
 * Builds a relation graph from IR foreign key constraints
 */
export function buildRelationGraph(ir: Schema): RelationGraph {
  const edges = new Map<string, RelationEdge[]>();
  const reverseEdges = new Map<string, RelationEdge[]>();

  for (const [tableName, table] of Object.entries(ir.tables)) {
    if (!table.foreignKeys) continue;

    for (const fk of table.foreignKeys) {
      // Validate FK references point to existing table
      if (!ir.tables[fk.references.table]) {
        throw new Error(`Foreign key references non-existent table: ${fk.references.table}`);
      }

      // Infer relation name from FK column (strip _id suffix)
      const relationName = inferRelationName(fk.columns[0]);

      const edge: RelationEdge = {
        from: { table: tableName, columns: fk.columns },
        to: { table: fk.references.table, columns: fk.references.columns },
        cardinality: 'N:1', // FK on table A → table B = N:1 from A's perspective
        name: relationName,
      };

      // Add to edges (N:1 from source table)
      if (!edges.has(tableName)) {
        edges.set(tableName, []);
      }
      edges.get(tableName)!.push(edge);

      // Add to reverse edges (1:N to target table)
      if (!reverseEdges.has(fk.references.table)) {
        reverseEdges.set(fk.references.table, []);
      }
      reverseEdges.get(fk.references.table)!.push({
        ...edge,
        cardinality: '1:N', // Reverse perspective
        name: tableName, // Use source table name directly for 1:N
      });
    }
  }

  return { edges, reverseEdges };
}

/**
 * Infers relation name from FK column name
 * e.g., 'user_id' → 'user', 'author_id' → 'author'
 */
function inferRelationName(fkColumn: string): string {
  // Remove _id suffix
  if (fkColumn.endsWith('_id')) {
    return fkColumn.slice(0, -3);
  }
  return fkColumn;
}

/**
 * Resolves unique constraint for given table and columns
 */
export function resolveUnique(
  ir: Schema,
  table: string,
  columns: string[],
): { kind: 'pk' | 'unique'; columns: string[] } | null {
  const tableDef = ir.tables[table];
  if (!tableDef) return null;

  // Check primary key
  if (tableDef.primaryKey) {
    if (arraysEqual(tableDef.primaryKey.columns, columns)) {
      return { kind: 'pk', columns: tableDef.primaryKey.columns };
    }
  }

  // Check unique constraints
  if (tableDef.uniques) {
    for (const unique of tableDef.uniques) {
      if (arraysEqual(unique.columns, columns)) {
        return { kind: 'unique', columns: unique.columns };
      }
    }
  }

  return null;
}

/**
 * Checks if table has an index for equality queries on given column
 */
export function hasIndexForEquality(ir: Schema, table: string, column: string): boolean {
  const tableDef = ir.tables[table];
  if (!tableDef) return false;

  // Check if column is part of primary key
  if (tableDef.primaryKey?.columns.includes(column)) {
    return true;
  }

  // Check if column is part of unique constraint
  if (tableDef.uniques) {
    for (const unique of tableDef.uniques) {
      if (unique.columns.includes(column)) {
        return true;
      }
    }
  }

  // Check if column has a dedicated index
  if (tableDef.indexes) {
    for (const index of tableDef.indexes) {
      if (index.columns.includes(column)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Helper to compare arrays for equality
 */
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
