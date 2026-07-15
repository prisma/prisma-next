# Slice — User-facing skills teach the Supabase extension

**Entry-point:** operator directive 2026-07-15 — "update the user's skills to explain how to use the Supabase extension." In-project slice (this project shipped the extension; the user-facing skills are its last uncovered surface). One PR, docs-only within `skills/`.

## Gap (grounded)

The `skills/` usage cluster (installed into user projects by `prisma-next init` via `skills add …/skills --skill '*'`) predates the shipped integration:

- No skill covered the `supabase()` role-first runtime, role binding, JWT modes, RLS authoring (`policy_select` / `@@rls` appeared nowhere in the cluster), grants, the `db.supabase` admin root, or real-connection guidance.
- `prisma-next-contract`'s Supabase section showed the **pre-ADR-230** runtime wiring (`extensions: [supabaseExtension]` into the stock `postgres()` factory) — stale since the `supabase()` facade shipped.
- The router, runtime, and queries skills had no Supabase routing.

## Chosen design

A dedicated **`prisma-next-supabase`** skill carrying the end-to-end workflow, plus routing/staleness touch-ups in siblings. Rationale: Supabase usage spans three workflow skills (contract, runtime, queries), so no single existing skill can own it without sprawl; the extension has its own runtime factory — structurally closer to a target façade than to contract-only extensions like pgvector, which live inside `prisma-next-contract`. A new `skills/<name>/SKILL.md` is auto-installed by init's `--skill '*'` — no CLI wiring.

Authored per `skills/DEVELOPING.md`: every surface claim verified against source while drafting (exports map, `SupabaseOptions`, `RoleBoundDb`/`ServiceRoleDb` shapes, `policy_*`/`@@rls` + `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`, TS `policySelect`/`rlsEnabled`/`role` exports on `@prisma-next/postgres/contract-builder`, no-GRANT-emission, no `/control` subpath); examples mirror `examples/supabase` verbatim; concepts-not-procedures; mandatory *What Prisma Next doesn't do yet*.

Hard-won operational knowledge folded in from the acceptance run: session pooler (5432) vs IPv6-only direct connection vs the forbidden 6543 transaction pooler; grants-vs-policies distinction; 0-rows semantics of RLS-filtered writes.

## Definition of done

- [x] `skills/prisma-next-supabase/SKILL.md` — config wiring, contract (cross-space FK + RLS), `db.ts`, role-bound queries, admin root, grants, real-connection guidance, testing, pitfalls, gaps.
- [x] Touch-ups: router routing line + description; `prisma-next-contract` stale runtime snippet replaced with a pointer; `prisma-next-runtime` / `prisma-next-queries` *When Not to Use* pointers; `skills/README.md` table row.
- [x] Journey test `skills/journey-tests/08-supabase-rls.md`.
- [ ] `pnpm lint:skills` green; DEVELOPING.md façade-import ripgrep clean over the new skill.
