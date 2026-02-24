# Refactor: Per-FK `constraint` and `index` fields (PR #158 rework)

## Overview

Rework PR #158 per [Will's review](https://github.com/prisma/prisma-next/pull/158#issuecomment-3949915291): replace the **global** `contract.foreignKeys: { constraints, indexes }` config with **per-FK** boolean fields on each `ForeignKey` node, so every FK entry is self-contained and interpretable without consulting a distant top-level switch.

### Architectural Principle

> Each object can be interpreted from its own node without global mode flags.

The canonical emitted `contract.json` must be **fully explicit per FK**. Any builder-level "defaults" convenience must materialize into each FK node at build/emission time, so consumers never need to consult global config.

---

## Problem Statement

The current implementation adds a top-level `foreignKeys: { constraints: boolean, indexes: boolean }` to `SqlContract`. This creates a global mode flag: the meaning of each `storage.tables.*.foreignKeys[]` entry depends on a distant top-level switch. As these flags grow over time, the contract becomes increasingly hard to reason about declaratively.

---

## Proposed Solution

### Before (current, global config)

```typescript
// Contract IR
type SqlContract = {
  foreignKeys?: { constraints: boolean; indexes: boolean }; // global flag
  storage: {
    tables: {
      post: {
        foreignKeys: [
          { columns: ['userId'], references: { table: 'user', columns: ['id'] } }
          // ^^^ meaning depends on contract.foreignKeys
        ]
      }
    }
  }
};
```

### After (per-FK fields, fully explicit)

```typescript
// Contract IR
type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly constraint: boolean; // NEW: emit FK constraint DDL?
  readonly index: boolean;      // NEW: emit FK-backing index DDL?
};

// Emitted contract.json — every FK is self-contained
{
  "storage": {
    "tables": {
      "post": {
        "foreignKeys": [
          {
            "columns": ["userId"],
            "references": { "table": "user", "columns": ["id"] },
            "constraint": true,
            "index": true
          }
        ]
      }
    }
  }
  // No top-level "foreignKeys" config
}
```

### Builder API (authoring sugar → materialized at build time)

```typescript
// contract-level defaults (authoring sugar, materialized at build time)
const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .foreignKeyDefaults({ constraint: false, index: true })  // sugar: sets defaults
  .table('post', (t) =>
    t.column('id', { type: uuid })
      .column('userId', { type: uuid })
      .primaryKey(['id'])
      .foreignKey(['userId'], { table: 'user', columns: ['id'] })
      // ^^^ inherits defaults: { constraint: false, index: true }
  )
  .build();
// contract.json has fully explicit per-FK fields — no global config survives
```

---

## Technical Approach

### Phase 1: Contract IR types and factories

**Files:**
- `packages/2-sql/1-core/contract/src/types.ts`
- `packages/2-sql/1-core/contract/src/factories.ts`
- `packages/2-sql/1-core/contract/src/exports/types.ts`

**Changes:**

1. Add `constraint: boolean` and `index: boolean` to `ForeignKey` type (required, not optional — no implicit defaults in the IR):

```typescript
export type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly constraint: boolean;
  readonly index: boolean;
};
```

2. Remove `ForeignKeysConfig` type and `DEFAULT_FOREIGN_KEYS_CONFIG` constant from types.ts. Instead, add a `DEFAULT_FK_CONSTRAINT` and `DEFAULT_FK_INDEX` constant (both `true`):

```typescript
export const DEFAULT_FK_CONSTRAINT = true;
export const DEFAULT_FK_INDEX = true;
```

3. Remove `foreignKeys?: ForeignKeysConfig` from `SqlContract`.

4. Update `fk()` factory to accept the new fields:

