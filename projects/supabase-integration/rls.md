# RLS policies as first-class IR

Authoritative status of decisions reached during shaping is in [`decisions.md`](decisions.md). This document is the longer-form design narrative.

## Problem

Row-Level Security is the central reason teams pick Supabase. To support it well, RLS policies have to be *part of the contract* — typed, authored alongside (or near) the model they protect, versioned in migrations, and verified against the live database. The status quo (drop down to raw SQL in a migration file, lose all framework awareness) is exactly the friction we want to eliminate.

RLS is Postgres-only. It must be representable as a Postgres-target-only IR kind, not lifted to the framework or family level. TML-2459 establishes the 3-layer IR specifically to make this kind of target-only extension clean.

## Design intent

### Authoring surface — TypeScript

Policies are declared via a fourth staged-builder method on the model, alongside `.attributes(...)` and `.sql(...)`:

```ts
import { AuthUser, roles as supabaseRoles } from '@prisma-next/extension-supabase/contract';

const Profile = model('Profile', {
  namespace: 'public',
  fields: {
    id:       field.id.uuidv4(),
    userId:   field.uuid(),
    username: field.text(),
  },
})
  .relations({ user: rel.belongsTo(AuthUser, { from: 'userId', to: 'id' }) })
  .attributes(({ fields, constraints }) => ({
    uniques: [ constraints.unique(fields.userId, { name: 'profile_userId_unique' }) ],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'profile',
    foreignKeys: [
      constraints.foreignKey(cols.userId, AuthUser.refs.id, {
        name: 'profile_userId_fkey',
        onDelete: 'cascade',
      }),
    ],
  }))
  .rls([
    {
      name: 'profiles_select_anon_and_authed',
      operation: 'select',
      roles: [supabaseRoles.anon, supabaseRoles.authenticated],
      using: 'true',
    },
    {
      name: 'profiles_update_own',
      operation: 'update',
      roles: [supabaseRoles.authenticated],
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
    roles: [supabaseRoles.anon, supabaseRoles.authenticated],
    using: 'is_published = true',
  },
  {
    name: 'posts_update_own',
    operation: 'update',
    roles: [supabaseRoles.authenticated],
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
- **Roles** are bare identifiers (`[anon, authenticated, public]`), matching how Postgres treats role names and how the TS API's `supabaseRoles.<id>` resolves. Role names with special characters are out of scope for v0.1 PSL; escape to the TS API.
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

TS authors use `supabaseRoles.authenticated` (imported as `roles as supabaseRoles` from `@prisma-next/extension-supabase/contract`); plain string role names also work. The constants exist for discoverability and to typo-proof the common cases. PSL uses bare identifiers (`[anon, authenticated]`); the role-name resolution rules at lowering time accept any of: a bare identifier matching a known role, a quoted string, or a member of the imported `roles` constants.

### Implicit `ENABLE ROW LEVEL SECURITY`

Model-level `rls?: 'auto' | 'enabled' | 'disabled'`, default `'auto'` (per decision [C11](decisions.md)):

- **`'auto'`** (default) — infer from policy presence. Any declared policy on the model → `ENABLE ROW LEVEL SECURITY` at migration time. This avoids the easy mistake of writing policies that don't run because RLS isn't enabled.
- **`'enabled'`** — explicit defensive default. RLS on, no policies declared yet (denies all access). Useful for new tables that should never be readable until policies are added.
- **`'disabled'`** — explicit override. RLS off, even if policies are declared on the model. Useful for test fixtures and tables the framework deliberately leaves open.

```ts
m.model('Profile', {
  rls: 'enabled',
});
```

The planner emits `ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY` based on the resolved state; the verifier checks `pg_class.relrowsecurity` matches and emits `rls_not_enabled` on mismatch (see § "Verifier behaviour").

### Content-addressed wire names

Postgres reparses policy predicates at `CREATE POLICY` time and stores them via its expression printer, so introspected predicate bodies rarely match the authored body byte-for-byte even when the predicate is semantically unchanged — parens, whitespace, keyword casing, and cast forms (`auth.uid()::uuid` vs `(auth.uid())::uuid`) all drift through Postgres's renderer. The naive "match by `(schema, table, policy_name)` and compare bodies" verifier loop would surface false-positive `policy_mismatch` errors on nearly every real Supabase contract.

Decision [C9](decisions.md): **wire names carry a content hash.** Wire-level `policyname` in `pg_policies` has the form `<user_prefix>_<8 hex chars>`. The user types only the prefix; the framework computes the suffix as `SHA-256(canonical content tuple)[:8 hex]` at lowering time.

The canonical content tuple feeds five inputs:

1. `canonical(using)` — normalized `USING` body (whitespace collapsed, outer parens trimmed, keywords lowercased). Empty string if absent.
2. `canonical(withCheck)` — same normalization on the `WITH CHECK` body. Empty if absent.
3. `sort(roles)` — sorted, deduplicated. Postgres treats roles as a set.
4. `operation` — closed-set literal.
5. `as` — `'permissive' | 'restrictive'`.

Excluded: schema and table identity (orthogonal — `pg_policies.schemaname` / `tablename` carry them independently), and the user's prefix itself (it's a human label, not equivalence-bearing). Full design and consequences in [`specs/adr-content-addressed-policy-names.md`](specs/adr-content-addressed-policy-names.md).

Two structural properties fall out cheaply:

- **Equivalence is a name match.** The verifier never compares bodies for equivalence purposes; the suffix carries the equivalence relation by construction. Predicate-equivalence noise is eliminated.
- **Rename detection is free.** Matching hash with a different prefix is a structural signal that lets the planner emit `ALTER POLICY ... RENAME TO` instead of drop+create.

Duplicate prefixes within `(schema, table)` are a **lowering error**, even though wire names would be distinct by hash. This preserves the user's mental model that the prefix is the policy's logical identity.

### IR shape

A new target-only IR kind:

```ts
class PostgresRlsPolicy {
  readonly kind = 'PostgresRlsPolicy';
  readonly name: string;             // full wire name, e.g. 'profiles_select_anon_a3f1c8b2'
  readonly prefix: string;           // user-typed prefix, e.g. 'profiles_select_anon' (round-trip + diagnostics)
  readonly table: PostgresTableRef;
  readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'all';
  readonly roles: readonly string[];
  readonly using: string | undefined;
  readonly withCheck: string | undefined;
  readonly permissive: boolean;      // 'as' = permissive (true) | restrictive (false); default true
}
```

`name` is the full wire name (carries the content suffix). `prefix` is the user-typed label, retained for diagnostics (`'extra_rls_policy: …'` messages name the prefix, not the cryptic suffix) and for rename detection (matching hash + different prefix → ALTER RENAME).

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
- Present but not declared → DROP (under `control: 'managed'`).
- Present and declared with differences → ALTER (or DROP + CREATE if ALTER can't represent the change).

### Verifier behaviour

The Postgres schema verifier queries `pg_policies` (and `pg_class.relrowsecurity`) for each table in scope and diffs against the declared policies. Equivalence is decided by full-wire-name match (per the content-addressed naming above); only one body-level check is still performed — the tamper check.

Algorithm:

```text
For each (schema, table) in scope:
  declared      = lookup PostgresRlsPolicy[] from contract by table
  introspected  = SELECT * FROM pg_policies WHERE schemaname = ? AND tablename = ?

  // RLS-enabled state
  if declared has policies but pg_class.relrowsecurity = false:
    emit rls_not_enabled

  // Tamper check (one body-level inspection)
  for row in introspected:
    recomputed = hash(canonical(qual), canonical(with_check), sort(roles), cmd, permissive)
    if row.policyname.suffix != recomputed:
      emit rls_policy_tampered  // manual ALTER POLICY outside the framework

  // Name diff
  declared_names = set of declared.full_name
  introspected_names = set of introspected.policyname
  declared_only      = declared_names - introspected_names
  introspected_only  = introspected_names - declared_names

  // Rename detection: matching suffix, different prefix
  for d in declared_only:
    for i in introspected_only:
      if d.suffix == i.suffix and d.prefix != i.prefix:
        emit rls_policy_renamed  // planner: ALTER POLICY i.full RENAME TO d.full
        remove d, i from their sets

  // What's left after rename matching is genuine drift
  for d in declared_only:    emit missing_rls_policy
  for i in introspected_only: emit extra_rls_policy
