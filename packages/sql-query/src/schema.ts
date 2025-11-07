import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-target';
import type { RuntimeContext } from '@prisma-next/runtime';
import { planInvalid } from './errors';
import type {
  BinaryBuilder,
  ColumnBuilder,
  ComputeColumnJsType,
  OrderBuilder,
  ParamPlaceholder,
  TableRef,
} from './types';
import type { OperationRegistry } from '@prisma-next/sql-target';
import { attachOperationsToColumnBuilder } from './operations-registry';

type TableColumns<Table extends { columns: Record<string, StorageColumn> }> = Table['columns'];

type ColumnBuilders<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends Record<string, { output: unknown }>,
> = {
  readonly [K in keyof Columns]: ColumnBuilderImpl<
    K & string,
    Columns[K],
    ComputeColumnJsType<Contract, TableName, K & string, Columns[K], CodecTypes>
  >;
};

class ColumnBuilderImpl<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType = unknown,
> implements ColumnBuilder<ColumnName, ColumnMeta, JsType>
{
  readonly kind = 'column' as const;

  constructor(
    readonly table: string,
    readonly column: ColumnName,
    private readonly storageColumn: ColumnMeta,
  ) {}

  get columnMeta(): ColumnMeta {
    return this.storageColumn;
  }

  eq(
    this: ColumnBuilderImpl<ColumnName, ColumnMeta, JsType>,
    value: ParamPlaceholder,
  ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    if (value.kind !== 'param-placeholder') {
      throw planInvalid('Parameter placeholder required for column comparison');
    }

    return Object.freeze({
      kind: 'binary' as const,
      op: 'eq' as const,
      left: this,
      right: value,
    });
  }

  asc(
    this: ColumnBuilderImpl<ColumnName, ColumnMeta, JsType>,
  ): OrderBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this,
      dir: 'asc' as const,
    });
  }

  desc(
    this: ColumnBuilderImpl<ColumnName, ColumnMeta, JsType>,
  ): OrderBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this,
      dir: 'desc' as const,
    });
  }
}

class TableBuilderImpl<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> implements TableRef
{
  readonly kind = 'table' as const;
  readonly columns: ColumnBuilders<Contract, TableName, Columns, CodecTypes>;
  private readonly _name: TableName;

  constructor(
    name: TableName,
    columns: Record<string, ColumnBuilderImpl<string, StorageColumn, unknown>>,
  ) {
    this._name = name;
    this.columns = columns as ColumnBuilders<Contract, TableName, Columns, CodecTypes>;
  }

  get name(): string {
    return this._name;
  }
}

function buildColumns<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(
  tableName: TableName,
  storage: SqlStorage,
  _contract: Contract,
  operationRegistry?: OperationRegistry,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): ColumnBuilders<
  Contract,
  TableName,
  Contract['storage']['tables'][TableName]['columns'],
  CodecTypes
> {
  const table = storage.tables[tableName];

  if (!table) {
    throw planInvalid(`Unknown table ${tableName}`);
  }

  const result = {} as ColumnBuilders<
    Contract,
    TableName,
    Contract['storage']['tables'][TableName]['columns'],
    CodecTypes
  >;

  for (const [columnName, columnDef] of Object.entries(table.columns)) {
    if (!columnDef) continue;
    const columnBuilder = new ColumnBuilderImpl<string, StorageColumn>(
      tableName,
      columnName,
      columnDef as StorageColumn,
    );
    const builderWithOps = attachOperationsToColumnBuilder(
      columnBuilder,
      columnDef as StorageColumn,
      operationRegistry,
      contractCapabilities,
    );
    (result as Record<string, ColumnBuilderImpl<string, StorageColumn, unknown>>)[columnName] =
      builderWithOps as ColumnBuilderImpl<string, StorageColumn, unknown>;
  }

  return result;
}

/**
 * Creates a Proxy that enables accessing table columns directly on the table object,
 * in addition to the standard `table.columns.columnName` syntax.
 *
 * This allows both access patterns:
 * - `tables.user.columns.id` (standard access)
 * - `tables.user.id` (convenience access via proxy)
 *
 * The proxy intercepts property access and routes column name lookups to
 * `table.columns[prop]`, while preserving direct access to table properties
 * like `name`, `kind`, and `columns`.
 */
function createTableProxy<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(
  table: TableBuilderImpl<Contract, TableName, Columns, CodecTypes>,
): TableBuilderImpl<Contract, TableName, Columns, CodecTypes> {
  return new Proxy(table, {
    get(target, prop) {
      if (prop === 'name' || prop === 'kind' || prop === 'columns') {
        return Reflect.get(target, prop);
      }
      if (typeof prop === 'string' && prop in target.columns) {
        return target.columns[prop as keyof typeof target.columns];
      }
      return undefined;
    },
  });
}

type ExtractSchemaTables<
  Contract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = {
  readonly [TableName in keyof Contract['storage']['tables']]: TableBuilderImpl<
    Contract,
    TableName & string,
    TableColumns<Contract['storage']['tables'][TableName]>,
    CodecTypes
  > &
    TableRef;
};

export type SchemaHandle<
  Contract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = {
  readonly tables: ExtractSchemaTables<Contract, CodecTypes>;
};

export function schema<
  Contract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(contract: Contract, context?: RuntimeContext): SchemaHandle<Contract, CodecTypes> {
  const storage = contract.storage;
  const tables = {} as ExtractSchemaTables<Contract, CodecTypes>;
  const contractCapabilities = contract.capabilities;

  const operationRegistry = context?.operations;

  for (const tableName in storage.tables) {
    const columns = buildColumns<Contract, typeof tableName, CodecTypes>(
      tableName,
      storage,
      contract,
      operationRegistry,
      contractCapabilities,
    );
    const table = new TableBuilderImpl<
      Contract,
      typeof tableName & string,
      Contract['storage']['tables'][typeof tableName]['columns'],
      CodecTypes
    >(tableName, columns);
    const proxiedTable = createTableProxy<
      Contract,
      typeof tableName & string,
      Contract['storage']['tables'][typeof tableName]['columns'],
      CodecTypes
    >(table);
    (tables as Record<string, unknown>)[tableName] = Object.freeze(
      proxiedTable,
    ) as ExtractSchemaTables<Contract, CodecTypes>[typeof tableName];
  }

  return Object.freeze({ tables });
}

export function makeT<
  Contract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(contract: Contract, context?: RuntimeContext): ExtractSchemaTables<Contract, CodecTypes> {
  return schema<Contract, CodecTypes>(contract, context).tables;
}

export type { ColumnBuilderImpl as Column, TableBuilderImpl as Table };
