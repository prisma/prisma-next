import { quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import { constraintExistsCheck, qualifyTableName } from '../planner-sql-checks';
import { type ForeignKeySpec, type Op, step, targetDetails } from './shared';

const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL',
  setDefault: 'SET DEFAULT',
};

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