```

Severity of `missing_rls_policy` and `extra_rls_policy` is governed by the table's [control policy](../control-policy/spec.md):

- **`managed`** — missing and extras are both errors. Exact match required.
- **`tolerated`** — missing is an error; extras warn.
- **`external`** — both are ignored. Used for tables the Supabase extension itself ships.
- **`observed`** — both are silent diagnostics surfaced only on explicit query.

`rls_policy_tampered`, `rls_policy_renamed`, and `rls_not_enabled` always surface as issues; their planner-side response is dispatch-driven (`ALTER POLICY ... RENAME TO`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, or a re-CREATE for tampered policies under `managed`).

The Supabase extension's own contract declares the policies it ships (if any) with `control: 'external'` at the contract level. App-author policies are `managed` by default.

This collapses three earlier open questions ([`example/design-holes.md` #19](example/design-holes.md), the policy-rename heuristic, and predicate-equivalence noise) into one decision recorded in [`decisions.md` C9 + C10](decisions.md). The full design rationale lives in [`specs/adr-content-addressed-policy-names.md`](specs/adr-content-addressed-policy-names.md).

### Runtime interaction

The runtime side of RLS is in [`extension-package.md`](extension-package.md). The short version: the `supabase()` runtime facade sets `role` and `request.jwt.claims` session vars before executing each query, which is what makes `auth.uid()` resolve correctly inside policy predicates. The IR layer doesn't have to know about this.

## Open questions

All blocking RLS design questions are settled. Remaining items below are either roadmap (capture-and-defer) or genuinely open in adjacent surfaces:

- **Pre-defined Supabase policy patterns** (roadmap). Things like "owner can read/write, anon can read public flag = true" are extremely common. Should the extension ship a "policy pack" of pre-canned policies? Working assumption: **no for v0.1 — keep the API surface minimal; revisit after user feedback.**
- **PSL `${...}` interpolation** (stretch goal). The PSL equivalent of TS's `ref(model)` helper. Tracked as [`decisions.md` OC3](decisions.md).
- **`policyGroup` for shared-target policies** (roadmap). Tracked as [`decisions.md` OC2](decisions.md).
- **Backport of content-addressed naming to indexes / functions / views** (roadmap). Tracked as [`decisions.md` OC4](decisions.md).

Closed during shaping:

- ~~**Restrictive policies.**~~ Settled as decisions [A8](decisions.md) (TS) + [B2](decisions.md) (PSL): `as` field, default `permissive`. Single enum.
- ~~**Policy renames.**~~ Closed by [C10](decisions.md): rename detection is structurally free under content-addressed naming. The verifier emits `rls_policy_renamed` when hash matches and prefix differs; the planner emits `ALTER POLICY ... RENAME TO`. The earlier "defer to v0.1; ship drop+create" working assumption is moot.
- ~~**Cross-table policies (subqueries that reference other tables).**~~ Supported via the `ref()` helper (TS) or verbatim qualified names (PSL). The verifier never inspects predicate structure — equivalence is hash-based per [C9](decisions.md).
- ~~**Verifier semantics for predicate equivalence.**~~ Closed by [C9 + C10](decisions.md). Predicate equivalence is decided by the content hash; no body comparison is performed except the per-row tamper check.
