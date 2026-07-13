# Brief: D3 branded-contract-handles

## Task

Ship `extensionModel`-branded model handles from `@prisma-next/extension-better-auth/contract` — `User`, `Session`, `Account`, `Verification` — **such that** an app contract authored with the framework's TS/PSL authoring surface can declare a cross-space FK onto a better-auth model (e.g. a `Profile.userId` with `rel.belongsTo(User, …)` or the current authoring equivalent) and the emitted app contract lowers it to a cross-space FK reference (`source: 'space'`-style, referencing `"public"."user"(id)`), exactly as the supabase extension's handles do for `AuthUser`. Follow `packages/3-extensions/supabase/src/contract/handles.ts` as the concrete precedent — including how the handles are derived from the space's `contract.json`/`contract.d.ts` shape and how the brand carries `spaceId: 'better-auth'`.

## Scope

**In:** `packages/3-extensions/better-auth/src/contract/handles.ts` (new) + its export through `src/exports/contract.ts`; package-level tests: a type-level test pinning the brand/spaceId/namespace/table coordinates of all four handles, and a behavioural test proving the cross-space lowering (authoring a minimal app contract with a FK onto `User` and asserting the emitted reference — mirror how supabase's package tests or the cross-contract-refs tests prove this; grep for the precedent).

**Out:** the `/adapter` subpath (D4); `examples/**` (D7 demonstrates the FK in a real app); `test/integration/**` (unless the supabase precedent proves lowering only via an integration surface — if package-level proof is impossible, HALT and surface rather than silently relocating the test).

## Completed when

- [ ] All four handles exported from `@prisma-next/extension-better-auth/contract`, branded with `spaceId: 'better-auth'` and the correct namespace/table coordinates (type-level test).
- [ ] Cross-space FK lowering proven by a test that fails iff the lowering breaks (behavioural, through the authoring surface — not a hand-built IR literal).
- [ ] Gates: package build + test + typecheck (incl. test project) + lint; `pnpm typecheck` workspace; `pnpm lint:deps`.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes with a one-line note; drift halts and surfaces.

## References

(You are resumed — new context only.)

- Slice plan entry: `plan.md` § D3 — hands-to D7 (example's `Profile → User` FK).
- Precedent: `packages/3-extensions/supabase/src/contract/handles.ts` + wherever its handles' lowering is tested (grep `AuthUser` across `packages/` and `test/` — the cross-contract-refs machinery docs/tests).
- Calibration: F5 (git discipline), F14 (gates mirror CI), F21 (build the real authoring surface the slice delivers — handles must work through the public authoring path, not through option-bag shortcuts), dod.md § Test-dispatch overlay ("fails iff" + right surface).

## Operational metadata

- **Model tier:** mid — pattern-following against a direct sibling precedent.
- **Time-box:** 60 min. Overrun → halt with snapshot.
- **Halt conditions:** cross-space lowering cannot be proven at package level (surface, don't relocate); the brand machinery requires framework changes; diff exceeds ~10 files.
- **Progress notes:** heartbeats as before.
