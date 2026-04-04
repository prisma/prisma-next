import type { Contract } from '@prisma-next/contract/types';
import type { OperationRegistry } from '@prisma-next/operations';
import { planInvalid } from '@prisma-next/plan';
import type {
  ExtractTypeMapsFromContract,
  ResolveCodecTypes,
  ResolveOperationTypes,
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
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
> = {
  readonly [K in keyof Columns]: ColumnBuilder<
    K & string,
    Columns[K],
    ComputeColumnJsType<TContract, TableName, K & string, Columns[K], CodecTypes>,
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
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
> implements TableRef
{
  readonly kind = 'table' as const;
  readonly columns: ColumnBuilders<TContract, TableName, Columns, CodecTypes, Operations>;
  private readonly _name: TableName;

  constructor(
    name: TableName,
    columns: ColumnBuilders<TContract, TableName, Columns, CodecTypes, Operations>,
  ) {
    this._name = name;
    this.columns = columns;
  }

  get name(): string {
    return this._name;
  }
}

function buildColumns<
  TContract extends Contract<SqlStorage>,
  TableName extends keyof TContract['storage']['tables'] & string,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
>(
  tableName: TableName,
  storage: SqlStorage,
  _contract: TContract,
  operationRegistry?: OperationRegistry,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): ColumnBuilders<
  TContract,
  TableName,
  TContract['storage']['tables'][TableName]['columns'],
  CodecTypes,
  Operations
> {
  const table = storage.tables[tableName];

  if (!table) {
    throw planInvalid(`Unknown table ${tableName}`);
  }

  type Columns = TContract['storage']['tables'][TableName]['columns'];
  const tableColumns = table.columns as Columns;

  const result = {} as {
    [K in keyof Columns]: ColumnBuilder<
      K & string,
      Columns[K],
      ComputeColumnJsType<TContract, TableName, K & string, Columns[K], CodecTypes>,
      Operations
    >;
  };

  const assignColumn = <ColumnKey extends keyof Columns & string>(
    columnName: ColumnKey,
    columnDef: Columns[ColumnKey],
  ) => {
    type JsType = ComputeColumnJsType<
      TContract,
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

  return result as ColumnBuilders<TContract, TableName, Columns, CodecTypes, Operations>;
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
  TContract extends Contract<SqlStorage>,
  TableName extends string,
  Columns extends Record<string, StorageColumn>,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
>(
  table: TableBuilderImpl<TContract, TableName, Columns, CodecTypes, Operations>,
): TableBuilderImpl<TContract, TableName, Columns, CodecTypes, Operations> {
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
  TContract extends Contract<SqlStorage>,
  CodecTypes extends CodecTypesType,
  Operations extends OperationTypes,
> = {
  readonly [TableName in keyof TContract['storage']['tables']]: TableBuilderImpl<
    TContract,
    TableName & string,
    TableColumns<TContract['storage']['tables'][TableName]>,
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
type ExtractSchemaTypes<TContract extends Contract<SqlStorage>> =
  TContract['storage']['types'] extends infer Types
    ? Types extends Record<string, unknown>
      ? { readonly [TypeName in keyof Types]: Types[TypeName] }
      : Record<string, never>
    : Record<string, never>;

export type SchemaHandle<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
  CodecTypes extends CodecTypesType = CodecTypesType,
  Operations extends OperationTypes = Record<string, never>,
> = {
  readonly tables: ExtractSchemaTables<TContract, CodecTypes, Operations>;
  /**
   * Initialized type helpers from storage.types.
   * Each entry corresponds to a named type instance in the contract's storage.types.
   */
  readonly types: ExtractSchemaTypes<TContract>;
};

type SchemaReturnType<
  TContract extends Contract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
> = SchemaHandle<
  TContract,
  ResolveCodecTypes<TContract, TTypeMaps>,
  ToOperationTypes<ResolveOperationTypes<TContract, TTypeMaps>>
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
 * const schemaHandle = schema<TContract>(context);
 *
 * // Emitted: pass TypeMaps explicitly
 * const schemaHandle = schema<TContract, TypeMaps>(context);
 * ```
 */
export function schema<
  TContract extends Contract<SqlStorage>,
  TTypeMaps = ExtractTypeMapsFromContract<TContract>,
>(context: ExecutionContext<TContract>): SchemaReturnType<TContract, TTypeMaps> {
  const contract = context.contract;
  const storage = contract.storage;
  type CodecTypes = ResolveCodecTypes<TContract, TTypeMaps>;
  type Operations = ToOperationTypes<ResolveOperationTypes<TContract, TTypeMaps>>;
  const tables = {} as ExtractSchemaTables<TContract, CodecTypes, Operations>;
  const contractCapabilities = contract.capabilities;

  const operationRegistry = context.operations;

  for (const tableName of Object.keys(storage.tables) as Array<
    keyof TContract['storage']['tables'] & string
  >) {
    const columns = buildColumns<TContract, typeof tableName, CodecTypes, Operations>(
      tableName,
      storage,
      contract,
      operationRegistry,
      contractCapabilities,
    );
    const table = new TableBuilderImpl<
      TContract,
      typeof tableName & string,
      TContract['storage']['tables'][typeof tableName]['columns'],
      CodecTypes,
      Operations
    >(tableName, columns);
    const proxiedTable = createTableProxy<
      TContract,
      typeof tableName & string,
      TContract['storage']['tables'][typeof tableName]['columns'],
      CodecTypes,
      Operations
    >(table);
    (tables as Record<string, unknown>)[tableName] = Object.freeze(
      proxiedTable,
    ) as ExtractSchemaTables<TContract, CodecTypes, Operations>[typeof tableName];
  }

  // Get type helpers from context (populated by runtime context creation)
  const types = context.types as ExtractSchemaTypes<TContract>;

  return Object.freeze({ tables, types }) as SchemaReturnType<TContract, TTypeMaps>;
}

export type { ColumnBuilderImpl as Column, TableBuilderImpl as Table };
