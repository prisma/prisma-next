/**
 * Pure verification helper functions for SQL schema verification.
 * These functions verify schema IR against contract requirements.
 */

import type { SchemaIssue, SchemaVerificationNode } from '@prisma-next/core-control-plane/types';
import type {
  ForeignKey,
  Index,
  PrimaryKey,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import type {
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import type { ComponentDatabaseDependency } from '../migrations/types';

/**
 * Compares two arrays of strings for equality (order-sensitive).
 */
export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

// ============================================================================
// Semantic Satisfaction Predicates
// ============================================================================
// These predicates implement the "stronger satisfies weaker" logic for storage
// objects. They are used by both verification and migration planning to ensure
// consistent behavior across the control plane.

/**
 * Checks if a unique constraint requirement is satisfied by the given columns.
 *
 * Semantic satisfaction: a unique constraint requirement can be satisfied by:
 * - A unique constraint with the same columns, OR
 * - A unique index with the same columns
 *
 * @param uniques - The unique constraints in the schema table
 * @param indexes - The indexes in the schema table
 * @param columns - The columns required by the unique constraint
 * @returns true if the requirement is satisfied
 */
export function isUniqueConstraintSatisfied(
  uniques: readonly SqlUniqueIR[],
  indexes: readonly SqlIndexIR[],
  columns: readonly string[],
): boolean {
  // Check for matching unique constraint
  const hasConstraint = uniques.some((unique) => arraysEqual(unique.columns, columns));
  if (hasConstraint) {
    return true;
  }
  // Check for matching unique index (semantic satisfaction)
  return indexes.some((index) => index.unique && arraysEqual(index.columns, columns));
}

/**
 * Checks if an index requirement is satisfied by the given columns.
 *
 * Semantic satisfaction: a non-unique index requirement can be satisfied by:
 * - Any index (unique or non-unique) with the same columns, OR
 * - A unique constraint with the same columns (stronger satisfies weaker)
 *
 * @param indexes - The indexes in the schema table
 * @param uniques - The unique constraints in the schema table
 * @param columns - The columns required by the index
 * @returns true if the requirement is satisfied
 */
export function isIndexSatisfied(
  indexes: readonly SqlIndexIR[],
  uniques: readonly SqlUniqueIR[],
  columns: readonly string[],
): boolean {
  // Check for any matching index (unique or non-unique)
  const hasMatchingIndex = indexes.some((index) => arraysEqual(index.columns, columns));
  if (hasMatchingIndex) {
    return true;
  }
  // Check for matching unique constraint (semantic satisfaction)
  return uniques.some((unique) => arraysEqual(unique.columns, columns));
}

/**
 * Verifies primary key matches between contract and schema.
 * Returns 'pass' or 'fail'.
 *
 * Uses semantic satisfaction: identity is based on (table + kind + columns).
 * Name differences are ignored by default (names are for DDL/diagnostics, not identity).
 */
export function verifyPrimaryKey(
  contractPK: PrimaryKey,
  schemaPK: PrimaryKey | undefined,
  tableName: string,
  issues: SchemaIssue[],
): 'pass' | 'fail' {
  if (!schemaPK) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      expected: contractPK.columns.join(', '),
      message: `Table "${tableName}" is missing primary key`,
    });
    return 'fail';
  }

  if (!arraysEqual(contractPK.columns, schemaPK.columns)) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      expected: contractPK.columns.join(', '),
      actual: schemaPK.columns.join(', '),
      message: `Table "${tableName}" has primary key mismatch: expected columns [${contractPK.columns.join(', ')}], got [${schemaPK.columns.join(', ')}]`,
    });
    return 'fail';
  }

  // Name differences are ignored for semantic satisfaction.
  // Names are persisted for deterministic DDL and diagnostics but are not identity.

  return 'pass';
}

/**
 * Verifies foreign keys match between contract and schema.
 * Returns verification nodes for the tree.
 *
 * Uses semantic satisfaction: identity is based on (table + columns + referenced table + referenced columns).
 * Name differences are ignored by default (names are for DDL/diagnostics, not identity).
 */
