# Slice plan: symmetric domain plane

**Spec:** [`spec.md`](./spec.md)

## History

The first pass (D1 substrate + D2 consumers/fixtures) landed the `domain.namespaces` envelope and is on PR #653 — but review found it wrapped the shape over a flat identity model bridged by back-compat. The rework below replaces that layer; it supersedes the original D1/D2 framing for the parts it touches.

## Rework dispatch — commit fully to the namespaced model

**One dispatch.** The changes are tightly coupled in the foundation `contract` package (domain-envelope types, validation, exports) and its immediate consumers; splitting them creates churn and half-migrated intermediate states. The implementer commits in coherent steps internally.

**Outcome.** The framework treats domain entities by coordinate `(namespaceId, entityName)` end to end. No legacy-flat read path, no namespace-collapsing merge, namespace-aware validation, canonicalizer on the shared path-pattern helper, honest single-namespace projection for the emitter/DSL inference, and clean naming.

**Internal commit order (suggested):**

1. **Kill back-compat.** Remove `LegacyFlatDomainRoot` / `DomainContractInput` / `isLegacyFlatDomainRoot` / `normalizeLegacyDomainRoot` and exports; make read helpers single-branch on `domain.namespaces`; fix the deserializer to accept only the envelope.
2. **Namespace-aware validation.** Rewrite `validate-domain.ts` to resolve `(namespace, model)`; remove `flattenDomainContract`; add a test pinning two same-named models in different namespaces.
3. **De-merge helpers + single-namespace projection.** Replace cross-namespace merge in `contractModels` / `contractValueObjects` and `ContractModelsMap` / `ContractValueObjectsMap` with an explicit single-namespace projection (takes/asserts a namespace); route the emitter through it; emitter throws on multi-namespace.
4. **Canonicalizer + naming.** `matchesPathPattern` for domain path checks; rename `DomainContractSlice` → `ContractWithDomain`; rename `buildDomainPlaneFromFlat` → `domainPlaneOf` and update all call sites (incl. the fixtures the typecheck sweep migrated).

**Focus.** Foundation `contract` package first (types/validation), then ripple to emitter + family consumers. Selective gates per touched package; full `pnpm typecheck` + `pnpm fixtures:check` + `pnpm test:packages` before handoff. PGlite/MMS integration flakes are acceptable (note them); type errors are not.

**Refusal triggers.** Storage flatten; framework `domain.types`; cross-namespace flat merge to "line up types"; expansion into multi-namespace DSL typing or per-namespace d.ts emission (that is `runtime-qualification`).

**Validation gate.** `pnpm typecheck` · `pnpm fixtures:check` · `pnpm test:packages` (type errors none) · `pnpm lint:deps`. Push to `bot`; the work continues on PR #653 (same branch).

## Review

Opus 4.8-high reviewer after the dispatch. CI owns the validation gates. Reviewer confirms: no back-compat residue, validation is coordinate-based (not a flat Set), no silent cross-namespace merge, emitter is loud about single-namespace, storage untouched, framework domain has no `types`.
