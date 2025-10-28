import { planInvalid } from './errors';
import type {
  BinaryBuilder,
  ColumnBuilder,
  ContractStorage,
  OrderBuilder,
  ParamPlaceholder,
  PostgresContract,
  StorageColumn,
  TableRef,
} from './types';

class ColumnBuilderImpl implements ColumnBuilder {
  readonly kind = 'column';

  constructor(
    readonly table: string,
    readonly column: string,
    private readonly storageColumn: StorageColumn,
  ) {}

  get columnMeta(): StorageColumn {
    return this.storageColumn;
  }

  eq(this: ColumnBuilderImpl, value: ParamPlaceholder): BinaryBuilder {
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

  asc(this: ColumnBuilderImpl): OrderBuilder {
    return Object.freeze({
      kind: 'order' as const,
      expr: this,
      dir: 'asc' as const,
    });
  }

  desc(this: ColumnBuilderImpl): OrderBuilder {
    return Object.freeze({
      kind: 'order' as const,
      expr: this,
      dir: 'desc' as const,
    });
  }
}

class TableBuilderImpl implements TableRef {
  readonly kind = 'table';

  constructor(
    readonly name: string,
    readonly columns: Record<string, ColumnBuilderImpl>,
  ) {
    Object.assign(this, columns);
  }
}

function buildColumns(tableName: string, storage: ContractStorage) {
  const table = storage.tables[tableName];

  if (!table) {
    throw planInvalid(`Unknown table ${tableName}`);
  }

  const result: Record<string, ColumnBuilderImpl> = {};

  for (const [columnName, columnDef] of Object.entries(table.columns)) {
    result[columnName] = new ColumnBuilderImpl(tableName, columnName, columnDef);
  }

  return result;
}

export interface SchemaTables {
  readonly [tableName: string]: TableBuilderImpl & TableRef;
}

export interface SchemaHandle {
  readonly tables: SchemaTables;
}

export function schema(contract: PostgresContract): SchemaHandle {
  const storage = contract.storage;

  const tables = Object.fromEntries(
    Object.keys(storage.tables).map((tableName) => {
      const columns = buildColumns(tableName, storage);
      return [
        tableName,
        Object.freeze(new TableBuilderImpl(tableName, columns)) as TableBuilderImpl & TableRef,
      ];
    }),
  ) as SchemaTables;

  return Object.freeze({ tables });
}

export type { ColumnBuilderImpl as Column, TableBuilderImpl as Table };
