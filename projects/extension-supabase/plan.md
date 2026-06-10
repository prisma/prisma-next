# Project Plan

## Summary

The project ships in four PRs sequenced contract → runtime → example → polish, and is the home of the **walking skeleton** — the runnable `examples/supabase` app that every other constituent wires into as it lands (strategy + growth table in the [umbrella README](../supabase-integration/README.md) §"Walking skeleton"; decisions [C13/C14](../supabase-integration/decisions.md)). M1 scaffolds the `@prisma-next/extension-supabase` package (subpath exports, hand-authored `contract.json`, `contract.d.ts`, branded `/contract` handles, the `/pack` descriptor) **and stands up the skeleton** running on the stock `@prisma-next/postgres/runtime`; the Supabase `/runtime` subpath is deferred to M2, so M1 is unblocked by the foundation + control-policy alone. M2 builds the runtime facade: `SupabaseRuntime extends PostgresRuntime`, JWT validation (sync via `jwtSecret`, async warmup via `jwksUrl`), `SupabaseDb` with `asUser` / `asAnon` / `asServiceRole`, `RoleBoundDb` extending `Db` with `transaction(...)`, the `SET LOCAL` + implicit-transaction plumbing wired through `withRawConnection`. M3 finalizes the (by-then incrementally-grown) `examples/supabase` app and adds the live-query RLS-enforcement e2e that depends on M2's role binding, running on the hermetic PGlite + Supabase-shim lane. M4 closes out documentation, the real-Supabase acceptance lane, and the umbrella decisions log.

**Spec:** [`projects/extension-supabase/spec.md`](spec.md)
**Linear:** _(to be created — see project tracker in umbrella `projects/supabase-integration/README.md`)_

## Cross-project dependencies

This project is the integration layer; it consumes **all four** sibling projects plus the control-policy primitive:

- **[target-extensible-ir](../target-extensible-ir/spec.md)** through M5b — namespaces, target-only IR kind seam.
- **[control-policy](../control-policy/spec.md)** — the `external` control-policy value the shipped contract uses by default.
- **[cross-contract-refs](../cross-contract-refs/spec.md)** — brand machinery the typed handles consume.
- **[postgres-rls](../postgres-rls/spec.md)** — `.rls(...)` authoring + `PostgresRole` IR + verifier algorithm.
- **[runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md)** — `PostgresRuntime` base class + `withRawConnection` accessor.

Resulting global sequence (within the Supabase umbrella): **TML-2459 + control-policy** → **cross-contract-refs ∥ postgres-rls ∥ runtime-target-layer** → **this project** (the integration / launch).

A slip in any upstream project cascades into this project. The implementer should watch upstream PR status and surface blockers early.

## Slices

The four PRs below correspond to the four slices (M1–M4). Each slice is one PR.

### M1 — Package scaffolding + PSL contract + `/pack` + walking skeleton

> **Scope re-cut 2026-06-05.** The `/contract` typed handles + roles were **cut from M1** (no consumer; deferred to `cross-contract-refs` / `postgres-rls`). The `bootstrapSupabaseShim` **splits**: M1 ships the *schemas + tables* increment (the verifier needs the `external` tables present); the roles + `auth.uid()`/`jwt()`/`role()` functions defer to `postgres-rls`. The authoritative M1 spec + 7-dispatch plan live at [`slices/m1-scaffold-and-skeleton/`](slices/m1-scaffold-and-skeleton/spec.md); the slice spec governs.

**Goal:** the package exists with `/pack` (real) + `/runtime` (stub) exports and the emitting PSL Supabase contract; the `examples/supabase` skeleton **proves the `external`-contract machinery end-to-end** — it migrates the composed contract against a seeded PGlite DB, the planner emits no DDL for `auth.*`/`storage.*`, the verifier confirms them present, and the app's own `public.profile` round-trip runs on the stock runtime. No Supabase runtime (`/runtime` is M2); no `/contract` handles, no roles, no `auth.*` functions.

**Tasks:**

