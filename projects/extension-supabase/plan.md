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
- RLS policies now author in `contract.prisma` and apply via `dbInit` (Slice B). The role literals are no longer hardcoded: Slice C moved the role vocabulary to the pack contract.

### ✅ Runtime facade — done (ADR 230)

`SupabaseRuntimeImpl`, the async `supabase<TContract>()` factory, `asUser` (async) / `asAnon()` / `asServiceRole()`, `SupabaseDb`/`RoleBoundDb`, JWT validation (`InvalidJwtError`), and session-coupled connection role binding (`set_config(role/claims)` + `RESET ALL` on release). See [ADR 230](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md).

### Slice B — RLS through the framework authoring surface ✅ done

**Gate:** postgres-rls #771 (SELECT policy) + the UPDATE-own vertical landed.

**Goal:** swap `examples/supabase`'s `applyRlsFixture` raw SQL onto the framework authoring surface. The `Profile` model's RLS policies are declared via `.rls(...)` in TS or `policy_select`/`policy_update` blocks in PSL, emitted through the framework, applied by `dbInit` — no hand-authored `CREATE POLICY` in the test fixture.

**DoD tasks:**
- [x] Express the `profile_owner_select` policy and the `profile_owner_update`-own-with-check policy through the framework authoring surface (TS `.rls(...)` or PSL `policy` blocks).
- [x] Remove `applyRlsFixture`'s hand-authored `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` SQL. The framework migration handles it.
- [x] Keep the RLS enforcement integration tests green.

**Note:** B and C may merge into one postgres-rls-integration slice if the `PostgresRole` IR and the `.rls(...)` authoring surface land together — check when postgres-rls closes out.

**As-built:** policies author in `examples/supabase/src/contract.prisma` (PSL `policy_select`/`policy_update` blocks) and apply via `dbInit`; the test fixture retains only grants (`applyGrantsFixture`) — no hand-authored `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` remains under `examples/supabase/`.

### Slice C — Roles first-class ✅

**Gate:** postgres-rls's `PostgresRole` IR merged.

**Goal:** replace the hardcoded role literals in `SupabaseRoleBinding` (`'anon'|'authenticated'|'service_role'` with `TODO(TML-2501)`) with postgres-rls's `PostgresRole` IR. Declare Supabase's standard roles in the shipped contract (`anon`, `authenticated`, `service_role` as `control: 'external'`). The verifier confirms their existence via `pg_roles` introspection.

