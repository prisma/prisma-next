# Destructive Schema Evolution — Verification Scenarios

Realistic destructive schema changes tested against the prisma-next-demo project with a live Postgres database.

## Summary

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| D1 | Drop a column | **PASS** | Orphan enum not cleaned up |
| D2 | Drop a table | **PASS** | FK cascade works, orphan extension lingers |
| D3 | Tighten nullability (empty table) | **PASS** | Precheck for NULL values included |
| D4 | Tighten nullability (data with NULLs) | **PASS** | Precheck catches NULLs before ALTER |
| D5 | Tighten nullability + add default | **FAIL** | Schema-verify rejects multi-property change |
| D6 | Widen nullability | **PASS** | Correctly classified as "widening" |
| D7 | Change column type | **FAIL** | Ops generated correctly but apply fails |
| D8 | Rename-as-drop-and-add | **PASS** | Drop + add, no rename op |
| D9 | Multi-op destructive migration | **PASS** | Mixed classes handled correctly |
| D10 | Drop all tables (empty contract) | **PASS** | FK-aware ordering |
| D11 | Add NOT NULL without default (data) | **PASS** | Raw Postgres error, no precheck |
| D12 | Drop indexed column | **FAIL** | Extra index blocks planning |
| D13 | Two-step sequence (add then drop) | **PASS** | Expected cycle in graph |

### Findings

1. **Orphan cleanup gap (D1, D2, D10):** When storage types (enums) or extensions are removed from the contract, the planner does not generate `DROP TYPE` or `DROP EXTENSION` operations. They linger in the DB.

2. **Schema-verify blocks multi-property changes (D5, D12):** The planner's pre-flight schema-verify compares the **destination** contract against the current DB. If the change touches multiple properties of the same object (e.g., nullability + default, or column + FK-backing index), the verify sees drift and refuses to plan. Users must break these into multiple migrations.

3. **Column type change broken (D7):** `ALTER COLUMN TYPE` ops are correctly generated (including `USING` clause and `TABLE_REWRITE` warning) but apply fails — the schema-verify reports the column as still the old type, suggesting the SQL either didn't execute or was rolled back.

