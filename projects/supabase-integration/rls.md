# RLS policies as first-class IR

## Problem

Row-Level Security is the central reason teams pick Supabase. To support it well, RLS policies have to be *part of the contract* — typed, authored alongside the model they protect, versioned in migrations, and verified against the live database. The status quo (drop down to raw SQL in a migration file, lose all framework awareness) is exactly the friction we want to eliminate.

RLS is Postgres-only. It must be representable as a Postgres-target-only IR kind, not lifted to the framework or family level. TML-2459 establishes the 3-layer IR specifically to make this kind of target-only extension clean.

## Design intent

### Authoring surface

Policies are declared inline with the model they protect:

```ts
m.model('Profile', {
  namespace: 'public',
  fields: { /* … */ },
  constraints: (c) => [
    c.rlsPolicy({
      name: 'profiles_select_own',
      command: 'select',
      roles: [supabase.roles.authenticated],
      using: 'user_id = (auth.uid())::text',
    }),
    c.rlsPolicy({
      name: 'profiles_update_own',
      command: 'update',
      roles: [supabase.roles.authenticated],
      using: 'user_id = (auth.uid())::text',
      check: 'user_id = (auth.uid())::text',
    }),
  ],
});
```

Reasoning for inline-with-model placement:
- Policies are scoped to a single table; they don't make sense elsewhere.
- Co-locating with the model keeps the surface area discoverable. Users reviewing a model see its policies; they don't have to hunt a separate "policies" section.
- The `constraints` callback is the natural extension point because policies are, structurally, model-level constraints (just like check constraints and indexes).

`c.rlsPolicy(...)` is **target-conditioned**. It only appears in the constraints callback when the contract's active target is Postgres — TS surfaces this through conditional types tied to the contract's target. Authors targeting another database don't see the API.

### Predicate language for v0.1

**Plain strings.** The `using` and `check` clauses are raw SQL strings, validated by Postgres at migration time (which is when the policy is created). No `m.sql\`...\`` template tag for v0.1.

Rationale:
- Plain strings are honest: RLS predicates are inherently Postgres SQL, full of `auth.uid()` and friends. Pretending they're something more portable would be a lie.
- A typed template tag is real work (parser, type-aware completion, dialect awareness). It's the right *future* design, not the right v0.1 design.
- Postgres validates the predicate when the policy is created. Bad predicates fail fast at migration time, not at runtime.

The cost: predicates are not type-checked at authoring time. We accept this for v0.1.

### Role constants

The extension exports typed constants:

```ts
// @prisma-next/extension-supabase
export const supabase = {
  roles: {
    authenticated: 'authenticated',
    anon: 'anon',
    serviceRole: 'service_role',
  } as const,
  // …
};
```

Authors use these in `roles: [supabase.roles.authenticated]`. Plain string role names also work; the constants exist for discoverability and to typo-proof the common cases.

### Implicit `ENABLE ROW LEVEL SECURITY`

If a model declares at least one RLS policy, the planner implicitly emits `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for that table. The user doesn't have to declare it separately. This avoids the easy-to-make mistake of writing policies that aren't enforced because RLS isn't enabled.

There may be cases where a user wants RLS enabled but no policies declared yet (defensive default). For those, a model-level toggle:

```ts
m.model('Profile', {
  rls: 'enabled',  // explicit; default is 'auto' which infers from policy presence
  // …
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
  readonly command: 'select' | 'insert' | 'update' | 'delete' | 'all';
  readonly roles: readonly string[];
  readonly using: string | undefined;
  readonly check: string | undefined;
  readonly permissive: boolean;  // default true; restrictive is rare but supported
}
```

The policy hangs off `PostgresTable` (target-only IR class). It does not appear on the framework or family IR — there's no `Mongo*RlsPolicy`.

`PostgresTable` exposes its policies through a target-specific accessor:

```ts
class PostgresTable extends SqlTableBase {
  readonly rlsPolicies: readonly PostgresRlsPolicy[];
  // …
}
```

The framework IR doesn't know about RLS. Visitors over framework IR don't see policies. Postgres-target visitors (verifier, planner) do.

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

### Runtime interaction

The runtime side of RLS is in [`extension-package.md`](extension-package.md). The short version: the `supabase()` runtime facade sets `role` and `request.jwt.claims` session vars before executing each query, which is what makes `auth.uid()` resolve correctly inside policy predicates. The IR layer doesn't have to know about this.

## Open questions

- **Restrictive policies.** Postgres distinguishes `PERMISSIVE` (default) and `RESTRICTIVE` policies. We've sketched the IR field; do we surface `permissive: false` in the v0.1 authoring DSL? Working assumption: **yes, ship the field with default `true`.** It's one boolean.
- **Policy renames.** Postgres supports `ALTER POLICY … RENAME TO`. The diff algorithm needs to detect rename intent (same predicate + roles, different name) to avoid drop+create. This is the same general problem as detecting column renames; existing migration heuristics likely apply. **Defer the heuristic; ship drop+create for v0.1.**
- **`auth.uid()` typing.** Could we eventually expose `auth.uid()` as a typed function in a Postgres predicate DSL? Yes, but that's the `m.sql\`...\`` future work. Not v0.1.
- **Pre-defined Supabase policy patterns.** Things like "owner can read/write, anon can read public flag = true" are extremely common. Should the extension ship a "policy pack" of pre-canned policies? Working assumption: **no for v0.1 — keep the API surface minimal; revisit after user feedback.**
- **Cross-table policies (`USING` clauses that reference other tables).** Allowed by Postgres; allowed by our string-predicate v0.1 because we don't parse. The verifier doesn't need to know — diff is by name + canonical SQL string. No issue for v0.1.
