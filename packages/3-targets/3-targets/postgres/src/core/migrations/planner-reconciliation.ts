import { quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import type { SchemaIssue } from '@prisma-next/core-control-plane/types';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlanOperation,
  SqlPlannerConflict,
} from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PlanningMode, PostgresPlanTargetDetails } from './planner';
import {
  buildColumnTypeSql,
  buildTargetDetails,
  columnExistsCheck,
  columnNullabilityCheck,
  constraintExistsCheck,
  qualifyTableName,
  toRegclassLiteral,
} from './planner';

// ============================================================================
// Public API
// ============================================================================

export function buildReconciliationPlan(options: {
  readonly contract: SqlContract<SqlStorage>;
  readonly issues: readonly SchemaIssue[];
  readonly schemaName: string;
  readonly mode: PlanningMode;
  readonly policy: MigrationOperationPolicy;
}): {
  readonly operations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
  readonly conflicts: readonly SqlPlannerConflict[];
} {
  const operations: SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] = [];
  const conflicts: SqlPlannerConflict[] = [];
  const { mode } = options;
  const seenOperationIds = new Set<string>();

  for (const issue of sortSchemaIssues(options.issues)) {
    if (isAdditiveIssue(issue)) {
      continue;
    }

    const operation = buildReconciliationOperationFromIssue({
      issue,
      contract: options.contract,
      schemaName: options.schemaName,
      mode,
    });

    if (operation) {
      // Skip duplicates: different schema issues may produce the same operation id
      // (e.g., extra_unique_constraint and extra_index on the same object).
      if (!seenOperationIds.has(operation.id)) {
        seenOperationIds.add(operation.id);
        if (options.policy.allowedOperationClasses.includes(operation.operationClass)) {
          operations.push(operation);
        } else {
          const conflict = convertIssueToConflict(issue);
          if (conflict) {
            conflicts.push(conflict);
          }
        }
      }
    } else {
      const conflict = convertIssueToConflict(issue);
      if (conflict) {
        conflicts.push(conflict);
      }
    }
  }

  return {
    operations,
    conflicts: conflicts.sort(conflictComparator),
  };
}

// ============================================================================
// Issue Classification
// ============================================================================

function isAdditiveIssue(issue: SchemaIssue): boolean {
  switch (issue.kind) {
    case 'type_missing':
    case 'type_values_mismatch':
    case 'missing_table':
    case 'missing_column':
    case 'dependency_missing':
      return true;
    case 'primary_key_mismatch':
      return issue.actual === undefined;
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
    case 'foreign_key_mismatch':
      return issue.indexOrConstraint === undefined;
    default:
      return false;
  }
}

// ============================================================================
// Operation Builders
// ============================================================================

