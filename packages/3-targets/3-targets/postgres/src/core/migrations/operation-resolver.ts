/**
 * Resolves thin operation descriptors into SqlMigrationPlanOperation objects
 * by looking up contract types and calling existing planner SQL helpers.
 *
 * This is the bridge between the ergonomic builder API (descriptors) and
 * the planner's SQL generation pipeline. It runs at verification time.
 */

import type { SerializedQueryNode } from '@prisma-next/core-control-plane/types';
import type { CodecControlHooks, SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type {
  AddColumnDescriptor,
  AddForeignKeyDescriptor,
  AddPrimaryKeyDescriptor,
  AddUniqueDescriptor,
  AlterColumnTypeDescriptor,
  CreateIndexDescriptor,
  CreateTableDescriptor,
  CreateTypeDescriptor,
  DataTransformDescriptor,
  DropColumnDescriptor,
  DropConstraintDescriptor,
  DropDefaultDescriptor,
  DropIndexDescriptor,
  DropNotNullDescriptor,
  DropTableDescriptor,
  MigrationOpDescriptor,
  SetDefaultDescriptor,
  SetNotNullDescriptor,
} from './operation-descriptors';
import type { OperationClass, PostgresPlanTargetDetails } from './planner';
import {
  buildAddColumnSql,
  buildCreateTableSql,
  buildExpectedFormatType,
  buildForeignKeySql,
  columnExistsCheck,
  columnNullabilityCheck,
  columnTypeCheck,
  constraintExistsCheck,
  qualifyTableName,
  toRegclassLiteral,
} from './planner-sql';

export interface OperationResolverContext {
  readonly fromContract: SqlContract<SqlStorage> | null;
  readonly toContract: SqlContract<SqlStorage>;
  readonly schemaName: string;
  readonly codecHooks: Map<string, CodecControlHooks>;
}

type ResolvedOp = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

function getTable(contract: SqlContract<SqlStorage>, tableName: string): StorageTable | undefined {
  return contract.storage.tables[tableName];
}

function getColumn(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  columnName: string,
): StorageColumn | undefined {
  return getTable(contract, tableName)?.columns[columnName];
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

function step(description: string, sql: string) {
  return { description, sql };
}

function resolveCreateTable(
  desc: CreateTableDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const table = getTable(ctx.toContract, desc.table);
  if (!table) throw new Error(`Table "${desc.table}" not found in destination contract`);
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `table.${desc.table}`,
    label: `Create table "${desc.table}"`,
    summary: `Creates table "${desc.table}"`,
    operationClass: 'additive',
    target: targetDetails('table', desc.table, ctx.schemaName),
    precheck: [
      step(
        `ensure table "${desc.table}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, desc.table)}) IS NULL`,
      ),
    ],
    execute: [
      step(`create table "${desc.table}"`, buildCreateTableSql(qualified, table, ctx.codecHooks)),
    ],
    postcheck: [
      step(
        `verify table "${desc.table}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, desc.table)}) IS NOT NULL`,
      ),
    ],
  };
}

function resolveDropTable(desc: DropTableDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `dropTable.${desc.table}`,
    label: `Drop table "${desc.table}"`,
    operationClass: 'destructive',
    target: targetDetails('table', desc.table, ctx.schemaName),
    precheck: [
      step(
        `ensure table "${desc.table}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, desc.table)}) IS NOT NULL`,
      ),
    ],
    execute: [step(`drop table "${desc.table}"`, `DROP TABLE ${qualified}`)],
    postcheck: [
      step(
        `verify table "${desc.table}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, desc.table)}) IS NULL`,
      ),
    ],
  };
}

