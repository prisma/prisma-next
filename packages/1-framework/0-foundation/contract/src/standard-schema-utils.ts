import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Type as ArkType } from 'arktype';

/**
 * Adapt an arktype `Type` to a typed `StandardSchemaV1<P>` for the
 * framework's codec params slot.
 *
 * arktype's inferred input/output types frequently don't align with the
 * framework's optional+readonly params shape — e.g. arktype infers
 * `{ length: number }` from `{ length: 'number.integer > 0' }` (the
 * key is required), but codec descriptors model the same field as
 * `{ readonly length?: number }` (optional + readonly, matching the
 * runtime call boundary where params come from JSON-deserialized
 * `typeParams` and may be omitted).
 *
 * This helper absorbs the cast in one place so codec authors at the SQL
 * / target / extension layers don't sprinkle `as unknown as
 * StandardSchemaV1<P>` casts at every parameterized codec definition.
 *
 * The validator's runtime behavior is preserved: it still runs the same
 * arktype JSON-boundary checks. Only the static type is widened to the
 * framework's params shape; the cast is type-only and behaviour-
 * preserving.
 */
export function arktypeParamsSchema<P>(arkType: ArkType<unknown>): StandardSchemaV1<P> {
  return arkType as unknown as StandardSchemaV1<P>;
}