```typescript
export function fk(
  columns: readonly string[],
  refTable: string,
  refColumns: readonly string[],
  opts?: { name?: string; constraint?: boolean; index?: boolean },
): ForeignKey {
  return {
    columns,
    references: { table: refTable, columns: refColumns },
    constraint: opts?.constraint ?? DEFAULT_FK_CONSTRAINT,
    index: opts?.index ?? DEFAULT_FK_INDEX,
    ...(opts?.name !== undefined && { name: opts.name }),
  };
}
```

5. Update exports in `exports/types.ts` to remove `ForeignKeysConfig` export and add the new defaults.

### Phase 2: Validators and JSON Schema

**Files:**
- `packages/2-sql/1-core/contract/src/validators.ts`
- `packages/2-sql/2-authoring/contract-ts/schemas/data-contract-sql-v1.json`
- `packages/2-sql/1-core/contract/test/validators.test.ts`

**Changes:**

1. **validators.ts**: Remove `ForeignKeysConfigSchema`. Update `ForeignKeySchema` to include `constraint: 'boolean'` and `index: 'boolean'`:

```typescript
const ForeignKeySchema = type.declare<ForeignKey>().type({
  columns: type.string.array().readonly(),
  references: ForeignKeyReferencesSchema,
  'name?': 'string',
  constraint: 'boolean',
  index: 'boolean',
});
```

2. Remove `'foreignKeys?': ForeignKeysConfigSchema` from `SqlContractSchema`.

3. **JSON Schema**: Remove `ForeignKeysConfig` from `$defs` and `foreignKeys` from top-level contract properties. Add `constraint` and `index` to the `ForeignKey` definition inside the FK array items schema.

4. **Tests**: Update validator tests to remove `ForeignKeysConfig` tests and add per-FK field validation tests.

### Phase 3: Builder state and table builder

**Files:**
- `packages/1-framework/2-authoring/contract/src/builder-state.ts`
- `packages/1-framework/2-authoring/contract/src/table-builder.ts`
- `packages/1-framework/2-authoring/contract/src/contract-builder.ts`

**Changes:**

1. **builder-state.ts**:
   - Update `ForeignKeyDef` to include optional `constraint?: boolean` and `index?: boolean`.
   - Rename `ForeignKeysConfigState` to `ForeignKeyDefaultsState` (or remove if we use a simpler name).
   - Rename `foreignKeys` field on `ContractBuilderState` to `foreignKeyDefaults`.

```typescript
export interface ForeignKeyDef {
  readonly columns: readonly string[];
  readonly references: {
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly name?: string;
  readonly constraint?: boolean;
  readonly index?: boolean;
}

export interface ForeignKeyDefaultsState {
  readonly constraint: boolean;
  readonly index: boolean;
}
```

2. **table-builder.ts**: Update `foreignKey()` method to accept an optional options object with `constraint` and `index`:

```typescript
foreignKey(
  columns: readonly string[],
  references: { table: string; columns: readonly string[] },
  opts?: { name?: string; constraint?: boolean; index?: boolean },
): TableBuilder<Name, Columns, PrimaryKey> {
  const fkDef: ForeignKeyDef = {
    columns,
    references,
    ...(opts?.name !== undefined && { name: opts.name }),
    ...(opts?.constraint !== undefined && { constraint: opts.constraint }),
    ...(opts?.index !== undefined && { index: opts.index }),
  };
  return new TableBuilder(
    this._state.name,
    this._state.columns,
    this._state.primaryKey,
    this._state.primaryKeyName,
    this._state.uniques,
    this._state.indexes,
    [...this._state.foreignKeys, fkDef],
  );
}
```

3. **contract-builder.ts**: Rename `foreignKeys()` to `foreignKeyDefaults()` for clarity that this is authoring sugar. Keep the same immutable-return pattern.

### Phase 4: SQL contract builder (materialization at build time)

**Files:**
- `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts`

**Changes:**

1. Rename `.foreignKeys()` method to `.foreignKeyDefaults()`.

2. In `.build()`, materialize defaults into each FK node. Where previously:

