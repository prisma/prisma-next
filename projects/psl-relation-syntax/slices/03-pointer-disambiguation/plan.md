# Slice 3 — pointer disambiguation — Dispatch plan

**Slice spec:** `projects/psl-relation-syntax/slices/03-pointer-disambiguation/spec.md`
**Linear:** [TML-2942](https://linear.app/prisma-company/issue/TML-2942)

Five dispatches. M1 (grammar) gates M2. M3 (inverse:) is independent of M1. M4/M5 follow.

## M1 — Member-access value grammar (psl-parser)

- **Outcome:** an `@relation` argument value may be a qualified `Identifier.Identifier` (`through: Junction.field`), with both segments preserved through parse → resolve.
- **Builds on:** none (parser-internal).
- **Hands to:** the qualified-value grammar S3·M2 (and S5's arrow-path + the deferred `to:` qualifier) consume.
- **Focus:** `psl-parser/src/parse.ts` — extend the argument-value path (`parseArgValue` / `parseExpression` / `parseIdentifierExpr`) to parse a member-access value (reuse `Dot` handling from `parseQualifiedName`); expose both segments on the resolved arg. Keep bare identifiers and bracketed lists working unchanged.
- **Completed when:** `pnpm --filter @prisma-next/psl-parser test` green with tests parsing `Foo.bar` as a qualified value (and bare/bracketed still parse); `pnpm --filter @prisma-next/psl-parser typecheck` + `lint` clean.
- **Halt:** if extending the value grammar regresses existing arg parsing in a way that can't be cleanly scoped to member-access values → surface.

## M2 — `through: Junction.relationField` M:N disambiguation (resolver)

- **Outcome:** a self-referential / multiple-between-same-models M:N (today `PSL_AMBIGUOUS_BACKRELATION_LIST`) resolves when both ends pin their junction FK leg via `through: J.field`.
- **Builds on:** M1's qualified value + slice 2's named-junction recognition.
- **Hands to:** disambiguated M:N lowering.
- **Focus:** `contract-psl` — `ParsedRelationAttribute.through` carries the optional `field` segment; in `findJunctionFkPairs`, pin the parent-side FK to the junction relation field named; actionable diagnostic when `field` isn't a junction FK back to the candidate.
- **Completed when:** `pnpm --filter @prisma-next/sql-contract-psl test` green with a lowering test on a self-referential M:N (ambiguous without the qualifier) + the bad-`field` diagnostic; typecheck + lint clean.
- **Halt:** —

## M3 — `inverse:` 1:N back-relation disambiguation (resolver)

- **Outcome:** a 1:N back-relation with multiple candidates (today needs `name:`) resolves via `inverse: <fkField>`.
- **Builds on:** slice 1's allow-list (add `inverse`); independent of M1 (bare field name).
- **Hands to:** the directional replacement for `name:` on the 1:N back side.
- **Focus:** `contract-psl` — add `inverse` to the allow-list; in the back-relation pairing, pin the owning FK field; actionable diagnostic when `inverse:` names a non-FK-side field.
- **Completed when:** `pnpm --filter @prisma-next/sql-contract-psl test` green with a lowering test on a two-relations-between-same-models 1:N + the bad-field diagnostic; typecheck + lint clean.
- **Halt:** —

## M4 — Printer retires `name:` (output) + grep gate

- **Outcome:** the `contract infer` printer / canonical output emits pointer forms, never `@relation(name:)`; legacy `name:` still parses + survives `format`.
- **Builds on:** M2 (`through: J.field`) + M3 (`inverse:`) — the pointer forms it emits.
- **Hands to:** single-dialect disambiguation output (the `name:`-retirement DoD).
- **Focus:** `sql-schema-ir-to-psl-ast.ts` `buildRelationField` — replace `namedArg('name', …)` emission with the pointer form (`inverse:` on a disambiguated 1:N back side; `through: J.field` where applicable); grep gate over printer output asserting no `name:`. Update inferred-PSL test expectations. Do **not** touch the formatter's legacy `name:` handling (deferred per decision #4).
- **Completed when:** `pnpm --filter @prisma-next/family-sql test` green with updated expectations + the no-`name:` grep gate; a test that a legacy `name:` schema still parses and `format` leaves it unchanged; `pnpm fixtures:check` clean (rebuild dist first).
- **Halt:** if a `contract.json` shape changes (only PSL spelling should) → surface (D1).

## M5 — Integration parity

- **Outcome:** a self-referential M:N (`through: J.field`) and a disambiguated 1:N (`inverse:`) drive the ORM.
- **Builds on:** M2 + M3 (the lowering) — the runtime is unchanged.
- **Hands to:** the slice's runtime DoD.
- **Focus:** a PSL fixture with a self-ref M:N (e.g. `Follow` junction) + a two-relations-1:N disambiguated by `inverse:`; emit; integration test (`include`, whole-row, ≥1 implicit; PGlite per the harness). `fixtures:check`.
- **Completed when:** the integration test passes; `pnpm fixtures:check` clean.
- **Halt:** if the disambiguated contract doesn't drive the runtime → surface (lowering wrong, not runtime).

## Hand-off completeness

M1→M2 (M:N pointer), M3 (1:N pointer), M4 (printer retires `name:`), M5 (runtime) compose to the slice-DoD: disambiguation by pointing for both cardinalities, `name:` gone from output, runtime parity. The formatter's legacy-`name:` conversion is the one explicit deferral (decision #4).
