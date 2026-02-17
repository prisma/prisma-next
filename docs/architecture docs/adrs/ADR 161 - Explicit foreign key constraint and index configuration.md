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

- **ADR 003 (explicit over implicit):** behavior must be opt-in and visible in contract config.
- **ADR 010 (canonicalization):** new FK config fields are part of the canonical contract and affect `storageHash`.
- **ADR 009 (deterministic naming):** FK constraint and generated index names follow deterministic naming rules.
- **ADR 065 / ADR 117 (capability model):** gating uses capability keys, never target-name branching.
- **ADR 038 (idempotency):** FK/index operations must keep explicit pre/post checks and remain replay-safe.

## Decision

### 1. Contract-level FK configuration

Add a top-level `foreignKeys` section to `SqlContract` (sibling of `storage`, `models`, etc.):

```ts
type ForeignKeysConfig = {
  readonly constraints: boolean;
  readonly indexes: boolean;
};
```

| Field | Default | Meaning |
|---|---|---|
| `constraints` | `true` | Emit `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` DDL |
| `indexes` | `true` | Emit `CREATE INDEX` for FK columns when no covering index exists |

Defaults are explicit: `{ constraints: true, indexes: true }`. Omitting the section is equivalent to the defaults.

### 2. Canonicalization and hashing

The `foreignKeys` config is included in the canonical contract representation and contributes to `storageHash`. Changing FK config between contract revisions produces a new hash and a new migration edge.

### 3. Deterministic planner behavior

The planner reads `contract.foreignKeys` and emits or omits operations accordingly:

| `constraints` | `indexes` | FK constraint DDL | FK-supporting index DDL |
|---|---|---|---|
| `true` | `true` | Emitted | Emitted (if no covering index) |
| `true` | `false` | Emitted | Omitted |
| `false` | `true` | Omitted | Emitted (if no covering index) |
| `false` | `false` | Omitted | Omitted |

When `constraints: true`, the adapter must report `sql.foreignKeys: true`. If the capability is missing, the planner fails fast with a structured capability error.

When `indexes: true` and the adapter reports `sql.autoIndexesForeignKeys: true`, the planner skips explicit index creation for FK columns because the database creates them automatically.

### 4. Schema verification

The verifier reads `contract.foreignKeys` to decide what to expect:

- `constraints: true` → missing FK constraints in the schema IR are reported as `foreign_key_mismatch`.
- `constraints: false` → FK constraints are not verified (their presence/absence in the DB is irrelevant).
- `indexes: true` → missing FK-supporting indexes are reported as `index_mismatch`.
- `indexes: false` → FK-supporting indexes are not verified.

### 5. Capability keys

| Key | Type | Reported by | Meaning |
|---|---|---|---|
| `sql.foreignKeys` | boolean | adapters that support FK constraints | Database supports `FOREIGN KEY` DDL |
| `sql.autoIndexesForeignKeys` | boolean | adapters where the DB auto-indexes FKs | Database automatically creates indexes for FKs |

Postgres reports `sql.foreignKeys: true` and `sql.autoIndexesForeignKeys: false` (Postgres does not auto-create FK indexes).

## Consequences

### Positive

- FK behavior is fully explicit and deterministic from the contract.
- No hidden runtime emulation or target-guessing magic.
- Migration planner output is predictable across all four combinations.
- Capability gating ensures fail-fast diagnostics for unsupported configurations.

### Negative

- Users must set `foreignKeys.constraints: false` for FK-less environments. This is intentional: explicit over implicit.
- Changing FK config requires a new migration (hash changes). This is correct: schema intent changed.

## Scope

**v1 (this ADR):**
- Contract schema/types for global FK knobs.
- TS contract builder support.
- Deterministic planner emission/omission.
- Capability-gated behavior.
- Schema verification updates.
- Postgres-first implementation and tests.

**Out of scope:**
- Runtime emulated referential integrity.
- Per-FK or per-table overrides.
- Cross-target rollout beyond Postgres.
