# Data Migration Scenarios

A near-exhaustive enumeration of schema evolutions that require data migrations. For each scenario: what the user is doing, why a purely structural migration is insufficient, what information gap the user must fill, and how it maps to our solution.

**Authoring model**: Data migrations are authored using the ORM/query builder, serialized to JSON ASTs at verification time, and rendered to SQL by the target adapter at apply time. Scenarios that can't be expressed via the query builder are noted.

---

## S1. Computed backfill (new NOT NULL column)

**Schema change**: Add a new NOT NULL column to an existing table.

**Example**: Add `display_name VARCHAR NOT NULL` to `users`.

**Why data migration is needed**: The column must have a value for every existing row before the NOT NULL constraint can be applied. A static default may not be appropriate — the value might need to be derived from existing data (e.g., `display_name = first_name || ' ' || last_name`).

**Information gap**: Where does the value come from? The system knows a value is needed but can't know the derivation logic.

**Solution fit**: Planner auto-detects (NOT NULL without default). User authors an UPDATE via the query builder. Phasing ensures the nullable column exists (phase 1) before the data migration populates it (phase 2), then NOT NULL is applied (phase 3). Check query: `client.users.findFirst({ where: { displayName: null } })`.

---

## S2. Lossy type change

**Schema change**: Change a column's type where the conversion is ambiguous or lossy.

**Example**: `price FLOAT` → `price_cents BIGINT`, or `status INTEGER` → `status VARCHAR`.

**Why data migration is needed**: The database can't infer the conversion. `FLOAT 29.99` → `BIGINT` could mean `30` (round), `29` (truncate), or `2999` (multiply by 100). An integer enum `{1,2,3}` → varchar requires a lookup table the system doesn't have.

**Information gap**: What is the mapping from old values to new values?

**Solution fit**: Planner auto-detects (non-widening type change). For same-column changes, uses temp column strategy — creates a temp column of the target type, user writes the conversion, planner drops original and renames temp. For column renames with type change, standard phasing handles it (add new column, data migration, drop old). Query builder expressiveness for conversion expressions (multiply, cast, lookup) needs validation (OQ-5).

---

## S3. Column split

**Schema change**: Remove one column, add two or more columns.

**Example**: `name VARCHAR` → `first_name VARCHAR` + `last_name VARCHAR`.

**Why data migration is needed**: The system sees a column removal and column additions — it doesn't know they're related. Even if it infers a split, the parsing logic is ambiguous (split on space? first space? last space? what about mononyms?).

**Information gap**: How is the single value decomposed into multiple values?

**Solution fit**: Planner detects the NOT NULL adds and scaffolds. User writes an UPDATE using the query builder with expression functions (e.g., `split_part`). Old `name` column available in phase 2 because drops are phase 3. Check query: `client.users.findFirst({ where: { firstName: null } })`. This is the April VP1 canonical example.

---

## S4. Column merge

**Schema change**: Remove two or more columns, add one column.

**Example**: `first_name` + `last_name` → `full_name`.

**Why data migration is needed**: The system can't know the combination logic — concatenation order, separator, null handling.

**Information gap**: How are multiple values combined into one?

**Solution fit**: Same mechanics as S3 — planner detects NOT NULL add, user writes UPDATE via query builder, old columns available in phase 2.

---

## S5. Table split (vertical)

**Schema change**: One table becomes two, with a FK connecting them.

**Example**: `users(id, name, email, bio, avatar_url)` → `users(id, name, email)` + `user_profiles(id, user_id FK, bio, avatar_url)`.

**Why data migration is needed**: Existing rows in `users` need corresponding rows created in `user_profiles`, with data copied to the right columns and FKs set up correctly.

**Information gap**: Which columns move to which table? (Often inferrable from the schema diff, but the actual data copying still requires execution.)

**Solution fit**: Planner detects NOT NULL FK on new table. User writes INSERT...SELECT via the query builder to copy data from the old table to the new one. Old columns available in phase 2. FK constraint applied in phase 3. Requires the query builder to support INSERT...SELECT (OQ-5).

---

## S6. Table split (horizontal)

**Schema change**: One table becomes two with the same schema, rows partitioned between them.

**Example**: `orders` → `active_orders` + `archived_orders`.

**Why data migration is needed**: The system has no way to know the partitioning predicate — which rows go where.

**Information gap**: What predicate determines which rows go to which table?

**Solution fit**: **Detection gap** — may not trigger auto-detection if new tables don't have NOT NULL columns without defaults (OQ-4). User must manually create the data migration. The execution model works: user writes INSERT...SELECT with WHERE predicates via the query builder, old table available in phase 2. Requires INSERT...SELECT support (OQ-5).

---

## S7. Table merge

**Schema change**: Two tables become one.

