import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  Expression,
  JoinAst,
  ProjectionItem,
  TableRef,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  createAndExpr,
  createBinaryExpr,
  createColumnRef,
  createDerivedTableSource,
  createJoin,
  createJsonAggExpr,
  createJsonBuildObjectExpr,
  createOrderByItem,
  createProjectionItem,
  createSelectAstBuilder,
  createTableSource,
  createTrueExpr,
} from '@prisma-next/sql-relational-core/ast';
import type {
  AnyBinaryBuilder,
  AnyOrderBuilder,
  BinaryBuilder,
  CodecTypes as CodecTypesMap,
  InferNestedProjectionRow,
  NestedProjection,
  OrderBuilder,
} from '@prisma-next/sql-relational-core/types';
import { isOperationExpr } from '@prisma-next/sql-relational-core/utils/guards';
import {
  errorChildProjectionMustBeSpecified,
  errorLimitMustBeNonNegativeInteger,
  errorMissingColumnForAlias,
} from '../utils/errors';
import type { IncludeState, ProjectionState } from '../utils/state';
import { buildWhereExpr } from './predicate-builder';
import { buildProjectionState } from './projection';

export interface IncludeChildBuilder<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { readonly output: unknown }> = Record<string, never>,
  ChildRow = unknown,
> {
  select<P extends NestedProjection>(
    projection: P,
  ): IncludeChildBuilder<TContract, CodecTypes, InferNestedProjectionRow<P, CodecTypes>>;
  where(expr: AnyBinaryBuilder): IncludeChildBuilder<TContract, CodecTypes, ChildRow>;
  orderBy(order: AnyOrderBuilder): IncludeChildBuilder<TContract, CodecTypes, ChildRow>;
  limit(count: number): IncludeChildBuilder<TContract, CodecTypes, ChildRow>;
}

export class IncludeChildBuilderImpl<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  CodecTypes extends CodecTypesMap = CodecTypesMap,
  ChildRow = unknown,
> implements IncludeChildBuilder<TContract, CodecTypes, ChildRow>
{
  private readonly contract: TContract;
  private readonly table: TableRef;
  private childProjection?: ProjectionState;
  private childWhere?: BinaryBuilder;
  private childOrderBy?: OrderBuilder;
  private childLimit?: number;

  constructor(contract: TContract, table: TableRef) {
    this.contract = contract;
    this.table = table;
  }

  select<P extends NestedProjection>(
    projection: P,
  ): IncludeChildBuilderImpl<TContract, CodecTypes, InferNestedProjectionRow<P, CodecTypes>> {
    const projectionState = buildProjectionState(this.table, projection);
    const builder = new IncludeChildBuilderImpl<
      TContract,
      CodecTypes,
      InferNestedProjectionRow<P, CodecTypes>
    >(this.contract, this.table);
    builder.childProjection = projectionState;
    if (this.childWhere !== undefined) {
      builder.childWhere = this.childWhere;
    }
    if (this.childOrderBy !== undefined) {
      builder.childOrderBy = this.childOrderBy;
    }
    if (this.childLimit !== undefined) {
      builder.childLimit = this.childLimit;
    }
    return builder;
  }

  where(expr: AnyBinaryBuilder): IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow> {
    const builder = new IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>(
      this.contract,
      this.table,
    );
    if (this.childProjection !== undefined) {
      builder.childProjection = this.childProjection;
    }
    builder.childWhere = expr;
    if (this.childOrderBy !== undefined) {
      builder.childOrderBy = this.childOrderBy;
    }
    if (this.childLimit !== undefined) {
      builder.childLimit = this.childLimit;
    }
    return builder;
  }

  orderBy(order: AnyOrderBuilder): IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow> {
    const builder = new IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>(
      this.contract,
      this.table,
    );
    if (this.childProjection !== undefined) {
      builder.childProjection = this.childProjection;
    }
    if (this.childWhere !== undefined) {
      builder.childWhere = this.childWhere;
    }
    builder.childOrderBy = order;
    if (this.childLimit !== undefined) {
      builder.childLimit = this.childLimit;
    }
    return builder;
  }

  limit(count: number): IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow> {
    if (!Number.isInteger(count) || count < 0) {
      errorLimitMustBeNonNegativeInteger();
    }

    const builder = new IncludeChildBuilderImpl<TContract, CodecTypes, ChildRow>(
      this.contract,
      this.table,
    );
    if (this.childProjection !== undefined) {
      builder.childProjection = this.childProjection;
    }
    if (this.childWhere !== undefined) {
      builder.childWhere = this.childWhere;
    }
    if (this.childOrderBy !== undefined) {
      builder.childOrderBy = this.childOrderBy;
    }
    builder.childLimit = count;
    return builder;
  }

  getState(): {
    childProjection: ProjectionState;
    childWhere?: AnyBinaryBuilder;
    childOrderBy?: AnyOrderBuilder;
    childLimit?: number;
  } {
    if (!this.childProjection) {
      errorChildProjectionMustBeSpecified();
    }
    const state: {
      childProjection: ProjectionState;
      childWhere?: AnyBinaryBuilder;
      childOrderBy?: AnyOrderBuilder;
      childLimit?: number;
    } = {
      childProjection: this.childProjection,
    };
    if (this.childWhere !== undefined) {
      state.childWhere = this.childWhere;
    }
    if (this.childOrderBy !== undefined) {
      state.childOrderBy = this.childOrderBy;
    }
    if (this.childLimit !== undefined) {
      state.childLimit = this.childLimit;
    }
    return state;
  }
}

