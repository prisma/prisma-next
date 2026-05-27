/**
 * Type-checked, runtime pass-through alternative to a bare `as Type` cast.
 *
 * Use `castAs` when the value already satisfies the target type but you want to make
 * the type assertion explicit at the call site — for example, when an inferred type is
 * wider than the type you want to publish, or when a literal object should be tagged
 * with its nominal interface. Unlike {@link blindCast}, the compiler still checks that
 * the value is assignable to the target type, so this helper cannot smuggle in an
 * unsafe assertion.
 *
 * `castAs` exists alongside `blindCast` so authors pick the right name at the call
 * site: a `castAs` is type-checked and benign; a `blindCast` is the unsafe escape
 * hatch. The split makes review faster — readers know which casts to scrutinize and
 * which are pure annotations.
 *
 * @example
 * ```typescript
 * interface FancyObject {
 *   key: string;
 *   keyTwo: {
 *     subKey: string;
 *     subKeyTwo: number;
 *   };
 * }
 *
 * const typedObject = castAs<FancyObject>({
 *   key: 'Chookede',
 *   keyTwo: {
 *     subKey: 'Choookeeeee',
 *     subKeyTwo: 2,
 *   },
 * });
 * ```
 *
 * @typeParam Type - The type to constrain and tag the value with. The value must be assignable to `Type`.
 */
export function castAs<Type>(value: Type): Type {
  return value;
}
