/**
 * Descriptor-based migration planner.
 *
 * Takes schema issues (from verifySqlSchema) and emits MigrationOpDescriptor[].
 * Pattern matchers consume issues they recognize and produce specialized op
 * sequences (e.g., NOT NULL backfill → addColumn(nullable) + dataTransform + setNotNull).
 * Remaining issues get default descriptor mapping.
 *
 * This planner does NOT produce SqlMigrationPlanOperation — that's the resolver's job.
 * The separation means the same descriptors work for both planner-generated and
 * user-authored migrations.
 */

import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  addColumn,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  alterColumnType,
  createIndex,
  createTable,
  dataTransform,
  dropColumn,
  dropConstraint,
  dropDefault,
  dropIndex,
  dropNotNull,
  dropTable,
  type MigrationOpDescriptor,
  setDefault,
  setNotNull,
} from './operation-descriptors';

// ============================================================================
// Pattern matching
// ============================================================================

export interface PatternContext {
  readonly toContract: SqlContract<SqlStorage>;
  readonly fromContract: SqlContract<SqlStorage> | null;
}

export type PatternMatcher = (
  issues: readonly SchemaIssue[],
  context: PatternContext,
) =>
  | { kind: 'match'; issues: readonly SchemaIssue[]; ops: readonly MigrationOpDescriptor[] }
  | { kind: 'no_match' };

/**
 * NOT NULL backfill pattern.
 *
 * When a missing column is NOT NULL without a default, the planner can't just
 * add it — existing rows would violate the constraint. Instead, emit:
 *   addColumn(nullable) → dataTransformDraft (user fills in backfill) → setNotNull
 */
export const notNullBackfillMatcher: PatternMatcher = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const ops: MigrationOpDescriptor[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'missing_column' || !issue.table || !issue.column) continue;

    const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
    if (!column) continue;
    if (column.nullable !== false || column.default !== undefined) continue;

    matched.push(issue);
    ops.push(
      addColumn(issue.table, issue.column, { nullable: true }),
      dataTransform(`backfill-${issue.table}-${issue.column}`, {
        check: false,
        run: { kind: 'todo', sql: `-- TODO: backfill "${issue.column}" on "${issue.table}"` },
      }),
      setNotNull(issue.table, issue.column),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    ops,
  };
};

// ============================================================================
// Issue kind ordering (dependency order)
// ============================================================================

const ISSUE_KIND_ORDER: Record<string, number> = {
  // Drops first (reconciliation — clear the way for creates)
  extra_table: 10,
  extra_foreign_key: 11,
  extra_unique_constraint: 12,
  extra_primary_key: 13,
  extra_index: 14,
  extra_column: 15,
  extra_default: 16,

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
  foreign_key_mismatch: 60, // FKs last (depend on referenced tables)

  // Dependencies and types
  dependency_missing: 1,
  type_missing: 2,
  type_values_mismatch: 3,
};

function issueOrder(issue: SchemaIssue): number {
  return ISSUE_KIND_ORDER[issue.kind] ?? 99;
}

// ============================================================================
// Default issue-to-descriptor mapping
// ============================================================================

/**
 * Returns true if the issue represents a "missing" constraint (no actual value)
 * rather than a "mismatched" constraint (actual differs from expected).
 */
function isMissing(issue: SchemaIssue): boolean {
  return issue.actual === undefined;
}

