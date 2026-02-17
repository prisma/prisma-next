# feat: Configurable Foreign Key Constraints and Indexes

**Type:** Enhancement
**Date:** 2026-02-13
**Status:** Draft

---

## Overview

Replace Prisma ORM's all-or-nothing `relationMode` with two independent, granular configuration knobs in Prisma Next:

1. **FK Constraints** -- whether to emit `FOREIGN KEY` constraints in migrations
2. **FK Indexes** -- whether to auto-create indexes on FK columns

Both knobs operate at **global** (contract-wide) and **per-FK** levels, and affect both the **migration plane** (DDL emission) and the **runtime plane** (emulated referential integrity when constraints are disabled).

---

## Problem Statement

### Current state in Prisma Next

Foreign keys are already first-class entities in the contract IR (`packages/2-sql/1-core/contract/src/types.ts`):

```typescript
export type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
};
```

However:
- **No way to disable FK constraint emission** -- every FK in the contract becomes a DDL constraint
- **No automatic index creation on FK columns** -- despite ADR 001 stating planners should "include required supporting operations such as equality indexes for foreign keys", the Postgres planner does NOT auto-create these
- **No referential actions** (`onDelete`/`onUpdate`) -- though ADR 044's check vocabulary reserves slots for them
- **No global or per-FK configuration** -- FKs are either in the contract or not

### What was wrong with Prisma ORM's `relationMode`

| Problem | Detail |
|---|---|
| Global, all-or-nothing | Datasource-level setting affects ALL relations -- no per-relation control |
| Misleading name | "relationMode" suggests it changes relation semantics; it really controls FK constraint emission |
| Incomplete emulation | `CREATE` operations don't validate referential integrity; raw SQL bypasses emulation entirely |
| Missing auto-indexing | Developers must manually add `@@index` on every FK column -- 40%+ miss this in practice |
| No "none" mode | No way to disable both DB-level and emulated referential checks |

### Database behavior matrix (verified)

| Database | Auto-Index on FK Columns | FK Constraints | FK Enforcement Default | Notes |
|---|---|---|---|---|
| **PostgreSQL** | **No** | Yes | Always on | Must manually index FK columns |
| **MySQL/InnoDB** | **Yes** | Yes | Always on | Auto-drops redundant indexes |
| **SQLite** | **No** | Yes (syntax only) | **Off** (`PRAGMA foreign_keys = OFF`) | Must enable per-connection |
| **CockroachDB** | **Yes** | Yes | Always on | Auto-index persists after FK drop |
| **Vitess/PlanetScale** | Inherits MySQL | Yes (GA, unsharded only) | Off (opt-in per DB) | Sharded DBs: no FK support |
| **MongoDB** | N/A | **No FK concept** | N/A | Manual references only |

---

## Proposed Solution

### Two independent knobs

```
                         ┌─────────────────────────────────┐
                         │  foreignKeyConstraints: boolean  │
                         │  (default: true)                 │
                         │                                  │
                         │  Controls: ALTER TABLE ... ADD   │
                         │  CONSTRAINT ... FOREIGN KEY ...  │
                         └─────────────────────────────────┘

                         ┌─────────────────────────────────┐
                         │  foreignKeyIndexes: boolean      │
                         │  (default: true)                 │
                         │                                  │
                         │  Controls: CREATE INDEX ... ON   │
                         │  table(fk_column)                │
                         └─────────────────────────────────┘
```

Both knobs are independent. All four combinations are valid:

| Constraints | Indexes | Use Case |
|---|---|---|
| `true` | `true` | **Default.** Full FK semantics + performance. Best for PostgreSQL, SQLite. |
| `true` | `false` | User manages indexes manually, or DB auto-creates them (MySQL, CockroachDB). |
| `false` | `true` | No FK constraints (PlanetScale sharded, Vitess), but still index FK columns for JOIN performance. |
| `false` | `false` | Fully manual. User manages everything. MongoDB-like or extreme performance tuning. |

### API Design

#### Global defaults (contract-level)

Add an optional `foreignKeys` configuration to the contract builder:

```typescript
const contract = defineContract({
  foreignKeys: {
    constraints: true,   // default: true -- emit FK constraints in DDL
    indexes: true,       // default: true -- auto-create indexes on FK columns
  },
  tables: { /* ... */ },
});
```

When omitted, both default to `true`.

#### Per-FK overrides (table-level)

