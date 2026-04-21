/**
 * Pure factories for Postgres migration operations.
 *
 * Each `createX` produces a single `SqlMigrationPlanOperation` (or
 * `DataTransformOperation`) from literal arguments only — no contract lookup,
 * no codec hooks, no `db` handle. All context-dependent materialization happens
 * in the thin `resolveX` wrappers in `operation-resolver.ts`.
 *
 * Purity constraint: factories never import `@prisma-next/contract` or depend
 * on `OperationResolverContext`. They are the 1:1 backing implementations for
 * the `OpFactoryCall` classes in `op-factory-call.ts`, and are also the shared
 * authoring entry points for class-flow `migration.ts` files.
 */

import { escapeLiteral, qualifyName, quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type {
  DataTransformOperation,
  SerializedQueryPlan,
} from '@prisma-next/framework-components/control';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  columnDefaultExistsCheck,
  columnExistsCheck,
  columnNullabilityCheck,
  columnTypeCheck,
  constraintExistsCheck,
  qualifyTableName,
  toRegclassLiteral,
} from './planner-sql-checks';
import type { OperationClass, PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Literal-args shape for a column definition consumed by `createTable` and
 * `addColumn`. Fully materialized: codec expansion and default rendering have
 * already happened in the wrapper.
 *
 * - `typeSql` is the column's DDL type string (e.g. `"integer"`, `"SERIAL"`,
 *   `"varchar(100)"`), already produced by `buildColumnTypeSql` in the
 *   descriptor-flow wrapper.
 * - `defaultSql` is the full `DEFAULT …` clause (e.g. `"DEFAULT 42"`) or an
 *   empty string when the column has no default, matching
 *   `buildColumnDefaultSql`'s output.
 */
export interface ColumnSpec {
  readonly name: string;
  readonly typeSql: string;
  readonly defaultSql: string;
  readonly nullable: boolean;
}

/**
 * Literal-args shape for a foreign key definition. The referenced table is
 * assumed to live in the same schema as the constrained table — this matches
 * the current descriptor-flow behavior.
 */
export interface ForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: {
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

function step(description: string, sql: string) {
  return { description, sql };
}

function targetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): { readonly id: 'postgres'; readonly details: PostgresPlanTargetDetails } {
  return {
    id: 'postgres',
    details: { schema, objectType, name, ...ifDefined('table', table) },
  };
}

const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL',
  setDefault: 'SET DEFAULT',
};

function renderColumnDefinition(column: ColumnSpec): string {
  const parts = [
    quoteIdentifier(column.name),
    column.typeSql,
    column.defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

function renderForeignKeySql(schemaName: string, tableName: string, fk: ForeignKeySpec): string {
  let sql = `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
ADD CONSTRAINT ${quoteIdentifier(fk.name)}
FOREIGN KEY (${fk.columns.map(quoteIdentifier).join(', ')})
REFERENCES ${qualifyTableName(schemaName, fk.references.table)} (${fk.references.columns
    .map(quoteIdentifier)
    .join(', ')})`;

  if (fk.onDelete !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[fk.onDelete];
    if (!action) {
      throw new Error(`Unknown referential action for onDelete: ${String(fk.onDelete)}`);
    }
    sql += `\nON DELETE ${action}`;
  }
  if (fk.onUpdate !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[fk.onUpdate];
    if (!action) {
      throw new Error(`Unknown referential action for onUpdate: ${String(fk.onUpdate)}`);
    }
    sql += `\nON UPDATE ${action}`;
  }
  return sql;
}

function enumTypeExistsCheck(schemaName: string, nativeType: string, exists = true): string {
  const clause = exists ? 'EXISTS' : 'NOT EXISTS';
  return `SELECT ${clause} (
  SELECT 1
  FROM pg_type t
  JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = '${escapeLiteral(schemaName)}'
    AND t.typname = '${escapeLiteral(nativeType)}'
)`;
}

// ============================================================================
// Table
// ============================================================================

export function createTable(
  schemaName: string,
  tableName: string,
  columns: ReadonlyArray<ColumnSpec>,
  primaryKey?: { readonly columns: readonly string[] },
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnDefs = columns.map(renderColumnDefinition);
  const constraintDefs: string[] = [];
  if (primaryKey) {
    constraintDefs.push(`PRIMARY KEY (${primaryKey.columns.map(quoteIdentifier).join(', ')})`);
  }
  const allDefs = [...columnDefs, ...constraintDefs];
  const createSql = `CREATE TABLE ${qualified} (\n  ${allDefs.join(',\n  ')}\n)`;

  return {
    id: `table.${tableName}`,
    label: `Create table "${tableName}"`,
    summary: `Creates table "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('table', tableName, schemaName),
    precheck: [
      step(
        `ensure table "${tableName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
      ),
    ],
    execute: [step(`create table "${tableName}"`, createSql)],
    postcheck: [
      step(
        `verify table "${tableName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
      ),
    ],
  };
}

export function dropTable(schemaName: string, tableName: string): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('table', tableName, schemaName),
    precheck: [
      step(
        `ensure table "${tableName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NOT NULL`,
      ),
    ],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${qualified}`)],
    postcheck: [
      step(
        `verify table "${tableName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, tableName)}) IS NULL`,
      ),
    ],
  };
}

