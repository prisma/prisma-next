import type { AggregateBuilder } from '@prisma-next/sql-orm-client';
import type { AnyExpression, OrderByItem } from '@prisma-next/sql-relational-core/ast';
import type { Contract } from '../contract/contract.d';
import type { SpaceModelName } from './model-map';

/**
 * Comparison methods a contract-typed collection's model accessor exposes
 * per field. The real accessor trait-gates its methods per field codec
 * (e.g. a boolean column has no `gt`), so every method is optional here and
 * the adapter guards presence at runtime, converting a missing method into
 * a typed unsupported-operator error.
 */
export interface AdapterFieldComparators {
  eq?(value: unknown): AnyExpression;
  neq?(value: unknown): AnyExpression;
  gt?(value: unknown): AnyExpression;
  lt?(value: unknown): AnyExpression;
  gte?(value: unknown): AnyExpression;
  lte?(value: unknown): AnyExpression;
  like?(pattern: string): AnyExpression;
  in?(values: readonly unknown[]): AnyExpression;
  notIn?(values: readonly unknown[]): AnyExpression;
  isNull?(): AnyExpression;
  isNotNull?(): AnyExpression;
  asc?(): OrderByItem;
  desc?(): OrderByItem;
}

/**
 * Structural view of a collection's typed model accessor. Values are
 * `unknown` because the real accessor mixes trait-gated field comparators
 * with relation accessors (e.g. `session.user`), which share no common
 * properties; the adapter only ever indexes contract-validated scalar
 * field names and narrows the value to {@link AdapterFieldComparators} at
 * that single seam.
 */
export type AdapterModelAccessor = Record<string, unknown>;

/** A read/mutation row as the adapter sees it — the collection owns the real shape. */
export type AdapterRow = Record<string, unknown>;

/**
 * The minimal structural surface the adapter drives on each contract-typed
 * ORM collection. `Collection` from `@prisma-next/sql-orm-client`
 * (instantiated by an app's aggregate contract) satisfies this interface —
 * pinned by the package's type-level test.
 */
/**
 * The count selector the ORM's aggregate builder produces
 * (`AggregateSelector<number>`, which the ORM does not export directly).
 */
type CountSelector = ReturnType<AggregateBuilder<Contract, 'User'>['count']>;

/** The slice of the ORM aggregate builder the adapter uses for `count`. */
export interface AdapterAggregateBuilder {
  count(): CountSelector;
}

export interface AdapterCollection {
  where(fn: (model: AdapterModelAccessor) => AnyExpression): AdapterCollection;
  orderBy(fn: (model: AdapterModelAccessor) => OrderByItem): AdapterCollection;
  take(count: number): AdapterCollection;
  skip(count: number): AdapterCollection;
  all(): PromiseLike<ReadonlyArray<AdapterRow>>;
  first(): Promise<AdapterRow | null>;
  aggregate(fn: (aggregate: AdapterAggregateBuilder) => { count: CountSelector }): Promise<{
    count: number;
  }>;
  create(data: AdapterRow): Promise<AdapterRow>;
  update(data: AdapterRow): Promise<AdapterRow | null>;
  updateCount(data: AdapterRow): Promise<number>;
  delete(): Promise<AdapterRow | null>;
  deleteCount(): Promise<number>;
}

/**
 * The minimal structural surface `prismaNextAdapter` needs from an app's
 * prisma-next client: the four contract-typed collections of the
 * `better-auth` space at their namespace coordinate. An app's ordinary `db`
 * (e.g. `PostgresClient` over an aggregate contract that includes the pack)
 * satisfies this shape without ceremony.
 */
export interface BetterAuthDb {
  readonly orm: {
    readonly public: Readonly<Record<SpaceModelName, AdapterCollection>>;
  };
}
