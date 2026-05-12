# ADR — Content-addressed wire names for Postgres-normalized objects

Status: **Draft** (workspace ADR; promoted to `docs/architecture docs/adrs/` at project close-out).

Related: [ADR 004 — Storage Hash vs Profile Hash](../../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md), [ADR 009 — Deterministic Naming Scheme for Constraints](../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md).

## Context

The Supabase integration project introduces `PostgresRlsPolicy` as a first-class target-only IR kind. The verifier introspects `pg_policies` and compares against declared policies; the comparison must answer two questions:

1. Is this declared policy the same logical policy as some introspected row?
2. Is its body content the same?

The natural framework answer — identify by `(schema, table, policy_name)` and compare bodies — is undermined by Postgres's expression printer. `pg_policies.qual` and `pg_policies.with_check` are not stored verbatim; Postgres reparses the predicate at `CREATE POLICY` time and stores a canonicalized form. The introspected body therefore rarely matches the authored body byte-for-byte even when the predicate is unchanged — parenthesization, whitespace, keyword casing, and cast forms (`auth.uid()::uuid` vs `(auth.uid())::uuid`) all drift through Postgres's renderer.

Four options for handling this were considered:

- **(a) Verbatim string match.** Free; produces false positives on nearly every real predicate.
- **(b) Verbatim + cheap normalizer** (collapse whitespace, trim outer parens, lowercase keywords). Trivial to implement; still produces false positives on cast-form and paren-grouping differences.
- **(c) Canonicalize-at-CREATE.** Read back `pg_policies.qual` post-`CREATE POLICY`; store the canonical form in `contract.json` alongside the authored form; verifier compares the canonical form. Robust; requires planner-runner support for the post-CREATE read-back and a second name field in the IR.
- **(d) JS-side Postgres parser.** Heavy dependency; high implementation risk; outsized for the problem.

The same problem class — Postgres re-prints bodies that look "stored as authored" — applies to **indexes** (`pg_indexes.indexdef`), **check constraints** (`pg_constraint.consrc`), **views** (`pg_views.definition`), and **functions** (`pg_proc.prosrc`). The Supabase RLS work is the first place this matters concretely, but the solution should be reusable.

## Decision

**Adopt content-addressed wire names for Postgres-normalized objects.** The wire-level name carries a short hash of the object's normalized content; equivalence becomes a name match.

Initial application: `PostgresRlsPolicy` (this project). Future application: indexes, views, check constraints, function bodies. The pattern is a framework convention; per-object-kind application is a per-project decision (driven by whether the false-positive cost of plain naming is hurting users for that object kind).

### Naming format

```
<user_prefix>_<8 hex chars of SHA-256(canonical(content))>
```

- **User prefix.** What the user types in the authoring DSL. The TS DSL accepts a `name` field on the policy descriptor; PSL takes the head identifier on the `policy <name> { ... }` declaration. Required; default-naming logic is not part of this design.
- **Hash suffix.** First 8 hex chars (32 bits) of SHA-256 over the canonical content. Truncation precedent is git short hashes; 8 chars is comfortable headroom for the per-table policy count any realistic Supabase contract reaches.
- **Length budget.** Postgres `name` type is 63 chars. Suffix is 9 chars (`_a3f1c8b2`). User prefix is bounded at 54 chars by the framework at lowering; exceeding the cap is a lowering error with a clear message.
- **No version marker.** The contract-hash machinery (ADR 004) already detects framework changes that affect emitted output: a normalizer change re-emits different `contract.json`, the storage hash changes, `VERIFY_CODE_HASH_MISMATCH` fires, the user re-emits. A `_v1_` marker on the policy name would be redundant with this signal.

### Hash inputs (for RLS policies)

The canonical content fed to the hash is the tuple:

1. `canonical(using)` — body of the `USING` clause after normalization (whitespace collapse, outer paren trim, keyword lowercase). Empty if absent.
2. `canonical(withCheck)` — same normalization on the `WITH CHECK` body. Empty if absent.
3. `sort(roles)` — roles as a sorted, deduplicated list. Role ordering is not semantically meaningful in Postgres; sorting eliminates a class of accidental drift.
4. `operation` — closed-set literal (`select|insert|update|delete|all`).
5. `as` — `permissive|restrictive`.

Excluded:

- **Schema and table identity.** `pg_policies.schemaname` and `pg_policies.tablename` carry these independently; they're orthogonal to "is this the same policy content."
- **The user prefix itself.** The prefix is the human-readable label, not part of equivalence. A user renaming `posts_select_published → posts_read_open` keeps the hash and signals a rename, not a content change.

### Verifier semantics

