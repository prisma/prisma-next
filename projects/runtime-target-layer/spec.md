# Summary

The runtime layer's class hierarchy is two-thirds populated: `RuntimeCore` (abstract framework base) and `SqlRuntimeImpl` / `MongoRuntimeImpl` (concrete family implementations) exist, but `RuntimeCore`'s `protected override` hooks are explicitly designed for a third layer that doesn't exist yet. There is no `PostgresRuntime`; the Postgres extension uses `createRuntime(...)` directly and returns a `SqlRuntimeImpl` as a `Runtime` interface. This project introduces the missing **target layer** at the runtime — `SqlRuntime` (renamed and exported), `PostgresRuntime extends SqlRuntime` (a near-empty class providing the extension seam), and the supporting infrastructure subclasses need: a raw-connection accessor that lives *below* the user middleware chain (load-bearing for security-by-architecture properties Supabase will rely on) and a transaction primitive subclasses can wrap. The runtime layer is the canonical sibling of TML-2459's IR target layer; this project closes the symmetry. `SupabaseRuntime extends PostgresRuntime` itself does not land here — it lands in [extension-supabase](../extension-supabase/spec.md), which is the first consumer of this project's deliverables.

# Context

## At a glance

Today's runtime class diagram (Postgres path):

```
abstract class RuntimeCore<TQueryPlan, TExecPlan, TMiddleware>          // framework-components (exported)
   ↑ extends
class SqlRuntimeImpl extends RuntimeCore<SqlQueryPlan, …>               // packages/2-sql/5-runtime (NOT exported)

const db = createRuntime({ … });  // factory returns a `Runtime` interface; concrete class is hidden
```

After this project:

```
abstract class RuntimeCore<TQueryPlan, TExecPlan, TMiddleware>          // unchanged
   ↑ extends
class SqlRuntime extends RuntimeCore<SqlQueryPlan, …>                   // renamed from SqlRuntimeImpl, EXPORTED
   ↑ extends
class PostgresRuntime extends SqlRuntime                                // NEW; thin target-layer subclass
                                                                        // shipped by Postgres extension

// In a separate project (extension-supabase):
class SupabaseRuntime extends PostgresRuntime
```

Three properties of the design:

- **`createRuntime` factory stays.** Apps that don't need subclassing keep calling it; nothing changes for them. The factory's return type continues to be `Runtime`. Subclassing is the path for extensions; direct construction (via `new SqlRuntime(…)` / `new PostgresRuntime(…)`) is the path for extension authors.
- **`SET LOCAL` injection is structural, not policy.** The infrastructure refactor exposes a raw-connection accessor *below* the user middleware chain, so subclasses can issue session-state SQL that user middleware cannot bypass or reorder. This is the load-bearing primitive that makes Supabase's RLS-via-`SET LOCAL` correct by architecture rather than correct by convention. The accessor is intentionally narrow and protected — extension authors get a single hook, not "the raw connection" as an unbounded extensibility surface.
- **Implicit transactions are subclass-driven.** `RuntimeCore`'s existing `withTransaction` primitive is reused; `SupabaseRuntime` wraps every role-bound `execute()` in an implicit transaction. The base runtime ships no policy change; the new contract is "subclasses may wrap arbitrary scopes in `withTransaction` via the base primitive."

## Problem

Three concrete problems motivate this project:

