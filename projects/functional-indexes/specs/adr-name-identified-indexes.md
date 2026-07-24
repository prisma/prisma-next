# ADR — Name-identified indexes and the exact-name content-comparison fallback

Status: **Draft** (migrates to `docs/architecture docs/adrs/` at project close-out; number assigned then).

Related: [ADR 234 — Content-addressed wire names for Postgres-normalized objects](../../../docs/architecture%20docs/adrs/ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md) (extended here), [ADR 235 — The schema differ walks two derived schema IRs](../../../docs/architecture%20docs/adrs/ADR%20235%20-%20The%20schema%20differ%20walks%20two%20derived%20schema%20IRs.md), [ADR 009 — Deterministic Naming Scheme](../../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md), [ADR 210 — Index-type registry](../../../docs/architecture%20docs/adrs/ADR%20210%20-%20Index-type%20registry.md).

## Decision

Two decisions, one rule.

**1. Every SQL index is name-identified.** ADR 234's content-addressed wire names extend from RLS policies to all index nodes — declared `@@index`es (unique indexes included) and FK-backing indexes. The user authors a prefix (or gets one derived from ADR 009's default names); lowering appends `_<8 hex of SHA-256(canonical content)>`; the schema differ pairs index nodes by name, not by column tuple. This unlocks index kinds whose defining content is a reprinted SQL body — expression (functional) indexes and partial (`WHERE`) indexes — which a tuple identity can never represent and a body comparison can never verify.

Constraints — primary key, foreign key, unique, check — are outside the rule. A constraint is its own discrete entity, never a marker on an index ([ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md), superseding note), and it is fully structured, so content comparison is already exact and no wire name is needed. An expression-unique is therefore a unique *index*, authored as `@@index(expression: …, unique: true)` — Postgres has no expression form of `ADD CONSTRAINT UNIQUE`, and `@@unique` remains the constraint surface, untouched.

**2. Every name-identified object kind has an exact-name mode for adoption.** Authoring `map: "<name>"` instead of `name: "<prefix>"` stores the verbatim physical name with no hash, and the node's equivalence becomes **content comparison**: structured attributes strictly, SQL bodies byte-for-byte. Byte-comparing bodies is exactly wrong for hand-authored text and exactly right for text captured by `contract infer` — an inferred body *is* Postgres's reprint, and reprint-vs-reprint is stable. Exact mode is the adoption/round-trip path; managed mode is the authoring path.

The rule generating both: **compare by content wherever content is faithfully comparable; where Postgres reprints it, the name carries the content hash and the name is the equivalence relation.**

