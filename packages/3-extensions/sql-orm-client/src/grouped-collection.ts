import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  type AnyExpression,
  BinaryExpr,
  type BinaryOp,
  ColumnRef,
  LiteralExpr,
} from '@prisma-next/sql-relational-core/ast';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { mapStorageRowToModelFields } from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import { compileGroupedAggregate } from './query-plan';
import type {
  AggregateBuilder,
  AggregateResult,
  AggregateSpec,
  CollectionContext,
  DefaultModelRow,
  HavingBuilder,
  HavingComparisonMethods,
} from './types';
import { combineWhereExprs } from './where-utils';

interface GroupedCollectionInit {
  readonly tableName: string;
  readonly baseFilters: readonly AnyWhereExpr[];
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly AnyExpression[];
}

type GroupByFieldName<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
> = keyof DefaultModelRow<TContract, ModelName> & string;

export class GroupedCollection<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
  GroupFields extends readonly GroupByFieldName<TContract, ModelName>[],
> {
  readonly ctx: CollectionContext<TContract>;
  readonly modelName: ModelName;
  readonly tableName: string;
  readonly baseFilters: readonly AnyWhereExpr[];
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly AnyExpression[];

  constructor(
    ctx: CollectionContext<TContract>,
    modelName: ModelName,
    options: GroupedCollectionInit,
  ) {
    this.ctx = ctx;
    this.modelName = modelName;
    this.tableName = options.tableName;
    this.baseFilters = options.baseFilters;
    this.groupByFields = options.groupByFields;
    this.groupByColumns = options.groupByColumns;
    this.havingFilters = options.havingFilters;
  }

  having(
    predicate: (having: HavingBuilder<TContract, ModelName>) => AnyExpression,
  ): GroupedCollection<TContract, ModelName, GroupFields> {
    const havingExpr = predicate(
      createHavingBuilder(this.ctx.contract, this.modelName, this.tableName),
    );
    return new GroupedCollection(this.ctx, this.modelName, {
      tableName: this.tableName,
      baseFilters: this.baseFilters,
      groupByFields: this.groupByFields,
      groupByColumns: this.groupByColumns,
      havingFilters: [...this.havingFilters, havingExpr],
    }) as GroupedCollection<TContract, ModelName, GroupFields>;
  }

  async aggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName>) => Spec,
  ): Promise<
    Array<Pick<DefaultModelRow<TContract, ModelName>, GroupFields[number]> & AggregateResult<Spec>>
  > {
    const aggregateSpec = fn(createAggregateBuilder(this.ctx.contract, this.modelName));
    const aggregateEntries = Object.entries(aggregateSpec);
    if (aggregateEntries.length === 0) {
      throw new Error('groupBy().aggregate() requires at least one aggregation selector');
    }

    for (const [alias, selector] of aggregateEntries) {
      if (!isAggregateSelector(selector)) {
        throw new Error(`groupBy().aggregate() selector "${alias}" is invalid`);
      }
    }

    const compiled = compileGroupedAggregate(
      this.ctx.contract,
      this.tableName,
      this.baseFilters,
      this.groupByColumns,
      aggregateSpec,
      combineWhereExprs(this.havingFilters),
    );
    const rows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      compiled,
    ).toArray();

    return rows.map((row) => {
      const mapped = mapStorageRowToModelFields(this.ctx.contract, this.tableName, row);
      for (const [alias, selector] of aggregateEntries) {
        mapped[alias] = coerceAggregateValue(selector.fn, row[alias]);
      }
      return mapped;
    }) as Array<
      Pick<DefaultModelRow<TContract, ModelName>, GroupFields[number]> & AggregateResult<Spec>
    >;
  }
}

function createHavingBuilder<TContract extends SqlContract<SqlStorage>, ModelName extends string>(
  contract: TContract,
  modelName: ModelName,
  tableName: string,
): HavingBuilder<TContract, ModelName> {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
  const createMetricExpr = (
    fn: Exclude<AggregateExpr['fn'], 'count'>,
    fieldName: string,
  ): AggregateExpr =>
    new AggregateExpr(fn, ColumnRef.of(tableName, fieldToColumn[fieldName] ?? fieldName));

  return {
    count() {
      return createHavingComparisonMethods<number>(AggregateExpr.count());
    },
    sum(field) {
      return createHavingComparisonMethods<number | null>(createMetricExpr('sum', field as string));
    },
    avg(field) {
      return createHavingComparisonMethods<number | null>(createMetricExpr('avg', field as string));
    },
    min(field) {
      return createHavingComparisonMethods<number | null>(createMetricExpr('min', field as string));
    },
    max(field) {
      return createHavingComparisonMethods<number | null>(createMetricExpr('max', field as string));
    },
  };
}

function createHavingComparisonMethods<T extends number | null>(
  metric: AggregateExpr,
): HavingComparisonMethods<T> {
  const buildBinaryExpr = (op: BinaryOp, value: unknown): AnyExpression =>
    new BinaryExpr(op, metric, LiteralExpr.of(value));

  return {
    eq(value) {
      return buildBinaryExpr('eq', value);
    },
    neq(value) {
      return buildBinaryExpr('neq', value);
    },
    gt(value) {
      return buildBinaryExpr('gt', value);
    },
    lt(value) {
      return buildBinaryExpr('lt', value);
    },
    gte(value) {
      return buildBinaryExpr('gte', value);
    },
    lte(value) {
      return buildBinaryExpr('lte', value);
    },
  };
}

function coerceAggregateValue(fn: string, value: unknown): unknown {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return fn === 'count' ? 0 : null;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
  }

  return value;
}
