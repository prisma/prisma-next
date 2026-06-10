# runtime-target-layer

## Purpose

Make role-scoped session state (Postgres `SET LOCAL role` / `request.jwt.claims`) a **structural** property of query execution rather than a convention a user can forget or a middleware can undo. The runtime must be able to set session state on the exact connection a query runs on, below the user middleware chain, so that Row-Level-Security enforcement is correct by architecture. Without this, the Supabase integration — and every future Postgres extension that depends on per-request session identity — has no safe place to stand.

## At a glance

**Design v2 (operator review round, 2026-06-10).** The first cut shipped the below-middleware capability as a *verb* — `executeWithSessionBootstrap(plan, bootstrap)`, "run this query, but do some setup first." The review rejected that model, and the RLS bypass found in final review (the ORM acquired its own connection scope and slipped under the role binding) is the verb-model's failure mode made concrete: when the binding belongs to one call path, every other path is a bypass. The corrected model makes the binding a property of a **noun**:

> The base runtime's primitive is *"give me a connection-like object (a queryable) I can execute queries against."* The Supabase subclass uses it to provide **session-coupled connections**: it acquires a queryable, binds the role onto it once, and hands back a session. Every query that runs within that session — single executes, ORM mutation graphs, multi-statement transactions — inherits the binding, because there is no other path to the connection.

```text
RuntimeCore (framework, abstract)
   └── SqlRuntimeBase (family, abstract)             ← protected: acquire a raw queryable (below middleware,
        │                                               correct lifecycle) + run typed plans against a queryable
        ├── PostgresRuntimeImpl / SqliteRuntimeImpl  ← target concretions, constructed by their factories
        │      └── SupabaseRuntimeImpl               ← openRoleSession(binding): a queryable with
        │                                               role + request.jwt.claims session-bound
        interfaces: Runtime (family) / PostgresRuntime / SqliteRuntime / SupabaseRuntime (bare names)
```

```ts
const db = await supabase({ contract, url, jwtSecret });
const session = await db.asUser(jwt);          // verifies JWT, returns a RoleBoundDb
await session.orm.public.Profile.find(...);    // runs inside a role-coupled session — RLS enforced
```

The proof is unchanged and stays the project's acceptance bar: an RLS policy enforced on an ORM query through the walking skeleton (`examples/supabase`), with a raw-SQL policy, independent of `postgres-rls`.

## The runtime model (decided)

### Layered surfaces: interfaces are the dependency surface; `Base` marks needs-extension, `Impl` marks concretions

Consumers must depend on interfaces, never concretions (repo interface+factory rule; operator review). Class suffixes follow the repo conventions: **`Base` indicates a class that needs extension to be useful** (abstract); **`Impl` indicates a concrete implementation** (the existing convention, restored):

| Layer | Interface (what you depend on) | Class |
|---|---|---|
| Framework | `RuntimeExecutor` | `RuntimeCore` (abstract) |
| SQL family | `Runtime` (existing name, kept — see note) | `SqlRuntimeBase` (abstract) |
| Target | `PostgresRuntime`, `SqliteRuntime` | `PostgresRuntimeImpl`, `SqliteRuntimeImpl` (concrete) |
| Extension | `SupabaseRuntime` | `SupabaseRuntimeImpl extends PostgresRuntimeImpl` |

- **Interfaces carry the bare names** and are the only types app code and tests may depend on. Target interfaces start as empty extensions of the family interface — their value is the *named dependency surface*, so adding target surface later is non-breaking.
- **`Impl` classes are exported solely as extension seams** (a deliberate refinement of the classic package-private-Impl rule, which cannot hold when `SupabaseRuntimeImpl` in another package must extend `PostgresRuntimeImpl`). Depending on an `Impl` as a type remains forbidden; factories construct `Impl` and return the interface, so a concretion never flows to app code as a value.
- **Family interface name:** `Runtime` predates this scheme and stays (operator decision) — renaming it to `SqlRuntime` would touch every consumer of `@prisma-next/sql-runtime` for symmetry alone. Recorded as the scheme's one deliberate naming exception; it lives inside the SQL package, so ambiguity is low.

### The base primitive: provision a queryable, separately from executing against it

Provisioning and execution are separate concerns (operator review: "why a method which executes the query *as well as* provisions the queryable?"). `SqlRuntimeBase` exposes two protected seams:

