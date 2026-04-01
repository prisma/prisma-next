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
import type { SqlPlannerConflict } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
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
 *   addColumn(nullable) → dataTransform (user fills in backfill) → setNotNull
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
  // Dependencies and types first
  dependency_missing: 1,
  type_missing: 2,
  type_values_mismatch: 3,

  // Drops (reconciliation — clear the way for creates)
  // FKs dropped first (they depend on other constraints)
  extra_foreign_key: 10,
  extra_unique_constraint: 11,
  extra_primary_key: 12,
  extra_index: 13,
  extra_default: 14,
  extra_column: 15,
  extra_table: 16,

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
  foreign_key_mismatch: 60,
};

function issueOrder(issue: SchemaIssue): number {
  return ISSUE_KIND_ORDER[issue.kind] ?? 99;
}

// ============================================================================
// Conflict helpers
// ============================================================================

function issueConflict(
  kind: SqlPlannerConflict['kind'],
  summary: string,
  location?: SqlPlannerConflict['location'],
): SqlPlannerConflict {
  return {
    kind,
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

// ============================================================================
// Default issue-to-descriptor mapping
// ============================================================================

function isMissing(issue: SchemaIssue): boolean {
  return issue.actual === undefined;
}

function mapIssue(
  issue: SchemaIssue,
  ctx: PatternContext,
): Result<readonly MigrationOpDescriptor[], SqlPlannerConflict> {
  switch (issue.kind) {
    // Additive — missing structures
    case 'missing_table':
      if (!issue.table)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing table issue has no table name'),
        );
      return ok([createTable(issue.table)]);

    case 'missing_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Missing column issue has no table/column name'),
        );
      return ok([addColumn(issue.table, issue.column)]);

    case 'default_missing':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Default missing issue has no table/column name'),
        );
      return ok([setDefault(issue.table, issue.column)]);

    // Destructive — extra structures
    case 'extra_table':
      if (!issue.table)
        return notOk(issueConflict('unsupportedOperation', 'Extra table issue has no table name'));
      return ok([dropTable(issue.table)]);

    case 'extra_column':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra column issue has no table/column name'),
        );
      return ok([dropColumn(issue.table, issue.column)]);

    case 'extra_index':
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra index issue has no table/index name'),
        );
      return ok([dropIndex(issue.table, issue.indexOrConstraint)]);

    case 'extra_unique_constraint':
    case 'extra_foreign_key':
    case 'extra_primary_key':
      if (!issue.table || !issue.indexOrConstraint)
        return notOk(
          issueConflict(
            'unsupportedOperation',
            'Extra constraint issue has no table/constraint name',
          ),
        );
      return ok([dropConstraint(issue.table, issue.indexOrConstraint)]);

    case 'extra_default':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Extra default issue has no table/column name'),
        );
      return ok([dropDefault(issue.table, issue.column)]);

    // Nullability changes
    case 'nullability_mismatch': {
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('nullabilityConflict', 'Nullability mismatch has no table/column name'),
        );
      const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
      if (!column)
        return notOk(
          issueConflict(
            'nullabilityConflict',
            `Column "${issue.table}"."${issue.column}" not found in destination contract`,
          ),
        );
      return ok(
        column.nullable
          ? [dropNotNull(issue.table, issue.column)]
          : [setNotNull(issue.table, issue.column)],
      );
    }

    // Type changes
    case 'type_mismatch':
      if (!issue.table || !issue.column)
        return notOk(issueConflict('typeMismatch', 'Type mismatch has no table/column name'));
      return ok([alterColumnType(issue.table, issue.column)]);

    // Default changes
    case 'default_mismatch':
      if (!issue.table || !issue.column)
        return notOk(
          issueConflict('unsupportedOperation', 'Default mismatch has no table/column name'),
        );
      return ok([setDefault(issue.table, issue.column)]);

    // Constraints — missing (actual undefined) vs mismatched (actual defined)
    case 'primary_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('indexIncompatible', 'Primary key issue has no table name'));
      if (isMissing(issue)) return ok([addPrimaryKey(issue.table)]);
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Primary key on "${issue.table}" has different columns (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'unique_constraint_mismatch':
      if (!issue.table)
        return notOk(
          issueConflict('indexIncompatible', 'Unique constraint issue has no table name'),
        );
      if (isMissing(issue) && issue.expected) {
        const columns = issue.expected.split(', ');
        return ok([addUnique(issue.table, columns)]);
      }
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Unique constraint on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'index_mismatch':
      if (!issue.table)
        return notOk(issueConflict('indexIncompatible', 'Index issue has no table name'));
      if (isMissing(issue) && issue.expected) {
        const columns = issue.expected.split(', ');
        return ok([createIndex(issue.table, columns)]);
      }
      return notOk(
        issueConflict(
          'indexIncompatible',
          `Index on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    case 'foreign_key_mismatch':
      if (!issue.table)
        return notOk(issueConflict('foreignKeyConflict', 'Foreign key issue has no table name'));
      if (isMissing(issue) && issue.expected) {
        const arrowIdx = issue.expected.indexOf(' -> ');
        if (arrowIdx >= 0) {
          const columns = issue.expected.slice(0, arrowIdx).split(', ');
          return ok([addForeignKey(issue.table, columns)]);
        }
      }
      return notOk(
        issueConflict(
          'foreignKeyConflict',
          `Foreign key on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
          { table: issue.table },
        ),
      );

    // Type/dependency operations — not yet handled by descriptors
    case 'type_missing':
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Custom type "${issue.typeName ?? 'unknown'}" is missing — type creation not yet supported by descriptor planner`,
        ),
      );

    case 'type_values_mismatch':
      return notOk(
        issueConflict(
          'unsupportedOperation',
          'Custom type values differ — type alteration not yet supported by descriptor planner',
        ),
      );

    case 'dependency_missing':
      return notOk(
        issueConflict(
          'unsupportedOperation',
          'Database dependency is missing — dependency initialization not yet supported by descriptor planner',
        ),
      );
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

export interface DescriptorPlannerSuccess {
  readonly kind: 'success';
  readonly descriptors: readonly MigrationOpDescriptor[];
  readonly needsDataMigration: boolean;
}

export interface DescriptorPlannerFailure {
  readonly kind: 'failure';
  readonly conflicts: readonly SqlPlannerConflict[];
}

export type DescriptorPlannerResult = DescriptorPlannerSuccess | DescriptorPlannerFailure;

export function planDescriptors(options: DescriptorPlannerOptions): DescriptorPlannerResult {
  const context: PatternContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
  };

  const matchers = options.matchers ?? [notNullBackfillMatcher];

  // Phase 1: Pattern matching — consume recognized issues
  let remaining = options.issues;
  const patternOps: MigrationOpDescriptor[] = [];

  for (const matcher of matchers) {
    const result = matcher(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      patternOps.push(...result.ops);
    }
  }

  // Phase 2: Sort remaining issues by dependency order
  const sorted = [...remaining].sort((a, b) => issueOrder(a) - issueOrder(b));

  // Phase 3: Map remaining issues to descriptors, collecting conflicts
  const defaultOps: MigrationOpDescriptor[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapIssue(issue, context);
    if (result.ok) {
      defaultOps.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  if (conflicts.length > 0) {
    return { kind: 'failure', conflicts };
  }

  // Phase 4: Order descriptors by operation kind
  const dropOps = defaultOps.filter(
    (op) =>
      op.kind === 'dropTable' ||
      op.kind === 'dropColumn' ||
      op.kind === 'dropConstraint' ||
      op.kind === 'dropIndex' ||
      op.kind === 'dropDefault',
  );
  const tableOps = defaultOps.filter((op) => op.kind === 'createTable');
  const columnOps = defaultOps.filter((op) => op.kind === 'addColumn');
  const alterOps = defaultOps.filter(
    (op) =>
      op.kind === 'alterColumnType' ||
      op.kind === 'setNotNull' ||
      op.kind === 'dropNotNull' ||
      op.kind === 'setDefault',
  );
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
    ...alterOps,
    ...constraintOps,
  ];

  return {
    kind: 'success',
    descriptors,
    needsDataMigration: descriptors.some((op) => op.kind === 'dataTransform'),
  };
}
