import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  type TableRef,
  TableSource,
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
  readonly childOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  const childOrderBy = include.childOrderBy
    ? (() => {
        const orderBy = include.childOrderBy as OrderBuilder<string, StorageColumn, unknown>;
        return [new OrderByItem(orderBy.expr, orderBy.dir)];
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
    ProjectionItem.of(`${include.alias}__order_${index}`, orderItem.expr),
  );
  const aggregateOrderBy = hiddenOrderProjection.map((projection, index) => {
    const orderItem = childOrderBy[index];
    if (!orderItem) {
      throw new Error(`Missing include order metadata at index ${index}`);
    }
    return new OrderByItem(ColumnRef.of(rowsAlias, projection.alias), orderItem.dir);
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
    if (!column) {
      errorMissingColumnForAlias(alias, idx);
    }
    return ProjectionItem.of(alias, column.toExpr());
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
): IncludeJoinArtifact {
  let childWhere: AnyExpression | undefined;
  if (include.childWhere) {
    const whereResult = buildWhereExpr(contract, include.childWhere, paramsMap);
    childWhere = whereResult.expr;
  }

  const onLeft = include.on.left as { table: string; column: string };
  const onRight = include.on.right as { table: string; column: string };
  const onExpr = BinaryExpr.eq(
    ColumnRef.of(onLeft.table, onLeft.column),
    ColumnRef.of(onRight.table, onRight.column),
  );
  const rowsWhere = childWhere ? AndExpr.of([onExpr, childWhere]) : onExpr;

  const childProjectItems = buildChildProjectionItems(include);
  const rowsAlias = `${include.alias}__rows`;
  const { childOrderBy, hiddenOrderProjection, aggregateOrderBy } = buildIncludeOrderArtifacts(
    include,
    rowsAlias,
  );
  let childRowsAst = SelectAst.from(TableSource.named(include.table.name, include.table.alias))
    .withProjection([...childProjectItems, ...hiddenOrderProjection])
    .withWhere(rowsWhere);
  if (childOrderBy) {
    childRowsAst = childRowsAst.withOrderBy(childOrderBy);
  }
  if (typeof include.childLimit === 'number') {
    childRowsAst = childRowsAst.withLimit(include.childLimit);
  }

  const aggregatedAlias = `${include.alias}_lateral`;
  const jsonObjectExpr = JsonObjectExpr.fromEntries(
    childProjectItems.map((item) =>
      JsonObjectExpr.entry(item.alias, ColumnRef.of(rowsAlias, item.alias)),
    ),
  );
  const jsonAggExpr = JsonArrayAggExpr.of(jsonObjectExpr, 'emptyArray', aggregateOrderBy);

  const aggregateSelect = SelectAst.from(
    DerivedTableSource.as(rowsAlias, childRowsAst),
  ).withProjection([ProjectionItem.of(include.alias, jsonAggExpr)]);

  return {
    join: JoinAst.left(
      DerivedTableSource.as(aggregatedAlias, aggregateSelect),
      AndExpr.true(),
      true,
    ),
    projection: ProjectionItem.of(include.alias, ColumnRef.of(aggregatedAlias, include.alias)),
  };
}
