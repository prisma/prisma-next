# M1 — Foundation: dispatch decomposition

Slice goal: declare the cross-contract FK carrier shape at the contract-IR layer and add the cross-contract-specific checks to contract-aggregate loading. No authoring surface (that's M2). One PR.

Branch: `tml-2500-cross-contract-space-fk-references` from latest `origin/main`.
Model tiers: implementer = sonnet-4.6-mid; reviewer = opus-4.8-high. TDD mandatory.
Validation gate (inferred — confirm): `pnpm --filter @prisma-next/sql-contract build && pnpm typecheck` + the contract package's test command + `pnpm lint:deps`. (Exact filter names to be confirmed at dispatch 1 against the workspace.)

ACs owned by M1: **AC6** (collision + cycle rejection), **AC8** (round-trip property test), **AC10** (`lint:deps`), plus **AC9** as a regression guard (existing local-FK tests stay green).

## Dispatch M1.1 — FK carrier `source` discriminator + round-trip

- **Outcome:** `ForeignKey` / `ForeignKeyReference` carry a `source: 'local' | 'space'` discriminator. The `'space'` variant adds `spaceId`, a namespace coordinate that admits `UNBOUND_NAMESPACE_ID` (`'__unbound__'`), `tableName`, `columnName`. The `'local'` variant keeps today's flat `{ namespaceId, tableName, columns }` shape. ArkType FK validator extended; `StorageTable → ForeignKey → ForeignKeyReference` deserialization handles both variants; round-trip property tests over a mix of `local`/`space` carriers pass (AC8).
- **Builds-on:** nothing (first dispatch).
- **Hands-to:** M1.2/M1.3 (independent code areas; lands first so the carrier type exists).
- **Focus:** `packages/2-sql/1-core/contract/src/ir/foreign-key.ts`, `foreign-key-reference.ts`, `validators.ts`; round-trip tests in that package. Mongo: one-line no-op note (no FK concept).
- **dispatch-INVEST:** Small (one package, one concept), Testable (round-trip property test), Valuable (the carrier all later work needs).

## Dispatch M1.2 — Aggregate dependency graph + cycle rejection

- **Outcome:** the contract-aggregate loader builds a directional graph from `extensionPacks`, **including the recursive walk of extension-declared `extensionPacks`** (new — only the top-level list is consumed today). Cycles are rejected at load time with a diagnostic naming the cycle members (FR12/FR13).
- **Builds-on:** M1.1 (sequential; same slice).
- **Hands-to:** M1.3 (same aggregate-load surface).
- **Focus:** `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` (or a new file in that package) + the aggregate loader; synthetic multi-contract fixtures + cycle tests.
- **dispatch-INVEST:** Small, Testable (synthetic cycle fixtures), Valuable (load-ordering correctness).

## Dispatch M1.3 — Namespace-ownership collisions + reverse-reference rejection

- **Outcome:** every primitive `(namespace.id, name)` is owned by exactly one contributing contract; a duplicate across contracts fails load with a diagnostic naming both contributors (FR15/FR16/AC6). An extension contract referencing an app model (reverse reference) fails load with a clear diagnostic (FR14).
- **Builds-on:** M1.2 (extends the aggregate-load checks).
- **Hands-to:** slice DoD.
- **Focus:** aggregate loader; synthetic fixtures for (extension+extension same-namespace collision, app+extension collision, reverse reference).
- **dispatch-INVEST:** Small, Testable, Valuable (the ownership guarantees AC6 + FR14 require).

## Slice DoD

- AC6 + AC8 demonstrated by tests; AC10 (`lint:deps`) green; AC9 regression (existing local-FK tests pass).
- No authoring surface touched; no M2 / domain-plane relation work.
- Reviewer SATISFIED across all three dispatches; trace backstop passes; PR opened against `main`.
