/**
 * Resolves thin operation descriptors into SqlMigrationPlanOperation objects
 * by looking up contract types and calling existing planner SQL helpers.
 *
 * This is the bridge between the ergonomic builder API (descriptors) and
 * the planner's SQL generation pipeline. It runs at verification time.
 */

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  ComponentDatabaseDependency,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type {
  DataTransformOperation,
  SerializedQueryPlan,
} from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { lowerSqlPlan } from '@prisma-next/sql-runtime';
import { ifDefined } from '@prisma-next/utils/defined';
import type {
  AddColumnDescriptor,
  AddEnumValuesDescriptor,
  AddForeignKeyDescriptor,
  AddPrimaryKeyDescriptor,
  AddUniqueDescriptor,
  AlterColumnTypeDescriptor,
  CreateDependencyDescriptor,
  CreateEnumTypeDescriptor,
  CreateIndexDescriptor,
  CreateTableDescriptor,
  DataTransformDescriptor,
  DropColumnDescriptor,
  DropConstraintDescriptor,
  DropDefaultDescriptor,
  DropEnumTypeDescriptor,
  DropIndexDescriptor,
  DropNotNullDescriptor,
  DropTableDescriptor,
  PostgresMigrationOpDescriptor,
  RenameTypeDescriptor,
  SetDefaultDescriptor,
  SetNotNullDescriptor,
} from './operation-descriptors';
import {
  buildAddColumnSql,
  buildColumnDefaultSql,
  buildCreateTableSql,
  buildForeignKeySql,
} from './planner-ddl-builders';
import {
  buildExpectedFormatType,
  columnExistsCheck,
  columnNullabilityCheck,
  columnTypeCheck,
  constraintExistsCheck,
  qualifyTableName,
  toRegclassLiteral,
} from './planner-sql-checks';
import type { OperationClass, PostgresPlanTargetDetails } from './planner-target-details';

export interface OperationResolverContext {
  readonly toContract: Contract<SqlStorage>;
  readonly schemaName: string;
  readonly codecHooks: Map<string, CodecControlHooks>;
  readonly dependencies?: readonly ComponentDatabaseDependency<unknown>[];
  readonly db?: unknown;
}

type ResolvedOp = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

function getTable(contract: Contract<SqlStorage>, tableName: string): StorageTable | undefined {
  return contract.storage.tables[tableName];
}