function resolveAddColumn(desc: AddColumnDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const column = getColumn(ctx.toContract, desc.table, desc.column);
  if (!column)
    throw new Error(`Column "${desc.table}"."${desc.column}" not found in destination contract`);
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `column.${desc.table}.${desc.column}`,
    label: `Add column "${desc.column}" to "${desc.table}"`,
    operationClass: 'additive',
    target: targetDetails('column', desc.column, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure column "${desc.column}" is missing`,
        columnExistsCheck({
          schema: ctx.schemaName,
          table: desc.table,
          column: desc.column,
          exists: false,
        }),
      ),
    ],
    execute: [
      step(
        `add column "${desc.column}"`,
        buildAddColumnSql(qualified, desc.column, column, ctx.codecHooks),
      ),
    ],
    postcheck: [
      step(
        `verify column "${desc.column}" exists`,
        columnExistsCheck({ schema: ctx.schemaName, table: desc.table, column: desc.column }),
      ),
    ],
  };
}

function resolveDropColumn(desc: DropColumnDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `dropColumn.${desc.table}.${desc.column}`,
    label: `Drop column "${desc.column}" from "${desc.table}"`,
    operationClass: 'destructive',
    target: targetDetails('column', desc.column, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure column "${desc.column}" exists`,
        columnExistsCheck({ schema: ctx.schemaName, table: desc.table, column: desc.column }),
      ),
    ],
    execute: [
      step(
        `drop column "${desc.column}"`,
        `ALTER TABLE ${qualified} DROP COLUMN ${quoteId(desc.column)}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${desc.column}" does not exist`,
        columnExistsCheck({
          schema: ctx.schemaName,
          table: desc.table,
          column: desc.column,
          exists: false,
        }),
      ),
    ],
  };
}

function resolveAlterColumnType(
  desc: AlterColumnTypeDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const column = getColumn(ctx.toContract, desc.table, desc.column);
  if (!column)
    throw new Error(`Column "${desc.table}"."${desc.column}" not found in destination contract`);
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  const expectedType = buildExpectedFormatType(column, ctx.codecHooks);
  return {
    id: `alterType.${desc.table}.${desc.column}`,
    label: `Alter type of "${desc.table}"."${desc.column}" to ${desc.newType}`,
    operationClass: 'destructive',
    target: targetDetails('column', desc.column, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure column "${desc.column}" exists`,
        columnExistsCheck({ schema: ctx.schemaName, table: desc.table, column: desc.column }),
      ),
    ],
    execute: [
      step(
        `alter type of "${desc.column}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteId(desc.column)} TYPE ${desc.newType} USING ${quoteId(desc.column)}::${desc.newType}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${desc.column}" has type "${expectedType}"`,
        columnTypeCheck({
          schema: ctx.schemaName,
          table: desc.table,
          column: desc.column,
          expectedType,
        }),
      ),
    ],
    meta: { warning: 'TABLE_REWRITE' },
  };
}

function resolveSetNotNull(desc: SetNotNullDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `alterNullability.${desc.table}.${desc.column}`,
    label: `Set NOT NULL on "${desc.table}"."${desc.column}"`,
    operationClass: 'destructive',
    target: targetDetails('column', desc.column, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure column "${desc.column}" exists`,
        columnExistsCheck({ schema: ctx.schemaName, table: desc.table, column: desc.column }),
      ),
      step(
        `ensure no NULL values in "${desc.column}"`,
        `SELECT NOT EXISTS (SELECT 1 FROM ${qualified} WHERE ${quoteId(desc.column)} IS NULL)`,
      ),
    ],
    execute: [
      step(
        `set NOT NULL on "${desc.column}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteId(desc.column)} SET NOT NULL`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${desc.column}" is NOT NULL`,
        columnNullabilityCheck({
          schema: ctx.schemaName,
          table: desc.table,
          column: desc.column,
          nullable: false,
        }),
      ),
    ],
  };
}

function resolveDropNotNull(
  desc: DropNotNullDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `alterNullability.${desc.table}.${desc.column}`,
    label: `Drop NOT NULL on "${desc.table}"."${desc.column}"`,
    operationClass: 'widening',
    target: targetDetails('column', desc.column, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure column "${desc.column}" exists`,
        columnExistsCheck({ schema: ctx.schemaName, table: desc.table, column: desc.column }),
      ),
    ],
    execute: [
      step(
        `drop NOT NULL on "${desc.column}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteId(desc.column)} DROP NOT NULL`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${desc.column}" is nullable`,
        columnNullabilityCheck({
          schema: ctx.schemaName,
          table: desc.table,
          column: desc.column,
          nullable: true,
        }),
      ),
    ],
  };
}

function resolveSetDefault(desc: SetDefaultDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `setDefault.${desc.table}.${desc.column}`,
    label: `Set default on "${desc.table}"."${desc.column}"`,
    operationClass: 'additive',
    target: targetDetails('column', desc.column, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure column "${desc.column}" exists`,
        columnExistsCheck({ schema: ctx.schemaName, table: desc.table, column: desc.column }),
      ),
    ],
    execute: [
      step(
        `set default on "${desc.column}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteId(desc.column)} SET DEFAULT ${desc.default}`,
      ),
    ],
    postcheck: [],
  };
}

