# Brief: D5 — `funcCall(name)` + `num()` + dynamic non-enum `@default` spec

> Fresh implementer. Slice `sql-default`, branch `tml-2956-sql-default` (PR #938). Do NOT push or touch GitHub. ONE signed commit.

## ⛔ TOOLING RULE (operator standing order)
**NEVER call the regex/codebase-search MCP tool — it HANGS and deadlocks the run.** This brief is SEARCH-FREE: every path, line, and snippet is inline. Use `rg`/`grep` in the **terminal** only if you must confirm something. Reading a named file with the file reader is fine. If you feel you can't proceed without the search tool, STOP and report "brief under-specified."

## Context
This evolves the *static* non-enum `@default` spec (shipped earlier in this PR) into a **dynamically composed** one, built per field from the registry + `isList`. Operator decisions baked in: literals stay flexible; `funcCallFrom` is not built (compose `oneOf(funcCall(name))`); unknown-function-name and array-on-scalar/scalar-on-list become **grammar** failures (`PSL_INVALID_ATTRIBUTE_SYNTAX`) — Option A. Enum path is D6; don't touch it.

## Part A — kit changes (in `@prisma-next/psl-parser`)
1. **`funcCall(name)`** — make the existing `funcCall` name-pinned. File `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/func-call.ts`. Today `export function funcCall(): ArgType<ParsedDefaultFunctionCall>` matches any (unqualified) call. Change it to `export function funcCall(name: string): ArgType<ParsedDefaultFunctionCall>` and, after the existing unqualified-name extraction (`const name = qname.identifier()?.token()?.text;` — rename the local to `calleeName` to avoid shadowing the param), add: `if (calleeName !== name) return notOk([leafDiagnostic(ctx, arg, \`Expected ${name}()\`)]);`. Keep the raw-arg capture unchanged. Update the `funcCall` unit tests in `attribute-spec-combinators.test.ts` to pass a name (e.g. `funcCall('now')` accepts `now()`, rejects `uuid()` and `foo.now()`).
2. **`num()`** — new atom `combinators/num.ts`: `ArgType<number>` accepting ANY `NumberLiteralExprAst` (incl. floats — do NOT add an integer guard; that's what `int()` is for). Model on `int.ts` but drop the `Number.isInteger` check; label `'number'`; message `'Expected a number literal'`. Export from `src/exports/index.ts`. Unit-test it (accepts `5` and `1.5`; rejects a string / bool / identifier).

## Part B — dynamic non-enum spec (`packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`)
Replace the static `defaultSpec` (currently lines 143–145: `export const defaultSpec = fieldAttribute('default', { positional: [{ key: 'value', type: oneOf(scalarLiteral(), list(scalarLiteral()), funcCall()) }] });`) with a builder:
```ts
export function buildDefaultSpec(input: {
  readonly isList: boolean;
  readonly registry: ControlMutationDefaultRegistry;
}) {
  const literal = () => oneOf(str(), num(), bool());
  const funcArms = [...input.registry.keys()].map((name) => funcCall(name));
  const valueArms = input.isList
    ? [list(literal()), ...funcArms]
    : [str(), num(), bool(), ...funcArms];
  return fieldAttribute('default', { positional: [{ key: 'value', type: oneOf(...valueArms) }] });
}
```
Add `num` to the `@prisma-next/psl-parser` import; `oneOf`/`list`/`str`/`bool`/`funcCall`/`fieldAttribute` are already imported. Import `ControlMutationDefaultRegistry` as a type from `@prisma-next/framework-components/control`. **Typing note:** the `oneOf(...valueArms)` spread of a heterogeneous array may not infer a clean tuple/union `OutOf`. If TS widens or errors, either construct `valueArms` with an explicit `ArgType<string | number | boolean | (string | number | boolean)[] | ParsedDefaultFunctionCall>[]` annotation, or wrap with a narrow `blindCast<…, 'reason'>` on the composed arg-type (mirror how `oneOf` itself uses `blindCast` internally). **No bare `as`.** Report the approach you took. Remove the old `defaultSpec` export and (if unused elsewhere) drop `scalarLiteral` from this file's imports — but do NOT delete the `scalar-literal.ts`/`bare-identifier.ts` combinators yet (that's D7; `enumDefaultSpec` still uses `bareIdentifier` until D6).

## Part C — rewire `lowerDefaultForField` (`packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts`, ~line 880)
Currently it interprets the static `defaultSpec` and shape-switches (lines 896–988). Change:
- Build the spec dynamically: `const spec = buildDefaultSpec({ isList: input.isList ?? false, registry: input.defaultFunctionRegistry });` and pass `spec` (not the static `defaultSpec`) to `interpretFieldAttribute`. Update the import from `./sql-attribute-specs` (`buildDefaultSpec` instead of `defaultSpec`).
- The shape-switch simplifies because the grammar now guarantees shape ⇔ field kind:
  - `Array.isArray(value)` → return `{ defaultValue: { kind: 'literal', value: [...value] } }` (list field guaranteed — the list arm only exists for list fields). **Delete** the old `!isList → PSL_INVALID_DEFAULT_VALUE` branch (lines ~914–920) — a non-list array is now a grammar failure.
  - `typeof value === 'object'` → the registry path — keep lines ~923–977 **verbatim** (`lowerDefaultFunctionWithRegistry` + the three applicability/codec checks).
  - else (primitive) → `return { defaultValue: { kind: 'literal', value } }`. **Delete** the old `isList → PSL_LIST_DEFAULT_NOT_ARRAY` branch (lines ~979–987) — a scalar on a list field is now a grammar failure.
- Leave `lowerDefaultFunctionWithRegistry` untouched. Its unknown-function branch (`PSL_UNKNOWN_DEFAULT_FUNCTION`) is now unreachable from this path (only known-name calls match a `funcCall(name)` arm) but is still exercised by its own direct unit test — that's fine, do NOT remove it or its test.

## Test edits (`packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.test.ts`)
- The `PSL_UNKNOWN_DEFAULT_FUNCTION` assertion (~line 272) is now reached via the grammar (unknown callee → no `funcCall(name)` arm → `oneOf` fails): change its `code` to `'PSL_INVALID_ATTRIBUTE_SYNTAX'` and drop/relax the `message: stringContaining('…')` if it named the source text (the kit message is `Expected one of: …`). Update the test title/comment.
- Find (terminal `rg`) any test feeding an array default to a **non-list** field, or a scalar default to a **list** field, asserting `PSL_INVALID_DEFAULT_VALUE` / `PSL_LIST_DEFAULT_NOT_ARRAY`: those now assert `PSL_INVALID_ATTRIBUTE_SYNTAX`. Update them.
- **Do NOT touch** the registry arg-validation tests (`PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT` for `uuid(2)`/`nanoid(16,32)`) or the optional-field test — a known-name call still reaches the registry, which still validates args unchanged. Also do NOT touch `default-function-registry.test.ts`.

## Constraints
No `any`; no bare `as` (use `blindCast`/`castAs` from `@prisma-next/utils/casts`, narrowed — the `oneOf` spread typing is the only likely spot); no file-ext imports; never suppress biome; tests-first for the kit atoms. `git commit -s` (DCO), explicit staging, no amend, **no push**. Read-only on `projects/**`, `.agents/**`. Do NOT touch GitHub. Do NOT touch the enum path (`lowerEnumDefaultForField`, `enumDefaultSpec`, `bareIdentifier`).

## Gates (all must pass, in order)
1. `pnpm --filter @prisma-next/psl-parser build`
2. `pnpm --filter @prisma-next/psl-parser typecheck` and `pnpm --filter @prisma-next/psl-parser test`
3. `pnpm --filter @prisma-next/sql-contract-psl typecheck` and `pnpm --filter @prisma-next/sql-contract-psl test`
4. `pnpm fixtures:check` — clean
5. `pnpm lint:framework-vocabulary` (bump threshold to the new count if `num()` moves it); `pnpm lint:deps`

Report: the `funcCall(name)` + `num()` signatures + tests; the `buildDefaultSpec` shape + how you resolved the `oneOf`-spread typing; the `lowerDefaultForField` shape-switch after removing the two branches; which tests shifted to `PSL_INVALID_ATTRIBUTE_SYNTAX` (and confirmation the registry arg-validation tests are untouched); all gate results; and the commit SHA. If the `oneOf` spread cannot type without a broad cast, STOP and report the options.
