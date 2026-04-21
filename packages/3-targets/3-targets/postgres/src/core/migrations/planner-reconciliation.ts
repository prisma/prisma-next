import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlPlannerConflict,
} from '@prisma-next/family-sql/control';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type {
  SqlStorage,
  StorageColumn,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { invariant } from '@prisma-next/utils/assertions';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  AlterColumnTypeCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  type PostgresOpFactoryCall,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';
import { buildExpectedFormatType } from './planner-sql-checks';
import type { PlanningMode } from './planner-target-details';
import { renderOps } from './render-ops';

// ============================================================================
// Public API
// ============================================================================

export function buildReconciliationPlan(options: {
  readonly contract: Contract<SqlStorage>;
  readonly issues: readonly SchemaIssue[];
  readonly schemaName: string;
  readonly mode: PlanningMode;
  readonly policy: MigrationOperationPolicy;
  readonly codecHooks: Map<string, CodecControlHooks>;
}): {
  readonly operations: readonly PostgresOpFactoryCall[];
  readonly conflicts: readonly SqlPlannerConflict[];
} {
  const calls: PostgresOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];
  const { mode } = options;
  const seenOperationIds = new Set<string>();

  for (const issue of sortSchemaIssues(options.issues)) {
    if (isAdditiveIssue(issue)) {
      continue;
    }

    const call = buildReconciliationCallFromIssue({
      issue,
      contract: options.contract,
      schemaName: options.schemaName,
      mode,
      codecHooks: options.codecHooks,
    });

    if (call) {
      // Different schema issues may produce the same runtime op id (e.g.
      // extra_unique_constraint and extra_index on the same object). Dedupe
      // by rendering each call and keying on the runtime id.
      const [op] = renderOps([call]);
      invariant(op !== undefined, `renderOps returned empty for call ${call.factory}`);
      if (!seenOperationIds.has(op.id)) {
        seenOperationIds.add(op.id);
        if (options.policy.allowedOperationClasses.includes(call.operationClass)) {
          calls.push(call);
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
    operations: calls,
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
    case 'enum_values_changed':
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
// Call Builders
// ============================================================================

function buildReconciliationCallFromIssue(options: {
  readonly issue: SchemaIssue;
  readonly contract: Contract<SqlStorage>;
  readonly schemaName: string;
  readonly mode: PlanningMode;
  readonly codecHooks: Map<string, CodecControlHooks>;
}): PostgresOpFactoryCall | null {
  const { issue, contract, schemaName, mode, codecHooks } = options;
  const storageTypes = contract.storage.types ?? {};
  switch (issue.kind) {
    case 'extra_table':
      if (!mode.allowDestructive || !issue.table) {
        return null;
      }
      return new DropTableCall(schemaName, issue.table);

    case 'extra_column':
      if (!mode.allowDestructive || !issue.table || !issue.column) {
        return null;
      }
      return new DropColumnCall(schemaName, issue.table, issue.column);

    case 'extra_index':
      if (!mode.allowDestructive || !issue.table || !issue.indexOrConstraint) {
        return null;
      }
      return new DropIndexCall(schemaName, issue.table, issue.indexOrConstraint);

    case 'extra_foreign_key':
    case 'extra_unique_constraint': {
      if (!mode.allowDestructive || !issue.table || !issue.indexOrConstraint) {
        return null;
      }
      const kind = issue.kind === 'extra_foreign_key' ? 'foreignKey' : 'unique';
      return new DropConstraintCall(schemaName, issue.table, issue.indexOrConstraint, kind);
    }

    case 'extra_primary_key': {
      if (!mode.allowDestructive || !issue.table) {
        return null;
      }
      const constraintName = issue.indexOrConstraint ?? `${issue.table}_pkey`;
      return new DropConstraintCall(schemaName, issue.table, constraintName, 'primaryKey');
    }

    case 'nullability_mismatch': {
      if (!issue.table || !issue.column) {
        return null;
      }
      if (issue.expected === 'true') {
        // Contract wants nullable, DB has NOT NULL → widening.
        return mode.allowWidening
          ? new DropNotNullCall(schemaName, issue.table, issue.column)
          : null;
      }
      // Contract wants NOT NULL, DB has nullable → destructive.
      return mode.allowDestructive
        ? new SetNotNullCall(schemaName, issue.table, issue.column)
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
      return buildAlterColumnTypeCall(
        schemaName,
        issue.table,
        issue.column,
        contractColumn,
        codecHooks,
        storageTypes,
      );
    }

    case 'default_missing': {
      if (!issue.table || !issue.column) {
        return null;
      }
      const contractColMissing = getContractColumn(contract, issue.table, issue.column);
      if (!contractColMissing) {
        return null;
      }
      // NOTE: Being in the `default_missing` case means the verifier found the contract expects a default, so it should exist here. We must still narrow.
      invariant(
        contractColMissing.default !== undefined,
        `default_missing issue for "${issue.table}"."${issue.column}" but contract column has no default`,
      );
      return buildSetDefaultCall(
        schemaName,
        issue.table,
        issue.column,
        contractColMissing,
        contractColMissing.default,
        'additive',
      );
    }

    case 'default_mismatch': {
      if (!issue.table || !issue.column) {
        return null;
      }
      if (!mode.allowWidening) {
        return null;
      }
      const contractColMismatch = getContractColumn(contract, issue.table, issue.column);
      if (!contractColMismatch) {
        return null;
      }
      // NOTE: Being in the `default_mismatch` case means the verifier found the contract expects a different default, so it should exist here. We must still narrow.
      invariant(
        contractColMismatch.default !== undefined,
        `default_mismatch issue for "${issue.table}"."${issue.column}" but contract column has no default`,
      );
      return buildSetDefaultCall(
        schemaName,
        issue.table,
        issue.column,
        contractColMismatch,
        contractColMismatch.default,
        'widening',
      );
    }

    case 'extra_default': {
      if (!issue.table || !issue.column) {
        return null;
      }
      if (!mode.allowDestructive) {
        return null;
      }
      return new DropDefaultCall(schemaName, issue.table, issue.column);
    }

    // Remaining issue kinds (primary_key_mismatch, unique_constraint_mismatch,
    // index_mismatch, foreign_key_mismatch) do not yet have reconciliation operation
    // builders. They fall through to the caller, which converts them to conflicts via
    // convertIssueToConflict. When a new SchemaIssue kind is added, add a case here if
    // the planner can emit an operation for it; otherwise it becomes a conflict.
    default:
      return null;
  }
}

function getContractColumn(
  contract: Contract<SqlStorage>,
  tableName: string,
  columnName: string,
): StorageColumn | null {
  const table = contract.storage.tables[tableName];
  if (!table) {
    return null;
  }
  return table.columns[columnName] ?? null;
}

function buildAlterColumnTypeCall(
  schemaName: string,
  tableName: string,
  columnName: string,
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance>,
): AlterColumnTypeCall {
  const qualifiedTargetType = buildColumnTypeSql(column, codecHooks, storageTypes, false);
  const formatTypeExpected = buildExpectedFormatType(column, codecHooks, storageTypes);
  return new AlterColumnTypeCall(schemaName, tableName, columnName, {
    qualifiedTargetType,
    formatTypeExpected,
    rawTargetTypeForLabel: qualifiedTargetType,
  });
}

function buildSetDefaultCall(
  schemaName: string,
  tableName: string,
  columnName: string,
  column: Omit<StorageColumn, 'default'>,
  columnDefault: NonNullable<StorageColumn['default']>,
  operationClass: 'additive' | 'widening',
): SetDefaultCall | null {
  const defaultClause = buildColumnDefaultSql(columnDefault, column);
  // autoincrement defaults are handled by SERIAL types — buildColumnDefaultSql returns ''
  // for them. Until the IR is enriched to distinguish autoincrement (TML-2107), skip.
  if (!defaultClause) return null;
  return new SetDefaultCall(schemaName, tableName, columnName, defaultClause, operationClass);
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
    case 'extra_default':
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
  const base = issue.kind !== 'enum_values_changed' ? issue : undefined;
  const meta =
    base?.expected || base?.actual
      ? Object.freeze({
          ...ifDefined('expected', base.expected),
          ...ifDefined('actual', base.actual),
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
    const aBase = a.kind !== 'enum_values_changed' ? a : undefined;
    const bBase = b.kind !== 'enum_values_changed' ? b : undefined;
    const tableCompare = compareStrings(aBase?.table, bBase?.table);
    if (tableCompare !== 0) {
      return tableCompare;
    }
    const columnCompare = compareStrings(aBase?.column, bBase?.column);
    if (columnCompare !== 0) {
      return columnCompare;
    }
    return compareStrings(aBase?.indexOrConstraint, bBase?.indexOrConstraint);
  });
}

function buildConflictLocation(issue: SchemaIssue) {
  if (issue.kind === 'enum_values_changed') {
    return { type: issue.typeName };
  }
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
