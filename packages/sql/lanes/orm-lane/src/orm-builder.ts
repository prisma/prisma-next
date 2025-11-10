import type { ParamDescriptor, Plan, PlanMeta } from '@prisma-next/contract/types';
import { planInvalid } from '@prisma-next/plan';
import type { RuntimeContext } from '@prisma-next/runtime';
import {
  createBinaryExpr,
  createColumnRef,
  createDeleteAst,
  createInsertAst,
  createJoinOnExpr,
  createOrderByItem,
  createParamRef,
  createSelectAst,
  createTableRef,
  createUpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  AnyBinaryBuilder,
  AnyColumnBuilder,
  AnyOrderBuilder,
  BinaryBuilder,
  BuildOptions,
  InferNestedProjectionRow,
  JoinOnPredicate,
  NestedProjection,
  OrderBuilder,
  ParamPlaceholder,
} from '@prisma-next/sql-relational-core/types';
import type {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  IncludeAst,
  IncludeRef,
  LiteralExpr,
  LoweredStatement,
  OperationExpr,
  ParamRef,
  SelectAst,
  SqlContract,
  SqlStorage,
  StorageColumn,
  TableRef,
} from '@prisma-next/sql-target';
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

interface RelationFilter {
  relationName: string;
  childModelName: string;
  filterType: 'some' | 'none' | 'every';
  childWhere: AnyBinaryBuilder | undefined;
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
  childWhere: AnyBinaryBuilder | undefined;
  childOrderBy: AnyOrderBuilder | undefined;
  childLimit: number | undefined;
  childProjection: Record<string, AnyColumnBuilder | boolean | NestedProjection> | undefined;
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
      throw planInvalid(`Unknown table ${this.table.name}`);
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

    // Build includes state for buildMeta
    const includesForMeta: IncludeState[] = [];
    const includesAst: IncludeAst[] = [];

    // Build includes AST
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

      // Build join ON expression
      const leftCol = createColumnRef(parentTableName, parentColName);
      const rightCol = createColumnRef(includeState.childTable.name, childColName);
      const onExpr = createJoinOnExpr(leftCol, rightCol);

      // Build child projection state
      if (!includeState.childProjection) {
        throw planInvalid('Child projection must be specified');
      }
      const filteredProjection: Record<string, AnyColumnBuilder | NestedProjection> = {};
      for (const [key, value] of Object.entries(includeState.childProjection)) {
        if (value !== true && value !== false) {
          filteredProjection[key] = value as AnyColumnBuilder | NestedProjection;
        }
      }
      if (Object.keys(filteredProjection).length === 0) {
        throw planInvalid('Child projection must not be empty after filtering boolean values');
      }
      const childProjectionState = buildProjectionState(
        includeState.childTable,
        filteredProjection as ProjectionInput,
      );

      // Build child where clause
      let childWhere: BinaryExpr | undefined;
      if (includeState.childWhere) {
        const whereResult = buildWhereExpr(
          includeState.childWhere,
          this.contract,
          paramsMap,
          paramDescriptors,
          paramValues,
        );
        childWhere = whereResult.expr;
        if (whereResult.codecId && whereResult.paramName) {
          paramCodecs[whereResult.paramName] = whereResult.codecId;
        }
      }

      // Build child orderBy clause
      const childOrderBy = includeState.childOrderBy
        ? (() => {
            const orderBy = includeState.childOrderBy as OrderBuilder<
              string,
              StorageColumn,
              unknown
            >;
            const orderExpr = orderBy.expr;
            const expr: ColumnRef | OperationExpr = (() => {
              if (isOperationExpr(orderExpr)) {
                const baseCol = extractBaseColumnRef(orderExpr);
                return createColumnRef(baseCol.table, baseCol.column);
              }
              const colBuilder = orderExpr as { table: string; column: string };
              return createColumnRef(colBuilder.table, colBuilder.column);
            })();
            return [createOrderByItem(expr, orderBy.dir)];
          })()
        : undefined;

