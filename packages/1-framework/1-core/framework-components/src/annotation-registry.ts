import type { AnnotationHandle, AnyAnnotationHandle, OperationKind } from './annotations';

/**
 * Brand symbol used by `AnnotationBuilder` instances to distinguish
 * themselves from `ReadonlyArray<AnnotationValue>` returns of the
 * lane-terminal `.annotate(callback)` callback. Lane terminals
 * normalize the callback's return value:
 *
 * - if the value carries `[ANNOTATION_BUILDER]: true`, the framework
 *   reads its `values` array;
 * - if the value is a `ReadonlyArray<AnnotationValue>`, the framework
 *   uses it as-is.
 *
 * The symbol is the simplest brand mechanic and parallels the existing
 * `AnnotationValue.__annotation` brand on user annotations.
 */
export const ANNOTATION_BUILDER: unique symbol = Symbol.for(
  '@prisma-next/framework-components/AnnotationBuilder',
);

/**
 * Family-agnostic registry of annotation handles. Mirrors
 * `OperationRegistry` from `@prisma-next/operations` in shape and
 * lifecycle: built once at runtime construction, walked at lane-
 * terminal `.annotate(...)` time to derive the kind-filtered builder.
 *
 * Registration semantics:
 *
 * - **By identity, same handle.** Re-registering the same handle (`===`)
 *   is a silent no-op so two middleware can both list the same handle
 *   without forcing the runtime to reject the configuration.
 * - **By name, different handle.** Registering a different handle
 *   under a name already in use throws — the error message names the
 *   conflicting registry key so the misconfiguration is immediately
 *   actionable.
 *
 * `register` accepts the storage-friendly `AnyAnnotationHandle`. Every
 * concrete `AnnotationHandle<Payload, Kinds>` is structurally assignable
 * to `AnyAnnotationHandle` (its widened parameter / return positions
 * accommodate any `Payload`/`Kinds`), so call sites can pass a typed
 * handle without a cast.
 *
 * The framework owns assembly: `RuntimeCore` walks `options.middleware`
 * at construction time, calls `registry.register(handle)` for every
 * handle in every middleware's `annotations` field, and exposes the
 * resulting registry as `this.annotationRegistry`.
 */
export interface AnnotationRegistry {
  register(handle: AnyAnnotationHandle): void;
  entries(): Readonly<Record<string, AnnotationHandle<unknown, OperationKind>>>;
}

/**
 * Constructs a fresh, mutable `AnnotationRegistry`. Used by family
 * runtimes (`createRuntime` in `sql-runtime`, `createMongoRuntime` in
 * `mongo-runtime`) to assemble the middleware-contributed registry
 * once per runtime instance.
 */
export function createAnnotationRegistry(): AnnotationRegistry {
  const handles: Record<string, AnnotationHandle<unknown, OperationKind>> = Object.create(null);

  return {
    register(handle) {
      const name = handle.name;
      // Cast widens the storage-friendly `AnyAnnotationHandle` to the
      // entry-side `AnnotationHandle<unknown, OperationKind>` shape
      // exposed via `entries()`. Reading consumers only call the handle
      // with `unknown` payloads (the runtime layer treats payloads as
      // opaque), so the wider entry-side type is sound.
      const stored = handle as unknown as AnnotationHandle<unknown, OperationKind>;
      const existing = handles[name];
      if (existing !== undefined) {
        if (existing === stored) {
          return;
        }
        throw new Error(`Annotation "${name}" is already registered with a different handle`);
      }
      handles[name] = stored;
    },
    entries() {
      return Object.freeze({ ...handles });
    },
  };
}