The existing `.foreignKey()` builder method gains optional configuration:

```typescript
contract.table('post')
  .foreignKey(
    ['userId'],
    { table: 'user', columns: ['id'] },
    {
      name: 'post_userId_fkey',       // optional: custom constraint name
      constraint: true,               // optional: override global default
      index: true,                    // optional: override global default
      indexName: 'post_userId_idx',   // optional: custom index name
    }
  )
```

#### FK naming

FK constraints already follow ADR 009's deterministic naming (`{table}_{cols}_fkey`). The user can override via the `name` option. Index names follow a parallel pattern (`{table}_{cols}_idx`) with an optional `indexName` override.

### Contract IR Changes

Extend the `ForeignKey` type:

```typescript
export type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly constraint?: boolean;    // NEW: whether to emit the DDL constraint
  readonly index?: boolean;         // NEW: whether to auto-create an index
  readonly indexName?: string;      // NEW: custom name for the auto-created index
};
```

Add a top-level `foreignKeys` config to the contract:

```typescript
export type ContractConfig = {
  readonly foreignKeys?: {
    readonly constraints?: boolean;  // default: true
    readonly indexes?: boolean;      // default: true
  };
};
```

### JSON Schema Changes

Extend `data-contract-sql-v1.json`:

```json
{
  "ForeignKey": {
    "properties": {
      "columns": { "type": "array", "items": { "type": "string" } },
      "references": { "$ref": "#/definitions/ForeignKeyReferences" },
      "name": { "type": "string" },
      "constraint": { "type": "boolean", "default": true },
      "index": { "type": "boolean", "default": true },
      "indexName": { "type": "string" }
    },
    "required": ["columns", "references"]
  }
}
```

---

## Technical Approach

### Phase 1: Contract IR + Authoring (Foundation)

**Goal:** Extend the contract to express FK configuration.

#### Tasks

1. **Extend `ForeignKey` type** in `packages/2-sql/1-core/contract/src/types.ts`
   - Add `constraint?: boolean`, `index?: boolean`, `indexName?: string`
   - Update `ForeignKeyReferences` if needed

2. **Extend `ForeignKeyDef`** in `packages/1-framework/2-authoring/contract/src/builder-state.ts`
   - Mirror the new fields

3. **Update `fk()` factory** in `packages/2-sql/1-core/contract/src/factories.ts`
   - Accept optional config object

4. **Update Arktype validators** in `packages/2-sql/1-core/contract/src/validators.ts`
   - Add optional `constraint`, `index`, `indexName` to `ForeignKeySchema`

5. **Update JSON Schema** in `packages/2-sql/2-authoring/contract-ts/schemas/data-contract-sql-v1.json`
   - Add new properties to `ForeignKey` definition

6. **Add `ContractConfig`** to contract root type
   - `foreignKeys: { constraints?: boolean, indexes?: boolean }`
   - Wire into contract builder

7. **Update `.foreignKey()` builder** in `packages/1-framework/2-authoring/contract/src/table-builder.ts`
   - Accept options object with `name`, `constraint`, `index`, `indexName`

8. **Update canonicalization** in `packages/1-framework/1-core/migration/control-plane/src/emission/canonicalization.ts`
   - Ensure new fields are included in deterministic output

#### Tests

- Factory tests: `fk()` with all combinations of options
- Builder tests: `.foreignKey()` with constraint/index overrides
- Validator tests: Arktype schema accepts new optional fields
- Canonicalization tests: deterministic ordering preserved

---

### Phase 2: Migration Planner (DDL Emission)

**Goal:** Respect FK configuration when generating DDL.

#### Tasks

