# ADR — Runtime target layer: session-coupled connections over an abstract family seam

**Status:** Draft (workspace ADR; promoted to `docs/architecture docs/adrs/` at project close-out). Supersedes two earlier drafts of itself: the original `withRawConnection`/`withTransaction` sketch and the v1 as-built `executeWithSessionBootstrap` design, both rejected in operator review (PR #792, 2026-06-10).

**Related:** [ADR 005 — Thin core, fat targets](../../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md), [`no-target-branches.mdc`](../../../.agents/rules/no-target-branches.mdc), the interface+factory pattern ([`docs/architecture docs/patterns/interface-plus-factory.md`](../../../docs/architecture%20docs/patterns/interface-plus-factory.md)), this project's [`spec.md`](../spec.md).

---

## Context

Postgres Row-Level Security is enforced through session state: `role` and `request.jwt.claims` must be set on the connection a query runs on, and nothing user-configurable may be able to observe, reorder, or strip that state. The SQL runtime had no home for this. Its class hierarchy stopped at a package-private family implementation; construction went through a family-level `createRuntime` factory; and the only extension point — user middleware — is exactly the layer that must *not* be able to touch session state.

Three structural gaps, then:

1. **No subclass seam.** Target- or extension-specific runtime behaviour had no class to live in.
2. **No below-middleware access.** Connection acquisition happened inside the runtime, beneath the middleware chain, with no way for privileged code to reach the raw connection.
3. **No binding model.** Even given raw access, something must guarantee that *every* query path — single executes, ORM mutation graphs, multi-statement transactions — runs with the binding in force. The project's own first cut failed here: it shipped the capability as a verb (`executeWithSessionBootstrap(plan, bootstrap)`), and final review found the ORM acquiring its own connection scope underneath the bound path — an RLS bypass that failed open. When a binding belongs to a call site, every other call site is a hole.

## Decision

### 1. Interfaces are the dependency surface; `Base` marks needs-extension, `Impl` marks concretions

Every layer of the runtime exposes two surfaces: an interface you depend on, and a class. Interfaces carry the bare names. Class suffixes follow the repo conventions: `Base` for a class that needs extension to be useful (abstract), `Impl` for a concrete implementation. Factories construct `Impl` classes and return interfaces, so a concretion never flows into app code as a value.

| Layer | Interface | Class |
|---|---|---|
| Framework | `RuntimeExecutor` | `RuntimeCore` (abstract) |
| SQL family | `Runtime` (existing name, kept) | `SqlRuntimeBase` (abstract) |
| Target | `PostgresRuntime`, `SqliteRuntime` | `PostgresRuntimeImpl`, `SqliteRuntimeImpl` |
| Extension | `SupabaseRuntime` | `SupabaseRuntimeImpl extends PostgresRuntimeImpl` |

Two recorded refinements: **(a)** `Impl` classes are exported solely as extension seams — a deliberate relaxation of the classic package-private-`Impl` rule, which cannot hold when `SupabaseRuntimeImpl` (another package) must extend `PostgresRuntimeImpl`; depending on an `Impl` as a type remains forbidden. **(b)** The family interface keeps its existing name `Runtime` rather than being renamed `SqlRuntime`: the rename would touch every consumer of `@prisma-next/sql-runtime` for naming symmetry alone (operator decision). It is the scheme's one naming exception.

There is no family-level construction path: `createRuntime` is deleted, and each target factory (`postgres()`, `sqlite()`, `supabase()`) constructs its own `Base` class. Target interfaces begin as empty extensions of the family interface; their value is the named dependency surface, which makes later target-specific surface additive rather than breaking.

### 2. The family base provisions queryables; it does not execute-and-provision in one verb

`SqlRuntimeBase` exposes two protected seams, deliberately separated:

- **Provision:** acquire the raw driver connection (`SqlConnection` from the driver contract). The raw connection is already a `SqlQueryable` — SQL issued on it never enters the codec/middleware/telemetry pipeline, which is the below-middleware property — and already carries the lifecycle surface (`release`, `destroy`, `beginTransaction`). No wrapper type is introduced; the earlier `RawSessionConnection` was a redundant narrowing of `SqlQueryable` and is deleted.
- **Execute:** the existing execute-a-typed-plan-against-a-queryable internal becomes protected, so subclasses run middleware-wrapped plans against connections they provisioned without re-implementing the execute pipeline.

The base knows nothing about sessions, roles, or Supabase.

### 3. Subclasses provide session-coupled connections

`SupabaseRuntimeImpl` composes the two seams into a session: acquire a connection, bind the role onto it once, hand back an object within which *everything* is bound.

- **Bind at open:** `SELECT set_config($1, $2, false)` for `role` and `request.jwt.claims`. Parameterized — `SET role = $1` is invalid Postgres, and string-built SET would be an injection surface. `is_local = false` makes the GUCs session-scoped on that physical connection: that is what makes the object a session rather than a transaction.
- **Bound by construction:** the session exposes typed execute (via the protected execute seam), transactions (a plain transaction on the bound connection), and the subclass's raw access. There is no unbound route to the underlying connection, so the bypass class from the v1 design cannot be expressed.
- **Reset on release, destroy on failure:** `release()` issues `RESET ALL` before pooling the connection; a failed reset destroys the connection instead. Pool-poisoning protection is owned by the session lifecycle, not by callers.
- **Per-operation scope at the façade:** the role-bound `Db` opens a session per execute, per ORM operation (the ORM's `acquireRuntimeScope` acquire/release bracketing receives the session through the shim's `connection()` — the ORM's own scoping machinery becomes the enforcement mechanism), and per explicit transaction block. No connection or transaction is held across application logic.

## Alternatives considered

- **The v1 verb primitives** (`executeWithSessionBootstrap`, `executeTransactionWithBootstrap` + `RawSessionConnection`) — *shipped, then rejected in review.* Coupling provisioning to execution put the binding on a call site instead of on the connection; the ORM-scope RLS bypass found in final review is the resulting failure mode. Fixing it required amputating the ORM's connection scoping (a band-aid), and "session" leaked into the family base's vocabulary, one altitude too low.
- **Transaction-local binding (`SET LOCAL` / `set_config(..., true)`) per operation** — Postgres resets it automatically at COMMIT/ROLLBACK, which is attractive, but it forces a transaction around every statement and conflates "transaction" with "session"; the verb API grew directly out of this constraint. The session model trades it for an explicit `RESET ALL`-on-release discipline owned by one lifecycle implementation.
- **Keep `createRuntime` + a private default concretion** — rejected: a family-level construction path contradicts thin-core/fat-targets, and the exported-concretion variant invited exactly the class-coupling the interface rule exists to prevent.
- **Composition/decorator for the Supabase runtime** — rejected: a decorator forwards a growing surface by hand and is-not-a Postgres runtime; the domain relationship is subtyping.
- **Role/claims threaded through `RuntimeExecuteOptions`** — rejected: leaks a SQL-security concept into the cross-family framework type, and per-call options are exactly the "binding at the call site" shape the bypass demonstrated to be fragile.

## Consequences

- RLS enforcement is binding-by-construction: the security review reduces to "can any path reach the connection without going through the session?" — a structural question, not an audit of call sites.
- Extension authors get one model: depend on bare-name interfaces, extend `Base` classes, provision queryables from the family seam, bind your semantics onto them.
- The substrate owns two safety disciplines: connection lifecycle (release/destroy) and session hygiene (reset-or-destroy). Both are testable with a recording fake driver against real runtime objects — no self-mocks.
- Breaking surface relative to 0.13: `SqlRuntimeImpl`/`createRuntime` gone; the family class renamed to `SqlRuntimeBase` and the target classes to `*RuntimeImpl`; the v1 verbs never ship in a release. Covered by the 0.13→0.14 upgrade declarations.

## Cross-references

- Project spec: [`../spec.md`](../spec.md) — the model, cross-cutting requirements, DoD.
- Operator review that forced v2: PR #792 inline comments, 2026-06-10.
- Driver contract: `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts` (`SqlConnection`, `SqlQueryable`).
- ORM connection scoping: `packages/3-extensions/sql-orm-client/src/collection-runtime.ts` (`acquireRuntimeScope`).
