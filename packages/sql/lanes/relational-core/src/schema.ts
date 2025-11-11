// TODO: Slice 6 will clean up RuntimeContext dependency

import type { OperationRegistry } from '@prisma-next/operations';
import { planInvalid } from '@prisma-next/plan';
import type {
  ExtractCodecTypes,
  ExtractOperationTypes,
  SqlContract,
  SqlStorage,
  StorageColumn,
} from '@prisma-next/sql-contract/types';
import type { RuntimeContext } from '@prisma-next/sql-runtime';
import type { TableRef } from './ast/types';
import { attachOperationsToColumnBuilder } from './operations-registry';
import type {
  BinaryBuilder,
  CodecTypes as CodecTypesType,
  ColumnBuilder,
  ComputeColumnJsType,
  OperationTypes,
  OrderBuilder,
  ParamPlaceholder,
} from './types';

type TableColumns<Table extends { columns: Record<string, StorageColumn> }> = Table['columns'];

type ColumnBuilders<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
> = {
  readonly [K in keyof Columns]: ColumnBuilder<
    K & string,
    Columns[K],
    ComputeColumnJsType<Contract, TableName, K & string, Columns[K], CodecTypes>,
    Operations
  >;
};

export class ColumnBuilderImpl<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType = unknown,
> {
  readonly kind = 'column' as const;

  constructor(
    readonly table: string,
    readonly column: ColumnName,
    private readonly storageColumn: ColumnMeta,
  ) {}

  get columnMeta(): ColumnMeta {
    return this.storageColumn;
  }

  // Type-level helper property (not used at runtime)
  get __jsType(): JsType {
    return undefined as unknown as JsType;
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
      left: this as unknown as ColumnBuilder<ColumnName, ColumnMeta, JsType>,
      right: value,
    }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
  }

  asc(
    this: ColumnBuilderImpl<ColumnName, ColumnMeta, JsType>,
  ): OrderBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this as unknown as ColumnBuilder<ColumnName, ColumnMeta, JsType>,
      dir: 'asc' as const,
    }) as OrderBuilder<ColumnName, ColumnMeta, JsType>;
  }

  desc(
    this: ColumnBuilderImpl<ColumnName, ColumnMeta, JsType>,
  ): OrderBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this as unknown as ColumnBuilder<ColumnName, ColumnMeta, JsType>,
      dir: 'desc' as const,
    }) as OrderBuilder<ColumnName, ColumnMeta, JsType>;
  }
}

export class TableBuilderImpl<
  Contract extends SqlContract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
> implements TableRef
{
  readonly kind = 'table' as const;
  readonly columns: ColumnBuilders<Contract, TableName, Columns, CodecTypes, Operations>;
  private readonly _name: TableName;

  constructor(
    name: TableName,
    columns: ColumnBuilders<Contract, TableName, Columns, CodecTypes, Operations>,
  ) {
    this._name = name;
    this.columns = columns;
  }

  get name(): string {
    return this._name;
  }
}

function buildColumns<
  Contract extends SqlContract<SqlStorage>,
  TableName extends keyof Contract['storage']['tables'] & string,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
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
  CodecTypes,
  Operations
> {
  const table = storage.tables[tableName];

  if (!table) {
    throw planInvalid(`Unknown table ${tableName}`);
  }

  type Columns = Contract['storage']['tables'][TableName]['columns'];
  const tableColumns = table.columns as Columns;

  const result = {} as {
    [K in keyof Columns]: ColumnBuilder<
      K & string,
      Columns[K],
      ComputeColumnJsType<Contract, TableName, K & string, Columns[K], CodecTypes>,
      Operations
    >;
  };

  const assignColumn = <ColumnKey extends keyof Columns & string>(
    columnName: ColumnKey,
    columnDef: Columns[ColumnKey],
  ) => {
    type JsType = ComputeColumnJsType<
      Contract,
      TableName,
      ColumnKey,
      Columns[ColumnKey],
      CodecTypes
    >;

    const columnBuilder = new ColumnBuilderImpl<ColumnKey, Columns[ColumnKey], JsType>(
      tableName,
      columnName,
      columnDef,
    );

    const builderWithOps = attachOperationsToColumnBuilder<
      ColumnKey,
      Columns[ColumnKey],
      JsType,
      Operations
    >(
      columnBuilder as unknown as ColumnBuilder<
        ColumnKey,
        Columns[ColumnKey],
        JsType,
        Record<string, never>
      >,
      columnDef,
      operationRegistry,
      contractCapabilities,
    );

    (result as Record<string, unknown>)[columnName] = builderWithOps;
  };

  for (const columnName of Object.keys(tableColumns) as Array<keyof Columns & string>) {
    const columnDef = tableColumns[columnName];
    if (!columnDef) continue;
    assignColumn(columnName, columnDef);
  }

  return result as ColumnBuilders<Contract, TableName, Columns, CodecTypes, Operations>;
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
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
>(
  table: TableBuilderImpl<Contract, TableName, Columns, CodecTypes, Operations>,
): TableBuilderImpl<Contract, TableName, Columns, CodecTypes, Operations> {
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
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
> = {
  readonly [TableName in keyof Contract['storage']['tables']]: TableBuilderImpl<
    Contract,
    TableName & string,
    TableColumns<Contract['storage']['tables'][TableName]>,
    CodecTypes,
    Operations
  > &
    TableRef;
};

export type SchemaHandle<
  Contract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends CodecTypesType = CodecTypesType,
  Operations extends OperationTypes = Record<string, never>,
> = {
  readonly tables: ExtractSchemaTables<Contract, CodecTypes, Operations>;
};

type SchemaReturnType<Contract extends SqlContract<SqlStorage>> = SchemaHandle<
  Contract,
  ExtractCodecTypes<Contract>,
  OperationTypes
>;

type ToOperationTypes<T> = T & OperationTypes;

/**
 * Creates a schema handle for building SQL queries.
 *
 * @param context - Runtime context containing contract, codec and operation registries
 * @returns A schema handle with typed table builders
 *
 * @example
 * ```typescript
 * const schemaHandle = schema<Contract>(context);
 * const userTable = schemaHandle.tables.user;
 * ```
 */
export function schema<Contract extends SqlContract<SqlStorage>>(
  context: RuntimeContext<Contract>,
): SchemaReturnType<Contract> {
  const contract = context.contract;
  const storage = contract.storage;
  type CodecTypes = ExtractCodecTypes<Contract>;
  type Operations = ToOperationTypes<ExtractOperationTypes<Contract>>;
  const tables = {} as ExtractSchemaTables<Contract, CodecTypes, Operations>;
  const contractCapabilities = contract.capabilities;

  const operationRegistry = context.operations;

  for (const tableName of Object.keys(storage.tables) as Array<
    keyof Contract['storage']['tables'] & string
  >) {
    const columns = buildColumns<Contract, typeof tableName, CodecTypes, Operations>(
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
      CodecTypes,
      Operations
    >(tableName, columns);
    const proxiedTable = createTableProxy<
      Contract,
      typeof tableName & string,
      Contract['storage']['tables'][typeof tableName]['columns'],
      CodecTypes,
      Operations
    >(table);
    (tables as Record<string, unknown>)[tableName] = Object.freeze(
      proxiedTable,
    ) as ExtractSchemaTables<Contract, CodecTypes, Operations>[typeof tableName];
  }

  return Object.freeze({ tables }) as SchemaReturnType<Contract>;
}

export type { ColumnBuilderImpl as Column, TableBuilderImpl as Table };