// ============================================================================
// Column
// ============================================================================

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

// ============================================================================
// Constraints
// ============================================================================

export function addPrimaryKey(
  schemaName: string,
  tableName: string,
  constraintName: string,
  columns: readonly string[],
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnList = columns.map(quoteIdentifier).join(', ');
  return {
    id: `primaryKey.${tableName}.${constraintName}`,
    label: `Add primary key on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('primaryKey', constraintName, schemaName, tableName),
    precheck: [
      step(
        `ensure primary key "${constraintName}" does not exist`,
        constraintExistsCheck({
          constraintName,
          schema: schemaName,
          table: tableName,
          exists: false,
        }),
      ),
    ],
    execute: [
      step(
        `add primary key "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} PRIMARY KEY (${columnList})`,
      ),
    ],
    postcheck: [
      step(
        `verify primary key "${constraintName}" exists`,
        constraintExistsCheck({ constraintName, schema: schemaName, table: tableName }),
      ),
    ],
  };
}

export function addUnique(
  schemaName: string,
  tableName: string,
  constraintName: string,
  columns: readonly string[],
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnList = columns.map(quoteIdentifier).join(', ');
  return {
    id: `unique.${tableName}.${constraintName}`,
    label: `Add unique constraint on "${tableName}" (${columns.join(', ')})`,
    operationClass: 'additive',
    target: targetDetails('unique', constraintName, schemaName, tableName),
    precheck: [
      step(
        `ensure constraint "${constraintName}" does not exist`,
        constraintExistsCheck({
          constraintName,
          schema: schemaName,
          table: tableName,
          exists: false,
        }),
      ),
    ],
    execute: [
      step(
        `add unique constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} UNIQUE (${columnList})`,
      ),
    ],
    postcheck: [
      step(
        `verify constraint "${constraintName}" exists`,
        constraintExistsCheck({ constraintName, schema: schemaName, table: tableName }),
      ),
    ],
  };
}

