import type {
  MongoAggExpr,
  MongoFilterExpr,
  MongoUpdatePipelineStage,
} from '@prisma-next/mongo-query-ast/execution';
import {
  MongoAddFieldsStage,
  MongoAggFieldRef,
  MongoExistsExpr,
  MongoFieldFilter,
  MongoProjectStage,
  MongoReplaceRootStage,
} from '@prisma-next/mongo-query-ast/execution';
import type { MongoValue } from '@prisma-next/mongo-value';
import type { DocField, DocShape, TypedAggExpr } from './types';
import type { TypedUpdateOp } from './update-ops';
import {
  addToSetOp,
  currentDateOp,
  incOp,
  maxOp,
  minOp,
  mulOp,
  popOp,
  pullAllOp,
  pullOp,
  pushOp,
  renameOp,
  setOnInsertOp,
  setOp,
  unsetOp,
} from './update-ops';

/**
 * The unified field accessor expression returned by `FieldAccessor` (per
 * [ADR 180](../../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)).
 *
 * Each `Expression<F>` carries:
 *  - `node` (`MongoAggExpr`) — for use as an aggregation expression in `addFields`,
 *    `group`, `project`, etc. Drop-in replacement for the old `TypedAggExpr<F>`.
 *  - filter operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `exists`)
 *    — replaces the old `FilterHandle`.
 *  - update operators (`set`, `unset`, `inc`, `mul`, `min`, `max`, `rename`,
 *    `push`, `addToSet`, `pop`, `pull`, `pullAll`, `currentDate`, `setOnInsert`)
 *    — consumed by write terminals (M2+).
 *
 * Operator surfaces are intentionally not trait-gated by codec in this revision
 * (see Open Item 4 in the spec). Calling, e.g. `.inc(1)` on a string-typed
 * expression compiles; the runtime relies on Mongo to surface the error.
 * Trait-gating can be tightened in a follow-up without changing the accessor's
 * public shape.
 */
export interface Expression<F extends DocField> extends TypedAggExpr<F> {
  readonly _path: string;

  // Filter operators
  eq(value: MongoValue): MongoFilterExpr;
  ne(value: MongoValue): MongoFilterExpr;
  gt(value: MongoValue): MongoFilterExpr;
  gte(value: MongoValue): MongoFilterExpr;
  lt(value: MongoValue): MongoFilterExpr;
  lte(value: MongoValue): MongoFilterExpr;
  in(values: ReadonlyArray<MongoValue>): MongoFilterExpr;
  nin(values: ReadonlyArray<MongoValue>): MongoFilterExpr;
  exists(flag?: boolean): MongoFilterExpr;

  // Update operators ($set family)
  set(value: MongoValue): TypedUpdateOp;
  unset(): TypedUpdateOp;
  rename(newName: string): TypedUpdateOp;

  // Numeric update operators
  inc(amount: number): TypedUpdateOp;
  mul(factor: number): TypedUpdateOp;
  min(value: MongoValue): TypedUpdateOp;
  max(value: MongoValue): TypedUpdateOp;

  // Array update operators
  push(value: MongoValue): TypedUpdateOp;
  addToSet(value: MongoValue): TypedUpdateOp;
  pop(direction?: 1 | -1): TypedUpdateOp;
  pull(value: MongoValue): TypedUpdateOp;
  pullAll(values: ReadonlyArray<MongoValue>): TypedUpdateOp;

  // Date / upsert helpers
  currentDate(): TypedUpdateOp;
  setOnInsert(value: MongoValue): TypedUpdateOp;
}

/**
 * Emitters for MongoDB update-pipeline stages (`$addFields`/`$set`,
 * `$project`/`$unset`, `$replaceRoot`/`$replaceWith`). These return
 * `MongoUpdatePipelineStage` nodes that can be mixed into the updater
 * callback alongside `TypedUpdateOp` values when the pipeline-style
 * update form is desired.
 *
 * Accessible via `f.stage` on the `FieldAccessor`.
 */
