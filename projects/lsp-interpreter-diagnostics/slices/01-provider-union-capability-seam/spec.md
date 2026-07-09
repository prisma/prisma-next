# Slice 01 — provider union + capability seam

**Project:** [`../../spec.md`](../../spec.md) · **Project plan:** [`../../plans/plan.md`](../../plans/plan.md) § M1 · **Linear:** TML-2984

## Design (settled — see project spec § At a glance)

Two changes, both purely additive in behavior:

1. **`ContractSourceProvider` becomes a `sourceFormat`-keyed union** in
   `packages/1-framework/1-core/config/src/contract-source-types.ts`:
   - `PslContractSourceProvider` — `sourceFormat: 'psl'`
   - `TypeScriptContractSourceProvider` — `sourceFormat: 'typescript'`
   - `OpaqueContractSourceProvider` — **open `sourceFormat?: string`** (admits
     third-party formats; overlaps the literals, so bare `=== 'psl'` checks never
     narrow — by design, narrowing flows only through the capability guard)
   - `ContractSourceProvider` = the union. Shared shape (`inputs?`, `load`) per member.
   - `ContractSourceFormat` stops being a closed enum at the provider boundary.
   - arktype schema in `config-types.ts`: `sourceFormat` widens to `'string'`; no new
     required keys; **undeclared keys must remain ignored** (an `interpret` method on a
     provider object passes validation untouched — providers implement it in slice 03).
2. **New `@prisma-next/psl-parser/interpret` export path** (mirroring `/syntax`,
   `/format`) in `packages/1-framework/2-authoring/psl-parser/`:
   - `PslInterpretInput` — `{ document: DocumentAst; sourceFile: SourceFile; symbolTable: SymbolTable; sourceId: string }` (all readonly).
   - `PslInterpretCapable` — `{ sourceFormat: 'psl'; interpret(input, context): readonly ContractSourceDiagnostic[] }`.
   - `hasPslInterpreter(source: ContractSourceProvider): source is ContractSourceProvider & PslInterpretCapable` —
     runtime evidence: discriminant `sourceFormat === 'psl'` **and** `typeof source.interpret === 'function'`.
   - New dependency edge: psl-parser → `@prisma-next/config` (downward, authoring → core;
     type-only imports of `ContractSourceProvider` / `ContractSourceContext` /
     `ContractSourceDiagnostic`).

## Coherence rationale

One reviewable PR: "the type seam the whole project hangs on." The union and the
capability type are two halves of a single design decision (core stays silent; the
authoring layer owns the vocabulary; the guard is the only narrowing seam) — landing
them separately would leave either a union nobody can narrow or a guard with nothing
to narrow to. No behavior changes: nothing implements `interpret` yet; the guard
returns `false` against every real config.

## Slice Definition of Done (beyond CI / reviewer / project-DoD)

- [ ] SDoD1 — Guard unit tests (TC-1): psl provider with `interpret` → narrows true;
      `typescript` provider → false; opaque/unknown `sourceFormat` string → false;
      `sourceFormat: 'psl'` without the method → false.
- [ ] SDoD2 — Schema tests (TC-2): arktype admits unknown `sourceFormat` strings and a
      provider object carrying an extra `interpret` key; existing config fixtures
      (sql + mongo, contract-ts + contract-psl) validate unchanged.
- [ ] SDoD3 — All in-repo consumers compile (TC-3); any consumer that matched
      exhaustively on the closed enum treats unknown strings as opaque.
- [ ] SDoD4 — `pnpm lint:deps` green with the new psl-parser → config edge (TC-17);
      cast-ratchet count unchanged; zero new `blindCast`/`castAs`.

## Edge cases (pre-investigated)

- The open `sourceFormat?: string` on the opaque member means TypeScript will not
  discriminate the union on equality checks — consumers that today do
  `sourceFormat === 'psl'` for *comparison* (not narrowing) keep compiling
  (`schema-inputs.ts`, CLI `format.ts` — verified they only compare).
- `psl-parser`'s package.json `exports` map needs the new `./interpret` entry and
  tsdown must emit it — mirror how `./format` / `./syntax` are wired.
- `config-types.test-d.ts` (config's negative type tests) will need union-aware
  updates.

## Dispatch plan

Target: 2 dispatches, sequential (D2's guard narrows the union D1 creates).

### D1 — provider union + arktype widening + consumer adaptation

- **Outcome:** `ContractSourceProvider` is the three-member union; arktype schema
  widened; every in-repo consumer compiles; config package tests cover TC-2/TC-3.
- **Builds on:** nothing (first dispatch).
- **Hands to:** D2 (the union type the guard narrows).
- **Focus:** `packages/1-framework/1-core/config/` (types + schema + tests); consumer
  fallout limited to type-level adaptation surfaced by typecheck.
- **Gate:** `pnpm --filter @prisma-next/config test` + package typecheck (incl. test
  project), then `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`,
  `pnpm --filter @prisma-next/config lint`.

### D2 — `psl-parser/interpret` capability export + guard

- **Outcome:** `@prisma-next/psl-parser/interpret` exports `PslInterpretInput`,
  `PslInterpretCapable`, `hasPslInterpreter` with unit tests (TC-1); psl-parser →
  config dependency added and lint:deps-clean.
- **Builds on:** D1 (narrows the union).
- **Hands to:** slice 03 (providers implement the capability) and slice 04 (LSP consumes the guard).
- **Focus:** `packages/1-framework/2-authoring/psl-parser/` (new export path, package.json
  exports + deps, tests).
- **Gate:** `pnpm --filter @prisma-next/psl-parser test` + package typecheck, then
  `pnpm typecheck`, `pnpm lint:deps`, `pnpm --filter @prisma-next/psl-parser lint`,
  and psl-parser `pnpm build` (new export path must emit dist artifacts cleanly).
