import { ANNOTATION_BUILDER } from './annotation-registry';
import { runtimeError } from './runtime-error';

/**
 * The kinds of operations an annotation may apply to.
 *
 * - `'read'` — `SELECT` / `find` / `first` / `all` / `count` / aggregates.
 * - `'write'` — `INSERT` / `UPDATE` / `DELETE` / `create` / `update` / `delete` / `upsert`.
 *
 * Annotations declare which kinds they apply to via `defineAnnotation`'s
 * `applicableTo` option. Lane terminals enforce the constraint at the
 * type level (via the structural `RegistryFor<K, Reg>` filter that
 * derives the `AnnotationBuilder<K, Reg>` callback parameter) and at
 * runtime (via `assertAnnotationsApplicable`).
 *
 * Finer-grained kinds (`'select' | 'insert' | 'update' | 'delete' | 'upsert'`)
 * are deliberately deferred. The binary covers the common case (the cache
 * middleware applies to reads; an audit annotation would apply to writes;
 * tracing/OTel applies to both). When a real annotation surfaces that needs
 * a finer split, the union widens and existing handles remain typecheckable.
 */
export type OperationKind = 'read' | 'write';

/**
 * An applied annotation. Carries the namespace, the typed payload, and the
 * `applicableTo` set the underlying handle declared. The `__annotation`
 * brand lets `read` distinguish branded user annotations from arbitrary
 * data that may happen to live under the same namespace key in
 * `plan.meta.annotations` (e.g. framework-internal metadata such as
 * `meta.annotations.codecs`).
 *
 * Constructed by calling an `AnnotationHandle` directly (the handle is a
 * callable function); never instantiated explicitly.
 */
export interface AnnotationValue<Payload, Kinds extends OperationKind> {
  readonly __annotation: true;
  readonly namespace: string;
  readonly value: Payload;
  readonly applicableTo: ReadonlySet<Kinds>;
}

/**
 * Handle returned by `defineAnnotation`. The handle is itself a callable
 * function — invoking it with a payload returns a frozen
 * `AnnotationValue` ready to flow into a lane terminal's `.annotate(...)`
 * callback (or its array escape hatch).
 *
 * In addition to being callable, the handle carries metadata the
 * registry uses to key it (`name`), the namespace under which produced
 * `AnnotationValue`s are stored on `plan.meta.annotations`
 * (`namespace`), the operation kinds it applies to (`applicableTo`),
 * and a `read` accessor for middleware that want to recover the typed
 * payload from a plan.
 *
 * `read(plan)` returns the `Payload` if a value was previously stored
 * under this handle's `namespace`, or `undefined` when the annotation
 * is absent, when the stored value is not a branded `AnnotationValue`
 * (e.g. framework-internal metadata under the same key), or when the
 * stored value's own `namespace` field disagrees with the handle's.
 */
export type AnnotationHandle<Payload, Kinds extends OperationKind> = ((
  value: Payload,
) => AnnotationValue<Payload, Kinds>) & {
  readonly name: string;
  readonly namespace: string;
  readonly applicableTo: ReadonlySet<Kinds>;
  read(plan: {
    readonly meta: { readonly annotations?: Record<string, unknown> };
  }): Payload | undefined;
};

/**
 * Options accepted by `defineAnnotation`.
 *
 * `name` is the registry key under which the handle is stored on the
 * `AnnotationRegistry` assembled from middleware-contributed handles.
 * It is also the default namespace.
 *
 * `namespace` is the string key under which the produced
 * `AnnotationValue` is stored on `plan.meta.annotations`. Defaults to
 * `name`. Override only when the registry key needs to differ from the
 * storage key (today no handle does — keep it equal to `name` unless a
 * real conflict surfaces).
 *
 * **Reserved namespaces** include framework-internal metadata keys; user
 * handles must not use them:
 *
 * - `codecs` — used by the SQL emitter to record per-alias codec ids
 *   (`meta.annotations.codecs[alias] = 'pg/text@1'`); the SQL runtime's
 *   `decodeRow` reads from this key. A user `defineAnnotation({ name: 'codecs', ... })`
 *   handle is not structurally prevented, but its behavior with the
 *   emitter and the runtime is undefined and we make no compatibility
 *   guarantees about it.
 * - Target-specific keys such as `pg` (and equivalents on other
 *   targets) are similarly reserved for adapter / target use.
 *
 * `applicableTo` declares which operation kinds the annotation may attach
 * to. The lane terminals' kind-filtered `AnnotationBuilder<K, Reg>`
 * structurally drops handles whose `Kinds` does not intersect `K`; the
 * runtime helper `assertAnnotationsApplicable` does the equivalent at
 * runtime so casts and `any` cannot bypass the gate.
 */
export interface DefineAnnotationOptions<Kinds extends OperationKind> {
  readonly name: string;
  readonly applicableTo: readonly Kinds[];
  readonly namespace?: string;
}

