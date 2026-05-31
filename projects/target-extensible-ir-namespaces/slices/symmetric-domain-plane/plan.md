# Slice plan: symmetric domain plane

**Spec:** [`spec.md`](./spec.md)

## History

The first pass (D1 substrate + D2 consumers/fixtures) landed the `domain.namespaces` envelope and is on PR #653 — but review found it wrapped the shape over a flat identity model bridged by back-compat. The rework below replaces that layer; it supersedes the original D1/D2 framing for the parts it touches.

## Rework dispatches — two units along the substrate→consumer seam

Sized against `drive/calibration/sizing.md`. A single dispatch tripped two mis-sizing anti-patterns (substrate + consumer in one; design judgment + rename fan-out in one) and its `Completed when` read as a paragraph, not a 1–3 item checklist. The prior failure on this slice was *underspecified outcome + missing halt conditions* (the 81-file defensive-helper expansion), so each brief below names a sharp outcome, a binary checklist, and explicit halt conditions that fence the executor's freedom.

### Dispatch 1 — coordinate identity in the `contract` package (the judgment)

**Surface (do not leave this package):** `packages/1-framework/0-foundation/contract/**` only. (One emitter call site moves in Dispatch 2, not here.)

**Outcome.** The foundation contract's domain identity is coordinate-`(namespace, model)`-based: no legacy-flat read path, no cross-namespace merge, validation resolves by coordinate.

**Completed when (all binary):**
- [ ] `rg 'LegacyFlatDomainRoot|DomainContractInput|isLegacyFlatDomainRoot|normalizeLegacyDomainRoot'` over `packages/` returns empty.
- [ ] A new test in the `contract` package proves two models with the same name in two different namespaces validate as **distinct** (no false "duplicate" / no collapse).
- [ ] `rg "Object.assign|UnionToIntersection"` in `domain-envelope.ts` / `contract-types.ts` returns empty for the model/VO merge paths; the single-namespace projection takes or asserts a `namespaceId`.
- [ ] `pnpm test:packages -- @prisma-next/contract` green; `pnpm typecheck` green for the package.

**Halt conditions (stop and report — do NOT invent a workaround):**
- You need to add any normalization / compatibility / defensive helper that accepts more than the `domain.namespaces` shape.
- You need a cross-namespace flat merge to make types line up.
- The change forces edits outside `packages/1-framework/0-foundation/contract/**` to get the package green (that ripple is Dispatch 2 — report the surface it wants).
- Storage flatten or framework `domain.types` (slice-wide refusal).

**Includes the surgical canonicalizer swap** (`matchesPathPattern` for the domain path checks) — it lives in this package and is part of the identity-correctness outcome.

### Dispatch 2 — consumer migration + renames (the fan-out)

**Builds on:** Dispatch 1's new `contract` API (committed on-branch).

**Outcome.** Every consumer uses the new projection + names; the emitter is loud (throws) on a multi-namespace domain; all gates green.

**Completed when (all binary):**
- [ ] `rg 'buildDomainPlaneFromFlat|DomainContractSlice'` over `packages/` + `examples/` + `test/` returns empty (renamed to `domainPlaneOf` / `ContractWithDomain`).
- [ ] The emitter **throws** (test-pinned) when handed a domain with >1 namespace; single-namespace emission unchanged.
- [ ] `pnpm typecheck` · `pnpm fixtures:check` · `pnpm test:packages` (type errors none; PGlite/MMS flakes noted, not type regressions) · `pnpm lint:deps` all green.

**Halt conditions:**
- Any consumer "needs" a cross-namespace merge — stop; the single-namespace projection names its namespace.
- The migration pulls you into multi-namespace DSL typing or per-namespace `contract.d.ts` emission — stop; that is `runtime-qualification`.

**Note.** The typecheck sweep already migrated fixtures to call `buildDomainPlaneFromFlat`; this dispatch renames those call sites. Pure mechanical fan-out — no new judgment.

## Rework round 2 — foundation surface honesty (single dispatch)

A second review round confirmed the structure + validator are correct, but flagged three foundation-surface defects (see spec "Rework round 2"). All three have fully-decided designs and small/mechanical blast radii — `DomainPlane` is 5 files (not in generated d.ts), `DomainNamespace` 2 files, the bulk is a mechanical 83-test-file import swap for the relocated helper. Sized against `drive/calibration/sizing.md`: one coherent unit ("clean the foundation domain surface"), low freedom (exact names + destination + key strategy are specified), fan-out is mechanical. Kept as **one** dispatch with an ordered checklist; the prior over-complex failures were underspecified-outcome/too-much-freedom, neither of which applies here.

### Dispatch 3 — foundation surface honesty

**Surface:** `packages/1-framework/0-foundation/contract/**`, `test/utils/**` (test-utils new home), and the 83 test files importing the relocated helper.

