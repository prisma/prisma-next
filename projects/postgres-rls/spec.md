# Summary

Row-Level Security is the central reason teams pick Supabase, but it's also a generic Postgres feature that any app authoring against Postgres can benefit from. This project introduces RLS policies and Postgres roles as **first-class target-only IR kinds**, with an authoring surface in both TypeScript (a fourth `.rls(...)` staged-builder method on the model) and PSL (top-level `policy <name> { … }` blocks scoped by namespace). Wire-level policy names are **content-addressed** — the user types a prefix, the framework appends an 8-hex SHA-256 suffix over a canonical normalization of the policy body — so the verifier never has to compare reparsed predicate strings, and policy renames are structurally free. Migration ops follow ADR 195's `OpFactoryCall` recipe. The verifier introspects `pg_policies` + `pg_roles` + `pg_class.relrowsecurity` and surfaces three new target-side issue kinds (`rls_policy_renamed`, `rls_policy_tampered`, `rls_not_enabled`). The IR is Postgres-only; the framework and SQL family layers stay unaware of RLS. Runtime session-var injection (`SET LOCAL role = …; SET LOCAL request.jwt.claims = …`) is out of scope and handled by the parallel [runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) project.

# Context

## At a glance

PSL authoring — top-level `policy <name> { … }` blocks live in the same namespace as the model they target:

```prisma
namespace public {
  model Profile {
    id       String @id @default(uuid())
    userId   String @unique
    username String @unique
  }

  policy profiles_select_anon_and_authed {
    target    = Profile
    operation = select
    roles     = [anon, authenticated]
    using     = "true"
  }

  policy profiles_update_own {
    target    = Profile
    operation = update
    roles     = [authenticated]
    using     = "user_id = (auth.uid())::uuid"
    withCheck = "user_id = (auth.uid())::uuid"
  }
}
```

TypeScript authoring — `.rls(...)` is a fourth staged method on the model builder, alongside the existing `.attributes(...)` and `.sql(...)`. The TS surface adds one capability the PSL surface does not have: function-form `using` / `withCheck` predicates that interpolate other model handles via a `ref()` helper, so policy bodies that reference another table track table/namespace renames automatically.

```ts
const Profile = model('Profile', {
  namespace: 'public',
  rls: 'auto',  // default — infer from policy presence
  fields: { id: field.id.uuidv4(), userId: field.uuid(), username: field.text() },
})
  .relations({ user: rel.belongsTo(AuthUser, { from: 'userId', to: 'id' }) })
  .attributes(({ fields, constraints }) => ({
    uniques: [constraints.unique(fields.userId, { name: 'profile_userId_unique' })],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'profile',
    foreignKeys: [constraints.foreignKey(cols.userId, AuthUser.refs.id, { name: 'profile_userId_fkey', onDelete: 'cascade' })],
  }))
  .rls([
    {
      name: 'profiles_select_anon_and_authed',
      operation: 'select',
      roles: [anon, authenticated],
      using: 'true',
    },
    {
      name: 'profiles_update_own',
      operation: 'update',
      roles: [authenticated],
      using:     'user_id = (auth.uid())::uuid',
      withCheck: 'user_id = (auth.uid())::uuid',
    },
    {
      name: 'posts_update_authored_only',
      operation: 'update',
      roles: [authenticated],
      using: ({ ref }) =>
        `author_id IN (SELECT id FROM ${ref(Profile)} WHERE user_id = (auth.uid())::uuid)`,
    },
  ]);
```

Lowered DDL emitted by the planner:

```sql
ALTER TABLE "public"."profile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_anon_and_authed_a3f1c8b2"
  ON "public"."profile" AS PERMISSIVE FOR SELECT
  TO anon, authenticated
  USING (true);
CREATE POLICY "profiles_update_own_7c4e91d6"
  ON "public"."profile" AS PERMISSIVE FOR UPDATE
  TO authenticated
  USING (user_id = (auth.uid())::uuid)
  WITH CHECK (user_id = (auth.uid())::uuid);
```

The user types the prefix (`profiles_select_anon_and_authed`); the framework appends `_a3f1c8b2` — the first 8 hex chars of SHA-256 over the canonical content tuple `(canonical(using), canonical(withCheck), sort(roles), operation, as)`. This is the load-bearing trick that makes the verifier robust to Postgres's expression-printer reformatting.

## Problem

Three concrete problems motivate this project:

**1. RLS is the load-bearing piece of Supabase UX, and today it has no representation in the framework.** A user can declare their tables, their FKs, their indexes, and their migrations through Prisma Next — but the moment they need a policy, they drop into a raw SQL migration and lose all framework awareness: no type-checking of policy targets, no verifier validation against the live database, no rename detection, no drift reporting. RLS is also broadly useful outside Supabase — anyone implementing tenant isolation, role-based read filtering, or audit-log immutability in Postgres needs it. Treating RLS as "a SQL escape hatch the framework doesn't see" leaves a primary Postgres feature unmodeled in a framework whose entire premise is "your contract is the schema."

