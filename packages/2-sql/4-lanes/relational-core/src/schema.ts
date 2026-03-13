import type { OperationRegistry } from '@prisma-next/operations';
import { planInvalid } from '@prisma-next/plan';
import type {
  ExtractTypeMapsFromContract,
  ResolveCodecTypes,
  ResolveOperationTypes,
  SqlContract,
  SqlStorage,
  StorageColumn,
} from '@prisma-next/sql-contract/types';
import { type BinaryOp, ColumnRef, type ExpressionSource, type TableRef } from './ast/types';
import { attachOperationsToColumnBuilder } from './operations-registry';
import type { ExecutionContext } from './query-lane-context';
import type {
  BinaryBuilder,
  CodecTypes as CodecTypesType,
  ColumnBuilder,
  ComputeColumnJsType,
  NullCheckBuilder,
  OperationTypeSignature,
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
> implements ExpressionSource
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

  // Type-level helper property (not used at runtime)
  get __jsType(): JsType {
    return undefined as unknown as JsType;
  }

  /**
   * Converts this column builder to a ColumnRef expression.
   * This is the canonical way to get an AST node from a builder.
   */
  toExpr(): ColumnRef {
    return new ColumnRef(this.table, this.column);
  }

  private createBinaryBuilder(
    op: BinaryOp,
    value: ParamPlaceholder | ExpressionSource,
  ): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    if (value == null) {
      throw planInvalid(
        'Parameter placeholder or expression source required for column comparison',
      );
    }
    // Check for ExpressionSource first (has toExpr method)
    if ('toExpr' in value && typeof value.toExpr === 'function') {
      return Object.freeze({
        kind: 'binary' as const,
        op,
        left: this.toExpr(),
        right: value,
      }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
    }
    // Must be a ParamPlaceholder
    if ('kind' in value && value.kind === 'param-placeholder') {
      return Object.freeze({
        kind: 'binary' as const,
        op,
        left: this.toExpr(),
        right: value,
      }) as BinaryBuilder<ColumnName, ColumnMeta, JsType>;
    }
    throw planInvalid('Parameter placeholder or expression source required for column comparison');
  }

  eq(value: ParamPlaceholder | ExpressionSource): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('eq', value);
  }

  neq(value: ParamPlaceholder | ExpressionSource): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('neq', value);
  }

  gt(value: ParamPlaceholder | ExpressionSource): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('gt', value);
  }

  lt(value: ParamPlaceholder | ExpressionSource): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('lt', value);
  }

  gte(value: ParamPlaceholder | ExpressionSource): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('gte', value);
  }

  lte(value: ParamPlaceholder | ExpressionSource): BinaryBuilder<ColumnName, ColumnMeta, JsType> {
    return this.createBinaryBuilder('lte', value);
  }

  asc(): OrderBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this.toExpr(),
      dir: 'asc' as const,
    }) as OrderBuilder<ColumnName, ColumnMeta, JsType>;
  }

  desc(): OrderBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'order' as const,
      expr: this.toExpr(),
      dir: 'desc' as const,
    }) as OrderBuilder<ColumnName, ColumnMeta, JsType>;
  }

  /**
   * Creates an IS NULL check for this column.
   * Available on all columns at runtime, but typed to only be visible on nullable columns.
   */
  isNull(): NullCheckBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'nullCheck' as const,
      expr: this.toExpr(),
      isNull: true,
    }) as NullCheckBuilder<ColumnName, ColumnMeta, JsType>;
  }

  /**
   * Creates an IS NOT NULL check for this column.
   * Available on all columns at runtime, but typed to only be visible on nullable columns.
   */
  isNotNull(): NullCheckBuilder<ColumnName, ColumnMeta, JsType> {
    return Object.freeze({
      kind: 'nullCheck' as const,
      expr: this.toExpr(),
      isNull: false,
    }) as NullCheckBuilder<ColumnName, ColumnMeta, JsType>;
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

/**
 * Extracts the types registry shape from a contract.
 * Each key is a type name from storage.types, and the value preserves the
 * literal type from the contract (including codecId, nativeType, and typeParams).
 * Returns an empty object type {} when storage.types is undefined.
 */
type ExtractSchemaTypes<Contract extends SqlContract<SqlStorage>> =
  Contract['storage']['types'] extends infer Types
    ? Types extends Record<string, unknown>
      ? { readonly [TypeName in keyof Types]: Types[TypeName] }
      : Record<string, never>
    : Record<string, never>;

export type SchemaHandle<
  Contract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends CodecTypesType = CodecTypesType,
  Operations extends OperationTypes = Record<string, never>,
> = {
  readonly tables: ExtractSchemaTables<Contract, CodecTypes, Operations>;
  /**
   * Initialized type helpers from storage.types.
   * Each entry corresponds to a named type instance in the contract's storage.types.
   */
  readonly types: ExtractSchemaTypes<Contract>;
};

type SchemaReturnType<
  Contract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<Contract>,
> = SchemaHandle<
  Contract,
  ResolveCodecTypes<Contract, TTypeMaps>,
  ToOperationTypes<ResolveOperationTypes<Contract, TTypeMaps>>
>;

type NormalizeOperationTypes<T> = {
  [TypeId in keyof T]: {
    [Method in keyof T[TypeId]]: T[TypeId][Method] extends OperationTypeSignature
      ? T[TypeId][Method]
      : OperationTypeSignature;
  };
};

type ToOperationTypes<T> = T extends OperationTypes ? T : NormalizeOperationTypes<T>;

/**
 * Creates a schema handle for building SQL queries.
 *
 * @param context - Query lane context containing contract, codec and operation registries
 * @returns A schema handle with typed table builders and type helpers
 *
 * @example
 * ```typescript
 * // No-emit: infers TypeMaps from ContractWithTypeMaps
 * const schemaHandle = schema<Contract>(context);
 *
 * // Emitted: pass TypeMaps explicitly
 * const schemaHandle = schema<Contract, TypeMaps>(context);
 * ```
 */
export function schema<
  Contract extends SqlContract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<Contract>,
>(context: ExecutionContext<Contract>): SchemaReturnType<Contract, TTypeMaps> {
  const contract = context.contract;
  const storage = contract.storage;
  type CodecTypes = ResolveCodecTypes<Contract, TTypeMaps>;
  type Operations = ToOperationTypes<ResolveOperationTypes<Contract, TTypeMaps>>;
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

  // Get type helpers from context (populated by runtime context creation)
  const types = context.types as ExtractSchemaTypes<Contract>;

  return Object.freeze({ tables, types }) as SchemaReturnType<Contract, TTypeMaps>;
}

export type { ColumnBuilderImpl as Column, TableBuilderImpl as Table };