/**
 * Defines a typed annotation handle.
 *
 * The returned handle is itself a callable function. Invoking it with a
 * payload produces a frozen `AnnotationValue`; the `name`, `namespace`,
 * `applicableTo`, and `read` metadata is attached as own properties of
 * the function so the registry-driven `.annotate(callback)` builder
 * factory can introspect it.
 *
 * @example
 * ```typescript
 * // Read-only annotation. Lane terminals like `db.User.first(...)` accept
 * // it through the kind-filtered `meta` builder; `db.User.create(...)`
 * // structurally lacks `meta.cache` because cache is read-only.
 * const cacheAnnotation = defineAnnotation<{ ttl?: number; skip?: boolean }, 'read'>({
 *   name: 'cache',
 *   applicableTo: ['read'],
 * });
 *
 * // Calling the handle yields a frozen AnnotationValue ready to use
 * // through the array escape hatch:
 * .annotate(() => [cacheAnnotation({ ttl: 60 })]);
 *
 * // Write-only annotation. Mirror image.
 * const auditAnnotation = defineAnnotation<{ actor: string }, 'write'>({
 *   name: 'audit',
 *   applicableTo: ['write'],
 * });
 *
 * // Annotation applicable to both kinds (e.g. tracing).
 * const otelAnnotation = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
 *   name: 'otel',
 *   applicableTo: ['read', 'write'],
 * });
 * ```
 *
 * **Reserved namespaces.** See `DefineAnnotationOptions.namespace` for the
 * list of framework-internal namespaces (`codecs`, target-specific keys).
 * `defineAnnotation` does not structurally prevent a user from naming a
 * reserved namespace, but the framework makes no compatibility guarantee
 * about handles that do.
 */
export function defineAnnotation<Payload, Kinds extends OperationKind>(
  options: DefineAnnotationOptions<Kinds>,
): AnnotationHandle<Payload, Kinds> {
  const name = options.name;
  const namespace = options.namespace ?? name;
  const applicableTo: ReadonlySet<Kinds> = Object.freeze(new Set(options.applicableTo));

  const handle = ((value: Payload): AnnotationValue<Payload, Kinds> => {
    return Object.freeze({
      __annotation: true as const,
      namespace,
      value,
      applicableTo,
    });
  }) as AnnotationHandle<Payload, Kinds>;

  // Attach the metadata fields and the `read` accessor as own properties
  // of the function. We use `Object.defineProperties` rather than
  // `Object.assign` so we can mark them non-writable and non-configurable
  // — the handle should look frozen even though `Object.freeze` on a
  // function would also lock its `[[Prototype]]`.
  Object.defineProperties(handle, {
    name: { value: name, enumerable: true, writable: false, configurable: false },
    namespace: { value: namespace, enumerable: true, writable: false, configurable: false },
    applicableTo: { value: applicableTo, enumerable: true, writable: false, configurable: false },
    read: {
      value: (plan: {
        readonly meta: { readonly annotations?: Record<string, unknown> };
      }): Payload | undefined => {
        const stored = plan.meta.annotations?.[namespace];
        if (!isAnnotationValue(stored)) {
          return undefined;
        }
        if (stored.namespace !== namespace) {
          // Defensive: a different handle wrote under our namespace key.
          return undefined;
        }
        return stored.value as Payload;
      },
      enumerable: true,
      writable: false,
      configurable: false,
    },
  });

  return handle;
}

/**
 * Filters a registry of `AnnotationHandle`s to the subset whose
 * declared `Kinds` intersect with `K`. Used to derive the
 * `AnnotationBuilder<K, Reg>` shape — read terminals see only handles
 * whose kinds include `'read'`, write terminals only those whose kinds
 * include `'write'`.
 *
 * The structural filter is the type-level applicability gate; combined
 * with the runtime `assertAnnotationsApplicable`, it makes
 * "annotate a write with a read-only handle" impossible without an
 * `as any` cast that fails closed at the runtime gate.
 *
 * Implementation note: `Kinds` is inferred from the handle's covariant
 * `applicableTo: ReadonlySet<Kinds>` field rather than from the
 * callable signature. The callable's `Payload` parameter is
 * contravariant, which prevents the conditional from matching when
 * `Reg[N]` is a concrete `AnnotationHandle<{ ... }, K>` against
 * `AnnotationHandle<unknown, infer Kinds>`. Inferring through
 * `applicableTo` avoids the variance trap and yields the same `Kinds`.
 */
export type RegistryFor<K extends OperationKind, Reg> = {
  readonly [N in keyof Reg as Reg[N] extends {
    readonly applicableTo: ReadonlySet<infer Kinds extends OperationKind>;
  }
    ? K extends Kinds
      ? N
      : never
    : never]: Reg[N];
};

/**
 * Helper that converts a union to an intersection. Used by
 * `AnnotationsOf` to flatten a tuple of middleware-contributed
 * registry shapes into a single merged registry.
 */
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

