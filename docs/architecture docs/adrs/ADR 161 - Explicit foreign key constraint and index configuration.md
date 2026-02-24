# ADR 161 — Explicit foreign key constraint and index configuration

## Context

Prisma Next expresses every schema intent through the data contract. Foreign keys are already modeled in the contract as structural facts — they declare which columns reference which table. However, the control plane today always emits both the FK constraint DDL **and** a supporting index for every declared FK, with no user override.

Different environments demand different FK behavior:

- **Managed services** like PlanetScale omit FK constraints entirely; users still want indexes on FK columns.
- **Performance-sensitive workloads** may intentionally skip FK-supporting indexes when data patterns already cover the access path (e.g., a composite index that starts with the FK columns).
- **PostgreSQL** automatically creates indexes for primary keys and unique constraints, but **not** for foreign keys. Some environments add them, others do not.

Without explicit knobs, the planner either over-emits (wasted DDL) or under-emits (missing constraints/indexes), and the verifier can't distinguish intentional absence from drift.

## Problem

Users need to control whether FK constraints and FK-supporting indexes are emitted in migration DDL, and whether the verifier reports their absence as drift. The behavior must be explicit, deterministic, and visible in the contract without hidden runtime emulation or target-guessing magic.

## Constraints

- **ADR 003 (explicit over implicit):** behavior must be opt-in and visible in the contract.
- **ADR 010 (canonicalization):** per-FK fields are part of storage and affect `storageHash`.
- **ADR 009 (deterministic naming):** FK constraint and generated index names follow deterministic naming rules.
- **ADR 065 / ADR 117 (capability model):** gating uses capability keys, never target-name branching.
- **ADR 038 (idempotency):** FK/index operations must keep explicit pre/post checks and remain replay-safe.
- **Self-contained nodes:** Each object in the contract must be interpretable from its own node without global mode flags.

## Decision

### 1. Per-FK configuration fields

Each `ForeignKey` entry in `storage.tables.*.foreignKeys[]` carries explicit boolean fields:

```ts
type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly constraint: boolean; // Emit ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY
  readonly index: boolean;      // Emit CREATE INDEX for FK columns
};
```

These fields are **required** in the canonical contract JSON — every FK is self-contained and interpretable without consulting any other part of the contract. There is no global mode flag.

### 2. Builder-level defaults (authoring sugar)

The contract builder provides a `.foreignKeyDefaults()` method as authoring sugar. At `.build()` time, defaults are **materialized** into each FK node:

```ts
const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .foreignKeyDefaults({ constraint: false, index: true }) // PlanetScale-style
  .table('post', (t) =>
    t.foreignKey(['userId'], { table: 'user', columns: ['id'] })
    // ^^^ materialized as { constraint: false, index: true }
  )
  .build();
```

Per-FK overrides take precedence over defaults:

```ts
.foreignKey(['userId'], { table: 'user', columns: ['id'] }, { constraint: true })
// ^^^ constraint: true overrides the default false
```

### 3. No global config in canonical contract

The emitted `contract.json` contains **no** top-level `foreignKeys` config. All FK behavior is expressed per-node inside `storage.tables.*.foreignKeys[]`.

### 4. Canonicalization and hashing

Per-FK fields live inside `storage.tables`, which is already included in `storageHash` computation. Changing FK fields between contract revisions produces a new hash and a new migration edge.

### 5. Deterministic planner behavior

The planner reads each FK's `constraint` and `index` fields individually:

- `fk.constraint === true` → emit `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`
- `fk.constraint === false` → skip FK constraint DDL for this FK
- `fk.index === true` → emit `CREATE INDEX` for this FK's columns (if no covering index)
- `fk.index === false` → skip FK-backing index for this FK

This enables **mixed configs** within a single contract (e.g., one FK with constraint, another without).

### 6. Schema verification

The verifier reads each FK's fields individually:

- `fk.constraint === true` → missing FK constraint is reported as `foreign_key_mismatch`
- `fk.constraint === false` → FK constraint presence/absence is not verified
- `fk.index === true` → missing FK-backing index is reported as `index_mismatch`
- `fk.index === false` → FK-backing index is not verified

### 7. Normalization

For backward compatibility with older contract.json files, normalization fills missing `constraint` and `index` fields with defaults (`true`).

### 8. Capability keys

| Key | Type | Reported by | Meaning |
|---|---|---|---|
| `sql.foreignKeys` | boolean | adapters that support FK constraints | Database supports `FOREIGN KEY` DDL |
| `sql.autoIndexesForeignKeys` | boolean | adapters where the DB auto-indexes FKs | Database automatically creates indexes for FKs |

Postgres reports `sql.foreignKeys: true` and `sql.autoIndexesForeignKeys: false`.

## Consequences

### Positive

- FK behavior is fully explicit and deterministic per-node.
- Each FK entry is self-contained — no global mode flags.
- Mixed FK configs within a single contract are supported.
- Migration planner output is predictable per-FK.
- Capability gating ensures fail-fast diagnostics for unsupported configurations.

### Negative

- Users must set `constraint: false` for FK-less environments. This is intentional: explicit over implicit.
- Changing FK config requires a new migration (hash changes). This is correct: schema intent changed.
- Every FK entry in the canonical JSON must include `constraint` and `index`, making the JSON slightly more verbose.

## Scope

**v1 (this ADR):**
- Per-FK `constraint` and `index` fields in the contract IR.
- TS contract builder support with `foreignKeyDefaults()` sugar.
- Per-FK planner emission/omission.
- Schema verification per-FK.
- Postgres-first implementation and tests.

**v2 (deferred):**
- Capability-gated behavior (`sql.foreignKeys`, `sql.autoIndexesForeignKeys`). Capability keys are documented in `capabilities.md` but planner enforcement is deferred until a non-Postgres target requires it.

**Out of scope:**
- Runtime emulated referential integrity.
- Cross-target rollout beyond Postgres.