**2. The verifier's natural shape — match-by-name, compare bodies — fights Postgres's behaviour.** Postgres reparses policy predicates at `CREATE POLICY` time and stores them via its expression printer. The introspected body rarely matches the authored body byte-for-byte: parentheses get added or removed, whitespace collapses, keywords lowercase, cast forms drift (`auth.uid()::uuid` becomes `(auth.uid())::uuid` or vice versa). A naive byte-comparison verifier would surface `policy_mismatch` on nearly every real-world contract, every build, with no actionable signal — exactly the false-positive-fatigue failure mode the framework's diagnostic philosophy works to prevent. Worse, structural changes (e.g. a policy semantically renamed but bodily identical) would either be misidentified as drift or be silently lost, depending on how the matcher is tuned.

**3. There's no clean home for RLS-shaped IR in the pre-TML-2459 framework.** RLS is structurally Postgres-only — Mongo has no equivalent, SQLite has no equivalent — and there's no way to put a `RlsPolicy` node into the IR today without either (a) lifting an empty RLS interface to the framework (every non-Postgres family carries an unused concept) or (b) wedging policies into the existing `annotations: SqlAnnotations` escape hatch (opaque, lossy, no type safety, no first-class verifier dispatch). TML-2459's target-only IR kind pattern is the missing seam; this project is its canonical user.

## Approach

### Three load-bearing pieces

The project ships three pieces, each independent in scope but useless without the others:

- **A target-only IR for policies and roles** (`PostgresRlsPolicy`, `PostgresRole`) hanging off `PostgresTable` / `PostgresStorage` with no framework or family counterpart. The framework verifier dispatches via the Postgres target's `SchemaVerifier`, which walks these classes natively.
- **A content-addressed wire-naming scheme** (`<user_prefix>_<8 hex chars>`) that moves the verifier's equivalence relation from "compare reparsed bodies" to "compare hash suffixes." Designed once for policies; reusable for any Postgres object whose body is reparsed at storage time (indexes, functions, views — see [`specs/adr-content-addressed-policy-names.md`](specs/adr-content-addressed-policy-names.md) § "Forward applicability").
- **An authoring surface in both TS and PSL** — pack-aware-typed `.rls([…])` builder method on the model (TS) and top-level `policy <name> { … }` block declarations in the surrounding namespace (PSL). The surface admits both string and function-form predicates (TS) and verbatim string predicates (PSL).

### Target-only IR (Postgres-only)

The framework IR doesn't know about RLS. Visitors over framework IR don't see policies. Postgres-target visitors (verifier, planner, introspector) do. This is the canonical application of TML-2459's "target adds an IR node kind with no family-level counterpart" extension point.

```ts
// Illustrative — exact field shapes up to the implementer
class PostgresRlsPolicy {
  readonly kind = 'PostgresRlsPolicy';
  readonly name: string;                                    // full wire name, e.g. 'profiles_select_anon_a3f1c8b2'
  readonly prefix: string;                                  // user-typed prefix, e.g. 'profiles_select_anon'
  readonly table: PostgresTableRef;
  readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'all';
  readonly roles: readonly PostgresRoleRef[];
  readonly using: string | undefined;
  readonly withCheck: string | undefined;
  readonly permissive: boolean;                             // 'as' = permissive (true) | restrictive (false); default true
}

class PostgresRole {
  readonly kind = 'PostgresRole';
  readonly name: string;                                    // wire-level role name; matches pg_roles.rolname
  readonly namespace: NamespaceCoordinate;                  // typically __unspecified__ — Postgres roles are cluster-scoped, not schema-scoped
  // Future: privileges, attributes (LOGIN, INHERIT, REPLICATION, …). Out of v0.1 scope.
}

class PostgresTable extends SqlTableBase {
  // Existing fields...
  readonly rls: 'auto' | 'enabled' | 'disabled';            // model-level toggle; default 'auto'
  readonly rlsPolicies: readonly PostgresRlsPolicy[];       // empty array if no policies declared
}
```

Both classes are JSON-canonical per ADR 192 — plain readonly fields, kind discriminant, frozen instances, no `toJSON()`. The `PostgresRoleRef` shape carries `(namespace.id, name)` and is consumed by the planner's `TO <roles>` clause emission.

### Authoring — TypeScript

`.rls(...)` is a fourth staged-builder method on the model, alongside `.attributes(...)` and `.sql(...)`. Pack-aware typing makes the method visible on `ContractModelBuilder` only when the contract targets Postgres — same mechanism `PackAwareSqlConstraints<IndexTypes>` uses today. **No capability flag is required; target presence is the gate.**

The argument shape is `Array<PolicyDescriptor>`, not a dict keyed by operation. The earlier dict-keyed shape was rejected on the basis that it would have made the TS surface *more restricted* than PSL (where named-block policies naturally allow multiple permissive policies per operation), inverting the framework's typical "TS is the more expressive surface, PSL the simpler restricted one" stance.

Each descriptor carries `{ name, operation, roles, using?, withCheck?, as? }`. `operation` is a closed literal (`'select' | 'insert' | 'update' | 'delete' | 'all'`); `as` defaults to `'permissive'`. Duplicate `name` within the same model is a lowering error.

`using` and `withCheck` accept `string | ((ctx) => string)`. The function form's context exposes a single helper, `ref(modelHandle): string`, returning the canonical quoted namespace-qualified identifier:

- Models in a named namespace: `"public"."profile"`.
- Models in `__unspecified__`: `"profile"` (bare; the database resolves via `search_path` at migration time).
- Cross-contract models (handle from `extensionPacks`, resolved via the parallel [cross-contract-refs](../cross-contract-refs/spec.md) project): `"auth"."users"` (or bare if the extension target is `__unspecified__`).

