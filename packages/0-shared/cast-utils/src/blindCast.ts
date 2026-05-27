/**
 * **Last-resort escape hatch for unsafe type assertions. Not a sanctioned tool to reach for.**
 *
 * Before reaching for `blindCast`, **rewrite the surrounding code so the cast becomes
 * unnecessary**: tighten an input type, add a runtime check that narrows via a type
 * predicate, restructure a generic so the compiler can see the relationship you're
 * asserting, or use {@link castAs} when the value already satisfies the target type.
 * Only when no rewrite is feasible does `blindCast` become the right answer — and at
 * that point, the `Reason` literal you supply must articulate the compromise in
 * language a reviewer can evaluate.
 *
 * The reviewer **will** validate the `Reason`. If it doesn't hold up under scrutiny,
 * that is not a signal to soften the reason; it is a signal to go back and solve the
 * underlying type-system problem properly. An unconvincing justification is rework,
 * not a free pass.
 *
 * `blindCast` is the auditable form of `as Foo` / `as unknown as Foo`: it bypasses
 * the compiler's checks (the input type is `unknown`, the output type is whatever the
 * caller asks for), but it forces the unsafety to be named at the call site instead of
 * smuggled in via a bare `as`. The `Reason` type parameter exists only at compile
 * time — it is not present in the emitted JavaScript — but it is grep-able and
 * visible to future readers.
 *
 * @example
 * ```typescript
 * const stringValue = blindCast<
 *   string,
 *   "JSON.parse returns `unknown`; this field is documented to be a string in the API contract"
 * >(parsed[key]);
 * ```
 *
 * @typeParam TargetType - The type the caller is asserting the input has.
 * @typeParam _Reason - A string literal describing why bypassing the type system is necessary here.
 *                     Only meaningful at compile time. The reviewer evaluates whether it justifies the unsafety.
 */
export function blindCast<TargetType, _Reason extends string>(input: unknown): TargetType {
  return input as TargetType;
}
