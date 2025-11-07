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
import type {
  ModelColumnAccessor,
  OrmBuilderOptions,
  OrmModelBuilder,
  OrmRelationFilterBuilder,
  OrmWhereProperty,
} from './orm-types';
import { OrmRelationFilterBuilderImpl } from './orm-relation-filter';
import type { BinaryBuilder } from './types';

interface RelationFilter {
  relationName: string;
  childModelName: string;
  filterType: 'some' | 'none' | 'every';
  childWhere: BinaryBuilder | undefined;
  relation: {
    to: string;
    cardinality: string;
    on: {
      parentCols: readonly string[];
      childCols: readonly string[];
    };
  };
}

export class OrmModelBuilderImpl<
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
  private relationFilters: RelationFilter[] = [];
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

  get where(): OrmWhereProperty<TContract, CodecTypes, ModelName, Row> {
    const whereFn = (
      fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
    ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> => {
      const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
        { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
        this.modelName,
      );
      builder['table'] = this.table;
      builder.wherePredicate = fn(this._getModelAccessor());
      builder.relationFilters = this.relationFilters;
      builder.orderByExpr = this.orderByExpr;
      builder.limitValue = this.limitValue;
      builder.offsetValue = this.offsetValue;
      builder.projection = this.projection;
      return builder;
    };

    // Add related property using Proxy
    const related = this._createRelatedProxy();

    return Object.assign(whereFn, { related }) as OrmWhereProperty<TContract, CodecTypes, ModelName, Row>;
  }

  private _createRelatedProxy(): OrmWhereProperty<TContract, CodecTypes, ModelName, Row>['related'] {
    const self = this;
    // Relations are keyed by table name, not model name
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      return {} as OrmWhereProperty<TContract, CodecTypes, ModelName, Row>['related'];
    }
    const modelRelations = this.contract.relations?.[tableName];
    if (!modelRelations || typeof modelRelations !== 'object') {
      return {} as OrmWhereProperty<TContract, CodecTypes, ModelName, Row>['related'];
    }

    return new Proxy({} as OrmWhereProperty<TContract, CodecTypes, ModelName, Row>['related'], {
      get(_target, prop) {
        if (typeof prop !== 'string') {
          return undefined;
        }

        const relation = (modelRelations as Record<string, { to?: string }>)[prop];
        if (!relation || typeof relation !== 'object' || !('to' in relation)) {
          throw planInvalid(`Relation ${prop} not found on model ${self.modelName}`);
        }

        const childModelName = relation.to as string;
        const relationDef = relation as {
          to: string;
          cardinality: string;
          on: { parentCols: readonly string[]; childCols: readonly string[] };
        };
        const filterBuilder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, typeof childModelName>(
          { contract: self.contract, adapter: self.adapter, codecTypes: self.codecTypes },
          childModelName,
        );
        // Expose model accessor directly on the builder for convenience
        const modelAccessor = filterBuilder.getModelAccessor();
        const builderWithAccessor = Object.assign(filterBuilder, modelAccessor) as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> & ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>;

        return {
          some: (fn: (child: OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> | ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>) => OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> | BinaryBuilder) => {
            const result = fn(builderWithAccessor);
            // If result is a BinaryBuilder, wrap it in a builder
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, typeof childModelName>(
                { contract: self.contract, adapter: self.adapter, codecTypes: self.codecTypes },
                childModelName,
              );
              wrappedBuilder['wherePredicate'] = result as BinaryBuilder;
              return self._applyRelationFilter(prop, childModelName, 'some', () => wrappedBuilder, relationDef);
            }
            return self._applyRelationFilter(prop, childModelName, 'some', () => result as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>, relationDef);
          },
          none: (fn: (child: OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> | ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>) => OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> | BinaryBuilder) => {
            const result = fn(builderWithAccessor);
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, typeof childModelName>(
                { contract: self.contract, adapter: self.adapter, codecTypes: self.codecTypes },
                childModelName,
              );
              wrappedBuilder['wherePredicate'] = result as BinaryBuilder;
              return self._applyRelationFilter(prop, childModelName, 'none', () => wrappedBuilder, relationDef);
            }
            return self._applyRelationFilter(prop, childModelName, 'none', () => result as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>, relationDef);
          },
          every: (fn: (child: OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> | ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>) => OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> | BinaryBuilder) => {
            const result = fn(builderWithAccessor);
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, typeof childModelName>(
                { contract: self.contract, adapter: self.adapter, codecTypes: self.codecTypes },
                childModelName,
              );
              wrappedBuilder['wherePredicate'] = result as BinaryBuilder;
              return self._applyRelationFilter(prop, childModelName, 'every', () => wrappedBuilder, relationDef);
            }
            return self._applyRelationFilter(prop, childModelName, 'every', () => result as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>, relationDef);
          },
        };
      },
    });
  }

  private _applyRelationFilter(
    relationName: string,
    childModelName: string,
    filterType: 'some' | 'none' | 'every',
    fn: (child: OrmRelationFilterBuilder<TContract, CodecTypes, string>) => OrmRelationFilterBuilder<TContract, CodecTypes, string>,
    relationDef: {
      to: string;
      cardinality: string;
      on: { parentCols: readonly string[]; childCols: readonly string[] };
    },
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    // Create a relation filter builder and apply the callback
    const filterBuilder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, string>(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      childModelName,
    );
    const appliedFilter = fn(filterBuilder as OrmRelationFilterBuilder<TContract, CodecTypes, string>);
    const childWhere = (appliedFilter as OrmRelationFilterBuilderImpl<TContract, CodecTypes, string>).getWherePredicate();

    // Store the relation filter
    const relationFilter: RelationFilter = {
      relationName,
      childModelName,
      filterType,
      childWhere,
      relation: relationDef,
    };

    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { contract: this.contract, adapter: this.adapter, codecTypes: this.codecTypes },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.relationFilters = [...this.relationFilters, relationFilter];
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
    builder.relationFilters = this.relationFilters;
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
    builder.relationFilters = this.relationFilters;
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
    builder.relationFilters = this.relationFilters;
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
    builder.relationFilters = this.relationFilters;
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