export function addForeignKey(schemaName: string, tableName: string, fk: ForeignKeySpec): Op {
  return {
    id: `foreignKey.${tableName}.${fk.name}`,
    label: `Add foreign key "${fk.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('foreignKey', fk.name, schemaName, tableName),
    precheck: [
      step(
        `ensure FK "${fk.name}" does not exist`,
        constraintExistsCheck({
          constraintName: fk.name,
          schema: schemaName,
          table: tableName,
          exists: false,
        }),
      ),
    ],
    execute: [step(`add FK "${fk.name}"`, renderForeignKeySql(schemaName, tableName, fk))],
    postcheck: [
      step(
        `verify FK "${fk.name}" exists`,
        constraintExistsCheck({
          constraintName: fk.name,
          schema: schemaName,
          table: tableName,
        }),
      ),
    ],
  };
}

/**
 * `kind` feeds the operation's `target.details.objectType`. Descriptor-flow
 * does not carry kind information in its drop-constraint descriptor, so the
 * default is `'unique'`. The reconciliation planner passes the correct kind
 * (`'foreignKey'`, `'primaryKey'`, or `'unique'`) based on the `SchemaIssue`
 * that produced the drop.
 */
export function dropConstraint(
  schemaName: string,
  tableName: string,
  constraintName: string,
  kind: 'foreignKey' | 'unique' | 'primaryKey' = 'unique',
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  return {
    id: `dropConstraint.${tableName}.${constraintName}`,
    label: `Drop constraint "${constraintName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails(kind, constraintName, schemaName, tableName),
    precheck: [
      step(
        `ensure constraint "${constraintName}" exists`,
        constraintExistsCheck({ constraintName, schema: schemaName, table: tableName }),
      ),
    ],
    execute: [
      step(
        `drop constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} DROP CONSTRAINT ${quoteIdentifier(constraintName)}`,
      ),
    ],
    postcheck: [
      step(
        `verify constraint "${constraintName}" does not exist`,
        constraintExistsCheck({
          constraintName,
          schema: schemaName,
          table: tableName,
          exists: false,
        }),
      ),
    ],
  };
}

// ============================================================================
// Indexes
// ============================================================================

export function createIndex(
  schemaName: string,
  tableName: string,
  indexName: string,
  columns: readonly string[],
): Op {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnList = columns.map(quoteIdentifier).join(', ');
  return {
    id: `index.${tableName}.${indexName}`,
    label: `Create index "${indexName}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [
      step(
        `ensure index "${indexName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NULL`,
      ),
    ],
    execute: [
      step(
        `create index "${indexName}"`,
        `CREATE INDEX ${quoteIdentifier(indexName)} ON ${qualified} (${columnList})`,
      ),
    ],
    postcheck: [
      step(
        `verify index "${indexName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NOT NULL`,
      ),
    ],
  };
}

export function dropIndex(schemaName: string, tableName: string, indexName: string): Op {
  return {
    id: `dropIndex.${tableName}.${indexName}`,
    label: `Drop index "${indexName}"`,
    operationClass: 'destructive',
    target: targetDetails('index', indexName, schemaName, tableName),
    precheck: [
      step(
        `ensure index "${indexName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NOT NULL`,
      ),
    ],
    execute: [
      step(`drop index "${indexName}"`, `DROP INDEX ${qualifyTableName(schemaName, indexName)}`),
    ],
    postcheck: [
      step(
        `verify index "${indexName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(schemaName, indexName)}) IS NULL`,
      ),
    ],
  };
}

// ============================================================================
// Enum types
// ============================================================================

export function createEnumType(
  schemaName: string,
  typeName: string,
  values: readonly string[],
): Op {
  const qualifiedType = qualifyName(schemaName, typeName);
  const literalValues = values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
  return {
    id: `type.${typeName}`,
    label: `Create enum type "${typeName}"`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [
      step(
        `ensure type "${typeName}" does not exist`,
        enumTypeExistsCheck(schemaName, typeName, false),
      ),
    ],
    execute: [
      step(
        `create enum type "${typeName}"`,
        `CREATE TYPE ${qualifiedType} AS ENUM (${literalValues})`,
      ),
    ],
    postcheck: [
      step(`verify type "${typeName}" exists`, enumTypeExistsCheck(schemaName, typeName)),
    ],
  };
}

/**
 * `typeName` is the contract-facing type name (used for id/label).
 * `nativeType` is the Postgres type name to mutate (may differ for external types).
 */
