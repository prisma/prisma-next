# `prisma-next db init` and `prisma-next db update`

Two complementary commands for managing database schema lifecycle.

## Overview

| Command | Purpose | Marker required? | Policy |
|---------|---------|-----------------|--------|
| `db init` | Sign an existing database under contract management | No (creates one) | Additive only |
| `db update` | Reconcile a managed database to the current contract | Yes | Additive + widening + destructive |

**`db init`** is run once per database to sign it under contract management. It introspects the live schema, plans additive operations to fill any gaps, executes them, and writes a contract marker (signature).

**`db update`** is run after every contract change. It reads the existing marker, introspects the live schema, plans a full reconciliation (including destructive operations like dropping extra columns/tables), executes the plan, and advances the marker.

## Typical workflow

```bash
# 1. Define schema and emit contract
prisma-next contract emit --config prisma-next.config.ts

# 2. Sign the database (first time only)
prisma-next db init --db $DATABASE_URL

# 3. Evolve the schema: add a column, change a type, etc.
#    Re-emit the contract after editing the schema
prisma-next contract emit --config prisma-next.config.ts

# 4. Preview what db update would do
prisma-next db update --db $DATABASE_URL --plan

# 5. Apply the update
prisma-next db update --db $DATABASE_URL
```

## How `db update` reacts to database state

### Scenario 1: Empty database (not signed)

**Behavior**: `db update` fails with `MARKER_REQUIRED`.

```
✖ Database must be signed before running db update (PN-RTM-3010)
  Why: No database signature (marker) found
  Fix: Run `prisma-next db init` first to sign the database, then re-run `prisma-next db update`
```

**Why**: `db update` is designed for databases already signed under contract management. It needs a signature to know the origin state. For fresh databases, use `db init` first.

**JSON output** (`--json`):
```json
{
  "ok": false,
  "code": "PN-RTM-3010",
  "domain": "RTM",
  "severity": "error",
  "summary": "Database must be signed first",
  "why": "No database signature (marker) found",
  "fix": "Run `prisma-next db init` first to sign the database, then re-run `prisma-next db update`"
}
```

### Scenario 2: Database initialized with expected contract hash (no-op)

**Behavior**: `db update` succeeds with 0 operations. The marker already matches the current contract, so the planner finds no differences between the introspected schema and the contract.

```
✔ Applied 0 operation(s)
  Signature: sha256:abc123...
```

**When this happens**: You run `db init` and then immediately run `db update` without changing the contract. Or you run `db update` twice in a row. The command is idempotent.

### Scenario 3: Local contract different from remote database (forward evolution)

**Behavior**: `db update` plans and applies the delta between the database's current schema and the new contract.

Example: you added a `nickname` column to the `user` table in your contract.

**Plan mode** (`--plan`):
```
✔ Planned 1 operation(s)
│
└─ Add column nickname on user [additive]

Destination hash: sha256:new-hash...

This is a dry run. No changes were applied.
Run without --plan to apply changes.
```

For SQL targets, plan mode also prints a DDL preview derived from planned operations.

**Apply mode** (default):
```
✔ Applied 1 operation(s)
  Signature: sha256:new-hash...
```

The planner supports three operation classes:
- **Additive**: Create tables, add columns, add indexes/constraints
- **Widening**: Relax nullability (NOT NULL → nullable)
- **Destructive**: Drop tables, drop columns, alter column types, tighten nullability

### Scenario 4: Local contract divergent from remote database (conflicts)

**Behavior**: `db update` fails with `PLANNING_FAILED` when the planner detects irreconcilable differences.

This happens when:
- The database has been manually altered in ways that conflict with the contract (e.g., a column type was changed to something incompatible)
- The contract requires changes that cannot be expressed as safe operations under current policy

```
✖ Migration planning failed due to conflicts (PLANNING_FAILED)
  Conflicts (showing 1 of 1):
    - [typeMismatch] Column user.email: expected text, found varchar(100)
```

**Recovery**: Inspect the conflict, reconcile the schema drift manually or update the contract to match reality, then re-run `db update`.

If the runner detects that the marker has drifted since planning (origin mismatch), it fails with `RUNNER_FAILED`:

```
✖ Origin mismatch (RUNNER_FAILED)
  Why: Marker drifted
  Fix: Inspect the reported conflict, reconcile schema drift if needed, then re-run `prisma-next db update`
```

## Key differences between `db init` and `db update`

| Aspect | `db init` | `db update` |
|--------|-----------|-------------|
| Requires marker | No | Yes |
| Creates marker | Yes (on apply) | Updates marker (on apply) |
| Operation policy | Additive only | Additive + widening + destructive |
| Execution checks | Disabled (fresh introspection) | Enabled (database may have drifted) |
| Existing marker handling | Idempotent if hash matches; error if mismatched | Reads marker as origin for plan |
| Use case | First-time signing | Ongoing schema evolution |

## Flags

Both commands share the same flag surface:

| Flag | Description |
|------|-------------|
| `--db <url>` | Database connection string |
| `--config <path>` | Path to `prisma-next.config.ts` |
| `--plan` | Preview planned operations without applying (dry run) |
| `--json [format]` | Output as JSON (`object` format only) |
| `-q, --quiet` | Quiet mode: errors only |
| `-v, --verbose` | Verbose output: debug info, timings |
| `--no-color` | Disable color output |

## Programmatic API

Both commands are available via the control client:

```typescript
import { createControlClient } from '@prisma-next/cli/control-api';

const client = createControlClient({
  family: sqlFamily,
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

// db init
const initResult = await client.dbInit({
  contractIR: contractJson,
  mode: 'apply',
  connection: databaseUrl,
});

// db update
const updateResult = await client.dbUpdate({
  contractIR: contractJson,
  mode: 'plan', // or 'apply'
  connection: databaseUrl,
});

await client.close();
```
