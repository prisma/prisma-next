import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  IncludeAst,
  OperationExpr,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createJoinOnExpr,
  createOrderByItem,
  createTableRef,
} from '@prisma-next/sql-relational-core/ast';
import { extractBaseColumnRef, isOperationExpr } from '@prisma-next/sql-relational-core/guards';
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
  private readonly codecTypes: CodecTypes;
  private readonly table: TableRef;
  private childProjection?: ProjectionState;
  private childWhere?: BinaryBuilder;
  private childOrderBy?: OrderBuilder;
  private childLimit?: number;

  constructor(contract: TContract, codecTypes: CodecTypes, table: TableRef) {
    this.contract = contract;
    this.codecTypes = codecTypes;
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
    >(this.contract, this.codecTypes, this.table);
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
      this.codecTypes,
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
      this.codecTypes,
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
      this.codecTypes,
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

export function buildIncludeAst(
  include: IncludeState,
  contract: SqlContract<SqlStorage>,
  paramsMap: Record<string, unknown>,
  paramDescriptors: ParamDescriptor[],
  paramValues: unknown[],
): IncludeAst {
  const childOrderBy = include.childOrderBy
    ? (() => {
        const orderBy = include.childOrderBy as OrderBuilder<string, StorageColumn, unknown>;
        const orderExpr = orderBy.expr;
        const expr: ColumnRef | OperationExpr = (() => {
          if (isOperationExpr(orderExpr)) {
            const baseCol = extractBaseColumnRef(orderExpr);
            return createColumnRef(baseCol.table, baseCol.column);
          }
          // orderExpr is ColumnBuilder - TypeScript can't narrow properly
          const colBuilder = orderExpr as { table: string; column: string };
          return createColumnRef(colBuilder.table, colBuilder.column);
        })();
        return [createOrderByItem(expr, orderBy.dir)];
      })()
    : undefined;

  let childWhere: BinaryExpr | undefined;
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
  const leftCol = createColumnRef(onLeft.table, onLeft.column);
  const rightCol = createColumnRef(onRight.table, onRight.column);
  const onExpr = createJoinOnExpr(leftCol, rightCol);

  return {
    kind: 'includeMany' as const,
    alias: include.alias,
    child: {
      table: createTableRef(include.table.name),
      on: onExpr,
      ...(childWhere ? { where: childWhere } : {}),
      ...(childOrderBy ? { orderBy: childOrderBy } : {}),
      ...(typeof include.childLimit === 'number' ? { limit: include.childLimit } : {}),
      project: include.childProjection.aliases.map((alias, idx) => {
        const column = include.childProjection.columns[idx];
        if (!column || !alias) {
          errorMissingColumnForAlias(alias ?? 'unknown', idx);
        }

        return {
          alias,
          expr: column.toExpr(),
        };
      }),
    },
  };
}
