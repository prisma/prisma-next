# Design holes surfaced by writing the example app

Each entry below is a concrete decision the current `projects/supabase-integration/` design notes do **not** cover, surfaced while writing the example app sketch. Holes are grouped by concern and numbered for cross-reference from the example source files.

Status legend:

- 🔴 **Blocking** — must be settled before the project can move to a spec.
- 🟡 **Default-able** — a working assumption is fine; settle when implementation forces the issue.
- 🟢 **Cosmetic / nice-to-have** — capture, defer.

## Contract authoring (`src/prisma/contract.ts`)

### 🔴 #1 — Capability gate for RLS

The example sets `capabilities.postgres['postgres.rls']: true`. Two options:

- `'postgres.rls'` — RLS is a Postgres-target capability. Any Postgres consumer can use it; Supabase happens to be one. Aligns with how other Postgres-only features gate.
- `'supabase.rls'` — RLS is bound to the Supabase extension. Stops non-Supabase Postgres apps from accidentally using the DSL.

**Recommendation: `'postgres.rls'`.** RLS is a Postgres mechanic, not a Supabase one. Other Postgres apps will want it (multi-tenant SaaS, internal admin tools, etc.). Make it target-level, gate the DSL on its presence in the capabilities, and have the Supabase extension pre-enable it by default in any contract using `extensionPacks: { supabase: ... }`.

Touches: [`rls.md`](../rls.md) (needs the capability-key decision), [`extension-package.md`](../extension-package.md) (needs the auto-enable behaviour documented).

### 🟡 #2 — `rlsPolicy(...)` injection point

The example destructures `rlsPolicy` from the `.sql()` closure alongside `cols` and `constraints`:

```ts
.sql(({ cols, constraints, rlsPolicy }) => ({
  table: 'profile',
  rlsPolicies: [ rlsPolicy({ ... }) ],
}))
```

`rls.md` shows the alternative `c.rlsPolicy({...})` on a separate `constraints` callback. Pick one shape and apply consistently.

**Recommendation: keep `rlsPolicy` on the `.sql()` closure** alongside other Postgres-only structural concerns (foreign keys, unique constraints). RLS is Postgres-specific; it belongs with the SQL block, not in a target-agnostic `constraints` callback.

### 🟡 #3 — `onDelete` (and friends) on cross-contract FKs

The example sets `onDelete: 'cascade'` on the cross-contract FK from `Profile.userId` to `auth.users.id`. The cross-contract-refs design note flags cascading actions as an open question. The example forces the answer.

**Recommendation: permit, but emit a planner warning** when a cascading action targets an `externally-managed` table. The warning is informational ("Profile rows will be deleted when an auth.users row is deleted by Supabase. This is your intent if you want orphan cleanup; flag if not."). Migration emission is unaffected.

Touches: [`cross-contract-refs.md`](../cross-contract-refs.md) open-questions list — promote from open to settled.

### 🟢 #4 — `uniqueConstraints` in `.sql()` block

The example places named unique constraints inside the `.sql()` block. The existing demo example expresses uniques via field-level `.unique()`. Both should work; the SQL-block form supports naming and composite keys.

**Recommendation: both. Field-level `.unique()` for single-column unnamed uniques, SQL-block `constraints.unique([cols.x, cols.y], { name })` for composite or named uniques.** No spec impact; documentation only.

### 🔴 #5 — RLS predicate qualified-table semantics

The example RLS predicate `'author_id IN (SELECT id FROM public.profile WHERE ...)'` references the local table by qualified name. Three questions surface:

1. **Canonicalization.** Does the framework rewrite `public.profile` to whatever the contract's effective namespace + table-name resolution produces? If a user renames the SQL `table: 'profile'` to `table: 'user_profile'`, does the predicate auto-track?
2. **`__unspecified__` interaction.** If the model lives in `__unspecified__` (Postgres) and the predicate hardcodes `public.profile`, the predicate may be wrong in multi-tenant deployments where the schema isn't `public`.
3. **Diagnostic / lint.** Should the framework parse predicate strings well enough to warn on stale table references?

**Recommendation:** v0.1 takes predicates **verbatim** — no canonicalization, no parsing. Document the convention "use the schema-qualified name that your migrations emit" and add a CLI lint (`prisma-next check`) that pattern-matches likely table references in predicates against the contract and warns on mismatches. Defer typed-predicate IR to follow-up work.

Touches: [`rls.md`](../rls.md) needs this rule documented.

### 🟢 #6 — Cross-namespace `rel.hasMany`

Not exercised in the example (Profile.hasMany(Post) is within `public`). But the design implies `hasMany(supabaseContract.models.X)` should work too. Confirm at implementation time.

**Recommendation: zero new syntax**, same rule as `belongsTo` — model handle carries the namespace + contract-space coordinate.

## Runtime initialization (`src/prisma/db.ts`)

### 🔴 #7 — `middleware` on `SupabaseRuntimeOptions`

