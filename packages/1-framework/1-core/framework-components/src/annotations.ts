import { runtimeError } from './runtime-error';

/**
 * The kinds of operations an annotation may apply to.
 *
 * - `'read'` — `SELECT` / `find` / `first` / `all` / `count` / aggregates.
 * - `'write'` — `INSERT` / `UPDATE` / `DELETE` / `create` / `update` / `delete` / `upsert`.
 *
 * Annotations declare which kinds they apply to via `defineAnnotation`'s
 * `applicableTo` option; lane terminals enforce the constraint at both the
 * type level (via `ValidAnnotations`) and at runtime (via
 * `assertAnnotationsApplicable`).
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
 * Constructed via `AnnotationHandle.apply(...)`; never instantiated
 * directly.
 */
export interface AnnotationValue<Payload, Kinds extends OperationKind> {
  readonly __annotation: true;
  readonly namespace: string;
  readonly value: Payload;
  readonly applicableTo: ReadonlySet<Kinds>;
}

/**
 * Handle returned by `defineAnnotation`. Carries the static metadata
 * (namespace, applicableTo) and the two operations a handle exposes:
 *
 * - `apply(value)` — wrap a `Payload` into an `AnnotationValue` ready to
 *   pass to a lane terminal's variadic `annotations` argument.
 * - `read(plan)` — extract the `Payload` from a plan's `meta.annotations`
 *   if a value was previously written under this handle's namespace.
 *   Returns `undefined` when the annotation is absent or when the stored
 *   value is not a branded `AnnotationValue` (e.g. framework-internal
 *   metadata under the same namespace key).
 *
 * Handles are the only supported public entry point for reading and
 * writing annotations. Direct mutation of `plan.meta.annotations` is not
 * part of the public API.
 */
export interface AnnotationHandle<Payload, Kinds extends OperationKind> {
  readonly namespace: string;
  readonly applicableTo: ReadonlySet<Kinds>;
  apply(value: Payload): AnnotationValue<Payload, Kinds>;
  read(plan: {
    readonly meta: { readonly annotations?: Record<string, unknown> };
  }): Payload | undefined;
}

/**
 * Options accepted by `defineAnnotation`.
 *
 * `namespace` is the string key under which the annotation is stored in
 * `plan.meta.annotations`. **Reserved namespaces** include framework-
 * internal metadata keys; user handles must not use them:
 *
 * - `codecs` — used by the SQL emitter to record per-alias codec ids
 *   (`meta.annotations.codecs[alias] = 'pg/text@1'`); the SQL runtime's
 *   `decodeRow` reads from this key. A user `defineAnnotation('codecs')`
 *   handle is not structurally prevented, but its behavior with the
 *   emitter and the runtime is undefined and we make no compatibility
 *   guarantees about it.
 * - Target-specific keys such as `pg` (and equivalents on other
 *   targets) are similarly reserved for adapter / target use.
 *
 * `applicableTo` declares which operation kinds the annotation may attach
 * to. The lane terminals' type-level `ValidAnnotations<K, As>` gate rejects
 * annotations whose `Kinds` does not include the terminal's `K`; the
 * runtime helper `assertAnnotationsApplicable` does the equivalent at
 * runtime so casts and `any` cannot bypass the gate.
 */
export interface DefineAnnotationOptions<Kinds extends OperationKind> {
  readonly namespace: string;
  readonly applicableTo: readonly Kinds[];
}

/**
 * Defines a typed annotation handle.
 *
 * @example
 * ```typescript
 * // Read-only annotation. Lane terminals like `db.User.first(...)` accept
 * // it; `db.User.create(...)` rejects it at the type level.
 * const cacheAnnotation = defineAnnotation<{ ttl?: number; skip?: boolean }, 'read'>({
 *   namespace: 'cache',
 *   applicableTo: ['read'],
 * });
 *
 * // Write-only annotation. Mirror image.
 * const auditAnnotation = defineAnnotation<{ actor: string }, 'write'>({
 *   namespace: 'audit',
 *   applicableTo: ['write'],
 * });
 *
 * // Annotation applicable to both kinds (e.g. tracing).
 * const otelAnnotation = defineAnnotation<{ traceId: string }, 'read' | 'write'>({
 *   namespace: 'otel',
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
  const namespace = options.namespace;
  const applicableTo: ReadonlySet<Kinds> = Object.freeze(new Set(options.applicableTo));

  function apply(value: Payload): AnnotationValue<Payload, Kinds> {
    return Object.freeze({
      __annotation: true as const,
      namespace,
      value,
      applicableTo,
    });
  }

  function read(plan: {
    readonly meta: { readonly annotations?: Record<string, unknown> };
  }): Payload | undefined {
    const stored = plan.meta.annotations?.[namespace];
    if (!isAnnotationValue(stored)) {
      return undefined;
    }
    if (stored.namespace !== namespace) {
      // Defensive: a different handle wrote under our namespace key.
      return undefined;
    }
    return stored.value as Payload;
  }

  return Object.freeze({
    namespace,
    applicableTo,
    apply,
    read,
  });
}

/**
 * Type-level applicability gate consumed by lane terminals.
 *
 * Maps a tuple of `AnnotationValue`s to a tuple where each element either
 * keeps its annotation type (when the annotation's declared `Kinds`
 * includes the terminal's operation kind `K`) or resolves to `never`
 * (when the kinds are incompatible). A `never` element makes the entire
 * tuple unassignable, surfacing the mismatch as a type error at the call
 * site of the terminal.
 *
 * Lane terminals constrain their variadic `...annotations` parameter via
 * `ValidAnnotations<K, As>`:
 *
 * @example
 * ```typescript
 * class Collection<Row> {
 *   first<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
 *     where: WhereInput,
 *     ...annotations: ValidAnnotations<'read', As>
 *   ): Promise<Row | null>;
 *
 *   create<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
 *     input: CreateInput,
 *     ...annotations: ValidAnnotations<'write', As>
 *   ): Promise<Row>;
 * }
 *
 * db.User.first({ id }, cacheAnnotation.apply({ ttl: 60 }));
 * // ✓ cacheAnnotation declares 'read'; first() requires 'read'.
 *
 * db.User.create(input, cacheAnnotation.apply({ ttl: 60 }));
 * // ✗ cacheAnnotation declares 'read'; create() requires 'write'.
 * //   Element resolves to `never` → tuple unassignable → type error.
 * ```
 *
 * The runtime helper `assertAnnotationsApplicable` covers the equivalent
 * check at runtime so casts and `any` cannot bypass this gate.
 */
export type ValidAnnotations<
  K extends OperationKind,
  As extends readonly AnnotationValue<unknown, OperationKind>[],
> = {
  readonly [I in keyof As]: As[I] extends AnnotationValue<infer P, infer Kinds>
    ? K extends Kinds
      ? AnnotationValue<P, Kinds>
      : never
    : never;
};

/**
 * Runtime applicability gate. Throws `RUNTIME.ANNOTATION_INAPPLICABLE` if
 * any annotation in `annotations` declares an `applicableTo` set that does
 * not include `kind`. Used by lane terminals (SQL DSL builders' `.build()`,
 * ORM `Collection` terminals) to fail closed when the type-level
 * `ValidAnnotations` gate is bypassed via cast / `any` / dynamic
 * invocation.
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
 * annotations (created via `defineAnnotation(...).apply(...)`) from
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
