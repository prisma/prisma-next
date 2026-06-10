# runtime-target-layer

## Purpose

Make role-scoped session state (Postgres `SET LOCAL role` / `request.jwt.claims`) a **structural** property of query execution rather than a convention a user can forget or a middleware can undo. The runtime must be able to set session state on the exact connection a query runs on, below the user middleware chain, so that Row-Level-Security enforcement is correct by architecture. Without this, the Supabase integration — and every future Postgres extension that depends on per-request session identity — has no safe place to stand.

## At a glance

Today the SQL runtime executes user middleware as a chain wrapping the driver call. Connection acquisition happens *inside* the runtime, below that chain, and nothing exposes the raw connection. So there is no way to issue `SET LOCAL` on the same connection a query then uses, below middleware — which is exactly what RLS needs.

```
RuntimeCore.execute(plan)
  └─ runWithMiddleware( user middleware chain )      ← user code runs here
       └─ runDriver(exec)                            ← SqlRuntimeImpl.executeAgainstQueryable(plan, queryable)
            └─ raw SqlConnection / SqlTransaction     ← .query("SET LOCAL …") here is BELOW middleware
```

This project adds one primitive at the family layer and builds the Supabase consumer on top of it:

```ts
// Family layer (SqlRuntime), protected — the substrate this project ships:
protected executeWithSessionBootstrap<Row>(
  plan,
  bootstrap: (conn: RawSessionConnection) => Promise<void>,  // runs below middleware, on the query's connection
  options?,
): AsyncIterableResult<Row>
// opens an implicit transaction, runs `bootstrap` on its raw connection,
// then runs the typed query against that same (sticky) connection, commit/rollback/release correctly.

// Consumer (this project subsumes it): a real role-bound Db
const db = await supabase({ contractJson, url, jwtSecret });
const rows = await db.asUser(jwt).sql.from('profile').select(...).build().execute();
//                    └─ captures bootstrap = conn => { SET LOCAL role='authenticated'; SET LOCAL request.jwt.claims=… }
//                       and an RLS policy on public.profile lets the user see only their own rows.
```

The proof is end-to-end through the ORM, in the existing `examples/supabase` walking skeleton, against a **raw-SQL** RLS policy — so it stands entirely on its own, ahead of the policy-authoring work in `postgres-rls`.

## Non-goals

- **Authoring RLS from PSL / the contract.** `.rls([...])` grammar, `PostgresRole` IR, policy DDL emission, the `auth.role()`/`auth.uid()` helpers — all owned by `postgres-rls` (TML-2501). This project proves the runtime against a hand-written raw-SQL policy and never touches the authoring surface.
- **Postgres-specific runtime behaviour.** `COPY`, `LISTEN`/`NOTIFY`, prepared-statement caching, connection bootstrap defaults. `PostgresRuntime` is a near-empty target home; filling it is future work.
- **Mongo target-layer parity.** The same gap exists in the Mongo family; out of scope. The pattern established here is the template.
- **Middleware seam redesign.** The user middleware chain stays the public extension point for query interception. The new primitive is `protected`, reserved for subclasses — not a generalised below-middleware hook for arbitrary user middleware.
- **The non-runtime half of `extension-supabase`.** The contract / `/pack` / typed handles / example polish stay with `extension-supabase` (TML-2503). This project subsumes only its runtime half — `SupabaseRuntime` + the `supabase()` façade.
- **JWKS production hardening.** Key rotation, multi-key caches, network retry policy. The façade validates JWTs and warms a single JWKS key; CI signs test JWTs with a local secret. Hardening is follow-up.

## Place in the larger world

**Umbrella.** Constituent of `supabase-integration` (decision **C12** — three-layer runtime hierarchy; **C13/C14** — walking-skeleton delivery). The umbrella's `examples/supabase` is the shared surface every constituent extends in place; this project's contribution is automatic role-binding e2e, which C13/C14 reserve for "runtime-target-layer + extension-supabase".