1. **`acquireRawConnection(): Promise<SqlConnection>`** *(name indicative)* — hand the subclass the raw driver connection: already a `SqlQueryable` (so raw SQL issued on it is **below the middleware chain** — it never enters the codec/middleware/telemetry pipeline), already carrying the lifecycle surface (`release`/`destroy`/`beginTransaction`). **No new wrapper type**: the review correctly identified `RawSessionConnection` as a redundant narrowing of `SqlQueryable`; it is deleted.
2. **`executeAgainstQueryable(plan, queryable, options)` becomes protected** — the existing internal that runs a typed plan, middleware-wrapped, against a given queryable. Subclasses run plans against the connections they provisioned; they never re-implement the execute pipeline.

The previous protected verbs — `executeWithSessionBootstrap`, `executeTransactionWithBootstrap` — are **deleted**. Their disposal discipline (release-vs-destroy, destroy-on-failed-rollback, commit-failure envelopes, stream-guard semantics) is not lost: it moves into the session lifecycle below, and the existing unit tests are repointed at the session seam.

### The subclass model: session-coupled connections

`SupabaseRuntimeImpl` provides `openRoleSession(binding): Promise<RoleSession>` *(names indicative)*:

- **Bind once, at open:** acquire a raw connection; issue `SELECT set_config($1, $2, false)` for `role` and `request.jwt.claims` (parameterized — `SET role = $1` is invalid Postgres, and string-built SQL would be injectable). `is_local = false`: the GUCs are **session-scoped on that physical connection**, which is what makes the object a session rather than a transaction.
- **Everything within the session is bound:** the session exposes the queryable surface (typed executes via the protected execute-against-queryable seam, raw access for the subclass, `transaction(fn)` as a plain transaction on the bound connection — no bespoke role-transaction machinery). The role-bound `Db` facade exposes no unbound connection-bearing method; the guarantee is facade-encapsulation: `SupabaseRuntimeImpl` inherits public `connection()`/`execute()` from the base, but the facade never surfaces them.
- **Reset on release, destroy on failure:** the session's `release()` issues `RESET ALL` before returning the connection to the pool; if the reset fails, the connection is **destroyed**, never pooled. This is the pool-poisoning discipline, owned by the session lifecycle — not by callers, not by convention.
- **Session scope is per-operation** at the façade: `RoleBoundDb` opens a session per execute / per ORM operation (via the ORM's existing `acquireRuntimeScope` acquire-release bracketing — the shim's `connection()` returns the role session, restoring the principled version of what the bypass fix removed) / per explicit `.transaction()` block. No connection or transaction is held across app logic.

### Why this dissolves the bypass class

The final-review RLS bypass (ORM mutations/includes running unbound) was patched by *removing* `connection()` from the ORM shim — a band-aid. Under the session model the shim's `connection()` *returns the role session*, so the ORM's own connection-scoping machinery becomes the enforcement mechanism instead of the hole. Binding-by-construction replaces binding-by-call-site.

## Cross-cutting requirements

- **Below-middleware guarantee, restated for the session model:** session state is bound on the raw connection before any query runs on it, below the user middleware chain; user middleware never observes the binding SQL; every query path that executes within a session inherits the binding. No execution path on a role-bound surface reaches a connection that bypasses this.
- **Lifecycle correctness owned by the substrate:** acquire/bind/reset/release/destroy live in the base + session implementation. Consumers cannot leak a bound connection into the pool; a failed `RESET ALL` evicts the connection.
- **No framework-options pollution:** role/claims never appear on `RuntimeExecuteOptions` or any cross-family type; they ride in the binding captured by the session/`RoleBoundDb`.
- **Interface coupling:** app code and tests depend on the bare-name interfaces; `Base` classes are referenced only in `extends` clauses and factory internals.
- **Construction stays at the target layer:** no family-level factory (`createRuntime` remains deleted); factories construct their target `Base` class and return interfaces/facades.
- **Test strategy — no self-mocks:** tests must not mock our own constructors or modules (operator review). Facade and runtime tests use a **recording fake `SqlDriver`** against real runtime objects (the pattern proven in `session-bootstrap.test.ts`). The constructor-mock suites in the postgres/sqlite/supabase extensions are rewritten on this pattern.
- **Examples and tests consume the application surface:** examples use the target façades (`postgres()`, `sqlite()`, `supabase()`), not direct `new *RuntimeImpl(...)`; example tests use the example app's own `db`, not a privately fabricated runtime. The `examples/supabase` app itself adopts `supabase()` as its db (the walking-skeleton contract), with the control-plane flow keeping whatever client it needs.
- **Build-derived metadata:** the Supabase runtime descriptor's `version` is derived from `package.json` at build time, not hardcoded.
- **Role names:** the `'anon' | 'authenticated' | 'service_role'` literals remain hardcoded **with a `TODO(TML-2501)`** at the definition site; they migrate to the Supabase extension's contract (roles as first-class IR) when `postgres-rls` lands. Agreed in review.
- **Hot path unchanged**; **the skeleton stays green throughout**; **upgrade declarations** track every public-surface change (the renames to `SqlRuntimeBase`/`*RuntimeImpl` and the deletion of the v1 verbs extend the existing 0.13→0.14 declarations).