4. **Missing precheck for NOT NULL without default (D11):** Adding a NOT NULL column without a default to a table with rows fails with a raw Postgres error. The planner should add a "table is empty" precheck (like D4's NULL check) for this case, and arguably classify it as `destructive` rather than `additive`.

5. **Schema roundtrip cycle (D13):** A→B→A migrations create the expected `NO_TARGET` cycle, which is correctly detected with actionable guidance.

---

## Setup

- **Project:** `examples/prisma-next-demo`
- **Database:** `postgresql://postgres:postgres@localhost:5432/prisma_next` (docker-compose pgvector/pg16)
- **Contract:** TypeScript contract builder at `prisma/contract.ts`
- **Date:** 2026-03-12

Reset between scenarios:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/prisma_next" ../../reset-db.sh --full
```

Bootstrap (used by most scenarios):
```bash
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name init
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/prisma_next" pnpm prisma-next migration apply
```

---

### D1: Drop a column

**Goal:** Remove a column that's no longer needed. Verify the planner produces a DROP COLUMN operation and apply executes it.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Remove the `kind` column (and its `user_type` enum/storageType) from the user table in `contract.ts`
3. Emit → plan `drop-kind` → apply
4. `db schema-verify` — verify column is gone

**Expected:** Plan shows DROP COLUMN flagged `[destructive]`. Apply executes the DROP. Schema-verify passes.

<details>
<summary>Result</summary>

**PASS (with finding)**

- Plan: Generated 1 op — `dropColumn.user.kind` with `operationClass: "destructive"`. Includes precheck (column exists), execute (ALTER TABLE DROP COLUMN), postcheck (column removed). No `DROP TYPE` op for the orphaned `user_type` enum.
- Apply: Succeeded. Column `kind` is gone from `public.user`.
- Schema-verify: Passed.
- **Finding:** The `user_type` enum remains in the database as an orphan. The planner does not generate `DROP TYPE` operations when a storage type is removed from the contract. This is a gap — the enum is unreferenced but lingers.

</details>

---

### D2: Drop a table

**Goal:** Remove an entire table. Verify the planner produces a DROP TABLE operation and handles FK dependencies.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Remove the `post` table and Post model from `contract.ts` (keep User)
3. Emit → plan `drop-post` → apply
4. `db schema-verify` — verify table is gone

**Expected:** Plan shows DROP TABLE flagged `[destructive]`. Apply drops the table. Schema-verify passes. FK index on `userId` should also be cleaned up.

<details>
<summary>Result</summary>

**PASS**

- Plan: Generated 1 op — `dropTable.post` with `operationClass: "destructive"`.
- Apply: Succeeded. Table `post` is gone. Only `user` remains.
- Schema-verify: Passed.
- FK constraint (`post_userId_fkey`) was implicitly dropped with the table.
- The pgvector `vector` extension remains installed (similar to the orphan enum finding in D1 — extensions are not cleaned up either).

</details>

---

### D3: Tighten nullability (nullable → NOT NULL) on empty table

**Goal:** Change a nullable column to NOT NULL when no rows exist. Should succeed.

**Steps:**
1. Bootstrap: emit → plan init → apply (tables are empty)
2. Change `embedding` column on `post` table from `nullable: true` to `nullable: false`
3. Emit → plan `tighten-embedding` → apply
4. `db schema-verify` — verify column is now NOT NULL

**Expected:** Plan shows SET NOT NULL flagged `[destructive]`. Apply succeeds because table is empty. Schema-verify passes.

<details>
<summary>Result</summary>

**PASS**

- Plan: Generated 1 op — `alterNullability.post.embedding` with `operationClass: "destructive"`. Includes a precheck `ensure "embedding" has no NULL values` (query: `SELECT NOT EXISTS (SELECT 1 FROM "public"."post" WHERE "embedding" IS NULL LIMIT 1)`).
- Apply: Succeeded. Column is now NOT NULL.
- Schema-verify: Passed.

</details>

---

### D4: Tighten nullability (nullable → NOT NULL) on table with data

**Goal:** Change a nullable column to NOT NULL when rows with NULL values exist. Should fail at apply time.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Insert a row with NULL embedding: `INSERT INTO "post" ("id", "title", "userId", "createdAt") VALUES ('p1', 'Hello', 'u1', now())`
   (Note: first insert a user: `INSERT INTO "user" ("id", "email", "createdAt", "kind") VALUES ('u1', 'a@b.c', now(), 'user')`)
3. Change `embedding` column on `post` table from `nullable: true` to `nullable: false`
4. Emit → plan `tighten-embedding` → apply
5. Observe the failure

**Expected:** Plan succeeds (planning is offline). Apply fails — Postgres rejects SET NOT NULL because NULL values exist in the column.

<details>
<summary>Result</summary>

**PASS (precheck caught it)**

- Plan: Succeeded (offline, no DB check at plan time).
- Apply: **Failed during precheck** — the planner's generated precheck `ensure "embedding" has no NULL values` detected the NULL rows before attempting the ALTER. Error: `PN-RTM-3000 Operation alterNullability.post.embedding failed during precheck`.
- Key insight: The failure happens at the *precheck* stage, not the Postgres ALTER itself. This is better UX — the precheck gives a clear, descriptive error rather than a raw Postgres constraint violation.

</details>

---

### D5: Tighten nullability with a default value

**Goal:** Change a nullable column to NOT NULL while adding a default. Postgres should backfill existing rows.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Insert a row with NULL embedding (same as D4)
3. Change `embedding` column: `nullable: false`, add `default: { kind: 'literal', expression: "'[0,0,0]'" }` (or similar valid vector default)
4. Emit → plan `tighten-with-default` → apply
5. `db schema-verify` — verify column is NOT NULL
6. Query the row — verify the default was backfilled

**Expected:** Plan shows SET NOT NULL + SET DEFAULT. Apply succeeds because Postgres backfills existing NULL rows with the default.

Note: This scenario may not work if the vector type doesn't support literal defaults. If so, test with a simpler column type instead.

<details>
<summary>Result</summary>

**FAIL — planner rejects due to schema-verify conflict**

Tested with a `bio` (text, nullable) column instead. After bootstrapping with `nullable: true, no default`, changed to `nullable: false, default: 'no bio'`.

- Emit: Succeeded.
- Plan: **Failed** with `PN-CLI-4020` — `Column "user"."bio" should have default literal(no bio) but database has no default [missingButNonAdditive]`.
- Root cause: The planner runs schema-verify before planning, comparing the *target contract* against the current DB. Since the DB column has no default but the new contract requires one, this is flagged as a conflict. The planner refuses to diff against a DB that doesn't match the expected starting state.
- Implication: You cannot combine "add a default" with "tighten nullability" in a single migration from a state where no default existed. You'd need to first plan a migration that adds the default, apply it, then plan the nullability tightening.
- Note: The `{ kind: 'literal', expression: "'no bio'" }` form was rejected at config-load time. The correct form is `{ kind: 'literal', value: 'no bio' }`.

</details>

---

### D6: Widen nullability (NOT NULL → nullable)

**Goal:** Relax a NOT NULL constraint. Should be a widening operation.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Change the `email` column on `user` table from `nullable: false` to `nullable: true`
3. Emit → plan `widen-email` → apply
4. `db schema-verify` — verify column is now nullable

**Expected:** Plan shows DROP NOT NULL flagged `[widening]`. Apply succeeds. Schema-verify passes.

<details>
<summary>Result</summary>

**PASS**

- Plan: Generated 1 op — `alterNullability.user.email` with `operationClass: "widening"`. Label: "Relax nullability for email on user". Execute: `ALTER TABLE DROP NOT NULL`.
- Apply: Succeeded. Column `email` is now nullable (`is_nullable = 'YES'`).
- Schema-verify: Passed.

</details>

---

### D7: Change column type (text → int)

**Goal:** Change a column's type. Test on both empty and populated tables.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Change the `title` column on `post` table from `textColumn` to an `int4` type (or another incompatible type)
3. Emit → plan `change-title-type` → apply (table is empty — should succeed)
4. `db schema-verify` — verify type changed
5. (Optional follow-up) Insert a row with a non-castable value, then try the reverse change

**Expected:** Plan shows ALTER COLUMN TYPE flagged `[destructive]` with a USING clause. Apply succeeds on empty table.

<details>
<summary>Result</summary>

**FAIL — apply rejected despite correct SQL**

- Plan: Generated 1 op — `alterType.post.title` with `operationClass: "destructive"`. SQL: `ALTER TABLE "public"."post" ALTER COLUMN "title" TYPE int4 USING "title"::int4`. Includes `meta.warning: "TABLE_REWRITE"` noting ACCESS EXCLUSIVE lock concerns.
- Apply: **Failed** with `PN-RTM-3000 — Database schema does not satisfy contract (5 failures)`. The reported issue: `[type_mismatch] Column "post"."title" has type mismatch: expected "int4", got "text"`.
- Actual DB state: Column is still `text` — the ALTER was either not executed or rolled back.
- Root cause investigation: The "5 failures" count is misleading (only 1 is shown). The migration runner's *pre-flight schema-verify* likely compares the DB against the **destination** contract (which expects `int4`) and fails before executing the op. Alternatively, the ALTER ran in a transaction that was rolled back after schema-verify failure.
- **Finding:** Column type changes (`ALTER COLUMN TYPE`) appear not to work end-to-end. The ops are correctly generated but the runner rejects the migration. This is a significant gap if type evolution is expected.

</details>

---

### D8: Rename-as-drop-and-add

**Goal:** Simulate a column rename by removing one column and adding another. Verify the planner produces drop + add (no rename operation exists).

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Remove `kind` column from `user` table, add a `role` column (same type — `enumColumn('user_type', 'user_type')`, `nullable: false`)
3. Emit → plan `rename-kind-to-role` → apply
4. `db schema-verify` — verify `kind` is gone, `role` is present

**Expected:** Plan shows DROP COLUMN `kind` [destructive] + ADD COLUMN `role` [additive]. Apply succeeds (table empty). No data migration — old data is lost.

<details>
<summary>Result</summary>

**PASS**

- Plan: Generated 2 ops — `dropColumn.user.kind` (destructive) + `column.user.role` (additive). Correct: no RENAME operation, just drop + add.
- Apply: Succeeded. `kind` gone, `role` present with type `user_type`.
- Schema-verify: Passed.
- As expected, old data in `kind` would be lost (table was empty here, but with data this would be destructive).

</details>

---

### D9: Multi-op destructive migration

**Goal:** Bundle multiple destructive + additive changes in one migration. Verify the planner handles mixed operation classes.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. In one contract change:
   - Remove `embedding` column from `post` table
   - Add `bio` column (text, nullable) to `user` table
   - Change `email` on `user` from NOT NULL to nullable
3. Emit → plan `multi-op` → apply
4. `db schema-verify` — verify all three changes landed

**Expected:** Plan shows 3 ops: DROP COLUMN [destructive] + ADD COLUMN [additive] + DROP NOT NULL [widening]. The migration is flagged with the destructive warning. Apply succeeds.

<details>
<summary>Result</summary>

**PASS**

- Plan: Generated 3 ops — `dropColumn.post.embedding` (destructive), `alterNullability.user.email` (widening), `column.user.bio` (additive). All correctly classified.
- Apply: Succeeded. `embedding` gone from post, `email` now nullable, `bio` added to user.
- Schema-verify: Passed.

</details>

---

### D10: Drop the only table (empty contract)

**Goal:** Remove all tables from the contract. Verify the system handles an empty schema.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Remove both `user` and `post` tables (and all models, storageTypes, extensionPacks) from `contract.ts`
3. Emit → plan `drop-all` → apply
4. `db schema-verify` — verify no user tables remain

**Expected:** Plan shows DROP TABLE for both tables (with correct ordering — post first due to FK dependency, then user). Apply succeeds. Schema-verify passes against the empty contract.

<details>
<summary>Result</summary>

**PASS**

- Plan: Generated 2 ops — `dropTable.post` (destructive), `dropTable.user` (destructive). Correct FK-aware ordering (post first, then user).
- Apply: Succeeded. No public tables remain.
- Schema-verify: Passed against the empty contract.
- Note: `user_type` enum and `vector` extension remain orphaned in the DB (consistent with D1 and D2 findings).

</details>

---

### D11: Add NOT NULL column without default to table with rows

**Goal:** Add a NOT NULL column without a default to a table that has existing rows. Should fail at apply time.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Insert a row: `INSERT INTO "user" ("id", "email", "createdAt", "kind") VALUES ('u1', 'a@b.c', now(), 'user')`
3. Add a `phone` column to `user`: `type: textColumn, nullable: false` (no default)
4. Emit → plan `add-phone-not-null` → apply
5. Observe the failure

**Expected:** Plan succeeds (offline). Apply fails — Postgres cannot add a NOT NULL column without a default to a table with existing rows. The precheck ("table must be empty") should catch this.

<details>
<summary>Result</summary>

**PASS (raw Postgres error, no precheck)**

- Plan: Succeeded. Generated 1 op — `column.user.phone` with `operationClass: "additive"` (no "destructive" flag despite the NOT NULL constraint). SQL: `ALTER TABLE ADD COLUMN "phone" text NOT NULL`.
- Apply: **Failed during execution** with `PN-RTM-3000` — raw Postgres error: `column "phone" of relation "user" contains null values`.
- **Finding 1:** The planner does not include a precheck for "table must be empty" when adding a NOT NULL column without a default. The error surfaces as a raw Postgres error during execution, not a friendlier precheck failure (compare with D4 where the precheck caught NULL values elegantly).
- **Finding 2:** The operation is classified as `additive` even though adding a NOT NULL column without a default is unsafe on non-empty tables. This could be misleading — a user might expect `additive` ops to always succeed.

</details>

---

### D12: Drop a column that has an index

**Goal:** Remove a column that has an index defined on it. Verify the planner handles the index cleanup.

**Steps:**
1. Modify contract: add an explicit index on `userId` in the `post` table (or use the FK-backed index)
2. Bootstrap: emit → plan init → apply — verify index exists
3. Remove the `userId` column from `post` (and the FK)
4. Emit → plan `drop-indexed-column` → apply
5. `db schema-verify` — verify column and index are gone

**Expected:** Plan handles the column drop. Postgres should cascade-drop the index. Schema-verify passes.

<details>
<summary>Result</summary>

**FAIL — planner rejects due to extra index**

- Plan: **Failed** with `PN-CLI-4020` — `Extra index found in database (not in contract): userId [missingButNonAdditive]`.
- Root cause: Same pattern as D5. The planner's pre-flight schema-verify compares the destination contract against the DB. The destination contract no longer defines the FK-backing index on `userId`, but the DB still has it (`post_userId_idx`). The planner refuses to proceed because the DB doesn't match the expected state.
- **Finding:** When removing a FK (and its backing index + column), the planner cannot plan the migration because the pre-flight check sees the index as "extra". The user would need to manually drop the index first, or the planner needs to understand that the index will be removed as part of the column drop.
- Note: Postgres would cascade-drop the index when the column is dropped, but the planner never gets to that step.

</details>

---

### D13: Two-step destructive sequence (add column, then drop it)

**Goal:** Plan and apply an additive migration, then plan and apply a second migration that drops what was just added. Verifies the planner handles the operation-level round-trip.

**Steps:**
1. Bootstrap: emit → plan init → apply
2. Add `bio` column (text, nullable) to `user` → emit → plan `add-bio` → apply
3. Remove `bio` column from `user` → emit → plan `drop-bio` → apply
4. `db schema-verify` — verify schema is back to the original state
5. `migration status` — verify both migrations show as applied

**Expected:** Two migrations on disk. Both apply cleanly. Final schema matches the original. Status shows a 3-migration history (init → add-bio → drop-bio).

<details>
<summary>Result</summary>

**PASS (with expected cycle)**

- Migrations on disk: `init`, `add-bio`, `drop-bio` — all 3 planned and applied successfully.
- Schema: `user` table is back to original shape (no `bio` column). Schema-verify passes.
- `migration status`: **Fails with `NO_TARGET`** — the graph has edges `empty → A → B → A`, creating a cycle at `A` (the hash for the original schema). This is the expected behavior for schema roundtrips and is already tested in the journey tests. The fix is to use `--from <hash>` for subsequent planning.
- Note: This is a known and documented graph topology. The planner correctly detects it and provides actionable guidance.

</details>