      // Build child projection items
      const childProjectionItems: Array<{ alias: string; expr: ColumnRef | OperationExpr }> = [];
      for (let i = 0; i < childProjectionState.aliases.length; i++) {
        const alias = childProjectionState.aliases[i];
        if (!alias) {
          throw planInvalid(`Missing alias at index ${i}`);
        }
        const column = childProjectionState.columns[i];
        if (!column) {
          throw planInvalid(`Missing column for alias ${alias} at index ${i}`);
        }
        const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
        if (operationExpr) {
          childProjectionItems.push({ alias, expr: operationExpr });
        } else {
          const col = column as { table: string; column: string };
          childProjectionItems.push({ alias, expr: createColumnRef(col.table, col.column) });
        }
      }

      // Build include AST directly
      const includeAst: IncludeAst = {
        kind: 'includeMany',
        alias: includeState.alias,
        child: {
          table: includeState.childTable,
          on: onExpr,
          project: childProjectionItems,
          ...(childWhere ? { where: childWhere } : {}),
          ...(childOrderBy ? { orderBy: childOrderBy } : {}),
          ...(typeof includeState.childLimit === 'number'
            ? { limit: includeState.childLimit }
            : {}),
        },
      };
      includesAst.push(includeAst);

      // Build include state for buildMeta
      const includeForMeta: IncludeState = {
        alias: includeState.alias,
        table: includeState.childTable,
        on: {
          kind: 'join-on',
          left: parentCol,
          right: childCol,
        },
        childProjection: childProjectionState,
        ...(includeState.childWhere ? { childWhere: includeState.childWhere } : {}),
        ...(includeState.childOrderBy ? { childOrderBy: includeState.childOrderBy } : {}),
        ...(includeState.childLimit !== undefined ? { childLimit: includeState.childLimit } : {}),
      };
      includesForMeta.push(includeForMeta);
    }

    // Build projection state
    const projectionState = buildProjectionState(
      this.table,
      projectionInput,
      includesForMeta.length > 0 ? includesForMeta : undefined,
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
    const orderByClause = this.orderByExpr
      ? (() => {
          const orderBy = this.orderByExpr as OrderBuilder<string, StorageColumn, unknown>;
          const orderExpr = orderBy.expr;
          const expr: ColumnRef | OperationExpr = isOperationExpr(orderExpr)
            ? orderExpr
            : (() => {
                const colBuilder = orderExpr as { table: string; column: string };
                return createColumnRef(colBuilder.table, colBuilder.column);
              })();
          return [createOrderByItem(expr, orderBy.dir)];
        })()
      : undefined;

    // Build main projection items
    const projectEntries: Array<{ alias: string; expr: ColumnRef | IncludeRef | OperationExpr }> =
      [];
    for (let i = 0; i < projectionState.aliases.length; i++) {
      const alias = projectionState.aliases[i];
      if (!alias) {
        throw planInvalid(`Missing alias at index ${i}`);
      }
      const column = projectionState.columns[i];
      if (!column) {
        throw planInvalid(`Missing column for alias ${alias} at index ${i}`);
      }

      // Check if this alias matches an include alias
      const matchingInclude = includesForMeta.find((inc) => inc.alias === alias);
      if (matchingInclude) {
        // This is an include reference
        projectEntries.push({
          alias,
          expr: { kind: 'includeRef', alias },
        });
      } else {
        // Check if this column has an operation expression
        const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
        if (operationExpr) {
          projectEntries.push({
            alias,
            expr: operationExpr,
          });
        } else {
          // This is a regular column
          const col = column as { table: string; column: string };
          const tableName = col.table;
          const columnName = col.column;
          if (!tableName || !columnName) {
            throw planInvalid(`Invalid column for alias ${alias} at index ${i}`);
          }
          projectEntries.push({
            alias,
            expr: createColumnRef(tableName, columnName),
          });
        }
      }
    }

    // Build SELECT AST
    const ast = createSelectAst({
      from: createTableRef(this.table.name),
      project: projectEntries,
      ...(includesAst.length > 0 ? { includes: includesAst } : {}),
      ...(whereExpr ? { where: whereExpr } : {}),
      ...(orderByClause ? { orderBy: orderByClause } : {}),
      ...(typeof this.limitValue === 'number' ? { limit: this.limitValue } : {}),
    });

    // Lower AST via adapter
    const lowered = this.context.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

    // Build plan metadata
    const planMeta = buildMeta({
      contract: this.contract,
      table: createTableRef(this.table.name),
      projection: projectionState,
      ...(includesForMeta.length > 0 ? { includes: includesForMeta } : {}),
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
      ...(this.wherePredicate ? { where: this.wherePredicate as BinaryBuilder } : {}),
      ...(this.orderByExpr ? { orderBy: this.orderByExpr } : {}),
    });

    // Create plan
    const plan: Plan<Row> = Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
      meta: {
        ...planMeta,
        lane: 'orm',
      },
    });

    // Compile relation filters to EXISTS subqueries and combine with main where clause
    if (this.relationFilters.length > 0) {
      const existsExprs = this._buildExistsSubqueries(this.relationFilters, options);
      if (existsExprs.length > 0) {
        // Combine EXISTS expressions with main where clause using AND logic
        const combinedWhere = this._combineWhereClauses(ast.where, existsExprs);
        const modifiedAst: SelectAst = {
          ...ast,
          ...(combinedWhere !== undefined ? { where: combinedWhere } : {}),
        };
        // Re-lower the modified AST
        const reLowered = this.context.adapter.lower(modifiedAst, {
          contract: this.contract,
          params: paramValues,
        });
        const reLoweredBody = reLowered.body as LoweredStatement;
        return Object.freeze({
          ast: modifiedAst,
          sql: reLoweredBody.sql,
          params: reLoweredBody.params ?? paramValues,
          meta: {
            ...planMeta,
            lane: 'orm',
          },
        });
      }
    }

    return plan;
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
        // Build child where clause directly
        const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
        const paramDescriptors: ParamDescriptor[] = [];
        const paramValues: unknown[] = [];
        const whereResult = buildWhereExpr(
          filter.childWhere,
          this.contract,
          paramsMap,
          paramDescriptors,
          paramValues,
        );
        childWhere = whereResult.expr;
      }

      // Build subquery AST
      // For EXISTS, we only need SELECT 1 FROM child_table WHERE join_condition AND child_where
      // For now, we'll build a simple subquery with just the first join condition
      // TODO: Support combining multiple join conditions with AND
      let subqueryWhere: BinaryExpr | undefined = childWhere;
      if (joinConditions.length > 0) {
        // Combine join conditions with child where
        const firstJoinCondition = joinConditions[0];
        if (firstJoinCondition) {
          // For column-to-column comparisons, create BinaryExpr directly
          // (createBinaryExpr expects ParamRef on right, but we need ColumnRef)
          const joinWhere: BinaryExpr = {
            kind: 'bin',
            op: 'eq',
            left: firstJoinCondition.left,
            right: firstJoinCondition.right as unknown as ParamRef,
          };
          if (childWhere) {
            // TODO: Support combining multiple conditions with AND
            // For now, just use the join condition
            subqueryWhere = joinWhere;
          } else {
            subqueryWhere = joinWhere;
          }
        }
      }
      // For EXISTS, we need at least one column in the projection
      // Use the first join condition's right column as a simple projection
      const projectionColumn = joinConditions[0]?.right ?? createColumnRef(childTableName, 'id');
      const subquery = createSelectAst({
        from: childTable,
        project: [{ alias: '_exists', expr: projectionColumn }],
        ...(subqueryWhere ? { where: subqueryWhere } : {}),
      });

      // Determine if this is NOT EXISTS based on filter type
      const notExists = filter.filterType === 'none' || filter.filterType === 'every';

      const existsExpr: ExistsExpr = {
        kind: 'exists',
        subquery,
        not: notExists,
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
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
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
    const table = createTableRef(tableName);

    // Build INSERT AST directly
    const paramsMap = {
      ...(options?.params ?? {}),
      ...data,
    } as Record<string, unknown>;
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
    const paramCodecs: Record<string, string> = {};

    const contractTable = this.contract.storage.tables[tableName];
    if (!contractTable) {
      throw planInvalid(`Unknown table ${tableName}`);
    }

    const insertValues: Record<string, ColumnRef | ParamRef> = {};
    for (const [columnName, placeholder] of Object.entries(values)) {
      if (!contractTable.columns[columnName]) {
        throw planInvalid(`Unknown column ${columnName} in table ${tableName}`);
      }

      const paramName = placeholder.name;
      if (!Object.hasOwn(paramsMap, paramName)) {
        throw planInvalid(`Missing value for parameter ${paramName}`);
      }

      const value = paramsMap[paramName];
      const index = paramValues.push(value);

      const columnMeta = contractTable.columns[columnName];
      const codecId = columnMeta?.type;
      if (codecId && paramName) {
        paramCodecs[paramName] = codecId;
      }

      paramDescriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table: tableName, column: columnName },
        ...(codecId ? { type: codecId } : {}),
        ...(columnMeta?.nullable !== undefined ? { nullable: columnMeta.nullable } : {}),
      });

      insertValues[columnName] = createParamRef(index, paramName);
    }

    const ast = createInsertAst({
      table,
      values: insertValues,
    });

    // Lower AST via adapter
    const lowered = this.context.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

    // Build plan metadata
    const planMeta = buildMeta({
      contract: this.contract,
      table,
      projection: { aliases: [], columns: [] },
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
    });

    // Return plan with ORM metadata
    return Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
      meta: {
        ...planMeta,
        lane: 'orm',
        annotations: {
          ...planMeta.annotations,
          intent: 'write',
          isMutation: true,
        },
      },
    }) as Plan<number>;
  }

  update(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
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
    const table = createTableRef(tableName);

    // Build UPDATE AST directly
    const paramsMap = {
      ...(options?.params ?? {}),
      ...data,
    } as Record<string, unknown>;
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
    const paramCodecs: Record<string, string> = {};

    const contractTable = this.contract.storage.tables[tableName];
    if (!contractTable) {
      throw planInvalid(`Unknown table ${tableName}`);
    }

    const updateSet: Record<string, ColumnRef | ParamRef> = {};
    for (const [columnName, placeholder] of Object.entries(set)) {
      if (!contractTable.columns[columnName]) {
        throw planInvalid(`Unknown column ${columnName} in table ${tableName}`);
      }

      const paramName = placeholder.name;
      if (!Object.hasOwn(paramsMap, paramName)) {
        throw planInvalid(`Missing value for parameter ${paramName}`);
      }

      const value = paramsMap[paramName];
      const index = paramValues.push(value);

      const columnMeta = contractTable.columns[columnName];
      const codecId = columnMeta?.type;
      if (codecId && paramName) {
        paramCodecs[paramName] = codecId;
      }

      paramDescriptors.push({
        name: paramName,
        source: 'dsl',
        refs: { table: tableName, column: columnName },
        ...(codecId ? { type: codecId } : {}),
        ...(columnMeta?.nullable !== undefined ? { nullable: columnMeta.nullable } : {}),
      });

      updateSet[columnName] = createParamRef(index, paramName);
    }

    // Build where clause
    const whereResult = buildWhereExpr(
      wherePredicate,
      this.contract,
      paramsMap,
      paramDescriptors,
      paramValues,
    );
    const whereExpr = whereResult.expr;
    if (!whereExpr) {
      throw planInvalid('Failed to build WHERE clause');
    }

    if (whereResult?.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    const ast = createUpdateAst({
      table,
      set: updateSet,
      where: whereExpr,
    });

    // Lower AST via adapter
    const lowered = this.context.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

    // Build plan metadata
    const planMeta = buildMeta({
      contract: this.contract,
      table,
      projection: { aliases: [], columns: [] },
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
      where: wherePredicate as BinaryBuilder,
    });

    // Return plan with ORM metadata
    return Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
      meta: {
        ...planMeta,
        lane: 'orm',
        annotations: {
          ...planMeta.annotations,
          intent: 'write',
          isMutation: true,
        },
      },
    }) as Plan<number>;
  }

  delete(
    where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
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
    const table = createTableRef(tableName);

    // Build DELETE AST directly
    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const paramDescriptors: ParamDescriptor[] = [];
    const paramValues: unknown[] = [];
    const paramCodecs: Record<string, string> = {};

    // Build where clause
    const whereResult = buildWhereExpr(
      wherePredicate,
      this.contract,
      paramsMap,
      paramDescriptors,
      paramValues,
    );
    const whereExpr = whereResult.expr;
    if (!whereExpr) {
      throw planInvalid('Failed to build WHERE clause');
    }

    if (whereResult?.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    const ast = createDeleteAst({
      table,
      where: whereExpr,
    });

    // Lower AST via adapter
    const lowered = this.context.adapter.lower(ast, {
      contract: this.contract,
      params: paramValues,
    });
    const loweredBody = lowered.body as LoweredStatement;

    // Build plan metadata
    const planMeta = buildMeta({
      contract: this.contract,
      table,
      projection: { aliases: [], columns: [] },
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0 ? { paramCodecs } : {}),
      where: wherePredicate as BinaryBuilder,
    });

    // Return plan with ORM metadata
    return Object.freeze({
      ast,
      sql: loweredBody.sql,
      params: loweredBody.params ?? paramValues,
      meta: {
        ...planMeta,
        lane: 'orm',
        annotations: {
          ...planMeta.annotations,
          intent: 'write',
          isMutation: true,
        },
      },
    }) as Plan<number>;
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

function extractBaseColumnRef(expr: ColumnRef | OperationExpr): ColumnRef {
  if (expr.kind === 'col') {
    return expr;
  }
  return extractBaseColumnRef(expr.self);
}

function collectColumnRefs(expr: ColumnRef | ParamRef | LiteralExpr | OperationExpr): ColumnRef[] {
  if (expr.kind === 'col') {
    return [expr];
  }
  if (expr.kind === 'operation') {
    const refs: ColumnRef[] = collectColumnRefs(expr.self);
    for (const arg of expr.args) {
      refs.push(...collectColumnRefs(arg));
    }
    return refs;
  }
  return [];
}

function isOperationExpr(expr: AnyColumnBuilder | OperationExpr): expr is OperationExpr {
  return typeof expr === 'object' && expr !== null && 'kind' in expr && expr.kind === 'operation';
}

function getColumnInfo(expr: AnyColumnBuilder | OperationExpr): {
  table: string;
  column: string;
} {
  if (isOperationExpr(expr)) {
    const baseCol = extractBaseColumnRef(expr);
    return { table: baseCol.table, column: baseCol.column };
  }
  const colBuilder = expr as unknown as { table: string; column: string };
  return { table: colBuilder.table, column: colBuilder.column };
}

function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

function generateAlias(path: string[]): string {
  if (path.length === 0) {
    throw planInvalid('Alias path cannot be empty');
  }
  return path.join('_');
}

class AliasTracker {
  private readonly aliases = new Set<string>();
  private readonly aliasToPath = new Map<string, string[]>();

  register(path: string[]): string {
    const alias = generateAlias(path);
    if (this.aliases.has(alias)) {
      const existingPath = this.aliasToPath.get(alias);
      throw planInvalid(
        `Alias collision: path ${path.join('.')} would generate alias "${alias}" which conflicts with path ${existingPath?.join('.') ?? 'unknown'}`,
      );
    }
    this.aliases.add(alias);
    this.aliasToPath.set(alias, path);
    return alias;
  }

  getPath(alias: string): string[] | undefined {
    return this.aliasToPath.get(alias);
  }

  has(alias: string): boolean {
    return this.aliases.has(alias);
  }
}

interface ProjectionState {
  readonly aliases: string[];
  readonly columns: AnyColumnBuilder[];
}

type ProjectionInput = Record<string, AnyColumnBuilder | boolean | NestedProjection>;

function flattenProjection(
  projection: NestedProjection,
  tracker: AliasTracker,
  currentPath: string[] = [],
): { aliases: string[]; columns: AnyColumnBuilder[] } {
  const aliases: string[] = [];
  const columns: AnyColumnBuilder[] = [];

  for (const [key, value] of Object.entries(projection)) {
    const path = [...currentPath, key];

    if (isColumnBuilder(value)) {
      const alias = tracker.register(path);
      aliases.push(alias);
      columns.push(value);
    } else if (typeof value === 'object' && value !== null) {
      const nested = flattenProjection(value, tracker, path);
      aliases.push(...nested.aliases);
      columns.push(...nested.columns);
    } else {
      throw planInvalid(
        `Invalid projection value at path ${path.join('.')}: expected ColumnBuilder or nested object`,
      );
    }
  }

  return { aliases, columns };
}

interface IncludeState {
  readonly alias: string;
  readonly table: TableRef;
  readonly on: JoinOnPredicate;
  readonly childProjection: ProjectionState;
  readonly childWhere?: AnyBinaryBuilder;
  readonly childOrderBy?: AnyOrderBuilder;
  readonly childLimit?: number;
}

function buildProjectionState(
  _table: TableRef,
  projection: ProjectionInput,
  includes?: ReadonlyArray<IncludeState>,
): ProjectionState {
  const tracker = new AliasTracker();
  const aliases: string[] = [];
  const columns: AnyColumnBuilder[] = [];

  for (const [key, value] of Object.entries(projection)) {
    if (value === true) {
      const matchingInclude = includes?.find((inc) => inc.alias === key);
      if (!matchingInclude) {
        throw planInvalid(
          `Include alias "${key}" not found. Did you call includeMany() with alias "${key}"?`,
        );
      }
      aliases.push(key);
      columns.push({
        kind: 'column',
        table: matchingInclude.table.name,
        column: '',
        columnMeta: { type: 'core/json@1', nullable: true },
      } as AnyColumnBuilder);
    } else if (isColumnBuilder(value)) {
      const alias = tracker.register([key]);
      aliases.push(alias);
      columns.push(value);
    } else if (typeof value === 'object' && value !== null) {
      const nested = flattenProjection(value as NestedProjection, tracker, [key]);
      aliases.push(...nested.aliases);
      columns.push(...nested.columns);
    } else {
      throw planInvalid(
        `Invalid projection value at key "${key}": expected ColumnBuilder, boolean true (for includes), or nested object`,
      );
    }
  }

  if (aliases.length === 0) {
    throw planInvalid('select() requires at least one column or include');
  }

  return { aliases, columns };
}

interface MetaBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly table: TableRef;
  readonly projection: ProjectionState;
  readonly includes?: ReadonlyArray<IncludeState>;
  readonly where?: BinaryBuilder;
  readonly orderBy?: AnyOrderBuilder;
  readonly paramDescriptors: ParamDescriptor[];
  readonly paramCodecs?: Record<string, string>;
}

