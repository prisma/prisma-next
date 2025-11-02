import { planInvalid } from './errors';
import type { ContractStorage, SqlContract, StorageColumn } from '@prisma-next/contract/types';
import type {
  BinaryBuilder,
  ColumnBuilder,
  OrderBuilder,
  ParamPlaceholder,
  TableRef,
} from './types';

class ColumnBuilderImpl<ColumnName extends string, ColumnMeta extends StorageColumn>
  implements ColumnBuilder<ColumnName, ColumnMeta>
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
    this: ColumnBuilderImpl<ColumnName, ColumnMeta>,
    value: ParamPlaceholder,
  ): BinaryBuilder<ColumnName, ColumnMeta> {
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

  asc(this: ColumnBuilderImpl<ColumnName, ColumnMeta>): OrderBuilder<ColumnName, ColumnMeta> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this,
      dir: 'asc' as const,
    });
  }

  desc(this: ColumnBuilderImpl<ColumnName, ColumnMeta>): OrderBuilder<ColumnName, ColumnMeta> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this,
      dir: 'desc' as const,
    });
  }
}

class TableBuilderImpl<TableName extends string, Columns extends Record<string, StorageColumn>>
  implements TableRef
{
  readonly kind = 'table' as const;
  readonly columns: { readonly [K in keyof Columns]: ColumnBuilderImpl<K & string, Columns[K]> };
  private readonly _name: TableName;

  constructor(name: TableName, columns: Record<string, ColumnBuilderImpl<string, StorageColumn>>) {
    // Store name in private property to prevent overwriting
    this._name = name;
    this.columns = columns as {
      readonly [K in keyof Columns]: ColumnBuilderImpl<K & string, Columns[K]>;
    };
  }

  get name(): string {
    return this._name;
  }
}

function buildColumns(tableName: string, storage: ContractStorage) {
  const table = storage.tables[tableName];

  if (!table) {
    throw planInvalid(`Unknown table ${tableName}`);
  }

  const result: Record<string, ColumnBuilderImpl<string, StorageColumn>> = {};

  for (const [columnName, columnDef] of Object.entries(table.columns)) {
    result[columnName] = new ColumnBuilderImpl<string, StorageColumn>(
      tableName,
      columnName,
      columnDef,
    );
  }

  return result;
}

function createTableProxy<TableName extends string, Columns extends Record<string, StorageColumn>>(
  table: TableBuilderImpl<TableName, Columns>,
): TableBuilderImpl<TableName, Columns> {
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

type ExtractSchemaTables<Contract extends SqlContract> = {
  readonly [TableName in keyof Contract['storage']['tables']]: TableBuilderImpl<
    TableName & string,
    Contract['storage']['tables'][TableName]['columns']
  > &
    TableRef;
};

export interface SchemaHandle<Contract extends SqlContract = SqlContract> {
  readonly tables: ExtractSchemaTables<Contract>;
}

export function schema<Contract extends SqlContract>(contract: Contract): SchemaHandle<Contract> {
  const storage = contract.storage;

  const tables = {} as ExtractSchemaTables<Contract>;

  for (const tableName in storage.tables) {
    const columns = buildColumns(tableName, storage);
    const table = new TableBuilderImpl<
      typeof tableName & string,
      Contract['storage']['tables'][typeof tableName]['columns']
    >(tableName, columns);
    const proxiedTable = createTableProxy(table);
    (tables as Record<string, unknown>)[tableName] = Object.freeze(
      proxiedTable,
    ) as TableBuilderImpl<
      typeof tableName & string,
      Contract['storage']['tables'][typeof tableName]['columns']
    > &
      TableRef;
  }

  return Object.freeze({ tables });
}

export function makeT<Contract extends SqlContract>(
  contract: Contract,
): ExtractSchemaTables<Contract> {
  return schema(contract).tables;
}

export type { ColumnBuilderImpl as Column, TableBuilderImpl as Table };
