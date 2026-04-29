import { ANNOTATION_BUILDER, type AnnotationRegistry } from './annotation-registry';
import type { AnnotationBuilder, AnnotationValue, OperationKind } from './annotations';

/**
 * Constructs a kind-filtered, chainable builder backed by an
 * `AnnotationRegistry`. Lane terminals call `createMetaBuilder(registry,
 * kind)` once per `.annotate(callback)` invocation; the user-supplied
 * callback receives the resulting builder, invokes its kind-applicable
 * methods, and returns either the final builder or a `ReadonlyArray<
 * AnnotationValue>` (the array escape hatch).
 *
 * Implementation notes:
 *
 * - The set of methods is precomputed once per call from the registry
 *   filtered by `kind` (handles whose `applicableTo` does not include
 *   `kind` are dropped).
 * - Each method body extends the immutable `values` array by one entry,
 *   producing a new frozen builder. The previous builder is never
 *   mutated; chained calls compose by returning fresh objects.
 * - The returned object carries `[ANNOTATION_BUILDER]: true` (the brand
 *   symbol) so the lane terminal can distinguish it from a user-
 *   supplied `ReadonlyArray<AnnotationValue>`.
 *
 * The returned type is widened to `AnnotationBuilder<K, Reg>` even
 * though the closure has no static knowledge of `Reg`. The underlying
 * methods come from the registry at runtime; the static `Reg` type is
 * supplied by the caller's generic.
 */
export function createMetaBuilder<K extends OperationKind, Reg = unknown>(
  registry: AnnotationRegistry,
  kind: K,
): AnnotationBuilder<K, Reg> {
  const handles = registry.entries();
  const applicable = Object.entries(handles).filter(([, handle]) => handle.applicableTo.has(kind));

  function makeBuilder(values: readonly AnnotationValue<unknown, OperationKind>[]): object {
    const builder: Record<string | symbol, unknown> = { values };
    for (const [name, handle] of applicable) {
      builder[name] = (payload: unknown): object => {
        const produced = handle(payload);
        return makeBuilder([...values, produced]);
      };
    }
    builder[ANNOTATION_BUILDER] = true;
    return Object.freeze(builder);
  }

  // The returned shape carries the registry-derived methods, the
  // `values` array, and the `[ANNOTATION_BUILDER]` brand. The static
  // `AnnotationBuilder<K, Reg>` type asserts the structural surface
  // matching `Reg`; the runtime fills in only the kind-applicable
  // subset, which is the same set the type filter produces.
  return makeBuilder([]) as unknown as AnnotationBuilder<K, Reg>;
}
