# On-Disk Migrations — User Stories

## Current capabilities

| Command | Status | Online? | Purpose |
|---|---|---|---|
| `contract emit` | ✅ | No | Generate `contract.json` + `contract.d.ts` from TypeScript contract |
| `db init` | ✅ | Yes | Bootstrap a fresh DB from contract (introspect → plan → apply → sign) |
| `db verify` | ✅ | Yes | Check DB marker matches contract |
| `db schema-verify` | ✅ | Yes | Check DB schema satisfies contract |
| `db sign` | ✅ | Yes | Write contract marker to DB |
| `db introspect` | ✅ | Yes | Inspect live DB schema |
| `migration plan` | ✅ | No | Diff contracts, write migration package to disk |
| `migration verify` | ✅ | No | Verify migration package integrity (edgeId) |
| `migration apply` | ✅ | Yes | Execute on-disk migrations against live DB |

## User story 1: New project, no database

**As a** developer starting a new project,
**I want to** define my schema and set up the database,
**so that** I can start building features.

### With `db init` (quick start, no migration history)

```bash
# 1. Write your contract in TypeScript (prisma/contract.ts)
# 2. Create prisma-next.config.ts with family, target, adapter, driver

# 3. Generate contract artifacts
prisma-next contract emit

# 4. Create and populate the database in one step
prisma-next db init --db $DATABASE_URL
```

This introspects the (empty) database, plans additive operations, executes them, and writes the contract marker. No migration history is created on disk.

### With migrations (recommended for teams)

```bash
# 1–3 same as above

# 4. Plan the initial migration (offline)
prisma-next migration plan --name initial

# 5. Apply it to the database
prisma-next migration apply --db $DATABASE_URL
```

## User story 2: Existing project, existing database

**As a** developer adopting prisma-next on an existing project,
**I want to** bring my database under contract management,
**so that** I can track schema changes going forward.

```bash
# 1. Write a contract matching your existing schema
# 2. Create prisma-next.config.ts

# 3. Generate contract artifacts
prisma-next contract emit

# 4. Verify the contract matches the live schema
prisma-next db schema-verify --db $DATABASE_URL

# 5. Sign the database (writes marker)
prisma-next db sign --db $DATABASE_URL

# 6. Optionally, create a baseline migration for the record
prisma-next migration plan --name baseline
```

From here, the database is under contract management. Future schema changes go through the contract → emit → plan cycle.

## User story 3: Day-to-day schema iteration

**As a** developer making schema changes,
**I want to** iterate on my contract and generate migrations,
**so that** schema changes are tracked and reviewable.

```bash
# 1. Edit the contract (add table, add column, etc.)

# 2. Re-emit the contract
prisma-next contract emit

# 3. Plan the migration (offline — diffs against last migration)
prisma-next migration plan --name add-posts

# 4. Review the migration package in migrations/<timestamp>_add_posts/
#    - migration.json: manifest with from/to hashes
#    - ops.json: SQL operations

# 5. Apply to database
prisma-next migration apply --db $DATABASE_URL
```

## User story 4: Destructive change (column/table removal)

**As a** developer removing a column or table,
**I want to** plan and apply the destructive change,
**so that** my migration history reflects the full schema evolution.

```bash
# 1. Remove a column from the contract
# 2. Re-emit
prisma-next contract emit

# 3. Plan — generates a destructive migration
prisma-next migration plan --name drop-name
# ✔ Planned 1 operation(s)
# └─ dropColumn.user.name [Drop column name from user]

# 4. Apply to database
prisma-next migration apply --db $DATABASE_URL
```

## User story 5: Verifying migration integrity

**As a** developer or CI pipeline,
**I want to** verify that migration files haven't been tampered with,
**so that** I can trust what will be applied to production.

```bash
# Verify a specific migration package
prisma-next migration verify --dir migrations/20260225_100000_add_posts

# Output: ✔ Migration verified — edgeId matches
# Or:     ✘ Migration tampered — edgeId mismatch
```

## User story 6: Manual migration (escape hatch)

Manual migration scaffolding (`migration new`) has been removed. The scaffolded drafts required users to manually fill in correct `from`/`to` hashes, a valid `toContract`, and correct operations — making the command unusable in practice. A future version will scaffold from real inputs (e.g. default `to` to the current emitted contract and generate ops via planning).
