# Slice: sql-default

_(In-project slice. Parent: `projects/typed-attribute-parsers/`. Split out of the `sql-attributes` slice mid-flight — see that slice's Open Question 1. Outcome it contributes: `@default` becomes spec-driven on **both** its lowering paths, completing "every SQL attribute validates its arguments through the kit".)_

## At a glance

Migrate the SQL `@default` attribute off its hand-written string parsers onto declarative `AttributeSpec`s. `@default` is the long pole of the SQL migration and has **two** lowering paths, selected by field type:

- **Non-enum fields** (`lowerDefaultForField`, `psl-column-resolution.ts`) — the value is a scalar literal, an array literal, or a function call, parsed today by `parseDefaultLiteralValue` / `parseListDefaultExpression` / `parseDefaultFunctionCall`.
- **Enum-typed fields** (`lowerEnumDefaultForField`, `psl-field-resolution.ts`) — the value is a bare enum-member identifier (`@default(ADMIN)`), parsed today by inline regex checks.

Both migrate in this slice.

## Chosen design

> **Design evolution (operator direction, in-PR).** D1–D4 first shipped two **static** specs with monolithic stand-ins (`scalarLiteral()`, a generic `funcCall()`, `bareIdentifier()`) plus interpreter post-validation. Per operator direction and the #938 review, the slice then evolves — **still within this PR** — to **dynamically composed** specs built per field. The dynamic design below is the slice's final shape; the static stand-ins are removed by the end (D7).

The `@default` spec is **built per field** by `buildDefaultSpec(ctx)` / `buildEnumDefaultSpec(members)`, composed entirely from atomic combinators via `oneOf`, using the field's resolved context (the composed default-function registry, `isList`, and the enum's members). This lifts function-name and enum-member validity **into the grammar** — reducing post-validation — and makes each per-field spec a precise description a future language server can read for autocomplete.

**Non-enum** (built from `{ isList, registry }`):

```ts
oneOf(
  str(), int(), bool(),                                    // flexible literals (codec still type-checks the value)
  ...(isList ? [list(oneOf(str(), int(), bool()))] : []),  // list arm ONLY on list fields
  ...[...registry.keys()].map((name) => funcCall(name)),   // one arm per registered default function
)
```

**Enum** (built from `enumHandle.enumMembers`):

```ts
oneOf(...enumMembers.map((m) => identifier(m.name)))       // e.g. Expected one of: Low | High
```

**Key design points:**
- **`funcCall(name)` replaces the generic `funcCall()`; no `funcCallFrom`.** A name-pinned `funcCall(name)` (parallel to `identifier(name)`) matches a call with that callee and captures **raw args** (flexible — `lowerDefaultFunctionWithRegistry` still validates them). `oneOf(...registry.keys().map(funcCall))`, built dynamically, enumerates the open contributed set — the composition that makes the ADR's bespoke `funcCallFrom` unnecessary (ADR principle 4). The matched arm *is* the `fn` discriminant.
- **Enum defaults are `oneOf(identifier(member)…)`** from the members — dropping `bareIdentifier()` and folding member-validity into the grammar (resolves the #938 review comment).
- **Literals stay flexible**, composed as `oneOf(str(), int(), bool())` — dropping `scalarLiteral()` for composition of atoms (resolves the other #938 comment). No codec-typed matching (`matchingScalarLiteral` is out — Non-goals); the codec's `encodeJson` remains the literal↔type authority.
- **The `list` arm is present only on list fields** (and is the only value arm there), so array-on-scalar and scalar-on-list are grammar misses — dissolving the `isList` shape-switch and its `PSL_LIST_DEFAULT_NOT_ARRAY` / array-on-scalar `PSL_INVALID_DEFAULT_VALUE` special cases.

**What stays semantic (in the interpreter):** function **arg** validation (`PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT`, via the registry), generator applicability + codec matching + preset-only guard (`PSL_INVALID_DEFAULT_APPLICABILITY`), and literal↔codec type (codec `encodeJson`). **Moved into the grammar** (Open Question 1): unknown-function-name (`PSL_UNKNOWN_DEFAULT_FUNCTION`) and unknown-enum-member (`PSL_ENUM_UNKNOWN_DEFAULT_MEMBER`).

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

_Resolved:_ (1) both lowering paths in scope (operator); (2) shape-error codes → `PSL_INVALID_ATTRIBUTE_SYNTAX` (operator: Option A); (3) `funcCallFrom` dropped for `oneOf(funcCall(name))` composed dynamically from the registry (operator); (4) literals stay flexible — `matchingScalarLiteral` deferred, codec `encodeJson` remains the value authority (operator).

_Open (needed before D5):_

1. **Do `PSL_UNKNOWN_DEFAULT_FUNCTION` and `PSL_ENUM_UNKNOWN_DEFAULT_MEMBER` shift to `PSL_INVALID_ATTRIBUTE_SYNTAX`?** The dynamic spec moves both membership checks into the grammar (goal: less post-validation); `oneOf`'s "Expected one of: …" message preserves the helpful supported-set list. Recommendation: **yes, shift them** and retire the interpreter's duplicate checks. Alternative: keep the semantic codes and use the dynamic spec only for structure + autocomplete (less reduction). Needs operator confirmation.
2. **ADR 231 update.** The dynamic design drops the ADR's `funcCallFrom` for `oneOf(funcCall(name))` and defers `matchingScalarLiteral`. Decide whether D7 amends ADR 231 (§ "Alternatives and function calls") or records the deviation elsewhere (ADR currently left untouched by operator instruction).

## References

- Parent project: `projects/typed-attribute-parsers/spec.md`; sibling slice `slices/sql-attributes/` (the generic `interpretFieldAttribute` wrapper + `sql-attribute-specs.ts` plumbing this slice reuses).
- Non-enum path: `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` (`lowerDefaultForField`, `parseDefaultLiteralValue`, `parseListDefaultExpression`); `default-function-registry.ts` (`parseDefaultFunctionCall`, `lowerDefaultFunctionWithRegistry`, `ParsedDefaultFunctionCall`).
- Enum path: `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts` (`lowerEnumDefaultForField`).
- Kit: `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/**`.
- Tests: `interpreter.defaults.test.ts` (non-enum, 24 cases) + the enum-default cases in `interpreter.enum.test.ts`.
