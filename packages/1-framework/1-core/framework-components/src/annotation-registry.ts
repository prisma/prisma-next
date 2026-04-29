import type { AnnotationHandle, OperationKind } from './annotations';

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
 * `register` is generic over the handle's `Payload` and `Kinds`
 * parameters. `AnnotationHandle<Payload, Kinds>` is a callable type, so
 * `Payload` is contravariant on the function-parameter side; widening
 * `AnnotationHandle<{ ttl: number }, 'read'>` to
 * `AnnotationHandle<unknown, OperationKind>` is structurally rejected
 * by TypeScript. The generic `register` keeps the call site's typing
 * intact; storage internally uses the loose `AnnotationHandle<unknown,
 * OperationKind>` shape via a one-time cast (the cast is safe because
 * the registry never invokes a handle on its own — callers that invoke
 * a stored handle only ever pass it `unknown` payloads).
 *
 * The framework owns assembly: `RuntimeCore` walks `options.middleware`
 * at construction time, calls `registry.register(handle)` for every
 * handle in every middleware's `annotations` field, and exposes the
 * resulting registry as `this.annotationRegistry`.
 */
export interface AnnotationRegistry {
  register<P, K extends OperationKind>(handle: AnnotationHandle<P, K>): void;
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
    register<P, K extends OperationKind>(handle: AnnotationHandle<P, K>): void {
      const name = handle.name;
      // Cast widens AnnotationHandle<P, K> to AnnotationHandle<unknown,
      // OperationKind> for uniform storage. AnnotationHandle's callable
      // parameter is contravariant on Payload, so the widening cannot be
      // expressed without `as unknown as`. Safe at runtime because
      // JavaScript does not enforce parameter narrowing — the handle's
      // closure body uses the original concrete `P` regardless.
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