/**
 * Per-middleware contribution to the merged registry shape. Middleware
 * that don't declare `annotations` contribute the empty record `{}`.
 */
type AnnotationContribution<M> = M extends { readonly annotations: infer A } ? A : {};

/**
 * Flattens a tuple of middleware (each optionally carrying an
 * `annotations` field) to the merged registry shape. Equivalent to
 * "intersection of every middleware's contributed annotations record".
 *
 * `AnnotationsOf<readonly []>` resolves to `{}` (the empty registry).
 * Middleware that omit `annotations` contribute `{}` and therefore do
 * not affect the intersection.
 *
 * Family factory generics (`postgres()` and friends) capture the
 * middleware tuple via a `const Mw extends readonly … = readonly []`
 * generic and project the client surface to `AnnotationsOf<Mw>`. The
 * lane terminals consume the resulting registry through `RegistryFor<K,
 * AnnotationsOf<Mw>>`.
 *
 * The constraint is `readonly object[]` rather than
 * `readonly { readonly annotations?: object }[]` because TypeScript's
 * weak-type rule rejects middleware that declare no overlap with the
 * (entirely-optional) `{ annotations?: object }` shape.
 */
export type AnnotationsOf<Mw extends readonly object[]> =
  UnionToIntersection<AnnotationContribution<Mw[number]>> extends infer R
    ? unknown extends R
      ? {}
      : R
    : never;

/**
 * Chainable builder surface that lane-terminal `.annotate(callback)`
 * passes to the user callback. Each method corresponds to an
 * annotation handle in the kind-filtered registry — invoking a method
 * pushes a new `AnnotationValue` onto the builder's `values` array
 * and returns a new `AnnotationBuilder` of the same kind / registry.
 *
 * The `[ANNOTATION_BUILDER]: true` brand and the `values` field let
 * the framework distinguish builders from raw arrays of
 * `AnnotationValue` and extract the accumulated values uniformly. See
 * `ANNOTATION_BUILDER` in `./annotation-registry.ts`.
 *
 * Builders are immutable: each method returns a new frozen builder
 * with `values` extended by one entry.
 *
 * Implementation note: the per-method payload type is inferred via
 * `Reg[N] extends (payload: infer P) => unknown` (a purely callable
 * shape). Inferring through `AnnotationHandle<infer P, OperationKind>`
 * runs into the same callable-contravariance trap as `RegistryFor`.
 */
export type AnnotationBuilder<K extends OperationKind, Reg> = {
  readonly [N in keyof RegistryFor<K, Reg>]: RegistryFor<K, Reg>[N] extends (
    payload: infer P,
  ) => unknown
    ? (payload: P) => AnnotationBuilder<K, Reg>
    : never;
} & {
  readonly [ANNOTATION_BUILDER]: true;
  readonly values: readonly AnnotationValue<unknown, OperationKind>[];
};

/**
 * Runtime applicability gate. Throws `RUNTIME.ANNOTATION_INAPPLICABLE` if
 * any annotation in `annotations` declares an `applicableTo` set that does
 * not include `kind`. Used by lane terminals (SQL DSL builders' `.build()`,
 * ORM `Collection` terminals) to fail closed when the type-level
 * structural filter is bypassed via cast / `any` / dynamic invocation.
 *
 * Passes silently on:
 *  - empty arrays
 *  - annotations whose `applicableTo` includes `kind`
 *
 * Throws on:
 *  - any annotation whose `applicableTo` does not include `kind`. The
 *    error names the offending annotation's `namespace` and the
 *    `terminalName` so users can locate the misuse.
 *
 * @example
 * ```typescript
 * // Inside an ORM read terminal:
 * assertAnnotationsApplicable(annotations, 'read', 'first');
 * ```
 */
export function assertAnnotationsApplicable(
  annotations: readonly AnnotationValue<unknown, OperationKind>[],
  kind: OperationKind,
  terminalName: string,
): void {
  for (const annotation of annotations) {
    if (!annotation.applicableTo.has(kind)) {
      throw runtimeError(
        'RUNTIME.ANNOTATION_INAPPLICABLE',
        `Annotation '${annotation.namespace}' is not applicable to '${kind}' operations (terminal: '${terminalName}'). The annotation declares applicableTo = [${Array.from(
          annotation.applicableTo,
        )
          .map((k) => `'${k}'`)
          .join(', ')}].`,
        {
          namespace: annotation.namespace,
          terminalName,
          kind,
          applicableTo: Array.from(annotation.applicableTo),
        },
      );
    }
  }
}

/**
 * Type guard for branded annotation values stored in `plan.meta.annotations`.
 *
 * Internal — used by `AnnotationHandle.read` to distinguish user
 * annotations (created by calling a `defineAnnotation` handle) from
 * framework-internal metadata that may happen to live under the same
 * namespace key.
 */
function isAnnotationValue(value: unknown): value is AnnotationValue<unknown, OperationKind> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { readonly __annotation?: unknown };
  return candidate.__annotation === true;
}