function resolveDropDefault(
  desc: DropDefaultDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `dropDefault.${desc.table}.${desc.column}`,
    label: `Drop default on "${desc.table}"."${desc.column}"`,
    operationClass: 'destructive',
    target: targetDetails('column', desc.column, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure column "${desc.column}" exists`,
        columnExistsCheck({ schema: ctx.schemaName, table: desc.table, column: desc.column }),
      ),
    ],
    execute: [
      step(
        `drop default on "${desc.column}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteId(desc.column)} DROP DEFAULT`,
      ),
    ],
    postcheck: [],
  };
}

function resolveAddPrimaryKey(
  desc: AddPrimaryKeyDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const constraintName = desc.constraintName ?? `${desc.table}_pkey`;
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  const columnList = desc.columns.map(quoteId).join(', ');
  return {
    id: `primaryKey.${desc.table}.${constraintName}`,
    label: `Add primary key on "${desc.table}"`,
    operationClass: 'additive',
    target: targetDetails('primaryKey', constraintName, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure primary key "${constraintName}" does not exist`,
        constraintExistsCheck({
          constraintName,
          schema: ctx.schemaName,
          table: desc.table,
          exists: false,
        }),
      ),
    ],
    execute: [
      step(
        `add primary key "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteId(constraintName)} PRIMARY KEY (${columnList})`,
      ),
    ],
    postcheck: [
      step(
        `verify primary key "${constraintName}" exists`,
        constraintExistsCheck({ constraintName, schema: ctx.schemaName, table: desc.table }),
      ),
    ],
  };
}

function resolveAddUnique(desc: AddUniqueDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const constraintName = desc.constraintName ?? `${desc.table}_${desc.columns.join('_')}_key`;
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  const columnList = desc.columns.map(quoteId).join(', ');
  return {
    id: `unique.${desc.table}.${constraintName}`,
    label: `Add unique constraint on "${desc.table}" (${desc.columns.join(', ')})`,
    operationClass: 'additive',
    target: targetDetails('unique', constraintName, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure constraint "${constraintName}" does not exist`,
        constraintExistsCheck({
          constraintName,
          schema: ctx.schemaName,
          table: desc.table,
          exists: false,
        }),
      ),
    ],
    execute: [
      step(
        `add unique constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteId(constraintName)} UNIQUE (${columnList})`,
      ),
    ],
    postcheck: [
      step(
        `verify constraint "${constraintName}" exists`,
        constraintExistsCheck({ constraintName, schema: ctx.schemaName, table: desc.table }),
      ),
    ],
  };
}

function resolveAddForeignKey(
  desc: AddForeignKeyDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const fkName = desc.constraintName ?? `${desc.table}_${desc.columns.join('_')}_fkey`;
  const table = getTable(ctx.toContract, desc.table);
  const fk = table?.foreignKeys?.find(
    (f) =>
      f.name === fkName ||
      (f.columns.join(',') === desc.columns.join(',') &&
        f.references.table === desc.references.table),
  );

  if (fk) {
    return {
      id: `foreignKey.${desc.table}.${fkName}`,
      label: `Add foreign key "${fkName}" on "${desc.table}"`,
      operationClass: 'additive',
      target: targetDetails('foreignKey', fkName, ctx.schemaName, desc.table),
      precheck: [
        step(
          `ensure FK "${fkName}" does not exist`,
          constraintExistsCheck({
            constraintName: fkName,
            schema: ctx.schemaName,
            table: desc.table,
            exists: false,
          }),
        ),
      ],
      execute: [
        step(`add FK "${fkName}"`, buildForeignKeySql(ctx.schemaName, desc.table, fkName, fk)),
      ],
      postcheck: [
        step(
          `verify FK "${fkName}" exists`,
          constraintExistsCheck({
            constraintName: fkName,
            schema: ctx.schemaName,
            table: desc.table,
          }),
        ),
      ],
    };
  }

  // Fallback: build SQL from descriptor directly (no contract FK found)
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  const refQualified = qualifyTableName(ctx.schemaName, desc.references.table);
  const columnList = desc.columns.map(quoteId).join(', ');
  const refColumnList = desc.references.columns.map(quoteId).join(', ');
  let sql = `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteId(fkName)} FOREIGN KEY (${columnList}) REFERENCES ${refQualified} (${refColumnList})`;
  if (desc.onDelete) sql += `\nON DELETE ${desc.onDelete}`;
  if (desc.onUpdate) sql += `\nON UPDATE ${desc.onUpdate}`;

  return {
    id: `foreignKey.${desc.table}.${fkName}`,
    label: `Add foreign key "${fkName}" on "${desc.table}"`,
    operationClass: 'additive',
    target: targetDetails('foreignKey', fkName, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure FK "${fkName}" does not exist`,
        constraintExistsCheck({
          constraintName: fkName,
          schema: ctx.schemaName,
          table: desc.table,
          exists: false,
        }),
      ),
    ],
    execute: [step(`add FK "${fkName}"`, sql)],
    postcheck: [
      step(
        `verify FK "${fkName}" exists`,
        constraintExistsCheck({
          constraintName: fkName,
          schema: ctx.schemaName,
          table: desc.table,
        }),
      ),
    ],
  };
}

