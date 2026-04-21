import { quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import {
  columnDefaultExistsCheck,
  columnExistsCheck,
  columnNullabilityCheck,
  columnTypeCheck,
  qualifyTableName,
} from '../planner-sql-checks';
import { type ColumnSpec, type Op, step, targetDetails } from './shared';

export function addColumn(schemaName: string, tableName: string, column: ColumnSpec): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const parts = [
    `ALTER TABLE ${qualified}`,
    `ADD COLUMN ${quoteIdentifier(column.name)} ${column.typeSql}`,
    column.defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  const addSql = parts.join(' ');

  return {
    id: `column.${tableName}.${column.name}`,
    label: `Add column "${column.name}" to "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('column', column.name, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${column.name}" is missing`,
        columnExistsCheck({
          schema: schemaName,
          table: tableName,
          column: column.name,
          exists: false,
        }),
      ),
    ],
    execute: [step(`add column "${column.name}"`, addSql)],
    postcheck: [
      step(
        `verify column "${column.name}" exists`,
        columnExistsCheck({ schema: schemaName, table: tableName, column: column.name }),
      ),
    ],
  };
}

export function dropColumn(schemaName: string, tableName: string, columnName: string): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `dropColumn.${tableName}.${columnName}`,
    label: `Drop column "${columnName}" from "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      ),
    ],
    execute: [
      step(
        `drop column "${columnName}"`,
        `ALTER TABLE ${qualified} DROP COLUMN ${quoteIdentifier(columnName)}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" does not exist`,
        columnExistsCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          exists: false,
        }),
      ),
    ],
  };
}

/**
 * `qualifiedTargetType` is the new column type as it appears in the
 * `ALTER COLUMN TYPE` clause (schema-qualified for user-defined types, raw
 * native name for built-ins). `formatTypeExpected` is the unqualified
 * `format_type` form used in the postcheck. `rawTargetTypeForLabel` is the
 * string appearing in the human-readable label (typically `toType` when
 * explicit, else the column's native type).
 */
export function alterColumnType(
  schemaName: string,
  tableName: string,
  columnName: string,
  options: {
    readonly qualifiedTargetType: string;
    readonly formatTypeExpected: string;
    readonly rawTargetTypeForLabel: string;
    readonly using?: string;
  },
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const usingClause = options.using
    ? ` USING ${options.using}`
    : ` USING ${quoteIdentifier(columnName)}::${options.qualifiedTargetType}`;
  return {
    id: `alterType.${tableName}.${columnName}`,
    label: `Alter type of "${tableName}"."${columnName}" to ${options.rawTargetTypeForLabel}`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      ),
    ],
    execute: [
      step(
        `alter type of "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} TYPE ${options.qualifiedTargetType}${usingClause}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" has type "${options.formatTypeExpected}"`,
        columnTypeCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          expectedType: options.formatTypeExpected,
        }),
      ),
    ],
    meta: { warning: 'TABLE_REWRITE' },
  };
}

export function setNotNull(schemaName: string, tableName: string, columnName: string): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `alterNullability.${tableName}.${columnName}`,
    label: `Set NOT NULL on "${tableName}"."${columnName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      ),
      step(
        `ensure no NULL values in "${columnName}"`,
        `SELECT NOT EXISTS (SELECT 1 FROM ${qualified} WHERE ${quoteIdentifier(columnName)} IS NULL)`,
      ),
    ],
    execute: [
      step(
        `set NOT NULL on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} SET NOT NULL`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" is NOT NULL`,
        columnNullabilityCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          nullable: false,
        }),
      ),
    ],
  };
}

export function dropNotNull(schemaName: string, tableName: string, columnName: string): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `alterNullability.${tableName}.${columnName}`,
    label: `Drop NOT NULL on "${tableName}"."${columnName}"`,
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      ),
    ],
    execute: [
      step(
        `drop NOT NULL on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} DROP NOT NULL`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" is nullable`,
        columnNullabilityCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          nullable: true,
        }),
      ),
    ],
  };
}

/**
 * `defaultSql` is the full `DEFAULT …` clause as produced by
 * `buildColumnDefaultSql` — e.g. `"DEFAULT 42"`,
 * `"DEFAULT (CURRENT_TIMESTAMP)"`, or `"DEFAULT nextval('seq'::regclass)"`.
 *
 * `operationClass` defaults to `'additive'` (setting a default on a column
 * that currently has none). The reconciliation planner passes `'widening'`
 * when the column already has a different default — policy enforcement
 * treats that as a widening change rather than an additive one.
 */
export function setDefault(
  schemaName: string,
  tableName: string,
  columnName: string,
  defaultSql: string,
  operationClass: 'additive' | 'widening' = 'additive',
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `setDefault.${tableName}.${columnName}`,
    label: `Set default on "${tableName}"."${columnName}"`,
    operationClass,
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      ),
    ],
    execute: [
      step(
        `set default on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} SET ${defaultSql}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" has a default`,
        columnDefaultExistsCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          exists: true,
        }),
      ),
    ],
  };
}

export function dropDefault(schemaName: string, tableName: string, columnName: string): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `dropDefault.${tableName}.${columnName}`,
    label: `Drop default on "${tableName}"."${columnName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        columnExistsCheck({ schema: schemaName, table: tableName, column: columnName }),
      ),
    ],
    execute: [
      step(
        `drop default on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} DROP DEFAULT`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" has no default`,
        columnDefaultExistsCheck({
          schema: schemaName,
          table: tableName,
          column: columnName,
          exists: false,
        }),
      ),
    ],
  };
}
