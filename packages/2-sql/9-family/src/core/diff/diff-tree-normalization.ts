/**
 * Pre-diff tree normalization: adjustments to the actual/expected trees the
 * generic differ (`diffSchemas`) runs over, so legacy semantic-equivalence
 * rules (a unique constraint satisfied by a unique index, an FK schema
 * segment that differs only in spelling) surface as same-kind node pairs
 * instead of spurious drift.
 */

import {
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';

// ============================================================================
// Semantic satisfaction — derivation-side normalization of the actual tree
// ============================================================================

export interface SemanticSatisfactionInput {
  readonly expectedUniques: readonly SqlUniqueIR[];
  readonly expectedIndexes: readonly SqlIndexIR[];
  readonly actualUniques: readonly SqlUniqueIR[];
  readonly actualIndexes: readonly SqlIndexIR[];
}

export interface SemanticSatisfactionResult {
  readonly actualUniques: readonly SqlUniqueIR[];
  readonly actualIndexes: readonly SqlIndexIR[];
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/**
 * Adjusts a table pair's ACTUAL unique/index child lists so the legacy
 * walk's cross-kind semantic satisfaction materializes as same-kind node
 * pairs for the differ (the differ pairs strictly by id, so a `unique:`
 * node can never pair with an `index:` node). Three legacy rules, ported
 * from `isUniqueConstraintSatisfied` / `isIndexSatisfied` and the
 * strict-extras loops of the retired relational walk:
 *
 * 1. A contract unique satisfied by a live unique INDEX: the actual index
 *    node is reclassified as a unique node (it pairs with the expected
 *    unique and stops being a candidate extra).
 * 2. A contract index (with no type/options demands) satisfied by a live
 *    unique CONSTRAINT: a same-kind actual index node is synthesized so
 *    the expected index pairs — the unique constraint itself stays (the
 *    legacy strict-extras loop still reports it as an undeclared unique).
 * 3. Live unique indexes are never extras in the legacy walk (its
 *    strict-extras loop skips `unique: true` rows), so any remaining
 *    actual unique-index node with no expected index counterpart is
 *    dropped rather than surfacing as `not-expected`.
 */
export function resolveSemanticSatisfaction(
  input: SemanticSatisfactionInput,
): SemanticSatisfactionResult {
  let actualIndexes = [...input.actualIndexes];
  const actualUniques = [...input.actualUniques];

  // Rule 1: reclassify a satisfying unique index as the unique constraint
  // the contract declared.
  for (const expectedUnique of input.expectedUniques) {
    const alreadyPaired = actualUniques.some((u) => sameColumns(u.columns, expectedUnique.columns));
    if (alreadyPaired) continue;
    const satisfyingIndex = actualIndexes.find(
      (idx) => idx.unique && sameColumns(idx.columns, expectedUnique.columns),
    );
    if (satisfyingIndex) {
      actualIndexes = actualIndexes.filter((idx) => idx !== satisfyingIndex);
      actualUniques.push(
        new SqlUniqueIR({
          columns: satisfyingIndex.columns,
          ...(satisfyingIndex.name !== undefined ? { name: satisfyingIndex.name } : {}),
        }),
      );
    }
  }

  // Rule 2: synthesize an index node from a satisfying unique constraint.
  for (const expectedIndex of input.expectedIndexes) {
    if (expectedIndex.type !== undefined || expectedIndex.options !== undefined) continue;
    const alreadyPaired = actualIndexes.some((idx) =>
      sameColumns(idx.columns, expectedIndex.columns),
    );
    if (alreadyPaired) continue;
    const satisfyingUnique = actualUniques.find((u) =>
      sameColumns(u.columns, expectedIndex.columns),
    );
    if (satisfyingUnique) {
      actualIndexes.push(new SqlIndexIR({ columns: satisfyingUnique.columns, unique: false }));
    }
  }

  // Rule 3: remaining unique indexes with no expected counterpart are
  // invisible to the legacy extras loop — drop them.
  actualIndexes = actualIndexes.filter(
    (idx) =>
      !idx.unique || input.expectedIndexes.some((exp) => sameColumns(exp.columns, idx.columns)),
  );

  return { actualUniques, actualIndexes };
}

// ============================================================================
// Flat-tree helpers (single-schema targets)
// ============================================================================

/**
 * Applies {@link resolveSemanticSatisfaction} across a flat table pair set:
 * every actual table with an expected counterpart gets its unique/index
 * child lists adjusted; unpaired tables pass through untouched.
 */
export function normalizeFlatActualForDiff(
  expected: SqlSchemaIR,
  actual: SqlSchemaIR,
): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [name, actualTable] of Object.entries(actual.tables)) {
    const expectedTable = expected.tables[name];
    if (expectedTable === undefined) {
      tables[name] = actualTable;
      continue;
    }
    const adjusted = resolveSemanticSatisfaction({
      expectedUniques: expectedTable.uniques,
      expectedIndexes: expectedTable.indexes,
      actualUniques: actualTable.uniques,
      actualIndexes: actualTable.indexes,
    });
    tables[name] = new SqlTableIR({
      name: actualTable.name,
      columns: actualTable.columns,
      foreignKeys: actualTable.foreignKeys,
      uniques: adjusted.actualUniques,
      indexes: adjusted.actualIndexes,
      ...(actualTable.primaryKey !== undefined ? { primaryKey: actualTable.primaryKey } : {}),
      ...(actualTable.annotations !== undefined ? { annotations: actualTable.annotations } : {}),
      ...(actualTable.checks !== undefined ? { checks: actualTable.checks } : {}),
    });
  }
  return new SqlSchemaIR({
    tables,
    ...(actual.annotations !== undefined ? { annotations: actual.annotations } : {}),
  });
}

/**
 * Neutralizes the FK schema segment on a flat expected tree so its FK diff
 * nodes pair with introspected FKs on single-schema targets: the family
 * converter stamps `referencedSchema` with the contract namespace id
 * verbatim (the unbound sentinel on non-namespaced targets), while a
 * single-schema introspection stamps none — resolving both sides to the
 * empty segment makes the ids meet.
 */
export function neutralizeFlatExpectedFkSchemas(expected: SqlSchemaIR): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [name, table] of Object.entries(expected.tables)) {
    if (table.foreignKeys.length === 0) {
      tables[name] = table;
      continue;
    }
    const foreignKeys = table.foreignKeys.map(
      (fk) =>
        new SqlForeignKeyIR({
          columns: fk.columns,
          referencedTable: fk.referencedTable,
          referencedColumns: fk.referencedColumns,
          ...(fk.referencedSchema !== undefined ? { referencedSchema: fk.referencedSchema } : {}),
          ...(fk.name !== undefined ? { name: fk.name } : {}),
          ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
          ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
          ...(fk.annotations !== undefined ? { annotations: fk.annotations } : {}),
          resolvedReferencedNamespace: '',
        }),
    );
    tables[name] = new SqlTableIR({
      name: table.name,
      columns: table.columns,
      foreignKeys,
      uniques: table.uniques,
      indexes: table.indexes,
      ...(table.primaryKey !== undefined ? { primaryKey: table.primaryKey } : {}),
      ...(table.annotations !== undefined ? { annotations: table.annotations } : {}),
      ...(table.checks !== undefined ? { checks: table.checks } : {}),
    });
  }
  return new SqlSchemaIR({
    tables,
    ...(expected.annotations !== undefined ? { annotations: expected.annotations } : {}),
  });
}