**Depends on (already landed):**
- The SQL runtime execution stack: `RuntimeCore` (`framework-components`), `SqlRuntimeImpl` + `createRuntime` (`packages/2-sql/5-runtime`), the raw driver contract `SqlConnection`/`SqlTransaction`/`SqlDriver` (`packages/2-sql/4-lanes/relational-core/.../driver-types.ts`).
- The `examples/supabase` walking skeleton (`Profile` model + cross-contract FK to `auth.AuthUser`), and `bootstrapSupabaseShim` (PGlite seeds the `auth.*` schema).
- `cross-contract-refs` (TML-2500) — the skeleton's `supabase:auth.AuthUser` reference already resolves.

**Deliberately independent of:** `postgres-rls` (TML-2501). RLS is a raw Postgres feature; the proof uses raw-SQL policy setup. `postgres-rls` later swaps its authored policy onto the same proven substrate without changing the runtime.

**Consumed by:** `extension-supabase` (TML-2503) builds its contract/pack/handles on the `SupabaseRuntime` + `supabase()` façade this project ships.

**Adapter impact.** Postgres only. The new family-layer primitive is target-agnostic (it sits on `SqlRuntime` / `RuntimeCore`); SQLite and Mongo are untouched. `PostgresRuntime` and `SupabaseRuntime` are the only target/extension-specific additions.

**ADR.** This is an architectural shift (a new runtime extension seam + the target-layer class). A draft exists at `specs/adr-runtime-target-layer.md`; it must be revised to match the as-built mechanism (the `executeWithSessionBootstrap` primitive, not the original `withRawConnection`/`withTransaction` pair) and promoted to `docs/architecture docs/adrs/` at close-out.

## Cross-cutting requirements

- **Below-middleware guarantee holds for every role-bound execute.** No execution path on a role-bound `Db` issues a query without the session bootstrap having run first on that query's connection, and user middleware never observes the bootstrap SQL. This is the security-relevant invariant; it must be true of single-statement executes and multi-statement transactions alike.
- **Sticky connection.** The bootstrap SQL and the subsequent typed query run on the *same* physical connection, inside the same transaction, for the binding's lifetime. `SET LOCAL` is meaningless otherwise.
- **Connection-lifecycle correctness is owned by the substrate, not the consumer.** Release-vs-destroy, rollback-on-throw, destroy-on-failed-rollback are handled by the family-layer primitive. A consumer supplies only a bootstrap closure; it cannot get the lifecycle wrong.
- **No framework-options pollution.** The role/claims binding does not appear on the cross-family `RuntimeExecuteOptions` type. It rides in the bootstrap closure (a SQL-layer parameter), keeping the session/role concept out of `framework-components`.
- **Hot path unchanged.** A plain `createRuntime(...)` execute that never calls the new primitive incurs no new cost. The primitive is additive.
- **`createRuntime` is deleted; construction moves to the target layer** (operator decision, 2026-06-10). The family core exposes only the abstract `SqlRuntime` seam — there is no family-level construction path and no "default" runtime. Target factories (`postgres()`, `sqlite()`) construct their own target runtime classes and keep returning interfaces/facades, so apps not using role binding are unaffected at the factory surface. The removal is a breaking API change and carries an upgrade declaration. (Until slice 3 lands, `createRuntime` + a package-private `DefaultSqlRuntime` leaf exist as a transitional shape.)
- **The skeleton stays green throughout.** `examples/supabase` is a continuous CI surface; every slice leaves its existing assertions passing and only adds to them.

## Transitional-shape constraints

