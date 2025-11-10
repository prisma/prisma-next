import type { ParamDescriptor, Plan } from '@prisma-next/contract/types';
import { planInvalid } from '@prisma-next/plan';
import type { RuntimeContext } from '@prisma-next/sql-runtime';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  AnyBinaryBuilder,
  AnyColumnBuilder,
  AnyOrderBuilder,
  BinaryBuilder,
  BuildOptions,
  InferNestedProjectionRow,
  NestedProjection,
  OrderBuilder,
} from '@prisma-next/sql-relational-core/types';
import type { SelectAst, SqlContract, SqlStorage, TableRef } from '@prisma-next/sql-target';
import { buildDeletePlan } from '../mutations/delete-builder';
import { buildInsertPlan } from '../mutations/insert-builder';
import { buildUpdatePlan } from '../mutations/update-builder';
import { OrmIncludeChildBuilderImpl } from '../orm-include-child';
import { OrmRelationFilterBuilderImpl } from '../orm-relation-filter';
import type {
  ModelColumnAccessor,
  OrmBuilderOptions,
  OrmIncludeAccessor,
  OrmModelBuilder,
  OrmRelationFilterBuilder,
  OrmWhereProperty,
} from '../orm-types';
import {
  buildMeta,
  createPlan,
  createPlanWithExists,
  type MetaBuildArgs,
} from '../plan/plan-assembly';
import {
  buildExistsSubqueries,
  buildIncludeAsts,
  combineWhereClauses,
} from '../relations/include-plan';
import { buildOrderByClause } from '../selection/ordering';
import { buildWhereExpr } from '../selection/predicates';
import { buildProjectionState, type ProjectionInput } from '../selection/projection';
import { buildProjectionItems, buildSelectAst } from '../selection/select-builder';
import { createTableRef } from '../utils/ast';
import { errorModelNotFound, errorTableNotFound, errorUnknownTable } from '../utils/errors';
import { createOrmContext } from './context';
import type { OrmIncludeState, RelationFilter } from './state';

export class OrmModelBuilderImpl<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  ModelName extends string = string,
  Row = unknown,
