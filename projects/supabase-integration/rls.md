# RLS policies as first-class IR

Authoritative status of decisions reached during shaping is in [`decisions.md`](decisions.md). This document is the longer-form design narrative.

## Problem

Row-Level Security is the central reason teams pick Supabase. To support it well, RLS policies have to be *part of the contract* — typed, authored alongside (or near) the model they protect, versioned in migrations, and verified against the live database. The status quo (drop down to raw SQL in a migration file, lose all framework awareness) is exactly the friction we want to eliminate.

RLS is Postgres-only. It must be representable as a Postgres-target-only IR kind, not lifted to the framework or family level. TML-2459 establishes the 3-layer IR specifically to make this kind of target-only extension clean.

## Design intent

### Authoring surface — TypeScript

Policies are declared via a fourth staged-builder method on the model, alongside `.attributes(...)` and `.sql(...)`:

```ts
const Profile = model('Profile', {
  namespace: 'public',
  fields: {
    id:       field.id.uuidv4(),
    userId:   field.uuid(),
    username: field.text(),
  },
})
  .relations({ user: rel.belongsTo(supabaseContract.models.AuthUser, { from: 'userId', to: 'id' }) })
  .attributes(({ fields, constraints }) => ({
    uniques: [ constraints.unique(fields.userId, { name: 'profile_userId_unique' }) ],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'profile',
    foreignKeys: [
      constraints.foreignKey(cols.userId, supabaseContract.models.AuthUser.refs.id, {
        name: 'profile_userId_fkey',
        onDelete: 'cascade',
      }),
    ],
  }))
  .rls([
    {
      name: 'profiles_select_anon_and_authed',
      operation: 'select',
      roles: [supabase.roles.anon, supabase.roles.authenticated],
      using: 'true',
    },
    {
      name: 'profiles_update_own',
      operation: 'update',
      roles: [supabase.roles.authenticated],
      using:     'user_id = (auth.uid())::uuid',
      withCheck: 'user_id = (auth.uid())::uuid',
    },
  ]);
```

**Why a separate `.rls(...)` stage and not inside `.sql(...)`:**

- The existing DSL has a clear split: `.attributes(...)` is target-agnostic structural concerns (`id`, `uniques`), `.sql(...)` is target-specific structural concerns (`indexes`, `foreignKeys`). RLS is a third concern that's structurally Postgres-specific but conceptually about *access control*, not table topology. Giving it its own stage keeps `.sql(...)` focused on schema topology.
- Pack-aware typing gates the method itself: `.rls(...)` is typed on `ContractModelBuilder` only when the target pack carries RLS support. Same mechanism `PackAwareSqlConstraints<IndexTypes>` uses today. **No capability flag is required** — target presence is the gate.

**Why an array of named descriptors and not a dict keyed by operation:**

A dict-keyed shape (`{ select: {...}, insert: {...} }`) was considered and rejected. It would have made the TS surface *more restricted* than PSL (where named-block policies naturally allow multiple permissive policies per operation), inverting the framework's typical positioning. The array form aligns TS with PSL and with Postgres's own permissive-policy composition semantics.

The operation is still a closed-set literal on each entry (`operation: 'select' | 'insert' | 'update' | 'delete' | 'all'`); the type system catches typos. Each policy carries its own name; duplicate names within the same model are detected at lowering time.

**Multiplicity is lenient.** Multiple permissive policies for the same operation are valid — Postgres ORs them; the framework emits N CREATE POLICY statements. A permissive policy plus a restrictive policy on the same operation compose Postgres-naturally (restrictive AND-combines with the OR of the permissives).

### Predicate language — TypeScript

`using` and `withCheck` accept `string | ((ctx) => string)`. Most predicates name no table at all (they reference columns of the row in scope plus functions like `auth.uid()`) and stay one-line strings. Subquery predicates that reference *other* tables take the function form, which exposes a `ref(modelHandle)` helper:

```ts
.rls([
  {
    name: 'posts_select_published',
    operation: 'select',
    roles: [supabase.roles.anon, supabase.roles.authenticated],
    using: 'is_published = true',
  },
  {
    name: 'posts_update_own',
    operation: 'update',
    roles: [supabase.roles.authenticated],
    using:     ({ ref }) =>
      `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
    withCheck: ({ ref }) =>
      `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
  },
]);
```

`ref(modelHandle)` returns the canonical quoted namespace-qualified identifier:

- Models in a named namespace: `"public"."profile"`.
- Models in `__unspecified__`: `"profile"` (bare; database resolves via `search_path` at migration time).
- Cross-contract models (handle from `extensionPacks`): `"auth"."users"` (or bare if the extension target is `__unspecified__`).