**1. The Postgres extension has no target-layer subclass.** Today's runtime layering ends at the family abstraction. The Postgres extension's runtime entry point is `createRuntime(...)` — a factory that constructs a `SqlRuntimeImpl` and returns it cast to `Runtime`. There is no `PostgresRuntime` class. Any Postgres-specific runtime behaviour (prepared-statement caching, `LISTEN` / `NOTIFY`, `COPY`-based bulk load) has nowhere to live except (a) the SQL family layer (wrong — SQLite doesn't have `LISTEN`), (b) an `if (target === 'postgres')` branch (explicitly forbidden by [`no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc)), or (c) middleware (the right place for cross-cutting concerns, not for foundational target capabilities). The architectural rule says "no target branches"; the codebase says "you can't follow the rule because there's no class to put your target-specific code in."

**2. `SET LOCAL` must be below the middleware chain — by architecture, not by documentation.** RLS enforcement depends on session variables (`role`, `request.jwt.claims`) being set before every query and not being reordered, removed, or replaced by user-defined middleware. If user middleware sits between the role-bound `execute()` and the driver, a misbehaving middleware can break the RLS contract silently. The fix is structural: subclasses get a way to issue session-state SQL on the raw connection, *below* the user middleware chain. The existing `RuntimeCore` middleware seam doesn't have a "below user middleware" hook; this project adds one.

**3. The Supabase project surfaces the gap first, but the gap isn't Supabase-specific.** The Supabase extension is the first downstream consumer that needs target-layer subclassing in anger, but the architectural gap is independent of Supabase. CipherStash, pgvector, future TimescaleDB / Citus / Aurora-extension packages — every Postgres extension that needs to override runtime semantics (encrypted-payload pre-processing, query-plan hinting, target-specific connection bootstrap) hits the same wall. Doing the refactor as a focused project (rather than buried inside Supabase) lets it benefit every downstream Postgres extension and gets reviewed against its architectural merits, not against a single use case.

## Approach

### Three deliverables

The project ships three pieces:

- **A renamed-and-exported `SqlRuntime`** (today's `SqlRuntimeImpl`). The class itself doesn't change shape; only its visibility does. The existing `protected override` hooks (`lower`, `runDriver`, the family-extended middleware lifecycle) were already designed for subclassing — only the export was missing.
- **A new `PostgresRuntime extends SqlRuntime`** in the Postgres extension. Initially identity-like. The `postgres()` factory constructs a `PostgresRuntime` instead of going through `createRuntime`.
- **A raw-connection accessor below user middleware**, plus a transaction primitive subclasses can wrap. These are the load-bearing primitives the Supabase runtime will consume.

### Class hierarchy

Mirrors TML-2459's three-layer IR pattern at the runtime layer:

| Layer | IR (TML-2459) | Runtime (after this project) |
|---|---|---|
| Framework | `SchemaNodeBase` (abstract) | `RuntimeCore` (abstract) |
| Family | `SqlNode` / `MongoSchemaNode` (abstract) | `SqlRuntime` / `MongoRuntime` (concrete, extendable) |
| Target | `PostgresTable` / `SqliteTable` (concrete) | `PostgresRuntime` / `SqliteRuntime` (concrete) |

The two layers are symmetric in shape but not in concern: IR shapes the on-disk artefact, runtime shapes execution. The recipe (framework abstract → family concrete-extendable → target concrete) is the same. Per ADR 005 ("Thin core, fat targets") the framework provides the affordances and targets fill in specifics; this project follows that rule and gives the runtime layer a structural home for the "specifics" the IR layer has had for two years already.

### Below-middleware raw-connection accessor

The piece of this project that requires the most design care.

Today the runtime executes user middleware as a chain wrapping the `execute(plan)` call. A query traverses every registered middleware on the way in and the way out. There is no seam between the innermost middleware and the driver.

For RLS enforcement, `SupabaseRuntime` needs to issue `SET LOCAL role = ...; SET LOCAL request.jwt.claims = ...;` on the same physical connection that handles the subsequent `execute()`, and it needs to do that *after* all user middleware has run (otherwise a middleware could re-issue `SET LOCAL role = 'service_role'` and bypass the policy check). The cleanest shape is a protected accessor that returns the raw connection the runtime is about to use, scoped to a callback:

```ts
// Illustrative — exact shape up to the implementer
abstract class RuntimeCore<…> {
  protected withRawConnection<R>(callback: (conn: RawConnection) => Promise<R>): Promise<R> {
    // base implementation: acquire connection, run callback, release
  }
}

class SupabaseRuntime extends PostgresRuntime {
  override async execute(plan: SqlExecutionPlan): Promise<unknown> {
    return this.withTransaction(async () => {
      return this.withRawConnection(async (conn) => {
        await conn.exec(`SET LOCAL role = '${this.role}'`);
        await conn.exec(`SET LOCAL request.jwt.claims = '${JSON.stringify(this.claims)}'`);
        return super.execute(plan);  // user middleware chain runs from here down
      });
    });
  }
}
```

Three properties:

- **Scoped to a callback.** The raw connection is never returned from a method that exits with it still acquired. The callback shape forces release semantics; subclasses can't accidentally leak connections.
- **Protected, not public.** User code cannot reach the raw connection — it's a subclass-only escape hatch. The middleware chain remains the only public extension point for query interception.
- **Returns the same connection the subsequent `execute` will use.** The connection is sticky across the callback boundary; the `SET LOCAL` settings persist for the duration of the transaction the runtime opened. This is what makes the security property structural rather than conventional — there is no scenario where `SET LOCAL` is issued on one connection and `execute` runs on another.

### Implicit transaction primitive

`RuntimeCore` already has a `withTransaction` primitive (today consumed by the runtime's `.transaction()` user-facing method). The contract this project formalises is: subclasses may compose `withTransaction` around arbitrary scopes, including the entire role-bound `execute()` path, without re-implementing transaction semantics.

Concretely:

- The base primitive opens a transaction on the runtime's connection pool, executes the callback, commits on success / rolls back on throw.
- Subclasses can nest `withTransaction` calls; the inner call no-ops if a transaction is already open (or escalates to a savepoint — implementer's choice, must be consistent with the existing `RuntimeCore` behaviour).
- The transaction is sticky to the connection — the same connection is used for the entire callback. This is what makes `SET LOCAL` safe inside `withTransaction`.

The Supabase runtime composes `withTransaction` + `withRawConnection` to get "implicit transaction on every role-bound execute, with `SET LOCAL` issued on the transaction's connection." Other extensions get the same composition for free.

### Middleware option threading

The current `createRuntime` factory accepts a `middleware?: readonly SqlMiddleware[]` option. After this project, the subclass constructors expose the same option, and the option is threaded through to `RuntimeCore`'s middleware chain without change. The Supabase runtime adds its `SET LOCAL`-injecting layer *inside* `withRawConnection` — which runs below the user middleware chain — so user middleware is unaffected.

### Construction pattern

The migration from `createRuntime(...)` to direct subclass construction is mostly invisible to users:

```ts
// Before this project (user code, unchanged):
import postgres from '@prisma-next/extension-supabase/runtime';  // or extension-postgres
const db = postgres({ contractJson, url, middleware: [...] });

// What changes is the implementation:
export function postgres(options: PostgresOptions): PostgresRuntime {
  return new PostgresRuntime({ /* derived from options */ });
}
```

The factory function remains the user's entry point; the type widens from `Runtime` to a `PostgresRuntime` subclass instance so extensions that want to subclass *that* can do so directly. Apps that consume the runtime through the `Runtime` interface keep working unchanged.

### What `PostgresRuntime` does in v0.1

Almost nothing. The whole point of this project is to provide the structural home, not to fill it with content. v0.1 of `PostgresRuntime` is identity-like — its constructor calls `super(...)` with the options it received, and that's the only required code. The two "must-haves" it provides:

- A protected hook for subclasses to override `execute()` (or whatever method is appropriate per the existing `RuntimeCore` extension contract) without coupling to `SqlRuntime`'s internals.
- A type identity (`PostgresRuntime`) that downstream extensions can extend.

Future projects (whether internal or community-driven) fill `PostgresRuntime` with Postgres-specific runtime behaviour. The relevant candidates:

- Prepared-statement caching (Postgres-specific because of the `pg_prepare` protocol semantics).
- `LISTEN` / `NOTIFY` support (Postgres-specific entirely).
- `COPY`-based bulk load (Postgres-specific binary protocol).
- Postgres-target connection bootstrap (`application_name`, `statement_timeout`, `idle_in_transaction_session_timeout` defaults).

None of these are in scope for this project. The project's claim is "the structural home exists"; the content lands as separately-scoped follow-ups.

# Requirements

## Functional Requirements

### Class hierarchy

- **FR1.** Rename `SqlRuntimeImpl` to `SqlRuntime` in `packages/2-sql/5-runtime/src/sql-runtime.ts` and export it from the package's public surface.
- **FR2.** Introduce `class PostgresRuntime extends SqlRuntime` in the Postgres extension package. Its constructor forwards options to `super(...)` unchanged. No behavioural differences from `SqlRuntime` in v0.1.
- **FR3.** The Postgres extension's user-facing factory (`postgres({...})`) returns a `PostgresRuntime` instance. The factory's return type widens from `Runtime` (interface) to `PostgresRuntime` (concrete class) — subtype-compatible with existing consumers.

### Below-middleware raw-connection accessor

- **FR4.** `RuntimeCore` gains a `protected withRawConnection<R>(callback: (conn: RawConnection) => Promise<R>): Promise<R>` method (or equivalent shape — exact signature implementer's choice, but the scoping-by-callback discipline is required). The accessor returns the connection the runtime is about to use for subsequent `execute` calls within the callback's scope.
- **FR5.** The raw connection is sticky inside the callback's scope: the connection passed to the callback is the same connection used for subsequent `execute` calls made from inside the callback. This is the load-bearing property that makes `SET LOCAL` semantically correct.
- **FR6.** `withRawConnection` enforces release semantics: the connection is returned to the pool when the callback resolves or throws. There is no API for subclasses to "hold the connection beyond the callback."
- **FR7.** The accessor is `protected`. User code (outside the runtime class hierarchy) cannot reach the raw connection. User middleware retains its existing seam — the middleware chain wrapping `execute(plan)` — and gains no new privileges.

### Implicit transaction primitive

- **FR8.** `RuntimeCore`'s existing `withTransaction` primitive is formalised as the canonical composition point for subclasses that want to wrap arbitrary scopes in transactions. The behaviour (open, execute callback, commit / rollback, release) is documented in a contributor doc as part of M3.
- **FR9.** `withTransaction` is sticky to a connection: the same connection is used for the entire callback. This is consistent with the existing behaviour; the project's contribution is documenting it as a load-bearing property rather than an implementation accident.
- **FR10.** `withTransaction` and `withRawConnection` compose: nesting `withTransaction(() => withRawConnection(conn => ...))` uses the transaction's connection for `withRawConnection`'s callback. Verified by unit tests.

### Construction surface

- **FR11.** The `createRuntime` factory continues to exist and continues to return a `Runtime` (interface). Apps that use the factory directly are unaffected by this project's changes.
- **FR12.** `SqlRuntime` and `PostgresRuntime` constructors accept the same options as `createRuntime`. Subclasses (Supabase, etc.) extend the option type additively (e.g. adding `jwtSecret`, `role`, `claims` for Supabase) per their own design.
- **FR13.** The `middleware?: readonly SqlMiddleware[]` option threads from `PostgresRuntime` → `SqlRuntime` → `RuntimeCore` unchanged. User middleware is unaffected by the runtime-target-layer refactor.

### Build / packaging

- **FR14.** `SqlRuntime` is exported from `@prisma-next/sql-runtime` (or its current package name) under a stable public symbol. The `Impl` suffix is dropped.
- **FR15.** `PostgresRuntime` is exported from the Postgres extension's `/runtime` subpath (per the [C6](../supabase-integration/decisions.md) extension package layout). The `postgres({...})` factory and the `PostgresRuntime` class are both visible to consumers.
- **FR16.** No backward-compatibility shims for the old `SqlRuntimeImpl` symbol. Per the project's no-backwards-compat policy, the rename is final; downstream packages migrate their imports.

## Non-Functional Requirements

- **NFR1.** The runtime hot path (the cost of an `execute` call without `withRawConnection` or `withTransaction` invocation) is unchanged. Specifically: existing benchmarks for `createRuntime`-constructed runtimes show no statistically significant regression after the refactor. The new protected methods are additive; they cost nothing when not called.
- **NFR2.** Layering is enforced by `pnpm lint:deps`. `PostgresRuntime` lives in the Postgres target layer; the family `SqlRuntime` doesn't import Postgres-specific code; the framework `RuntimeCore` doesn't import family code. The new `withRawConnection` accessor lives at the framework layer (`RuntimeCore`) because connection acquisition is a framework-level concern.
- **NFR3.** Type identities are stable: extensions can refer to `PostgresRuntime` as a type for subclassing without depending on private symbols. The class is exported from a stable path.
- **NFR4.** Test coverage: unit tests for the rename + export (compile-level), unit tests for `withRawConnection` scoping + release semantics, unit tests for `withTransaction` + `withRawConnection` composition (sticky-connection property), integration tests for `PostgresRuntime` against a live Postgres (PGlite) confirming no regression.
- **NFR5.** Documentation: `docs/architecture docs/subsystems/runtime-and-middleware-framework.md` (or its analog) is updated to reflect the new three-layer hierarchy. The ADR draft (already in `projects/runtime-target-layer/specs/`) is promoted to `docs/architecture docs/adrs/` at close-out.

## Non-goals

- **`SupabaseRuntime` itself.** The Supabase subclass — its constructor signature, JWT validation, role-bound `Db` interface, `SET LOCAL` invocations — is owned by the [extension-supabase](../extension-supabase/spec.md) project. This project ships the substrate Supabase will consume.
- **Postgres-specific runtime behaviour.** `LISTEN`/`NOTIFY`, `COPY`-based bulk load, prepared-statement caching, connection bootstrap (`application_name`, timeouts) — all out of scope. `PostgresRuntime` is intentionally near-empty in v0.1.
- **Mongo target-layer parity.** The same architectural gap exists in the Mongo family (`MongoRuntimeImpl` is not exported, no `MongoTargetRuntime` class exists). This project focuses on Postgres because Postgres is what unblocks Supabase. The Mongo equivalent is a future project; the patterns established here are the template.
- **Middleware seam redesign.** The user middleware chain remains the public extension point for query interception. The new `withRawConnection` accessor is `protected` and reserved for subclasses; it is not a generalised "below-middleware injection" hook for arbitrary user middleware.
- **`Runtime` interface evolution.** The framework's `Runtime` interface (the public-facing type that user code consumes) does not change shape. The new `withRawConnection` and (formalised) `withTransaction` methods are `protected` and visible only on subclasses.

## Sequencing constraints

This project has no *build*-stage dependency on the other umbrella projects — the code can land first.

It does *not* depend on [TML-2459](../target-extensible-ir/spec.md) (TML-2459 is about IR; this project is about runtime). The two projects are siblings — the same three-layer recipe at two different concerns — but they share no code path, so they can land in either order.

**Its proof depends on [postgres-rls](../postgres-rls/spec.md), though.** RLS is the static contract side and this is the dynamic runtime side, so the *code* is independent — but the whole point of the below-middleware raw-connection accessor is that a `SET LOCAL role` issued through it gates access, and demonstrating that requires RLS policies + roles to enforce against. So this project's end-to-end validation follows `postgres-rls`, even though implementation can start in parallel.

It does *not* depend on [cross-contract-refs](../cross-contract-refs/spec.md).

It *is* a hard dependency of [extension-supabase](../extension-supabase/spec.md), which consumes `PostgresRuntime` as the base class for `SupabaseRuntime`.

Resulting global sequence (within the Supabase umbrella): **this project** can land in parallel with TML-2459, postgres-rls, and cross-contract-refs. All four feed into **extension-supabase** as the integration project.

# Acceptance Criteria

- [ ] **AC1.** `SqlRuntime` is exported from `@prisma-next/sql-runtime` under a stable public symbol. `SqlRuntimeImpl` is removed; the symbol does not appear in the public API surface. All downstream consumers in the workspace import `SqlRuntime` directly.
- [ ] **AC2.** `PostgresRuntime extends SqlRuntime` is exported from the Postgres extension's `/runtime` subpath. The `postgres({...})` factory returns a `PostgresRuntime` instance.
- [ ] **AC3.** Existing app contracts that consume the runtime through the `Runtime` interface compile and run unchanged. End-to-end integration tests (PGlite-backed) green; no observable behaviour change in the existing test suite.
- [ ] **AC4.** A subclass of `PostgresRuntime` can call `protected withRawConnection(async (conn) => { … })` and receive a raw connection. The connection is released when the callback resolves or throws. Demonstrated by a synthetic test fixture (not the Supabase extension — that lives in a separate project).
- [ ] **AC5.** `withRawConnection` + `withTransaction` compose: nesting both yields a single connection for the entire scope. Verified by a unit test asserting connection identity equality across the nested callbacks.
- [ ] **AC6.** A user middleware registered via the `middleware` option runs as before. The synthetic `withRawConnection` test fixture confirms `SET …` issued inside the callback is not visible to user middleware as a regular `execute()` call (i.e., user middleware doesn't see the bootstrap SQL).
- [ ] **AC7.** Performance: existing runtime micro-benchmarks (whichever the repo has) show no statistically significant regression. The hot path for `execute` calls is unchanged.
- [ ] **AC8.** `pnpm lint:deps` passes; no new layering violations. `PostgresRuntime` lives in the Postgres extension package; `SqlRuntime` is at the family layer; `RuntimeCore` + the new `withRawConnection` infrastructure live at the framework layer.
- [ ] **AC9.** The runtime ADR draft is promoted from `projects/runtime-target-layer/specs/adr-runtime-target-layer.md` into `docs/architecture docs/adrs/` (named per the ADR convention). The subsystem doc for runtime + middleware is updated to reflect the new hierarchy.

# Other Considerations

## Security

The below-middleware raw-connection accessor is the load-bearing primitive for downstream RLS enforcement (in the Supabase project). The security properties this project commits to:

- **Scoping discipline.** The accessor is callback-scoped, returns connections to the pool on resolve / throw, and is `protected` — user code cannot reach it. This combination prevents the obvious leaks (forgotten release, accidentally-public raw connection) at the API surface.
- **Connection stickiness inside the callback.** The same physical connection is used for the entire callback's nested `execute` and `withTransaction` calls. This is the property that makes `SET LOCAL` correct — it persists for the transaction's lifetime on that specific connection.

This project does not itself enforce any RLS or session-state policy. It ships the primitive; the policy is the consumer's job (Supabase's role-bound `Db` interface, future encryption extensions, etc.).

## Cost

Internal engineering effort only. The rename + export + new `PostgresRuntime` class is ~50–100 LOC mechanical. The `withRawConnection` accessor and its test surface are larger — perhaps 200–300 LOC including the unit tests for scoping / release / composition semantics.

Documentation work (ADR promotion + subsystem doc update) is bounded.

Total: ~300–400 LOC + tests + docs.

The two biggest risks are scope creep ("while we're in here, let's also redesign middleware") and accidental hot-path regression in the rename. M1 should land the rename as a no-behaviour-change PR to isolate the regression risk; M2 lands the new functionality on top.

## Observability

The new `withRawConnection` accessor is observable through whatever connection-acquisition / release telemetry the runtime already emits. No new metrics or events are required by this project; downstream consumers (Supabase) may add their own.

## Data Protection

Not applicable — no user data flows are changed.

## Analytics

Not applicable.

# References

- [Umbrella project — Supabase integration](../supabase-integration/README.md) — context for why this project exists.
- [Umbrella `decisions.md` C12](../supabase-integration/decisions.md) — the canonical decision capturing the three-layer runtime hierarchy. This spec is the spec implementing C12.
- [TML-2459 — Target-Extensible IR](../target-extensible-ir/spec.md) — sibling project. Same three-layer recipe at the IR layer; this project closes the symmetry at the runtime layer.
- [`projects/runtime-target-layer/specs/adr-runtime-target-layer.md`](specs/adr-runtime-target-layer.md) — the load-bearing ADR. Promoted at close-out.
- [ADR 005 — Thin core, fat targets](../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — the architectural principle the runtime layer didn't yet follow; this project gets it there.
- [`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc) — the rule that "no target branches in code" relies on. Today the rule is unenforceable in runtime code because there's no target class to put target-specific code in; this project gives the rule a structural home.
- [extension-supabase project spec](../extension-supabase/spec.md) — the consumer that extends `PostgresRuntime` to ship `SupabaseRuntime`.
- [postgres-rls project spec](../postgres-rls/spec.md) — the sibling project that ships the static RLS contract whose runtime side this project's accessor unblocks.

# Open Questions

- **`SqliteRuntime` parity.** Does this project also introduce `class SqliteRuntime extends SqlRuntime` for symmetry? **Working assumption: yes**, with the same identity-like v0.1 shape. The marginal cost is small (~20 LOC), and the symmetry pays off the first time a SQLite extension (or even a future internal feature) needs target-layer-specific runtime behaviour. The implementer should add it in the same PR as `PostgresRuntime` unless the test surface balloons unexpectedly.
- **`withTransaction` documentation surface.** The primitive already exists in `RuntimeCore`; what this project commits to is *documenting* it as a stable composition point. Should that documentation live in a contributor doc (`docs/architecture docs/subsystems/runtime-and-middleware-framework.md`), an ADR (independent of the target-layer ADR), or both? **Working assumption: both.** The subsystem doc is the day-to-day reference; the ADR captures the durable decision that `withTransaction` is a public-to-subclasses primitive.
- **Naming: `withRawConnection` vs alternatives.** Other plausible names: `withConnection`, `acquireConnection`, `belowMiddleware`. **Working assumption: `withRawConnection`** — the word "raw" telegraphs "this is the actual connection, not a wrapped one." The exact name is implementer-flexible; the *shape* (callback-scoped, returns connection identity) is fixed by FR4–FR7.