**Example**: `user_addresses` + `user_contacts` → `user_info`.

**Why data migration is needed**: Key conflicts and deduplication. If both tables have a row for the same user, which values win? How are columns mapped?

**Information gap**: Deduplication strategy and column mapping.

**Solution fit**: Planner detects NOT NULL columns on new table. User writes INSERT...SELECT and UPDATE with joins via the query builder. Old tables available in phase 2. Complex deduplication logic may push query builder expressiveness (OQ-5).

---

## S8. Semantic reinterpretation (no structural change)

**Schema change**: None — the schema is identical, but the meaning of values changes.

**Example**: `price` column was storing dollars, now represents cents. Or status integer codes are remapped.

**Why data migration is needed**: The contract hash doesn't change (schema is identical), but existing data needs transformation. Without a data migration, existing rows silently have wrong semantics.

**Information gap**: What is the old-to-new value mapping? (Note: this is also a case where the planner cannot auto-detect the need — the user must initiate it.)

**Solution fit**: **Out of scope for v1.** No structural change means no graph edge to attach the data migration to. Related to "pure data migrations (A→A)" which are deferred. The user would need to pair this with a structural change (e.g., rename the column) or handle it outside the migration system.

---

## S9. Denormalization / materialized column

**Schema change**: Add a column whose value is derived from data in other tables.

**Example**: Add `orders.item_count` backfilled from `COUNT(order_items WHERE order_id = orders.id)`.

**Why data migration is needed**: The value is a cross-table aggregation — can't be expressed as a column default. Requires a query against related tables to populate.

**Information gap**: What is the aggregation/derivation expression, and which tables/joins are involved?

**Solution fit**: Planner detects NOT NULL add. User writes an UPDATE with subquery via the query builder. Requires subquery/aggregation support in UPDATE context (OQ-5).

---

## S10. Normalization / extraction

**Schema change**: Denormalized data in an existing table is extracted into a new table with a FK back.

**Example**: `orders(customer_name, customer_email)` → new `customers(id, name, email)` table + `orders.customer_id FK`.

**Why data migration is needed**: Rows in the new table must be created from distinct values in the existing table (deduplication), then FKs in the original table must be populated to point at the new rows.

**Information gap**: What constitutes a "unique" entity for deduplication (match on email? name? both?)? When duplicates have conflicting values, which wins?

**Solution fit**: Planner detects NOT NULL columns on new table and NOT NULL FK. User writes INSERT...SELECT DISTINCT and UPDATE with joins via the query builder. Complex scenario — deduplication, UUID generation, FK wiring. May push query builder expressiveness limits (OQ-5). FK constraint applied in phase 3 catches incomplete wiring.

---

## S11. Key / identity change

**Schema change**: Change the primary key column type or strategy.

**Example**: `users.id SERIAL` → `users.id UUID`, with all FK references updated.

**Why data migration is needed**: New identifiers must be generated for every existing row. Every table with a FK referencing the old key must be updated to use the new identifier. This cascades across the entire FK graph.

**Information gap**: How are new identifiers generated (UUIDv4? UUIDv7? deterministic hash of old ID?)? The cascading FK updates are mechanical but must be orchestrated correctly.

**Solution fit**: Planner detects type changes per-column, but **cross-table coordination is a gap** (OQ-3). The planner would need FK graph awareness to emit coordinated temp columns across all referencing tables. For v1, the user authors this manually via `migration new`. The execution model works — the query builder can express the UPDATE with joins — but scaffolding is manual.

---

## S12. Encoding / format change

**Schema change**: Column type may or may not change, but the encoding or format of stored values changes.

**Example**: JSON blob restructured (keys renamed, nesting changed), date format changed (`YYYY-MM-DD` → ISO 8601 with timezone), timestamp becomes timezone-aware (`TIMESTAMP` → `TIMESTAMPTZ` — what timezone to assume for existing values?).

**Why data migration is needed**: Existing values need transformation to match the new format. The system can't know the mapping without user input.

**Information gap**: What is the transformation from old format to new? For timezone-naive → timezone-aware: what timezone should be assumed for existing data?

**Solution fit**: Type changes (TIMESTAMP → TIMESTAMPTZ) are auto-detected. User writes conversion via query builder. Same-type format changes (JSON restructuring) are S8 territory — no structural diff, deferred. Query builder needs to support timezone and JSON functions (OQ-5).

---

## S13. Data-dependent constraint enforcement

**Schema change**: Add a constraint (UNIQUE, NOT NULL, CHECK, FK) to a column that may have existing violations.

**Example**: Add `UNIQUE` to `users.email` when duplicates exist. Add `NOT NULL` to `users.phone` when nulls exist. Add `CHECK (age >= 0)` when negative values exist.

