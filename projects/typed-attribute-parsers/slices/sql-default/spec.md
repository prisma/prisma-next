# Slice: sql-default

_(In-project slice. Parent: `projects/typed-attribute-parsers/`. Split out of the `sql-attributes` slice mid-flight — see that slice's Open Question 1. Outcome it contributes: `@default` becomes spec-driven on **both** its lowering paths, completing "every SQL attribute validates its arguments through the kit".)_

## At a glance

Migrate the SQL `@default` attribute off its hand-written string parsers onto declarative `AttributeSpec`s. `@default` is the long pole of the SQL migration and has **two** lowering paths, selected by field type:

- **Non-enum fields** (`lowerDefaultForField`, `psl-column-resolution.ts`) — the value is a scalar literal, an array literal, or a function call, parsed today by `parseDefaultLiteralValue` / `parseListDefaultExpression` / `parseDefaultFunctionCall`.
- **Enum-typed fields** (`lowerEnumDefaultForField`, `psl-field-resolution.ts`) — the value is a bare enum-member identifier (`@default(ADMIN)`), parsed today by inline regex checks.

Both migrate in this slice.

## Chosen design

Two specs, one per path, both named `'default'`; the caller already branches on the field's `enumHandle` (`psl-field-resolution.ts` ~line 470) and picks the matching spec. **Only argument *syntax* moves to specs; every *semantic* rule stays in the interpreter.**

**Non-enum spec** — the value is one of three shapes, distinguished by the interpreter via the `oneOf` output's runtime shape:

```ts
fieldAttribute('default', {
  positional: [
    {
      key: 'value',
      type: oneOf(
        scalarLiteral(),          // → string | number | boolean (a literal default)
        list(scalarLiteral()),    // → (string | number | boolean)[] (an array-literal default)
        funcCall(),               // → ParsedDefaultFunctionCall (a function default)
      ),
    },
  ],
})
```

The interpreter switches on the shape (primitive → literal, array → list, object → registry path) and keeps every semantic rule in `lowerDefaultForField`: the `isList` + `PSL_LIST_DEFAULT_NOT_ARRAY` rule, registry lowering (`lowerDefaultFunctionWithRegistry`, `PSL_UNKNOWN_DEFAULT_FUNCTION`), generator applicability + codec matching + preset-only guard (`PSL_INVALID_DEFAULT_APPLICABILITY`).

**Enum spec** — the value is a single bare identifier (the member name):

```ts
fieldAttribute('default', { positional: [{ key: 'member', type: bareIdentifier() }] })
```

The interpreter matches the extracted member name against `enumHandle.enumMembers` (keeping `PSL_ENUM_UNKNOWN_DEFAULT_MEMBER`). The "must be a member name, not a raw value or function" shape-check (`PSL_ENUM_DEFAULT_MUST_BE_MEMBER_NAME`) is now enforced by the spec: a quoted string / function-call / array in an enum `@default` fails the `bareIdentifier()` matcher with the kit's `PSL_INVALID_ATTRIBUTE_SYNTAX`.

**Kit growth** (in `@prisma-next/psl-parser`):
- `scalarLiteral()` — `String`/`Number`/`Boolean` literal → its decoded value. **(Shipped in D1.)**
- `funcCall()` — `FunctionCallAst` → `ParsedDefaultFunctionCall` (registry-agnostic; the kit does not import the SQL registry). **(Shipped in D1.)**
- `bareIdentifier()` — a bare `IdentifierAst` → its text, with a neutral label ("an identifier"); no validation (member-existence stays semantic). **(D3.)** A generic leaf, not enum-specific — the framework kit must not know about "enum members".
- Array defaults reuse the existing `list()`.

**Design note — `funcCall` vs `funcCallFrom` (resolved).** `funcCallFrom(registry)` could be a thin decorator over `funcCall()`, but it was dropped: Option A keeps `PSL_UNKNOWN_DEFAULT_FUNCTION` semantic in the interpreter, so a parse-time registry check would duplicate it — and it would force the framework kit to import the SQL default registry (a layering smell). Registry-agnostic `funcCall()` is the whole kit surface the function path needs.

## Coherence rationale

One outcome — "`@default` is spec-driven on both paths; the default string-parsers (three non-enum + the enum inline regex checks) are deleted; the SQL family is now entirely spec-driven." Sized as its own PR because it introduces the kit's first structured-call combinator and preserves the most semantic diagnostic codes of any SQL attribute.

## Scope

**In:** the non-enum `defaultSpec` + enum `enumDefaultSpec`; the interpret wiring in `lowerDefaultForField` + `lowerEnumDefaultForField`; the `scalarLiteral` + `funcCall` (D1) and `bareIdentifier` (D3) combinators with unit tests; reuse of `list()`; deletion of `parseDefaultLiteralValue`, `parseDefaultFunctionCall`, `parseListDefaultExpression` (+ `decodeLiteralElement`, the `ListDefaultParse` type) and the inline regex checks in `lowerEnumDefaultForField`.

**Out:**
- **The string-based registry internals** — `lowerDefaultFunctionWithRegistry` and its entries keep parsing `arg.raw`; `funcCall` feeds them the same `ParsedDefaultFunctionCall` shape.
- **The interpreter's semantic checks** — list-vs-scalar, registry lowering, applicability, codec matching, exactly-one-positional, and enum-member matching — all stay.
- **Mongo `@default`** — slice 3 (family).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Field type selects the path | Caller already branches on `enumHandle` | Non-enum → `defaultSpec`; enum → `enumDefaultSpec`. Two spec objects, both named `'default'`. |
| Non-enum list `@default([...])` vs scalar | Semantic; stays | `isList` + `PSL_LIST_DEFAULT_NOT_ARRAY` stay in `lowerDefaultForField`. |
| Function default (`now()`, `dbgenerated("…")`) | `funcCall` → `ParsedDefaultFunctionCall`; registry lowers | `funcCall` renders each arg's **verbatim source text** (quotes preserved — `dbgenerated`'s handler re-parses the quoted string). Preserve `PSL_UNKNOWN_DEFAULT_FUNCTION`. |
| Generator applicability / codec matching | Semantic; stays | `PSL_INVALID_DEFAULT_APPLICABILITY` + preset-only guard stay. |
| Enum member not in the enum | Semantic; stays | `PSL_ENUM_UNKNOWN_DEFAULT_MEMBER` stays (interpreter matches against `enumHandle`). |
| `@default(garbage)` on a non-enum field | Now `PSL_INVALID_ATTRIBUTE_SYNTAX` (was `PSL_INVALID_DEFAULT_VALUE`) | Operator: Option A. Update the asserting test(s). |
| `@default("x")` / `@default(fn())` on an enum field | Now `PSL_INVALID_ATTRIBUTE_SYNTAX` (was `PSL_ENUM_DEFAULT_MUST_BE_MEMBER_NAME`) | Operator: Option A — the shape-check moves into the `bareIdentifier()` matcher. `PSL_ENUM_UNKNOWN_DEFAULT_MEMBER` (a real member miss) is unchanged. |
| `#906` native enums | No interaction with lowering | Native-enum *types* changed column resolution, not `@default` lowering; both lowering functions are unchanged on current `main`. |