function buildMeta(args: MetaBuildArgs): PlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();
  const refsTables = new Set<string>([args.table.name]);

  for (const column of args.projection.columns) {
    const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      const allRefs = collectColumnRefs(operationExpr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      const col = column as unknown as { table?: string; column?: string };
      if (col.table && col.column) {
        refsColumns.set(`${col.table}.${col.column}`, {
          table: col.table,
          column: col.column,
        });
      }
    }
  }

  if (args.includes) {
    for (const include of args.includes) {
      refsTables.add(include.table.name);
      const onLeft = include.on.left as unknown as { table: string; column: string };
      const onRight = include.on.right as unknown as { table: string; column: string };
      if (onLeft.table && onLeft.column && onRight.table && onRight.column) {
        refsColumns.set(`${onLeft.table}.${onLeft.column}`, {
          table: onLeft.table,
          column: onLeft.column,
        });
        refsColumns.set(`${onRight.table}.${onRight.column}`, {
          table: onRight.table,
          column: onRight.column,
        });
      }
      for (const column of include.childProjection.columns) {
        const col = column as unknown as { table?: string; column?: string };
        if (col.table && col.column) {
          refsColumns.set(`${col.table}.${col.column}`, {
            table: col.table,
            column: col.column,
          });
        }
      }
      if (include.childWhere) {
        const colInfo = getColumnInfo(include.childWhere.left);
        refsColumns.set(`${colInfo.table}.${colInfo.column}`, {
          table: colInfo.table,
          column: colInfo.column,
        });
      }
      if (include.childOrderBy) {
        const orderBy = include.childOrderBy as unknown as {
          expr?: AnyColumnBuilder | OperationExpr;
        };
        if (orderBy.expr) {
          const colInfo = getColumnInfo(orderBy.expr);
          refsColumns.set(`${colInfo.table}.${colInfo.column}`, {
            table: colInfo.table,
            column: colInfo.column,
          });
        }
      }
    }
  }

  if (args.where) {
    const whereLeft = args.where.left;
    const operationExpr = (whereLeft as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      const allRefs = collectColumnRefs(operationExpr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      const colBuilder = whereLeft as unknown as { table?: string; column?: string };
      if (colBuilder.table && colBuilder.column) {
        refsColumns.set(`${colBuilder.table}.${colBuilder.column}`, {
          table: colBuilder.table,
          column: colBuilder.column,
        });
      }
    }
  }

  if (args.orderBy) {
    const orderBy = args.orderBy as unknown as {
      expr?: AnyColumnBuilder | OperationExpr;
    };
    const orderByExpr = orderBy.expr;
    if (orderByExpr) {
      if (isOperationExpr(orderByExpr)) {
        const allRefs = collectColumnRefs(orderByExpr);
        for (const ref of allRefs) {
          refsColumns.set(`${ref.table}.${ref.column}`, {
            table: ref.table,
            column: ref.column,
          });
        }
      } else {
        const colBuilder = orderByExpr as unknown as { table?: string; column?: string };
        if (colBuilder.table && colBuilder.column) {
          refsColumns.set(`${colBuilder.table}.${colBuilder.column}`, {
            table: colBuilder.table,
            column: colBuilder.column,
          });
        }
      }
    }
  }

  const includeAliases = new Set(args.includes?.map((inc) => inc.alias) ?? []);
  const projectionMap = Object.fromEntries(
    args.projection.aliases.map((alias, index) => {
      if (includeAliases.has(alias)) {
        return [alias, `include:${alias}`];
      }
      const column = args.projection.columns[index];
      if (!column) {
        throw planInvalid(`Missing column for alias ${alias} at index ${index}`);
      }
      const col = column as unknown as {
        table?: string;
        column?: string;
        _operationExpr?: OperationExpr;
      };
      if (!col.table || !col.column) {
        return [alias, `include:${alias}`];
      }
      const operationExpr = col._operationExpr;
      if (operationExpr) {
        return [alias, `operation:${operationExpr.method}`];
      }
      return [alias, `${col.table}.${col.column}`];
    }),
  );

  const projectionTypes: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    if (!alias || includeAliases.has(alias)) {
      continue;
    }
    const column = args.projection.columns[i];
    if (!column) {
      continue;
    }
    const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      if (operationExpr.returns.kind === 'typeId') {
        projectionTypes[alias] = operationExpr.returns.type;
      } else if (operationExpr.returns.kind === 'builtin') {
        projectionTypes[alias] = operationExpr.returns.type;
      }
    } else {
      const col = column as unknown as { columnMeta?: { type?: string } };
      const columnMeta = col.columnMeta;
      if (columnMeta?.type) {
        projectionTypes[alias] = columnMeta.type;
      }
    }
  }

  const projectionCodecs: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    if (!alias || includeAliases.has(alias)) {
      continue;
    }
    const column = args.projection.columns[i];
    if (!column) {
      continue;
    }
    const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      if (operationExpr.returns.kind === 'typeId') {
        projectionCodecs[alias] = operationExpr.returns.type;
      }
    } else {
      const col = column as unknown as { columnMeta?: { type?: string } };
      const columnMeta = col.columnMeta;
      if (columnMeta?.type) {
        projectionCodecs[alias] = columnMeta.type;
      }
    }
  }

  const allCodecs: Record<string, string> = {
    ...projectionCodecs,
    ...(args.paramCodecs ? args.paramCodecs : {}),
  };

  return Object.freeze({
    target: args.contract.target,
    ...(args.contract.targetFamily ? { targetFamily: args.contract.targetFamily } : {}),
    coreHash: args.contract.coreHash,
    lane: 'dsl',
    refs: {
      tables: Array.from(refsTables),
      columns: Array.from(refsColumns.values()),
    },
    projection: projectionMap,
    ...(Object.keys(projectionTypes).length > 0 ? { projectionTypes } : {}),
    ...(Object.keys(allCodecs).length > 0
      ? { annotations: Object.freeze({ codecs: Object.freeze(allCodecs) }) }
      : {}),
    paramDescriptors: args.paramDescriptors,
    ...(args.contract.profileHash !== undefined ? { profileHash: args.contract.profileHash } : {}),
  } satisfies PlanMeta);
}

