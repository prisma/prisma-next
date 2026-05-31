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

## Review

Opus 4.8-high reviewer after **each** dispatch. CI owns the validation gates. Reviewer confirms: no back-compat residue, validation is coordinate-based (not a flat `Set`), no silent cross-namespace merge, emitter loud about single-namespace, storage untouched, framework domain has no `types`. Work continues on PR #653 (same branch).
