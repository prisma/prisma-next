import {
  ANNOTATION_BUILDER,
  type AnnotationBuilder,
  type AnnotationValue,
  type OperationKind,
} from '@prisma-next/framework-components/runtime';

/**
 * Normalizes the return value of a lane-terminal `.annotate(callback)`
 * callback. Two shapes are accepted:
 *
 * 1. A branded `AnnotationBuilder` (carries the
 *    `[ANNOTATION_BUILDER]: true` symbol) \u2014 the framework reads its
 *    `values` array.
 * 2. A `readonly AnnotationValue[]` \u2014 used as-is. This is the array
 *    escape hatch for callers that imported a handle directly and
 *    invoked it outside the registry-driven builder.
 *
 * Anything else throws (defensive \u2014 the type system rejects it
 * already, so this only fires on cast-bypass or dynamic invocation).
 */
export function extractAnnotationValues(
  result:
    | AnnotationBuilder<OperationKind, unknown>
    | readonly AnnotationValue<unknown, OperationKind>[],
): readonly AnnotationValue<unknown, OperationKind>[] {
  if (isAnnotationBuilder(result)) {
    return result.values;
  }
  if (Array.isArray(result)) {
    return result;
  }
  throw new Error(
    `.annotate(callback) returned an unexpected value: expected the meta builder or a readonly array of AnnotationValues`,
  );
}

function isAnnotationBuilder(value: unknown): value is AnnotationBuilder<OperationKind, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return (value as Record<symbol, unknown>)[ANNOTATION_BUILDER] === true;
}
