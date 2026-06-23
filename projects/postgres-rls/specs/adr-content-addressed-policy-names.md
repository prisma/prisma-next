# ADR — Content-addressed wire names for Postgres-normalized objects

Status: **Accepted**.

Related: [ADR 004 — Storage Hash vs Profile Hash](../../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md), [ADR 009 — Deterministic Naming Scheme for Constraints](../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md).

## Decision

Postgres-normalized database objects — starting with RLS policies — carry **content-addressed wire names**. The name a user authors is a *prefix*; the framework appends a short hash of the object's canonical content. Equivalence is then a wire-name match, not a body comparison.

The format is:

```
<user_prefix>_<8 hex chars of SHA-256(canonical(content))>
```

The framework computes the suffix at lowering time. The full wire name lives in `contract.json` and in the database's catalog (e.g. `pg_policies.policyname`). The user only ever types the prefix.

## A worked example

A user authors an RLS policy that lets authenticated users update their own profile rows:

```ts
.rls([{
  name: 'profiles_update_own',
  operation: 'update',
  roles: [authenticated],
  using:     'user_id = (auth.uid())::uuid',
  withCheck: 'user_id = (auth.uid())::uuid',
}])
```

The emitter normalizes the body, hashes it, and stores the full wire name in the IR:

```ts
// In contract.json
{ kind: 'PostgresRlsPolicy',
  name: 'profiles_update_own_a3f1c8b2',  // ← prefix + 8-hex suffix
  …
}
```

The planner emits:

```sql
CREATE POLICY profiles_update_own_a3f1c8b2 ON profile
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (user_id = (auth.uid())::uuid)
  WITH CHECK (user_id = (auth.uid())::uuid);
```

