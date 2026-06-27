import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { REFERENTIAL_ACTION_SQL } from '@prisma-next/sql-contract/referential-action-sql';
import { constraintExistsAst } from '../../../contract-free/checks';
import type { PostgresEntityRef } from '../../entity-ref';
import { postgresCreateNamespace } from '../../postgres-schema';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { type ForeignKeySpec, type Op, step, targetDetails } from './shared';

async function constraintCheckSteps(
  lowerer: ExecuteRequestLowerer,
  options: { constraintName: string; schema: string; table: string },
): Promise<{
  absent: { sql: string; params?: readonly unknown[] };
  present: { sql: string; params?: readonly unknown[] };
}> {
  const checks = constraintExistsAst(options);
  const absent = await lowerer.lowerToExecuteRequest(checks.constraintAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.constraintPresent());
  return { absent, present };
}

function renderForeignKeySql(ref: PostgresEntityRef, fk: ForeignKeySpec): string {
  const referencesQualified = postgresCreateNamespace({
    id: fk.references.schema,
    entries: { table: {} },
  }).qualifyTable(fk.references.table);
  let sql = `ALTER TABLE ${ref.namespace.qualifyTable(ref.id)}
ADD CONSTRAINT ${quoteIdentifier(fk.name)}
FOREIGN KEY (${fk.columns.map(quoteIdentifier).join(', ')})
REFERENCES ${referencesQualified} (${fk.references.columns.map(quoteIdentifier).join(', ')})`;

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

export async function addPrimaryKey(
  ref: PostgresEntityRef,
  constraintName: string,
  columns: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const schemaName = ref.namespace.id;
  const tableName = ref.id;
  const qualified = ref.namespace.qualifyTable(ref.id);
  const columnList = columns.map(quoteIdentifier).join(', ');
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `primaryKey.${tableName}.${constraintName}`,
    label: `Add primary key on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('primaryKey', constraintName, schemaName, tableName),
    precheck: [
      step(`ensure primary key "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
    execute: [
      step(
        `add primary key "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} PRIMARY KEY (${columnList})`,
      ),
    ],
    postcheck: [step(`verify primary key "${constraintName}" exists`, present.sql, present.params)],
  };
}

export async function addUnique(
  ref: PostgresEntityRef,
  constraintName: string,
  columns: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const schemaName = ref.namespace.id;
  const tableName = ref.id;
  const qualified = ref.namespace.qualifyTable(ref.id);
  const columnList = columns.map(quoteIdentifier).join(', ');
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `unique.${tableName}.${constraintName}`,
    label: `Add unique constraint on "${tableName}" (${columns.join(', ')})`,
    operationClass: 'additive',
    target: targetDetails('unique', constraintName, schemaName, tableName),
    precheck: [
      step(`ensure constraint "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
    execute: [
      step(
        `add unique constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} UNIQUE (${columnList})`,
      ),
    ],
    postcheck: [step(`verify constraint "${constraintName}" exists`, present.sql, present.params)],
  };
}

export async function addForeignKey(
  ref: PostgresEntityRef,
  fk: ForeignKeySpec,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const schemaName = ref.namespace.id;
  const tableName = ref.id;
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName: fk.name,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `foreignKey.${tableName}.${fk.name}`,
    label: `Add foreign key "${fk.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('foreignKey', fk.name, schemaName, tableName),
    precheck: [step(`ensure FK "${fk.name}" does not exist`, absent.sql, absent.params)],
    execute: [step(`add FK "${fk.name}"`, renderForeignKeySql(ref, fk))],
    postcheck: [step(`verify FK "${fk.name}" exists`, present.sql, present.params)],
  };
}

export async function addCheckConstraint(
  ref: PostgresEntityRef,
  constraintName: string,
  column: string,
  values: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const schemaName = ref.namespace.id;
  const tableName = ref.id;
  const qualified = ref.namespace.qualifyTable(ref.id);
  const valueList = values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `checkConstraint.${tableName}.${constraintName}`,
    label: `Add check constraint "${constraintName}" on "${tableName}"."${column}"`,
    operationClass: 'additive',
    target: targetDetails('checkConstraint', constraintName, schemaName, tableName),
    precheck: [
      step(`ensure constraint "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
    execute: [
      step(
        `add check constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} CHECK (${quoteIdentifier(column)} IN (${valueList}))`,
      ),
    ],
    postcheck: [step(`verify constraint "${constraintName}" exists`, present.sql, present.params)],
  };
}

export async function dropCheckConstraint(
  ref: PostgresEntityRef,
  constraintName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const schemaName = ref.namespace.id;
  const tableName = ref.id;
  const qualified = ref.namespace.qualifyTable(ref.id);
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `dropCheckConstraint.${tableName}.${constraintName}`,
    label: `Drop check constraint "${constraintName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('checkConstraint', constraintName, schemaName, tableName),
    precheck: [step(`ensure constraint "${constraintName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `drop check constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} DROP CONSTRAINT ${quoteIdentifier(constraintName)}`,
      ),
    ],
    postcheck: [
      step(`verify constraint "${constraintName}" does not exist`, absent.sql, absent.params),
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
export async function dropConstraint(
  ref: PostgresEntityRef,
  constraintName: string,
  lowerer: ExecuteRequestLowerer,
  kind: 'foreignKey' | 'unique' | 'primaryKey' = 'unique',
): Promise<Op> {
  const schemaName = ref.namespace.id;
  const tableName = ref.id;
  const qualified = ref.namespace.qualifyTable(ref.id);
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `dropConstraint.${tableName}.${constraintName}`,
    label: `Drop constraint "${constraintName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails(kind, constraintName, schemaName, tableName),
    precheck: [step(`ensure constraint "${constraintName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `drop constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} DROP CONSTRAINT ${quoteIdentifier(constraintName)}`,
      ),
    ],
    postcheck: [
      step(`verify constraint "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
  };
}