**As built:** PSL gained a standalone `role` block for this slice, authored inside the explicit unbound namespace: the pack's `contract.prisma` declares `namespace unbound { role anon {} role authenticated {} role service_role {} }`, and the blocks lower into the contract's `__unbound__` storage slot like blocks in any namespace. The unbound namespace's purpose is late binding (search_path-resolved tables); roles are declared there because they are cluster-scoped and belong to no schema. To make this authorable the "no `namespace unbound { }` alongside named namespaces" restriction was narrowed to models (a blocks-only unbound namespace is legal next to named namespaces; one containing models stays rejected). The postgres role lowering rejects a `role` block anywhere else — a named namespace or the document top level — with `PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE`, and stamps the `__unbound__` coordinate on every entity. The diff-tree projection was fixed alongside: roles hoist to the database root from whichever slot carries them, and a roles-only unbound slot no longer materializes a physical `public` namespace node (nor clobbers a bound `public` namespace's node). The runtime derives `SupabaseRoleBinding['role']` from the `SupabaseRole` Prisma Next enum handle (`src/contract/roles.ts`); a type test pins the public union unchanged. Verify reports a missing role as a `not-found` schema issue naming it (framework's shape, not a `missing_role` code). An earlier approach that injected the entities via a `createNamespace` wrapper in `prisma-next.config.ts` was rejected in review — the emitted contract must not carry entities the PSL source doesn't declare.

**DoD tasks:**
- [x] Add role declarations to the shipped contract (PSL or contract.json).
- [x] Replace the hardcoded role literal union in `SupabaseRoleBinding.role` with the `PostgresRole` IR type.
- [x] Verifier integration test: pointing the runtime at a vanilla Postgres DB (no Supabase setup) raises `missing_role` for `anon`/`authenticated`/`service_role`.
- [x] Keep the RLS enforcement integration tests green.

**Non-blocking follow-on:** enum-typed `auth.*` columns (enums-as-domain-concept project) can attach to this slice or land later.

### Slice D — `service_role` queries Supabase-internal namespaces via a secondary `db.supabase` root ✅ merged (#845)

**Gate:** none — facade composition, independent of postgres-rls #771. (Reframed from "explicit `auth.users` query off the app db": that doesn't work and isn't meant to — cross-space *querying* off the app db was deliberately not built, and only `service_role` has `auth.*` grants. See decision [C15](../supabase-integration/decisions.md). Slice contract: [`slices/d-service-role-internal-namespaces/spec.md`](slices/d-service-role-internal-namespaces/spec.md).)

**Goal:** `db.asServiceRole().supabase.sql.auth.users` / `.orm.auth.AuthUser` (and `storage.*`) is queryable via a **secondary `db.supabase` root** — the extension contract's own intact `ExecutionContext` + a second runtime sharing the app driver/pool + `service_role` session (marker-verify off), **not a contract merge**. `asServiceRole().sql`/`.orm` stay app-contract-only; `asUser`/`asAnon` have no `.supabase`.

**DoD tasks:**
- [ ] `db.asServiceRole().supabase.{sql,orm}` expose `auth`/`storage` (extension contract); `asServiceRole().sql`/`.orm` stay app-only; `asUser`/`asAnon` have no `.supabase`.
- [ ] Integration test: `asServiceRole().supabase.sql.auth.users` + `.orm.auth.AuthUser` read a seeded row, emitted SQL targets `"auth"."users"`, and `current_setting('role')` is `service_role`.
- [ ] Type-level test (against the app contract): `asServiceRole().supabase.{sql,orm}` carry `auth`/`storage`; the primary `asServiceRole().sql` does not; `asAnon()`/`asUser()` have no `.supabase`.
- [ ] `overview.md` + decision [C15](../supabase-integration/decisions.md) reflect the secondary-root surface (done in this slice).

### Slice F — Complete, faithful Supabase contract ✅

**Gate:** native enums (in flight). Supabase's `auth` schema uses native Postgres enum types (`aal_level`, `factor_type`, `factor_status`, `code_challenge_method`, `one_time_token_type`) with enum-typed columns; the shipped contract can't faithfully represent those tables until native-enum support lands.

**Goal:** the extension ships a **complete, faithful** contract of everything it owns — all `auth`/`storage` (and any other owned) tables, the native enum types, and roles — not the 4-table minimum. This is the source of truth for *what the extension owns*, consumed by (a) `db verify` against a real Supabase DB, (b) the `db.supabase` admin surface, and (c) Slice G's infer-subtraction. Per decision [C8](../supabase-integration/decisions.md), generate it by **introspecting a reference Supabase project** and emitting `contract.json` (hand-authoring ~25 tables + enums is toil and drift-prone).

**As built:** the contract (23 `auth` + 10 `storage` tables, 10 native enums, 3 roles) is generated by `pnpm contract:generate` in the pack — restore the checked-in complete reference fixture (`test/fixtures/supabase-reference/`, pg_dump of ALL schemas from supabase/postgres:17.6.1.106, version-pinned) into fresh PGlite, introspect `auth`+`storage` per schema, assemble named PSL namespace blocks, emit; byte-idempotent. "Owned" = `auth`+`storage` only (deferred.md records the rest). Verify runs against the restored fixture in CI (`reference-fixture-verify.integration.test.ts`: clean positive with `realtime`/`vault` present, negative names a dropped table); a live cloud project stays the manual acceptance lane. Fidelity boundary (4 omitted columns — `inet`, nullable `text[]`; 8 omitted defaults; 2 `USING hash` + 8 partial-unique indexes undeclared) in `src/contract/CONTRACT-FIDELITY.md`. Fallout fixed in the framework: PSL `@relation(..., index: false)` + inferrer emission for unbacked FKs (shared backing predicate with verify), array-column `nativeType` round-trip, expression-index introspection, `default.value: false` canonicalization. `bootstrapSupabaseShim` now restores the fixture. Brownfield infer + `db.supabase`/`auth.refresh_tokens` surface tests included.

**DoD tasks:**
- [x] Introspect a reference Supabase project; emit the full `contract.json` (all owned tables + native enum types + roles), `defaultControl: 'external'`.
- [x] `db verify` against a real Supabase DB passes (declared shapes match; extras tolerated under `external`) — CI form: verify against the restored reference fixture.
- [x] The `db.supabase` admin surface exposes the full owned table set.
- [x] Round-trip property holds: introspect → emit → re-introspect → diff empty (`contract:generate` idempotence + clean verify).

**Shaping needed at pickup:** the introspection→emit pipeline for extension contracts, and how far "owned" extends (`auth`/`storage` certainly; `realtime`/`extensions`/`vault`/`pgsodium`?). *(Resolved: `auth`+`storage`; see deferred.md.)*

### Slice G — Extension-aware `contract infer` in a Supabase environment

**Gate:** none for the mechanism (TML-2962, in progress) — it subtracts whatever the stack packs' contract spaces declare *today*; it does not need Slice F's complete contract to exist. The Supabase-environment acceptance below deepens automatically once F ships (the pack then declares more, so infer omits more).

**Goal:** running `contract infer` with the Supabase pack in the stack writes a **meaningful `contract.prisma` that omits every element the stack's extension packs already describe** — the app author gets only their own schema (`managed`); the pack supplies `auth`/`storage`/… (`external`) via `extensionPacks`. Design (shaped, see the slice spec: [`slices/g-extension-aware-infer/spec.md`](slices/g-extension-aware-infer/spec.md)): the inferrer matches introspected tree elements against the pack contract spaces by **entity coordinate** (`elementCoordinates` from `@prisma-next/framework-components/ir` — `(namespaceId, entityKind, entityName)`), and omits any the packs declare. infer = introspected schema − what the packs describe. The match is entity-agnostic (tables today, enums/roles/policies for free as they enter the tree) and coordinate-precise (a pack's `auth.users` cannot suppress an app's `public.users`). **Kept minimal deliberately** — no new aggregate type is minted; the coordinate query runs inline over the packs' contract spaces the family already holds.

**Follow-on (separate ticket, [TML-2977](https://linear.app/prisma-company/issue/TML-2977)):** the ownership query has no named home yet. The principled end-state extracts a framework-level `ContractSpaceAggregate` base (pure aggregation of contract spaces + coordinate-precise ownership) that today's migration-state `ContractSpaceAggregate` extends as `MigrationSpaceAggregate`. Slice G's inline `elementCoordinates` call then collapses to a one-line delegation, and re-infer (aggregate gains the app's own space → reconcile via the schema diff instead of subtracting) rides the same base. Not gating G.

**DoD tasks:**
- [ ] Mechanism vertical (TML-2962): the inferrer omits pack-declared elements by entity coordinate, namespace-correct by construction, with tests per the slice spec.
- [ ] `contract infer --db <supabase-url>` with `extensionPacks: [supabasePack]` writes a `contract.prisma` containing only the app's own (un-owned) schema — no `auth`/`storage`/pack-owned tables, enum types, or roles. (Completes fully once Slice F's complete contract lands.)
- [ ] The inferred contract + the pack compose to the full picture and `db verify` passes clean.
- [ ] Integration test proving the omission against a shim/real Supabase DB.

### Follow-ups surfaced by this project (deferred)

Two changes this project surfaced but deliberately did not fold into its delivery slices. Both are their own work; recorded here so they are not lost.

**FK1 — Foreign keys and indexes are discrete contract entities (supersedes [ADR 161](../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md)).** The `ForeignKey` IR carries `constraint` and `index` booleans that drive DDL emission — instructions, not facts, which sits against the contract's *facts-not-instructions* principle (Data Contract subsystem design principle #4; ADR 177/173). ADR 161 deliberately chose those booleans as "structural, self-contained" fields, for real use cases (PlanetScale omits FK constraints; perf workloads skip a specific FK's index; Postgres does not auto-index FKs) — so this is a **reversal of a considered ADR, not the continuation of an unbroken principle**, and the spec must engage ADR 161 head-on. The new argument ADR 161 did not foresee: Slice F's introspection/verify reconciliation (`contract-to-schema-ir`'s `satisfiedIndexColumns` synthesis loop) means `index: true` is now *interpreted against* the `indexes[]` array — for a FK already covered by an explicit index, index-ness is double-encoded and resolvable only by that rule, breaking the self-contained property ADR 161 promised.
  - **Goal:** emit *materializes* the sugar into discrete entities. The storage FK entity is the referential constraint only; every index (including one backing a FK) is a discrete `indexes[]` entry. The `constraint`/`index` booleans stay only as *authoring input* (`@relation(index: false)`, `belongsTo` options), never in `contract.json`. ADR 161's use cases survive as presence/absence: skip a FK index → no index entity; logical-relation-without-physical-constraint (PlanetScale) → domain relation present, storage FK entity absent (cleaner than `constraint: false`, since the relation/constraint split already models exactly that).
  - **Scope note:** frame this narrowly on *facts-not-instructions* + the reconciliation regression — NOT as "the contract is unambiguous / needs no interpretation." It is not: control policy (ADR 224) is a stronger interpret-me field (a node marked `control: 'managed'` resolves to `external` under an external default), and ~10 such conventions exist. Chasing all of them is a doctrine-level program, out of scope here.
  - **Reach:** the `ForeignKey` IR shape, emit lowering, the now-unnecessary `contract-to-schema-ir` synthesis loop, the diff/verify projection, the inferrer (emits a discrete index entry rather than `index: false`), and a repo-wide `contract.json` re-emit. #960 ships the current IR; this slice re-emits over the materialized form. Behaviour today is correct — this is a representation change, not a bug fix.