If `Profile.sql({ table })` is renamed `'profile' → 'user_profile'`, or its namespace moves, predicates using `ref(Profile)` update automatically at lowering time. The framework intercepts the table-identifier slot only; the rest of the predicate stays whatever Postgres SQL the user wants. There is no SQL parser dependency.

The verbatim escape hatch — `using: 'raw SQL with hardcoded "public"."profile"'` — stays available. Users who opt into that own the rename consequence: no diagnostic, per the repo-wide [explicit-opt-in-over-diagnostics policy](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc).

### Authoring — PSL

Policies are top-level named-block declarations scoped by the surrounding `namespace` block. Body fields are `key = value` lines — the existing PSL configuration-block convention used by datasource and generator blocks. The two body forms (`field Type @attrs...` for typed members, `key = value` for instance-level static configuration) coexist in PSL but never in the same block; the architectural observation is captured as offcut **OC1** in the umbrella decisions log and gets a dedicated ADR alongside this project.

Grammar:

```
policy_decl ::= 'policy' <name> '{' policy_body '}'
policy_body ::= ( policy_field )*
policy_field ::= 'target'    '=' <model_ident>
              |  'operation' '=' ('select' | 'insert' | 'update' | 'delete' | 'all')
              |  'roles'     '=' '[' <role_ident> (',' <role_ident>)* ']'
              |  'using'     '=' <string_literal>
              |  'withCheck' '=' <string_literal>
              |  'as'        '=' ('permissive' | 'restrictive')
```

Three properties of the design:

- **Cross-contract `target` is forbidden.** `target = supabase:auth.User` is a load-time error — Postgres won't let you `CREATE POLICY` on a table you don't own, and the grammar reflects that. The error message names the foreign contract space explicitly.
- **Predicates are verbatim strings in v0.1.** Authors type schema-qualified names matching their migrations. Renames in `target = ...` don't auto-track inside subquery predicates. The TS surface's `ref()` helper has no PSL equivalent in v0.1; the structured-interpolation analogue (`${ModelName}`, `${supabase:auth.User}` inside string literals) is a stretch goal captured as offcut **OC3** in the umbrella decisions log.
- **Namespace blocks are reopenable** (per TML-2459); policies and models can live in separate PSL files within the same namespace. Resolution joins them at load time. This is what lets `models/profile.psl` declare the model and `policies/profile.psl` declare its policies as physically separate files — the chief reason the design picks top-level `policy` blocks over inline `@@rls(...)` block attributes.

Multiplicity is lenient in both surfaces: multiple permissive policies per `(target, operation)` are allowed when their names differ. The framework emits N `CREATE POLICY` statements; Postgres ORs them at evaluation time. Duplicate policy names within `(namespace, target)` are a fail-fast load error.

### Roles as first-class IR

Roles are a sibling target-only IR kind to RLS policies. Declaring a role in the contract gives the framework everything it needs to verify the role exists (via `pg_roles`) and emit `CREATE POLICY ... TO <roles>` clauses that name them.

For v0.1, role declarations are minimal: name + namespace coordinate (typically `__unspecified__` since Postgres roles are cluster-scoped, not schema-scoped). Role attributes (`LOGIN`, `INHERIT`, `REPLICATION`, password hashes, membership graphs) are deferred — they're the surface where the framework starts owning production database identities, which is a Pandora's box best opened in a separate project.

Roles can be declared with any control policy (see [control-policy](../control-policy/spec.md)). The Supabase extension (in the separate [extension-supabase](../extension-supabase/spec.md) project) declares the standard Supabase role set (`anon`, `authenticated`, `service_role`, etc.) with `control: 'external'` — verified to exist, not created. App-author roles declared with `control: 'managed'` will eventually trigger `CREATE ROLE` / `DROP ROLE` planner ops (also out of v0.1 scope — see Non-goals).

Role authoring surface — TS exports branded `RoleRef`s from the `/contract` subpath; PSL accepts bare identifiers in `roles = [...]` lists, resolved against the loaded contract aggregate at lowering time.

### Implicit `ENABLE ROW LEVEL SECURITY`

Model-level `rls?: 'auto' | 'enabled' | 'disabled'`, default `'auto'`:

- **`'auto'`** — infer from policy presence. Any declared policy on the model triggers `ENABLE ROW LEVEL SECURITY` at migration time. The default-on-by-presence rule avoids the easy mistake of writing policies that don't run because RLS isn't enabled.
- **`'enabled'`** — explicit defensive default. RLS on, even with no policies declared. The table denies all access by default; useful for new tables that should never be readable until policies are added.
- **`'disabled'`** — explicit override. RLS off, even if policies are declared on the model. Useful for test fixtures and tables the framework deliberately leaves open.

The planner emits `ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY` based on the resolved state; the verifier checks `pg_class.relrowsecurity` matches and surfaces `rls_not_enabled` on mismatch.

### Content-addressed wire names

The single most load-bearing decision in this project: wire-level `policyname` in `pg_policies` has the form `<user_prefix>_<8 hex chars>`. The user types only the prefix; the framework computes the suffix as `SHA-256(canonical content tuple)[:8 hex]` at lowering time.

The canonical content tuple feeds five inputs:

1. `canonical(using)` — normalized `USING` body (whitespace collapsed, outer parens trimmed, keywords lowercased). Empty string if absent.
2. `canonical(withCheck)` — same normalization on the `WITH CHECK` body. Empty if absent.
3. `sort(roles)` — sorted, deduplicated. Postgres treats roles as a set.
4. `operation` — closed-set literal.
5. `as` — `'permissive' | 'restrictive'`.