- [ ] Scaffold the package at `packages/3-extensions/supabase/`, modeled on `pgvector` (`cipherstash` no longer exists). `package.json` `exports` declaring `/pack` (real) + `/runtime` (stub, M2). Register in `architecture.config.json`.
- [ ] Author `src/contract/contract.prisma` in **PSL** — namespaces `auth`/`storage` (omit empty `realtime`/`extensions`); models `AuthUser`/`AuthIdentity`/`StorageBucket`/`StorageObject`. Emit `contract.json` + `contract.d.ts`. `defaultControl: 'external'` via the `prismaContract({ defaultControlPolicy: 'external' })` config option. **No roles** (no `PostgresRole` IR yet).
- [ ] `src/pack/index.ts` exporting the `ExtensionPack` value (default) + `supabasePackWith(options)`. Carries the contract + `spaceId: 'supabase'`.
- [ ] Author the **minimal `bootstrapSupabaseShim`** — `CREATE SCHEMA auth, storage` + the four tables (matching the contract). No roles, no `auth.*` functions. The shared fixture's first increment.
- [ ] **Stand up the walking skeleton** at `examples/supabase`: `prisma-next.config.ts` wiring `extensionPacks: [supabasePack]`; an app contract with a `Profile` model in `public`; a `db.ts` on the **stock `@prisma-next/postgres/runtime`**; one handler running a `public.profile` round-trip. Integration test (modelled on `cli.control-policy.postgres.e2e.test.ts`): seed via the shim → migrate the composed contract → assert no DDL for `auth.*`/`storage.*` + verifier passes + `public.profile` created → run the round-trip. Committed `.skip` until green.
- [ ] Smoke test: `import supabasePack from '@prisma-next/extension-supabase/pack'` resolves + typechecks from an app contract declaring `extensionPacks: [supabasePack]`. `pnpm lint:deps` green. `/pack` bundle < 5 KB gzip. `pnpm fixtures:check` green.

**Deferred from M1 (land with their consumer):** `/contract` handles + `ModelHandle`/`RoleRef` + roles → `cross-contract-refs` / `postgres-rls`; the **roles + `auth.uid()`/`jwt()`/`role()` functions** of the shim → `postgres-rls`; real `/runtime` → M2.

**Validation:** AC1 (subpath resolves, bundle budget) verified for `/pack`; the skeleton migrates the composed contract against a shim-seeded PGlite DB with `auth.*`/`storage.*` correctly handled as `external`, and the `public.profile` round-trip runs on the stock runtime. AC2/AC3 (cross-contract FK + RLS authoring) and AC4 onwards land with their constituents / M2.

### M2 — Runtime facade (`SupabaseRuntime`, role binding, SET LOCAL)

**Goal:** the runtime facade is live. `supabase({...})` returns a `SupabaseDb`; `asUser(jwt)` / `asAnon()` / `asServiceRole()` produce role-bound `Db` instances; queries through role-bound `Db`s issue `SET LOCAL role` + `SET LOCAL request.jwt.claims` below user middleware in an implicit transaction.

**Tasks:**

- [ ] Add `class SupabaseRuntime extends PostgresRuntime` in `src/runtime/index.ts`. Constructor: validates `jwtSecret` xor `jwksUrl` configuration, warms up JWKS if `jwksUrl` is set, forwards `contractJson` / `url` / `pool` / `middleware` to `super(...)`.
- [ ] Override the runtime's execute path: wrap the base execute in `withTransaction(() => withRawConnection(conn => { conn.exec("SET LOCAL role = '...'"); conn.exec("SET LOCAL request.jwt.claims = '...'"); return super.execute(plan); }))`.
- [ ] Implement JWT validation using the chosen library (recommend `jose`):
  - Symmetric secret path: HS256 / HS512 validation via `jwtSecret`. Sub-millisecond.
  - Asymmetric / JWKS path: RS256 etc. via JWKS endpoint. Cache the signing key warmed up at factory time.
  - Validation includes signature, expiry, optional audience, optional issuer. Failure throws `InvalidJwtError` with typed `reason`.
- [ ] Implement `SupabaseDb` and `RoleBoundDb` interfaces. `SupabaseDb` exposes only `asUser`, `asAnon`, `asServiceRole`. `RoleBoundDb` extends `Db` and adds `transaction<R>(fn)`.
- [ ] `RoleBoundDb.transaction()` opens one transaction with one `SET LOCAL`; the closure body runs against `tx` pinned to the same connection; commit/rollback at closure exit. Reuses the base `withTransaction` from the runtime-target-layer project.
- [ ] Export `supabase` as the default factory from `/runtime`. Export `SupabaseRuntime` class as named export. Export `InvalidJwtError` class as named export.
- [ ] Unit tests:
  - JWT validation success (HS256 + RS256+JWKS).
  - JWT validation failure modes: malformed, expired, mis-signed, wrong audience, wrong issuer — each yields the typed reason.
  - `db.asUser(badJwt)` throws synchronously; no connection acquired.
  - `db.asUser(goodJwt)` returns a `RoleBoundDb`.
  - `SupabaseDb` doesn't expose `.sql.from(...)` at the top level (type-level assertion via a `// @ts-expect-error` test).