## Slice-specific done conditions

- [ ] Both `@default` paths validated + lowered via specs through `interpretAttribute`.
- [ ] `parseDefaultLiteralValue`, `parseDefaultFunctionCall`, `parseListDefaultExpression` deleted (`rg` each → zero); `lowerEnumDefaultForField`'s inline `isQuotedString`/`isFunctionCall` regex checks gone. Registry + `lowerDefaultFunctionWithRegistry` + `enumHandle` matching retained.
- [ ] Semantic codes preserved: `PSL_UNKNOWN_DEFAULT_FUNCTION`, `PSL_INVALID_DEFAULT_APPLICABILITY`, `PSL_LIST_DEFAULT_NOT_ARRAY`, `PSL_ENUM_UNKNOWN_DEFAULT_MEMBER`. Shape-error codes (`PSL_INVALID_DEFAULT_VALUE`, `PSL_ENUM_DEFAULT_MUST_BE_MEMBER_NAME`) shift to `PSL_INVALID_ATTRIBUTE_SYNTAX` (operator: Option A).
- [ ] `pnpm fixtures:check` clean; `interpreter.defaults.test.ts` + the enum-default tests green; vocab green (bump threshold if kit growth moves it).

## Open Questions

_None open._ Resolved: (1) both lowering paths in scope (operator); (2) shape-error codes → `PSL_INVALID_ATTRIBUTE_SYNTAX`, semantic codes preserved (operator: Option A); (3) `funcCallFrom` dropped for registry-agnostic `funcCall()`.

## References

- Parent project: `projects/typed-attribute-parsers/spec.md`; sibling slice `slices/sql-attributes/` (the generic `interpretFieldAttribute` wrapper + `sql-attribute-specs.ts` plumbing this slice reuses).
- Non-enum path: `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` (`lowerDefaultForField`, `parseDefaultLiteralValue`, `parseListDefaultExpression`); `default-function-registry.ts` (`parseDefaultFunctionCall`, `lowerDefaultFunctionWithRegistry`, `ParsedDefaultFunctionCall`).
- Enum path: `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts` (`lowerEnumDefaultForField`).
- Kit: `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/**`.
- Tests: `interpreter.defaults.test.ts` (non-enum, 24 cases) + the enum-default cases in `interpreter.enum.test.ts`.