```typescript
const foreignKeys: ForeignKeysConfig = this.state.foreignKeys ?? DEFAULT_FOREIGN_KEYS_CONFIG;
```

Now:

```typescript
const fkDefaults = this.state.foreignKeyDefaults ?? {
  constraint: DEFAULT_FK_CONSTRAINT,
  index: DEFAULT_FK_INDEX,
};
```

And where FK entries are mapped from table state:

```typescript
const foreignKeys = (tableState.foreignKeys ?? []).map((fk) => ({
  columns: fk.columns,
  references: fk.references,
  constraint: fk.constraint ?? fkDefaults.constraint,
  index: fk.index ?? fkDefaults.index,
  ...(fk.name ? { name: fk.name } : {}),
}));
```

3. Remove `foreignKeys` from the top-level contract output (no longer `foreignKeys: fkConfig` at the contract root).

### Phase 5: Normalization

**Files:**
- `packages/2-sql/2-authoring/contract-ts/src/contract.ts`

**Changes:**

1. Remove the `normalizedForeignKeys` block that fills missing `foreignKeys` with `DEFAULT_FOREIGN_KEYS_CONFIG`.

2. Add per-FK normalization inside the table loop: for each FK entry in each table, if `constraint` or `index` is missing, fill with defaults:

```typescript
// Inside table normalization loop
if (table.foreignKeys) {
  normalizedTable.foreignKeys = table.foreignKeys.map((fk) => ({
    ...fk,
    constraint: fk.constraint ?? DEFAULT_FK_CONSTRAINT,
    index: fk.index ?? DEFAULT_FK_INDEX,
  }));
}
```

3. Remove `foreignKeys: normalizedForeignKeys` from the top-level return.

### Phase 6: Canonicalization and hashing

**Files:**
- `packages/1-framework/1-core/migration/control-plane/src/emission/canonicalization.ts`
- `packages/1-framework/1-core/migration/control-plane/src/emission/hashing.ts`

**Changes:**

1. **canonicalization.ts**: Remove `'foreignKeys'` from `TOP_LEVEL_ORDER`. The per-FK fields are already inside `storage.tables` which is already in the canonical form.

2. **hashing.ts**: Remove the `...ifDefined('foreignKeys', contract['foreignKeys'])` line from `computeStorageHash()`. The per-FK fields are part of `storage.tables.*.foreignKeys[]` entries and are automatically included in `storage` which is already hashed.

**Note:** This means changing per-FK `constraint`/`index` values will change the `storageHash` (correct behavior, since these are inside `storage`). This is actually more natural than the current design where the hash depends on a top-level field outside `storage`.

### Phase 7: Postgres migration planner

**Files:**
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
- `packages/3-targets/3-targets/postgres/test/migrations/planner.fk-config.test.ts`

**Changes:**

1. Remove the global `fkConfig` resolution:

```diff
- const fkConfig = options.contract.foreignKeys ?? DEFAULT_FOREIGN_KEYS_CONFIG;
- const fkColumnSets =
-   fkConfig.indexes === false
-     ? this.collectForeignKeyColumnSets(options.contract.storage.tables)
-     : new Set<string>();
```

2. Update `buildForeignKeyOperations()` to check `fk.constraint` per FK:

```typescript
for (const foreignKey of table.foreignKeys) {
  if (!foreignKey.constraint) continue; // skip FK constraint DDL
  // ... emit ALTER TABLE ADD CONSTRAINT
}
```

3. Update FK-backing index skip logic. Instead of a global `fkColumnSets`, build per-table sets from FKs with `index: false`:

```typescript
private collectSkippedFkIndexColumnSets(
  tables: SqlContract<SqlStorage>['storage']['tables'],
): Set<string> {
  const skipSets = new Set<string>();
  for (const [tableName, table] of Object.entries(tables)) {
    for (const fk of table.foreignKeys) {
      if (!fk.index) {
        skipSets.add(`${tableName}:${fk.columns.join(',')}`);
      }
    }
  }
  return skipSets;
}
```

