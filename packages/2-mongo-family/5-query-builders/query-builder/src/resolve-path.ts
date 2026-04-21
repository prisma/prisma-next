import type { MongoContract } from '@prisma-next/mongo-contract';
import type { DocField } from './types';

/**
 * Marker `DocField` variant representing a non-leaf (value-object) path in
 * a [NestedDocShape]. Extends `DocField` with a `fields` property carrying
 * the sub-shape so the pipeline builder can recurse into it.
 *
 * `codecId` is the reserved literal `'prisma/object@1'`; the accessor's
 * runtime implementation does not serialize it — the codec id is a purely
 * type-level sentinel used by `Expression<F>` to select the reduced
 * operator surface for non-leaf paths.
 *
 * `nullable` tracks whether the value object itself may be absent/null on
 * the parent document. The callable form currently does not propagate the
 * parent's `nullable` flag onto leaves beneath it (path traversal under a
 * nullable parent resolves to the leaf's own `nullable` — matching how
 * MongoDB treats missing intermediate documents).
 */
export interface ObjectField<N extends NestedDocShape> extends DocField {
  readonly codecId: 'prisma/object@1';
  readonly nullable: boolean;
  readonly fields: N;
}

/**
 * Document shape that carries nested value-object sub-shapes.
 *
 * Structurally identical to a flat `DocShape` (`Record<string, DocField>`),
 * but individual values may be `ObjectField<SubShape>` carrying a nested
 * `NestedDocShape` sub-tree. The pipeline builder threads a
 * `NestedDocShape` alongside the flat `DocShape` so the callable
 * `f('a.b.c')` form can validate dot-paths at the type level.
 *
 * When a stage transforms the root shape in a way that invalidates nested
 * paths (e.g. `$group`, `$project`, `$replaceRoot`), the thread is reset
 * to the empty shape `Record<string, never>` — which makes `ValidPaths`
 * resolve to `never` and so disables the callable form downstream.
 */
export type NestedDocShape = Record<string, DocField>;

// ── Contract → NestedDocShape translation ────────────────────────────────

type ContractHasValueObjects = {
  readonly valueObjects?: Record<string, { readonly fields: Record<string, unknown> }>;
};

type VOFields<
  TContract extends ContractHasValueObjects,
  VOName extends string,
> = TContract extends {
  readonly valueObjects: infer VOs extends Record<
    string,
    { readonly fields: Record<string, unknown> }
  >;
}
  ? VOName extends keyof VOs
    ? VOs[VOName]['fields']
    : never
  : never;

type FieldToLeaf<F> = F extends {
  readonly type: { readonly kind: 'scalar'; readonly codecId: infer C extends string };
  readonly nullable: infer N extends boolean;
}
  ? { readonly codecId: C; readonly nullable: N }
  : F extends { readonly many: true; readonly nullable: infer N extends boolean }
    ? { readonly codecId: 'mongo/array@1'; readonly nullable: N }
    : DocField;

/**
 * Recursive helper: translate a `Record<string, ContractField>` (a model or
 * value-object's `fields` table) into a `NestedDocShape`. Scalar fields
 * become `DocField` leaves with their concrete `codecId` and `nullable`.
 * Value-object fields become `ObjectField<SubShape>` whose `fields`
 * payload is the recursively-resolved sub-shape.
 *
 * `many: true` fields are treated as leaves (array element traversal is
 * out of scope for TML-2281 — path navigation stops at the array).
 *
 * Union-kind fields are treated as opaque `DocField` leaves (union
 * narrowing/traversal is deferred; see follow-up notes on ADR 180).
 */
type FieldsToNested<
  TContract extends ContractHasValueObjects,
  Fields extends Record<string, unknown>,
> = {
  readonly [K in keyof Fields & string]: Fields[K] extends { readonly many: true }
    ? FieldToLeaf<Fields[K]>
    : Fields[K] extends {
          readonly type: {
            readonly kind: 'valueObject';
            readonly name: infer VOName extends string;
          };
          readonly nullable: infer Null extends boolean;
        }
      ? ObjectField<FieldsToNested<TContract, VOFields<TContract, VOName>>> & {
          readonly nullable: Null;
        }
      : Fields[K] extends {
            readonly type: { readonly kind: 'scalar'; readonly codecId: string };
          }
        ? FieldToLeaf<Fields[K]>
        : DocField;
};

/**
 * Build the `NestedDocShape` for a model. Scalar leaves resolve to their
 * concrete codec id; value-object fields recurse into the referenced
 * `valueObjects[VOName].fields` table, producing a tree that
 * `ResolvePath` / `ValidPaths` can walk.
 */
export type ModelNestedShape<
  TContract extends MongoContract,
  ModelName extends string & keyof TContract['models'],
> = FieldsToNested<TContract & ContractHasValueObjects, TContract['models'][ModelName]['fields']>;

// ── Path walking ─────────────────────────────────────────────────────────

/**
 * Resolve a dot-path against a `NestedDocShape`. Returns:
 *  - the leaf `DocField` when `Path` terminates on a scalar/array leaf,
 *  - the `ObjectField<Sub>` when `Path` terminates on a value object (so
 *    the caller can operate on the whole sub-document),
 *  - `never` when the path is invalid (unknown segment, or a scalar
 *    segment followed by further traversal).
 *
 * Paired with the constrained callable `<P extends ValidPaths<N>>(path: P)
 * => Expression<ResolvePath<N, P>>` so the IDE offers completions and
 * rejects bad paths with a clear error instead of silently resolving to
 * `never`.
 */
export type ResolvePath<
  N extends NestedDocShape,
  Path extends string,
> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof N & string
    ? N[Head] extends ObjectField<infer Sub>
      ? ResolvePath<Sub, Rest>
      : never
    : never
  : Path extends keyof N & string
    ? N[Path]
    : never;

/**
 * Union of every valid dot-path within a `NestedDocShape`. Includes
 * top-level keys (scalar leaves *and* value-object roots) and every
 * recursive descent through `ObjectField` sub-shapes.
 *
 * Non-leaf paths are intentionally included — `f('address')` yields an
 * `Expression<ObjectField<…>>` whose reduced operator surface (`set`,
 * `unset`, `exists`, `eq(null)`, `ne(null)`) lets callers operate on the
 * whole value object. Leaf paths like `f('address.city')` get the full
 * leaf operator surface.
 *
 * The `string extends keyof N` guard short-circuits to `never` for
 * open-ended index-signature shapes (e.g. the default
 * `Record<string, never>` used to represent "no nested information" —
 * notably downstream of replacement stages in the pipeline builder). An
 * open-ended `keyof` cannot resolve a specific literal path, so the
 * callable form must be disabled at the type level.
 */
export type ValidPaths<N extends NestedDocShape> = string extends keyof N
  ? never
  : {
      [K in keyof N & string]: N[K] extends ObjectField<infer Sub>
        ? K | `${K}.${ValidPaths<Sub>}`
        : K;
    }[keyof N & string];

/**
 * IDE-oriented alias for `ValidPaths`. Kept as a separate export so future
 * refinements (e.g. ArkType-style lazy expansion for very deep shapes) can
 * diverge from the strict `ValidPaths` constraint without breaking
 * downstream consumers. For now the two are intentionally equivalent.
 */
export type PathCompletions<N extends NestedDocShape> = ValidPaths<N>;