function resolveDropConstraint(
  desc: DropConstraintDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  return {
    id: `dropConstraint.${desc.table}.${desc.constraintName}`,
    label: `Drop constraint "${desc.constraintName}" on "${desc.table}"`,
    operationClass: 'destructive',
    target: targetDetails('unique', desc.constraintName, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure constraint "${desc.constraintName}" exists`,
        constraintExistsCheck({
          constraintName: desc.constraintName,
          schema: ctx.schemaName,
          table: desc.table,
        }),
      ),
    ],
    execute: [
      step(
        `drop constraint "${desc.constraintName}"`,
        `ALTER TABLE ${qualified} DROP CONSTRAINT ${quoteId(desc.constraintName)}`,
      ),
    ],
    postcheck: [
      step(
        `verify constraint "${desc.constraintName}" does not exist`,
        constraintExistsCheck({
          constraintName: desc.constraintName,
          schema: ctx.schemaName,
          table: desc.table,
          exists: false,
        }),
      ),
    ],
  };
}

function resolveCreateIndex(
  desc: CreateIndexDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const indexName = desc.indexName ?? `${desc.table}_${desc.columns.join('_')}_idx`;
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  const columnList = desc.columns.map(quoteId).join(', ');
  return {
    id: `index.${desc.table}.${indexName}`,
    label: `Create index "${indexName}" on "${desc.table}"`,
    operationClass: 'additive',
    target: targetDetails('index', indexName, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure index "${indexName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, indexName)}) IS NULL`,
      ),
    ],
    execute: [
      step(
        `create index "${indexName}"`,
        `CREATE INDEX ${quoteId(indexName)} ON ${qualified} (${columnList})`,
      ),
    ],
    postcheck: [
      step(
        `verify index "${indexName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, indexName)}) IS NOT NULL`,
      ),
    ],
  };
}