## Non-goals

Unchanged from v1: RLS authoring (`postgres-rls` owns `.rls([...])`, `PostgresRole` IR, policy DDL); Postgres-specific runtime behaviour (COPY, LISTEN/NOTIFY); Mongo parity; middleware seam redesign; the non-runtime half of `extension-supabase`; JWKS production hardening.

## Place in the larger world

Unchanged from v1 (umbrella C12/C13/C14; depends on the landed execution stack and walking skeleton; deliberately independent of `postgres-rls`; consumed by `extension-supabase`). The ADR draft at [`specs/adr-runtime-target-layer.md`](specs/adr-runtime-target-layer.md) carries the durable decision record for the v2 model and is promoted at close-out.

## Transitional-shape constraints

Single consolidated PR (#792). Within it: every build stage leaves the workspace gates green; the v1 verb primitives may exist transiently in branch history but do not survive to the merged PR.

## Project Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md)). Project-specific:

- [ ] The layered interface/class scheme ships as specified: bare-name interfaces (`PostgresRuntime`, `SqliteRuntime`, `SupabaseRuntime`, and the family interface), `Base` classes as the only concretions, factories returning interfaces. No `createRuntime`; no family-level concretion; no `RawSessionConnection`.
- [ ] `SqlRuntimeBase` exposes the provision-a-queryable seam (raw connection, below middleware, full lifecycle) separately from execute-against-queryable; the v1 verb primitives are gone. Lifecycle unit tests (stickiness, release-on-drain, destroy-on-failure, reset-on-release, pool-poisoning eviction) pass against the session seam.
- [ ] `SupabaseRuntimeImpl.openRoleSession` provides session-coupled connections; `RoleBoundDb` routes **all** paths (execute, ORM scope via `connection()`, transactions) through the session; a test proves ORM mutations and includes are role-bound.
- [ ] No test mocks our own constructors/modules; extension facade tests run real objects over a recording fake driver.
- [ ] Examples consume façades; example tests consume the example app's `db`; the `examples/supabase` app's `db` is built on `supabase()`.
- [ ] **Acceptance (unchanged, the project's point):** `examples/supabase` asserts through the ORM, against a raw-SQL RLS policy: `asUser(jwt)` sees only the owner's rows (reads and writes), `asAnon()` sees none, `asServiceRole()` sees all, and user middleware never observes the binding SQL. Hermetic; no real Supabase; no `postgres-rls`.
- [ ] Descriptor version build-derived; role-name `TODO(TML-2501)` in place; upgrade declarations current; ADR revised to this design and promoted at close-out; subsystem doc matches.

## Open Questions

1. **Session GUC mechanics.** Working position: bind with `set_config(..., is_local = false)` at session open + mandatory `RESET ALL` on release (destroy on reset failure). Rejected alternative — transaction-local `SET LOCAL` per operation — is recorded in the ADR (it forces a transaction around every statement and is what produced the v1 verb API).
2. **Exact seam names.** `acquireRawConnection` / `openRoleSession` / `RoleSession` are indicative; implementer may improve within the model (provision ≠ execute; bare-name interfaces; session noun).

## References

- Operator review round: [PR #792 review, 2026-06-10](https://github.com/prisma/prisma-next/pull/792) — the 14 inline comments this design answers.
- Linear: [TML-2502](https://linear.app/prisma-company/issue/TML-2502); slices TML-2878/2879/2880/2881 (all ship in #792).
- ADR draft: [`specs/adr-runtime-target-layer.md`](specs/adr-runtime-target-layer.md).
- Key code surfaces: `packages/2-sql/5-runtime/src/sql-runtime.ts`, `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts` (`SqlConnection`/`SqlQueryable`), `packages/3-extensions/sql-orm-client/src/collection-runtime.ts` (`acquireRuntimeScope`), `packages/3-extensions/{postgres,sqlite,supabase}`, `examples/supabase/`.
- Superseded v1 mechanism (`executeWithSessionBootstrap` / `executeTransactionWithBootstrap` / `RawSessionConnection`): branch history of #792; rationale for rejection in the ADR's alternatives.