export function addEnumValues(
  schemaName: string,
  typeName: string,
  nativeType: string,
  values: readonly string[],
): Op {
  const qualifiedType = qualifyName(schemaName, nativeType);
  return {
    id: `type.${typeName}.addValues`,
    label: `Add values to enum type "${typeName}": ${values.join(', ')}`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [
      step(`ensure type "${nativeType}" exists`, enumTypeExistsCheck(schemaName, nativeType)),
    ],
    execute: values.map((value) =>
      step(
        `add value '${value}' to enum "${nativeType}"`,
        `ALTER TYPE ${qualifiedType} ADD VALUE '${escapeLiteral(value)}'`,
      ),
    ),
    postcheck: [
      step(`verify type "${nativeType}" exists`, enumTypeExistsCheck(schemaName, nativeType)),
    ],
  };
}

export function dropEnumType(schemaName: string, typeName: string): Op {
  const qualified = qualifyName(schemaName, typeName);
  return {
    id: `type.${typeName}.drop`,
    label: `Drop enum type "${typeName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [step(`ensure type "${typeName}" exists`, enumTypeExistsCheck(schemaName, typeName))],
    execute: [step(`drop enum type "${typeName}"`, `DROP TYPE ${qualified}`)],
    postcheck: [
      step(`verify type "${typeName}" removed`, enumTypeExistsCheck(schemaName, typeName, false)),
    ],
  };
}

export function renameType(schemaName: string, fromName: string, toName: string): Op {
  const qualifiedFrom = qualifyName(schemaName, fromName);
  return {
    id: `type.${fromName}.rename`,
    label: `Rename type "${fromName}" to "${toName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', fromName, schemaName),
    precheck: [step(`ensure type "${fromName}" exists`, enumTypeExistsCheck(schemaName, fromName))],
    execute: [
      step(
        `rename type "${fromName}" to "${toName}"`,
        `ALTER TYPE ${qualifiedFrom} RENAME TO ${quoteIdentifier(toName)}`,
      ),
    ],
    postcheck: [step(`verify type "${toName}" exists`, enumTypeExistsCheck(schemaName, toName))],
  };
}

// ============================================================================
// Raw SQL
// ============================================================================

/**
 * Identity factory for an already-materialized `SqlMigrationPlanOperation`.
 *
 * The planner uses this via `liftOpToCall` to carry ops produced by SQL
 * family methods, codec control hooks, and component database dependencies
 * alongside class-flow IR without reverse-engineering them. Users writing
 * raw migrations can pass a full op shape directly — typically built by
 * composing SQL family helpers — to author a migration that bypasses the
 * structured call classes.
 */
export function rawSql(op: Op): Op {
  return op;
}

// ============================================================================
// Database dependencies (structured DDL)
// ============================================================================

export function createExtension(extensionName: string): Op {
  return {
    id: `extension.${extensionName}`,
    label: `Create extension "${extensionName}"`,
    operationClass: 'additive',
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      step(
        `Create extension "${extensionName}"`,
        `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extensionName)}`,
      ),
    ],
    postcheck: [],
  };
}

export function createSchema(schemaName: string): Op {
  return {
    id: `schema.${schemaName}`,
    label: `Create schema "${schemaName}"`,
    operationClass: 'additive',
    target: { id: 'postgres' },
    precheck: [],
    execute: [
      step(
        `Create schema "${schemaName}"`,
        `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`,
      ),
    ],
    postcheck: [],
  };
}

// ============================================================================
// Data transform (descriptor-flow)
// ============================================================================

/**
 * Creates a serialized data transform operation from pre-serialized query
 * plans. The descriptor resolver in `operation-resolver.ts` handles closure
 * invocation and `lowerSqlPlan` before calling this factory.
 */
export function createDataTransform(options: {
  readonly name: string;
  readonly source: string;
  readonly check: SerializedQueryPlan | boolean | null;
  readonly run: readonly SerializedQueryPlan[];
}): DataTransformOperation {
  return {
    id: `data_migration.${options.name}`,
    label: `Data transform: ${options.name}`,
    operationClass: 'data',
    name: options.name,
    source: options.source,
    check: options.check,
    run: [...options.run],
  };
}
