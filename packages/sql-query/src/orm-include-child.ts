import type { RuntimeContext } from '@prisma-next/runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import type { ModelColumnAccessor, OrmBuilderOptions } from './orm-types';
import { schema } from './schema';
import type { BinaryBuilder, ColumnBuilder, InferNestedProjectionRow, OrderBuilder } from './types';

export interface OrmIncludeChildBuilder<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ChildModelName extends string,
  ChildRow = unknown,
> {
  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => BinaryBuilder,
  ): OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow>;
  orderBy(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => OrderBuilder,
  ): OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow>;
  take(n: number): OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow>;
  select<
    Projection extends Record<
      string,
      ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
    >,
  >(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => Projection,
  ): OrmIncludeChildBuilder<
    TContract,
    CodecTypes,
    ChildModelName,
    InferNestedProjectionRow<Projection, CodecTypes>
  >;
}

export class OrmIncludeChildBuilderImpl<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ChildModelName extends string,
  ChildRow = unknown,
> implements OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow>
{
  private readonly context: RuntimeContext<TContract>;
  private readonly contract: TContract;
  private readonly codecTypes: CodecTypes;
  private readonly childModelName: ChildModelName;
  private childWhere: BinaryBuilder | undefined;
  private childOrderBy: OrderBuilder | undefined;
  private childLimit: number | undefined;
  private childProjection:
    | Record<
        string,
        ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
      >
    | undefined = undefined;

  constructor(options: OrmBuilderOptions<TContract>, childModelName: ChildModelName) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.codecTypes = options.context.contract.mappings.codecTypes as CodecTypes;
    this.childModelName = childModelName;
  }

  where(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => BinaryBuilder,
  ): OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow> {
    const builder = new OrmIncludeChildBuilderImpl<TContract, CodecTypes, ChildModelName, ChildRow>(
      { context: this.context },
      this.childModelName,
    );
    builder.childWhere = fn(this._getModelAccessor());
    builder.childOrderBy = this.childOrderBy;
    builder.childLimit = this.childLimit;
    builder.childProjection = this.childProjection;
    return builder;
  }

  orderBy(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => OrderBuilder,
  ): OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow> {
    const builder = new OrmIncludeChildBuilderImpl<TContract, CodecTypes, ChildModelName, ChildRow>(
      { context: this.context },
      this.childModelName,
    );
    builder.childWhere = this.childWhere;
    builder.childOrderBy = fn(this._getModelAccessor());
    builder.childLimit = this.childLimit;
    builder.childProjection = this.childProjection;
    return builder;
  }

  take(n: number): OrmIncludeChildBuilder<TContract, CodecTypes, ChildModelName, ChildRow> {
    const builder = new OrmIncludeChildBuilderImpl<TContract, CodecTypes, ChildModelName, ChildRow>(
      { context: this.context },
      this.childModelName,
    );
    builder.childWhere = this.childWhere;
    builder.childOrderBy = this.childOrderBy;
    builder.childLimit = n;
    builder.childProjection = this.childProjection;
    return builder;
  }

  select<
    Projection extends Record<
      string,
      ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
    >,
  >(
    fn: (model: ModelColumnAccessor<TContract, CodecTypes, ChildModelName>) => Projection,
  ): OrmIncludeChildBuilder<
    TContract,
    CodecTypes,
    ChildModelName,
    InferNestedProjectionRow<Projection, CodecTypes>
  > {
    const builder = new OrmIncludeChildBuilderImpl<
      TContract,
      CodecTypes,
      ChildModelName,
      InferNestedProjectionRow<Projection, CodecTypes>
    >(
      { context: this.context },
      this.childModelName,
    );
    builder.childWhere = this.childWhere;
    builder.childOrderBy = this.childOrderBy;
    builder.childLimit = this.childLimit;
    builder.childProjection = fn(this._getModelAccessor());
    return builder;
  }

  getState(): {
    childWhere?: BinaryBuilder;
    childOrderBy?: OrderBuilder;
    childLimit?: number;
    childProjection?: Record<
      string,
      ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
    >;
  } {
    return {
      ...(this.childWhere !== undefined ? { childWhere: this.childWhere } : {}),
      ...(this.childOrderBy !== undefined ? { childOrderBy: this.childOrderBy } : {}),
      ...(this.childLimit !== undefined ? { childLimit: this.childLimit } : {}),
      ...(this.childProjection !== undefined ? { childProjection: this.childProjection } : {}),
    };
  }

  private _getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ChildModelName> {
    const tableName = this.contract.mappings.modelToTable?.[this.childModelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.childModelName} not found in mappings`);
    }
    const schemaHandle = schema(this.context);
    const table = schemaHandle.tables[tableName];
    if (!table) {
      throw planInvalid(`Table ${tableName} not found in schema`);
    }

    const accessor = {} as ModelColumnAccessor<TContract, CodecTypes, ChildModelName>;
    const model = this.contract.models[this.childModelName];
    if (!model || typeof model !== 'object' || !('fields' in model)) {
      throw planInvalid(`Model ${this.childModelName} does not have fields`);
    }
    const modelFields = model.fields as Record<string, { column?: string }>;

    for (const fieldName in modelFields) {
      const field = modelFields[fieldName];
      if (!field) continue;
      const columnName =
        this.contract.mappings.fieldToColumn?.[this.childModelName]?.[fieldName] ??
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