There is no stored mode marker. A node carries `prefix` iff it is managed; its `isEqualTo` selects the strategy from that property (ADR 235's node-owned equivalence, unchanged in shape).

## A worked example

The motivating case (ciphers team, EQL encrypted search):

```prisma
model User {
  id    Int    @id
  email String
  @@index(expression: "eql_v3.eq_term(email)", name: "users_email_eq", type: "btree")
}
```

Lowering hashes the canonical content tuple and stores the wire name in the contract:

```jsonc
{ "name": "users_email_eq_7c31d9a4", "prefix": "users_email_eq",
  "expression": "eql_v3.eq_term(email)", "unique": false, "type": "btree" }
```

The planner emits:

```sql
CREATE INDEX "users_email_eq_7c31d9a4" ON "public"."user" USING "btree" (eql_v3.eq_term(email));
```

Verification introspects `pg_class`/`pg_index` and finds `users_email_eq_7c31d9a4` — exact name match, no body read. If the user renames the prefix, the suffix survives and the planner emits `ALTER INDEX … RENAME TO`. If the user edits the expression, the suffix changes and the planner creates the new index and (under a destructive policy) drops the old — a rebuild, which an expression change genuinely requires.

Adoption of the same index created by someone else's tooling:

```prisma
// emitted by `contract infer` — note map:, and the body is Postgres's reprint
@@index(expression: "eql_v3.eq_term(email)", map: "users_email_eq", type: "btree")
```

Verify pairs the node by the verbatim name and compares the stored reprint against the introspected reprint — byte-equal, zero drift, zero operations. The emitted contract *signs* the live database.

## Why the wholesale switch (not expression-only)

Tuple identity could have been kept for plain column indexes, reserving name identity for body-carrying ones. Rejected, for three reasons, taken during the pre-1.0 window in which the break is uniquely cheap:

- **Tuple identity cannot represent legal databases.** Two indexes on the same column tuple (a unique index plus a redundant plain one) are legal in Postgres; the tuple-keyed differ cannot host both as siblings, so introspection carried a keep-one-per-tuple dedup hack — a deliberate lie about the database. Name identity deletes it.
- **Decorative names are unverifiable names.** Under tuple identity, `isEqualTo` ignored `name` entirely: a live index named anything paired silently. Under managed naming, verify checks what we created.
- **The upgrade is automatic.** The exact→managed transition machinery (content pairing → `ALTER INDEX … RENAME`, a widening-class metadata-only operation) converts every pre-existing plain-named index on the first widening plan. Post-1.0 this would be a mass-migration event; pre-RC it is a routine plan.

## Naming and hashing

Format, parsing, prefix-length budget (54 chars + 9-char suffix within Postgres's 63), normalizer (trim + internal-whitespace collapse of the *authored* input only), and normalizer-stability commitments are ADR 234's, unchanged and now hoisted to the SQL family (`@prisma-next/sql-schema-ir/naming`) since `SqlIndexIR` is family-shared.

The index content tuple (a stability commitment — changing it re-suffixes every wire name):

```
[ normalizeSqlBody(expression ?? ''), normalizeSqlBody(where ?? ''),
  columns ?? [] /* authored order */, unique, type ?? '', sortedOptions ]
```

`sortedOptions` = `[key, String(value)]` pairs sorted by key. Prefix, schema, and table are excluded (ADR 234 rationale). The RLS tuple is unchanged.

Default prefixes for unnamed authoring are ADR 009's existing default names (`defaultIndexName`, `<table>_<cols>_key`), so an unnamed `@@index([a,b])` becomes `t_a_b_idx_<8hex>`. An expression index has no derivable default and **must** be named (`name:` or `map:`) — an authoring diagnostic enforces it.

## Equivalence matrix

The differ calls `expected.isEqualTo(actual)`; the expected node's own properties select the strategy:

| Node | Pairing id | Compared by `isEqualTo` | Never compared |
| --- | --- | --- | --- |
| Managed index (`prefix` present) | wire name | `unique`, `type`, `options` (loose), `columns` (ordered, when both sides carry them) | `expression`, `where` — the hash in the name covers them; the live side is a non-comparable reprint |
| Exact index (`prefix` absent) | verbatim name | all of the above **plus** `expression ?? ''`, `where ?? ''` byte-for-byte | — |
| Managed policy | wire name | nothing (id equality is content equality — hash covers the full tuple) | bodies |
| Exact policy | verbatim name | `operation`, `permissive`, sorted `roles`, `using ?? ''`, `withCheck ?? ''` byte-for-byte | — |

Managed nodes still compare structured attributes so out-of-band structured drift (`ALTER INDEX … SET (fillfactor=…)`) surfaces as `not-equal`; only reprinted bodies are exempt. Exact-mode byte comparison is deliberately un-normalized: both sides are reprints in the supported flow, and normalization would only mask real drift.

## Planner semantics

- `not-found` → `CREATE [UNIQUE] INDEX` (bodies rendered verbatim; `WHERE (…)` for partial indexes). `not-expected` → `DROP INDEX` under a destructive policy. `not-equal` → the existing `indexIncompatible` conflict.
- **Rename pairing, two phases** (widening-class, per `(schema, table)`, deterministic by sorted names):
  1. *Hash pairing* — missing and extra whose wire names share a hash under different prefixes → `ALTER INDEX … RENAME TO` (ADR 234's rename detection, now for indexes).
  2. *Content pairing* — a remaining missing **managed** node and a remaining extra of any name shape that are content-equal (structured attributes strict, bodies byte-equal) → rename. This is the exact→managed transition and the pre-1.0 upgrade path. It pairs only when the body text is byte-identical, so "switch the name mode" and "rewrite the body" must be separate migrations — done together they degrade to create+drop.
- Under an additive-only policy both phases are skipped and pairing degrades to the additive half: the new name is created now, and — because the rename precheck requires its target absent — the old object can then only leave via a destructive-allowed drop, never a later rename. A rename happens only when a widening-allowed plan is the *first* convergence. Matches the existing RLS rename degradation.

## Adoption and inference

`contract infer` emits every index with **managed re-detection**: recompute the content hash from introspected (fully structured or reprinted) content; if the live name is `<prefix>_<that hash>`, emit `name: <prefix>` — our own databases re-infer to byte-identical managed contracts. Otherwise emit `map: "<live name>"` with the reprinted bodies verbatim (expression indexes usually land here — reprints add casts and parens — though a byte-identical reprint re-detects managed, which is equally sound). Policies always adopt as exact (`@@map`) by design: re-detection is not attempted for them. RLS enablement round-trips via `@@rls`. The acceptance bar is literal: infer → emit → verify = zero issues, plan = zero operations, on a database this toolchain has never seen.

Hand-authoring a body under `map:` is allowed but produces false drift (authored text vs reprint) and draws an emit-time warning directing the user to `name:`.

## Consequences

### Positive

- Expression, partial, and unique-expression indexes are authorable, migratable, verifiable — with no SQL parser and no body comparison against hand-authored text.
- A foreign database is adoptable with zero operations, and convertible to managed naming with a renames-only migration.
- The introspection dedup and expression-skip hacks are deleted; the actual-side tree stops lying.
- Index names become verified; renames are detected structurally.

### Negative

- Every physical index name grows a 9-character suffix; `EXPLAIN` output and Postgres error messages show `users_email_eq_7c31d9a4`. Accepted: the tool manages names so users don't.
- One-time break: contract shape and every storage hash change; existing databases need one widening plan of renames. Accepted only because this ships pre-RC.
- Exact-mode reliability is conditional on inferred text; the hand-authored case is a documented, warned degradation rather than an error.
- Expression bodies are opaque: a column rename silently stales them (already true of RLS predicates).

## Alternatives considered

**Expression-only name identity (hybrid).** Keep tuple identity for plain indexes. Rejected — see "Why the wholesale switch": representational holes, unverifiable names, and a forever-split identity model, saved from mass-migration cost only while pre-1.0. The window decided it.

**Folding unique constraints into index nodes** (one node kind with a constraint marker, so name identity covers `@@unique` too). Rejected twice over. The schema-differ substrate tried it and backed out: under one node kind a unique constraint and a same-column index collide, forcing introspection dedup and fail-loud derivation rules back in — the tree-massaging that substrate work existed to delete. And the contract's discrete-entities principle (ADR 161 superseding note; Data Contract design principle 4) forbids it regardless: every element must be interpretable from its own node, and an index carrying `constraint: true` is a second catalog object smuggled in as a boolean — an instruction, not a fact. A unique constraint (`pg_constraint`) and an index (`pg_index`) are different elements with different DDL and independent lifecycles; the contract carries each as its own entity.

**A stored strategy marker on the contract entity.** An explicit `naming: 'managed' | 'exact'` field. Rejected: the presence/absence of `prefix` already encodes it structurally, the node owns its equivalence anyway (ADR 235), and a stored enum invites drift against the structure that defines it.

**Canonicalize-at-CREATE, JS-side Postgres parser, cheap normalizers.** Rejected in ADR 234; nothing here changes those rationales. Exact-mode byte comparison is *not* a normalizer — it works only because both sides pass through the same printer.

**Pattern-sniffing the mode from the name** (`does it end in _<8hex>`). Rejected for the declared side: a hand-picked exact name can accidentally match the pattern. Parsing is used only where ADR 234 already uses it — extracting prefixes from live names for rename grouping — where a false parse costs at most a missed rename pairing.