The example passes `middleware: [...]` to `supabase({...})`. The current `extension-package.md` `SupabaseRuntimeOptions` interface doesn't have it.

**Recommendation: add `middleware?: Middleware[]` to `SupabaseRuntimeOptions`.** Forward to the internally-composed `postgres({...})` call.

Touches: [`extension-package.md`](../extension-package.md) §"Runtime facade" — add the option.

### 🔴 #8 — Middleware ordering relative to role-binding

The Supabase facade installs its own middleware to issue `SET LOCAL role = '...'` and `SET LOCAL request.jwt.claims = '...'` on each scoped session. Where does user-supplied middleware land?

**Recommendation: user middleware wraps the role-binding middleware** (outermost = user middleware, innermost = role binding → DB). This means:

- Telemetry sees the user-issued logical query, not the SET LOCAL plumbing.
- Lints / budgets evaluate against the logical query.
- The SET LOCAL is invisible to user middleware (correct — it's an implementation detail of role binding).

Document this in [`extension-package.md`](../extension-package.md).

### 🟡 #9 — `TypeMaps` generation

The example imports `TypeMaps` from `./contract.d`. The existing demo example imports only `Contract`. Confirm both are generated by the emitter, and that the supabase runtime facade's generic signature accepts both.

**Recommendation: both. Align with whatever `postgres<Contract, TypeMaps>(...)` already needs.** No new work — just verify the type parameters thread through `supabase<Contract, TypeMaps>(...)`.

## Request handlers (`src/handlers.ts`)

### 🟡 #10 — Cost of `db.asXxx()`

Is `db.asAnon()` cheap (memoized handle, no IO) or expensive (acquires a connection, opens a transaction)? Affects whether users hoist or not.

**Recommendation: cheap — `db.asXxx()` returns a stateless role-bound `Db` handle.** Connection acquisition and transaction opening happen on `.runtime().execute(plan)` (or on entering the `.transaction()` callback, see #11). Users don't have to hoist; doing so is purely stylistic.

### 🔴 #11 — Multi-statement transactions on a role-bound `Db`

`createPost` reads the profile then inserts a post. Both must share a transaction (and the same SET LOCAL state). The current `db.asUser(jwt)` API has no obvious way to scope multiple statements.

**Recommendation: add `db.asUser(jwt).transaction(async (tx) => { ... })`** where `tx` is itself a role-bound `Db` pinned to a single connection across the closure. The `SET LOCAL role` and `SET LOCAL request.jwt.claims` are issued once when the transaction opens. On closure exit, COMMIT (or ROLLBACK on throw); the pool checkout returns to clean state.

Same shape for `asAnon().transaction()` and `asServiceRole().transaction()`.

Touches: [`extension-package.md`](../extension-package.md) §"Runtime facade" — add `.transaction()` to the `SupabaseDb` interface.

### 🟡 #12 — `asUser(jwt).runtime()` lifecycle

Per-call construction or one-runtime-per-Db? Affects observability (where do you attach a tracer span?) and lifecycle (when does middleware close-out fire?).

**Recommendation: one runtime per role-bound Db handle, lazily constructed on first `.runtime()` call.** Same shape as the base `postgres()` runtime. The role binding is at the connection-acquisition layer (driven by middleware), not at the runtime construction layer.

### 🔴 #13 — JWT validation timing

Eager (on `db.asUser(jwt)`) or lazy (on first query)?

**Recommendation: eager.** `db.asUser(jwt)` synchronously parses + validates the JWT (signature, expiry, audience if configured) and throws a typed `InvalidJwtError` if validation fails. Lazy validation defers errors to query time, where they get mixed up with other query failures. Eager is fail-fast and gives the application a single, narrow exception type to catch in HTTP middleware.

Caveat: if `jwksUrl` is configured, key fetching is async. Document the trade-off; recommend that long-running services cache the JWKS at startup.

Touches: [`extension-package.md`](../extension-package.md) §"Runtime facade" — `asUser` is sync, can throw `InvalidJwtError`.

### 🔴 #14 — Implicit transaction for `SET LOCAL`

`SET LOCAL` requires an open transaction. A single-statement `asUser(jwt).runtime().execute(plan)` call must therefore open a transaction implicitly.

**Recommendation: every role-bound query path opens its own transaction.** For single-statement calls (no `.transaction()`), the supabase middleware wraps the execute in `BEGIN; SET LOCAL …; <query>; COMMIT;`. For multi-statement `.transaction(async (tx) => …)`, the transaction wraps the whole closure with one `BEGIN` / `SET LOCAL` / `COMMIT` cycle.

This is also the RLS-bypass-footgun mitigation: by never leaving SET LOCAL state outside a transaction, the next pool checkout always sees clean state. Document loudly.

Touches: [`extension-package.md`](../extension-package.md) §"Pool considerations" — already mentions this; needs the "always-in-a-txn" rule made explicit.

## Pinned mirror (`migrations/supabase/contract.json`, `contract.d.ts`)

### 🔴 #15 — Function IR shape

The example invents `functions: { <name>: { namespace, posture, returns: { type }, args: [...] } }`. The shape is ungrounded — the contract IR doesn't have a `functions` key today.

**Recommendation: model functions as siblings to models in the contract IR.** Per-function fields: `namespace`, `name`, `posture` (defaulting from contract `defaultPosture`), `returns: TypeRef`, `args: ParamRef[]`, optional `volatility: 'immutable' | 'stable' | 'volatile'` (matches Postgres semantics). The verifier reads `pg_proc` and matches by `(namespace, name, argtypes)`.

Touches: [`posture.md`](../posture.md) §"Function-level posture" — the IR sketch there must concretize.

### 🟡 #16 — Function-name canonicalization

The example's contract.json keys functions by bare name (`"uid"`, `"jwt"`, `"role"`) with `namespace` as a separate field — matching the model convention. The original sketch in `posture.md` used dot-keyed names (`"auth.uid"`).

**Recommendation: bare-name keys + separate `namespace` field**, matching models. Consistency.

### 🔴 #17 — `TypedContract<T>` shape and `.models.<Name>.refs.<field>` accessors

The cross-contract-refs design references `supabaseContract.models.AuthUser.refs.id` — a typed accessor path. The type-level machinery that lifts a `Contract` type spec into this accessor tree is currently unwritten.

**Recommendation: `TypedContract<T>` is a mapped type that emits `.models` (keyed by model name) and per-model `.refs` (keyed by field name) accessors.** Each `.refs.<field>` produces a branded `ColumnRef<{ spaceId, namespace, table, column, type }>` that the framework consumes in FK and relation declarations. This is one focused type-level surface in `@prisma-next/contract-core`; not a large piece of work, but explicit.

Touches: cross-contract-refs.md's "What's the typed handle returned by `supabase.contract<C>(json)`?" open question — promote to settled with this answer.

## Cross-cutting

### 🟡 #18 — Where the example app lives during shaping

Currently `projects/supabase-integration/example/`. Migrates to `examples/supabase/` at project close-out. Codify in the eventual project plan as a close-out task.

### 🔴 #19 — RLS verifier check semantics

The example declares 8 RLS policies across 2 tables. The verifier introspects `pg_policies` and compares. The comparison rules need concrete definitions:

- **Policy identity:** match by `(schema, table, policy_name)`?
- **Predicate equivalence:** verbatim string match? AST-normalized? Postgres-side `pg_get_expr` round-trip?
- **Role-list ordering:** roles list order-significant?
- **Missing policy:** error or warning?
- **Extra policy on the table that the contract doesn't declare:** error or `drift` posture?

**Recommendation for v0.1:** identity by `(schema, table, policy_name)`; predicate compared verbatim (with a normalize-whitespace pass); roles list as a set, not a sequence; missing policy → verifier error; extra policy → diagnostic only, governed by table-level posture (`modeled` → error, `tolerated` → warn, `drift` → silent).

Touches: [`rls.md`](../rls.md) §"Verifier behaviour" — needs these rules concretized.

### 🟡 #20 — `supabase.pack()` vs `supabase()` shorthand

`extension-package.md` says `supabase()` is sugar for `supabase.pack()`. But `supabase` is also a namespace object (`supabase.contract`, `supabase.roles`). Making it callable requires either (a) `supabase` is `Callable & Namespace` (the JS idiom is awkward), or (b) drop the shorthand and always use `supabase.pack()`.

**Recommendation: drop the shorthand. Always `supabase.pack()`.** Removes one inconsistency, one tiny JS oddity. Consistent with the rest of the namespace API.

Touches: [`extension-package.md`](../extension-package.md) — remove the `supabase()` shorthand line.

## Summary of blocking holes

| # | Concern | Resolution direction |
|---|---------|---------------------|
| 1 | RLS capability gate | `'postgres.rls'` (target-level) |
| 5 | RLS predicate qualified-table semantics | Verbatim v0.1; CLI lint for mismatches |
| 7 | `middleware` on SupabaseRuntimeOptions | Add it |
| 8 | Middleware ordering vs role-binding | User middleware outermost |
| 11 | Multi-statement transactions | `.transaction(async tx => …)` on each role-bound Db |
| 13 | JWT validation timing | Eager on `asUser(jwt)` |
| 14 | Implicit transaction for SET LOCAL | Every role-bound execute is in a txn |
| 15 | Function IR shape | Models-sibling, posture-bearing |
| 17 | `TypedContract<T>` accessor shape | `.models.<Name>.refs.<field>` mapped type |
| 19 | RLS verifier check semantics | Identity by name, predicate verbatim+normalized |

The remaining holes (🟡 / 🟢) are either default-able with working assumptions or pure cosmetics. The 10 blockers above are what the project spec needs to settle before execution begins.