function buildReconciliationOperationFromIssue(options: {
  readonly issue: SchemaIssue;
  readonly contract: SqlContract<SqlStorage>;
  readonly schemaName: string;
  readonly mode: PlanningMode;
}): SqlMigrationPlanOperation<PostgresPlanTargetDetails> | null {
  const { issue, contract, schemaName, mode } = options;
  switch (issue.kind) {
    case 'extra_table':
      if (!mode.allowDestructive || !issue.table) {
        return null;
      }
      return buildDropTableOperation(schemaName, issue.table);

    case 'extra_column':
      if (!mode.allowDestructive || !issue.table || !issue.column) {
        return null;
      }
      return buildDropColumnOperation(schemaName, issue.table, issue.column);

    case 'extra_index':
      if (!mode.allowDestructive || !issue.table || !issue.indexOrConstraint) {
        return null;
      }
      return buildDropIndexOperation(schemaName, issue.table, issue.indexOrConstraint);

    case 'extra_foreign_key':
    case 'extra_unique_constraint': {
      if (!mode.allowDestructive || !issue.table || !issue.indexOrConstraint) {
        return null;
      }
      const constraintKind = issue.kind === 'extra_foreign_key' ? 'foreignKey' : 'unique';
      return buildDropConstraintOperation(
        schemaName,
        issue.table,
        issue.indexOrConstraint,
        constraintKind,
      );
    }

    case 'extra_primary_key': {
      if (!mode.allowDestructive || !issue.table) {
        return null;
      }
      const constraintName = issue.indexOrConstraint ?? `${issue.table}_pkey`;
      return buildDropConstraintOperation(schemaName, issue.table, constraintName, 'primaryKey');
    }

    case 'nullability_mismatch': {
      if (!issue.table || !issue.column) {
        return null;
      }
      if (issue.expected === 'true') {
        // Contract wants nullable, DB has NOT NULL → widening
        return mode.allowWidening
          ? buildDropNotNullOperation(schemaName, issue.table, issue.column)
          : null;
      }
      // Contract wants NOT NULL, DB has nullable → destructive
      return mode.allowDestructive
        ? buildSetNotNullOperation(schemaName, issue.table, issue.column)
        : null;
    }

    case 'type_mismatch': {
      if (!mode.allowDestructive || !issue.table || !issue.column) {
        return null;
      }
      const contractColumn = getContractColumn(contract, issue.table, issue.column);
      if (!contractColumn) {
        return null;
      }
      return buildAlterColumnTypeOperation(schemaName, issue.table, issue.column, contractColumn);
    }

    // Remaining issue kinds (default_missing, default_mismatch, primary_key_mismatch,
    // unique_constraint_mismatch, index_mismatch, foreign_key_mismatch) do not yet have
    // reconciliation operation builders. They fall through to the caller, which converts them to
    // conflicts via convertIssueToConflict. When a new SchemaIssue kind is added, add a
    // case here if the planner can emit an operation for it; otherwise it becomes a conflict.
    default:
      return null;
  }
}

function getContractColumn(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  columnName: string,
): StorageColumn | null {
  const table = contract.storage.tables[tableName];
  if (!table) {
    return null;
  }
  return table.columns[columnName] ?? null;
}