function getColumn(
  contract: Contract<SqlStorage>,
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
  const contractColumn = getColumn(ctx.toContract, desc.table, desc.column);
  if (!contractColumn)
    throw new Error(`Column "${desc.table}"."${desc.column}" not found in destination contract`);
  // Apply overrides — e.g., nullable: true for the add-nullable → backfill → setNotNull pattern
  const column: StorageColumn = {
    ...contractColumn,
    nullable:
      desc.overrides?.nullable !== undefined ? desc.overrides.nullable : contractColumn.nullable,
  };
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
  const qualifiedTargetType = desc.toType
    ? qualifyName(ctx.schemaName, desc.toType)
    : buildExpectedFormatType(column, ctx.codecHooks);
  // format_type() returns unqualified names for types in search_path
  const formatTypeExpected = desc.toType ?? buildExpectedFormatType(column, ctx.codecHooks);
  return {
    id: `alterType.${desc.table}.${desc.column}`,
    label: `Alter type of "${desc.table}"."${desc.column}" to ${desc.toType ?? column.nativeType}`,
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
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteId(desc.column)} TYPE ${qualifiedTargetType}${desc.using ? ` USING ${desc.using}` : ` USING ${quoteId(desc.column)}::${qualifiedTargetType}`}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${desc.column}" has type "${formatTypeExpected}"`,
        columnTypeCheck({
          schema: ctx.schemaName,
          table: desc.table,
          column: desc.column,
          expectedType: formatTypeExpected,
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
  const column = getColumn(ctx.toContract, desc.table, desc.column);
  if (!column)
    throw new Error(`Column "${desc.table}"."${desc.column}" not found in destination contract`);
  const defaultSql = buildColumnDefaultSql(column.default, column);
  if (!defaultSql)
    throw new Error(
      `Column "${desc.table}"."${desc.column}" has no default in destination contract`,
    );
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
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteId(desc.column)} ${defaultSql}`,
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
  const table = getTable(ctx.toContract, desc.table);
  if (!table?.primaryKey)
    throw new Error(`Table "${desc.table}" has no primary key in destination contract`);
  const constraintName = table.primaryKey.name ?? `${desc.table}_pkey`;
  const qualified = qualifyTableName(ctx.schemaName, desc.table);
  const columnList = table.primaryKey.columns.map(quoteId).join(', ');
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
  const table = getTable(ctx.toContract, desc.table);
  const unique = table?.uniques?.find((u) => u.columns.join(',') === desc.columns.join(','));
  const constraintName = unique?.name ?? `${desc.table}_${desc.columns.join('_')}_key`;
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
  const table = getTable(ctx.toContract, desc.table);
  const fk = table?.foreignKeys?.find((f) => f.columns.join(',') === desc.columns.join(','));

  if (!fk) {
    throw new Error(
      `Foreign key on "${desc.table}" (${desc.columns.join(', ')}) not found in destination contract. ` +
        'Ensure the FK is declared in the contract before authoring a migration that adds it.',
    );
  }

  const fkName = fk.name ?? `${desc.table}_${desc.columns.join('_')}_fkey`;

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
  const table = getTable(ctx.toContract, desc.table);
  const index = table?.indexes?.find((i) => i.columns.join(',') === desc.columns.join(','));
  const indexName = index?.name ?? `${desc.table}_${desc.columns.join('_')}_idx`;
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

function resolveCreateEnumType(
  desc: CreateEnumTypeDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  // When explicit values are provided (e.g., temp type in rebuild recipe), use them directly.
  // The typeName may be a temp name not in the contract.
  const nativeType = desc.typeName;
  let values: readonly string[];
  if (desc.values) {
    values = desc.values;
  } else {
    const typeInstance = ctx.toContract.storage.types?.[desc.typeName];
    if (!typeInstance) {
      throw new Error(`Type "${desc.typeName}" not found in destination contract storage.types`);
    }
    const typeValues = typeInstance.typeParams?.['values'];
    if (
      !Array.isArray(typeValues) ||
      !typeValues.every((v): v is string => typeof v === 'string')
    ) {
      throw new Error(`Type "${desc.typeName}" has no valid enum values in typeParams`);
    }
    values = typeValues;
  }
  const qualifiedType = qualifyName(ctx.schemaName, nativeType);
  const literalValues = values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
  return {
    id: `type.${nativeType}`,
    label: `Create enum type "${nativeType}"`,
    operationClass: 'additive',
    target: targetDetails('type', nativeType, ctx.schemaName),
    precheck: [
      step(
        `ensure type "${nativeType}" does not exist`,
        enumTypeExistsCheck(ctx.schemaName, nativeType, false),
      ),
    ],
    execute: [
      step(
        `create enum type "${nativeType}"`,
        `CREATE TYPE ${qualifiedType} AS ENUM (${literalValues})`,
      ),
    ],
    postcheck: [
      step(`verify type "${nativeType}" exists`, enumTypeExistsCheck(ctx.schemaName, nativeType)),
    ],
  };
}

function resolveAddEnumValues(
  desc: AddEnumValuesDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const typeInstance = ctx.toContract.storage.types?.[desc.typeName];
  if (!typeInstance) {
    throw new Error(`Type "${desc.typeName}" not found in destination contract storage.types`);
  }
  const qualifiedType = qualifyName(ctx.schemaName, typeInstance.nativeType);
  return {
    id: `type.${desc.typeName}.addValues`,
    label: `Add values to enum type "${desc.typeName}": ${desc.values.join(', ')}`,
    operationClass: 'additive',
    target: targetDetails('type', desc.typeName, ctx.schemaName),
    precheck: [
      step(
        `ensure type "${typeInstance.nativeType}" exists`,
        enumTypeExistsCheck(ctx.schemaName, typeInstance.nativeType),
      ),
    ],
    execute: desc.values.map((value) =>
      step(
        `add value '${value}' to enum "${typeInstance.nativeType}"`,
        `ALTER TYPE ${qualifiedType} ADD VALUE '${escapeLiteral(value)}'`,
      ),
    ),
    postcheck: [
      step(
        `verify type "${typeInstance.nativeType}" exists`,
        enumTypeExistsCheck(ctx.schemaName, typeInstance.nativeType),
      ),
    ],
  };
}

function resolveDropEnumType(
  desc: DropEnumTypeDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const qualified = qualifyName(ctx.schemaName, desc.typeName);
  return {
    id: `type.${desc.typeName}.drop`,
    label: `Drop enum type "${desc.typeName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', desc.typeName, ctx.schemaName),
    precheck: [
      step(
        `ensure type "${desc.typeName}" exists`,
        enumTypeExistsCheck(ctx.schemaName, desc.typeName),
      ),
    ],
    execute: [step(`drop enum type "${desc.typeName}"`, `DROP TYPE ${qualified}`)],
    postcheck: [
      step(
        `verify type "${desc.typeName}" removed`,
        enumTypeExistsCheck(ctx.schemaName, desc.typeName, false),
      ),
    ],
  };
}