If `Profile.sql({ table })` is renamed `'profile' → 'user_profile'`, or its namespace moves, predicates using `ref(Profile)` update automatically. The framework intercepts the table-identifier slot only; the rest of the predicate stays whatever Postgres SQL the user wants. There is no parser dependency.

The verbatim escape hatch — `using: 'raw SQL with hardcoded "public"."profile"'` — stays available. Users who opt into that own the rename consequence (no diagnostic, by the [explicit-opt-in policy](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc)).

### Authoring surface — PSL

Policies are declared as top-level named-block declarations, scoped by the surrounding `namespace` block:

```psl
namespace public {
  model Profile {
    id       String @id @default(uuid())
    userId   String @unique
    username String @unique
    user     supabase:auth.User @relation(fields: [userId], references: [id], onDelete: Cascade)
  }

  policy profiles_select_anon_and_authed {
    target = Profile
    operation = select
    roles = [anon, authenticated]
    using = "true"
  }

  policy profiles_update_own {
    target = Profile
    operation = update
    roles = [authenticated]
    using     = "user_id = (auth.uid())::uuid"
    withCheck = "user_id = (auth.uid())::uuid"
  }
}
```

Grammar choices:

- **Head:** `policy <name> { body }` — existing PSL idiom (`model <Name> { ... }`, `enum <Name> { ... }`, `namespace <Name> { ... }`). Zero new declaration-head primitives.
- **Body:** `key = value` lines — the existing convention for *configuration-shaped* declarations (datasource, generator). Distinct from the `field Type @attrs...` body shape used for typed members like model fields. The two body-form pattern is an architectural observation deserving its own ADR; see [`decisions.md` OC1](decisions.md).
- **`as = restrictive`** is an optional body field; default `permissive`. Goes in the body rather than the head so the head is purely identity.
- **Roles** are bare identifiers (`[anon, authenticated, public]`), matching how Postgres treats role names and how the TS API's `supabase.roles.<id>` resolves. Role names with special characters are out of scope for v0.1 PSL; escape to the TS API.
- **Operation** is a closed-set identifier: `select | insert | update | delete | all`.

**Predicates are plain strings in v0.1 PSL.** Authors type schema-qualified names matching their migrations. Renames in `target = ...` don't auto-track inside subquery predicates. The TS surface's `ref()` helper has no PSL equivalent in v0.1 — the structured-interpolation analogue (`${ModelName}`, `${supabase:auth.User}` inside string literals) is a stretch goal. See [`decisions.md` OC3](decisions.md).

This is a deliberate asymmetry: TS is the more expressive surface, PSL the simpler restricted one. PSL users who hit rename pain in v0.1 either move the contract to TS or wait for the interpolation stretch.

**Cross-contract `target` is forbidden.** `target = supabase:auth.User` is a load-time error — Postgres won't let you `CREATE POLICY` on a table you don't own, and the grammar reflects that. Error message names the foreign contract space explicitly.

**Multiplicity is lenient.** Multiple permissive policies per `(target, operation)` are allowed when their PSL names differ. The framework emits N CREATE POLICY statements; Postgres ORs them. Duplicate policy names within `(namespace, target)` are a fail-fast load error.

**Namespace blocks are reopenable** (per TML-2459); policies and models can live in separate PSL files within the same namespace. Resolution joins them at load time. This is the property that lets `models/profile.psl` declare the model and `policies/profile.psl` declare its policies as physically separate files — one of the chief reasons we picked top-level `policy` declarations over inline `@@rls(...)` block attributes.

### Future ergonomics — `policyGroup`

When real Supabase contracts reveal repetition pain across policies sharing the same target, the natural extension is a `policyGroup` form that hoists shared properties:

```psl
policyGroup UserPolicies {
  target = User

  policy anyone_can_read { operation = select, roles = [anon, authenticated], using = "true" }
  policy owner_can_update { operation = update, roles = [authenticated], using = "user_id = (auth.uid())::uuid" }
}
```

Deferred from v0.1 — premature without real usage. Captured here so the future addition stays additive rather than breaking. See [`decisions.md` OC2](decisions.md).

### Role constants

The extension exports typed constants:

```ts
export const supabase = {
  roles: {
    authenticated: 'authenticated',
    anon: 'anon',
    serviceRole: 'service_role',
  } as const,
};
```

TS authors use `supabase.roles.authenticated`; plain string role names also work. The constants exist for discoverability and to typo-proof the common cases. PSL uses bare identifiers (`[anon, authenticated]`); the role-name resolution rules at lowering time accept any of: a bare identifier matching a known role, a quoted string, or a member of `supabase.roles`.

### Implicit `ENABLE ROW LEVEL SECURITY`

