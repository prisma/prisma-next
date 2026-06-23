# Project Plan

## Summary

Slices A (this reconciliation) and the scaffold+runtime work (old M1+M2) are done. The remaining slices are B–E, each one PR, all landing in or growing `examples/supabase` (the walking skeleton).

**Spec:** [`projects/extension-supabase/spec.md`](spec.md)
**Linear:** _(to be created — see project tracker in umbrella `projects/supabase-integration/README.md`)_

## Cross-project dependencies

This project is the integration layer; it consumes **all four** sibling projects plus the control-policy primitive:

- **[target-extensible-ir](../target-extensible-ir/spec.md)** through M5b — namespaces, target-only IR kind seam.
- **[control-policy](../control-policy/spec.md)** — the `external` control-policy value the shipped contract uses by default.
- **[cross-contract-refs](../cross-contract-refs/spec.md)** — brand machinery the typed handles consume.
- **[postgres-rls](../postgres-rls/spec.md)** — `.rls(...)` authoring + `PostgresRole` IR + verifier algorithm.
- **[runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md)** — the `SqlRuntimeBase` family seam + per-target `*RuntimeImpl` classes, and the session-coupled-connection role binding (`set_config(role/claims)` + `RESET ALL`). It also shipped the `SupabaseRuntimeImpl` + `supabase()` façade this project consumes.

Resulting global sequence (within the Supabase umbrella): **TML-2459 + control-policy** → **cross-contract-refs ∥ postgres-rls ∥ runtime-target-layer** → **this project** (the integration / launch).

A slip in any upstream project cascades into this project. The implementer should watch upstream PR status and surface blockers early.

## Slices

Each slice is one PR and lands in / grows `examples/supabase` (the walking skeleton).

### Slice A — Spec/plan reconciliation ✅ done (this slice, docs-only)

Ungated. Reconciles spec.md, plan.md, and `decisions.md` (C5) to as-built reality. No code changes.

### ✅ Scaffold + skeleton — done

`@prisma-next/extension-supabase` package with real `/pack`, `/contract` (model handles), and `/runtime` subpaths. PSL-authored Supabase contract (`defaultControl: 'external'`). `examples/supabase` walking skeleton: proves `external` migrate/verify claim, `Profile → auth.AuthUser` FK cascade, and RLS enforcement through the runtime.

Current state of the example:
- RLS policies are hand-authored raw SQL in `applyRlsFixture` (a test fixture). The `TODO(TML-2501)` marks role literals as hardcoded. Both are remaining work.

### ✅ Runtime facade — done (ADR 230)

`SupabaseRuntimeImpl`, the async `supabase<TContract>()` factory, `asUser` (async) / `asAnon()` / `asServiceRole()`, `SupabaseDb`/`RoleBoundDb`, JWT validation (`InvalidJwtError`), and session-coupled connection role binding (`set_config(role/claims)` + `RESET ALL` on release). See [ADR 230](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md).

### Slice B — RLS through the framework authoring surface

**Gate:** postgres-rls #771 (SELECT policy) + the UPDATE-own vertical landed.

**Goal:** swap `examples/supabase`'s `applyRlsFixture` raw SQL onto the framework authoring surface. The `Profile` model's RLS policies are declared via `.rls(...)` in TS or `policy_select`/`policy_update` blocks in PSL, emitted through the framework, applied by `dbInit` — no hand-authored `CREATE POLICY` in the test fixture.

**DoD tasks:**
- [ ] Express the `profile_owner_select` policy and the `profile_owner_update`-own-with-check policy through the framework authoring surface (TS `.rls(...)` or PSL `policy` blocks).
- [ ] Remove `applyRlsFixture`'s hand-authored `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` SQL. The framework migration handles it.
- [ ] Keep the RLS enforcement integration tests green.

**Note:** B and C may merge into one postgres-rls-integration slice if the `PostgresRole` IR and the `.rls(...)` authoring surface land together — check when postgres-rls closes out.

### Slice C — Roles first-class

**Gate:** postgres-rls's `PostgresRole` IR merged.

**Goal:** replace the hardcoded role literals in `SupabaseRoleBinding` (`'anon'|'authenticated'|'service_role'` with `TODO(TML-2501)`) with postgres-rls's `PostgresRole` IR. Declare Supabase's standard roles in the shipped contract (`anon`, `authenticated`, `service_role` as `control: 'external'`). The verifier confirms their existence via `pg_roles` introspection.

**DoD tasks:**
- [ ] Add role declarations to the shipped contract (PSL or contract.json).
- [ ] Replace the hardcoded role literal union in `SupabaseRoleBinding.role` with the `PostgresRole` IR type.
- [ ] Verifier integration test: pointing the runtime at a vanilla Postgres DB (no Supabase setup) raises `missing_role` for `anon`/`authenticated`/`service_role`.
- [ ] Keep the RLS enforcement integration tests green.

**Non-blocking follow-on:** enum-typed `auth.*` columns (enums-as-domain-concept project) can attach to this slice or land later.

### Slice D — `service_role` queries Supabase-internal namespaces via the facade

