# Project Plan

## Summary

One PR (~2–3 days) delivering the explicit namespace-aware DSL/ORM surface on top of [TML-2605](https://linear.app/prisma-company/issue/TML-2605). Work is decomposed into four dispatches: resolve collision behaviour and lock type shape; build SQL + ORM namespace accessor types; wire runtime resolution through the qualification path; land Supabase-shaped example coverage and close-out (ADR / upgrade instructions if needed).

**Spec:** [`projects/explicit-namespace-dsl/spec.md`](spec.md)
**Linear:** [TML-2550](https://linear.app/prisma-company/issue/TML-2550)

## Cross-project dependencies

| Direction | Project | Notes |
|---|---|---|
| **Blocked by** | [runtime-qualification](../target-extensible-ir-namespaces/spec.md) ([TML-2605](https://linear.app/prisma-company/issue/TML-2605)) | Identifier qualification + default-namespace fallback must exist before explicit `db.sql.<ns>` routing. |
| **Blocks** | [extension-supabase](../extension-supabase/spec.md) ([TML-2503](https://linear.app/prisma-company/issue/TML-2503)) | Launch blocker — colliding `auth.users` / `public.users` require explicit accessors. |
| **Independent of** | [runtime-target-layer](../runtime-target-layer/spec.md), [postgres-rls](../postgres-rls/spec.md), [cross-contract-refs](../cross-contract-refs/spec.md) | No shared code path unless pickup discovers accessor coupling. |
| **Does not gate** | [target-extensible-ir-namespaces](../target-extensible-ir-namespaces/spec.md) close-out | Elevated out of that umbrella intentionally. |

## Dispatches

Single PR; dispatches are logical execution order for one implementer (or one reviewable commit series squashed at merge).

### D1 — Collision decision + type-level accessor shape

- **Outcome:** Pick option A, B, or C for flat-by-name collision behaviour; `Db<C>` (and related types) expose `db.sql.<ns>` and `db.<ns>` with namespace keys derived from `contract.storage.namespaces` / `contract.domain.namespaces`. Negative type tests for unknown namespace ids.
- **Builds on:** TML-2605 merged (default-namespace fallback types stable).
- **Hands to:** D2 (runtime can assume frozen accessor shape).
- **Focus:** Spec [Open Questions](../explicit-namespace-dsl/spec.md#open-questions) resolution; type-level construction only — no execute-path changes yet. Draft ADR section if the decision is non-obvious.

### D2 — Runtime resolution through qualification path

- **Outcome:** Execute path for `db.sql.<ns>.<table>` and `db.<ns>.<Model>` resolves storage/domain coordinates and delegates to TML-2605 qualification helpers; mis-resolution fails fast with actionable diagnostics (FR8–FR9).
- **Builds on:** D1 accessor types.
- **Hands to:** D3 (end-to-end queryable).
- **Focus:** Runtime wiring in DSL/ORM client packages — no second qualification pipeline. Regression tests proving flat paths unchanged (FR6 / AC3).

### D3 — Multi-namespace example + integration tests

- **Outcome:** Supabase-shaped fixture: `namespace public { model Profile … }` plus extension `auth` `users`; emit contract; integration test queries `db.sql.auth.users` and `db.sql.public.profile` (and ORM equivalents) against PGlite; AC1–AC4 satisfied.
- **Builds on:** D2 runtime resolution.
- **Hands to:** D4 close-out.
- **Focus:** Authoring + emit + query in one test. **Wire this into the `examples/supabase` walking skeleton** (decisions [C13/C14](../supabase-integration/decisions.md)) rather than a throwaway fixture — add the `auth.users`-alongside-`public.users` explicit-accessor query to the running example, tested via PGlite + `bootstrapSupabaseShim`. `extension-supabase` finalizes the polished demo on top.

### D4 — Close-out (ADR, upgrade instructions, umbrella tracker)

- **Outcome:** Collision + surface-shape ADR promoted if warranted; `record-upgrade-instructions` only if a breaking type/export surfaced (working assumption: skip); umbrella README row for explicit-namespace-dsl marked implementer-ready/shipped when PR merges.
- **Builds on:** D3 green CI.
- **Hands to:** [extension-supabase](../extension-supabase/spec.md) unblocked for explicit-namespace query paths in M3 example work.
- **Focus:** Documentation and tracker hygiene — no new features.

## Definition of done

- [ ] All [Acceptance Criteria](../explicit-namespace-dsl/spec.md#acceptance-criteria) met (AC1–AC6).
- [ ] Collision-behaviour decision recorded (ADR or spec amendment).
- [ ] `pnpm test:packages` + relevant integration tests green; `pnpm lint:deps` passes.
- [ ] No regressions on default-namespace demo queries (AC3).
- [ ] The `examples/supabase` walking skeleton exercises the explicit `auth.users` / `public.users` accessor (cross-cutting walking-skeleton DoD; [README](../supabase-integration/README.md) §"Walking skeleton").
- [ ] PR linked from [TML-2550](https://linear.app/prisma-company/issue/TML-2550); operator notified that [TML-2503](https://linear.app/prisma-company/issue/TML-2503) explicit-accessor prerequisite is cleared.

## Risks and mitigations

- **Risk:** TML-2605 API drift during parallel development delays pickup.
  - **Mitigation:** Do not start D2 until TML-2605 is on `main`; D1 type work can prototype against merged qualification types only.
- **Risk:** Option A (union types) balloons `Db<C>` inference past practical tsc limits.
  - **Mitigation:** Decide at D1; fall back to B or C per NFR2 rather than shipping unusable inference.
- **Risk:** Scope creep into emitter per-namespace `contract.d.ts` splits.
  - **Mitigation:** Spec non-goals — halt and report if emitter changes become necessary; do not expand PR.
- **Risk:** Role-bound Supabase `Db` wrapper does not forward new namespace facets.
  - **Mitigation:** Add a compile test in D3 that `RoleBoundDb` (or the extension-supabase wrapper once available) exposes the same `sql.<ns>` / `<ns>.<Model>` shape as base `Db`.
