/**
 * Pure verification helper functions for SQL schema verification.
 * These functions verify schema IR against contract requirements.
 */

import type { ControlPolicy } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  SchemaVerificationNode,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type {
  ForeignKey,
  Index,
  PrimaryKey,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import type {
  SqlCheckConstraintIR,
  SqlCheckConstraintIRInput,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { SqlExpressionCheckIR, SqlValueSetCheckIR } from '@prisma-next/sql-schema-ir/types';
import {
  emitIssueAndNodeUnderControlPolicy,
  emitIssueUnderControlPolicy,
} from './control-verify-emit';

function indexOptionsLooselyEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  const aKeys = a ? Object.keys(a).sort() : [];
  const bKeys = b ? Object.keys(b).sort() : [];
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  if (aKeys.length === 0) return true;
  for (const key of aKeys) {
    // Postgres introspection returns reloptions values as raw strings (e.g.
    // `'70'`, `'false'`), while contract option leaves are typed (number,
    // boolean, string). Compare via String() so a contract `fillfactor: 70`
    // matches an introspected `fillfactor: '70'` without a spurious mismatch.
    if (
      String((a as Record<string, unknown>)[key]) !== String((b as Record<string, unknown>)[key])
    ) {
      return false;
    }
  }
  return true;
}

function indexExtrasMatch(
  contractIndex: Index,
  schemaIndex: { readonly type?: string; readonly options?: Record<string, unknown> },
): boolean {
  if ((contractIndex.type ?? null) !== (schemaIndex.type ?? null)) return false;
  return indexOptionsLooselyEqual(contractIndex.options, schemaIndex.options);
}

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
  namespaceId: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
): 'pass' | 'warn' | 'fail' {
  if (!schemaPK) {
    const issue: SchemaIssue = {
      kind: 'primary_key_mismatch',
      table: tableName,
      namespaceId,
      expected: contractPK.columns.join(', '),
      message: `Table "${tableName}" is missing primary key`,
    };
    const outcome = emitIssueUnderControlPolicy(tableControlPolicy, issue, issues);
    return outcome === 'suppress' ? 'pass' : outcome;
  }

  if (!arraysEqual(contractPK.columns, schemaPK.columns)) {
    const issue: SchemaIssue = {
      kind: 'primary_key_mismatch',
      table: tableName,
      namespaceId,
      expected: contractPK.columns.join(', '),
      actual: schemaPK.columns.join(', '),
      message: `Table "${tableName}" has primary key mismatch: expected columns [${contractPK.columns.join(', ')}], got [${schemaPK.columns.join(', ')}]`,
    };
    const outcome = emitIssueUnderControlPolicy(tableControlPolicy, issue, issues);
    return outcome === 'suppress' ? 'pass' : outcome;
  }

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
  namespaceId: string,
  tablePath: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract FK exists in schema
  for (const contractFK of contractFKs) {
    const fkPath = `${tablePath}.foreignKeys[${contractFK.source.columns.join(',')}]`;
    const matchingFK = schemaFKs.find((fk) => {
      // When the schema FK carries referencedSchema (populated by the Postgres
      // adapter for cross-schema FKs), compare the full (namespace, table) pair
      // against the contract FK's target coordinate. When referencedSchema is
      // absent (same-schema FKs, older introspection, or hand-crafted test
      // fixtures), fall back to table-name-only comparison so same-namespace
      // contracts continue to verify correctly.
      const tablesMatch =
        fk.referencedSchema !== undefined && contractFK.target.namespaceId !== UNBOUND_NAMESPACE_ID
          ? fk.referencedSchema === contractFK.target.namespaceId &&
            fk.referencedTable === contractFK.target.tableName
          : fk.referencedTable === contractFK.target.tableName;
      return (
        arraysEqual(fk.columns, contractFK.source.columns) &&
        tablesMatch &&
        arraysEqual(fk.referencedColumns, contractFK.target.columns)
      );
    });

    if (!matchingFK) {
      const issue: SchemaIssue = {
        kind: 'foreign_key_mismatch',
        table: tableName,
        namespaceId,
        expected: `${contractFK.source.columns.join(', ')} -> ${contractFK.target.tableName}(${contractFK.target.columns.join(', ')})`,
        message: `Table "${tableName}" is missing foreign key: ${contractFK.source.columns.join(', ')} -> ${contractFK.target.tableName}(${contractFK.target.columns.join(', ')})`,
      };
      emitIssueAndNodeUnderControlPolicy(
        tableControlPolicy,
        issue,
        {
          status: 'fail',
          kind: 'foreignKey',
          name: `foreignKey(${contractFK.source.columns.join(', ')})`,
          contractPath: fkPath,
          code: 'foreign_key_mismatch',
          message: 'Foreign key missing',
          expected: contractFK,
          actual: undefined,
          children: [],
        },
        issues,
        nodes,
      );
    } else {
      const actionMismatches = getReferentialActionMismatches(contractFK, matchingFK);
      if (actionMismatches.length > 0) {
        const combinedMessage = actionMismatches.map((m) => m.message).join('; ');
        const combinedExpected = actionMismatches.map((m) => m.expected).join(', ');
        const combinedActual = actionMismatches.map((m) => m.actual).join(', ');
        const issue: SchemaIssue = {
          kind: 'foreign_key_mismatch',
          table: tableName,
          namespaceId,
          indexOrConstraint: matchingFK.name ?? `fk(${contractFK.source.columns.join(',')})`,
          expected: combinedExpected,
          actual: combinedActual,
          message: `Table "${tableName}" foreign key ${contractFK.source.columns.join(', ')} -> ${contractFK.target.tableName}: ${combinedMessage}`,
        };
        emitIssueAndNodeUnderControlPolicy(
          tableControlPolicy,
          issue,
          {
            status: 'fail',
            kind: 'foreignKey',
            name: `foreignKey(${contractFK.source.columns.join(', ')})`,
            contractPath: fkPath,
            code: 'foreign_key_mismatch',
            message: combinedMessage,
            expected: contractFK,
            actual: matchingFK,
            children: [],
          },
          issues,
          nodes,
        );
      } else {
        nodes.push({
          status: 'pass',
          kind: 'foreignKey',
          name: `foreignKey(${contractFK.source.columns.join(', ')})`,
          contractPath: fkPath,
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        });
      }
    }
  }

  // Check for extra FKs in strict mode
  if (strict) {
    for (const schemaFK of schemaFKs) {
      const matchingFK = contractFKs.find((fk) => {
        const tablesMatch =
          schemaFK.referencedSchema !== undefined && fk.target.namespaceId !== UNBOUND_NAMESPACE_ID
            ? schemaFK.referencedSchema === fk.target.namespaceId &&
              schemaFK.referencedTable === fk.target.tableName
            : schemaFK.referencedTable === fk.target.tableName;
        return (
          arraysEqual(fk.source.columns, schemaFK.columns) &&
          tablesMatch &&
          arraysEqual(fk.target.columns, schemaFK.referencedColumns)
        );
      });

      if (!matchingFK) {
        const issue: SchemaIssue = {
          kind: 'extra_foreign_key',
          table: tableName,
          namespaceId,
          indexOrConstraint: schemaFK.name ?? `fk(${schemaFK.columns.join(',')})`,
          message: `Extra foreign key found in database (not in contract): ${schemaFK.columns.join(', ')} -> ${schemaFK.referencedTable}(${schemaFK.referencedColumns.join(', ')})`,
        };
        emitIssueAndNodeUnderControlPolicy(
          tableControlPolicy,
          issue,
          {
            status: 'fail',
            kind: 'foreignKey',
            name: `foreignKey(${schemaFK.columns.join(', ')})`,
            contractPath: `${tablePath}.foreignKeys[${schemaFK.columns.join(',')}]`,
            code: 'extra_foreign_key',
            message: 'Extra foreign key found',
            expected: undefined,
            actual: schemaFK,
            children: [],
          },
          issues,
          nodes,
        );
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
  namespaceId: string,
  tablePath: string,
  tableControlPolicy: ControlPolicy,
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
      const issue: SchemaIssue = {
        kind: 'unique_constraint_mismatch',
        table: tableName,
        namespaceId,
        expected: contractUnique.columns.join(', '),
        message: `Table "${tableName}" is missing unique constraint: ${contractUnique.columns.join(', ')}`,
      };
      emitIssueAndNodeUnderControlPolicy(
        tableControlPolicy,
        issue,
        {
          status: 'fail',
          kind: 'unique',
          name: `unique(${contractUnique.columns.join(', ')})`,
          contractPath: uniquePath,
          code: 'unique_constraint_mismatch',
          message: 'Unique constraint missing',
          expected: contractUnique,
          actual: undefined,
          children: [],
        },
        issues,
        nodes,
      );
    } else {
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

  if (strict) {
    for (const schemaUnique of schemaUniques) {
      const matchingUnique = contractUniques.find((u) =>
        arraysEqual(u.columns, schemaUnique.columns),
      );

      if (!matchingUnique) {
        const issue: SchemaIssue = {
          kind: 'extra_unique_constraint',
          table: tableName,
          namespaceId,
          indexOrConstraint: schemaUnique.name ?? `unique(${schemaUnique.columns.join(',')})`,
          message: `Extra unique constraint found in database (not in contract): ${schemaUnique.columns.join(', ')}`,
        };
        emitIssueAndNodeUnderControlPolicy(
          tableControlPolicy,
          issue,
          {
            status: 'fail',
            kind: 'unique',
            name: `unique(${schemaUnique.columns.join(', ')})`,
            contractPath: `${tablePath}.uniques[${schemaUnique.columns.join(',')}]`,
            code: 'extra_unique_constraint',
            message: 'Extra unique constraint found',
            expected: undefined,
            actual: schemaUnique,
            children: [],
          },
          issues,
          nodes,
        );
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
  namespaceId: string,
  tablePath: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract index exists in schema
  for (const contractIndex of contractIndexes) {
    const indexPath = `${tablePath}.indexes[${contractIndex.columns.join(',')}]`;

    // Check for any matching index (unique or non-unique)
    // A unique index can satisfy a non-unique index requirement (stronger satisfies weaker)
    const matchingIndex = schemaIndexes.find(
      (idx) =>
        arraysEqual(idx.columns, contractIndex.columns) && indexExtrasMatch(contractIndex, idx),
    );

    // Also check if a unique constraint satisfies the index requirement.
    // Unique constraints carry no type/options of their own, so they can only
    // satisfy a contract index that doesn't request a specific type/options.
    const matchingUniqueConstraint =
      !matchingIndex &&
      contractIndex.type === undefined &&
      contractIndex.options === undefined &&
      schemaUniques.find((u) => arraysEqual(u.columns, contractIndex.columns));

    if (!matchingIndex && !matchingUniqueConstraint) {
      const issue: SchemaIssue = {
        kind: 'index_mismatch',
        table: tableName,
        namespaceId,
        expected: contractIndex.columns.join(', '),
        message: `Table "${tableName}" is missing index: ${contractIndex.columns.join(', ')}`,
      };
      emitIssueAndNodeUnderControlPolicy(
        tableControlPolicy,
        issue,
        {
          status: 'fail',
          kind: 'index',
          name: `index(${contractIndex.columns.join(', ')})`,
          contractPath: indexPath,
          code: 'index_mismatch',
          message: 'Index missing',
          expected: contractIndex,
          actual: undefined,
          children: [],
        },
        issues,
        nodes,
      );
    } else {
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

  if (strict) {
    for (const schemaIndex of schemaIndexes) {
      if (schemaIndex.unique) {
        continue;
      }

      const matchingIndex = contractIndexes.find(
        (idx) =>
          arraysEqual(idx.columns, schemaIndex.columns) && indexExtrasMatch(idx, schemaIndex),
      );

      if (!matchingIndex) {
        const issue: SchemaIssue = {
          kind: 'extra_index',
          table: tableName,
          namespaceId,
          indexOrConstraint: schemaIndex.name ?? `idx(${schemaIndex.columns.join(',')})`,
          message: `Extra index found in database (not in contract): ${schemaIndex.columns.join(', ')}`,
        };
        emitIssueAndNodeUnderControlPolicy(
          tableControlPolicy,
          issue,
          {
            status: 'fail',
            kind: 'index',
            name: `index(${schemaIndex.columns.join(', ')})`,
            contractPath: `${tablePath}.indexes[${schemaIndex.columns.join(',')}]`,
            code: 'extra_index',
            message: 'Extra index found',
            expected: undefined,
            actual: schemaIndex,
            children: [],
          },
          issues,
          nodes,
        );
      }
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

/**
 * Compares referential actions between a contract FK and a schema FK.
 * Only compares when the contract FK explicitly specifies onDelete or onUpdate.
 * Returns all mismatches (both onDelete and onUpdate) so both are reported at once.
 *
 * Note: 'noAction' in the contract is semantically equivalent to undefined in the
 * schema IR, because the introspection adapter omits 'NO ACTION' (the database default)
 * to keep the IR sparse. We normalize both sides before comparing.
 */
function getReferentialActionMismatches(
  contractFK: ForeignKey,
  schemaFK: SqlForeignKeyIR,
): ReadonlyArray<{ expected: string; actual: string; message: string }> {
  const mismatches: Array<{ expected: string; actual: string; message: string }> = [];

  const contractOnDelete = normalizeReferentialAction(contractFK.onDelete);
  const schemaOnDelete = normalizeReferentialAction(schemaFK.onDelete);
  if (contractOnDelete !== undefined && contractOnDelete !== schemaOnDelete) {
    mismatches.push({
      expected: `onDelete: ${contractFK.onDelete}`,
      actual: `onDelete: ${schemaFK.onDelete ?? 'noAction (default)'}`,
      message: `onDelete mismatch: expected ${contractFK.onDelete}, got ${schemaFK.onDelete ?? 'noAction (default)'}`,
    });
  }

  const contractOnUpdate = normalizeReferentialAction(contractFK.onUpdate);
  const schemaOnUpdate = normalizeReferentialAction(schemaFK.onUpdate);
  if (contractOnUpdate !== undefined && contractOnUpdate !== schemaOnUpdate) {
    mismatches.push({
      expected: `onUpdate: ${contractFK.onUpdate}`,
      actual: `onUpdate: ${schemaFK.onUpdate ?? 'noAction (default)'}`,
      message: `onUpdate mismatch: expected ${contractFK.onUpdate}, got ${schemaFK.onUpdate ?? 'noAction (default)'}`,
    });
  }

  return mismatches;
}

/**
 * Normalizes a referential action value for comparison.
 * 'noAction' is the database default and equivalent to undefined (omitted) in the sparse IR.
 */
function normalizeReferentialAction(action: string | undefined): string | undefined {
  return action === 'noAction' ? undefined : action;
}

/**
 * Compares two value arrays as unordered sets.
 * Returns true when both sides contain exactly the same values.
 */
function valueSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const aSet = new Set(a);
  const bSet = new Set(b);
  if (aSet.size !== bSet.size) return false;
  return [...aSet].every((v) => bSet.has(v));
}

/**
 * Compares two canonical check predicates by strict string equality. Both sides
 * are re-canonicalized to the identical predicate form (the projection emits it,
 * the introspection recognizer re-canonicalizes `pg_get_constraintdef` back to
 * it), so a byte-for-byte match is the correct equality.
 */
function expressionsEqual(a: string, b: string): boolean {
  return a === b;
}

/** Human-readable label for a contract-projected check (expected side). */
function contractCheckLabel(check: SqlCheckConstraintIRInput): string {
  return check.kind === 'valueSet' ? check.permittedValues.join(', ') : check.expression;
}

/** Human-readable label for an introspected live check (actual side). */
function liveCheckLabel(check: SqlCheckConstraintIR): string {
  if (check instanceof SqlValueSetCheckIR) return check.permittedValues.join(', ');
  if (check instanceof SqlExpressionCheckIR) return check.expression;
  return '';
}

/** Predicate describing what a contract-projected check requires (for messages). */
function contractCheckDescription(check: SqlCheckConstraintIRInput): string {
  return check.kind === 'valueSet'
    ? `column "${check.column}" IN (${check.permittedValues.join(', ')})`
    : `CHECK (${check.expression})`;
}

/**
 * Whether an introspected live check has the same content as the contract check.
 * Cross-kind (e.g. contract expects a value-set, live is an expression) is never
 * equal — a mismatch is reported so the planner can drop+recreate.
 */
export function checkContentEqual(
  contractCheck: SqlCheckConstraintIRInput,
  liveCheck: SqlCheckConstraintIR,
): boolean {
  if (contractCheck.kind === 'valueSet' && liveCheck instanceof SqlValueSetCheckIR) {
    return valueSetsEqual(contractCheck.permittedValues, liveCheck.permittedValues);
  }
  if (contractCheck.kind === 'expression' && liveCheck instanceof SqlExpressionCheckIR) {
    return expressionsEqual(contractCheck.expression, liveCheck.expression);
  }
  return false;
}

/**
 * Verifies check constraints match between contract-projected checks and
 * introspected live checks.
 *
 * Comparison is value-set-based, not SQL-string-based. Postgres rewrites
 * `col IN ('a','b')` as `col = ANY (ARRAY['a','b'])` in
 * `pg_get_constraintdef`, so comparing the extracted value sets (after
 * the introspection adapter parses the predicate) avoids false mismatches
 * from the `IN`-vs-`= ANY (ARRAY…)` rendering difference.
 *
 * Issues emitted:
 * - `check_missing` — check expected by contract but absent from live DB
 * - `check_removed` — check present in live DB but not in contract
 * - `check_mismatch` — check present on both sides but permitted values differ
 *
 * `check_removed` is emitted only when `strict` is true so non-strict
 * verification (the normal path) does not complain about extra constraints.
 */
export function verifyCheckConstraints(
  contractChecks: ReadonlyArray<SqlCheckConstraintIRInput>,
  schemaChecks: ReadonlyArray<SqlCheckConstraintIR>,
  tableName: string,
  namespaceId: string,
  tablePath: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  for (const contractCheck of contractChecks) {
    const checkPath = `${tablePath}.checks[${contractCheck.name}]`;
    const liveCheck = schemaChecks.find((c) => c.name === contractCheck.name);

    if (!liveCheck) {
      const issue: SchemaIssue = {
        kind: 'check_missing',
        table: tableName,
        namespaceId,
        indexOrConstraint: contractCheck.name,
        expected: contractCheckLabel(contractCheck),
        message: `Table "${tableName}" is missing check constraint "${contractCheck.name}" (${contractCheckDescription(contractCheck)})`,
      };
      emitIssueAndNodeUnderControlPolicy(
        tableControlPolicy,
        issue,
        {
          status: 'fail',
          kind: 'checkConstraint',
          name: `check(${contractCheck.name})`,
          contractPath: checkPath,
          code: 'check_missing',
          message: `Check constraint "${contractCheck.name}" missing`,
          expected: contractCheck,
          actual: undefined,
          children: [],
        },
        issues,
        nodes,
      );
    } else if (!checkContentEqual(contractCheck, liveCheck)) {
      const issue: SchemaIssue = {
        kind: 'check_mismatch',
        table: tableName,
        namespaceId,
        indexOrConstraint: contractCheck.name,
        expected: contractCheckLabel(contractCheck),
        actual: liveCheckLabel(liveCheck),
        message: `Table "${tableName}" check constraint "${contractCheck.name}" differs: expected [${contractCheckLabel(contractCheck)}], got [${liveCheckLabel(liveCheck)}]`,
      };
      emitIssueAndNodeUnderControlPolicy(
        tableControlPolicy,
        issue,
        {
          status: 'fail',
          kind: 'checkConstraint',
          name: `check(${contractCheck.name})`,
          contractPath: checkPath,
          code: 'check_mismatch',
          message: `Check constraint "${contractCheck.name}" values mismatch`,
          expected: contractCheck,
          actual: liveCheck,
          children: [],
        },
        issues,
        nodes,
      );
    } else {
      nodes.push({
        status: 'pass',
        kind: 'checkConstraint',
        name: `check(${contractCheck.name})`,
        contractPath: checkPath,
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
  }

  if (strict) {
    for (const liveCheck of schemaChecks) {
      const matchingContract = contractChecks.find((c) => c.name === liveCheck.name);
      if (!matchingContract) {
        const issue: SchemaIssue = {
          kind: 'check_removed',
          table: tableName,
          namespaceId,
          indexOrConstraint: liveCheck.name,
          actual: liveCheckLabel(liveCheck),
          message: `Table "${tableName}" has extra check constraint "${liveCheck.name}" in database (not in contract)`,
        };
        emitIssueAndNodeUnderControlPolicy(
          tableControlPolicy,
          issue,
          {
            status: 'fail',
            kind: 'checkConstraint',
            name: `check(${liveCheck.name})`,
            contractPath: `${tablePath}.checks[${liveCheck.name}]`,
            code: 'check_removed',
            message: `Extra check constraint "${liveCheck.name}" found`,
            expected: undefined,
            actual: liveCheck,
            children: [],
          },
          issues,
          nodes,
        );
      }
    }
  }

  return nodes;
}