**Gate:** none — facade composition, independent of postgres-rls #771. (Reframed from "explicit `auth.users` query off the app db": that doesn't work and isn't meant to — cross-space *querying* off the app db was deliberately not built, and only `service_role` has `auth.*` grants. See decision [C15](../supabase-integration/decisions.md). Slice contract: [`slices/d-service-role-internal-namespaces/spec.md`](slices/d-service-role-internal-namespaces/spec.md).)

**Goal:** `db.asServiceRole().sql.auth.users` (and `storage.*`) is queryable on the `service_role`-bound db — the admin path — while `asUser`/`asAnon` expose only the app namespaces (`auth.*` absent from their type). The facade composes the extension contract's namespaces into the `service_role` execution context (facade-local; one shared pool).

**DoD tasks:**
- [ ] `service_role`-bound db exposes `auth`/`storage` namespaces on `.sql`; `asUser`/`asAnon` unchanged (no `auth.*`).
- [ ] Integration test: `asServiceRole().sql.auth.users` reads a seeded row, emitted SQL targets `"auth"."users"`, and `current_setting('role')` is `service_role`.
- [ ] Type-level test (against the app contract): `asServiceRole().sql` gains `auth`/`storage`; `asAnon()`/`asUser()` `.sql` do not.
- [ ] `overview.md` + decision [C15](../supabase-integration/decisions.md) reflect the admin-entrypoint surface (done in this slice).

### Slice E — Docs + real-Supabase acceptance + close-out

**Gate:** B, C, D done; explicit-namespace-dsl project close-out.

**Goal:** the package is launch-ready.

**DoD tasks:**
- [ ] Polish the package README: describe the role-binding model (session-coupled connections, ADR 230), JWT validation modes (secret vs JWKS), and unsupported scope (PostgREST interop, edge runtimes, Supabase Realtime, storage uploads).
- [ ] Launch-blocking acceptance test (manual, not in CI): provision a real Supabase project; run `examples/supabase` against it; verify all four handler flows (anon read, authenticated update-own, service-role admin read, JWT failure). Document evidence in the launch announcement.
- [ ] Update the extension-authoring skill (TML-2492) to reference this package as the canonical example.
- [ ] Update [umbrella `decisions.md`](../supabase-integration/decisions.md) marking all relevant decisions as ✅ shipped, with links to merged PRs.
- [ ] Promote any remaining ADR drafts not yet promoted by upstream projects.
- [ ] Close-out: delete `projects/extension-supabase/` per the project workflow rule.
- [ ] Optional stretch: implement `auth.uid()` as a column default via `DefaultFunctionRegistry`. Defer to v0.2 if not feasible.

## Risks and mitigations

- **Risk:** launch hinges on five upstream projects all landing. Any slip cascades.
  - **Mitigation:** the four sibling projects + control-policy are independent. The umbrella tracker (in `projects/supabase-integration/README.md`) lists each constituent's status. The implementer of this project watches upstream progress. If a slip is foreseeable, scope-cut decisions surface to the team: either delay the launch, or carve a smaller v0.1 (e.g. drop the example app from launch; ship the package without it; backfill the example post-launch).
- **Risk:** JWT validation has subtle bugs (audience checking, clock-skew tolerance, algorithm confusion). A bad JWT validator is a security hole.
  - **Mitigation:** use `jose` (or another mature library) rather than hand-rolling validation. Set `algorithms` strictly to `['HS256', 'RS256']` (or whatever Supabase actually uses) to prevent algorithm confusion. Test the validation path explicitly against every documented failure mode.
- **Risk:** PGlite-with-Supabase-schema diverges from real Supabase behaviour in ways that hide bugs.
  - **Mitigation:** the launch-blocking acceptance test runs against a real Supabase project. If PGlite tests pass but real-Supabase tests fail, the launch blocks. The PGlite path is for development speed + CI hermeticity; real-Supabase is the ground truth.
- **Risk:** the bundle-size NFRs (NFR3) prove hard to hit. The `/runtime` subpath naturally pulls in `pg` driver code, transaction machinery, JWT library — could exceed 50 KB.
  - **Mitigation:** the runtime is already shipped; measure bundle size now. If `/runtime` exceeds 50 KB, the budget gets bumped (with documentation of what's in it) rather than fighting it. The 50 KB number is aspirational; the real constraint is "tree-shaking actually works" (the discipline in NFR2), not absolute bundle size.
- **Risk:** the example app's CI integration tests are flaky against PGlite or against any real Supabase project.
  - **Mitigation:** run the integration tests in CI with retries (3 attempts) and timing instrumentation. If flakiness exceeds 5% over a 50-PR window, the implementer roots out the cause before the launch. PGlite is reasonably deterministic; the most likely flakiness source is the JWKS-fetch path (real network) — that path is tested separately with a mock JWKS server, not against the real Supabase JWKS endpoint.
- **Risk:** the launch-blocking acceptance test against a real Supabase project surfaces a behaviour that's not reproducible against PGlite. Hard to debug; potentially blocks the launch.
  - **Mitigation:** budget at least one full week before the launch for the real-Supabase acceptance test. If a divergence surfaces, the implementer either patches the package or documents the divergence as a known limitation in v0.1.
