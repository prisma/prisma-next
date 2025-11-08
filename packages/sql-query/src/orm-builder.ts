import type { RuntimeContext } from '@prisma-next/runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import { OrmIncludeChildBuilderImpl } from './orm-include-child';
import { OrmRelationFilterBuilderImpl } from './orm-relation-filter';
import type {
  ModelColumnAccessor,
  OrmBuilderOptions,
  OrmIncludeAccessor,
  OrmModelBuilder,
  OrmRelationFilterBuilder,
  OrmWhereProperty,
} from './orm-types';
import { param } from './param';
import { schema } from './schema';
import { createJoinOnBuilder, sql } from './sql';
import type {
  Adapter,
  BinaryBuilder,
  BinaryExpr,
  BuildOptions,
  ColumnBuilder,
  ColumnRef,
  DeleteAst,
  ExistsExpr,
  InferNestedProjectionRow,
  InsertAst,
  LoweredStatement,
  OrderBuilder,
  ParamPlaceholder,
  Plan,
  SelectAst,
  TableRef,
  UpdateAst,
} from './types';

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

interface OrmIncludeState {
  relationName: string;
  childModelName: string;
  childTable: TableRef;
  childWhere: BinaryBuilder | undefined;
  childOrderBy: OrderBuilder | undefined;
  childLimit: number | undefined;
  childProjection:
    | Record<
        string,
        ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
      >
    | undefined;
  alias: string;
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
  private readonly context: RuntimeContext<TContract>;
  private readonly contract: TContract;
  private readonly adapter: Adapter<SelectAst, TContract, LoweredStatement>;
  private readonly codecTypes: CodecTypes;
  private readonly modelName: ModelName;
  private table: TableRef;
  private wherePredicate: BinaryBuilder | undefined = undefined;
  private relationFilters: RelationFilter[] = [];
  private includes: OrmIncludeState[] = [];
  private orderByExpr: OrderBuilder | undefined = undefined;
  private limitValue: number | undefined = undefined;
  private offsetValue: number | undefined = undefined;
  private projection:
    | Record<
        string,
        ColumnBuilder | boolean | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
      >
    | undefined = undefined;

  constructor(options: OrmBuilderOptions<TContract>, modelName: ModelName) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.adapter = options.context.adapter;
    this.codecTypes = options.context.contract.mappings.codecTypes as CodecTypes;
    this.modelName = modelName;

    const tableName = this.contract.mappings.modelToTable?.[modelName];
    if (!tableName) {
      throw planInvalid(`Model ${modelName} not found in mappings`);
    }

