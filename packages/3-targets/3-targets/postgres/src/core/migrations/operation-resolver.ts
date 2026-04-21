/**
 * Resolves thin operation descriptors into SqlMigrationPlanOperation objects
 * by looking up contract types and delegating to the pure factories in
 * `op-factories.ts`.
 *
 * Each `resolveX(descriptor, context)` is a thin wrapper that performs the
 * context-dependent materialization (contract lookup, codec expansion, schema
 * qualification, default rendering) and then calls the corresponding pure
 * `createX` factory. This is the descriptor-flow bridge; the class-flow
 * walk-schema and reconciliation paths call the pure factories directly.
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
import {
  type ColumnSpec,
  addColumn as createAddColumn,
  addEnumValues as createAddEnumValues,
  addForeignKey as createAddForeignKey,
  addPrimaryKey as createAddPrimaryKey,
  addUnique as createAddUnique,
  alterColumnType as createAlterColumnType,
  createEnumType as createCreateEnumType,
  createIndex as createCreateIndex,
  createTable as createCreateTable,
  createDataTransform,
  dropColumn as createDropColumn,
  dropConstraint as createDropConstraint,
  dropDefault as createDropDefault,
  dropEnumType as createDropEnumType,
  dropIndex as createDropIndex,
  dropNotNull as createDropNotNull,
  dropTable as createDropTable,
  renameType as createRenameType,
  setDefault as createSetDefault,
  setNotNull as createSetNotNull,
  type ForeignKeySpec,
} from './op-factories';
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
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';
import { buildExpectedFormatType } from './planner-sql-checks';
import type { PostgresPlanTargetDetails } from './planner-target-details';

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

function toColumnSpec(
  name: string,
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
): ColumnSpec {
  return {
    name,
    typeSql: buildColumnTypeSql(column, codecHooks),
    defaultSql: buildColumnDefaultSql(column.default, column),
    nullable: column.nullable,
  };
}

function resolveCreateTable(
  desc: CreateTableDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const table = getTable(ctx.toContract, desc.table);
  if (!table) throw new Error(`Table "${desc.table}" not found in destination contract`);
  const columns: ColumnSpec[] = Object.entries(table.columns).map(([name, column]) =>
    toColumnSpec(name, column, ctx.codecHooks),
  );
  const primaryKey = table.primaryKey ? { columns: table.primaryKey.columns } : undefined;
  return createCreateTable(ctx.schemaName, desc.table, columns, primaryKey);
}

function resolveDropTable(desc: DropTableDescriptor, ctx: OperationResolverContext): ResolvedOp {
  return createDropTable(ctx.schemaName, desc.table);
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
  return createAddColumn(
    ctx.schemaName,
    desc.table,
    toColumnSpec(desc.column, column, ctx.codecHooks),
  );
}

function resolveDropColumn(desc: DropColumnDescriptor, ctx: OperationResolverContext): ResolvedOp {
  return createDropColumn(ctx.schemaName, desc.table, desc.column);
}

function resolveAlterColumnType(
  desc: AlterColumnTypeDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const column = getColumn(ctx.toContract, desc.table, desc.column);
  if (!column)
    throw new Error(`Column "${desc.table}"."${desc.column}" not found in destination contract`);
  const qualifiedTargetType = desc.toType
    ? qualifyName(ctx.schemaName, desc.toType)
    : buildExpectedFormatType(column, ctx.codecHooks);
  // format_type() returns unqualified names for types in search_path
  const formatTypeExpected = desc.toType ?? buildExpectedFormatType(column, ctx.codecHooks);
  return createAlterColumnType(ctx.schemaName, desc.table, desc.column, {
    qualifiedTargetType,
    formatTypeExpected,
    rawTargetTypeForLabel: desc.toType ?? column.nativeType,
    ...(desc.using !== undefined && { using: desc.using }),
  });
}

function resolveSetNotNull(desc: SetNotNullDescriptor, ctx: OperationResolverContext): ResolvedOp {
  return createSetNotNull(ctx.schemaName, desc.table, desc.column);
}

function resolveDropNotNull(
  desc: DropNotNullDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  return createDropNotNull(ctx.schemaName, desc.table, desc.column);
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
  return createSetDefault(ctx.schemaName, desc.table, desc.column, defaultSql);
}

function resolveDropDefault(
  desc: DropDefaultDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  return createDropDefault(ctx.schemaName, desc.table, desc.column);
}

function resolveAddPrimaryKey(
  desc: AddPrimaryKeyDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const table = getTable(ctx.toContract, desc.table);
  if (!table?.primaryKey)
    throw new Error(`Table "${desc.table}" has no primary key in destination contract`);
  const constraintName = table.primaryKey.name ?? `${desc.table}_pkey`;
  return createAddPrimaryKey(ctx.schemaName, desc.table, constraintName, table.primaryKey.columns);
}

function resolveAddUnique(desc: AddUniqueDescriptor, ctx: OperationResolverContext): ResolvedOp {
  const table = getTable(ctx.toContract, desc.table);
  const unique = table?.uniques?.find((u) => u.columns.join(',') === desc.columns.join(','));
  const constraintName = unique?.name ?? `${desc.table}_${desc.columns.join('_')}_key`;
  return createAddUnique(ctx.schemaName, desc.table, constraintName, desc.columns);
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
  const spec: ForeignKeySpec = {
    name: fkName,
    columns: fk.columns,
    references: {
      table: fk.references.table,
      columns: fk.references.columns,
    },
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
  };
  return createAddForeignKey(ctx.schemaName, desc.table, spec);
}

function resolveDropConstraint(
  desc: DropConstraintDescriptor,
  _ctx: OperationResolverContext,
): ResolvedOp {
  return createDropConstraint(_ctx.schemaName, desc.table, desc.constraintName);
}

function resolveCreateIndex(
  desc: CreateIndexDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const table = getTable(ctx.toContract, desc.table);
  const index = table?.indexes?.find((i) => i.columns.join(',') === desc.columns.join(','));
  const indexName = index?.name ?? `${desc.table}_${desc.columns.join('_')}_idx`;
  return createCreateIndex(ctx.schemaName, desc.table, indexName, desc.columns);
}

function resolveDropIndex(desc: DropIndexDescriptor, ctx: OperationResolverContext): ResolvedOp {
  return createDropIndex(ctx.schemaName, desc.table, desc.indexName);
}

function resolveCreateEnumType(
  desc: CreateEnumTypeDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  // When explicit values are provided (e.g., temp type in rebuild recipe), use them directly.
  // The typeName may be a temp name not in the contract.
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
  return createCreateEnumType(ctx.schemaName, desc.typeName, values);
}

function resolveAddEnumValues(
  desc: AddEnumValuesDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  const typeInstance = ctx.toContract.storage.types?.[desc.typeName];
  if (!typeInstance) {
    throw new Error(`Type "${desc.typeName}" not found in destination contract storage.types`);
  }
  return createAddEnumValues(ctx.schemaName, desc.typeName, typeInstance.nativeType, desc.values);
}

function resolveDropEnumType(
  desc: DropEnumTypeDescriptor,
  ctx: OperationResolverContext,
): ResolvedOp {
  return createDropEnumType(ctx.schemaName, desc.typeName);
}

function resolveRenameType(desc: RenameTypeDescriptor, ctx: OperationResolverContext): ResolvedOp {
  return createRenameType(ctx.schemaName, desc.fromName, desc.toName);
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
  return createDataTransform({
    name: desc.name,
    source: desc.source,
    check: resolveCheck(desc.check, db, toContract),
    run: desc.run.flatMap((input) => resolvePlanInput(input, db, toContract)),
  });
}

import { qualifyName } from '@prisma-next/adapter-postgres/control';

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