**FK2 — `auth`/`storage` contract split for opt-in composition.** Split the pack contract so a user composes only the schema they reference. Genuine separate contracts means two contract *spaces*, which re-architects the merged Slice D `db.supabase` facade (built from one extension contract), changes the `supabase:auth.AuthUser` cross-space FK-reference syntax and the exported model-handle brand, and shifts Slice G's expected infer output — so it is its own slice, not a pre-merge tweak. Pick up when a user actually wants subset composition; `db verify` is already per-space-correct without it, and the default `contract infer` (public-scoped) never leaks pack schemas regardless.

### Slice E — Docs + real-Supabase acceptance + close-out ✅ docs + harness shipped

**Shaped:** [`slices/e-docs-acceptance-closeout/spec.md`](slices/e-docs-acceptance-closeout/spec.md) + [`plan.md`](slices/e-docs-acceptance-closeout/plan.md).

**Gate:** cleared — B/C/D/F/G all shipped; explicit-namespace-dsl feature landed (#778).

**Goal:** the package is launch-ready.

**DoD tasks:**
- [x] Polish the package README: role-binding model (ADR 230), JWT modes (secret vs JWKS), `db.supabase` admin root (C15), unsupported scope, post-launch deferrals. Superseded codex #913.
- [x] Author the missing `examples/supabase/README.md` (FR20/AC9).
- [x] Build the env-guarded real-Supabase acceptance harness (`examples/supabase/test/real-supabase.acceptance.test.ts`) — skipped-green in CI; four flows + ORM update-own.
- [ ] **Manual, post-merge (needs infra):** provision a real Supabase project; run the harness; capture evidence in the launch announcement. (Provisioning owner TBD.)
- [~] Update the extension-authoring skill (TML-2492) — **deferred**: no authoring skill exists in the tree yet (only the *upgrade* skill); the repoint rides with TML-2492's own delivery.
- [x] Mark umbrella `decisions.md` ✅ shipped with merged-PR links.
- [x] ADR-draft promotion pass — this project owns no un-promoted drafts (ADR 234 already promoted; `explicit-namespace-dsl`'s draft flagged to its own close-out).
- [~] Close-out dir deletion — **deferred to umbrella close-out**: the live umbrella densely references this dir; deletion rides with `projects/supabase-integration/` deletion per the umbrella README §Close-out.
- [ ] Optional stretch: `auth.uid()` as a column default via `DefaultFunctionRegistry` — deferred to v0.2.

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