    const schemaHandle = schema(options.context);
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
        { context: this.context },
        this.modelName,
      );
      builder['table'] = this.table;
      builder.wherePredicate = fn(this._getModelAccessor());
      builder.relationFilters = this.relationFilters;
      builder.includes = this.includes;
      builder.orderByExpr = this.orderByExpr;
      builder.limitValue = this.limitValue;
      builder.offsetValue = this.offsetValue;
      builder.projection = this.projection;
      return builder;
    };

    // Add related property using Proxy
    const related = this._createRelatedProxy();

    return Object.assign(whereFn, { related }) as OrmWhereProperty<
      TContract,
      CodecTypes,
      ModelName,
      Row
    >;
  }

  get include(): OrmIncludeAccessor<TContract, CodecTypes, ModelName, Row> {
    return this._createIncludeProxy();
  }

  private _createIncludeProxy(): OrmIncludeAccessor<TContract, CodecTypes, ModelName, Row> {
    const self = this;
    // Relations are keyed by table name, not model name
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      return {} as OrmIncludeAccessor<TContract, CodecTypes, ModelName, Row>;
    }
    const modelRelations = this.contract.relations?.[tableName];
    if (!modelRelations || typeof modelRelations !== 'object') {
      return {} as OrmIncludeAccessor<TContract, CodecTypes, ModelName, Row>;
    }

    return new Proxy({} as OrmIncludeAccessor<TContract, CodecTypes, ModelName, Row>, {
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

        return (
          child: (
            child: import('./orm-include-child').OrmIncludeChildBuilder<
              TContract,
              CodecTypes,
              typeof childModelName
            >,
          ) => import('./orm-include-child').OrmIncludeChildBuilder<
            TContract,
            CodecTypes,
            typeof childModelName,
            unknown
          >,
        ) => {
          return self._applyInclude(prop, childModelName, child, relationDef);
        };
      },
    });
  }

  private _applyInclude(
    relationName: string,
    childModelName: string,
    childBuilderFn: (
      child: import('./orm-include-child').OrmIncludeChildBuilder<TContract, CodecTypes, string>,
    ) => import('./orm-include-child').OrmIncludeChildBuilder<
      TContract,
      CodecTypes,
      string,
      unknown
    >,
    relationDef: {
      to: string;
      cardinality: string;
      on: { parentCols: readonly string[]; childCols: readonly string[] };
    },
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    // Get child table
    const childTableName = this.contract.mappings.modelToTable?.[childModelName];
    if (!childTableName) {
      throw planInvalid(`Model ${childModelName} not found in mappings`);
    }
    const childTable: TableRef = { kind: 'table', name: childTableName };

    // Create child builder and apply callback
    const childBuilder = new OrmIncludeChildBuilderImpl<TContract, CodecTypes, string>(
      { context: this.context },
      childModelName,
    );
    const builtChild = childBuilderFn(
      childBuilder as import('./orm-include-child').OrmIncludeChildBuilder<
        TContract,
        CodecTypes,
        string
      >,
    );
    const childState = (
      builtChild as import('./orm-include-child').OrmIncludeChildBuilderImpl<
        TContract,
        CodecTypes,
        string
      >
    ).getState();

    // Store the include
    // Note: Child projection validation happens in findMany() when compiling to includeMany
    const includeState: OrmIncludeState = {
      relationName,
      childModelName,
      childTable,
      childWhere: childState.childWhere,
      childOrderBy: childState.childOrderBy,
      childLimit: childState.childLimit,
      childProjection: childState.childProjection,
      alias: relationName,
      relation: relationDef,
    };

    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { context: this.context },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.relationFilters = this.relationFilters;
    builder.includes = [...this.includes, includeState];
    builder.orderByExpr = this.orderByExpr;
    builder.limitValue = this.limitValue;
    builder.offsetValue = this.offsetValue;
    builder.projection = this.projection;
    return builder;
  }

  private _createRelatedProxy(): OrmWhereProperty<
    TContract,
    CodecTypes,
    ModelName,
    Row
  >['related'] {
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
        const filterBuilder = new OrmRelationFilterBuilderImpl<
          TContract,
          CodecTypes,
          typeof childModelName
        >(
          { context: self.context },
          childModelName,
        );
        // Expose model accessor directly on the builder for convenience
        const modelAccessor = filterBuilder.getModelAccessor();
        const builderWithAccessor = Object.assign(
          filterBuilder,
          modelAccessor,
        ) as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName> &
          ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>;

        return {
          some: (
            fn: (
              child:
                | OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>
                | ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>,
            ) =>
              | OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>
              | BinaryBuilder,
          ) => {
            const result = fn(builderWithAccessor);
            // If result is a BinaryBuilder, wrap it in a builder
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<
                TContract,
                CodecTypes,
                typeof childModelName
              >(
                { context: self.context },
                childModelName,
              );
              wrappedBuilder['wherePredicate'] = result as BinaryBuilder;
              return self._applyRelationFilter(
                prop,
                childModelName,
                'some',
                () => wrappedBuilder,
                relationDef,
              );
            }
            return self._applyRelationFilter(
              prop,
              childModelName,
              'some',
              () =>
                result as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>,
              relationDef,
            );
          },
          none: (
            fn: (
              child:
                | OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>
                | ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>,
            ) =>
              | OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>
              | BinaryBuilder,
          ) => {
            const result = fn(builderWithAccessor);
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<
                TContract,
                CodecTypes,
                typeof childModelName
              >(
                { context: self.context },
                childModelName,
              );
              wrappedBuilder['wherePredicate'] = result as BinaryBuilder;
              return self._applyRelationFilter(
                prop,
                childModelName,
                'none',
                () => wrappedBuilder,
                relationDef,
              );
            }
            return self._applyRelationFilter(
              prop,
              childModelName,
              'none',
              () =>
                result as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>,
              relationDef,
            );
          },
          every: (
            fn: (
              child:
                | OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>
                | ModelColumnAccessor<TContract, CodecTypes, typeof childModelName>,
            ) =>
              | OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>
              | BinaryBuilder,
          ) => {
            const result = fn(builderWithAccessor);
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<
                TContract,
                CodecTypes,
                typeof childModelName
              >(
                { context: self.context },
                childModelName,
              );
              wrappedBuilder['wherePredicate'] = result as BinaryBuilder;
              return self._applyRelationFilter(
                prop,
                childModelName,
                'every',
                () => wrappedBuilder,
                relationDef,
              );
            }
            return self._applyRelationFilter(
              prop,
              childModelName,
              'every',
              () =>
                result as OrmRelationFilterBuilder<TContract, CodecTypes, typeof childModelName>,
              relationDef,
            );
          },
        };
      },
    });
  }

  private _applyRelationFilter(
    relationName: string,
    childModelName: string,
    filterType: 'some' | 'none' | 'every',
    fn: (
      child: OrmRelationFilterBuilder<TContract, CodecTypes, string>,
    ) => OrmRelationFilterBuilder<TContract, CodecTypes, string>,
    relationDef: {
      to: string;
      cardinality: string;
      on: { parentCols: readonly string[]; childCols: readonly string[] };
    },
  ): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    // Create a relation filter builder and apply the callback
    const filterBuilder = new OrmRelationFilterBuilderImpl<TContract, CodecTypes, string>(
      { context: this.context },
      childModelName,
    );
    const appliedFilter = fn(
      filterBuilder as OrmRelationFilterBuilder<TContract, CodecTypes, string>,
    );
    const childWhere = (
      appliedFilter as OrmRelationFilterBuilderImpl<TContract, CodecTypes, string>
    ).getWherePredicate();

    // Store the relation filter
    const relationFilter: RelationFilter = {
      relationName,
      childModelName,
      filterType,
      childWhere,
      relation: relationDef,
    };

    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { context: this.context },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.relationFilters = [...this.relationFilters, relationFilter];
    builder.includes = this.includes;
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
      { context: this.context },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.relationFilters = this.relationFilters;
    builder.includes = this.includes;
    builder.orderByExpr = fn(this._getModelAccessor());
    builder.limitValue = this.limitValue;
    builder.offsetValue = this.offsetValue;
    builder.projection = this.projection;
    return builder;
  }

  take(n: number): OrmModelBuilder<TContract, CodecTypes, ModelName, Row> {
    const builder = new OrmModelBuilderImpl<TContract, CodecTypes, ModelName, Row>(
      { context: this.context },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.relationFilters = this.relationFilters;
    builder.includes = this.includes;
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
      { context: this.context },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.relationFilters = this.relationFilters;
    builder.includes = this.includes;
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
      { context: this.context },
      this.modelName,
    );
    builder['table'] = this.table;
    builder.wherePredicate = this.wherePredicate;
    builder.relationFilters = this.relationFilters;
    builder.includes = this.includes;
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
    const sqlBuilder = sql({ context: this.context });
    let query = sqlBuilder.from(this.table);

    if (this.wherePredicate) {
      query = query.where(this.wherePredicate);
    }

    // Compile includes to includeMany before other operations
    for (const includeState of this.includes) {
      // Capability check
      const target = this.contract.target;
      const capabilities = this.contract.capabilities;
      if (!capabilities || !capabilities[target]) {
        throw planInvalid('includeMany requires lateral and jsonAgg capabilities');
      }
      const targetCapabilities = capabilities[target];
      if (capabilities[target]['lateral'] !== true || targetCapabilities['jsonAgg'] !== true) {
        throw planInvalid('includeMany requires lateral and jsonAgg capabilities to be true');
      }

      // Build join condition from relation metadata
      const joinOnBuilder = createJoinOnBuilder();
      const parentTableName = this.contract.mappings.modelToTable?.[this.modelName];
      if (!parentTableName) {
        throw planInvalid(`Model ${this.modelName} not found in mappings`);
      }

      // Get parent and child column builders for join condition
      const parentSchemaHandle = schema(this.context);
      const parentSchemaTable = parentSchemaHandle.tables[parentTableName];
      if (!parentSchemaTable) {
        throw planInvalid(`Table ${parentTableName} not found in schema`);
      }
      const childSchemaHandle = schema(this.context);
      const childSchemaTable = childSchemaHandle.tables[includeState.childTable.name];
      if (!childSchemaTable) {
        throw planInvalid(`Table ${includeState.childTable.name} not found in schema`);
      }

      // Build join predicate from relation metadata
      // For now, support single-column joins (most common case)
      if (
        includeState.relation.on.parentCols.length !== 1 ||
        includeState.relation.on.childCols.length !== 1
      ) {
        throw planInvalid('Multi-column joins in includes are not yet supported');
      }
      const parentColName = includeState.relation.on.parentCols[0];
      const childColName = includeState.relation.on.childCols[0];
      if (!parentColName || !childColName) {
        throw planInvalid('Join columns must be defined');
      }
      const parentCol = parentSchemaTable.columns[parentColName];
      const childCol = childSchemaTable.columns[childColName];
      if (!parentCol) {
        throw planInvalid(`Column ${parentColName} not found in table ${parentTableName}`);
      }
      if (!childCol) {
        throw planInvalid(
          `Column ${childColName} not found in table ${includeState.childTable.name}`,
        );
      }

      const onPredicate = joinOnBuilder.eqCol(parentCol, childCol);

      // Convert ORM child builder state to SQL lane IncludeChildBuilder
      // We need to create an IncludeChildBuilder that applies the stored state
      query = query.includeMany(
        includeState.childTable,
        () => onPredicate,
        (child) => {
          // Apply child where
          let builtChild = child;
          if (includeState.childWhere) {
            builtChild = builtChild.where(includeState.childWhere);
          }
          // Apply child orderBy
          if (includeState.childOrderBy) {
            // Convert OrderBuilder to ReturnType<ColumnBuilder['asc']>
            // OrderBuilder has expr and dir, which matches the SQL lane's orderBy signature
            builtChild = builtChild.orderBy(
              includeState.childOrderBy as ReturnType<ColumnBuilder['asc']>,
            );
          }
          // Apply child limit
          if (includeState.childLimit !== undefined) {
            builtChild = builtChild.limit(includeState.childLimit);
          }
          // Apply child projection
          // Validate child projection is non-empty
          if (!includeState.childProjection) {
            throw planInvalid('Child projection must be specified');
          }
          // Note: SQL lane's IncludeChildBuilder.select() doesn't accept boolean values
          // The ORM's childProjection may have boolean values for include references,
          // but those are handled at the parent level, not in child includes
          // Filter out boolean values - they're not valid in child projections
          const filteredProjection: Record<
            string,
            ColumnBuilder | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>
          > = {};
          for (const [key, value] of Object.entries(includeState.childProjection)) {
            if (value !== true && value !== false) {
              filteredProjection[key] = value as
                | ColumnBuilder
                | Record<string, ColumnBuilder | Record<string, ColumnBuilder>>;
            }
          }
          if (Object.keys(filteredProjection).length === 0) {
            throw planInvalid('Child projection must not be empty after filtering boolean values');
          }
          builtChild = builtChild.select(filteredProjection);
          return builtChild;
        },
        { alias: includeState.alias },
      );
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

    // Compile relation filters to EXISTS subqueries and combine with main where clause
    if (this.relationFilters.length > 0) {
      const existsExprs = this._buildExistsSubqueries(this.relationFilters, options);
      if (existsExprs.length > 0) {
        // Combine EXISTS expressions with main where clause using AND logic
        // For now, we'll add them to the AST directly
        const ast = plan.ast as SelectAst;
        const combinedWhere = this._combineWhereClauses(ast.where, existsExprs);
        const modifiedAst: SelectAst = {
          ...ast,
          ...(combinedWhere !== undefined ? { where: combinedWhere } : {}),
        };
        return {
          ...plan,
          ast: modifiedAst,
          meta: {
            ...plan.meta,
            lane: 'orm',
          },
        };
      }
    }

    return {
      ...plan,
      meta: {
        ...plan.meta,
        lane: 'orm',
      },
    };
  }

  private _buildExistsSubqueries(
    relationFilters: RelationFilter[],
    options?: BuildOptions,
  ): ExistsExpr[] {
    const existsExprs: ExistsExpr[] = [];

    for (const filter of relationFilters) {
      const childTableName = this.contract.mappings.modelToTable?.[filter.childModelName];
      if (!childTableName) {
        throw planInvalid(`Model ${filter.childModelName} not found in mappings`);
      }

      const childTable: TableRef = { kind: 'table', name: childTableName };
      const parentTableName = this.contract.mappings.modelToTable?.[this.modelName];
      if (!parentTableName) {
        throw planInvalid(`Model ${this.modelName} not found in mappings`);
      }

      // Build join condition from relation metadata
      // For EXISTS, we need to correlate the subquery with the outer query
      // The join condition becomes WHERE parent_col = child_col
      const joinConditions: Array<{ left: ColumnRef; right: ColumnRef }> = [];
      for (let i = 0; i < filter.relation.on.parentCols.length; i++) {
        const parentCol = filter.relation.on.parentCols[i];
        const childCol = filter.relation.on.childCols[i];
        if (!parentCol || !childCol) {
          continue;
        }
        joinConditions.push({
          left: { kind: 'col', table: parentTableName, column: parentCol },
          right: { kind: 'col', table: childTableName, column: childCol },
        });
      }

      // Build child where clause if present
      let childWhere: BinaryExpr | undefined;
      if (filter.childWhere) {
        // Build child where clause using SQL builder
        const childSqlBuilder = sql({ context: this.context });
        // Get child model accessor to build default projection
        const childSchemaHandle = schema(this.context);
        const childSchemaTable = childSchemaHandle.tables[childTableName];
        if (!childSchemaTable) {
          throw planInvalid(`Table ${childTableName} not found in schema`);
        }
        const childModelAccessor: Record<string, ColumnBuilder> = {};
        const childModel = this.contract.models[filter.childModelName];
        if (childModel && typeof childModel === 'object' && 'fields' in childModel) {
          const childModelFields = childModel.fields as Record<string, { column?: string }>;
          for (const fieldName in childModelFields) {
            const field = childModelFields[fieldName];
            if (!field) continue;
            const columnName =
              this.contract.mappings.fieldToColumn?.[filter.childModelName]?.[fieldName] ??
              field.column ??
              fieldName;
            const column = childSchemaTable.columns[columnName];
            if (column) {
              childModelAccessor[fieldName] = column;
            }
          }
        }
        // Use first column for projection (EXISTS doesn't care about the actual value)
        const firstColumn = Object.values(childModelAccessor)[0];
        if (!firstColumn) {
          throw planInvalid(`No columns found for model ${filter.childModelName}`);
        }
        const childQuery = childSqlBuilder
          .from(childTable)
          .where(filter.childWhere)
          .select({ _exists: firstColumn });
        const childPlan = childQuery.build(options);
        const childAst = childPlan.ast as SelectAst;
        childWhere = childAst.where as BinaryExpr | undefined;
      }

      // Build subquery AST
      // For EXISTS, we only need SELECT 1 FROM child_table WHERE join_condition AND child_where
      // For now, we'll build a simple subquery with just the first join condition
      // TODO: Support combining multiple join conditions with AND
      const subqueryWhere: BinaryExpr | undefined = childWhere;
      // For EXISTS, we need at least one column in the projection
      // Use the first join condition's right column as a simple projection
      const projectionColumn = joinConditions[0]?.right ?? {
        kind: 'col',
        table: childTableName,
        column: 'id',
      };
      const subquery: SelectAst = {
        kind: 'select',
        from: childTable,
        project: [{ alias: '_exists', expr: projectionColumn }],
        ...(subqueryWhere ? { where: subqueryWhere } : {}),
      };

      // Determine if this is NOT EXISTS based on filter type
      const notExists = filter.filterType === 'none' || filter.filterType === 'every';

      const existsExpr: ExistsExpr = {
        kind: 'exists',
        not: notExists,
        subquery,
      };

      existsExprs.push(existsExpr);
    }

    return existsExprs;
  }

  private _combineWhereClauses(
    mainWhere: BinaryExpr | ExistsExpr | undefined,
    existsExprs: ExistsExpr[],
  ): BinaryExpr | ExistsExpr | undefined {
    // For now, if we have multiple EXISTS expressions, we'll just use the first one
    // TODO: Support combining multiple EXISTS expressions with AND logic
    // This requires extending the AST to support boolean composition (AND/OR)
    if (existsExprs.length === 1) {
      return existsExprs[0];
    }
    if (mainWhere) {
      return mainWhere;
    }
    // Fallback: return first EXISTS expression if available
    if (existsExprs.length > 0) {
      return existsExprs[0];
    }
    return undefined;
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

  create(data: Record<string, unknown>, options?: BuildOptions): Plan<number> {
    // Validate data is non-empty
    if (!data || Object.keys(data).length === 0) {
      throw planInvalid('create() requires at least one field');
    }

    // Convert model field names to column names and ParamPlaceholder map
    const values = this._convertModelFieldsToColumns(data);

    // Get table name from mappings
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.modelName} not found in mappings`);
    }
    const table: TableRef = { kind: 'table', name: tableName };

    // Build insert query using SQL lane
    const sqlBuilder = sql({ context: this.context });
    const insertBuilder = (
      sqlBuilder as {
        insert: (table: TableRef, values: Record<string, ParamPlaceholder>) => unknown;
      }
    ).insert(table, values);

    // Build plan with params from data object
    const plan = (insertBuilder as { build: (options?: BuildOptions) => Plan<unknown> }).build({
      ...options,
      params: {
        ...(options?.params ?? {}),
        ...data,
      },
    });

    // Return plan with ORM metadata
    return {
      ...plan,
      meta: {
        ...plan.meta,
        lane: 'orm',
        annotations: {
          ...plan.meta.annotations,
          intent: 'write',
          isMutation: true,
        },
      },
    } as Plan<number>;
  }

  update(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
    data: Record<string, unknown>,
    options?: BuildOptions,
  ): Plan<number> {
    // Validate data is non-empty
    if (!data || Object.keys(data).length === 0) {
      throw planInvalid('update() requires at least one field');
    }

    // Convert model field names to column names and ParamPlaceholder map
    const set = this._convertModelFieldsToColumns(data);

    // Build where predicate from callback
    const modelAccessor = this._getModelAccessor();
    const wherePredicate = where(modelAccessor);

    // Get table name from mappings
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.modelName} not found in mappings`);
    }
    const table: TableRef = { kind: 'table', name: tableName };

    // Build update query using SQL lane
    const sqlBuilder = sql({ context: this.context });
    const updateBuilder = (
      sqlBuilder as {
        update: (
          table: TableRef,
          set: Record<string, ParamPlaceholder>,
        ) => {
          where: (predicate: BinaryBuilder) => { build: (options?: BuildOptions) => Plan<unknown> };
        };
      }
    )
      .update(table, set)
      .where(wherePredicate);

    // Build plan with params from both data and where predicate
    // Note: If where predicate uses params with same names as data fields, they'll be merged
    const plan = updateBuilder.build({
      ...options,
      params: {
        ...(options?.params ?? {}),
        ...data,
      },
    });

    // Return plan with ORM metadata
    return {
      ...plan,
      meta: {
        ...plan.meta,
        lane: 'orm',
        annotations: {
          ...plan.meta.annotations,
          intent: 'write',
          isMutation: true,
        },
      },
    } as Plan<number>;
  }

  delete(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => BinaryBuilder,
    options?: BuildOptions,
  ): Plan<number> {
    // Build where predicate from callback
    const modelAccessor = this._getModelAccessor();
    const wherePredicate = where(modelAccessor);

    // Get table name from mappings
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.modelName} not found in mappings`);
    }
    const table: TableRef = { kind: 'table', name: tableName };

    // Build delete query using SQL lane
    const sqlBuilder = sql({ context: this.context });
    const deleteBuilder = (
      sqlBuilder as {
        delete: (table: TableRef) => {
          where: (predicate: BinaryBuilder) => { build: (options?: BuildOptions) => Plan<unknown> };
        };
      }
    )
      .delete(table)
      .where(wherePredicate);

    // Build plan with params from where predicate
    const plan = deleteBuilder.build(options);

    // Return plan with ORM metadata
    return {
      ...plan,
      meta: {
        ...plan.meta,
        lane: 'orm',
        annotations: {
          ...plan.meta.annotations,
          intent: 'write',
          isMutation: true,
        },
      },
    } as Plan<number>;
  }

  private _convertModelFieldsToColumns(
    fields: Record<string, unknown>,
  ): Record<string, ParamPlaceholder> {
    const model = this.contract.models[this.modelName];
    if (!model || typeof model !== 'object' || !('fields' in model)) {
      throw planInvalid(`Model ${this.modelName} does not have fields`);
    }
    const modelFields = model.fields as Record<string, { column?: string }>;

    const result: Record<string, ParamPlaceholder> = {};

    for (const fieldName in fields) {
      if (!Object.hasOwn(fields, fieldName)) {
        continue;
      }

      // Validate field exists in model
      if (!Object.hasOwn(modelFields, fieldName)) {
        throw planInvalid(`Field ${fieldName} does not exist on model ${this.modelName}`);
      }

      const field = modelFields[fieldName];
      if (!field) {
        continue;
      }

      // Get column name from mappings or field definition
      const columnName =
        this.contract.mappings.fieldToColumn?.[this.modelName]?.[fieldName] ??
        field.column ??
        fieldName;

      // Create param placeholder with field name as param name
      result[columnName] = param(fieldName);
    }

    return result;
  }

  private _getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ModelName> {
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      throw planInvalid(`Model ${this.modelName} not found in mappings`);
    }
    const schemaHandle = schema(this.context);
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