> implements OrmModelBuilder<TContract, CodecTypes, ModelName, Row>
{
  private readonly context: RuntimeContext<TContract>;
  private readonly contract: TContract;
  private readonly modelName: ModelName;
  private table: TableRef;
  private wherePredicate: AnyBinaryBuilder | undefined = undefined;
  private relationFilters: RelationFilter[] = [];
  private includes: OrmIncludeState[] = [];
  private orderByExpr: AnyOrderBuilder | undefined = undefined;
  private limitValue: number | undefined = undefined;
  private offsetValue: number | undefined = undefined;
  private projection: Record<string, AnyColumnBuilder | boolean | NestedProjection> | undefined =
    undefined;

  constructor(options: OrmBuilderOptions<TContract>, modelName: ModelName) {
    this.context = options.context;
    this.contract = options.context.contract;
    this.modelName = modelName;

    const tableName = this.contract.mappings.modelToTable?.[modelName];
    if (!tableName) {
      errorModelNotFound(modelName);
    }

    const schemaHandle = schema(options.context);
    const table = schemaHandle.tables[tableName];
    if (!table) {
      errorTableNotFound(tableName);
    }
    this.table = table;
  }

  get where(): OrmWhereProperty<TContract, CodecTypes, ModelName, Row> {
    const whereFn = (
      fn: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
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
            child: import('../orm-include-child').OrmIncludeChildBuilder<
              TContract,
              CodecTypes,
              typeof childModelName
            >,
          ) => import('../orm-include-child').OrmIncludeChildBuilder<
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
      child: import('../orm-include-child').OrmIncludeChildBuilder<TContract, CodecTypes, string>,
    ) => import('../orm-include-child').OrmIncludeChildBuilder<
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
      errorModelNotFound(childModelName);
    }
    const childTable: TableRef = { kind: 'table', name: childTableName };

    // Create child builder and apply callback
    const childBuilder = new OrmIncludeChildBuilderImpl<TContract, CodecTypes, string>(
      { context: this.context },
      childModelName,
    );
    const builtChild = childBuilderFn(
      childBuilder as import('../orm-include-child').OrmIncludeChildBuilder<
        TContract,
        CodecTypes,
        string
      >,
    );
    const childState = (
      builtChild as import('../orm-include-child').OrmIncludeChildBuilderImpl<
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
        >({ context: self.context }, childModelName);
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
              | AnyBinaryBuilder,
          ) => {
            const result = fn(builderWithAccessor);
            // If result is a AnyBinaryBuilder, wrap it in a builder
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<
                TContract,
                CodecTypes,
                typeof childModelName
              >({ context: self.context }, childModelName);
              wrappedBuilder['wherePredicate'] = result as AnyBinaryBuilder;
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
              | AnyBinaryBuilder,
          ) => {
            const result = fn(builderWithAccessor);
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<
                TContract,
                CodecTypes,
                typeof childModelName
              >({ context: self.context }, childModelName);
              wrappedBuilder['wherePredicate'] = result as AnyBinaryBuilder;
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
              | AnyBinaryBuilder,
          ) => {
            const result = fn(builderWithAccessor);
            if (result && 'kind' in result && result.kind === 'binary') {
              const wrappedBuilder = new OrmRelationFilterBuilderImpl<
                TContract,
                CodecTypes,
                typeof childModelName
              >({ context: self.context }, childModelName);
              wrappedBuilder['wherePredicate'] = result as AnyBinaryBuilder;
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

  select<Projection extends Record<string, AnyColumnBuilder | boolean | NestedProjection>>(
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
    >({ context: this.context }, this.modelName);
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
    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const contractTable = this.contract.storage.tables[this.table.name];

    if (!contractTable) {
      errorUnknownTable(this.table.name);
    }

    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
    const paramCodecs: Record<string, string> = {};

    // Build projection state
    const projectionInput: ProjectionInput =
      this.projection ??
      (() => {
        const modelAccessor = this._getModelAccessor();
        const defaultProjection: Record<string, AnyColumnBuilder> = {};
        for (const fieldName in modelAccessor) {
          defaultProjection[fieldName] = modelAccessor[fieldName];
        }
        return defaultProjection;
      })();

    // Build includes AST
    const { includesAst, includesForMeta } = buildIncludeAsts(
      this.includes,
      this.contract,
      this.context,
      this.modelName,
      paramsMap,
      paramDescriptors,
      paramValues,
      paramCodecs,
    );

    // Build projection state
    const projectionState = buildProjectionState(
      this.table,
      projectionInput,
      includesForMeta.length > 0
        ? (includesForMeta as unknown as Parameters<typeof buildProjectionState>[2])
        : undefined,
    );

    // Build where clause
    const whereResult = this.wherePredicate
      ? buildWhereExpr(this.wherePredicate, this.contract, paramsMap, paramDescriptors, paramValues)
      : undefined;
    const whereExpr = whereResult?.expr;
    if (whereResult?.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    // Build orderBy clause
    const orderByClause = buildOrderByClause(this.orderByExpr);

    // Build main projection items
    const projectEntries = buildProjectionItems(projectionState, includesForMeta);

    // Build SELECT AST
    const ast = buildSelectAst(
      this.table,
      projectEntries,
      includesAst.length > 0 ? includesAst : undefined,
      whereExpr,
      orderByClause,
      this.limitValue,
    );

    // Lower AST via adapter
    const lowered = this.context.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });

    // Build plan metadata
    const planMeta = buildMeta({
      contract: this.contract,
      table: createTableRef(this.table.name),
      projection: projectionState,
      includes: includesForMeta.length > 0 ? includesForMeta : undefined,
      paramDescriptors,
      paramCodecs: Object.keys(paramCodecs).length > 0 ? paramCodecs : undefined,
      where: this.wherePredicate as BinaryBuilder | undefined,
      orderBy: this.orderByExpr,
    } as MetaBuildArgs);

    // Create plan
    const plan = createPlan<Row>(ast, lowered, paramValues, planMeta);

    // Compile relation filters to EXISTS subqueries and combine with main where clause
    if (this.relationFilters.length > 0) {
      const existsExprs = buildExistsSubqueries(
        this.relationFilters,
        this.contract,
        this.modelName,
        options,
      );
      if (existsExprs.length > 0) {
        const combinedWhere = combineWhereClauses(ast.where, existsExprs);
        const reLowered = this.context.adapter.lower(
          {
            ...ast,
            ...(combinedWhere !== undefined ? { where: combinedWhere } : {}),
          } as SelectAst,
          {
            contract: this.contract,
            params: paramValues,
          },
        );
        return createPlanWithExists<Row>(ast, combinedWhere, reLowered, paramValues, planMeta);
      }
    }

    return plan;
  }

  findFirst(options?: BuildOptions): Plan<Row> {
    const plan = this.take(1).findMany(options);
    return plan;
  }

  findUnique(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
    options?: BuildOptions,
  ): Plan<Row> {
    return this.where(where).take(1).findMany(options);
  }

  create(data: Record<string, unknown>, options?: BuildOptions): Plan<number> {
    const context = createOrmContext(this.context);
    return buildInsertPlan(context, this.modelName, data, options);
  }

  update(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
    data: Record<string, unknown>,
    options?: BuildOptions,
  ): Plan<number> {
    const context = createOrmContext(this.context);
    return buildUpdatePlan<TContract, CodecTypes, ModelName>(
      context,
      this.modelName,
      where,
      () => this._getModelAccessor(),
      data,
      options,
    );
  }

  delete(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
    options?: BuildOptions,
  ): Plan<number> {
    const context = createOrmContext(this.context);
    return buildDeletePlan<TContract, CodecTypes, ModelName>(
      context,
      this.modelName,
      where,
      () => this._getModelAccessor(),
      options,
    );
  }

  private _getModelAccessor(): ModelColumnAccessor<TContract, CodecTypes, ModelName> {
    const tableName = this.contract.mappings.modelToTable?.[this.modelName];
    if (!tableName) {
      errorModelNotFound(this.modelName);
    }
    const schemaHandle = schema(this.context);
    const table = schemaHandle.tables[tableName];
    if (!table) {
      errorTableNotFound(tableName);
    }

    const accessor: Record<string, AnyColumnBuilder> = {};
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
        accessor[fieldName] = column as AnyColumnBuilder;
      }
    }

    return accessor as ModelColumnAccessor<TContract, CodecTypes, ModelName>;
  }
}