export interface StageEmitters {
  set(fields: Record<string, MongoAggExpr>): MongoUpdatePipelineStage;
  unset(...paths: ReadonlyArray<string>): MongoUpdatePipelineStage;
  replaceRoot(newRoot: MongoAggExpr): MongoUpdatePipelineStage;
  replaceWith(newRoot: MongoAggExpr): MongoUpdatePipelineStage;
}

function buildStageEmitters(): StageEmitters {
  return {
    set: (fields) => new MongoAddFieldsStage(fields),
    unset: (...paths) => {
      const spec: Record<string, 0> = {};
      for (const p of paths) {
        spec[p] = 0;
      }
      return new MongoProjectStage(spec);
    },
    replaceRoot: (newRoot) => new MongoReplaceRootStage(newRoot),
    replaceWith: (newRoot) => new MongoReplaceRootStage(newRoot),
  };
}

/**
 * The unified `FieldAccessor` per ADR 180.
 *
 * - Property access (`f.status`) returns an `Expression<F>` whose codec comes
 *   from the current pipeline shape `S`.
 * - Callable form (`f('address.city')`) returns an `Expression<DocField>` for
 *   arbitrary dot-paths (value-object traversal). Strict path validation
 *   against `ContractValueObject` definitions is a follow-up; v1 accepts any
 *   string.
 * - `f.stage` exposes pipeline-style update emitters (`$set`, `$unset`,
 *   `$replaceRoot`, `$replaceWith`).
 *
 * Both forms produce compatible expressions; both can be passed to filter
 * helpers, aggregation helpers, or write terminals.
 */
export type FieldAccessor<S extends DocShape> = {
  readonly [K in keyof S & string]: Expression<S[K]>;
} & ((path: string) => Expression<DocField>) & {
    readonly stage: StageEmitters;
  };

function buildExpression<F extends DocField>(path: string): Expression<F> {
  return {
    _field: undefined as never,
    _path: path,
    node: MongoAggFieldRef.of(path),

    eq: (value) => MongoFieldFilter.eq(path, value),
    ne: (value) => MongoFieldFilter.neq(path, value),
    gt: (value) => MongoFieldFilter.gt(path, value),
    gte: (value) => MongoFieldFilter.gte(path, value),
    lt: (value) => MongoFieldFilter.lt(path, value),
    lte: (value) => MongoFieldFilter.lte(path, value),
    in: (values) => MongoFieldFilter.in(path, values),
    nin: (values) => MongoFieldFilter.nin(path, values),
    exists: (flag) =>
      flag === false ? MongoExistsExpr.notExists(path) : MongoExistsExpr.exists(path),

    set: (value) => setOp(path, value),
    unset: () => unsetOp(path),
    rename: (newName) => renameOp(path, newName),

    inc: (amount) => incOp(path, amount),
    mul: (factor) => mulOp(path, factor),
    min: (value) => minOp(path, value),
    max: (value) => maxOp(path, value),

    push: (value) => pushOp(path, value),
    addToSet: (value) => addToSetOp(path, value),
    pop: (direction = 1) => popOp(path, direction),
    pull: (value) => pullOp(path, value),
    pullAll: (values) => pullAllOp(path, values),

    currentDate: () => currentDateOp(path),
    setOnInsert: (value) => setOnInsertOp(path, value),
  };
}

/**
 * Construct a unified `FieldAccessor<S>` proxy. Property access creates an
 * `Expression` using the property name as the field path; callable form
 * accepts an explicit dot-path string.
 *
 * The proxy target is a function so the resulting object is both callable and
 * indexable. Symbol-keyed accesses (e.g. `Symbol.toPrimitive`) return
 * `undefined` to keep accidental coercion behaviour unsurprising — matching
 * the previous `FieldProxy` / `FilterProxy` semantics.
 */
export function createFieldAccessor<S extends DocShape>(): FieldAccessor<S> {
  const stageInstance = buildStageEmitters();
  const callable = ((path: string) =>
    buildExpression<DocField>(path)) as unknown as FieldAccessor<S>;
  return new Proxy(callable, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === 'stage') {
        return stageInstance;
      }
      return buildExpression(prop);
    },
  });
}