Excluded: schema and table identity (orthogonal — `pg_policies.schemaname` / `tablename` carry them independently), and the user's prefix itself (it's a human label, not equivalence-bearing).

Two structural properties fall out cheaply:

- **Equivalence is a name match.** The verifier never compares bodies for equivalence purposes; the suffix carries the equivalence relation by construction. Predicate-equivalence noise — the dominant v0.1 false-positive class under a body-comparison verifier — is eliminated.
- **Rename detection is free.** Matching hash with a different prefix is a structural signal: the planner emits `ALTER POLICY ... RENAME TO` rather than drop + create.

Duplicate prefixes within `(schema, table)` are a **lowering error**, even though wire names would be distinct by hash. This preserves the user's mental model that the prefix is the policy's logical identity.

Full design and rationale: [`specs/adr-content-addressed-policy-names.md`](specs/adr-content-addressed-policy-names.md).

### Migration ops

RLS policy lifecycle ops, modeled as `OpFactoryCall`s per ADR 195:

- `CreatePostgresRlsPolicyOp` → `CREATE POLICY "<name>" ON "<schema>"."<table>" AS <permissive|restrictive> FOR <op> TO <roles> [USING (…)] [WITH CHECK (…)]`.
- `DropPostgresRlsPolicyOp` → `DROP POLICY "<name>" ON "<schema>"."<table>"`.
- `AlterPostgresRlsPolicyOp` → `ALTER POLICY "<name>" ON "<schema>"."<table>" …`. Postgres supports in-place `ALTER POLICY ... RENAME TO`, role change, and predicate change for some shapes; full rewrites fall back to drop + create.
- `EnableRowLevelSecurityOp` / `DisableRowLevelSecurityOp` (target-only ops).

The diff algorithm compares declared policies (by full wire name) against introspected policies. The full-wire-name comparison is exact equivalence (per the content-addressed naming above).

### Verifier behaviour

The Postgres schema verifier queries `pg_policies`, `pg_roles`, and `pg_class.relrowsecurity` for each table in scope and diffs against the declared policies and roles.

Algorithm:

```text
For each (schema, table) in scope:
  declared      = lookup PostgresRlsPolicy[] from contract by table
  introspected  = SELECT * FROM pg_policies WHERE schemaname = ? AND tablename = ?

  # RLS-enabled state
  if declared has policies but pg_class.relrowsecurity = false:
    emit rls_not_enabled

  # Tamper check (one body-level inspection)
  for row in introspected:
    recomputed = hash(canonical(qual), canonical(with_check), sort(roles), cmd, permissive)
    if row.policyname.suffix != recomputed:
      emit rls_policy_tampered

  # Name diff
  declared_names      = set of declared.full_name
  introspected_names  = set of introspected.policyname
  declared_only       = declared_names - introspected_names
  introspected_only   = introspected_names - declared_names

  # Rename detection: matching suffix, different prefix
  for d in declared_only:
    for i in introspected_only:
      if d.suffix == i.suffix and d.prefix != i.prefix:
        emit rls_policy_renamed
        remove d, i from their sets

  for d in declared_only:    emit missing_rls_policy
  for i in introspected_only: emit extra_rls_policy

For each declared PostgresRole:
  if not in pg_roles: emit missing_role  (severity per control policy)
```

Severity of `missing_rls_policy` / `extra_rls_policy` / `missing_role` is governed by the corresponding table's or role's [control policy](../control-policy/spec.md) — `managed` errors on both, `tolerated` warns on extras, `external` ignores both, `observed` surfaces silently. `rls_policy_tampered`, `rls_policy_renamed`, and `rls_not_enabled` always surface as issues; their planner-side response is dispatch-driven (`ALTER POLICY ... RENAME TO`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, or a re-CREATE for tampered policies under `managed`).

The verifier extends the existing `SchemaIssue` union target-side with three new kinds: `rls_policy_renamed`, `rls_policy_tampered`, `rls_not_enabled`. Per TML-2459's "forward note on `SchemaIssue` layering," target-specific issue kinds are widened target-side and the framework `SchemaIssue` type stays as-is.

### Composition with control policy

Every RLS introspection check is severity-gated by the corresponding table's or role's control policy. The runtime composition is intentional: this project consumes the [control-policy](../control-policy/spec.md) primitive; it does not reinvent it. App-authored policies default to `managed`. Extension-shipped policies (the Supabase extension may ship pre-canned policies in a future project — out of v0.1 scope for this project) carry `control: 'external'`.

### Composition with cross-contract refs

The TS `ref(modelHandle)` helper accepts any branded model handle — local or cross-contract. When the handle's brand says "this is from contract space `supabase`," `ref()` returns the qualified identifier per the cross-contract namespace coordinate. The composition is mechanical and adds no new IR shape to this project — the [cross-contract-refs](../cross-contract-refs/spec.md) project's brand machinery is consumed transparently.

The PSL surface deliberately does *not* admit cross-contract `target = supabase:auth.User` (per the "policies can only attach to tables you own" rule above), so cross-contract integration is TS-only in v0.1.

# Requirements

## Functional Requirements

### IR

