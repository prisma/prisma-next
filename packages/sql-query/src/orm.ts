import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import { schema } from './schema';
import { sql } from './sql';
import type {
  Adapter,
  BinaryBuilder,
  BuildOptions,
  ColumnBuilder,
  InferNestedProjectionRow,
  LoweredStatement,
  OrderBuilder,
  Plan,
  SelectAst,
  TableRef,
} from './types';

export interface OrmBuilderOptions<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> {
  readonly contract: TContract;
  readonly adapter: Adapter<SelectAst, TContract, LoweredStatement>;
  readonly codecTypes?: CodecTypes;
}

type ModelName<TContract extends SqlContract<SqlStorage>> = keyof TContract['models'] & string;

type OrmRegistry<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
> = {
  readonly [K in ModelName<TContract>]: () => OrmModelBuilder<TContract, CodecTypes, K>;
};

export interface OrmModelBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ModelName extends string = string,
  Row = unknown,
> {
  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  orderBy(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => OrderBuilder,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  take(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  skip(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row>;
  select<
    Projection extends Record<
      string,
      ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
    >,
  >(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => Projection,
  ): OrmModelBuilder<
    TContract,
    CodecTypes,
    ModelName,
    InferNestedProjectionRow<Projection, CodecTypes>
  >;
  findMany(options?: BuildOptions): Plan<Row>;
  findFirst(options?: BuildOptions): Plan<Row>;
  findUnique(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
    options?: BuildOptions,
  ): Plan<Row>;
}

type ModelColumnAccessor<
  TContract extends SqlContract<SqlStorage>,
  _CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
> = TContract['models'][ModelName] extends { fields: infer Fields }
  ? Fields extends Record<string, unknown>
    ? {
        readonly [K in keyof Fields]: ColumnBuilder<
          K & string,
          TContract['storage']['tables'][TContract['mappings']['modelToTable'] extends Record<
            string,
            string
          >
            ? TContract['mappings']['modelToTable'][ModelName]
            : never]['columns'][K & string],
          unknown
        >;
      }
    : never
  : never;

class OrmModelBuilderImpl<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ModelName extends string = string,
  Row = unknown,
> implements OrmModelBuilder<TContract, CodecTypes, ModelName, Row>
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<SelectAst, TContract, LoweredStatement>;
  private readonly codecTypes: CodecTypes;
  private readonly modelName: ModelName;
  private table: TableRef;
  private wherePredicate: BinaryBuilder | undefined = undefined;
  private orderByExpr: OrderBuilder | undefined = undefined;
  private limitValue: number | undefined = undefined;
  private offsetValue: number | undefined = undefined;
  private projection:
    | Record<
        string,
        ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
      >
    | undefined = undefined;

  constructor(options: OrmBuilderOptions<TContract, CodecTypes>, modelName: ModelName) {
    this.contract = options.contract;
    this.adapter = options.adapter;
    this.codecTypes = (options.codecTypes ?? {}) as CodecTypes;
    this.modelName = modelName;

    const tableName = this.contract.mappings.modelToTable?.[modelName];
    if (!tableName) {
      throw planInvalid(`Model ${modelName} not found in mappings`);
    }

    const schemaHandle = schema(this.contract, this.codecTypes);
    const table = schemaHandle.tables[tableName];
    if (!table) {
      throw planInvalid(`Table ${tableName} not found in schema`);
    }
    this.table = table;
  }

  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = fn(this._getModelAccessor());
    builder.orderByExpr = this.orderByExpr;
    builder.limitValue = this.limitValue;
    builder.offsetValue = this.offsetValue;
    builder.projection = this.projection;
    return builder;
  }

  orderBy(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => OrderBuilder,
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.orderByExpr = fn(this._getModelAccessor());
    builder.limitValue = this.limitValue;
    builder.offsetValue = this.offsetValue;
    builder.projection = this.projection;
    return builder;
  }

  take(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.orderByExpr = this.orderByExpr;
    builder.limitValue = n;
    builder.offsetValue = this.offsetValue;
    builder.projection = this.projection;
    return builder;
  }

  skip(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    // TODO: SQL lane doesn't support offset yet - this is a placeholder
    // When offset is added to SelectAst, implement it here
    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.orderByExpr = this.orderByExpr;
    builder.limitValue = this.limitValue;
    builder.offsetValue = n;
    builder.projection = this.projection;
    return builder;
  }

  select<
    Projection extends Record<
      string,
      ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
    >,
  >(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => Projection,
  ): OrmModelBuilder<
    TContract,
    CodecTypes,
    ModelName,
    InferNestedProjectionRow<Projection, CodecTypes>
  > {
    const builder = new OrmModelBuilderImpl<
      TContract,
      CodecTypes,
      ModelName,
      InferNestedProjectionRow<Projection, CodecTypes>
    >(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.orderByExpr = this.orderByExpr;
    builder.limitValue = this.limitValue;
    builder.offsetValue = this.offsetValue;
    builder.projection = fn(this._getModelAccessor());
    return builder as OrmModelBuilder<
      TContract,
      CodecTypes,
      ModelName,
      InferNestedProjectionRow<Projection, CodecTypes>
    >;
  }

  findMany(options?: BuildOptions): Plan<Row> {
    const sqlBuilder = sql({
      contract: this.contract,
      adapter: this.adapter,
      codecTypes: this.codecTypes,
    });
    let query = sqlBuilder.from(this.table);

    if (this.wherePredicate) {
      query = query.where(this.wherePredicate);
    }

    if (this.orderByExpr) {
      query = query.orderBy(this.orderByExpr);
    }

    if (this.limitValue !== undefined) {
      query = query.limit(this.limitValue);
    }

    // TODO: SQL lane doesn't support offset yet - skip implementation for now
    // if (this.offsetValue !== undefined) {
    //   query = query.skip(this.offsetValue);
    // }

    if (this.projection) {
      query = query.select(this.projection);
    } else {
      // Default projection: select all columns
      const modelAccessor = this._getModelAccessor();
      const defaultProjection: Record<string, ColumnBuilder> = {};
      for (const fieldName in modelAccessor) {
        defaultProjection[fieldName] = modelAccessor[fieldName];
      }
      query = query.select(defaultProjection);
    }

    const plan = query.build(options);
    return {
      ...plan,
      meta: {
        ...plan.meta,
        lane: 'orm',
      },
    };
  }

  findFirst(options?: BuildOptions): Plan<Row> {
    const plan = this.take(1).findMany(options);
    return plan;
  }

  findUnique(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
    options?: BuildOptions,
  ): Plan<Row> {
    return this.where(where).take(1).findMany(options);
  }

  private _getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ModelName> {
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.modelName} not found in mappings`);
    }
    const schemaHandle = schema(this.contract, this.codecTypes);
    const table = schemaHandle.tables[tableName];
    if (!table) {
      throw planInvalid(`Table ${tableName} not found in schema`);
    }

    const accessor = {} as ModelColumnAccessor<TContract, CodecTypes, ModelName>;
    const model = this.contract.models[this.modelName];
    if (!model || typeof model !== 'object' || !('fields' in model)) {
      throw planInvalid(`Model ${this.modelName} does not have fields`);
    }
    const modelFields = model.fields as Record<string, { column?: string }>;

    for (const fieldName in modelFields) {
      const field = modelFields[fieldName];
      if (!field) continue;
      const columnName =
        this.contract.mappings.fieldToColumn?.[this.modelName]?.[fieldName] ??
        field.column ??
        fieldName;
      const column = table.columns[columnName];
      if (column) {
        (accessor as Record<string, ColumnBuilder>)[fieldName] = column;
      }
    }

    return accessor;
  }
}

export function orm<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
>(options: OrmBuilderOptions<TContract, CodecTypes>): OrmRegistry<TContract, CodecTypes> {
  const { contract } = options;

  return new Proxy({} as OrmRegistry<TContract, CodecTypes>, {
    get(_target, prop) {
      if (typeof prop !== 'string') {
        return undefined;
      }

      const modelName = (prop.charAt(0).toUpperCase() + prop.slice(1)) as ModelName<TContract>;
      if (
        !contract.models ||
        typeof contract.models !== 'object' ||
        !(modelName in contract.models)
      ) {
        throw planInvalid(`Model ${prop} (resolved to ${modelName}) not found in contract`);
      }

      return () =>
        new OrmModelBuilderImpl<TContract, CodecTypes, typeof modelName>(options, modelName);
    },
    has(_target, prop) {
      if (typeof prop !== 'string') {
        return false;
      }
      const modelName = (prop.charAt(0).toUpperCase() + prop.slice(1)) as ModelName<TContract>;
      return contract.models && typeof contract.models === 'object' && modelName in contract.models;
    },
  });
}
