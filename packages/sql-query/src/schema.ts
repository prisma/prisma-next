import { planInvalid } from './errors';
import type { SqlContract, SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-target';
import type {
  BinaryBuilder,
  ColumnBuilder,
  ComputeColumnJsType,
  OrderBuilder,
  ParamPlaceholder,
  TableRef,
} from './types';

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
  readonly columns: {
    readonly [K in keyof Columns]: ColumnBuilderImpl<
      K & string,
      Columns[K],
      ComputeColumnJsType<Contract, TableName, K & string, Columns[K], CodecTypes>
    >;
  };
  private readonly _name: TableName;

  constructor(
    name: TableName,
    columns: Record<string, ColumnBuilderImpl<string, StorageColumn, unknown>>,
  ) {
    // Store name in private property to prevent overwriting
    this._name = name;
    this.columns = columns as {
      readonly [K in keyof Columns]: ColumnBuilderImpl<
        K & string,
        Columns[K],
        ComputeColumnJsType<Contract, TableName, K & string, Columns[K], CodecTypes>
      >;
    };
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
  _codecTypes: CodecTypes,
): {
  readonly [K in keyof Contract['storage']['tables'][TableName]['columns']]: ColumnBuilderImpl<
    K & string,
    Contract['storage']['tables'][TableName]['columns'][K],
    ComputeColumnJsType<
      Contract,
      TableName,
      K & string,
      Contract['storage']['tables'][TableName]['columns'][K],
      CodecTypes
    >
  >;
} {
  const table = storage.tables[tableName];

  if (!table) {
    throw planInvalid(`Unknown table ${tableName}`);
  }

  const result = {} as {
    readonly [K in keyof Contract['storage']['tables'][TableName]['columns']]: ColumnBuilderImpl<
      K & string,
      Contract['storage']['tables'][TableName]['columns'][K],
      ComputeColumnJsType<
        Contract,
        TableName,
        K & string,
        Contract['storage']['tables'][TableName]['columns'][K],
        CodecTypes
      >
    >;
  };

  for (const [columnName, columnDef] of Object.entries(table.columns)) {
    if (!columnDef) continue;
    (result as Record<string, ColumnBuilderImpl<string, StorageColumn, unknown>>)[columnName] =
      new ColumnBuilderImpl<string, StorageColumn>(
        tableName,
        columnName,
        columnDef as StorageColumn,
      );
  }

  return result;
}

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
      // If it's a built-in property (name, kind, columns), return it directly
      if (prop === 'name' || prop === 'kind' || prop === 'columns') {
        return Reflect.get(target, prop);
      }
      // Otherwise, check if it's a column name and route to columns
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
> = Contract['storage'] extends { tables: infer Tables }
  ? Tables extends { readonly [K in keyof Tables]: StorageTable }
    ? {
        readonly [TableName in keyof Tables]: TableBuilderImpl<
          Contract,
          TableName & string,
          Tables[TableName] extends { columns: infer C }
            ? C extends Record<string, StorageColumn>
              ? C
              : never
            : never,
          CodecTypes
        > &
          TableRef;
      }
    : {
        readonly [TableName in keyof Contract['storage']['tables']]: TableBuilderImpl<
          Contract,
          TableName & string,
          Contract['storage']['tables'][TableName] extends { columns: infer C }
            ? C extends Record<string, StorageColumn>
              ? C
              : never
            : never,
          CodecTypes
        > &
          TableRef;
      }
  : {
      readonly [TableName in keyof Contract['storage']['tables']]: TableBuilderImpl<
        Contract,
        TableName & string,
        Contract['storage']['tables'][TableName] extends { columns: infer C }
          ? C extends Record<string, StorageColumn>
            ? C
            : never
          : never,
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
>(contract: Contract, codecTypes?: CodecTypes): SchemaHandle<Contract, CodecTypes> {
  const storage = contract.storage;

  const tables = {} as ExtractSchemaTables<Contract, CodecTypes>;

  for (const tableName in storage.tables) {
    const columns = buildColumns<Contract, typeof tableName, CodecTypes>(
      tableName,
      storage,
      contract,
      (codecTypes ?? {}) as CodecTypes,
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
    ) as TableBuilderImpl<
      Contract,
      typeof tableName & string,
      Contract['storage']['tables'][typeof tableName]['columns'],
      CodecTypes
    > &
      TableRef;
  }

  return Object.freeze({ tables });
}

export function makeT<
  Contract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(contract: Contract, codecTypes?: CodecTypes): ExtractSchemaTables<Contract, CodecTypes> {
  return schema<Contract, CodecTypes>(contract, codecTypes).tables;
}

export type { ColumnBuilderImpl as Column, TableBuilderImpl as Table };
