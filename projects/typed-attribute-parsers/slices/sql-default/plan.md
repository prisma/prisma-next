# Slice: sql-default — Dispatch plan

**Slice spec:** `projects/typed-attribute-parsers/slices/sql-default/spec.md`

Three dispatches: grow the kit (D1, proven in isolation), migrate the non-enum `@default` path (D2), then the enum `@default` path + its small kit leaf (D3). `@default` is one PR; both lowering paths (non-enum + enum) migrate in this slice (operator decision).

### D1 — Kit: `scalarLiteral()` + `funcCall()` combinators
- **Outcome:** two new leaf combinators in `@prisma-next/psl-parser`, each unit-tested in isolation:
  - `scalarLiteral()` → `ArgType<string | number | boolean>`: a `StringLiteralExprAst` / `NumberLiteralExprAst` / `BooleanLiteralExprAst` → its decoded `.value()`. Rejects anything else with a kit leaf diagnostic. (Array defaults reuse the existing `list(scalarLiteral())` — no new list combinator.)
  - `funcCall()` → `ArgType<ParsedCall>`: a `FunctionCallAst` → a structured call `{ name, args: [{ text, span }], span }`. **Registry-agnostic** — no name validation, so the kit does not import any SQL type. Use `FunctionCallAst.name()` (the `QualifiedNameAst` — reuse `isSimpleName`/`identifier()` structurally, no stringify) and `.args()`; render each argument's source text via the AST's decoded value / `printSyntax` (text is a legitimate output here — the SQL registry re-parses arg strings downstream).
- **Design point to resolve in this dispatch:** where the parsed-call output type lives. The SQL registry consumes `ParsedDefaultFunctionCall` (`{ name, raw, args: [{ raw, span }], span }`). Either (a) `funcCall()` emits a generic framework-level parsed-call shape and D2 adapts it to `ParsedDefaultFunctionCall` at the call site, or (b) relocate/alias `ParsedDefaultFunctionCall` to a framework type `funcCall()` can emit directly. Pick whichever keeps layering clean (framework must not depend on SQL); surface the choice in the report.
- **Builds on:** the merged attribute-spec kit + slice-2 combinators.
- **Gate:** psl-parser build + typecheck + test; `lint:framework-vocabulary` (bump threshold to the new count if the two combinators move it); `lint:deps`.

### D2 — Migrate `@default`; delete the three string parsers
- **Outcome:** `fieldAttribute('default', { positional: [{ key: 'value', type: oneOf(scalarLiteral(), list(scalarLiteral()), funcCall()) }] })` added to `sql-attribute-specs.ts`; `lowerDefaultForField` (`psl-column-resolution.ts`) rewritten to interpret via the generic `interpretFieldAttribute` wrapper and switch on the `oneOf` output by runtime shape — **primitive → literal default, array → list default, object (parsed call) → registry path**. Every semantic rule stays: `isList` + `PSL_LIST_DEFAULT_NOT_ARRAY`, `lowerDefaultFunctionWithRegistry` + `PSL_UNKNOWN_DEFAULT_FUNCTION`, generator applicability + codec matching + preset-only guard (`PSL_INVALID_DEFAULT_APPLICABILITY`), and exactly-one-positional (now enforced by the spec's single positional param — confirm the engine's "too many positional / missing" diagnostics read acceptably, else keep an interpreter guard).
- **Deletions:** `parseDefaultLiteralValue`, `parseDefaultFunctionCall`, `parseListDefaultExpression`, plus their private helpers (`decodeLiteralElement`, the `ListDefaultParse` type) once `rg` confirms zero callers. Retain `lowerDefaultFunctionWithRegistry`, the registry, and `ParsedDefaultFunctionCall`.
- **Behaviour parity:** contract output identical; `pnpm fixtures:check` clean. `@default(garbage)` (no valid arm) now emits `PSL_INVALID_ATTRIBUTE_SYNTAX` instead of `PSL_INVALID_DEFAULT_VALUE` (operator: Option A) — update the asserting test(s). Semantic default codes unchanged. `interpreter.defaults.test.ts` (24 cases) green with only the intentional code-shift edits.
- **Builds on:** D1.
- **Gate:** psl-parser build (D1 changed the kit); sql-contract-psl typecheck + test (`interpreter.defaults.test.ts`); `pnpm fixtures:check`; `rg` gates for the three deleted helpers; `lint:framework-vocabulary`; `lint:deps`.

### D3 — Kit `bareIdentifier()` + migrate the enum `@default` path
- **Outcome:** a `bareIdentifier()` leaf combinator in `@prisma-next/psl-parser` (bare `IdentifierAst` → its text; neutral label "an identifier"; no validation), unit-tested. `enumDefaultSpec = fieldAttribute('default', { positional: [{ key: 'member', type: bareIdentifier() }] })` added to `sql-attribute-specs.ts`; `lowerEnumDefaultForField` (`psl-field-resolution.ts`) rewritten to interpret via the generic `interpretFieldAttribute` wrapper and match the extracted member name against `enumHandle.enumMembers`.
- **Deletions:** the inline `isQuotedString` / `isFunctionCall` regex checks + the exactly-one-positional guard in `lowerEnumDefaultForField` (now spec-enforced). Keep the `enumHandle.enumMembers` matching + `PSL_ENUM_UNKNOWN_DEFAULT_MEMBER`.
- **Behaviour parity:** enum-member defaults resolve to the same value; `pnpm fixtures:check` clean. `@default("x")` / `@default(fn())` on an enum field now emit `PSL_INVALID_ATTRIBUTE_SYNTAX` instead of `PSL_ENUM_DEFAULT_MUST_BE_MEMBER_NAME` (operator: Option A) — find + update the asserting tests (in `interpreter.enum.test.ts`; `rg` for `PSL_ENUM_DEFAULT_MUST_BE_MEMBER_NAME`). `PSL_ENUM_UNKNOWN_DEFAULT_MEMBER` unchanged.
- **Builds on:** D1 (kit pattern), D2 (the `defaultSpec` plumbing + interpret wiring it mirrors).
- **Gate:** psl-parser build + test (new combinator); sql-contract-psl typecheck + test (enum-default cases); `pnpm fixtures:check`; `rg` gates; `lint:framework-vocabulary`; `lint:deps`.

_(As-shipped target: `@default` spec-driven on both paths; the three non-enum string-parsers + the enum inline regex checks gone; the SQL family now entirely spec-driven. D1/D3 carry the kit-growth risk; D2/D3 are the migrations + the preserved semantic codes.)_