1. **Update Postgres planner** in `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
   - `buildForeignKeyOperations()`: skip `ALTER TABLE ... ADD CONSTRAINT` when `constraint === false`
   - **New:** `buildForeignKeyIndexOperations()`: auto-generate `CREATE INDEX` on FK columns when `index !== false`
   - Resolve effective config: per-FK override > global default > `true`

2. **Handle MySQL/CockroachDB auto-indexing**
   - When the target DB auto-creates FK indexes (MySQL, CockroachDB), the planner should skip emitting explicit `CREATE INDEX` to avoid duplicates
   - Introduce adapter capability: `autoIndexesForeignKeys: boolean`

3. **Handle SQLite `PRAGMA foreign_keys`**
   - When FK constraints are enabled for SQLite, the runtime adapter should emit `PRAGMA foreign_keys = ON` per connection
   - When FK constraints are disabled, skip the pragma

4. **Update migration operation types**
   - Extend `OperationClass` to differentiate `foreignKeyConstraint` from `foreignKeyIndex`
   - Ensure correct ordering: indexes created before constraints (for referencing), constraints dropped before indexes

5. **Handle config changes between migrations**
   - Diff planner detects when `constraint` or `index` flags change on existing FKs
   - Generate appropriate `DROP CONSTRAINT` / `DROP INDEX` or `ADD CONSTRAINT` / `CREATE INDEX`

#### Tests

- Postgres planner: all 4 combinations of constraint/index flags
- Migration diff: adding/removing constraint flag on existing FK
- Migration diff: adding/removing index flag on existing FK
- Adapter capability: `autoIndexesForeignKeys` respected

---

### Phase 3: Introspection + Verification

**Goal:** Round-trip FK configuration through introspection and verification.

#### Tasks

1. **Update Postgres introspection** in `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`
   - Introspect FK constraints (already done)
   - Introspect whether an index exists on FK columns
   - Set `constraint: true/false` and `index: true/false` accordingly

2. **Update schema verification** in `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-helpers.ts`
   - `verifyForeignKeys()` should respect configuration:
     - If `constraint: false` in contract but FK exists in DB: report as `extra_foreign_key`
     - If `constraint: true` in contract but FK missing in DB: report as `missing_foreign_key`
     - Similar for index presence vs `index` config
   - Handle semantic satisfaction: name differences still ignored

3. **Update emitter** in `packages/2-sql/3-tooling/emitter/src/index.ts`
   - Include `constraint` and `index` flags in emitted TypeScript types
   - Validate that `indexName` follows naming conventions (ADR 009 pattern)

#### Tests

- Introspection: detect FK with/without index
- Verification: all permutations of contract config vs DB state
- Emitter: TypeScript output includes new fields

---

### Phase 4: Runtime Plane (Emulated Referential Integrity)

**Goal:** When FK constraints are disabled, optionally emulate referential integrity at the runtime level.

#### Tasks

1. **Define emulation strategy**
   - When `constraint: false`, the runtime can optionally enforce referential checks:
     - On `INSERT`/`UPDATE`: verify referenced row exists before executing
     - On `DELETE`: check for referencing rows and apply referential action
   - Emulation is **opt-in**, not automatic (unlike Prisma ORM's hidden emulation)

2. **Add runtime config**
   - Extend runtime creation options:
     ```typescript
     const runtime = createRuntime({
       ir: contract,
       driver,
       emulateReferentialIntegrity: false, // default: false
     });
     ```
   - When `true` and FK constraints are disabled, the runtime wraps mutations with referential checks

3. **Implement emulated checks**
   - `INSERT`/`UPDATE`: `SELECT EXISTS(...)` on parent table before mutation
   - `DELETE`: `SELECT EXISTS(...)` on child tables; apply action (restrict, cascade, set null)
   - Wrap in transaction for atomicity

4. **Error mapping**
   - Emulated FK violations should produce the same `E.RUNTIME.CONSTRAINT_FK` error (ADR 068)
   - Include metadata indicating the violation was caught by emulation, not the DB

5. **SQLite PRAGMA handling**
   - SQLite adapter: emit `PRAGMA foreign_keys = ON` when constraints are enabled
   - Handle per-connection enforcement

#### Tests

- Emulated INSERT with missing parent: throws `E.RUNTIME.CONSTRAINT_FK`
- Emulated DELETE with referencing children: throws or cascades
- Emulation disabled (default): no extra queries
- SQLite pragma: enabled/disabled based on config

---

## ADR Gap Analysis

### Existing ADRs that cover FK-related concerns

| ADR | What it covers | Gap identified |
|---|---|---|
| **ADR 001** (Migrations as Edges) | Lists `addForeignKey` as operation; mentions "equality indexes for foreign keys" | **Gap:** Index auto-creation is stated as a principle but not implemented |
| **ADR 009** (Deterministic Naming) | `{table}_{cols}_fkey` pattern | **Gap:** No naming pattern for auto-created FK indexes (need `{table}_{cols}_idx`) |
| **ADR 044** (Pre/Post Check Vocabulary) | `foreignKeyMatches` with `onDelete?/onUpdate?` | **Gap:** Contract IR has no `onDelete`/`onUpdate` fields yet |
| **ADR 068** (Error Mapping) | `E.RUNTIME.CONSTRAINT_FK` for FK violations | **Gap:** No error for emulated FK violations (should reuse same code with metadata flag) |
| **ADR 121** (Contract.d.ts) | FK columns as scalars, relation typing | Adequate for current scope |

### New ADRs needed

1. **ADR: FK Constraint and Index Configuration**
   - Two independent knobs (constraints, indexes)
   - Global defaults + per-FK overrides
   - Resolution order: per-FK > global > default (true)
   - Adapter capability: `autoIndexesForeignKeys`

2. **ADR: Auto-Index Naming for Foreign Keys**
   - Pattern: `{table}_{cols}_idx` (parallel to `{table}_{cols}_fkey`)
   - User-overridable via `indexName`
   - Deduplication: skip if an explicit index already covers the FK columns

3. **ADR: Emulated Referential Integrity**
   - Opt-in runtime emulation when FK constraints are disabled
   - Emulation scope: INSERT/UPDATE/DELETE (not raw queries)
   - Error mapping: same `E.RUNTIME.CONSTRAINT_FK` with `emulated: true` metadata
   - Transaction wrapping for atomicity

4. **ADR: Referential Actions (onDelete/onUpdate)** *(future, not in this scope)*
   - ADR 044 already reserves slots; full implementation is a separate feature
   - This plan intentionally defers referential actions to keep scope manageable

---

## Alternative Approaches Considered

### 1. Single `foreignKeys` boolean (like Prisma ORM's `relationMode`)

**Rejected.** A single toggle conflates two independent concerns (constraints vs indexes). The user explicitly requested separating them. Prisma ORM's approach was the most-criticized aspect of `relationMode`.

### 2. Per-target defaults instead of global config

**Considered.** Could auto-detect: MySQL + CockroachDB default `indexes: false` (since they auto-create), PostgreSQL defaults `indexes: true`. However, this makes the contract target-dependent, violating the "target-agnostic contract" principle. The contract should be explicit about intent.

### 3. Implicit auto-indexing (no config, always create)

**Considered.** Simpler, but takes control away from users who manage indexes manually or use databases that auto-index. The `index` flag with default `true` achieves the same default behavior while allowing opt-out.

### 4. `relationMode = "none" | "database" | "emulated"`

**Rejected.** This is the Prisma ORM approach with a third option. It's still global, still overloaded, and still conflates constraints with emulation behavior.

---

## Acceptance Criteria

### Functional Requirements

- [ ] Contract IR accepts `constraint?: boolean`, `index?: boolean`, `indexName?: string` on `ForeignKey`
- [ ] Contract accepts global `foreignKeys: { constraints?: boolean, indexes?: boolean }` config
- [ ] Per-FK settings override global defaults; omitted fields inherit global
- [ ] Migration planner skips `ALTER TABLE ... ADD CONSTRAINT` when `constraint === false`
- [ ] Migration planner auto-creates `CREATE INDEX` on FK columns when `index === true` (or omitted)
- [ ] Migration planner skips explicit index when adapter reports `autoIndexesForeignKeys: true`
- [ ] Introspection detects both FK constraints and FK indexes from existing databases
- [ ] Schema verification respects FK configuration flags
- [ ] Runtime emulation (opt-in) enforces referential integrity for INSERT/UPDATE/DELETE
- [ ] Emulated FK violations produce `E.RUNTIME.CONSTRAINT_FK` with `emulated: true` metadata
- [ ] SQLite adapter handles `PRAGMA foreign_keys` based on constraint config
- [ ] FK constraint names are user-controllable via `name` option (existing behavior, preserved)
- [ ] FK index names are user-controllable via `indexName` option
- [ ] Default index name follows `{table}_{cols}_idx` pattern

### Non-Functional Requirements

- [ ] No breaking changes to existing contract format (new fields are optional, defaults preserve current behavior)
- [ ] `pnpm lint:deps` passes (architectural boundaries respected)
- [ ] `pnpm typecheck` passes across all packages
- [ ] Test coverage for all 4 combinations of constraint/index flags

### Quality Gates

- [ ] All existing tests pass (no regressions)
- [ ] New ADR documents reviewed and merged
- [ ] Emitter generates correct TypeScript for new FK fields
- [ ] JSON Schema updated and validates correctly

---

## Dependencies & Prerequisites

1. **No blockers for Phase 1-3.** The contract IR, planner, and verification changes are self-contained.
2. **Phase 4 (runtime emulation)** depends on Phase 1 (contract changes) being complete.
3. **Referential actions** (`onDelete`/`onUpdate`) are explicitly OUT OF SCOPE. They are a natural follow-up but significantly increase the surface area.

---

## Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking existing contracts | High | All new fields are optional with defaults that preserve current behavior (`constraint: true`, `index: true`) |
| Index deduplication complexity | Medium | If user explicitly declares an index covering FK columns AND `index: true`, planner must detect the duplicate and skip auto-index |
| MySQL/CockroachDB double-indexing | Medium | Adapter capability `autoIndexesForeignKeys` prevents explicit index when DB auto-creates one |
| Emulation performance overhead | Medium | Emulation is opt-in (default `false`), clearly documented as adding extra queries |
| Migration of existing Prisma ORM users | Low | Provide migration guide; `relationMode = "prisma"` maps to `foreignKeys: { constraints: false }` |

---

## Future Considerations

1. **Referential actions** (`onDelete: 'cascade' | 'restrict' | 'setNull' | 'noAction' | 'setDefault'`): ADR 044 already reserves the vocabulary. Natural follow-up to this work.
2. **Composite FK indexes**: When a FK spans multiple columns, the auto-created index should be a composite index on all FK columns.
3. **Partial/conditional indexes**: For advanced use cases, users may want filtered indexes on FK columns (e.g., `WHERE deleted_at IS NULL`).
4. **Advisory lint for missing FK indexes**: Subsystem 3 (Query Lanes) doc mentions "index coverage checks for equality joins when a corresponding FK exists" -- this feature enables that lint.

---

## References

### Internal

- `packages/2-sql/1-core/contract/src/types.ts` -- `ForeignKey`, `StorageTable` types
- `packages/2-sql/1-core/contract/src/factories.ts` -- `fk()` factory
- `packages/2-sql/1-core/contract/src/validators.ts` -- Arktype validators
- `packages/1-framework/2-authoring/contract/src/table-builder.ts` -- `.foreignKey()` builder
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` -- `buildForeignKeyOperations()`
- `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts` -- FK introspection
- `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-helpers.ts` -- `verifyForeignKeys()`
- `packages/2-sql/3-tooling/emitter/src/index.ts` -- FK type emission
- `docs/architecture docs/adrs/ADR 001 - Migrations as Edges.md` -- FK index principle
- `docs/architecture docs/adrs/ADR 009 - Deterministic Naming Scheme.md` -- FK naming
- `docs/architecture docs/adrs/ADR 044 - Pre & post check vocabulary v1.md` -- `onDelete?/onUpdate?` slots
- `docs/architecture docs/adrs/ADR 068 - Error mapping to RuntimeError.md` -- `E.RUNTIME.CONSTRAINT_FK`
- `docs/architecture docs/subsystems/1. Data Contract.md` -- FK as core entity
- `docs/architecture docs/subsystems/3. Query Lanes.md` -- FK index coverage lint