If a model declares at least one RLS policy, the planner implicitly emits `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for that table. The user doesn't declare it separately. This avoids the easy-to-make mistake of writing policies that aren't enforced because RLS isn't enabled.

For models that want RLS enabled but no policies declared yet (defensive default), a model-level toggle:

```ts
m.model('Profile', {
  rls: 'enabled',  // explicit; default is 'auto' which infers from policy presence
});
```

Working assumption: default = `auto` (infer from policy presence), with `enabled` / `disabled` overrides available.

### IR shape

A new target-only IR kind:

```ts
class PostgresRlsPolicy {
  readonly kind = 'PostgresRlsPolicy';
  readonly name: string;
  readonly table: PostgresTableRef;
  readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'all';
  readonly roles: readonly string[];
  readonly using: string | undefined;
  readonly withCheck: string | undefined;
  readonly permissive: boolean;  // default true; restrictive is rare but supported
}
```

The policy hangs off `PostgresTable` (target-only IR class). It does not appear on the framework or family IR — there's no `Mongo*RlsPolicy`.

`PostgresTable` exposes its policies through a target-specific accessor:

```ts
class PostgresTable extends SqlTableBase {
  readonly rlsPolicies: readonly PostgresRlsPolicy[];
}
```

The framework IR doesn't know about RLS. Visitors over framework IR don't see policies. Postgres-target visitors (verifier, planner) do.

The IR holds *resolved* predicate strings — function-form predicates (`({ ref }) => ...` in TS) are evaluated once at lowering time, with `ref(...)` resolving to the canonical quoted identifier; the resulting string is stored. The IR is JSON-canonical; closures never persist.

### Migration ops

RLS policy lifecycle ops, modeled as `OpFactoryCall`s (consistent with ADR 195):

- `CreatePostgresRlsPolicyOp` → `CREATE POLICY "<name>" ON "<schema>"."<table>" …`
- `DropPostgresRlsPolicyOp` → `DROP POLICY "<name>" ON "<schema>"."<table>"`
- `AlterPostgresRlsPolicyOp` → `ALTER POLICY "<name>" ON "<schema>"."<table>" …` (rename, role change, predicate change — Postgres supports most of these in-place; full rewrites fall back to drop + create)
- `EnableRowLevelSecurityOp` / `DisableRowLevelSecurityOp` (target-only ops)

The diff algorithm compares declared policies (by name) against introspected policies (from `pg_policies`):

- Declared but not present → CREATE.
- Present but not declared → DROP (under `modeled` posture).
- Present and declared with differences → ALTER (or DROP + CREATE if ALTER can't represent the change).

### Verifier behaviour

The Postgres schema verifier queries `pg_policies` for each table in scope, builds an IR-shape representation of the existing policies, and diffs against the declared policies. Diff outcomes feed the same posture dispatch table from [`posture.md`](posture.md):

- `modeled` policies must exactly match.
- `tolerated` policies must match the declared set; extra policies on the introspected side are allowed.
- `externally-managed` policies are checked for presence + compatible shape only.

The Supabase extension's own contract declares the policies it ships (if any) as `externally-managed` at the contract level. App-author policies are `modeled` by default.

The detailed semantics of "exactly match" (predicate equivalence, role-list ordering, missing/extra policy responses) is captured as an open hole — see [`example/design-holes.md` #19](example/design-holes.md).

### Runtime interaction

The runtime side of RLS is in [`extension-package.md`](extension-package.md). The short version: the `supabase()` runtime facade sets `role` and `request.jwt.claims` session vars before executing each query, which is what makes `auth.uid()` resolve correctly inside policy predicates. The IR layer doesn't have to know about this.

## Open questions

- **Restrictive policies.** Postgres distinguishes `PERMISSIVE` (default) and `RESTRICTIVE` policies. Decided: ship `as: 'permissive' | 'restrictive'` (TS) / `as = permissive|restrictive` (PSL) with default `permissive`. One enum field.
- **Policy renames.** Postgres supports `ALTER POLICY … RENAME TO`. The diff algorithm needs to detect rename intent (same predicate + roles, different name) to avoid drop+create. This is the same general problem as detecting column renames; existing migration heuristics likely apply. **Defer the heuristic; ship drop+create for v0.1.**
- **Pre-defined Supabase policy patterns.** Things like "owner can read/write, anon can read public flag = true" are extremely common. Should the extension ship a "policy pack" of pre-canned policies? Working assumption: **no for v0.1 — keep the API surface minimal; revisit after user feedback.**
- **Cross-table policies (subqueries that reference other tables).** Allowed by Postgres; supported in v0.1 via the `ref()` helper (TS) or verbatim qualified names (PSL). The verifier doesn't need to know — diff is by name + canonical SQL string.
- **PSL `${...}` interpolation.** Stretch goal. See [`decisions.md` OC3](decisions.md).
- **Verifier semantics for predicate equivalence.** See [`example/design-holes.md` #19](example/design-holes.md).
