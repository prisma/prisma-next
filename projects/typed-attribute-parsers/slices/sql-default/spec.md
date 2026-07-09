# Slice: sql-default

_(In-project slice. Parent: `projects/typed-attribute-parsers/`. Split out of the `sql-attributes` slice mid-flight — see that slice's Open Question 1. Outcome it contributes: `@default` becomes spec-driven, completing "every SQL attribute validates its arguments through the kit".)_

## At a glance

Migrate the SQL `@default` attribute off its hand-written string parsers (`parseDefaultLiteralValue`, `parseDefaultFunctionCall`, `parseListDefaultExpression`) onto a declarative `AttributeSpec`, growing the kit with the pieces `@default` needs — a scalar-literal leaf and a registry-parameterised `funcCall` leaf. `@default` is the long pole of the SQL migration: it is the only SQL attribute whose value is a *choice* of literal / array-literal / function-call, and it hands function calls to the existing `ControlMutationDefaultRegistry`.

## Chosen design

The `@default` value is one positional argument that is exactly one of three argument shapes. Model it as a `oneOf` whose arms produce a **tagged** result so the interpreter can branch without re-inspecting the AST:

```ts
fieldAttribute('default', {
  positional: [
    {
      key: 'value',
      type: oneOf(
        scalarLiteral(),          // → { kind: 'literal', value: string | number | boolean }
        list(scalarLiteral()),    // → (string | number | boolean)[]  (array-literal default)
        funcCall(),               // → { kind: 'call', call: ParsedDefaultFunctionCall }
      ),
    },
  ],
})
```

**Only argument *syntax* moves to the spec.** Every *semantic* rule stays in `lowerDefaultForField` (`psl-column-resolution.ts`): the list-field-requires-array rule (`PSL_LIST_DEFAULT_NOT_ARRAY`), registry lowering (`lowerDefaultFunctionWithRegistry`, `PSL_UNKNOWN_DEFAULT_FUNCTION`), generator applicability + codec matching (`PSL_INVALID_DEFAULT_APPLICABILITY`), and the exactly-one-positional rule. The interpreter switches on the tagged `oneOf` output and applies those checks exactly as today.

**Kit growth** (in `@prisma-next/psl-parser`):
- `scalarLiteral()` — a `String`/`Number`/`Boolean` literal AST → a tagged scalar value. (The decoded value, via the AST's `.value()`, never re-slicing text.)
- `funcCall()` — a `FunctionCallAst` → a `ParsedDefaultFunctionCall` (name + each argument's rendered source text + spans). It is **registry-agnostic**: it performs no name/registry validation, so the framework kit never imports the SQL `ControlMutationDefaultRegistry`. The interpreter hands the parsed call straight to the existing `lowerDefaultFunctionWithRegistry`, which keeps the registry lookup, `PSL_UNKNOWN_DEFAULT_FUNCTION`, applicability, and lowering. (A `funcCallFrom(registry)` decorator was considered and dropped — see Design note.)
- Array defaults reuse the existing `list()` combinator over `scalarLiteral()`.

The list-vs-scalar precedence that `oneOf` gives (scalar → array → call) matches the current fall-through in `lowerDefaultForField`.

**Design note — `funcCall` vs `funcCallFrom` (resolved).** A registry-parameterised `funcCallFrom(registry)` could be built as a thin decorator over `funcCall()` (parse the call, then check `registry.has(name)`). It was dropped: Option A keeps `PSL_UNKNOWN_DEFAULT_FUNCTION` semantic in `lowerDefaultFunctionWithRegistry`, so a parse-time registry check would duplicate a check that must stay in the interpreter — and it would force the framework kit to import the SQL default registry (a layering smell). Plain registry-agnostic `funcCall()` is the whole kit surface `@default` needs.

## Coherence rationale

One outcome — "`@default` is spec-driven; the three default string-parsers are deleted; the SQL family is now entirely spec-driven." The kit growth (`scalarLiteral`, `funcCall`/`funcCallFrom`) exists only to serve `@default`. Sized as its own PR precisely because it introduces the kit's first registry-parameterised combinator and preserves six semantic diagnostic codes — bundling it into `sql-attributes` would have pushed that PR past a single coherent review.

## Scope

**In:** the `@default` spec + interpret wiring; the `scalarLiteral` + `funcCall`/`funcCallFrom` combinators (with unit tests); reuse of `list()` for array defaults; deletion of `parseDefaultLiteralValue`, `parseDefaultFunctionCall`, `parseListDefaultExpression` (+ their private helpers `decodeLiteralElement`, the `ListDefaultParse` type) once `@default` no longer calls them.

**Out:**
- **Bare enum-member defaults** (`@default(SomeEnumValue)`) — not currently supported or tested; this is a migration, not a new feature. Do NOT add enum-member parsing.
- **The string-based registry internals** — `lowerDefaultFunctionWithRegistry` and the registry entries keep parsing `arg.raw` strings; `funcCall` feeds them the same `ParsedDefaultFunctionCall` shape they consume today.
- **The interpreter's semantic checks** — list-vs-scalar, registry lowering, applicability, codec matching, exactly-one-positional — all stay.
- **Mongo `@default`** — slice 3.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| List field `@default([...])` vs scalar | Semantic; stays in interpreter | The spec accepts both `scalarLiteral` and `list(scalarLiteral)`; the `isList` + `PSL_LIST_DEFAULT_NOT_ARRAY` rule stays in `lowerDefaultForField`. |
| Function default (`now()`, `autoincrement()`, `dbgenerated(...)`) | `funcCall` builds `ParsedDefaultFunctionCall`; registry lowers it | Registry-parameterised; preserve `PSL_UNKNOWN_DEFAULT_FUNCTION` and the "Supported functions: …" message. |
| Generator applicability / codec matching | Semantic; stays | `PSL_INVALID_DEFAULT_APPLICABILITY` + the preset-only-generator guard stay in `lowerDefaultForField`. |
| `@default(garbage)` (a bare identifier — not literal/array/func) | Now `PSL_INVALID_ATTRIBUTE_SYNTAX` (was `PSL_INVALID_DEFAULT_VALUE`) | **Resolved (operator: Option A)** — arg-shape errors unify under the kit syntax code; the semantic default codes are preserved. Update the test(s) asserting the old `PSL_INVALID_DEFAULT_VALUE` for this case. |
| `#906` native enums | No interaction | Native-enum *types* (`native_enum`/`pg.enum`) changed column resolution, not `@default` lowering; `lowerDefaultForField` is unchanged on current `main`. |

## Slice-specific done conditions

- [ ] `@default` is validated + lowered via a spec through `interpretAttribute`; the tagged `oneOf` output drives the interpreter's existing semantic branches.
- [ ] `parseDefaultLiteralValue`, `parseDefaultFunctionCall`, `parseListDefaultExpression` deleted (`rg` each → zero); the registry + `lowerDefaultFunctionWithRegistry` retained.
- [ ] Semantic default codes preserved (`PSL_UNKNOWN_DEFAULT_FUNCTION`, `PSL_INVALID_DEFAULT_APPLICABILITY`, `PSL_LIST_DEFAULT_NOT_ARRAY`, exactly-one-positional); arg-shape errors may become `PSL_INVALID_ATTRIBUTE_SYNTAX` (pending Open Question 1).
- [ ] `pnpm fixtures:check` clean; `interpreter.defaults.test.ts` green; vocab green (kit growth may move the threshold — bump to the new count if so).

## Open Questions

_None open._ Both design questions are resolved: (1) `@default(garbage)` → `PSL_INVALID_ATTRIBUTE_SYNTAX` (operator: Option A); (2) `funcCallFrom` dropped in favour of registry-agnostic `funcCall()` (see Design note).

## References

- Parent project: `projects/typed-attribute-parsers/spec.md`; sibling slice: `slices/sql-attributes/` (the generic wrappers + `sql-attribute-specs.ts` plumbing this slice reuses).
- Current `@default` code: `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` (`lowerDefaultForField`, `parseDefaultLiteralValue`, `parseListDefaultExpression`); `default-function-registry.ts` (`parseDefaultFunctionCall`, `lowerDefaultFunctionWithRegistry`, `ParsedDefaultFunctionCall`).
- Kit: `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/**`.
- Tests: `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.test.ts` (24 cases).