**Outcome.** The foundation `contract` production surface carries only namespaced structural truth + the (transitional, untouched) projection helpers; the application-domain segment type is named for ubiquitous language; identity keys are structural; the test-only authoring helper is gone from production code.

**Do it in this order, committing between steps:**
1. **Structural identity key.** Replace `modelCoordinateKey` `${ns}:${model}` string with a collision-safe structural key in `validate-domain.ts` (nested namespace→model map or canonical non-ambiguous encoding; prefer the existing `EntityCoordinate` shape). The same-name-in-two-namespaces pin must keep passing. Commit.
2. **Rename for ubiquitous language.** `DomainPlane` → `ApplicationDomain`, `DomainNamespace` → `ApplicationDomainNamespace`, and rename the authoring constructor away from "plane" (e.g. `applicationDomainOf`). Field stays `domain`. Update all references; `pnpm typecheck` green. Commit.
3. **Evict the test helper.** Move the renamed authoring constructor to `@prisma-next/test-utils` (`test/utils`); remove it from `contract/src` + `contract/src/exports`; point all 83 test sites at test-utils. Commit.

**Completed when (all binary):**
- [ ] `rg '\bDomainPlane\b|\bDomainNamespace\b'` over `packages/` + `test/` + `examples/` returns empty.
- [ ] `rg "modelCoordinateKey|\\$\\{.*\\}:\\$\\{" ` shows no `${ns}:${model}` identity key; validator keys structurally; same-name-two-namespaces pin green.
- [ ] The relocated helper is exported from `@prisma-next/test-utils`; `rg 'domainPlaneOf|applicationDomainOf' packages/1-framework/0-foundation/contract/src` returns empty.
- [ ] `pnpm typecheck` · `pnpm lint:deps` · `pnpm test:packages -- @prisma-next/contract` green.

**Halt conditions (stop and report — do NOT work around):**
- Relocating the helper to test-utils creates a package-graph cycle `lint:deps` rejects (e.g. `contract` tests → test-utils → `contract`). Report; do not suppress the lint.
- You are tempted to relocate or delete the shared runtime mappers (`contractModels` / `contractValueObjects` / `resolveSingleDomainNamespaceId`) or the type-level `ContractModelsMap` / `ContractValueObjectsMap` — **stop**; they stay this slice (deferred to `runtime-qualification`).
- The rename forces touching generated `contract.d.ts` content beyond import names — report (it shouldn't; `DomainPlane` isn't emitted).

## Rework round 3 — finish evicting non-foundation code from contract src (review-driven)

Live review of the round-2 result surfaced two more misplaced things in `contract/src` (same principle as `domainPlaneOf`): a `testing-factories.ts` test-support module (exported via the public `@prisma-next/contract/testing` subpath, ~23 test consumers, zero production consumers) and an inline `DomainNamespaceResolutionError` class while `ContractValidationError` already has a home in `contract-validation-error.ts`.

### Dispatch 4 — surface cleanup

1. **Relocate `DomainNamespaceResolutionError`** to live with `ContractValidationError` (the package's centralized contract-error module). Update imports. Tiny.
2. **Evict `testing-factories.ts` to `@prisma-next/test-utils`** — it is test-only (no production consumers). Repoint the ~23 test consumers (currently importing `@prisma-next/contract/testing`). Contract's own tests use a local helper to avoid the contract↔test-utils cycle (same pattern as `applicationDomainOf`).

**HALT condition:** `createContract`/`createSqlContract` depend on contract's **non-exported** hashing internals (`computeStorageHash`, etc.). If relocating forces widening contract's *main public API* to expose those, **stop and report** — trading "test code in prod" for "leaked internals" is not a win. A test-only subpath export is acceptable; polluting the primary surface is not.

### Deferred (NOT relocated this slice — decision recorded)

`contractModels` / `contractValueObjects` / `resolveSingleDomainNamespaceId` (and type-level `ContractModelsMap` / `ContractValueObjectsMap`) stay in foundation this slice. They are shared single-namespace projections across three consumer families (Mongo DSL, `sql-orm-client`, emitter) with no common home below foundation; the `runtime-qualification` slice eliminates them as it makes those consumers namespace-aware. Relocating now is throwaway churn that slice immediately deletes. Review threads on these get a reply documenting the decision and are resolved.

## Review

Opus 4.8-high reviewer after **each** dispatch. CI owns the validation gates. Reviewer confirms: no back-compat residue, validation is coordinate-based (not a flat `Set`), no silent cross-namespace merge, emitter loud about single-namespace, storage untouched, framework domain has no `types`. For round 2: `ApplicationDomain` naming applied throughout, identity key is structural (no `${ns}:${model}`), the authoring helper is gone from production code, and the transitional projection helpers are untouched. Work continues on PR #653 (same branch).
