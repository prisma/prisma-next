import type { Contract } from '@prisma-next/contract/types';
import type {
  AnnotationBuilder,
  AnnotationValue,
  OperationKind,
} from '@prisma-next/framework-components/runtime';
import {
  ANNOTATION_BUILDER,
  assertAnnotationsApplicable,
  createAnnotationRegistry,
  createMetaBuilder,
} from '@prisma-next/framework-components/runtime';
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
  Registry = {},
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
  ): GroupedCollection<TContract, ModelName, GroupFields, Registry> {
    const havingExpr = predicate(
      createHavingBuilder(this.contract, this.modelName, this.tableName),
    );
    return new GroupedCollection(this.ctx, this.modelName, {
      tableName: this.tableName,
      baseFilters: this.baseFilters,
      groupByFields: this.groupByFields,
      groupByColumns: this.groupByColumns,
      havingFilters: [...this.havingFilters, havingExpr],
    }) as GroupedCollection<TContract, ModelName, GroupFields, Registry>;
  }

  /**
   * Read terminal: run a grouped aggregate query.
   *
   * Accepts an optional trailing `annotateFn` callback that receives a
   * kind-filtered `AnnotationBuilder<'read', Registry>` derived from
   * the runtime's middleware-contributed annotation registry. Returns
   * either the chained builder or a `readonly AnnotationValue[]` (the
   * array escape hatch). The runtime gate
   * `assertAnnotationsApplicable` catches cast-bypass.
   */
  async aggregate<Spec extends AggregateSpec>(
    fn: (aggregate: AggregateBuilder<TContract, ModelName>) => Spec,
    annotateFn?: (
      meta: AnnotationBuilder<'read', Registry>,
    ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[],
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

    const annotationsMap = resolveGroupedAnnotationsToMap(
      this.ctx,
      annotateFn,
      'read',
      'groupBy.aggregate',
    );

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

/**
 * Resolves a `GroupedCollection.aggregate(callback)` invocation into a
 * `userAnnotations` map ready for `mergeUserAnnotations`. Mirrors
 * `Collection`'s `#resolveAnnotationsToMap`. See `Collection` in
 * `./collection.ts` for the canonical pattern; the brand check is
 * inlined here because `sql-orm-client` does not depend on
 * `sql-builder` at runtime.
 */
function resolveGroupedAnnotationsToMap<Registry>(
  ctx: CollectionContext<Contract<SqlStorage>>,
  annotateFn:
    | ((
        meta: AnnotationBuilder<'read', Registry>,
      ) => AnnotationBuilder<'read', Registry> | readonly AnnotationValue<unknown, OperationKind>[])
    | undefined,
  kind: 'read',
  terminalName: string,
): ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined {
  if (annotateFn === undefined) {
    return undefined;
  }
  const registry = ctx.annotationRegistry ?? createAnnotationRegistry();
  const meta = createMetaBuilder<'read', Registry>(registry, kind);
  const result = annotateFn(meta);
  const values = extractAnnotationValuesFromCallback(result);
  if (values.length === 0) {
    return undefined;
  }
  assertAnnotationsApplicable(values, kind, terminalName);
  const next = new Map<string, AnnotationValue<unknown, OperationKind>>();
  for (const annotation of values) {
    next.set(annotation.namespace, annotation);
  }
  return next;
}

/**
 * Normalizes a callback return value into an array of `AnnotationValue`s.
 * Accepts either a branded `AnnotationBuilder` (read its `values`) or a
 * `readonly AnnotationValue[]` (use as-is).
 */
function extractAnnotationValuesFromCallback(
  result:
    | AnnotationBuilder<OperationKind, unknown>
    | readonly AnnotationValue<unknown, OperationKind>[],
): readonly AnnotationValue<unknown, OperationKind>[] {
  if (Array.isArray(result)) {
    return result;
  }
  if (result !== null && typeof result === 'object') {
    const candidate = result as Record<symbol, unknown>;
    if (candidate[ANNOTATION_BUILDER] === true) {
      return (result as AnnotationBuilder<OperationKind, unknown>).values;
    }
  }
  throw new Error(
    '.annotate(callback) returned an unexpected value: expected the meta builder or a readonly array of AnnotationValues',
  );
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
