# D1 — Bare-name sugar (`T` ≡ `T()`) + symbol-table scalarTypes gate

**Slice plan:** `projects/remove-db-attributes/slices/native-types-as-scalars/plan.md` · **Tier:** orchestrator · **Branch:** `tml-2986-native-types-as-scalars`

## Task

Two coupled pieces:

**(A) Broaden the bare-name criterion.** Today `collectScalarTypeConstructors` (`framework-authoring.ts`) admits only constructors that *declare* zero args with a literal `output.nativeType`. Broaden the criterion to **"instantiable with an empty argument list"**: all declared args `optional: true`, no `entityRefArg`, and the output template resolvable with no arguments (arg-ref template values with no `default` make it non-bare-eligible; a literal or defaulted template resolves). A bare name must resolve to exactly what the zero-arg *call* `T()` produces — same codecId, same nativeType, same absent typeParams keys. Prefer implementing bare resolution AS zero-arg instantiation (one path) over duplicating template-resolution logic in the walk (F1: no second resolution mechanism under a new name). Consumers of the projection (SQL provider's plain-name map, `ControlStack.scalarTypes`, LSP list, codec-id validation, mongo's codecId view) follow the broadened criterion automatically — verify each still behaves.

**(B) ⛔ Operator gate — `buildSymbolTable.scalarTypes` retirement (operator-mandated 2026-07-11).** Evaluate retiring the `scalarTypes` input of `buildSymbolTable` (`psl-parser/src/symbol-table.ts`): its sole consumption is `isScalarBinding`, which splits `types {}` declarations into `ScalarSymbol` vs `TypeAliasSymbol` — a pre-classification `resolveNamedTypeDeclarations` re-derives authoritatively. Evaluate: can the split collapse to one symbol kind (interpreter pronounces scalar-or-not), removing the parameter from `buildSymbolTable` and its call sites? Check every consumer of `ScalarSymbol` vs `TypeAliasSymbol` distinction (grep `ScalarSymbol|TypeAliasSymbol|scalars\b|typeAliases` across packages incl. LSP + mongo family) before deciding.

**HALT CONDITION (non-negotiable):** if you conclude the retirement should NOT be done — the split is load-bearing somewhere, or the cost is disproportionate — **STOP. Do not implement a workaround, do not silently keep the parameter and proceed to part A cleanup.** Report back with the concrete rationale (which consumer depends on the split and how); the orchestrator escalates to the operator, who alone may waive. There is no third state: either the simplification lands in this dispatch, or your report carries the escalation case.

## Outcome (property statement)

Bare type names and zero-arg constructor calls are one semantics, **such that** for every bare-eligible `T`, authoring `T` and `T()` emit identical storage (test-proven on an all-optional-args fixture constructor), non-bare-eligible constructors used bare produce the existing unsupported-type diagnostic (not a crash or silent fallback), and — gate permitting — the symbol table no longer needs target scalar knowledge (family-blind parser layer, one classification authority).

## In

- `framework-authoring.ts` (`collectScalarTypeConstructors` or successor), its unit tests; SQL `provider.ts` / `psl-column-resolution.ts` plain-name path; `symbol-table.ts` + call sites (gate permitting); LSP wiring if the symbol-table change ripples (`config-resolution.ts`, semantic tokens, completions — their tests must stay green unweakened).
- Tests first: bare-vs-call equivalence on a fixture constructor with all-optional args; required-arg constructor bare → diagnostic; entity-ref constructor bare → diagnostic.

## Out

- Postgres native-type contributions (D2). JSON re-bind (D3). Any `@db.*` behavior change.

## Edge cases

| Case | Disposition |
| --- | --- |
| Optional arg with a `default` in the output template | Bare form applies the default, same as `T()` — test it. |
| All-optional constructor whose template references an absent arg with no default | Not bare-eligible; excluded, with a unit test. |
| Existing behavior of the nine base scalars | Byte-identical (they're zero-arg; the broadening is additive). `pnpm fixtures:check` zero drift. |
| Destructive git ops | Forbidden; `git commit -s`. |
| mongodb-memory-server on nixos | Pre-existing env failure; name skipped suites. |

## Completed when

1. Equivalence + exclusion tests green; all existing suites green unweakened.
2. Gate resolved: symbol-table simplification implemented (with `buildSymbolTable` signature slimmed and call sites updated), OR the report carries the escalation rationale and part B is untouched.
3. `pnpm typecheck`, per-touched-package lint + tests, `pnpm fixtures:check` zero drift, `pnpm lint:deps` clean.

## Report back

Design of the broadened criterion (where bare resolution runs zero-arg instantiation); the gate verdict with evidence (consumers checked); files touched; test names; gates + results; F1/F3/F13/F14 checked; commit SHA.
