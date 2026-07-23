# Slice plan: unify-type-channel

**Slice spec:** `projects/remove-db-attributes/slices/unify-type-channel/spec.md`
**Linear:** [TML-2985](https://linear.app/prisma-company/issue/TML-2985) · **Parent branch:** `remove-db-attributes-from-psl`
**Slice branch:** `tml-2985-unify-type-channel`

## Dispatch sequence

1. **D1 — Adapters contribute scalar constructors; assembly proven**
   - **Outcome:** postgres, sqlite, and mongo adapters each export their base scalars as zero-arg `AuthoringTypeConstructorDescriptor` entries (explicit `nativeType`, values pinned to what `codecLookup.targetTypesFor(codecId)[0]` derives today), wired into their component descriptors' `authoring.type`; the assembled `AuthoringContributions.type` contains them at top level, **such that** every scalar the old map named is representable in the unified namespace with an identical `{ codecId, nativeType }` and top-level name collisions are still rejected at assembly.
   - **Builds on:** none (legacy map coexists within the slice until D4).
   - **Hands to:** the populated namespace D2/D3 derive from.
   - **Focus:** contributions + assembly tests only; no consumer re-pointing.
2. **D2 — SQL family derives from the namespace** *(parallel with D3)*
   - **Outcome:** SQL provider's `buildColumnDescriptorMap`, the symbol-table `scalarTypes` input, `controlStack.scalarTypes`, and the LSP wiring all derive from top-level zero-arg constructors instead of the map, **such that** bare `T` resolves as the zero-arg instantiation `T()` and postgres + sqlite contract emission is byte-identical (parity test per target).
   - **Builds on:** D1's populated namespace.
   - **Hands to:** SQL path map-free.
3. **D3 — Mongo family derives from the namespace** *(parallel with D2)*
   - **Outcome:** mongo provider derives its `name → codecId` view from the namespace, **such that** mongo contract emission is byte-identical (parity test) and the mongo interpreter's internals are unchanged.
   - **Builds on:** D1's populated namespace.
   - **Hands to:** mongo path map-free.
4. **D4 — Hard cut: the map channel dies**
   - **Outcome:** `ComponentMetadata.scalarTypeDescriptors`, `assembleScalarTypeDescriptors`, `ContractSourceContext.scalarTypeDescriptors`, the adapters' maps, and `validateScalarTypeCodecIds`'s map-walking form are deleted (validation re-pointed at the namespace), **such that** `rg 'scalarTypeDescriptors' packages --type ts -g '!*test*'` returns zero hits and no dual-shape remnant survives under a new name (F1).
   - **Builds on:** D2 + D3.
   - **Hands to:** slice DoD walk → PR.

## Calibration threading (slice-DoR plan-side items)

- **Failure modes:** F1 (dual-shape relocated — D4's gate), F3 (discovery via grep, not test suite), F5 (no destructive git ops in sub-agents), F14 (dispatch gates mirror CI: typecheck incl. test tsconfig + `pnpm --filter <pkg> lint`), F16 (no self-acknowledged layering violations — run `pnpm lint:deps`), F18 (inverted abstraction: family layers must not take adapter fragments through the framework interface).
- **Grep gates:** grep-library § Cross-cutting anti-patterns; slice gate `rg 'scalarTypeDescriptors' packages --type ts -g '!*test*'` → 0.
- **Validation gates (per dispatch):** `pnpm typecheck`, `pnpm --filter <touched-pkg> lint`, `pnpm --filter <touched-pkg> test`; end-of-slice: `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm test:integration` (mongo/PGlite paths touched).

## Model-tier routing

D1: mid (mechanical contributions + one assembly judgment). D2: orchestrator-tier (derivation judgment across provider/symbol-table/LSP). D3: mid. D4: cheap-to-mid (subtractive + grep gate).