function resolveDropIndex(desc: DropIndexDescriptor, ctx: OperationResolverContext): ResolvedOp {
  return {
    id: `dropIndex.${desc.table}.${desc.indexName}`,
    label: `Drop index "${desc.indexName}"`,
    operationClass: 'destructive',
    target: targetDetails('index', desc.indexName, ctx.schemaName, desc.table),
    precheck: [
      step(
        `ensure index "${desc.indexName}" exists`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, desc.indexName)}) IS NOT NULL`,
      ),
    ],
    execute: [
      step(
        `drop index "${desc.indexName}"`,
        `DROP INDEX ${qualifyTableName(ctx.schemaName, desc.indexName)}`,
      ),
    ],
    postcheck: [
      step(
        `verify index "${desc.indexName}" does not exist`,
        `SELECT to_regclass(${toRegclassLiteral(ctx.schemaName, desc.indexName)}) IS NULL`,
      ),
    ],
  };
}

function resolveCreateType(
  _desc: CreateTypeDescriptor,
  _ctx: OperationResolverContext,
): ResolvedOp {
  // Type creation is handled by codec hooks in the planner.
  // For manually authored migrations, this is a placeholder.
  throw new Error(
    'createType resolution not yet implemented — type operations are handled by codec hooks',
  );
}

function renderQueryNodeToSql(node: SerializedQueryNode): string {
  if (node.kind === 'raw_sql') {
    const sql = node['sql'];
    if (typeof sql !== 'string') {
      throw new Error('raw_sql node must have a string "sql" field');
    }
    return sql;
  }
  throw new Error(
    `Cannot render SerializedQueryNode of kind "${node.kind}" to SQL. Only "raw_sql" is supported for v1.`,
  );
}

function resolveDataTransform(desc: DataTransformDescriptor): ResolvedOp {
  const runNodes: readonly SerializedQueryNode[] = Array.isArray(desc.run) ? desc.run : [desc.run];

  // Build execute steps from run ASTs
  const executeSteps = runNodes.map((node, i) =>
    step(`data transform "${desc.name}" step ${i + 1}`, renderQueryNodeToSql(node)),
  );

  // Build postcheck from check AST (used for idempotency probe and post-run validation)
  // Convention: check query returns rows when violations exist (needs to run).
  // Runner postchecks expect true = satisfied. Wrap in NOT EXISTS to invert.
  const postcheckSteps: { description: string; sql: string }[] = [];
  if (typeof desc.check !== 'boolean') {
    const checkSql = renderQueryNodeToSql(desc.check);
    postcheckSteps.push(
      step(`verify data transform "${desc.name}" is complete`, `SELECT NOT EXISTS (${checkSql})`),
    );
  }

  return {
    id: `data_migration.${desc.name}`,
    label: `Data transform: ${desc.name}`,
    operationClass: 'data',
    target: targetDetails('table', desc.name, 'public'),
    precheck: [],
    execute: executeSteps,
    postcheck: postcheckSteps,
    meta: { dataTransformName: desc.name, source: desc.source },
  };
}

// Re-import quoteIdentifier under a short alias
import { quoteIdentifier as quoteId } from '@prisma-next/adapter-postgres/control';

/**
 * Resolves an array of operation descriptors into SqlMigrationPlanOperation objects.
 */
export function resolveOperations(
  descriptors: readonly MigrationOpDescriptor[],
  context: OperationResolverContext,
): readonly ResolvedOp[] {
  return descriptors.map((desc) => resolveOperation(desc, context));
}

function resolveOperation(desc: MigrationOpDescriptor, ctx: OperationResolverContext): ResolvedOp {
  switch (desc.kind) {
    case 'createTable':
      return resolveCreateTable(desc, ctx);
    case 'dropTable':
      return resolveDropTable(desc, ctx);
    case 'addColumn':
      return resolveAddColumn(desc, ctx);
    case 'dropColumn':
      return resolveDropColumn(desc, ctx);
    case 'alterColumnType':
      return resolveAlterColumnType(desc, ctx);
    case 'setNotNull':
      return resolveSetNotNull(desc, ctx);
    case 'dropNotNull':
      return resolveDropNotNull(desc, ctx);
    case 'setDefault':
      return resolveSetDefault(desc, ctx);
    case 'dropDefault':
      return resolveDropDefault(desc, ctx);
    case 'addPrimaryKey':
      return resolveAddPrimaryKey(desc, ctx);
    case 'addUnique':
      return resolveAddUnique(desc, ctx);
    case 'addForeignKey':
      return resolveAddForeignKey(desc, ctx);
    case 'dropConstraint':
      return resolveDropConstraint(desc, ctx);
    case 'createIndex':
      return resolveCreateIndex(desc, ctx);
    case 'dropIndex':
      return resolveDropIndex(desc, ctx);
    case 'createType':
      return resolveCreateType(desc, ctx);
    case 'dataTransform':
      return resolveDataTransform(desc);
  }
}