function defaultDescriptorsForIssue(
  issue: SchemaIssue,
  ctx: PatternContext,
): readonly MigrationOpDescriptor[] {
  switch (issue.kind) {
    // Additive
    case 'missing_table':
      return issue.table ? [createTable(issue.table)] : [];

    case 'missing_column':
      return issue.table && issue.column ? [addColumn(issue.table, issue.column)] : [];

    case 'default_missing':
      return issue.table && issue.column ? [setDefault(issue.table, issue.column)] : [];

    // Destructive drops
    case 'extra_table':
      return issue.table ? [dropTable(issue.table)] : [];

    case 'extra_column':
      return issue.table && issue.column ? [dropColumn(issue.table, issue.column)] : [];

    case 'extra_index':
      return issue.table && issue.indexOrConstraint
        ? [dropIndex(issue.table, issue.indexOrConstraint)]
        : [];

    case 'extra_unique_constraint':
    case 'extra_foreign_key':
    case 'extra_primary_key':
      return issue.table && issue.indexOrConstraint
        ? [dropConstraint(issue.table, issue.indexOrConstraint)]
        : [];

    case 'extra_default':
      return issue.table && issue.column ? [dropDefault(issue.table, issue.column)] : [];

    // Nullability changes
    case 'nullability_mismatch': {
      if (!issue.table || !issue.column) return [];
      const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
      if (!column) return [];
      return column.nullable
        ? [dropNotNull(issue.table, issue.column)]
        : [setNotNull(issue.table, issue.column)];
    }

    // Type changes
    case 'type_mismatch':
      return issue.table && issue.column ? [alterColumnType(issue.table, issue.column)] : [];

    // Default changes
    case 'default_mismatch':
      return issue.table && issue.column ? [setDefault(issue.table, issue.column)] : [];

    // Missing constraints (detected via _mismatch with actual === undefined)
    case 'primary_key_mismatch':
      if (isMissing(issue) && issue.table) return [addPrimaryKey(issue.table)];
      return []; // Actual mismatch — conflict, not handled by descriptors

    case 'unique_constraint_mismatch':
      if (isMissing(issue) && issue.table && issue.expected) {
        const columns = issue.expected.split(', ');
        return [addUnique(issue.table, columns)];
      }
      return [];

    case 'index_mismatch':
      if (isMissing(issue) && issue.table && issue.expected) {
        const columns = issue.expected.split(', ');
        return [createIndex(issue.table, columns)];
      }
      return [];

    case 'foreign_key_mismatch':
      if (isMissing(issue) && issue.table && issue.expected) {
        // expected format: "col1, col2 -> refTable(refCol1, refCol2)"
        // We need just the columns for the descriptor
        const arrowIdx = issue.expected.indexOf(' -> ');
        if (arrowIdx >= 0) {
          const columns = issue.expected.slice(0, arrowIdx).split(', ');
          return [addForeignKey(issue.table, columns)];
        }
      }
      return [];

    default:
      return [];
  }
}

// ============================================================================
// Planner entry point
// ============================================================================

export interface DescriptorPlannerOptions {
  readonly issues: readonly SchemaIssue[];
  readonly toContract: SqlContract<SqlStorage>;
  readonly fromContract: SqlContract<SqlStorage> | null;
  readonly matchers?: readonly PatternMatcher[];
}

export interface DescriptorPlannerResult {
  readonly descriptors: readonly MigrationOpDescriptor[];
  readonly needsDataMigration: boolean;
  readonly unmatchedIssues: readonly SchemaIssue[];
}

export function planDescriptors(options: DescriptorPlannerOptions): DescriptorPlannerResult {
  const context: PatternContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
  };

  const matchers = options.matchers ?? [notNullBackfillMatcher];

  // Phase 1: Pattern matching — consume recognized issues
  let remaining = options.issues;
  const patternOps: MigrationOpDescriptor[] = [];
  let needsDataMigration = false;

  for (const matcher of matchers) {
    const result = matcher(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      patternOps.push(...result.ops);
      if (result.ops.some((op) => op.kind === 'dataTransform')) {
        needsDataMigration = true;
      }
    }
  }

  // Phase 2: Sort remaining issues by dependency order
  const sorted = [...remaining].sort((a, b) => issueOrder(a) - issueOrder(b));

  // Phase 3: Default mapping for remaining issues
  const defaultOps: MigrationOpDescriptor[] = [];
  for (const issue of sorted) {
    defaultOps.push(...defaultDescriptorsForIssue(issue, context));
  }

  // Phase 4: Merge — pattern ops are inserted at the right position
  // Pattern ops for missing_column go after createTable but before constraints
  // For now, simple approach: pattern ops after tables, before constraints
  const tableOps = defaultOps.filter((op) => op.kind === 'createTable');
  const dropOps = defaultOps.filter(
    (op) =>
      op.kind === 'dropTable' ||
      op.kind === 'dropColumn' ||
      op.kind === 'dropConstraint' ||
      op.kind === 'dropIndex' ||
      op.kind === 'dropDefault',
  );
  const columnOps = defaultOps.filter((op) => op.kind === 'addColumn');
  const alterOps = defaultOps.filter(
    (op) =>
      op.kind === 'alterColumnType' ||
      op.kind === 'setNotNull' ||
      op.kind === 'dropNotNull' ||
      op.kind === 'setDefault' ||
      op.kind === 'dropDefault',
  );
  // Filter out dropDefault from alterOps since it's already in dropOps
  const pureAlterOps = alterOps.filter((op) => op.kind !== 'dropDefault');
  const constraintOps = defaultOps.filter(
    (op) =>
      op.kind === 'addPrimaryKey' ||
      op.kind === 'addUnique' ||
      op.kind === 'createIndex' ||
      op.kind === 'addForeignKey',
  );

  const descriptors: MigrationOpDescriptor[] = [
    ...dropOps,
    ...tableOps,
    ...columnOps,
    ...patternOps,
    ...pureAlterOps,
    ...constraintOps,
  ];

  return {
    descriptors,
    needsDataMigration,
    unmatchedIssues: remaining.filter(
      (issue) => defaultDescriptorsForIssue(issue, context).length === 0,
    ),
  };
}