function buildWhereExpr(
  where: BinaryBuilder,
  contract: SqlContract<SqlStorage>,
  paramsMap: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  values: unknown[],
): {
  expr: BinaryExpr;
  codecId?: string;
  paramName: string;
} {
  const placeholder = where.right;
  const paramName = placeholder.name;

  if (!Object.hasOwn(paramsMap, paramName)) {
    throw planInvalid(`Missing value for parameter ${paramName}`);
  }

  const value = paramsMap[paramName];
  const index = values.push(value);

  let leftExpr: ColumnRef | OperationExpr;
  let codecId: string | undefined;

  const operationExpr = (where.left as { _operationExpr?: OperationExpr })._operationExpr;
  if (operationExpr) {
    leftExpr = operationExpr;
  } else {
    const colBuilder = where.left as unknown as {
      table: string;
      column: string;
      columnMeta?: { type?: string; nullable?: boolean };
    };
    const meta = (colBuilder.columnMeta ?? {}) as { type?: string; nullable?: boolean };

    descriptors.push({
      name: paramName,
      source: 'dsl',
      refs: { table: colBuilder.table, column: colBuilder.column },
      ...(typeof meta.type === 'string' ? { type: meta.type } : {}),
      ...(typeof meta.nullable === 'boolean' ? { nullable: meta.nullable } : {}),
    });

    const contractTable = contract.storage.tables[colBuilder.table];
    const columnMeta = contractTable?.columns[colBuilder.column];
    codecId = columnMeta?.type;

    leftExpr = createColumnRef(colBuilder.table, colBuilder.column);
  }

  return {
    expr: createBinaryExpr('eq', leftExpr, createParamRef(index, paramName)),
    ...(codecId ? { codecId } : {}),
    paramName,
  };
}
