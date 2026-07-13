# Slice 04 — providers implement the interpret capability (sql + mongo)

**Project:** [`../../spec.md`](../../spec.md) · **Project plan:** [`../../plans/plan.md`](../../plans/plan.md) § M3 · **Linear:** TML-2984
**Depends on:** slice 01 (merged #939 — the capability seam). Slices may not fork the pipeline: build/editor parity is by construction.

## Design (settled — project spec § At a glance)

Both `prismaContract()` factories (`packages/2-sql/2-authoring/contract-psl/src/provider.ts`,
`packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts`) grow an
`interpret` method on the returned source object, genuinely satisfying
`PslInterpretCapable` from `@prisma-next/psl-parser/interpret` (which now *extends*
`PslContractSourceProvider`, so the source object is simply typed as the capability):

1. **One inner interpretation function per provider**, extracted inside the
   `prismaContract` closure where `options.target` / `createNamespace` /
   `enumInferenceCodecs` / `composedExtensionPackRefs` / `defaultControlPolicy` are in
   scope. It takes `(artifacts: { symbolTable, sourceFile, sourceId }, context:
   ContractSourceContext, seedDiagnostics)` and runs the existing
   `interpretPslDocumentToSqlContract` / `…MongoContract` call — the single code path
   both `load` and `interpret` delegate to. Build and editor cannot drift.
2. **`load`** keeps its exact behavior: read file → parse → symbol table → seed
   diagnostics (parse + symbol-table mapped) → inner function → (sql only)
   `applySpecifierDefaultControlPolicy` on ok. Bit-identical results.
3. **`interpret`** feeds the caller's artifacts (`PslInterpretInput` — the LSP's
   cached `document`/`sourceFile`/`symbolTable` + `sourceId`) with **empty
   `seedDiagnostics`** (the LSP owns parse/symbol-table diagnostics; no
   double-reporting) and returns interpreter-stage findings only:
   `notOk → result.error.diagnostics`; `ok → []`. It must **never throw on
   recovered/malformed-but-parseable input** (matching the documented no-throw
   discipline of `parse`/`buildSymbolTable`).
4. **Zero casts.** The source object is typed `PslInterpretCapable`; assignability
   into `ContractConfig.source` (the provider union) is by subtyping — slice 01
   built the seam for exactly this.

## Coherence rationale

One reviewable PR: "the two providers each honestly implement the capability via one
shared inner path." The sql and mongo changes are mirror images; landing them
together lets the reviewer verify the mirror symmetry — and the guard integration
test only means something when at least one real provider narrows true.

## Slice Definition of Done (beyond CI / reviewer / project-DoD)

- [ ] SDoD1 — sql: for the same schema content, `interpret` over parse+symbol-table
      artifacts returns exactly the interpreter-stage diagnostics `load` reports
      (seed diagnostics excluded) — provider-level parity test (TC-4); and `interpret`
      on malformed-but-parseable input returns diagnostics, never throws (TC-5).
- [ ] SDoD2 — mongo: same pair (TC-6, TC-7).
- [ ] SDoD3 — guard integration (TC-1): `hasPslInterpreter` narrows the real
      `prismaContract(...)` config source for both providers, and the narrowed
      `interpret` is callable with a real assembled context.
- [ ] SDoD4 — `load` behavior unchanged: existing provider suites green untouched;
      `pnpm fixtures:check` zero drift; zero new casts.

## Edge cases (pre-investigated)

- `interpret` must not read `context.resolvedInputs` (no disk access on the live
  path); `sourceId` comes from `PslInterpretInput`.
- The sql `load` applies `applySpecifierDefaultControlPolicy` only on the ok path —
  irrelevant to `interpret` (diagnostics-only), but the inner function boundary must
  not accidentally move it out of `load` (fixtures:check would catch).
- `PslInterpretInput.document` is accepted but unused today (symbols embed their AST
  nodes) — do not thread it into the interpreters; it exists as future-proofing.
- `interpretPslDocumentToSqlContract` may throw on inputs the interpreter authors
  considered impossible; if any such path is reachable from recovered input, wrap at
  the `interpret` boundary is NOT the fix — surface it (the no-throw requirement is
  on the interpreters; a swallowing wrapper would hide real bugs).

## Dispatch plan

Two dispatches, sequential (same persistent implementer; mongo mirrors sql).

### S4-D1 — sql provider implements interpret

- **Outcome:** sql `provider.ts` refactored to the inner-function shape; `interpret`
  attached; SDoD1 tests + sql half of SDoD3; `load` provably unchanged.
- **Builds on:** slice 01 seam.
- **Hands to:** S4-D2 (the mirror), slice 05 (LSP consumption).
- **Focus:** `packages/2-sql/2-authoring/contract-psl/` only.
- **Gate:** `pnpm --filter @prisma-next/sql-contract-psl test` + typecheck + lint,
  `pnpm typecheck`, `pnpm fixtures:check`, `pnpm lint:deps`.

### S4-D2 — mongo provider mirrors + guard integration

- **Outcome:** mongo `provider.ts` same shape; SDoD2 tests + mongo half of SDoD3;
  mirror symmetry with sql verified by the reviewer.
- **Builds on:** S4-D1 (the established shape).
- **Hands to:** slice 05.
- **Focus:** `packages/2-mongo-family/2-authoring/contract-psl/` only.
- **Gate:** `pnpm --filter @prisma-next/mongo-contract-psl test` + typecheck + lint,
  `pnpm typecheck`, `pnpm test:packages`, `pnpm fixtures:check`, `pnpm lint:deps`.