- **Identity:** full wire name (`policyname` column in `pg_policies`).
- **Rename detection:** `(declared.full_name not in introspected_names) ∧ (introspected.full_name not in declared_names) ∧ (matching hash suffix, different prefix)` → `rls_policy_renamed`. Planner emits `ALTER POLICY ... RENAME TO`.
- **Tamper detection:** for each introspected row, recompute `hash(canonical(qual), canonical(with_check), sort(roles), cmd, permissive)` and compare to the suffix carried in `policyname`. Mismatch → `rls_policy_tampered`. Catches manual `ALTER POLICY` outside the framework.
- **Missing policy** (declared, not introspected, no rename match): `missing_rls_policy`. Severity governed by the table's [control policy](../../control-policy/spec.md).
- **Extra policy** (introspected, not declared, no rename match): `extra_rls_policy`. Severity governed by the table's control policy (managed → error, tolerated → warn, external → ignored, observed → silent).
- **`rls_not_enabled`:** if any policy is declared for a table but `pg_class.relrowsecurity = false`, emit this issue. The planner auto-enables RLS on tables with declared policies, so this is a drift signal.

### IR shape implications

The `PostgresRlsPolicy` IR carries the **full wire name** in its `name` field. The authoring DSL accepts the prefix; the emitter computes the suffix at lowering time and stores the full name in `contract.json`.

```ts
// IR (post-lowering, in contract.json)
class PostgresRlsPolicy {
  readonly name: string;  // 'profiles_select_anon_a3f1c8b2'  ← full wire name
  // ...
}

// Authoring (TS)
.rls([{ name: 'profiles_select_anon', ... }])  // ← prefix only; emitter promotes

// Authoring (PSL)
policy profiles_select_anon { ... }  // ← prefix only; emitter promotes
```

**Duplicate prefixes within `(schema, table)` are a lowering error**, even though their wire names would be distinct by hash. This preserves the user's mental model that the prefix is the policy's logical identity. Eliminates a footgun class ("why are both my policies still running?" — answer: because they have different hashes).

## Forward applicability

The same recipe applies to other Postgres-normalized objects. The Supabase project does **not** implement this for v0.1; each future application is a focused project decision:

- **Indexes.** `pg_indexes.indexdef` is heavily Postgres-normalized (column ordering, operator class names, partial-index `WHERE` clause). Wider UX surface than policies — DBAs reference indexes by name in `REINDEX`, `DROP INDEX`, query plans, and Postgres error messages. The "ugly suffix" trade-off is more visible. Worth applying once the index-shape verifier drift becomes a real user complaint; document the trade-off explicitly when it lands.
- **Functions with bodies.** `pg_proc.prosrc` is verbatim, but bodies often differ in whitespace and comment placement after a deploy-via-tool path. Application here is contingent on first-class function IR (currently deferred per Supabase decisions C4).
- **Views and check constraints.** Same false-positive class as policies; lower priority because they appear less in the Supabase user flow.

The hash function (SHA-256 truncated to 8 hex), the canonical normalizer (whitespace, outer parens, keyword casing), and the `<prefix>_<suffix>` format stay constant across applications. Each per-object-kind project adds:

- The per-kind "what goes into the hash" decision (analogous to the RLS list above).
- Object-kind-specific issue kinds for rename / tamper detection.
- Lowering-time prefix bounding to fit Postgres's 63-char `name` budget.

## Future evolution

The current commitment: **one normalizer for v0.1, no version marker.** Normalizer changes are framework changes; they bubble through the contract hash, the user re-emits, names update.

The escape hatch we explicitly **do not** want to build in v0.1: an intentionally hash-invariant normalizer change. E.g., "v2 of the normalizer treats `TRUE` and `1 = 1` as equivalent" without invalidating every existing policy name. If we ever need that, the moment to add a version marker (`<prefix>_v2_<suffix>`) is then — paying it now buys nothing.

## Consequences

### Positive

- **False positives go to zero.** The normalizer-plus-hash IS the equivalence relation; the verifier never compares bodies for equivalence purposes.
- **Rename detection is free.** Matching hash, different prefix is a structural signal the planner can act on.
- **No planner-runner round-trip needed.** Option (c)'s post-CREATE read-back is not required; both sides recompute from the same canonical inputs.
- **Drift detection is structural.** `rls_policy_tampered` catches manual DB edits cheaply.

### Negative

- **The normalizer is a stability commitment.** Same status as the contract storage hash (ADR 004). Changing it invalidates all existing wire names; the contract hash signals the change but the user has to re-emit and re-apply migrations to align names.
- **DBA-visible names are uglier.** `profiles_select_anon_a3f1c8b2` in `pg_policies` rather than `profiles_select_anon`. The prefix carries the human-readable intent; the suffix is data. Documented; users understand the trade-off.
- **Authoring/IR boundary shifts.** The user's `name` field is not the wire name; the IR's `name` field is. A small but real semantic mismatch worth documenting in the developer-experience guide.
- **Collision handling at the per-table scale.** 2^32 hash space; collision requires ~65k distinct-bodied policies on the same table to become probable. If it ever happens, the verifier compares bodies directly as a tiebreaker and surfaces a diagnostic asking the user to rename one prefix.

## Status notes

- Drafted in the Supabase integration project (v0.1 scope: applies to `PostgresRlsPolicy` only).
- Promotes to `docs/architecture docs/adrs/` with an assigned number at Supabase project close-out.
- The per-object-kind backport list (indexes, functions, views, check constraints) is captured in the umbrella [decisions log](../../supabase-integration/decisions.md) as architectural offcut **OC4** for future-project consumption.
