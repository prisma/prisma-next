import type { ParamRefMutator } from '@prisma-next/framework-components/runtime';
import { MongoParamRef } from '@prisma-next/mongo-value';

/**
 * Brand applied to {@link MongoParamRefHandle} so user-constructed
 * handles are rejected by the type system. Phantom-typed only — at
 * runtime the handle is the underlying `MongoParamRef` instance from
 * the lowered tree.
 */
declare const mongoParamRefHandleBrand: unique symbol;

/**
 * Opaque token identifying a single `MongoParamRef` in the lowered
 * Mongo command tree. Produced by {@link MongoParamRefMutator.entries};
 * consumed by `replaceValue` / `replaceValues`.
 */
export interface MongoParamRefHandle<TCodecId extends string | undefined = string | undefined> {
  readonly [mongoParamRefHandleBrand]: TCodecId;
}

/**
 * One outbound `MongoParamRef` slot exposed to middleware. `value` is
 * the current authored value; `codecId` is the codec id declared on
 * the underlying `MongoParamRef`.
 */
export interface MongoParamRefEntry<TCodecId extends string | undefined = string | undefined> {
  readonly ref: MongoParamRefHandle<TCodecId>;
  readonly value: unknown;
  readonly codecId: TCodecId;
}

/**
 * Discriminated entry union over a codec map (matches the SQL family's
 * pattern). Pattern-matching on `entry.codecId` narrows the entry to a
 * single `TCodecMap` arm.
 */
export type MongoParamRefEntryUnion<TCodecMap extends Record<string, unknown>> =
  | { [K in keyof TCodecMap & string]: MongoParamRefEntry<K> }[keyof TCodecMap & string]
  | MongoParamRefEntry<undefined>;

/**
 * Mongo-family mutator threaded into `MongoMiddleware.beforeExecute` as
 * `params`. Walks the lowered tree (objects, arrays, leaves) and yields
 * `MongoParamRef` slots in pre-order; mutator semantics match the SQL
 * family's `SqlParamRefMutator` (AC-FAM1, AC-FAM2).
 */
export interface MongoParamRefMutator<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
> extends ParamRefMutator {
  /** Iterate every `MongoParamRef` reachable from the lowered tree (AC-FAM2). */
  entries(): IterableIterator<MongoParamRefEntryUnion<TCodecMap>>;

  replaceValue<TCodecId extends keyof TCodecMap & string>(
    ref: MongoParamRefHandle<TCodecId>,
    newValue: TCodecMap[TCodecId],
  ): void;
  replaceValue(ref: MongoParamRefHandle<undefined>, newValue: unknown): void;

  replaceValues(
    updates: Iterable<{
      readonly ref: MongoParamRefHandle<(keyof TCodecMap & string) | undefined>;
      readonly newValue: unknown;
    }>,
  ): void;
}

/**
 * Walk an arbitrary value (object / array / leaf) and yield every
 * reachable `MongoParamRef` in pre-order. Stable order matches the
 * resolveValue walk so `entries()` consumers see ParamRefs in the order
 * the runtime would encode them.
 */
export function* flattenMongoParamRefs(value: unknown): IterableIterator<MongoParamRef> {
  if (value instanceof MongoParamRef) {
    yield value;
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (value instanceof Date) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* flattenMongoParamRefs(item);
    }
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    yield* flattenMongoParamRefs(child);
  }
}

type AnyHandle = MongoParamRefHandle<string | undefined>;

/**
 * Build a {@link MongoParamRefMutator} over an arbitrary lowered tree
 * (typically a Mongo wire command). The mutator's `entries()` walks the
 * tree on demand via {@link flattenMongoParamRefs}; mutations are
 * tracked in a per-MongoParamRef map and applied to a working tree
 * lazily on `currentTree()`.
 *
 * The actual integration into `MongoRuntime` is not yet wired (Mongo's
 * lower step resolves `MongoParamRef`s into raw values; deferring that
 * is a follow-on). The mutator type and flatten helper land here so
 * extension authors can target the seam in the meantime.
 */
export function createMongoParamRefMutator<
  TCodecMap extends Record<string, unknown> = Record<string, unknown>,
>(tree: unknown): MongoParamRefMutator<TCodecMap> {
  const refs: ReadonlyArray<MongoParamRef> = [...flattenMongoParamRefs(tree)];
  const replacements = new Map<MongoParamRef, unknown>();

  const indexOfRef = (handle: AnyHandle): MongoParamRef | undefined => {
    const ref = handle as unknown as MongoParamRef;
    return refs.includes(ref) ? ref : undefined;
  };

  function* entries(): IterableIterator<MongoParamRefEntryUnion<TCodecMap>> {
    for (const ref of refs) {
      const handle = ref as unknown as MongoParamRefHandle<string | undefined>;
      const value = replacements.has(ref) ? replacements.get(ref) : ref.value;
      const entry: MongoParamRefEntry<string | undefined> = {
        ref: handle,
        value,
        codecId: ref.codecId,
      };
      yield entry as MongoParamRefEntryUnion<TCodecMap>;
    }
  }

  function replaceValue(handle: AnyHandle, newValue: unknown): void {
    const ref = indexOfRef(handle);
    if (!ref) return;
    replacements.set(ref, newValue);
  }

  function replaceValues(
    updates: Iterable<{ readonly ref: AnyHandle; readonly newValue: unknown }>,
  ): void {
    for (const { ref, newValue } of updates) {
      replaceValue(ref, newValue);
    }
  }

  // The public `MongoParamRefMutator` declares overloaded `replaceValue`
  // signatures (typed-by-codec / unresolvable-codec). The implementation
  // is one function with a permissive runtime signature; the cast below
  // is the single point at which the runtime function meets the typed
  // overload surface, matching the overload-implementation pattern.
  return {
    entries,
    replaceValue: replaceValue as MongoParamRefMutator<TCodecMap>['replaceValue'],
    replaceValues,
  };
}