function resolveRenameType(desc: RenameTypeDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const qualifiedFrom = qualifyName(ctx.schemaName, desc.fromName);
  return {
    id: `type.${desc.fromName}.rename`,
    label: `Rename type "${desc.fromName}" to "${desc.toName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', desc.fromName, ctx.schemaName),
    precheck: [
      step(
        `ensure type "${desc.fromName}" exists`,
        enumTypeExistsCheck(ctx.schemaName, desc.fromName),
      ),
    ],
    execute: [
      step(
        `rename type "${desc.fromName}" to "${desc.toName}"`,
        `ALTER TYPE ${qualifiedFrom} RENAME TO ${quoteId(desc.toName)}`,
      ),
    ],
    postcheck: [
      step(`verify type "${desc.toName}" exists`, enumTypeExistsCheck(ctx.schemaName, desc.toName)),
    ],
  };
}

function resolveCreateDependency(
  desc: CreateDependencyDescriptor,
  ctx: OperationResolverContext,
): readonly ResolvedOp[] {
  const dep = ctx.dependencies?.find((d) => d.id === desc.dependencyId);
  if (!dep) {
    throw new Error(
      `Dependency "${desc.dependencyId}" not found in resolver context. ` +
        'Ensure frameworkComponents are passed to resolveDescriptors.',
    );
  }
  return dep.install as readonly ResolvedOp[];
}

const postgresAdapter = createPostgresAdapter();

function lowerToSql(plan: SqlQueryPlan, contract: Contract<SqlStorage>): SerializedQueryPlan {
  const lowered = lowerSqlPlan(postgresAdapter, contract, plan);
  return { sql: lowered.sql, params: lowered.params };
}

function resolveBuildable(input: unknown, contract: Contract<SqlStorage>): SerializedQueryPlan {
  if (
    typeof input === 'object' &&
    input !== null &&
    'build' in input &&
    typeof (input as { build: unknown }).build === 'function'
  ) {
    return lowerToSql((input as { build(): unknown }).build() as SqlQueryPlan, contract);
  }
  return lowerToSql(input as SqlQueryPlan, contract);
}

/** Resolves a single QueryPlanInput to one or more lowered SQL statements. */
function resolvePlanInput(
  input: symbol | object | ((...args: never[]) => unknown),
  db: unknown,
  contract: Contract<SqlStorage>,
): readonly SerializedQueryPlan[] {
  if (typeof input === 'symbol') {
    throw new Error(
      'Data transform contains an unimplemented TODO placeholder. ' +
        'Fill in the check/run queries in migration.ts before running verify.',
    );
  }
  if (typeof input === 'function') {
    const result = input(db as never);
    if (Array.isArray(result)) {
      return result.map((item) => resolveBuildable(item, contract));
    }
    return [resolveBuildable(result, contract)];
  }
  return [resolveBuildable(input, contract)];
}

function resolveCheck(
  check: DataTransformDescriptor['check'],
  db: unknown,
  contract: Contract<SqlStorage>,
): SerializedQueryPlan | boolean | null {
  if (typeof check === 'boolean') return check;
  const resolved = resolvePlanInput(check, db, contract);
  const first = resolved[0];
  if (!first) return null;
  return first;
}

function resolveDataTransform(
  desc: DataTransformDescriptor,
  ctx: OperationResolverContext,
): DataTransformOperation {
  const { db, toContract } = ctx;
  return {
    id: `data_migration.${desc.name}`,
    label: `Data transform: ${desc.name}`,
    operationClass: 'data',
    name: desc.name,
    source: desc.source,
    check: resolveCheck(desc.check, db, toContract),
    run: desc.run.flatMap((input) => resolvePlanInput(input, db, toContract)),
  };
}

import {
  escapeLiteral,
  qualifyName,
  quoteIdentifier as quoteId,
} from '@prisma-next/adapter-postgres/control';

/**
 * Resolves an array of operation descriptors into SqlMigrationPlanOperation objects.
 * Most descriptors resolve 1:1, but createType and createDependency may expand to multiple ops.
 */
export function resolveOperations(
  descriptors: readonly PostgresMigrationOpDescriptor[],
  context: OperationResolverContext,
): readonly (ResolvedOp | DataTransformOperation)[] {
  return descriptors.flatMap((desc) => resolveOperation(desc, context));
}

function resolveOperation(
  desc: PostgresMigrationOpDescriptor,
  ctx: OperationResolverContext,
): readonly (ResolvedOp | DataTransformOperation)[] {
  switch (desc.kind) {
    case 'createTable':
      return [resolveCreateTable(desc, ctx)];
    case 'dropTable':
      return [resolveDropTable(desc, ctx)];
    case 'addColumn':
      return [resolveAddColumn(desc, ctx)];
    case 'dropColumn':
      return [resolveDropColumn(desc, ctx)];
    case 'alterColumnType':
      return [resolveAlterColumnType(desc, ctx)];
    case 'setNotNull':
      return [resolveSetNotNull(desc, ctx)];
    case 'dropNotNull':
      return [resolveDropNotNull(desc, ctx)];
    case 'setDefault':
      return [resolveSetDefault(desc, ctx)];
    case 'dropDefault':
      return [resolveDropDefault(desc, ctx)];
    case 'addPrimaryKey':
      return [resolveAddPrimaryKey(desc, ctx)];
    case 'addUnique':
      return [resolveAddUnique(desc, ctx)];
    case 'addForeignKey':
      return [resolveAddForeignKey(desc, ctx)];
    case 'dropConstraint':
      return [resolveDropConstraint(desc, ctx)];
    case 'createIndex':
      return [resolveCreateIndex(desc, ctx)];
    case 'dropIndex':
      return [resolveDropIndex(desc, ctx)];
    case 'createEnumType':
      return [resolveCreateEnumType(desc, ctx)];
    case 'addEnumValues':
      return [resolveAddEnumValues(desc, ctx)];
    case 'dropEnumType':
      return [resolveDropEnumType(desc, ctx)];
    case 'renameType':
      return [resolveRenameType(desc, ctx)];
    case 'createDependency':
      return resolveCreateDependency(desc, ctx);
    case 'dataTransform':
      return [resolveDataTransform(desc, ctx)];
  }
}