- **FR1.** `PostgresRlsPolicy` is introduced as a Postgres-target-only IR kind hanging off `PostgresTable`. The class extends `SchemaNodeBase` (per TML-2459); fields are JSON-canonical readonly properties.
- **FR2.** `PostgresRole` is introduced as a Postgres-target-only IR kind hanging off `PostgresStorage`. The class extends `SchemaNodeBase`. Field set is minimal for v0.1: `name`, `namespace` (typically `__unspecified__`).
- **FR3.** `PostgresTable` gains a `rls: 'auto' | 'enabled' | 'disabled'` field (default `'auto'`) and a `rlsPolicies: readonly PostgresRlsPolicy[]` field (default empty).
- **FR4.** Neither the framework nor the SQL family IR layers carry RLS concepts. Visitors over framework / family IR don't see policies. Postgres-target visitors do.

### Content-addressed naming

- **FR5.** Wire-level policy names take the form `<user_prefix>_<8 hex chars>`. The suffix is the first 8 hex chars of `SHA-256(canonical content tuple)`. The canonical content tuple is `(canonical(using), canonical(withCheck), sort(roles), operation, as)`. Schema and table are excluded from the tuple.
- **FR6.** The canonical normalizer for `using` / `withCheck` collapses whitespace, trims outer parentheses, and lowercases keywords. The normalizer is target-internal; its exact output never leaks beyond the hash input.
- **FR7.** `contract.json` carries the full wire name (`name` field on `PostgresRlsPolicy`); the user-typed prefix (`prefix` field) is preserved separately for diagnostics and rename detection.
- **FR8.** Duplicate prefixes within `(schema, table)` are a fail-fast lowering error, even when wire names would differ by hash.

### Authoring — TypeScript

- **FR9.** `.rls(...)` is the fourth named stage on the model builder, alongside `.attributes(...)` and `.sql(...)`. Pack-aware typing exposes it only when the contract targets Postgres.
- **FR10.** The argument is `Array<PolicyDescriptor>`. Each descriptor carries `{ name: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'all', roles: readonly RoleRef[], using?: PredicateValue, withCheck?: PredicateValue, as?: 'permissive' | 'restrictive' }`. `as` defaults to `'permissive'`. Duplicate `name` within the same model is a lowering error.
- **FR11.** `PredicateValue = string | ((ctx: { ref: (handle: ModelHandle) => string }) => string)`. The function form is evaluated once at lowering time; the resulting string is stored in the IR.
- **FR12.** `ref(modelHandle)` returns the canonical quoted namespace-qualified identifier — `"<schema>"."<table>"` for named namespaces, bare `"<table>"` for `__unspecified__` targets, cross-contract-qualified identifier for handles from `extensionPacks`. The lowering pass surfaces a clear diagnostic if `ref` is called with an undeclared handle.
- **FR13.** The model-level `rls` field (`'auto' | 'enabled' | 'disabled'`) is exposed on `model(name, config)`. Default `'auto'`.
- **FR14.** Role references in policies are typed `RoleRef`s, not bare strings. The TS surface accepts both branded `RoleRef` values and bare strings (lowered to refs against the loaded contract aggregate); the type system encourages refs.

### Authoring — PSL

- **FR15.** PSL gains a top-level `policy <name> { … }` block declaration. Block bodies use `key = value` lines. Required fields: `target`, `operation`. Optional fields: `roles`, `using`, `withCheck`, `as`.
- **FR16.** `target` references a model owned by the contract (cross-contract `target` is a load-time error). `operation` is a closed-set identifier. `roles` is a bare identifier list. `using` / `withCheck` are quoted string literals (verbatim — no interpolation in v0.1). `as` is `permissive | restrictive`, default `permissive`.
- **FR17.** Policies live inside the surrounding `namespace` block. Namespace blocks remain reopenable per TML-2459; policies can live in different files from the models they target. The two-body-form pattern (`field Type @attrs` for typed members vs `key = value` for static config) gets its own ADR drafted as part of this project per **OC1**.
- **FR18.** Multiple permissive policies per `(target, operation)` are valid when their names differ. Duplicate policy names within `(namespace, target)` are a fail-fast load error.

### Roles authoring

- **FR19.** The Postgres target supports declaring `PostgresRole`s in the contract. Surface details (which API exposes role declaration) follow the same parallel TS / PSL shape used for `model` and `enum` declarations; specifics are left to the implementer to keep aligned with the existing role-shaped declarations once those settle. The Supabase extension (handled by the parallel [extension-supabase](../extension-supabase/spec.md) project) is the first heavy consumer.

### Migration

- **FR20.** Migration ops `CreatePostgresRlsPolicyOp`, `DropPostgresRlsPolicyOp`, `AlterPostgresRlsPolicyOp`, `EnableRowLevelSecurityOp`, `DisableRowLevelSecurityOp` are introduced following ADR 195's `OpFactoryCall` pattern.
- **FR21.** The diff algorithm produces `ALTER POLICY` ops for in-place changes Postgres supports (rename via `RENAME TO`, role change, expression change for the limited shapes Postgres permits), falling back to drop + create when `ALTER POLICY` can't represent the change.
- **FR22.** `ENABLE ROW LEVEL SECURITY` is emitted automatically by the planner when the resolved `rls` state on a table is `'enabled'` (either explicitly or via `'auto'` resolving from policy presence). `DISABLE` is emitted when the resolved state is `'disabled'`. The planner consults the verifier's introspection of `pg_class.relrowsecurity` to skip no-op transitions.

