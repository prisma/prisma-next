import type { Contract } from '@prisma-next/contract/types';
import type {
  AnnotationValue,
  OperationKind,
  ValidAnnotations,
} from '@prisma-next/framework-components/runtime';
import { assertAnnotationsApplicable } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  type AnyExpression,
  BinaryExpr,
  type BinaryOp,
  ColumnRef,
  LiteralExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { SimplifyDeep } from '@prisma-next/utils/simplify-deep';
import { createAggregateBuilder, isAggregateSelector } from './aggregate-builder';
import { getFieldToColumnMap } from './collection-contract';
import { mapStorageRowToModelFields } from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import { compileGroupedAggregate, mergeUserAnnotations } from './query-plan';
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
  readonly baseFilters: readonly AnyExpression[];
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly AnyExpression[];
}

type GroupByFieldName<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> = keyof DefaultModelRow<TContract, ModelName> & string;

export class GroupedCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  GroupFields extends readonly GroupByFieldName<TContract, ModelName>[],
> {
  readonly ctx: CollectionContext<TContract>;
  private readonly contract: TContract;
  readonly modelName: ModelName;
  readonly tableName: string;
  readonly baseFilters: readonly AnyExpression[];
  readonly groupByFields: readonly string[];
  readonly groupByColumns: readonly string[];
  readonly havingFilters: readonly AnyExpression[];

  constructor(
    ctx: CollectionContext<TContract>,
    modelName: ModelName,
    options: GroupedCollectionInit,
  ) {
    this.ctx = ctx;
    this.contract = ctx.context.contract;
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
      createHavingBuilder(this.contract, this.modelName, this.tableName),
    );
    return new GroupedCollection(this.ctx, this.modelName, {
      tableName: this.tableName,
      baseFilters: this.baseFilters,
      groupByFields: this.groupByFields,
      groupByColumns: this.groupByColumns,
      havingFilters: [...this.havingFilters, havingExpr],
    }) as GroupedCollection<TContract, ModelName, GroupFields>;
  }

  /**
   * Read terminal: run a grouped aggregate query.
   *
   * Accepts an optional variadic of read-typed user annotations after
   * the builder callback. The `As & ValidAnnotations<'read', As>` gate
   * rejects write-only annotations at the call site; the runtime check
   * fails closed for callers that bypass the type gate. Annotations
   * are merged into the compiled plan's `meta.annotations`.
   */
  async aggregate<
    Spec extends AggregateSpec,
    As extends readonly AnnotationValue<unknown, OperationKind>[],
  >(
    fn: (aggregate: AggregateBuilder<TContract, ModelName>) => Spec,
    ...annotations: As & ValidAnnotations<'read', As>
  ): Promise<
    Array<
      SimplifyDeep<
        Pick<DefaultModelRow<TContract, ModelName>, GroupFields[number]> & AggregateResult<Spec>
      >
    >
  > {
    const aggregateSpec = fn(createAggregateBuilder(this.contract, this.modelName));
    const aggregateEntries = Object.entries(aggregateSpec);
    if (aggregateEntries.length === 0) {
      throw new Error('groupBy().aggregate() requires at least one aggregation selector');
    }

    for (const [alias, selector] of aggregateEntries) {
      if (!isAggregateSelector(selector)) {
        throw new Error(`groupBy().aggregate() selector "${alias}" is invalid`);
      }
    }

    const annotationsAsValues = annotations as readonly AnnotationValue<unknown, OperationKind>[];
    let annotationsMap: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined;
    if (annotationsAsValues.length > 0) {
      assertAnnotationsApplicable(annotationsAsValues, 'read', 'groupBy.aggregate');
      const next = new Map<string, AnnotationValue<unknown, OperationKind>>();
      for (const annotation of annotationsAsValues) {
        next.set(annotation.namespace, annotation);
      }
      annotationsMap = next;
    }

    const compiled = mergeUserAnnotations(
      compileGroupedAggregate(
        this.contract,
        this.tableName,
        this.baseFilters,
        this.groupByColumns,
        aggregateSpec,
        combineWhereExprs(this.havingFilters),
      ),
      annotationsMap,
    );
    const rows = await executeQueryPlan<Record<string, unknown>>(
      this.ctx.runtime,
      compiled,
    ).toArray();

    return rows.map((row) => {
      const mapped = mapStorageRowToModelFields(this.contract, this.modelName, row);
      for (const [alias, selector] of aggregateEntries) {
        mapped[alias] = coerceAggregateValue(selector.fn, row[alias]);
      }
      return mapped;
    }) as Array<
      SimplifyDeep<
        Pick<DefaultModelRow<TContract, ModelName>, GroupFields[number]> & AggregateResult<Spec>
      >
    >;
  }
}

function createHavingBuilder<TContract extends Contract<SqlStorage>, ModelName extends string>(
  contract: TContract,
  modelName: ModelName,
  tableName: string,
): HavingBuilder<TContract, ModelName> {
  const fieldToColumn = getFieldToColumnMap(contract, modelName);
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
