# Design holes surfaced by writing the example app

Each entry below is a concrete decision the current `projects/supabase-integration/` design notes do **not** cover, surfaced while writing the example app sketch. Holes are grouped by concern and numbered for cross-reference from the example source files.

Status legend:

- 🔴 **Blocking** — must be settled before the project can move to a spec.
- 🟡 **Default-able** — a working assumption is fine; settle when implementation forces the issue.
- 🟢 **Cosmetic / nice-to-have** — capture, defer.

## Contract authoring (`src/prisma/contract.ts`)

### ✅ #1 — Capability gate for RLS — **DECIDED: no explicit capability flag**

**Resolution:** target presence is the gate. The Postgres target carries RLS support; pack-aware typing makes the `.rls(...)` slot visible on the model builder only when the target supports it (same mechanism `IndexTypes` uses today in `SqlContext` — see [`contract-dsl.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts) `PackAwareSqlConstraints<IndexTypes>`). Non-Postgres targets simply don't expose the slot; no capability flag is required.

Verifier strictness opt-out (e.g. "skip RLS checks for this table") is a *separate* concern handled by table-level `control` policy (see [`projects/control-policy/spec.md`](../../control-policy/spec.md)), not a capability switch.

The example app should drop `capabilities.postgres['postgres.rls']: true` from its contract config.

Touches: [`rls.md`](../rls.md) (the capability-key discussion can be removed — there is no capability key), example contract.ts.

### ✅ #2 — `rlsPolicy(...)` injection point — **DECIDED: separate `.rls(...)` stage, dict keyed by operation**

**Resolution:** add a fourth named stage on `ContractModelBuilder` alongside `.attributes(...)` and `.sql(...)`. The argument is an **array of named policy descriptors** — each policy carries its own `name`, `operation`, `roles`, optional `as`, and the predicate bodies:

```ts
const Post = model('Post', { /* fields */ })
  .relations({ author: rel.belongsTo(Profile, { from: 'authorId', to: 'id' }) })
  .attributes(({ fields, constraints }) => ({
    id: constraints.id(fields.id),
  }))
  .sql(({ cols, constraints }) => ({
    table: 'post',
    foreignKeys: [ constraints.foreignKey(cols.authorId, Profile.refs.id) ],
  }))
  .rls([
    {
      name: 'posts_select_published',
      operation: 'select',
      roles: [supabase.roles.anon, supabase.roles.authenticated],
      using: 'is_published = true',
    },
    {
      name: 'posts_insert_own',
      operation: 'insert',
      roles: [supabase.roles.authenticated],
      withCheck: 'author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)',
    },
    {
      name: 'posts_update_own',
      operation: 'update',
      roles: [supabase.roles.authenticated],
      using:     'author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)',
      withCheck: 'author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)',
    },
    {
      name: 'posts_delete_own',
      operation: 'delete',
      roles: [supabase.roles.authenticated],
      using: 'author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)',
    },
    // Permissive layered with restrictive — Postgres composes them at evaluation time.
    // {
    //   name: 'posts_select_no_archived',
    //   operation: 'select',
    //   as: 'restrictive',
    //   roles: [supabase.roles.authenticated],
    //   using: 'is_archived = false',
    // },
  ]);
```

**Why a separate `.rls(...)` stage rather than living in `.sql(...)`:**

- The existing DSL has clear precedent: `.attributes(...)` is **target-agnostic** (`id`, `uniques`), `.sql(...)` is **target-specific** (`indexes`, `foreignKeys`). RLS is a third concern — structurally Postgres-specific, but conceptually about **access control**, not table structure. Giving it its own stage keeps `.sql(...)` focused on schema topology and makes RLS visually scannable in a model definition.
- Pack-aware typing gates the method itself: `.rls(...)` is typed on `ContractModelBuilder` only when the target carries RLS support. Same mechanism as `PackAwareSqlConstraints<IndexTypes>` today.

**Why an array of named descriptors rather than a dict keyed by operation:**

The earlier version of this section recommended a dict keyed by operation (`{ select: {...}, insert: {...}, ... }`) on the basis that it structurally enforced "one permissive policy per operation." That positioning was reversed: it makes the TS surface *more restricted* than PSL (which uses named-block policies and naturally allows multiple permissive policies per op when names differ). The framework's typical positioning is the inverse — TS is the more expressive surface, PSL the simpler restricted one. The array form restores that ordering.

- The operation is still a closed-set literal on each entry (`operation: 'select' | 'insert' | 'update' | 'delete' | 'all'`); the type system catches typos.
- Each policy carries its own name. Duplicate names across the array (within the same model) are detected at lowering time.
- Multiple permissive policies for the same operation are valid — Postgres ORs them; the framework emits them as N CREATE POLICY statements. PSL behaves the same way (one named-block per policy).
- One permissive + one restrictive on the same operation works naturally (Postgres composes them; the framework emits both).

**PSL surface** — settled in a parallel discussion. Top-level named-block declarations:

```psl
namespace public {
  policy profile_select {
    target = Profile
    operation = select
    roles = [anon, authenticated]
    using = "true"
  }
}
```

Body uses the `key = value` line convention already established for datasource/generator-shaped declarations. Predicates are plain strings in v0.1 (no interpolation); the structured-reference helper analogous to TS's `({ ref }) => ...` is a stretch goal — see #5.

### ✅ #3 — `onDelete` (and friends) on cross-contract FKs — **DECIDED: permit, no diagnostic**

**Resolution:** permit cascading actions on cross-contract FKs to externally-managed tables. **No diagnostic.** The developer's explicit `onDelete: 'cascade'` at the call site is the audit trail; emitting a warning on every build for a path the user opted into deliberately is noise.

This is the first concrete application of the repo-wide policy now codified in [`.agents/rules/explicit-opt-in-over-diagnostics.mdc`](../../../.agents/rules/explicit-opt-in-over-diagnostics.mdc): when a user has to type something to enable a risky behaviour, the typed-in code *is* the documentation of intent — a diagnostic adds noise without adding signal.

If a future use case surfaces where the choice is genuinely non-obvious (e.g. the user can't see from local code that the target is externally-managed), the answer is to make the API more explicit (e.g. require `crossContractCascade: true` as a deliberate opt-in beyond `onDelete: 'cascade'`), **not** to add a build-time warning.

Touches: [`cross-contract-refs.md`](../cross-contract-refs.md) — close the open question; permit cascading without diagnostic.

### ✅ #4 — `uniqueConstraints` in `.sql()` block — **RESOLVED: the DSL already covers this; example was wrong**

**Grounded by codebase inspection of [`contract-dsl.ts`](../../../packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts):** the DSL already has a clean home for composite/named uniques. The example app put them in the wrong place.

The model builder has **two staged closures**, with deliberately different scopes:

- `.attributes(({ fields, constraints }) => ({ id, uniques }))` — **target-agnostic** model attributes. `constraints` here exposes only `{ id, unique }` (both are concepts every SQL target supports). The spec shape is `ModelAttributesSpec = { id?, uniques?: UniqueConstraint[] }`.
- `.sql(({ cols, constraints }) => ({ table, indexes, foreignKeys }))` — **target-specific** SQL block. `constraints` here exposes `{ foreignKey, ref, index }` plus a `PackAwareIndex` typed by the target's index-type pack. The spec shape is `SqlStageSpec = { table?, indexes?, foreignKeys? }`.

Composite or named uniques belong in `.attributes(...)`, not `.sql(...)`. Field-level `.unique({ name? })` on `ScalarFieldBuilder` handles the single-column case. **No DSL extension required** — the example app simply moves to the right shape:

```ts
const Profile = model('Profile', {
  fields: {
    id:       field.id.uuidv4(),
    userId:   field.uuid(),
    username: field.text(),
  },
})
  .relations({ user: rel.belongsTo(supabaseContract.models.AuthUser, { from: 'userId', to: 'id' }) })
  .attributes(({ fields, constraints }) => ({
    id: constraints.id(fields.id),
    uniques: [
      constraints.unique(fields.userId,   { name: 'profile_userId_unique' }),
      constraints.unique(fields.username, { name: 'profile_username_unique' }),
      constraints.unique([fields.userId, fields.username], { name: 'profile_user_username_composite' }),
    ],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'profile',
    foreignKeys: [
      constraints.foreignKey(cols.userId, supabaseContract.models.AuthUser.refs.id, {
        name: 'profile_userId_fkey',
        onDelete: 'cascade',
      }),
    ],
  }));
```

**Spec impact:** none. **Example app impact:** fix the contract to use `.attributes(...)` for uniques and reserve `.sql(...)` for indexes / foreign keys. **Documentation impact:** the developer-experience doc should call out the `.attributes` / `.sql` / `.rls` separation explicitly so users know where each concern goes.

This finding also informs the precedent for #2: a fourth `.rls(...)` stage fits naturally next to `.attributes` and `.sql`.

### ✅ #5 — RLS predicate qualified-table semantics — **DECIDED: TS gets structured `ref()`; PSL stays verbatim in v0.1; interpolation is a stretch goal**

**Reframing.** The framework owns almost the entire `CREATE POLICY` statement. Crossed against the DSL:

| CREATE POLICY clause | Source | Owner |
|---|---|---|
| `<name>` | `policy.name` (TS) / declaration head ident (PSL) | framework |
| `ON <schema>.<table>` | model `namespace` + `.sql({ table })` | framework |
| `AS PERMISSIVE / RESTRICTIVE` | `policy.as` (default `permissive`) | framework |
| `FOR <op>` | `policy.operation` (TS) / `operation =` (PSL) | framework |
| `TO <roles>` | `policy.roles` | framework |
| `USING (...)` body | condition expression | **user** |
| `WITH CHECK (...)` body | condition expression | **user** |

The opaque surface is exactly two strings per policy. Most predicates name no table at all (they reference columns of the row in scope, plus functions like `auth.uid()`). The qualified-table problem only appears in **subquery predicates** that name *other* tables.

**Resolution (TS):** `using` and `withCheck` accept `string | ((ctx) => string)`. The context exposes a structured `ref(modelHandle)` helper that returns the canonical, quoted, namespace-qualified table identifier. Subqueries get rename-tracking for free; bare-column predicates stay one-line strings; the verbatim escape hatch remains available.

**Resolution (PSL):** v0.1 takes predicates **verbatim**. Authors use the schema-qualified name their migrations emit. Renames in `target =` don't auto-update subquery predicates. The structured analogue — `${ModelName}` and `${supabase:auth.User}` interpolation tokens inside string literals — is a **stretch goal**, not on the v0.1 critical path. New string-literal kind in the lexer is small but real grammar work.

The TS-gets-`ref()` / PSL-stays-verbatim split aligns with the framework's typical positioning: TS is the more expressive surface; PSL is the simpler, more restricted one. PSL users who hit rename pain in v0.1 can either move the contract to TS, or wait for the interpolation stretch.

#### Shape (TS)

```ts
type RlsPredicate =
  | string
  | ((ctx: RlsPredicateContext) => string);

type RlsPredicateContext = {
  /**
   * Returns the canonical, quoted, namespace-qualified identifier for a model's
   * table. Renames in `.sql({ table })` or model namespace propagate here.
   *
   * - Models in named namespaces:           `"public"."profile"`
   * - Models in `__unspecified__`:          `"profile"`  (bare; database resolves via search_path)
   * - Cross-contract models (handle from `extensionPacks`):
   *                                          `"auth"."users"`  (or bare if extension target is __unspecified__)
   */
  readonly ref: (modelHandle: ModelHandle) => string;
};
```

#### Authoring (TS)

The simple case stays a one-liner — no helper needed because there is no table reference:

```ts
.rls([
  {
    name: 'posts_select_published',
    operation: 'select',
    roles: [supabase.roles.anon, supabase.roles.authenticated],
    using: 'is_published = true',                              // no helper, no table ref
  },
  {
    name: 'profiles_insert_own',
    operation: 'insert',
    roles: [supabase.roles.authenticated],
    withCheck: 'user_id = (auth.uid())::uuid',                 // no helper, no table ref
  },
])
```

The subquery case takes the function form. The `ref()` helper is the only thing the framework intercepts; the rest of the string is whatever Postgres SQL the user wants:

```ts
.rls([
  {
    name: 'posts_update_own',
    operation: 'update',
    roles: [supabase.roles.authenticated],
    using:     ({ ref }) =>
      `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
    withCheck: ({ ref }) =>
      `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
  },
])
```

#### Authoring (PSL, v0.1)

Plain strings only. Authors type qualified names matching their migrations:

```psl
namespace public {
  policy posts_update_own {
    target = Post
    operation = update
    roles = [authenticated]
    using = "author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)"
    withCheck = "author_id IN (SELECT id FROM public.profile WHERE user_id = (auth.uid())::uuid)"
  }
}
```

A rename of `Profile.sql({ table })` from `'profile'` to `'user_profile'` leaves this predicate referencing the old name. v0.1 ships with that as a known trade-off; the interpolation stretch goal closes it.

If `Profile.sql({ table })` is renamed `'profile' → 'user_profile'`, or its namespace moves `'public' → 'tenant_a'`, the predicate updates automatically. The user never types `"public"."profile"`; the framework synthesises it at lowering time.

Cross-contract refs work the same way — `ref()` accepts any model handle the contract is allowed to reference:

```ts
using: ({ ref }) =>
  `tenant_id = (SELECT default_tenant FROM ${ref(supabaseContract.models.AuthUser)} WHERE id = (auth.uid())::uuid)`,
```

#### Why this beats "verbatim + lint"

- **Renames track.** No lint needed for the structured path — rename safety is provided by construction, not by best-effort pattern matching.
- **No diagnostic noise.** The "verbatim + lint" route had a `RLS_PREDICATE_UNKNOWN_TABLE` warning class fighting against the explicit-opt-in rule (`.agents/rules/explicit-opt-in-over-diagnostics.mdc`). Structured refs make the warning unnecessary.
- **The opaque surface narrows to exactly what it must.** Postgres SQL expression syntax inside the condition body is the only thing the framework still has to take on faith. Subexpressions like `auth.uid()`, `(value)::uuid`, `IN (...)`, `JSON_EXTRACT(...)` all stay valid; the framework intercepts table identifiers only.
- **No parser dependency.** `ref()` is a function call that returns a string at policy-build time. The framework never has to understand the SQL around it.
- **`__unspecified__` is automatic.** When a model lives in `__unspecified__`, `ref(Model)` returns the bare quoted name (`"profile"`); the database resolves via `search_path` at runtime. Matches the cross-namespace FK rule and the per-tenant migration story we already settled in TML-2459.

#### Implementation sketch

```ts
// packages/2-sql/2-authoring/contract-ts/src/rls/predicate.ts

import { quoteIdent } from '@prisma-next/sql-postgres/identifiers';

type ModelHandle = { readonly __name: string };

type LoweringContext = {
  readonly modelTable: (handle: ModelHandle) => { namespace: string; table: string };
  readonly currentTarget: 'postgres' | 'sqlite' | /* ... */;
};

export function buildRlsPredicateContext(lowering: LoweringContext): RlsPredicateContext {
  return {
    ref(handle) {
      const { namespace, table } = lowering.modelTable(handle);
      if (namespace === '__unspecified__') {
        return quoteIdent(table);
      }
      return `${quoteIdent(namespace)}.${quoteIdent(table)}`;
    },
  };
}

export function evaluateRlsPredicate(
  predicate: RlsPredicate,
  ctx: RlsPredicateContext,
): string {
  return typeof predicate === 'function' ? predicate(ctx) : predicate;
}
```

This is invoked once per `(model, operation, kind)` triple at lowering time, before the contract is serialized to JSON. The function form runs eagerly — the JSON contract holds resolved condition strings, not closures.

#### Open follow-ups (non-blocking)

- **Schema/column refs inside expressions.** The current `ref()` surface covers table identifiers. A predicate that wants to reference a *column* qualified by table (`p.user_id`) or a *function* by handle (`ref(supabaseContract.functions.uid)()`) is still raw. Add helpers if real predicates demand them. Not a v0.1 requirement — every real-world Supabase RLS example I checked uses bare column names plus `auth.uid()` / `auth.role()` literals.
- **Escape hatch.** Users who genuinely need a raw SQL fragment with table names baked in can keep using the string form. No diagnostic, no lint — their string, their consequences.

Touches: [`rls.md`](../rls.md) — record this design; remove the verbatim-plus-lint section.

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

### ✅ #15 — Function IR shape — CLOSED (out of scope for v0.1)

The example invented `functions: { <name>: { namespace, control, returns, args } }`. Closed by [`decisions.md` C4](../decisions.md): functions are not contract elements in v0.1. The four typical Supabase flows (FK to `auth.users` with cascade, server-generated UUIDs, RLS predicates using `auth.uid()`, column-default function invocations) map to existing mechanisms — cross-contract FK refs, the framework's `DefaultFunctionRegistry`, and opaque RLS predicate strings. The verifier never introspects `pg_proc`; missing functions surface as Postgres errors at migration / query time.

The example app's contract.json should drop the `functions` block entirely. Promoting functions to first-class IR pairs with the trigger work as a stretch goal; see [`overview.md`](../overview.md) "Stretch goals."

### ✅ #16 — Function-name canonicalization — CLOSED (moot)

Closed by #15. No function IR keys to canonicalize in v0.1.

### ✅ #17 — `TypedContract<T>` accessor surface — CLOSED (superseded by C5+C6+C7)

The original framing assumed extensions ship a generic `Contract` type spec and consumers' authoring DSL applies a `TypedContract<T>` mapped type to derive `.models.<Name>.refs.<field>` accessors at use-site. Closed by [`decisions.md` C5/C6/C7](../decisions.md):

- **C7**: extensions ship a pre-built `/contract` submodule with concrete typed handles (hand-written for v0.1; emitter-generated as roadmap). No consumer-side type-level lifting.
- **C6**: those handles are imported from `@prisma-next/extension-supabase/contract` directly; no `supabase.contract<C>(json)` runtime factory dance for authoring.
- **C5**: the same `/contract` builder exposes `roles.<name>` as branded `RoleRef`s — uniform with `models.<Name>.refs.<field>` shape.

The minimal new type-level work is: a single `ColumnRef<spaceId>` branded type (with `<self>` sentinel for local refs and concrete extension `spaceId`s for cross-contract refs) plus an extension to FK / relation call-site signatures. No mapped type required.

Touches: `cross-contract-refs.md`'s "What's the typed handle returned by `supabase.contract<C>(json)`?" open question — closed; there *is* no such factory in v0.1.

## Cross-cutting

### 🟡 #18 — Where the example app lives during shaping

Currently `projects/supabase-integration/example/`. Migrates to `examples/supabase/` at project close-out. Codify in the eventual project plan as a close-out task.

### ✅ #19 — RLS verifier check semantics — **DECIDED: content-addressed wire names**

**Resolution:** wire-level `policyname` carries an 8-hex SHA-256 suffix over the canonical content tuple `(canonical(using), canonical(withCheck), sort(roles), operation, as)`. Predicate equivalence collapses to a name match; the verifier never compares bodies for equivalence. One body-level check remains — the per-row tamper check that catches manual `ALTER POLICY` outside the framework.

This dissolves three earlier-open items into one mechanism:

- **Predicate equivalence noise** (the dominant concern when this hole was opened) → zero false positives by construction.
- **Policy rename detection** → free. Matching hash + different prefix is a structural signal; the planner emits `ALTER POLICY ... RENAME TO`.
- **Per-row body comparison** → reduced to one cheap hash recomputation per introspected row.

Three new target-side `SchemaIssue` kinds:

- `rls_policy_renamed` — matching hash, different prefix.
- `rls_policy_tampered` — suffix doesn't match a recomputed hash of the introspected body.
- `rls_not_enabled` — table has declared policies but `pg_class.relrowsecurity = false`.

Settled fields of the verifier loop:

- **Identity:** full wire name.
- **Body equivalence:** implicit in the suffix; no separate comparison.
- **Role-list ordering:** sorted before hashing; set semantics.
- **Missing policy:** error under `managed`, severity dispatched via control policy.
- **Extra policy:** governed by table's control policy (managed → error, tolerated → warn, external → ignored, observed → silent).

See [`decisions.md` C9 + C10](../decisions.md) and the design rationale in [`specs/adr-content-addressed-policy-names.md`](../specs/adr-content-addressed-policy-names.md).

Touches: [`rls.md`](../rls.md) §"Verifier behaviour" — rewritten to use the content-addressed model.

### 🟡 #20 — `supabase.pack()` vs `supabase()` shorthand

`extension-package.md` says `supabase()` is sugar for `supabase.pack()`. But `supabase` is also a namespace object (`supabase.contract`, `supabase.roles`). Making it callable requires either (a) `supabase` is `Callable & Namespace` (the JS idiom is awkward), or (b) drop the shorthand and always use `supabase.pack()`.

**Recommendation: drop the shorthand. Always `supabase.pack()`.** Removes one inconsistency, one tiny JS oddity. Consistent with the rest of the namespace API.

Touches: [`extension-package.md`](../extension-package.md) — remove the `supabase()` shorthand line.

## Summary of blocking holes

| # | Concern | Status | Resolution |
|---|---------|--------|-----------|
| 1 | RLS capability gate | ✅ Decided | No capability flag; target presence is the gate |
| 2 | `rlsPolicy(...)` injection point | ✅ Decided | Separate `.rls(...)` stage; array of named descriptors |
| 3 | `onDelete` on cross-contract FKs | ✅ Decided | Permit; no diagnostic (see `.agents/rules/explicit-opt-in-over-diagnostics.mdc`) |
| 4 | Composite/named uniques | ✅ Resolved | DSL already covers via `.attributes(...)`; example app was wrong |
| 5 | RLS predicate qualified-table semantics | ✅ Decided | TS gets `ref()`; PSL stays verbatim in v0.1 |
| 7 | `middleware` on SupabaseRuntimeOptions | 🔴 Open | Add it |
| 8 | Middleware ordering vs role-binding | 🔴 Open | User middleware outermost |
| 11 | Multi-statement transactions | 🔴 Open | `.transaction(async tx => …)` on each role-bound Db |
| 13 | JWT validation timing | 🔴 Open | Eager on `asUser(jwt)` |
| 14 | Implicit transaction for SET LOCAL | 🔴 Open | Every role-bound execute is in a txn |
| 15 | Function IR shape | ✅ Closed | Out of scope for v0.1; functions not contract elements (see decisions C4) |
| 17 | `TypedContract<T>` accessor shape | ✅ Closed | Superseded by C5+C6+C7; extensions ship pre-built `/contract` with concrete typed handles |
| 19 | RLS verifier check semantics | ✅ Decided | Content-addressed wire names (decisions C9 + C10); rename + tamper + equivalence all dissolve into name diff |

The remaining holes (🟡 / 🟢) are either default-able with working assumptions or pure cosmetics.