### Verifier

- **FR23.** The Postgres schema verifier queries `pg_policies`, `pg_roles`, and `pg_class.relrowsecurity` for each table in scope. The verifier walks the loaded Contract IR's `PostgresRlsPolicy[]` and `PostgresRole[]` (via the SPI seam introduced in TML-2459).
- **FR24.** Equivalence is decided by full-wire-name match. The verifier never compares predicate bodies for equivalence purposes.
- **FR25.** The verifier performs one body-level check per introspected policy: a tamper check. Recompute the hash from the introspected body; if it doesn't match the introspected wire-name suffix, emit `rls_policy_tampered`.
- **FR26.** Rename detection: matching suffix + different prefix → emit `rls_policy_renamed`. The planner consumes this issue and emits `ALTER POLICY ... RENAME TO`.
- **FR27.** RLS-enabled state check: declared policies but `pg_class.relrowsecurity = false` → emit `rls_not_enabled`. The planner consumes this and emits `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
- **FR28.** Three new `SchemaIssue` kinds extend the union target-side: `rls_policy_renamed`, `rls_policy_tampered`, `rls_not_enabled`. Per TML-2459's `SchemaIssue` forward note, the framework `SchemaIssue` type stays as-is; widening happens target-side.
- **FR29.** Severity of `missing_rls_policy`, `extra_rls_policy`, and `missing_role` is governed by the corresponding table's or role's control policy (consumed from the parallel [control-policy](../control-policy/spec.md) project).

## Non-Functional Requirements

- **NFR1.** No regression in non-Postgres targets. SQLite and Mongo contracts that don't touch RLS continue to verify and migrate identically; their family/framework IR layers do not see any RLS-shaped types.
- **NFR2.** The verifier handles a contract with 100 tables and 5 policies each (500 policies total) in under 5 seconds end-to-end against a live Postgres database. Most of that budget is the introspection query round-trip; the hash recomputation is sub-millisecond per policy.
- **NFR3.** Round-trip fidelity: `descriptor.contractSerializer.deserializeContract(JSON.parse(JSON.stringify(descriptor.contractSerializer.serializeContract(contract))))` preserves all `PostgresRlsPolicy` and `PostgresRole` fields, including the user-typed prefix and the full wire name.
- **NFR4.** Layering is enforced by `pnpm lint:deps`. RLS-aware code lives in the Postgres target; the framework and SQL family layers contain no references to `PostgresRlsPolicy` / `PostgresRole`.
- **NFR5.** The content-addressed naming code path is target-internal. The user never sees the hash suffix at the authoring surface; the planner and verifier never expose it in diagnostics. Diagnostics name the user's prefix exclusively.

## Non-goals

- **Runtime session-var injection (`SET LOCAL role`, `SET LOCAL request.jwt.claims`).** This is the load-bearing piece that makes `auth.uid()` resolve correctly inside policies at query time. It belongs to the parallel [runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) project (and the [extension-supabase](../extension-supabase/spec.md) project for the JWT-claim-shape glue). This project ships the static contract side of RLS; the dynamic per-query side is separate.
- **Supabase-specific role declarations and predefined policy patterns.** The Supabase extension's `roles.anon` / `roles.authenticated` / `roles.service_role` declarations, plus any "policy pack" of pre-canned Supabase policies, belong to the [extension-supabase](../extension-supabase/spec.md) project. This project builds the substrate; that project ships the Supabase content.
- **Functions as first-class IR.** `auth.uid()`, `auth.jwt()`, and friends are opaque references inside policy predicate strings. The framework's existing `DefaultFunctionRegistry` covers the "function-as-column-default" case (per umbrella decision **C4**); promoting functions to a fully introspected IR kind (with `pg_proc` verification, planner DDL, body content-addressing under **OC4**) is deferred entirely.
- **Role attribute management.** `LOGIN`, `INHERIT`, `REPLICATION`, password hashes, role membership graphs, ownership transfer — none of these are in `PostgresRole` v0.1. The IR carries just the name. Role provisioning (`CREATE ROLE` / `DROP ROLE` / `ALTER ROLE`) for `managed` roles is deferred; v0.1 only verifies that declared roles exist in `pg_roles`.
- **PSL `${...}` string interpolation.** The PSL equivalent of TS's `ref()` helper. Captured as umbrella offcut **OC3**; deferred until a real authoring-pain signal arrives.
- **`policyGroup` for shared-target policies.** A `policyGroup UserPolicies { target = User; policy ... { ... }; }` form that hoists shared properties was sketched during shaping. Captured as umbrella offcut **OC2**; deferred from v0.1.
- **Backport of content-addressed naming to other Postgres objects** (indexes, functions, views, check constraints). The naming pattern is generalizable, but each per-kind backport carries its own normalizer design + DBA-UX trade-offs. Captured as umbrella offcut **OC4**; deferred. Future projects can reach for the pattern instead of reinventing it.

## Sequencing constraints

This project depends on [TML-2459 — Target-Extensible IR](../target-extensible-ir/spec.md). Specifically:

- **TML-2459 M1 (foundation).** The framework `SchemaNode` interface, `SchemaNodeBase` abstract class, `ContractSerializer` / `SchemaVerifier` SPI shape. The new `PostgresRlsPolicy` / `PostgresRole` classes extend `SchemaNodeBase`.
- **TML-2459 M3 (Postgres IR shells).** The class-hierarchy Contract IR for Postgres (`PostgresStorage`, `PostgresTable`, etc.) is the parent shape RLS classes attach to.
- **TML-2459 M5a (namespace exemplar).** `PostgresRole`'s namespace coordinate uses the `Namespace` + `__unspecified__` singleton subclass pattern.

This project depends on [control-policy](../control-policy/spec.md). Severity dispatch for `missing_rls_policy`, `extra_rls_policy`, `missing_role` consumes the control-policy primitive.

This project can run in parallel with [cross-contract-refs](../cross-contract-refs/spec.md) and [runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) once TML-2459 + control-policy have landed. Composition with cross-contract-refs is purely consumer-side (the TS `ref()` helper accepts cross-contract handles transparently); composition with runtime-target-layer is "this project ships the static contract, that one ships the dynamic per-query session-var injection."

[extension-supabase](../extension-supabase/spec.md) consumes this project's deliverables to declare Supabase roles, RLS-policy authoring, and the canonical example.

# Acceptance Criteria

- [ ] **AC1.** A TS app contract declares an RLS policy via `.rls([{ name, operation, roles, using }])`. The Contract IR contains a `PostgresRlsPolicy` whose `name` is the user prefix + 8-hex hash suffix, whose `prefix` is the user-typed prefix, and whose `using` is the resolved predicate string. Round-trip through `contract.json` preserves all fields exactly.
- [ ] **AC2.** A PSL app contract declares the same policy via `policy <name> { target = ...; operation = ...; roles = [...]; using = "..." }`. The resulting Contract IR is identical to AC1's TS form (modulo the canonical `prefix`).
- [ ] **AC3.** A TS policy using `using: ({ ref }) => \`... ${ref(Profile)} ...\`` lowers `ref(Profile)` to the canonical quoted identifier (`"public"."profile"`). Renaming `Profile.sql({ table })` from `'profile'` to `'user_profile'` updates the policy's resolved `using` string and recomputes the hash suffix.
- [ ] **AC4.** Two policies on the same `(target, operation)` with different names both lower to distinct `PostgresRlsPolicy` IR nodes. The planner emits two `CREATE POLICY` statements; Postgres ORs them at evaluation time. Verified via an integration test.
- [ ] **AC5.** A PSL contract declaring `target = supabase:auth.User` (cross-contract target) fails to load with a diagnostic naming the foreign contract space.
- [ ] **AC6.** A model with `rls: 'auto'` and at least one declared policy emits `ALTER TABLE … ENABLE ROW LEVEL SECURITY` at migration time. A model with `rls: 'enabled'` and no policies also emits the `ENABLE`. A model with `rls: 'disabled'` and policies emits `DISABLE` and leaves the policies un-applied.
- [ ] **AC7.** Verifier behaviour against a live Postgres database (PGlite-backed integration test):
  - Declared policies that exist in `pg_policies` with matching full wire name → zero issues.
  - Declared policy missing from `pg_policies` → `missing_rls_policy` (severity per control policy).
  - Introspected policy not in the contract → `extra_rls_policy` (severity per control policy).
  - Matching hash suffix, different prefix → `rls_policy_renamed`. Planner consumes this and emits `ALTER POLICY ... RENAME TO`.
  - Hash recompute mismatch → `rls_policy_tampered`. Planner under `control: 'managed'` re-CREATEs the policy.
  - Declared policies + `pg_class.relrowsecurity = false` → `rls_not_enabled`. Planner emits `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
- [ ] **AC8.** Manual postgres reformatting (`ALTER POLICY … USING (auth.uid() = user_id)` against an authored predicate of `user_id = (auth.uid())::uuid`) is correctly classified — the verifier surfaces `rls_policy_tampered`, not a false-positive `policy_mismatch`. Demonstrates the content-addressing trick works against real Postgres expression-printer reformatting.
- [ ] **AC9.** A declared `PostgresRole` with `control: 'external'` that doesn't exist in `pg_roles` surfaces `missing_role` as an error. A declared role with `control: 'external'` that exists is silent. Verified via integration test.
- [ ] **AC10.** Existing non-Postgres targets (SQLite, Mongo) build, test, and verify identically. `pnpm test:packages` plus integration suites green; no SQLite / Mongo regressions.
- [ ] **AC11.** Round-trip property test: Contract IR with `PostgresRlsPolicy` and `PostgresRole` instances (mix of `permissive` / `restrictive`, mix of `using` only / `using + withCheck`, mix of single / multi-role) serializes to `contract.json` and back to structurally-identical class instances.
- [ ] **AC12.** `pnpm lint:deps` passes; the framework and SQL family layers contain no references to `PostgresRlsPolicy` / `PostgresRole` (verified by inspection + lint rules).

# Other Considerations

## Security

RLS is itself a security feature. The framework's job here is to faithfully translate authored intent into Postgres semantics without misrepresenting them.

Two security-adjacent properties of the design:

- **The tamper check (`rls_policy_tampered`) is load-bearing for trust.** If a malicious or accidental manual `ALTER POLICY` weakens a predicate (e.g. drops the `user_id = auth.uid()` check), the framework verifier catches it on the next run — the introspected body's recomputed hash won't match the wire-name suffix.
- **The content-hash suffix never carries semantic meaning to Postgres.** It's an opaque label; Postgres doesn't parse it. If the suffix were ever forged in `pg_policies` (e.g. by a privileged actor running `ALTER POLICY ... RENAME TO`), the tamper check would catch it on the next verifier run unless the forger also rewrites the body in lockstep. The hash is not a cryptographic seal — it's a tamper-evidence signal good enough to detect accidents and most casual edits.

The hash itself isn't security-sensitive (8 hex chars = 32 bits of entropy; meant for collision-avoidance within a `(schema, table)` namespace, not for authentication). The user prefix carries the human-meaningful identity.

## Cost

Internal engineering effort. No infrastructure cost. Estimated work breakdown:

- **IR + serializer additions** (`PostgresRlsPolicy`, `PostgresRole`, target-side `SchemaIssue` widening, round-trip): ~400 LOC + tests.
- **Content-addressed naming machinery** (canonical normalizer, hash function, lowering integration, diagnostic surface): ~300 LOC + tests. The normalizer is the trickiest single piece — needs careful coverage of edge cases (nested parens, mixed-case keywords, comments inside predicates).
- **TS authoring surface** (`.rls(...)` stage, `ref()` helper, role refs, model-level `rls` field): ~250 LOC + tests.
- **PSL authoring surface** (grammar, AST, lowering, formatter): ~400 LOC + tests. PSL grammar work is the second-biggest piece.
- **Migration ops** (`CreatePostgresRlsPolicyOp` etc., diff algorithm): ~300 LOC + tests.
- **Verifier** (introspection queries, hash recompute, rename detection, RLS-enabled state, tamper check, control-policy dispatch): ~350 LOC + tests.

Total ~2000 LOC + tests. The two largest chunks are the content-addressed naming (because it sets up future projects) and the PSL grammar (because of the AST + formatter + round-trip surface area).

## Observability

The verifier extends the existing diagnostic surface with three new issue kinds. CLI / log rendering is unchanged for users; per the framework convention, the new kinds slot into the existing rendering pipeline target-side.

## Data Protection

Not applicable — no personal data flows through the contract or verifier paths. The RLS feature itself protects user data at query time, but that's the runtime side handled by a separate project.

## Analytics

Not applicable.

# References

- [Umbrella project — Supabase integration](../supabase-integration/README.md) — context for why this project exists.
- [Umbrella `decisions.md`](../supabase-integration/decisions.md) — consumes **A1–A5, A8** (TS surface), **B1–B6** (PSL surface), **C3, C4, C5, C9, C10, C11** (cross-cutting), and offcuts **OC1, OC2, OC3, OC4**.
- [TML-2459 — Target-Extensible IR spec](../target-extensible-ir/spec.md) — load-bearing dependency for the target-only IR kind shape, the `SchemaVerifier` / `ContractSerializer` SPI seams, and the `Namespace` + `__unspecified__` subclass pattern.
- [`specs/adr-content-addressed-policy-names.md`](specs/adr-content-addressed-policy-names.md) — full design and rationale for the content-addressed naming scheme; this project's load-bearing ADR.
- [control-policy project spec](../control-policy/spec.md) — the parallel project owning the `managed` / `tolerated` / `external` / `observed` enum that this project's verifier dispatches against.
- [cross-contract-refs project spec](../cross-contract-refs/spec.md) — the parallel project whose model-handle brands the TS `ref()` helper consumes transparently.
- [runtime-target-layer project spec](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) — the parallel project shipping the runtime `SET LOCAL` injection that makes RLS predicates actually run with the right `auth.uid()` value.
- [extension-supabase project spec](../extension-supabase/spec.md) — the parallel project consuming this one to declare Supabase roles + serve as the canonical demo.
- [ADR 195 — Planner IR with two renderers](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md) — the `OpFactoryCall` precedent the migration ops follow.
- [ADR 192 — ops.json is the migration contract](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) — the JSON-canonical / class-in-memory pattern.

# Open Questions

- **Where does the canonical normalizer live in the package layout?** Three plausible homes: (a) inside the Postgres target's `core/rls/` directory, scoped to RLS use only; (b) a shared `core/canonicalize-sql/` module reusable for future content-addressed objects (indexes, functions, views per **OC4**); (c) a Postgres-target-internal `core/content-addressing/` module that knows about all currently-content-addressed object kinds. Path (b) is the most architecturally clean; path (a) is the most YAGNI. Recommend (a) for v0.1 with a deliberate refactor when the next content-addressed object lands.
- **Should `PostgresRole` v0.1 carry the `loginRole: boolean` distinction?** Postgres roles split into login and non-login (the historical `USER` vs `GROUP` distinction). Some Supabase flows reference both kinds. v0.1 working assumption: omit; treat all declared roles as opaque names. If a user needs `loginRole: true` to validate `LOGIN` attribute via `pg_roles.rolcanlogin`, add it under an `attributes?: { login?: boolean }` shape rather than promoting it to top-level.
- **`ALTER POLICY` ALTER vs DROP+CREATE fallback policy.** Postgres supports `ALTER POLICY ... RENAME TO`, `ALTER POLICY ... TO <roles>`, and a limited form of `ALTER POLICY ... USING (...) WITH CHECK (...)`. Other shapes (e.g. changing `permissive ↔ restrictive`, changing the operation) require DROP + CREATE. The decision boundary between in-place ALTER and drop-then-create is mechanical but tedious; the implementer should mirror Postgres's documented `ALTER POLICY` capability matrix exactly, with the fallback being drop + create.
