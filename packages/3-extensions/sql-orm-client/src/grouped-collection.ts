import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { BinaryOp, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { mapStorageRowToModelFields } from './collection-runtime';
import {
  compileGroupedAggregate,
  compileHavingMetricColumn,
  GROUPED_HAVING_TABLE,
} from './kysely-compiler';
import { combineWhereFilters } from './kysely-compiler-where';
import { executeCompiledQuery } from './raw-compiled-query';
import type {
  AggregateBuilder,
  AggregateResult,
  AggregateSpec,
  CollectionContext,
  DefaultModelRow,
  HavingBuilder,
  HavingComparisonMethods,
} from './types';

interface GroupedCollectionInit {
  readonly tableName: string;
  readonly baseFilters: readonly WhereExpr[];
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly WhereExpr[];
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
  readonly baseFilters: readonly WhereExpr[];
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly WhereExpr[];

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
    predicate: (having: HavingBuilder<TContract, ModelName>) => WhereExpr,
  ): GroupedCollection<TContract, ModelName, GroupFields> {
    const havingExpr = predicate(createHavingBuilder(this.ctx.contract, this.modelName));
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
      this.tableName,
      this.baseFilters,
      this.groupByColumns,
      aggregateSpec,
      combineWhereFilters(this.havingFilters),
    );
    const rows = await executeCompiledQuery<Record<string, unknown>>(
      this.ctx.runtime,
      this.ctx.contract,
      compiled,
      { lane: 'orm-client' },
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
): HavingBuilder<TContract, ModelName> {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
  return {
    count() {
      return createHavingComparisonMethods('count');
    },
    sum(field) {
      const fieldName = field as string;
      return createHavingComparisonMethods(
        compileHavingMetricColumn('sum', fieldToColumn[fieldName] ?? fieldName),
      );
    },
    avg(field) {
      const fieldName = field as string;
      return createHavingComparisonMethods(
        compileHavingMetricColumn('avg', fieldToColumn[fieldName] ?? fieldName),
      );
    },
    min(field) {
      const fieldName = field as string;
      return createHavingComparisonMethods(
        compileHavingMetricColumn('min', fieldToColumn[fieldName] ?? fieldName),
      );
    },
    max(field) {
      const fieldName = field as string;
      return createHavingComparisonMethods(
        compileHavingMetricColumn('max', fieldToColumn[fieldName] ?? fieldName),
      );
    },
  };
}

function createHavingComparisonMethods(metric: string): HavingComparisonMethods<number | null> {
  const buildBinaryExpr = (op: BinaryOp, value: unknown): WhereExpr => ({
    kind: 'bin',
    op,
    left: {
      kind: 'col',
      table: GROUPED_HAVING_TABLE,
      column: metric,
    },
    right: {
      kind: 'literal',
      value,
    },
  });

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