- [ ] Integration tests against PGlite seeded with `bootstrapSupabaseShim(client)` (from M1):
  - Statement sequence on `asUser(jwt).sql.from(...).execute()` is `BEGIN; SET LOCAL role; SET LOCAL request.jwt.claims; <query>; COMMIT;`. Verified by hooking the connection and recording statements.
  - User middleware sees only the logical query (the `BEGIN` / `SET LOCAL` / `COMMIT` statements are invisible). Verified by a logging middleware in the test fixture.
  - `asUser(jwt).transaction(async (tx) => { tx.sql..., tx.sql... })` issues one BEGIN + one SET LOCAL + two queries + one COMMIT.

**Validation:** AC4, AC5, AC6, AC7 verified.

### M3 — Finalize the example app + live-query RLS-enforcement e2e

**Goal:** the `examples/supabase` walking skeleton — grown incrementally across the constituent lands — is finalized as the canonical demo, ungated in CI, and the RLS-enforcement e2e that depends on M2's automatic role binding is added. By this point the example already exercises the cross-contract FK, RLS policies, and namespace queries (each wired in by its own constituent's DoD); M3 assembles the full handler flow and proves enforcement through the runtime rather than by hand.

**Tasks:**

- [ ] Finalize the example app at `examples/supabase` (stood up in M1, grown by the constituents). Complete the app contract (`Profile` with cross-contract FK to `AuthUser` + RLS policies), `db.ts` switched to the Supabase `/runtime` factory (`supabase({...})`), and the handler module exposing `listProfiles` / `createProfile` / `updateProfile` / `adminListProfiles`. Ungate it from the default test matrix.
- [ ] Live-query RLS-enforcement integration tests against PGlite seeded with `bootstrapSupabaseShim(client)` — these are the tests that need M2's automatic role binding (policy correctness via manual `SET ROLE` was already proven in the `postgres-rls` project):
  - Migration: `prisma-next push` against the test database creates `public.profile` with FK to `auth.users.id`; creates the RLS policies; enables RLS on the table.
  - RLS enforcement: a query through `asAnon()` returns rows whose policy permits anon read; returns zero rows where it doesn't.
  - RLS enforcement: a query through `asUser(jwtForUserA)` can update User A's row but not User B's row (zero rows updated).
  - RLS enforcement: a query through `asServiceRole()` returns all rows (RLS bypassed).
  - Cascade delete: deleting `auth.users[id=X]` cascades to `public.profile[user_id=X]`.
- [ ] Verifier integration test:
  - Pointing the runtime at the test database: verifier reports zero issues for `auth.users`, `auth.identities`, `storage.buckets`, `storage.objects` (under `external` control). Zero issues for the role declarations.
  - Pointing the runtime at a vanilla Postgres database (no Supabase setup): verifier raises `missing_role` for each of `anon` / `authenticated` / `service_role`.
- [ ] README walking through setup:
  - Create a Supabase project + grab connection URL + JWT secret.
  - `npm install @prisma-next/extension-supabase` + scaffold the contract.
  - `prisma-next emit` to generate `contract.d.ts`.
  - `prisma-next push` to migrate.
  - Run the dev server; demonstrate the three role-binding handlers via curl.
- [ ] Performance benchmark: measure single-query overhead of `asUser(jwt).execute()` vs raw Postgres query. Verify NFR1 (<2ms median overhead).
- [ ] Performance benchmark: measure JWT validation latency. Verify NFR2.

**Validation:** AC8, AC9, AC10, AC11, AC12 verified.

### M4 — Documentation + launch-blocking acceptance + close-out

**Goal:** the package is launch-ready. Real-Supabase-project acceptance test runs (manually). Documentation is polished. The umbrella decisions log is updated. Project artefacts are cleaned up.

**Tasks:**