function buildIncludeOrderArtifacts(
  include: IncludeState,
  rowsAlias: string,
): {
  readonly childOrderBy: ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }> | undefined;
} {
  const childOrderBy = include.childOrderBy
    ? (() => {
        const orderBy = include.childOrderBy as OrderBuilder<string, StorageColumn, unknown>;
        const orderExpr = orderBy.expr;
        const expr = (() => {
          if (isOperationExpr(orderExpr)) {
            return orderExpr;
          }
          const colBuilder = orderExpr as { table: string; column: string };
          return createColumnRef(colBuilder.table, colBuilder.column);
        })();
        return [createOrderByItem(expr, orderBy.dir)];
      })()
    : undefined;

  if (!childOrderBy || childOrderBy.length === 0) {
    return {
      childOrderBy: undefined,
      hiddenOrderProjection: [],
      aggregateOrderBy: undefined,
    };
  }

  const hiddenOrderProjection = childOrderBy.map((orderItem, index) =>
    createProjectionItem(`${include.alias}__order_${index}`, orderItem.expr),
  );
  const aggregateOrderBy = hiddenOrderProjection.map((projection, index) => {
    const orderItem = childOrderBy[index];
    if (!orderItem) {
      throw new Error(`Missing include order metadata at index ${index}`);
    }
    return createOrderByItem(createColumnRef(rowsAlias, projection.alias), orderItem.dir);
  });

  return {
    childOrderBy,
    hiddenOrderProjection,
    aggregateOrderBy,
  };
}

function buildChildProjectionItems(include: IncludeState): ProjectionItem[] {
  return include.childProjection.aliases.map((alias, idx) => {
    const column = include.childProjection.columns[idx];
    if (!column || !alias) {
      errorMissingColumnForAlias(alias ?? 'unknown', idx);
    }
    return createProjectionItem(alias, column.toExpr());
  });
}

export interface IncludeJoinArtifact {
  readonly join: JoinAst;
  readonly projection: ProjectionItem;
}

export function buildIncludeJoinArtifact(
  include: IncludeState,
  contract: SqlContract<SqlStorage>,
  paramsMap: Record<string, unknown>,
  paramDescriptors: ParamDescriptor[],
  paramValues: unknown[],
): IncludeJoinArtifact {
  let childWhere: WhereExpr | undefined;
  if (include.childWhere) {
    const whereResult = buildWhereExpr(
      contract,
      include.childWhere,
      paramsMap,
      paramDescriptors,
      paramValues,
    );
    childWhere = whereResult.expr;
  }

  const onLeft = include.on.left as { table: string; column: string };
  const onRight = include.on.right as { table: string; column: string };
  const onExpr = createBinaryExpr(
    'eq',
    createColumnRef(onLeft.table, onLeft.column),
    createColumnRef(onRight.table, onRight.column),
  );
  const rowsWhere = childWhere ? createAndExpr([onExpr, childWhere]) : onExpr;

  const childProjectItems = buildChildProjectionItems(include);
  const rowsAlias = `${include.alias}__rows`;
  const { childOrderBy, hiddenOrderProjection, aggregateOrderBy } = buildIncludeOrderArtifacts(
    include,
    rowsAlias,
  );
  const childRowsBuilder = createSelectAstBuilder(
    createTableSource(include.table.name, include.table.alias),
  ).project([...childProjectItems, ...hiddenOrderProjection]);
  childRowsBuilder.where(rowsWhere);
  if (childOrderBy) {
    childRowsBuilder.orderBy(childOrderBy);
  }
  if (typeof include.childLimit === 'number') {
    childRowsBuilder.limit(include.childLimit);
  }

  const aggregatedAlias = `${include.alias}_lateral`;
  const jsonObjectExpr = createJsonBuildObjectExpr(rowsAlias, childProjectItems);
  const jsonAggExpr = createJsonAggExpr(jsonObjectExpr, aggregateOrderBy);

  const aggregateSelect = createSelectAstBuilder(
    createDerivedTableSource(rowsAlias, childRowsBuilder.build()),
  )
    .project([createProjectionItem(include.alias, jsonAggExpr)])
    .build();

  return {
    join: createJoin(
      'left',
      createDerivedTableSource(aggregatedAlias, aggregateSelect),
      createTrueExpr(),
      true,
    ),
    projection: createProjectionItem(
      include.alias,
      createColumnRef(aggregatedAlias, include.alias),
    ),
  };
}