- **The `SqlRuntimeImpl` → `SqlRuntime` rename + export is a no-behaviour-change step landed on its own**, isolating any hot-path regression from the new functionality. No backward-compat alias for `SqlRuntimeImpl` (per the repo's no-backwards-compat rule); downstream imports move in the same slice.
- **Every slice keeps CI green on `main`.** No slice leaves the workspace un-typecheckable or the skeleton red.
- **The `supabase()` façade replaces the M1 runtime stub** (`packages/3-extensions/supabase/src/exports/runtime.ts`) without breaking the skeleton's existing external-contract migrate/verify + FK-cascade assertions.

## Project Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md)) — not restated. Project-specific conditions:

- [ ] `SqlRuntime` is exported from its package under a stable public symbol; `SqlRuntimeImpl` no longer appears in the public surface; all workspace consumers import `SqlRuntime`.
- [ ] The family-layer session-bootstrap primitive exists, is `protected`, opens an implicit transaction, runs the bootstrap on the raw connection below middleware, runs the typed query on that same sticky connection, and releases/destroys correctly on success and on throw. Unit-tested for: connection identity across bootstrap + query, release on resolve, destroy/rollback on throw, and bootstrap SQL invisible to user middleware.
- [ ] `PostgresRuntime extends SqlRuntime` and `SqliteRuntime extends SqlRuntime` exist as thin target homes; `SupabaseRuntime extends PostgresRuntime` exists; the RLS seam works without depending on `PostgresRuntime` carrying any behaviour.
- [ ] `createRuntime` and the transitional `DefaultSqlRuntime` leaf are deleted; every runtime is constructed by a target factory as its target class; the removal carries an upgrade declaration.
- [ ] `supabase({ contractJson, url, jwtSecret | jwksUrl, pool?, middleware? })` returns a `SupabaseDb` exposing exactly `asUser(jwt)` / `asAnon()` / `asServiceRole()`; `SupabaseDb` is not a `Db` (role must be picked first); the returned `RoleBoundDb` is a `Db` plus a `transaction()` that issues one bootstrap at transaction open. `asUser` validates the JWT (signature, expiry) and throws a typed error before any connection is acquired.
- [ ] **Acceptance demo (the project's point):** `examples/supabase` asserts, through the ORM, that with a raw-SQL RLS policy on `public.profile`: a query via `asUser(jwt)` returns only the JWT-owner's rows; `asServiceRole()` sees all rows; and a registered user middleware never observes the `SET LOCAL` traffic. Runs hermetically on PGlite + `bootstrapSupabaseShim` (test JWTs signed with a local secret); no real Supabase, no `postgres-rls`.
- [ ] `pnpm lint:deps` passes: the primitive lives at the framework/family layer, `PostgresRuntime`/`SupabaseRuntime` at their target/extension layers; no new layering violations.
- [ ] The runtime ADR is revised to the as-built mechanism and promoted to `docs/architecture docs/adrs/`; the runtime + middleware subsystem doc reflects the new seam and hierarchy.

## Open Questions

1. **Does the family-layer primitive belong on `SqlRuntime` or on `RuntimeCore`?** Working position: `SqlRuntime` (family), because connection acquisition, `connection()`/`wrapTransaction`, and `executeAgainstQueryable` already live there; `RuntimeCore` has no connection concept. The Mongo equivalent, when it comes, adds its own primitive at the Mongo family layer. Confirm during the first implementation slice by inspection.
2. **Exact bootstrap connection surface.** The closure needs to issue raw SQL on the transaction's connection. Working position: pass a narrow `RawSessionConnection` exposing only `query(sql, params)` (a slice of the existing `SqlQueryable`), not the full `SqlConnection`/`SqlTransaction` — minimal surface, no lifecycle methods leaked to the consumer. Name and exact shape are the implementer's call within that constraint.
3. **Multi-statement `RoleBoundDb.transaction()` semantics.** Working position: one bootstrap issued at transaction open; the closure body runs against the pinned connection; commit/rollback at closure exit — reusing the same primitive. Confirm it composes with the existing public `transaction()`/`withTransaction` path without double-opening a transaction.

## References

- Linear: [TML-2502](https://linear.app/prisma-company/issue/TML-2502)
- Umbrella: [`supabase-integration`](../supabase-integration/README.md); decisions [`C12`](../supabase-integration/decisions.md) (three-layer runtime hierarchy), C13/C14 (walking skeleton).
- Sibling / dependent projects: [`postgres-rls`](../postgres-rls/spec.md) (independent; swaps authored policy onto this substrate), [`extension-supabase`](../extension-supabase/spec.md) (consumes the façade), [`cross-contract-refs`](../cross-contract-refs/spec.md) (landed).
- ADR draft: [`specs/adr-runtime-target-layer.md`](specs/adr-runtime-target-layer.md) — revise to as-built mechanism, promote at close-out.
- [ADR 005 — Thin core, fat targets](../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md); [`no-target-branches.mdc`](../../.agents/rules/no-target-branches.mdc).
- Key code surfaces: `packages/1-framework/1-core/framework-components/src/execution/runtime-core.ts`, `packages/2-sql/5-runtime/src/sql-runtime.ts`, `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`, `examples/supabase/`, `packages/3-extensions/supabase/src/exports/runtime.ts`.