4. Update `buildIndexOperations()` to use the new skip set.

5. **Tests**: Update test factory and test cases. The contract fixtures no longer have a top-level `foreignKeys`; instead, each FK entry in `storage.tables.*.foreignKeys[]` has `constraint` and `index` fields. All four combinations are still tested, but at the per-FK level.

### Phase 8: Schema verifier

**Files:**
- `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts`

**Changes:**

1. Remove `foreignKeysConfig` from `VerifySqlSchemaOptions`.

2. Instead of a global FK config check, iterate per-FK and check `fk.constraint`:

```typescript
// Verify FK constraints only for FKs that have constraint: true
const constraintFks = contractTable.foreignKeys.filter(fk => fk.constraint);
if (constraintFks.length > 0) {
  const fkStatuses = verifyForeignKeys(constraintFks, schemaTable.foreignKeys, ...);
  tableChildren.push(...fkStatuses);
}
```

3. For index verification, filter out FK-backing indexes where `fk.index === false`:

```typescript
let indexesToVerify = contractTable.indexes;
const fkColumnsToSkip = new Set(
  contractTable.foreignKeys
    .filter(fk => !fk.index)
    .map(fk => fk.columns.join(','))
);
if (fkColumnsToSkip.size > 0) {
  indexesToVerify = contractTable.indexes.filter(
    (index) => !fkColumnsToSkip.has(index.columns.join(','))
  );
}
```

### Phase 9: Fixtures and e2e tests

**Files:**
- `test/e2e/framework/test/fixtures/generated/contract.json`
- `test/e2e/framework/test/fixtures/generated/contract.d.ts`
- `packages/3-extensions/integration-kysely/test/fixtures/generated/contract.json`
- `test/e2e/framework/test/ddl.test.ts`

**Changes:**

1. Remove `"foreignKeys": { "constraints": true, "indexes": true }` from top-level contract JSON.
2. Add `"constraint": true, "index": true` to each FK entry in `storage.tables.*.foreignKeys[]`.
3. Update `contract.d.ts` to reflect the new `ForeignKey` shape.
4. Verify e2e tests still pass.

### Phase 10: ADR 161 rewrite

**Files:**
- `docs/architecture docs/adrs/ADR 161 - Explicit foreign key constraint and index configuration.md`

**Changes:**

Rewrite to document the per-FK design:

- **Decision section**: FK behavior is controlled per-node via `constraint` and `index` boolean fields on each `ForeignKey` entry. No global config exists in the canonical contract.
- **Builder sugar**: Document `foreignKeyDefaults()` as an authoring convenience that materializes into per-FK fields at build time.
- **Remove** "Out of scope: Per-FK overrides" — this is now the v1 shape.
- **Hashing**: Per-FK fields are inside `storage` and automatically contribute to `storageHash`.
- **Scope v2**: Capability gating remains deferred.

### Phase 11: Package exports and README updates

**Files:**
- `packages/2-sql/1-core/contract/package.json`
- `packages/2-sql/1-core/contract/README.md`
- `packages/2-sql/2-authoring/contract-ts/README.md`
- `packages/1-framework/2-authoring/contract/README.md`

**Changes:**

1. Remove `ForeignKeysConfig` from package exports.
2. Update READMEs to reflect the per-FK API.
3. Ensure `DEFAULT_FK_CONSTRAINT` and `DEFAULT_FK_INDEX` are exported from `@prisma-next/sql-contract`.

---

## Acceptance Criteria

### Functional Requirements