### External

- [PostgreSQL 18: Constraints (FK section)](https://www.postgresql.org/docs/current/ddl-constraints.html) -- confirms no auto-indexing
- [MySQL 8.4: FOREIGN KEY Constraints](https://dev.mysql.com/doc/en/create-table-foreign-keys.html) -- confirms auto-indexing
- [SQLite: Foreign Key Support](https://sqlite.org/foreignkeys.html) -- PRAGMA requirement
- [PlanetScale: FK Constraints GA](https://planetscale.com/blog/foreign-key-constraints-are-now-generally-available) -- current status
- [Prisma ORM: Relation Mode](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode) -- predecessor concept
- [GitHub #10611: Auto-create index on @relation](https://github.com/prisma/prisma/issues/10611) -- Prisma ORM auto-index request
- [GitHub #15759: Escape hatch for emulated referential actions](https://github.com/prisma/prisma/issues/15759) -- `relationMode = "none"` request
- [CockroachDB: FK auto-indexing](https://www.cockroachlabs.com/docs/stable/schema-design-table) -- confirms auto-indexing
- [Django ForeignKey](https://docs.djangoproject.com/en/5.2/ref/models/fields/) -- auto-indexing reference
- [Rails: add_reference](https://guides.rubyonrails.org/active_record_migrations.html) -- FK + index in one call