function buildDropTableOperation(
  schemaName: string,
  tableName: string,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table ${tableName}`,
    summary: `Drops extra table ${tableName}`,
    operationClass: 'destructive',
    target: {
      id: 'postgres',
      details: buildTargetDetails('table', tableName, schemaName),
    },
    precheck: [
      {
        description: `ensure table "${tableName}" exists`,
        sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
      },
    ],
    execute: [
      {
        description: `drop table "${tableName}"`,
        sql: `DROP TABLE ${qualifyTableName(schemaName, tableName)}`,
      },
    ],
    postcheck: [
      {
        description: `verify table "${tableName}" is removed`,
        sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
      },
    ],
  };
}

function buildDropColumnOperation(
  schemaName: string,
  tableName: string,
  columnName: string,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  return {
    id: `dropColumn.${tableName}.${columnName}`,
    label: `Drop column ${columnName} from ${tableName}`,
    summary: `Drops extra column ${columnName} from table ${tableName}`,
    operationClass: 'destructive',
    target: {
      id: 'postgres',
      details: buildTargetDetails('column', columnName, schemaName, tableName),
    },
    precheck: [
      {
        description: `ensure column "${columnName}" exists`,
        sql: columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      },
    ],
    execute: [
      {
        description: `drop column "${columnName}"`,
        sql: `ALTER TABLE ${qualifyTableName(schemaName, tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`,
      },
    ],
    postcheck: [
      {
        description: `verify column "${columnName}" is removed`,
        sql: columnExistsCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          exists: false,
        }),
      },
    ],
  };
}

function buildDropIndexOperation(
  schemaName: string,
  tableName: string,
  indexName: string,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index ${indexName} on ${tableName}`,
    summary: `Drops extra index ${indexName} on table ${tableName}`,
    operationClass: 'destructive',
    target: {
      id: 'postgres',
      details: buildTargetDetails('index', indexName, schemaName, tableName),
    },
    precheck: [
      {
        description: `ensure index "${indexName}" exists`,
        sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NOT NULL`,
      },
    ],
    execute: [
      {
        description: `drop index "${indexName}"`,
        sql: `DROP INDEX ${qualifyTableName(schemaName, indexName)}`,
      },
    ],
    postcheck: [
      {
        description: `verify index "${indexName}" is removed`,
        sql: `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NULL`,
      },
    ],
  };
}

function buildDropConstraintOperation(
  schemaName: string,
  tableName: string,
  constraintName: string,
  constraintKind: 'foreignKey' | 'unique' | 'primaryKey',
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  return {
    id: `dropConstraint.${tableName}.${constraintName}`,
    label: `Drop constraint ${constraintName} on ${tableName}`,
    summary: `Drops extra constraint ${constraintName} on table ${tableName}`,
    operationClass: 'destructive',
    target: {
      id: 'postgres',
      details: buildTargetDetails(constraintKind, constraintName, schemaName, tableName),
    },
    precheck: [
      {
        description: `ensure constraint "${constraintName}" exists`,
        sql: constraintExistsCheck({ constraintName, schema: schemaName }),
      },
    ],
    execute: [
      {
        description: `drop constraint "${constraintName}"`,
        sql: `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
DROP CONSTRAINT ${quoteIdentifier(constraintName)}`,
      },
    ],
    postcheck: [
      {
        description: `verify constraint "${constraintName}" is removed`,
        sql: constraintExistsCheck({ constraintName, schema: schemaName, exists: false }),
      },
    ],
  };
}

function buildDropNotNullOperation(
  schemaName: string,
  tableName: string,
  columnName: string,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  return {
    id: `alterNullability.${tableName}.${columnName}`,
    label: `Relax nullability for ${columnName} on ${tableName}`,
    summary: `Drops NOT NULL constraint for ${columnName} on table ${tableName}`,
    operationClass: 'widening',
    target: {
      id: 'postgres',
      details: buildTargetDetails('column', columnName, schemaName, tableName),
    },
    precheck: [
      {
        description: `ensure column "${columnName}" exists`,
        sql: columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      },
    ],
    execute: [
      {
        description: `drop NOT NULL from "${columnName}"`,
        sql: `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
ALTER COLUMN ${quoteIdentifier(columnName)} DROP NOT NULL`,
      },
    ],
    postcheck: [
      {
        description: `verify "${columnName}" is nullable`,
        sql: columnNullabilityCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          nullable: true,
        }),
      },
    ],
  };
}

function buildSetNotNullOperation(
  schemaName: string,
  tableName: string,
  columnName: string,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `alterNullability.${tableName}.${columnName}`,
    label: `Enforce NOT NULL for ${columnName} on ${tableName}`,
    summary: `Sets NOT NULL on ${columnName} for table ${tableName}`,
    operationClass: 'destructive',
    target: {
      id: 'postgres',
      details: buildTargetDetails('column', columnName, schemaName, tableName),
    },
    precheck: [
      {
        description: `ensure column "${columnName}" exists`,
        sql: columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      },
      {
        description: `ensure "${columnName}" has no NULL values`,
        sql: `SELECT NOT EXISTS (
  SELECT 1 FROM ${qualified}
  WHERE ${quoteIdentifier(columnName)} IS NULL
  LIMIT 1
)`,
      },
    ],
    execute: [
      {
        description: `set NOT NULL on "${columnName}"`,
        sql: `ALTER TABLE ${qualified}
ALTER COLUMN ${quoteIdentifier(columnName)} SET NOT NULL`,
      },
    ],
    postcheck: [
      {
        description: `verify "${columnName}" is NOT NULL`,
        sql: columnNullabilityCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          nullable: false,
        }),
      },
    ],
  };
}

function buildAlterColumnTypeOperation(
  schemaName: string,
  tableName: string,
  columnName: string,
  column: StorageColumn,
): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
  const qualified = qualifyTableName(schemaName, tableName);
  const expectedType = buildColumnTypeSql(column);
  return {
    id: `alterType.${tableName}.${columnName}`,
    label: `Alter type for ${columnName} on ${tableName}`,
    summary: `Changes type of ${columnName} to ${expectedType}`,
    operationClass: 'destructive',
    target: {
      id: 'postgres',
      details: buildTargetDetails('column', columnName, schemaName, tableName),
    },
    meta: {
      warning: 'TABLE_REWRITE',
      detail:
        'ALTER COLUMN TYPE requires a full table rewrite and acquires an ACCESS EXCLUSIVE lock. On large tables, this can cause significant downtime.',
    },
    precheck: [
      {
        description: `ensure column "${columnName}" exists`,
        sql: columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      },
    ],
    execute: [
      {
        description: `alter type of "${columnName}"`,
        sql: `ALTER TABLE ${qualified}
ALTER COLUMN ${quoteIdentifier(columnName)}
TYPE ${expectedType}
USING ${quoteIdentifier(columnName)}::${expectedType}`,
      },
    ],
    postcheck: [
      {
        description: `verify column "${columnName}" exists after type change`,
        sql: columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      },
    ],
  };
}

// ============================================================================
// Conflict Conversion
// ============================================================================

function convertIssueToConflict(issue: SchemaIssue): SqlPlannerConflict | null {
  switch (issue.kind) {
    case 'type_mismatch':
      return buildConflict('typeMismatch', issue);
    case 'nullability_mismatch':
      return buildConflict('nullabilityConflict', issue);
    case 'default_missing':
    case 'default_mismatch':
    case 'extra_table':
    case 'extra_column':
    case 'extra_primary_key':
    case 'extra_foreign_key':
    case 'extra_unique_constraint':
    case 'extra_index':
      return buildConflict('missingButNonAdditive', issue);
    case 'primary_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
      return buildConflict('indexIncompatible', issue);
    case 'foreign_key_mismatch':
      return buildConflict('foreignKeyConflict', issue);
    // Additive issue kinds (missing_table, missing_column, type_missing, type_values_mismatch,
    // dependency_missing) are filtered by isAdditiveIssue before reaching this method.
    // If a new SchemaIssue kind is introduced, add a mapping here so it becomes a conflict
    // rather than being silently ignored.
    default:
      return null;
  }
}

function buildConflict(kind: SqlPlannerConflict['kind'], issue: SchemaIssue): SqlPlannerConflict {
  const location = buildConflictLocation(issue);
  const meta =
    issue.expected || issue.actual
      ? Object.freeze({
          ...ifDefined('expected', issue.expected),
          ...ifDefined('actual', issue.actual),
        })
      : undefined;

  return {
    kind,
    summary: issue.message,
    ...ifDefined('location', location),
    ...ifDefined('meta', meta),
  };
}

// ============================================================================
// Sorting and Comparison Helpers
// ============================================================================

function sortSchemaIssues(issues: readonly SchemaIssue[]): readonly SchemaIssue[] {
  return [...issues].sort((a, b) => {
    const kindCompare = a.kind.localeCompare(b.kind);
    if (kindCompare !== 0) {
      return kindCompare;
    }
    const tableCompare = compareStrings(a.table, b.table);
    if (tableCompare !== 0) {
      return tableCompare;
    }
    const columnCompare = compareStrings(a.column, b.column);
    if (columnCompare !== 0) {
      return columnCompare;
    }
    return compareStrings(a.indexOrConstraint, b.indexOrConstraint);
  });
}

function buildConflictLocation(issue: SchemaIssue) {
  const location = {
    ...ifDefined('table', issue.table),
    ...ifDefined('column', issue.column),
    ...ifDefined('constraint', issue.indexOrConstraint),
  };
  return Object.keys(location).length > 0 ? location : undefined;
}

function conflictComparator(a: SqlPlannerConflict, b: SqlPlannerConflict): number {
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  const aLocation = a.location ?? {};
  const bLocation = b.location ?? {};
  const tableCompare = compareStrings(aLocation.table, bLocation.table);
  if (tableCompare !== 0) {
    return tableCompare;
  }
  const columnCompare = compareStrings(aLocation.column, bLocation.column);
  if (columnCompare !== 0) {
    return columnCompare;
  }
  const constraintCompare = compareStrings(aLocation.constraint, bLocation.constraint);
  if (constraintCompare !== 0) {
    return constraintCompare;
  }
  return compareStrings(a.summary, b.summary);
}

function compareStrings(a?: string, b?: string): number {
  if (a === b) {
    return 0;
  }
  if (a === undefined) {
    return -1;
  }
  if (b === undefined) {
    return 1;
  }
  return a < b ? -1 : 1;
}