- [ ] Each `ForeignKey` entry in the contract IR has required `constraint: boolean` and `index: boolean` fields
- [ ] No global `foreignKeys` config exists on the `SqlContract` type or in emitted `contract.json`
- [ ] Builder `.foreignKeyDefaults()` sets defaults that are materialized into each FK at build time
- [ ] Builder `.foreignKey()` on table builder accepts optional `{ constraint, index }` options for per-FK override
- [ ] Normalization fills `constraint` and `index` on FK entries that lack them (for backward compat with older contract.json files)
- [ ] Postgres planner respects per-FK `constraint` and `index` flags
- [ ] Schema verifier respects per-FK `constraint` and `index` flags
- [ ] `storageHash` changes when per-FK flags change (automatic, since they're inside `storage`)
- [ ] All four combinations (true/true, true/false, false/true, false/false) work per-FK, not just globally
- [ ] Mixed FK configs within one contract work (e.g., one FK with `constraint: true`, another with `constraint: false`)

### Non-Functional Requirements

- [ ] No global mode flags in the canonical contract JSON
- [ ] FK entries are self-contained and interpretable without consulting any other part of the contract
- [ ] Builder API remains ergonomic for the common case (all FKs same config)

### Quality Gates

- [ ] All existing tests pass (updated for new shape)
- [ ] New tests for mixed per-FK configs within a single contract
- [ ] `pnpm lint:deps` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:e2e` passes

---

## File Change Summary

| File | Change Type |
|---|---|
| `packages/2-sql/1-core/contract/src/types.ts` | Modify: add per-FK fields, remove global config |
| `packages/2-sql/1-core/contract/src/factories.ts` | Modify: update `fk()` factory |
| `packages/2-sql/1-core/contract/src/exports/types.ts` | Modify: update exports |
| `packages/2-sql/1-core/contract/src/validators.ts` | Modify: update FK schema, remove global config schema |
| `packages/2-sql/1-core/contract/test/validators.test.ts` | Modify: update tests |
| `packages/1-framework/2-authoring/contract/src/builder-state.ts` | Modify: update FK def and builder state |
| `packages/1-framework/2-authoring/contract/src/table-builder.ts` | Modify: update `.foreignKey()` signature |
| `packages/1-framework/2-authoring/contract/src/contract-builder.ts` | Modify: rename to `.foreignKeyDefaults()` |
| `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts` | Modify: materialization logic, rename method |
| `packages/2-sql/2-authoring/contract-ts/src/contract.ts` | Modify: per-FK normalization |
| `packages/2-sql/2-authoring/contract-ts/schemas/data-contract-sql-v1.json` | Modify: JSON schema |
| `packages/2-sql/2-authoring/contract-ts/test/contract-builder.constraints.test.ts` | Modify: update tests |
| `packages/2-sql/2-authoring/contract-ts/test/contract.normalization.test.ts` | Modify: update tests |
| `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` | Modify: per-FK logic |
| `packages/3-targets/3-targets/postgres/test/migrations/planner.fk-config.test.ts` | Modify: update tests |
| `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts` | Modify: per-FK verification |
| `packages/1-framework/1-core/migration/control-plane/src/emission/canonicalization.ts` | Modify: remove from top-level order |
| `packages/1-framework/1-core/migration/control-plane/src/emission/hashing.ts` | Modify: remove global FK from hash input |
| `test/e2e/framework/test/fixtures/generated/contract.json` | Modify: update fixture |
| `test/e2e/framework/test/fixtures/generated/contract.d.ts` | Modify: update types |
| `packages/3-extensions/integration-kysely/test/fixtures/generated/contract.json` | Modify: update fixture |
| `docs/architecture docs/adrs/ADR 161 - ...` | Rewrite: per-FK design |
| Various READMEs | Modify: update API docs |

---

## References

- Will's review comment: https://github.com/prisma/prisma-next/pull/158#issuecomment-3949915291
- Current PR: https://github.com/prisma/prisma-next/pull/158
- ADR 161: `docs/architecture docs/adrs/ADR 161 - Explicit foreign key constraint and index configuration.md`
- ADR 003 (explicit over implicit)
- ADR 010 (canonicalization)