When the verifier later introspects `pg_policies`, it finds a row with `policyname = 'profiles_update_own_a3f1c8b2'`. Verification is exact-string identity on the wire name — no body comparison. If the user renames the policy in TS to `profiles_can_update_self`, the suffix is unchanged (the body didn't change), so the verifier sees `(profiles_can_update_self_a3f1c8b2, profiles_update_own_a3f1c8b2)` — same suffix, different prefix — and treats it as a rename. The planner answers with `ALTER POLICY ... RENAME TO …`.

## Why content addressing

The natural design — identify a policy by `(schema, table, policy_name)` and compare bodies — is undermined by Postgres's expression printer.

`pg_policies.qual` and `pg_policies.with_check` are not stored verbatim. Postgres reparses the predicate at `CREATE POLICY` time and stores a canonicalized form. Even when the predicate is semantically identical, the stored bytes drift through Postgres's renderer along several axes:

- **Cast forms.** `auth.uid()::uuid` round-trips through `pg_policies` as `(auth.uid())::uuid` — the renderer adds parens around the cast operand.
- **Outer parens.** A top-level `(x = 1)` may come back as `x = 1` or vice versa.
- **Whitespace.** Collapsed or re-inserted around operators and keywords.
- **Keyword casing.** `IS NULL` vs `is null`.

A verifier that compares bodies byte-for-byte would produce a false positive on nearly every realistic predicate. A verifier with a cheap normalizer (whitespace, outer parens, casing) still produces false positives on cast forms and paren-grouping. A normalizer thorough enough to canonicalize across Postgres's rendering would need a Postgres-grammar parser running in JS — heavy dependency, high implementation risk, outsized for the problem.

Content addressing sidesteps the comparison entirely. The framework normalizes the *authored* body once and encodes the hash into the name. The verifier never inspects `pg_policies.qual`; it only checks names. The wire name *is* the equivalence relation.

## Design

### Naming format

```
<user_prefix>_<8 hex chars of SHA-256(canonical(content))>
```

- **User prefix.** What the user types in the authoring DSL. The TS DSL takes a `name` field on the policy descriptor; PSL takes the head identifier on the `policy <name> { … }` declaration. Required; the framework does not synthesize names.
- **Hash suffix.** First 8 hex characters (32 bits) of SHA-256 over the canonical content tuple. Truncation precedent is git short hashes. 32 bits is comfortable headroom for the per-table policy count any realistic contract reaches; the collision analysis is in [Consequences](#consequences).
- **Length budget.** Postgres `name` type is 63 chars. The suffix is 9 chars (underscore + 8 hex). User prefix is bounded at 54 chars at lowering time; exceeding the cap is a lowering error with a clear message.
- **No version marker.** Versioning is unnecessary — see [Normalizer stability](#normalizer-stability) below.

### Hash inputs (for RLS policies)

The canonical content tuple fed to SHA-256 is:

1. `canonical(using)` — body of the `USING` clause after normalization (internal whitespace collapse, trim). Empty if absent.
2. `canonical(withCheck)` — same normalization on the `WITH CHECK` body. Empty if absent.
3. `sort(roles)` — roles as a sorted, deduplicated list. Role ordering is not semantically meaningful in Postgres; sorting eliminates a class of accidental drift in the IR.
4. `operation` — closed-set literal (`select | insert | update | delete | all`).
5. `as` — `permissive | restrictive`.

Excluded inputs:

- **Schema and table identity.** `pg_policies.schemaname` and `pg_policies.tablename` carry these independently. They're orthogonal to "is this the same policy content."
- **The user prefix itself.** The prefix is the human-readable label, not part of equivalence. Renaming `posts_select_published → posts_read_open` keeps the suffix stable and signals a rename, not a content change.

### Verifier semantics

The verifier compares declared and introspected policies by full wire name. It produces these outcomes through the generic differ:

- **rename** — declared and introspected sides have a policy whose names share a suffix but differ in prefix, and neither full name appears on the other side. Planner emits `ALTER POLICY ... RENAME TO`. No body inspection.
- **missing** — declared, not introspected, no rename match. Severity governed by the table's [control policy](../../control-policy/spec.md).
- **extra** — introspected, not declared, no rename match. Severity governed by the table's control policy (managed → error, tolerated → warn, external → ignored, observed → silent). An out-of-band `ALTER POLICY` body change produces an extra (old wire name) + missing (none, since the new name is unknown) — treated as extra → drop on next migrate, not as a tamper signal.
- **mismatch on RLS-enabled state** — a policy is declared for a table but `pg_class.relrowsecurity = false`. The planner auto-enables RLS on tables with declared policies, so this only fires on drift.

### IR shape implications

The `PostgresRlsPolicy` IR node carries the **full wire name** in its `name` field. The authoring DSL accepts the prefix; the emitter promotes it to the full name at lowering time.

```ts
// IR (post-lowering, in contract.json)
class PostgresRlsPolicy {
  readonly name: string;  // 'profiles_select_anon_a3f1c8b2'
  …
}

// Authoring (TS) — prefix only
.rls([{ name: 'profiles_select_anon', … }])

// Authoring (PSL) — prefix only
policy profiles_select_anon { … }
```

**Duplicate prefixes within `(schema, table)` are a lowering error**, even when the resulting wire names would differ by hash. The prefix is the user's logical identity for the policy; allowing two policies to share a prefix would produce a confusing footgun ("why are both of my policies still active?" — answer: because their bodies differ, so they hashed differently, so both are present in the database).

## Forward applicability

The same problem class — Postgres re-prints stored bodies — applies to other catalog-resident objects:

- **Indexes.** `pg_indexes.indexdef` is heavily normalized (column ordering, operator class names, partial-index `WHERE` clause).
- **Check constraints.** `pg_constraint.consrc` is reparsed at create time.
- **Views.** `pg_views.definition` is the printer's output, not the user's text.
- **Function bodies.** `pg_proc.prosrc` is verbatim, but function bodies typically differ in whitespace and comment placement after a deploy-tool round-trip.

The naming format (`<prefix>_<8 hex SHA-256>`), the normalizer (internal whitespace collapse + trim of the authored input), and the lowering-time prefix bound are object-kind-agnostic and stay constant across applications. Each object kind only needs to decide:

- The per-kind hash input tuple (analogous to the RLS list above).
- Whether the rename signal (matching suffix, different prefix) needs a kind-specific planner action (e.g. `ALTER POLICY ... RENAME TO`).

Whether to apply content-addressing to a given object kind is a separate decision per kind. Indexes have the widest DBA-visible surface — DBAs reference index names in `REINDEX`, `DROP INDEX`, query plans, and Postgres error messages — so the "ugly suffix" trade-off is the most prominent there. The cost of plain naming has to outweigh the cost of suffix-visibility before the pattern is worth applying to a new object kind.

## Normalizer stability

The normalizer is a **stability commitment** with the same status as the contract storage hash (ADR 004). Changing it changes the suffix of every existing wire name.

This works without an explicit version marker because the contract-hash machinery already signals the change. A normalizer update re-emits different `contract.json`; the storage hash changes; `VERIFY_CODE_HASH_MISMATCH` fires; the user re-emits and re-applies migrations. A `_v1_` marker in the name would carry the same information twice.

The escape hatch we deliberately do *not* build is an intentionally hash-invariant normalizer change — e.g. "the new normalizer treats `TRUE` and `1 = 1` as equivalent, but existing wire names should keep their suffixes." If that need ever arises, the moment to introduce a version marker is then; paying for it up front buys nothing.

## Consequences

### Positive

- **No false-positive body diffs.** The normalizer-plus-hash *is* the equivalence relation; the verifier never compares bodies for equivalence purposes.
- **Free rename detection.** Matching suffix with different prefix is a structural signal the planner can act on with `ALTER POLICY ... RENAME TO`.
- **No planner-runner round-trip.** Unlike read-back-after-CREATE designs, both sides recompute the wire name from the same canonical inputs at lowering and verification time independently.

### Negative

- **Normalizer changes are user-visible.** Any change to the canonicalization invalidates all existing wire names. The contract hash signals the change but the user has to re-emit and re-apply migrations to converge the database.
- **DBA-visible names are uglier.** `profiles_select_anon_a3f1c8b2` in `pg_policies` rather than `profiles_select_anon`. The prefix carries the human-readable intent; the suffix is data the user is asked to ignore in DB inspection.
- **The user's `name` is not the wire name.** The authoring DSL's `name` field and the IR's `name` field have different shapes (prefix vs. full). A small but real semantic gap to surface in developer-facing docs.
- **Collision probability.** 32 bits of suffix gives a 50% collision probability at roughly 65,000 distinct-bodied policies on the *same table* (birthday paradox on a 2^32 space). No realistic contract reaches that density. If it ever happens in practice, the verifier falls back to comparing canonical bodies directly as a tiebreaker and surfaces a diagnostic asking the user to rename one prefix.

## Alternatives considered

Four other designs were on the table before content addressing was chosen.

**Verbatim string match.** Identify by `(schema, table, name)`, compare `pg_policies.qual` against the authored body byte-for-byte. Free to implement; produces false positives on nearly every real predicate because of Postgres's reparse-on-store behavior. Rejected as practically unusable.

**Verbatim + cheap normalizer.** Same identity, but normalize whitespace, outer parens, and keyword casing on both sides before comparing. Trivial to implement and catches the easy cases. Still produces false positives on cast-form differences (`auth.uid()::uuid` vs `(auth.uid())::uuid`) and paren-grouping changes that aren't outer. Rejected because the failure mode is "verifier randomly fires on policies the user didn't change" — corrosive to trust.

**Canonicalize at CREATE.** After `CREATE POLICY`, read back `pg_policies.qual` to capture Postgres's canonical form, store *that* in `contract.json` alongside the authored body, and compare the canonical form at verification time. Robust against Postgres reparse drift. Rejected because it requires planner-runner support for the post-CREATE read-back (the planner needs to issue a query after every policy create), a second name/body field in the IR, and a tight coupling between planner success and IR contents. Content addressing achieves the same robustness without any of that.

**JS-side Postgres parser.** Bring a Postgres-grammar parser into the framework, canonicalize bodies into an AST, compare ASTs. Heaviest dependency, highest implementation risk, and the resulting parser would need to track Postgres versions. Rejected as outsized for the problem.