**Why data migration is needed**: The constraint will be rejected by the database if existing data violates it. The user must decide how to resolve violations before the constraint can be applied.

**Information gap**: How to handle violations — delete duplicates (which one to keep?), replace nulls (with what value?), fix invalid values (how?)?

**Solution fit**: **Op partitioning gap** (OQ-1). Constraint additions (UNIQUE, CHECK) are classified as `additive` and would run in phase 1, before the data migration. They need to run in phase 3, after violations are fixed. Workaround: user can use `migration new` with manual op ordering. Proper fix requires the operation dependency model.

---

## S14. Data seeding

**Schema change**: Add a new table that must contain reference data before other tables can FK to it.

**Example**: Add a `countries` lookup table. Existing `addresses.country_code` column becomes a FK to `countries.code`. The `countries` table must be populated with reference data first.

**Why data migration is needed**: The new table is empty after creation. FK constraints on existing tables will fail unless the reference data exists. This data doesn't come from existing tables — it's external.

**Information gap**: What is the reference data? (Often a static dataset, but the system can't generate it.)

**Solution fit**: Planner detects NOT NULL FK. User writes INSERT statements via query builder to seed the reference data, then UPDATE to wire FKs. Check convention: `return false` (always run — seeding is idempotent via upsert or the check doesn't map cleanly to "find violations"). Table created in phase 1, FK applied in phase 3.

---

## S15. Soft delete ↔ hard delete

**Schema change**: Add or remove a `deleted_at TIMESTAMP` column, changing deletion semantics.

**Example (soft → hard)**: Remove `deleted_at` column. Rows where `deleted_at IS NOT NULL` must be actually deleted first, or the "deleted" data persists in the table without any marker.

**Example (hard → soft)**: Add `deleted_at` column. Existing rows should have `deleted_at = NULL` (trivial — nullable column add). But if there's historical data about deletions elsewhere (audit log), the user may want to backfill.

**Why data migration is needed**: Removing `deleted_at` without deleting soft-deleted rows leaves ghost data. The system can detect the column removal but can't know that rows need filtering.

**Information gap**: Should soft-deleted rows be hard-deleted, archived to another table, or left as-is?

**Solution fit**: **No auto-detection** — the planner can't infer semantic meaning of `deleted_at` from a column drop. User creates the data migration manually. The execution model works: user writes DELETE via query builder, old column available in phase 2 (drop is phase 3).

---

## S16. Encryption / hashing — OUT OF SCOPE

**Schema change**: Column type may change (e.g., `VARCHAR` → `BYTEA`), or stay the same but values must be transformed.

**Example**: `users.password VARCHAR` (plaintext) → bcrypt hashed. `users.ssn VARCHAR` → encrypted with application-level key.

**Why data migration is needed**: Values must be irreversibly transformed. The transformation requires external dependencies (bcrypt library, encryption keys) that are outside the database.

**Out of scope**: This requires application-level code (Node.js crypto libraries, key management) that cannot be expressed as database queries. The query builder cannot produce bcrypt hashes or encrypt with application keys. Must be handled outside the migration system — e.g., a separate script run before or after the migration.

---

## S17. Audit trail backfill — PARTIALLY SUPPORTED

**Schema change**: Add `created_by`/`modified_by`/`created_at` columns that should be populated from historical data.

**Example**: Add `users.created_by UUID REFERENCES admins(id) NOT NULL` to an existing table.

**Why data migration is needed**: Historical values may exist in audit logs, another table, or an external system. A static default ("system") may be acceptable but loses provenance.

**Information gap**: Where does the historical data come from? Is a static default acceptable, or must real values be sourced?

**Solution fit**: Planner detects NOT NULL add. If the source is another database table (e.g., audit log table), the user can write an UPDATE with join via the query builder. If the source is an external system, this is out of scope (same as S16 — requires application-level code). A static default is trivially expressible.

---

## S18. Multi-tenant isolation

**Schema change**: Add a `tenant_id` column (NOT NULL, FK) to existing tables in a system being converted to multi-tenant.

**Example**: Add `tenant_id UUID NOT NULL REFERENCES tenants(id)` to `users`, `orders`, and all other tables.

**Why data migration is needed**: Every existing row needs a tenant assignment. If there's currently one implicit tenant, a default works. If data must be partitioned across tenants based on some logic, the user must specify the mapping.

**Information gap**: How are existing rows assigned to tenants? Single default tenant, or a mapping based on existing data (e.g., domain in email, organization FK)?

**Solution fit**: Planner detects NOT NULL adds on each table. Single data migration handles all tables — user writes multiple UPDATE statements via query builder. Simple case (single default tenant) is a literal value assignment. Complex case (mapping based on existing data) requires UPDATE with expressions or joins. Check query: `client.users.findFirst({ where: { tenantId: null } })`.