export function verifyForeignKeys(
  contractFKs: readonly ForeignKey[],
  schemaFKs: readonly SqlForeignKeyIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract FK exists in schema
  for (const contractFK of contractFKs) {
    const fkPath = `${tablePath}.foreignKeys[${contractFK.columns.join(',')}]`;
    const matchingFK = schemaFKs.find((fk) => {
      return (
        arraysEqual(fk.columns, contractFK.columns) &&
        fk.referencedTable === contractFK.references.table &&
        arraysEqual(fk.referencedColumns, contractFK.references.columns)
      );
    });

    if (!matchingFK) {
      issues.push({
        kind: 'foreign_key_mismatch',
        table: tableName,
        expected: `${contractFK.columns.join(', ')} -> ${contractFK.references.table}(${contractFK.references.columns.join(', ')})`,
        message: `Table "${tableName}" is missing foreign key: ${contractFK.columns.join(', ')} -> ${contractFK.references.table}(${contractFK.references.columns.join(', ')})`,
      });
      nodes.push({
        status: 'fail',
        kind: 'foreignKey',
        name: `foreignKey(${contractFK.columns.join(', ')})`,
        contractPath: fkPath,
        code: 'foreign_key_mismatch',
        message: 'Foreign key missing',
        expected: contractFK,
        actual: undefined,
        children: [],
      });
    } else {
      // Name differences are ignored for semantic satisfaction.
      // Names are persisted for deterministic DDL and diagnostics but are not identity.
      nodes.push({
        status: 'pass',
        kind: 'foreignKey',
        name: `foreignKey(${contractFK.columns.join(', ')})`,
        contractPath: fkPath,
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
  }

  // Check for extra FKs in strict mode
  if (strict) {
    for (const schemaFK of schemaFKs) {
      const matchingFK = contractFKs.find((fk) => {
        return (
          arraysEqual(fk.columns, schemaFK.columns) &&
          fk.references.table === schemaFK.referencedTable &&
          arraysEqual(fk.references.columns, schemaFK.referencedColumns)
        );
      });

      if (!matchingFK) {
        issues.push({
          kind: 'extra_foreign_key',
          table: tableName,
          message: `Extra foreign key found in database (not in contract): ${schemaFK.columns.join(', ')} -> ${schemaFK.referencedTable}(${schemaFK.referencedColumns.join(', ')})`,
        });
        nodes.push({
          status: 'fail',
          kind: 'foreignKey',
          name: `foreignKey(${schemaFK.columns.join(', ')})`,
          contractPath: `${tablePath}.foreignKeys[${schemaFK.columns.join(',')}]`,
          code: 'extra_foreign_key',
          message: 'Extra foreign key found',
          expected: undefined,
          actual: schemaFK,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Verifies unique constraints match between contract and schema.
 * Returns verification nodes for the tree.
 *
 * Uses semantic satisfaction: identity is based on (table + kind + columns).
 * A unique constraint requirement can be satisfied by either:
 * - A unique constraint with the same columns, or
 * - A unique index with the same columns
 *
 * Name differences are ignored by default (names are for DDL/diagnostics, not identity).
 */
export function verifyUniqueConstraints(
  contractUniques: readonly UniqueConstraint[],
  schemaUniques: readonly SqlUniqueIR[],
  schemaIndexes: readonly SqlIndexIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract unique exists in schema
  for (const contractUnique of contractUniques) {
    const uniquePath = `${tablePath}.uniques[${contractUnique.columns.join(',')}]`;

    // First check for a matching unique constraint
    const matchingUnique = schemaUniques.find((u) =>
      arraysEqual(u.columns, contractUnique.columns),
    );

    // If no matching constraint, check for a unique index with the same columns
    const matchingUniqueIndex =
      !matchingUnique &&
      schemaIndexes.find((idx) => idx.unique && arraysEqual(idx.columns, contractUnique.columns));

    if (!matchingUnique && !matchingUniqueIndex) {
      issues.push({
        kind: 'unique_constraint_mismatch',
        table: tableName,
        expected: contractUnique.columns.join(', '),
        message: `Table "${tableName}" is missing unique constraint: ${contractUnique.columns.join(', ')}`,
      });
      nodes.push({
        status: 'fail',
        kind: 'unique',
        name: `unique(${contractUnique.columns.join(', ')})`,
        contractPath: uniquePath,
        code: 'unique_constraint_mismatch',
        message: 'Unique constraint missing',
        expected: contractUnique,
        actual: undefined,
        children: [],
      });
    } else {
      // Name differences are ignored for semantic satisfaction.
      // Names are persisted for deterministic DDL and diagnostics but are not identity.
      nodes.push({
        status: 'pass',
        kind: 'unique',
        name: `unique(${contractUnique.columns.join(', ')})`,
        contractPath: uniquePath,
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
  }

  // Check for extra uniques in strict mode
  if (strict) {
    for (const schemaUnique of schemaUniques) {
      const matchingUnique = contractUniques.find((u) =>
        arraysEqual(u.columns, schemaUnique.columns),
      );

      if (!matchingUnique) {
        issues.push({
          kind: 'extra_unique_constraint',
          table: tableName,
          message: `Extra unique constraint found in database (not in contract): ${schemaUnique.columns.join(', ')}`,
        });
        nodes.push({
          status: 'fail',
          kind: 'unique',
          name: `unique(${schemaUnique.columns.join(', ')})`,
          contractPath: `${tablePath}.uniques[${schemaUnique.columns.join(',')}]`,
          code: 'extra_unique_constraint',
          message: 'Extra unique constraint found',
          expected: undefined,
          actual: schemaUnique,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Verifies indexes match between contract and schema.
 * Returns verification nodes for the tree.
 *
 * Uses semantic satisfaction: identity is based on (table + kind + columns).
 * A non-unique index requirement can be satisfied by either:
 * - A non-unique index with the same columns, or
 * - A unique index with the same columns (stronger satisfies weaker)
 *
 * Name differences are ignored by default (names are for DDL/diagnostics, not identity).
 */
export function verifyIndexes(
  contractIndexes: readonly Index[],
  schemaIndexes: readonly SqlIndexIR[],
  schemaUniques: readonly SqlUniqueIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract index exists in schema
  for (const contractIndex of contractIndexes) {
    const indexPath = `${tablePath}.indexes[${contractIndex.columns.join(',')}]`;

    // Check for any matching index (unique or non-unique)
    // A unique index can satisfy a non-unique index requirement (stronger satisfies weaker)
    const matchingIndex = schemaIndexes.find((idx) =>
      arraysEqual(idx.columns, contractIndex.columns),
    );

    // Also check if a unique constraint satisfies the index requirement
    const matchingUniqueConstraint =
      !matchingIndex && schemaUniques.find((u) => arraysEqual(u.columns, contractIndex.columns));

    if (!matchingIndex && !matchingUniqueConstraint) {
      issues.push({
        kind: 'index_mismatch',
        table: tableName,
        expected: contractIndex.columns.join(', '),
        message: `Table "${tableName}" is missing index: ${contractIndex.columns.join(', ')}`,
      });
      nodes.push({
        status: 'fail',
        kind: 'index',
        name: `index(${contractIndex.columns.join(', ')})`,
        contractPath: indexPath,
        code: 'index_mismatch',
        message: 'Index missing',
        expected: contractIndex,
        actual: undefined,
        children: [],
      });
    } else {
      // Name differences are ignored for semantic satisfaction.
      // Names are persisted for deterministic DDL and diagnostics but are not identity.
      nodes.push({
        status: 'pass',
        kind: 'index',
        name: `index(${contractIndex.columns.join(', ')})`,
        contractPath: indexPath,
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
  }

  // Check for extra indexes in strict mode
  if (strict) {
    for (const schemaIndex of schemaIndexes) {
      // Skip unique indexes (they're handled as unique constraints)
      if (schemaIndex.unique) {
        continue;
      }

      const matchingIndex = contractIndexes.find((idx) =>
        arraysEqual(idx.columns, schemaIndex.columns),
      );

      if (!matchingIndex) {
        issues.push({
          kind: 'extra_index',
          table: tableName,
          message: `Extra index found in database (not in contract): ${schemaIndex.columns.join(', ')}`,
        });
        nodes.push({
          status: 'fail',
          kind: 'index',
          name: `index(${schemaIndex.columns.join(', ')})`,
          contractPath: `${tablePath}.indexes[${schemaIndex.columns.join(',')}]`,
          code: 'extra_index',
          message: 'Extra index found',
          expected: undefined,
          actual: schemaIndex,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Verifies database dependencies are installed using component-owned verification hooks.
 * Each dependency provides a pure verifyDatabaseDependencyInstalled function that checks
 * whether the dependency is satisfied based on the in-memory schema IR (no DB I/O).
 *
 * Returns verification nodes for the tree.
 */
export function verifyDatabaseDependencies(
  dependencies: ReadonlyArray<ComponentDatabaseDependency<unknown>>,
  schema: SqlSchemaIR,
  issues: SchemaIssue[],
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  for (const dependency of dependencies) {
    const depIssues = dependency.verifyDatabaseDependencyInstalled(schema);
    const depPath = `dependencies.${dependency.id}`;

    if (depIssues.length > 0) {
      // Dependency is not satisfied
      issues.push(...depIssues);
      const issuesMessage = depIssues.map((i) => i.message).join('; ');
      const nodeMessage = issuesMessage ? `${dependency.id}: ${issuesMessage}` : dependency.id;
      nodes.push({
        status: 'fail',
        kind: 'databaseDependency',
        name: dependency.label,
        contractPath: depPath,
        code: 'dependency_missing',
        message: nodeMessage,
        expected: undefined,
        actual: undefined,
        children: [],
      });
    } else {
      // Dependency is satisfied
      nodes.push({
        status: 'pass',
        kind: 'databaseDependency',
        name: dependency.label,
        contractPath: depPath,
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
  }

  return nodes;
}

/**
 * Computes counts of pass/warn/fail nodes by traversing the tree.
 */
export function computeCounts(node: SchemaVerificationNode): {
  pass: number;
  warn: number;
  fail: number;
  totalNodes: number;
} {
  let pass = 0;
  let warn = 0;
  let fail = 0;

  function traverse(n: SchemaVerificationNode): void {
    if (n.status === 'pass') {
      pass++;
    } else if (n.status === 'warn') {
      warn++;
    } else if (n.status === 'fail') {
      fail++;
    }

    if (n.children) {
      for (const child of n.children) {
        traverse(child);
      }
    }
  }

  traverse(node);

  return {
    pass,
    warn,
    fail,
    totalNodes: pass + warn + fail,
  };
}