- [ ] Polish the package's top-level README: describe the role-binding model, the `SET LOCAL`-below-middleware security property, the JWT validation modes (secret vs JWKS), the implicit-transaction guarantee, the unsupported scope (PostgREST interop, edge runtimes, Supabase Realtime, ergonomic storage uploads).
- [ ] Launch-blocking acceptance test (manual, not in CI): provision a real Supabase project; run the example app against it; verify all four handler flows work end-to-end (anon read, authenticated update-own, service-role admin read, JWT failure). Document the test run's evidence in the launch announcement.
- [ ] Update the extension-authoring skill (TML-2492) to reference this package as the canonical example. Cross-link from the skill into the package's source.
- [ ] Update [umbrella `decisions.md`](../supabase-integration/decisions.md) marking all relevant decisions (A1–A8 RLS surface, B1–B6 PSL surface, C1–C12 cross-cutting) as ✅ shipped, with links to merged PRs. Mark umbrella offcuts (OC1, OC2, OC3, OC4) as having follow-up tickets where applicable.
- [ ] Promote any ADR drafts that haven't been promoted by the upstream projects (most should have promoted in their own close-outs; verify and pick up any stragglers).
- [ ] Optional stretch goal: implement `auth.uid()` as a column default via `DefaultFunctionRegistry`. Documented in the README if shipped; deferred to v0.2 if not.
- [ ] Optional stretch goal: document the "create profile on signup" trigger pattern as a recipe in the README. Not first-class framework support; just a documented user-side approach.
- [ ] Close-out: delete `projects/extension-supabase/` per the project workflow rule (after the docs migration). Likely also coordinates closing the umbrella `projects/supabase-integration/` directory in this same close-out wave; see umbrella tracker.

**Validation:** AC13 verified. Real-Supabase-project acceptance test passes; launch readiness signed off by the team.

## Risks and mitigations

- **Risk:** launch hinges on five upstream projects all landing. Any slip cascades.
  - **Mitigation:** the four sibling projects + control-policy are independent. The umbrella tracker (in `projects/supabase-integration/README.md`) lists each constituent's status. The implementer of this project watches upstream progress. If a slip is foreseeable, scope-cut decisions surface to the team: either delay the launch, or carve a smaller v0.1 (e.g. drop the example app from launch; ship the package without it; backfill the example post-launch).
- **Risk:** JWT validation has subtle bugs (audience checking, clock-skew tolerance, algorithm confusion). A bad JWT validator is a security hole.
  - **Mitigation:** use `jose` (or another mature library) rather than hand-rolling validation. Set `algorithms` strictly to `['HS256', 'RS256']` (or whatever Supabase actually uses) to prevent algorithm confusion. Test the validation path explicitly against every documented failure mode.
- **Risk:** PGlite-with-Supabase-schema diverges from real Supabase behaviour in ways that hide bugs.
  - **Mitigation:** the launch-blocking acceptance test runs against a real Supabase project. If PGlite tests pass but real-Supabase tests fail, the launch blocks. The PGlite path is for development speed + CI hermeticity; real-Supabase is the ground truth.
- **Risk:** the bundle-size NFRs (NFR3) prove hard to hit. The `/runtime` subpath naturally pulls in `pg` driver code, transaction machinery, JWT library — could exceed 50 KB.
  - **Mitigation:** the implementer measures bundle size at M2 close. If `/runtime` exceeds 50 KB, the budget gets bumped (with documentation of what's in it) rather than fighting it. The 50 KB number is aspirational; the real constraint is "tree-shaking actually works" (the discipline in NFR2), not absolute bundle size.
- **Risk:** the example app's CI integration tests are flaky against PGlite or against any real Supabase project.
  - **Mitigation:** run the integration tests in CI with retries (3 attempts) and timing instrumentation. If flakiness exceeds 5% over a 50-PR window, the implementer roots out the cause before the launch. PGlite is reasonably deterministic; the most likely flakiness source is the JWKS-fetch path (real network) — that path is tested separately with a mock JWKS server, not against the real Supabase JWKS endpoint.
- **Risk:** the launch-blocking acceptance test against a real Supabase project surfaces a behaviour that's not reproducible against PGlite. Hard to debug; potentially blocks the launch.
  - **Mitigation:** budget at least one full week before the launch for the real-Supabase acceptance test. If a divergence surfaces, the implementer either patches the package or documents the divergence as a known limitation in v0.1.
