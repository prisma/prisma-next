# runtime-target-layer — Plan

**Spec:** `projects/runtime-target-layer/spec.md`
**Linear Project:** [Runtime Target Layer](https://linear.app/prisma-company/project/runtime-target-layer-53c6310a9bd4) (Terminal team). Anchor issue [TML-2502](https://linear.app/prisma-company/issue/TML-2502); slices TML-2878 → TML-2879 → TML-2880 → TML-2881 (chained by blocking relations).

## At a glance

A stack of 4 slices, delivered in order. Each builds on the previous's hand-off; there is no parallelism worth extracting (every slice consumes the prior's surface, and the only doc work depends on the as-built mechanism settling). Slice 1 is a deliberately minimal no-behaviour-change rename to isolate hot-path regression; slice 2 is the core substrate; slice 3 is the Supabase consumer; slice 4 is the end-to-end proof + durable docs.

## Composition

### Stack (deliver in order)

1. **Slice `export-sql-runtime`** — Linear: [TML-2878](https://linear.app/prisma-company/issue/TML-2878)
   - **Outcome:** `SqlRuntimeImpl` is renamed to `SqlRuntime` and exported from `@prisma-next/sql-runtime` under a stable public symbol; `createRuntime` still returns it; no behaviour change.
   - **Builds on:** None.
   - **Hands to:** An exported, subclassable family-layer runtime class for slices 2–3 to host the new primitive on and subclass.
   - **Focus:** Pure rename + export. The class is fully private today (the package exports only `createRuntime`/`withTransaction`), so there are **no downstream consumers to migrate** — the export is additive. No `SqlRuntimeImpl` back-compat alias. Existing tests + the runtime micro-benchmark are the regression check (NFR: hot path unchanged). Deliberately minimal per the spec's transitional-shape constraint — kept separate so any regression is attributable to the rename alone, not to the new functionality.

2. **Slice `session-bootstrap-primitive`** — Linear: [TML-2879](https://linear.app/prisma-company/issue/TML-2879)
   - **Outcome:** A `protected executeWithSessionBootstrap(plan, bootstrap, options)` exists on `SqlRuntime`: it opens an implicit transaction, runs the `bootstrap` closure on the transaction's raw connection **below the user middleware chain**, runs the typed query against that same sticky connection, and releases/destroys correctly on success and on throw. A narrow `RawSessionConnection` surface (a `query(sql, params)` slice of the existing queryable) is what the closure receives.
   - **Builds on:** Slice 1's exported `SqlRuntime` class.
   - **Hands to:** A tested below-middleware session seam that slice 3's `SupabaseRuntime` consumes by passing a `SET LOCAL`-issuing closure.
   - **Focus:** The connection-lifecycle correctness lives here, not in any consumer. Unit tests: connection identity across bootstrap + query (stickiness), release on callback resolve, destroy/rollback on callback throw, and bootstrap SQL invisible to a registered user middleware. Resolve open question 1 (this layer vs `RuntimeCore`) and open question 2 (the `RawSessionConnection` shape) by inspection here. No Supabase/Postgres-specific code in this slice — the primitive is target-agnostic.

3. **Slice `supabase-runtime-and-facade`** — Linear: [TML-2880](https://linear.app/prisma-company/issue/TML-2880)
   - **Outcome:** construction moves to the target layer, and the Supabase consumer ships on it. `PostgresRuntime extends SqlRuntime` and `SqliteRuntime extends SqlRuntime` (thin target homes) exist; the `postgres()`/`postgres-serverless`/`sqlite()` factories construct their target classes; **`createRuntime` and the transitional `DefaultSqlRuntime` are deleted** (breaking change + upgrade declaration; tests migrate to a local test leaf / target factories). `SupabaseRuntime extends PostgresRuntime` exists; `supabase({ contractJson, url, jwtSecret | jwksUrl, pool?, middleware? })` returns a `SupabaseDb` exposing `asUser(jwt)` / `asAnon()` / `asServiceRole()`, each returning a role-bound `Db` whose executes issue `SET LOCAL role` / `request.jwt.claims` via the slice-2 primitive. Replaces the M1 runtime stub at `packages/3-extensions/supabase/src/exports/runtime.ts`.
   - **Builds on:** Slice 2's `executeWithSessionBootstrap` primitive.
   - **Hands to:** A working `supabase()` façade + `RoleBoundDb` for slice 4 to exercise end-to-end against an RLS policy.
   - **Focus:** The role binding rides in the bootstrap closure each role-bound `Db` captures — no per-request runtime construction, no change to `RuntimeExecuteOptions`. `asUser` validates the JWT (signature, expiry) and throws a typed error before acquiring a connection; the factory is uniformly async and warms a single JWKS key when `jwksUrl` is set. `SupabaseDb` is intentionally not a `Db` (role must be picked first); `RoleBoundDb` adds `transaction()` (one bootstrap at transaction open, per open question 3). Package-level unit/integration tests (PGlite) cover role binding and the implicit-transaction wrapping. **INVEST note:** this slice grew with the createRuntime deletion (operator decision 2026-06-10) and now likely splits at slice-planning time into **3a — construction moves to the target layer** (`PostgresRuntime` + `SqliteRuntime`, factories construct them, `createRuntime`/`DefaultSqlRuntime` deleted, callers + ~15 test files migrated, upgrade declaration) and **3b — the Supabase consumer** (`SupabaseRuntime` + façade + JWT + `RoleBoundDb`). Each is one coherent reviewable outcome; 3a hands 3b the constructible `PostgresRuntime`.

4. **Slice `rls-acceptance-and-docs`** — Linear: [TML-2881](https://linear.app/prisma-company/issue/TML-2881)
   - **Outcome:** The `examples/supabase` walking skeleton asserts, through the ORM, that with a raw-SQL RLS policy on `public.profile`: `asUser(jwt)` returns only the JWT-owner's rows, `asServiceRole()` sees all, and a registered user middleware never observes the `SET LOCAL` traffic. The ADR is revised to the as-built `executeWithSessionBootstrap` mechanism, and the runtime + middleware subsystem doc reflects the new seam and hierarchy.
   - **Builds on:** Slice 3's `supabase()` façade.
   - **Hands to:** Project close-out (the headline proof is green; durable docs staged for promotion).
   - **Focus:** The acceptance proof is the project's point. Raw-SQL policy setup (role + `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` keyed on `request.jwt.claims->>'sub'`) extends `bootstrapSupabaseShim` / the test fixture — **no** `.rls([...])`, no `PostgresRole` IR, no `postgres-rls` dependency. Hermetic on PGlite; test JWTs signed with a local secret. Leaves the skeleton's existing external-contract + FK-cascade assertions intact and only adds to them. ADR promotion to `docs/architecture docs/adrs/` happens at close-out (drive-close-project), not in this slice.

## Dependencies (external)

- [x] `examples/supabase` walking skeleton + `bootstrapSupabaseShim` — landed (extension-supabase M1).
- [x] `cross-contract-refs` (TML-2500) — landed; the skeleton's `supabase:auth.AuthUser` FK resolves.
- [x] SQL runtime execution stack (`RuntimeCore`, `SqlRuntimeImpl`/`createRuntime`, raw `SqlConnection`/`SqlTransaction` driver contract) — present.
- [ ] `postgres-rls` (TML-2501) — **deliberately NOT a dependency.** Independent; swaps its authored policy onto this substrate later.
- [x] Linear: dedicated [Runtime Target Layer](https://linear.app/prisma-company/project/runtime-target-layer-53c6310a9bd4) project created (mirrors postgres-rls having its own project); anchor TML-2502 moved in, its stale `blockedBy` TML-2501 removed (independence); 4 slice issues TML-2878–2881 created and blocking-chained.

## Sequencing rationale

The stack is forced by the spec's transitional-shape constraints and the dependency chain, not by reviewer pacing:

- **Slice 1 first, alone** — the spec mandates the rename land as a no-behaviour-change step so a hot-path regression is attributable to it and not to the new primitive.
- **Slice 2 before 3** — `SupabaseRuntime` cannot issue `SET LOCAL` below middleware without the primitive; the primitive is also where lifecycle correctness is proven in isolation, before a consumer depends on it.
- **Slice 3 before 4** — the acceptance demo exercises the real `supabase()` façade through the ORM; it can't run until the façade exists.
- **No parallel group** — every slice consumes the prior's surface, and slice 4's ADR/doc revision depends on the as-built mechanism (slices 2–3) being settled, so it can't usefully start earlier.
