import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import {
  createJoinOnBuilder,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  type TableRef,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type {
  AnyBinaryBuilder,
  AnyOrderBuilder,
  AnyUnaryBuilder,
  BinaryBuilder,
  BuildOptions,
  InferNestedProjectionRow,
  JoinOnBuilder,
  JoinOnPredicate,
  NestedProjection,
  OrderBuilder,
  SqlBuilderOptions,
  UnaryBuilder,
} from '@prisma-next/sql-relational-core/types';
import { isExpressionBuilder } from '@prisma-next/sql-relational-core/utils/guards';
import type { ProjectionInput } from '../types/internal';
import { checkIncludeCapabilities } from '../utils/capabilities';
import {
  errorChildProjectionEmpty,
  errorFromMustBeCalled,
  errorIncludeAliasCollision,
  errorLimitMustBeNonNegativeInteger,
  errorMissingAlias,
  errorSelectMustBeCalled,
  errorSelfJoinNotSupported,
  errorUnknownTable,
} from '../utils/errors';
import type { BuilderState, IncludeState, JoinState, ProjectionState } from '../utils/state';
import {
  buildIncludeJoinArtifact,
  type IncludeChildBuilder,
  IncludeChildBuilderImpl,
} from './include-builder';
import { buildJoinAst } from './join-builder';
import { buildMeta } from './plan';
import { buildWhereExpr } from './predicate-builder';
import { buildProjectionState } from './projection';

function deriveParamsFromAst(ast: {
  collectParamRefs(): Array<{
    value: unknown;
    name: string | undefined;
    codecId: string | undefined;
  }>;
}) {
  const collected = ast.collectParamRefs();
  return {
    paramValues: collected.map((p) => p.value),
    paramDescriptors: collected.map((p) => ({
      ...(p.name !== undefined && { name: p.name }),
      source: 'dsl' as const,
      ...(p.codecId ? { codecId: p.codecId } : {}),
    })),
  };
}

export class SelectBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  Row = unknown,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  Includes extends Record<string, unknown> = Record<string, never>,
> {
  private readonly contract: TContract;
  private readonly context: ExecutionContext<TContract>;
  private state: BuilderState = {};

  constructor(options: SqlBuilderOptions<TContract>, state?: BuilderState) {
    this.context = options.context;
    this.contract = options.context.contract;
    if (state) {
      this.state = state;
    }
  }

  from(table: TableRef): SelectBuilderImpl<TContract, unknown, CodecTypes, Record<string, never>> {
    return new SelectBuilderImpl<TContract, unknown, CodecTypes, Record<string, never>>(
      {
        context: this.context,
      },
      { ...this.state, from: table },
    );
  }

  innerJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('inner', table, on);
  }

  leftJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('left', table, on);
  }

  rightJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('right', table, on);
  }

  fullJoin(
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return this._addJoin('full', table, on);
  }

  includeMany<
    ChildProjection extends NestedProjection,
    ChildRow = InferNestedProjectionRow<ChildProjection, CodecTypes>,
    AliasName extends string = string,
  >(
    childTable: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
    childBuilder: (
      child: IncludeChildBuilder<TContract, CodecTypes, unknown>,
    ) => IncludeChildBuilder<TContract, CodecTypes, ChildRow>,
    options?: { alias?: AliasName },
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes & { [K in AliasName]: ChildRow }> {
    checkIncludeCapabilities(this.contract);

    if (!this.contract.storage.tables[childTable.name]) {
      errorUnknownTable(childTable.name);
    }

    const joinOnBuilder = createJoinOnBuilder();
    const onPredicate = on(joinOnBuilder);

    // Validate ON uses column equality
    // TypeScript can't narrow ColumnBuilder properly, so we assert
    const onLeft = onPredicate.left as { table: string; column: string };
    const onRight = onPredicate.right as { table: string; column: string };
    if (onLeft.table === onRight.table) {
      errorSelfJoinNotSupported();
    }

    // Build child builder
    const childBuilderImpl = new IncludeChildBuilderImpl<TContract, CodecTypes, unknown>(
      this.contract,
      childTable,
    );
    const builtChild = childBuilder(
      childBuilderImpl as IncludeChildBuilder<TContract, CodecTypes, unknown>,
    );
    const childState = (
      builtChild as IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>
    ).getState();

    // Validate child projection is non-empty
    if (childState.childProjection.aliases.length === 0) {
      errorChildProjectionEmpty();
    }

    // Determine alias
    const alias = options?.alias ?? childTable.name;

    // Check for alias collisions with existing projection
    if (this.state.projection) {
      if (this.state.projection.aliases.includes(alias)) {
        errorIncludeAliasCollision(alias, 'projection');
      }
    }

    // Check for alias collisions with existing includes
    const existingIncludes = this.state.includes ?? [];
    if (existingIncludes.some((inc) => inc.alias === alias)) {
      errorIncludeAliasCollision(alias, 'include');
    }

    const includeState: IncludeState = {
      alias,
      table: childTable,
      on: onPredicate,
      childProjection: childState.childProjection,
      ...(childState.childWhere !== undefined ? { childWhere: childState.childWhere } : {}),
      ...(childState.childOrderBy !== undefined ? { childOrderBy: childState.childOrderBy } : {}),
      ...(childState.childLimit !== undefined ? { childLimit: childState.childLimit } : {}),
    };

    const newIncludes = [...existingIncludes, includeState];

    // Type-level: Update Includes map with new include
    // The AliasName generic parameter is inferred from options.alias, allowing TypeScript
    // to track include definitions across multiple includeMany() calls and infer correct
    // array types when select() includes boolean true for include references
    type NewIncludes = Includes & { [K in AliasName]: ChildRow };

    return new SelectBuilderImpl<TContract, Row, CodecTypes, NewIncludes>(
      {
        context: this.context,
      },
      { ...this.state, includes: newIncludes },
    );
  }

  private _addJoin(
    joinType: 'inner' | 'left' | 'right' | 'full',
    table: TableRef,
    on: (on: JoinOnBuilder) => JoinOnPredicate,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    const fromTable = this.ensureFrom();

    if (!this.contract.storage.tables[table.name]) {
      errorUnknownTable(table.name);
    }

    if (table.name === fromTable.name) {
      errorSelfJoinNotSupported();
    }

    const joinOnBuilder = createJoinOnBuilder();
    const onPredicate = on(joinOnBuilder);

    const joinState: JoinState = {
      joinType,
      table,
      on: onPredicate,
    };

    const existingJoins = this.state.joins ?? [];
    const newJoins = [...existingJoins, joinState];

    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
      {
        context: this.context,
      },
      { ...this.state, joins: newJoins },
    );
  }

  where(
    expr: AnyBinaryBuilder | AnyUnaryBuilder,
  ): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
      {
        context: this.context,
      },
      { ...this.state, where: expr },
    );
  }

  select<P extends ProjectionInput>(
    projection: P,
  ): SelectBuilderImpl<
    TContract,
    InferNestedProjectionRow<P, CodecTypes, Includes>,
    CodecTypes,
    Includes
  > {
    const table = this.ensureFrom();
    const projectionState = buildProjectionState(table, projection, this.state.includes);

    return new SelectBuilderImpl<
      TContract,
      InferNestedProjectionRow<P, CodecTypes, Includes>,
      CodecTypes,
      Includes
    >(
      {
        context: this.context,
      },
      { ...this.state, projection: projectionState },
    );
  }

  orderBy(order: AnyOrderBuilder): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
      {
        context: this.context,
      },
      { ...this.state, orderBy: order },
    );
  }

  limit(count: number): SelectBuilderImpl<TContract, Row, CodecTypes, Includes> {
    if (!Number.isInteger(count) || count < 0) {
      errorLimitMustBeNonNegativeInteger();
    }

    return new SelectBuilderImpl<TContract, Row, CodecTypes, Includes>(
      {
        context: this.context,
      },
      { ...this.state, limit: count },
    );
  }

  build(options?: BuildOptions): SqlQueryPlan<Row> {
    const table = this.ensureFrom();
    const projection = this.ensureProjection();

    const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
    const contractTable = this.contract.storage.tables[table.name];

    if (!contractTable) {
      errorUnknownTable(table.name);
    }

    const paramCodecs: Record<string, string> = {};

    const whereResult = this.state.where
      ? buildWhereExpr(this.contract, this.state.where, paramsMap)
      : undefined;
    const whereExpr = whereResult?.expr;

    if (whereResult?.codecId && whereResult.paramName) {
      paramCodecs[whereResult.paramName] = whereResult.codecId;
    }

    const orderByClause = this.state.orderBy
      ? (() => {
          const orderBy = this.state.orderBy as OrderBuilder<string, StorageColumn, unknown>;
          return [new OrderByItem(orderBy.expr, orderBy.dir)];
        })()
      : undefined;

    const joins = this.state.joins?.map((join) => buildJoinAst(join)) ?? [];
    const includeArtifacts =
      this.state.includes?.map((include) =>
        buildIncludeJoinArtifact(include, this.contract, paramsMap),
      ) ?? [];
    const includeProjectionByAlias = new Map(
      includeArtifacts.map((artifact) => [artifact.projection.alias, artifact.projection]),
    );

    const projectEntries: ProjectionItem[] = [];
    for (let i = 0; i < projection.aliases.length; i++) {
      const alias = projection.aliases[i];
      if (!alias) {
        errorMissingAlias(i);
      }
      const column = projection.columns[i];

      const includeProjection = includeProjectionByAlias.get(alias);
      if (includeProjection) {
        projectEntries.push(includeProjection);
      } else if (column && isExpressionBuilder(column)) {
        projectEntries.push(ProjectionItem.of(alias, column.expr));
      } else if (column) {
        projectEntries.push(ProjectionItem.of(alias, column.toExpr()));
      }
    }

    let ast = SelectAst.from(TableSource.named(table.name, table.alias))
      .withProjection(projectEntries)
      .withWhere(whereExpr);
    const allJoins = [...joins, ...includeArtifacts.map((artifact) => artifact.join)];
    if (allJoins.length > 0) {
      ast = ast.withJoins(allJoins);
    }
    if (orderByClause) {
      ast = ast.withOrderBy(orderByClause);
    }
    if (this.state.limit !== undefined) {
      ast = ast.withLimit(this.state.limit);
    }

    const { paramValues, paramDescriptors } = deriveParamsFromAst(ast);

    const planMeta = buildMeta({
      contract: this.contract,
      table,
      projection,
      joins: this.state.joins,
      includes: this.state.includes,
      paramDescriptors,
      paramCodecs,
      where: this.state.where,
      orderBy: this.state.orderBy,
      limit: this.state.limit,
    } as {
      contract: SqlContract<SqlStorage>;
      table: TableRef;
      projection: ProjectionState;
      joins?: ReadonlyArray<JoinState>;
      includes?: ReadonlyArray<IncludeState>;
      where?: BinaryBuilder | UnaryBuilder;
      orderBy?: AnyOrderBuilder;
      limit?: number;
      paramDescriptors: typeof paramDescriptors;
      paramCodecs?: Record<string, string>;
    });

    const queryPlan: SqlQueryPlan<Row> = Object.freeze({
      ast,
      params: paramValues,
      meta: planMeta,
    });

    return queryPlan;
  }

  private ensureFrom() {
    if (!this.state.from) {
      errorFromMustBeCalled();
    }

    return this.state.from;
  }

  private ensureProjection() {
    if (!this.state.projection) {
      errorSelectMustBeCalled();
    }

    return this.state.projection;
  }
}
