# @prisma-next/cli

Command-line interface for Prisma Next contract emission and management.

## Overview

The CLI provides commands for emitting canonical `contract.json` and `contract.d.ts` files from TypeScript-authored contracts. It enforces import allowlists and validates contract purity to ensure deterministic, reproducible artifacts. Generated files include metadata and warning headers to indicate they're generated artifacts and should not be edited manually.

## Purpose

Provide a command-line interface that:
- Loads TypeScript-authored contracts using esbuild with import allowlisting
- Validates contract purity (JSON-serializable, no functions/getters)
- Invokes the emitter to produce canonical artifacts
- Handles all file I/O operations (CLI handles I/O; emitter returns strings)

## Responsibilities

- **TS Contract Loading**: Bundle and load TypeScript contract files with import allowlist enforcement
- **CLI Command Interface**: Parse arguments and route to command handlers using commander
- **File I/O**: Read TS contracts, write emitted artifacts (`contract.json`, `contract.d.ts`)
- **Extension Pack Descriptor Assembly**: Collect adapter and extension descriptors for emission
- **Help Output Formatting**: Custom styled help output with command trees and formatted descriptions
- **Config Management**: Load and validate `prisma-next.config.ts` files using Arktype validation
- **CLI Binary Compatibility**: Build emits `dist/cli.mjs` and also writes a compatibility shim at `dist/cli.js`

### Wiring validation

The CLI performs **wiring validation** at the composition boundary: it ensures the emitted contract artifacts are compatible with the descriptors wired in `prisma-next.config.ts`.

This prevents runtime mismatches (for example: a contract that declares extension packs, but a config that doesn’t provide the matching descriptors).

Commands that enforce wiring validation:
- **`db verify`**
- **`db sign`**
- **`db init`**
- **`db update`**

If you hit a wiring validation error: add the required descriptors to `config.extensionPacks` (matched by descriptor `id`) and re-run the command.

**Note**: Control plane domain actions (database verification, contract emission) are implemented in `@prisma-next/core-control-plane`. The CLI uses the control plane domain actions programmatically but does not define control plane types itself.

## Command Descriptions

Commands use separate short and long descriptions via `setCommandDescriptions()`:

- **Short description**: One-liner used in command trees and headers (e.g., "Emit signed contract artifacts")
- **Long description**: Multiline text shown at the bottom of help output with detailed context

See `src/utils/command-helpers.ts` for `setCommandDescriptions()` and `getLongDescription()`.

## Commands

### `prisma-next contract emit` (canonical)

Emit `contract.json` and `contract.d.ts` from `config.contract`.

**Canonical command:**
```bash
prisma-next contract emit [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Config File Requirements:**

The `contract emit` command does not require a `driver` in the config since it doesn't connect to a database:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgres from '@prisma-next/target-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
});
```

Options:
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next contract emit

# JSON output
prisma-next contract emit --json

# Verbose output
prisma-next contract emit -v
```

### `prisma-next db verify`

Verify that a database instance matches the emitted contract by checking the marker first and, by default, the live schema structure second.

**Command:**
```bash
prisma-next db verify [--db <url>] [--config <path>] [--fast] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--fast`: Skip structural schema verification and only check the database marker
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next db verify

# Specify database URL
prisma-next db verify --db postgresql://user:pass@localhost/db

# Marker-only verification when callers accept the trade-off
prisma-next db verify --db postgresql://user:pass@localhost/db --fast

# JSON output
prisma-next db verify --json

# Verbose output
prisma-next db verify -v
```

**Config File Requirements:**

The `db verify` command requires a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/target-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
  db: {
    connection: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Verification Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Creates a `ControlPlaneStack` via `createControlPlaneStack()` and passes it to `config.family.create(stack)` to create a family instance
4. **Verify Marker**: Calls `familyInstance.verify()` which:
   - Reads the contract marker from the database
   - Compares marker presence: Returns `PN-RTM-3001` if marker is missing
   - Compares target compatibility: Returns `PN-RTM-3003` if contract target doesn't match config target
   - Compares storage hash: Returns `PN-RTM-3002` if `storageHash` doesn't match
   - Compares profile hash: Returns `PN-RTM-3002` if `profileHash` doesn't match (when present)
   - Checks codec coverage (optional): Compares contract column types against supported codec types and reports missing codecs
5. **Verify Schema (default)**: Unless `--fast` is provided, calls `familyInstance.schemaVerify()` in tolerant mode to catch structural drift such as missing tables or columns created by manual DDL.

**Output Format (TTY):**

Success:
```
✔ Database signature and schema match contract
  verification: marker + schema
  storageHash: sha256:abc123...
  profileHash: sha256:def456...
```

Fast-mode success:
```
✔ Database marker matches contract
  verification: marker only (--fast)
  storageHash: sha256:abc123...
  profileHash: sha256:def456...

⚠ Schema verification skipped because --fast was provided. Run `prisma-next db schema-verify` to detect structural drift.
```

Marker failure:
```
✖ Marker missing (PN-RTM-3001)
  Why: Contract marker not found in database
  Fix: Run `prisma-next db sign --db <url>` to create marker
```

Schema drift failure:
`db verify` prints the same schema verification tree and JSON payload as `db schema-verify`, then exits with code 1.

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Database signature and schema match contract",
  "mode": "full",
  "contract": {
    "storageHash": "sha256:abc123...",
    "profileHash": "sha256:def456..."
  },
  "marker": {
    "storageHash": "sha256:abc123...",
    "profileHash": "sha256:def456..."
  },
  "target": {
    "expected": "postgres"
  },
  "missingCodecs": [],
  "schema": {
    "summary": "Database schema satisfies contract",
    "counts": {
      "pass": 12,
      "warn": 0,
      "fail": 0,
      "totalNodes": 12
    },
    "strict": false
  },
  "meta": {
    "configPath": "/path/to/prisma-next.config.ts",
    "contractPath": "/path/to/src/prisma/contract.json",
    "schemaVerification": "performed"
  },
  "timings": {
    "total": 42
  }
}
```

**Error Codes:**

- `PN-CLI-4010`: Missing driver in config — provide a driver descriptor
- `PN-RTM-3001`: Marker missing - Contract marker not found in database
- `PN-RTM-3002`: Hash mismatch - Contract hash does not match database marker
- `PN-RTM-3003`: Target mismatch - Contract target does not match config target
- Exit code 1 with schema verification payload: Structural drift detected after marker verification passed

**Family Requirements:**

The family must provide a `create()` method in the family descriptor that accepts a `ControlPlaneStack` and returns a `ControlFamilyInstance` with a `verify()` method:

```typescript
interface ControlFamilyDescriptor<TFamilyId, TFamilyInstance> {
  create<TTargetId extends string>(
    stack: ControlPlaneStack<TFamilyId, TTargetId>,
  ): TFamilyInstance;
}

interface ControlPlaneStack<TFamilyId, TTargetId> {
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
}

interface ControlFamilyInstance {
  verify(options: {
    driver: ControlDriverInstance;
    contractIR: ContractIR;
    expectedTargetId: string;
    contractPath: string;
    configPath?: string;
  }): Promise<VerifyDatabaseResult>;
}
```

Use `createControlPlaneStack()` from `@prisma-next/core-control-plane/stack` to create the stack with sensible defaults (`driver` defaults to `undefined`, `extensionPacks` defaults to `[]`).

The SQL family provides this via `@prisma-next/family-sql/control`. The `verify()` method handles marker checks, and `db verify` follows it with `schemaVerify()` unless `--fast` is provided.

### `prisma-next db introspect`

Inspect the live database schema and display it as a human-readable tree or machine-consumable JSON.

**Command:**
```bash
prisma-next db introspect [--db <url>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next db introspect

# Specify database URL
prisma-next db introspect --db postgresql://user:pass@localhost/db

# JSON output
prisma-next db introspect --json

# Verbose output
prisma-next db introspect -v
```

**Config File Requirements:**

The `db introspect` command requires a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/target-postgres/control';
import sql from '@prisma-next/family-sql/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  db: {
    connection: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Introspection Process:**

1. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
2. **Create Family Instance**: Creates a `ControlPlaneStack` via `createControlPlaneStack()` and passes it to `config.family.create(stack)` to create a family instance
3. **Introspect**: Calls `familyInstance.introspect()` which:
   - Queries the database catalog to discover schema structure
   - Returns a family-specific schema IR (e.g., `SqlSchemaIR` for SQL family)
4. **Transform to Schema View**: Calls `familyInstance.toSchemaView()` to project the schema IR into a `CoreSchemaView` for display
5. **Format Output**: Formats the schema view as a human-readable tree or JSON envelope

**Output Format (TTY):**

Human-readable schema tree:
```
sql schema (tables: 2)
├─ table user
│  ├─ id: int4 (not null)
│  ├─ email: text (not null)
│  └─ unique user_email_key
├─ table post
│  ├─ id: int4 (not null)
│  ├─ title: text (not null)
│  └─ userId: int4 (not null)
├─ extension plpgsql
└─ extension vector
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Schema introspected successfully",
  "schema": {
    "root": {
      "kind": "root",
      "id": "sql-schema",
      "label": "sql schema (tables: 2)",
      "children": [
        {
          "kind": "entity",
          "id": "table-user",
          "label": "table user",
          "children": [
            {
              "kind": "field",
              "id": "column-user-id",
              "label": "id: int4 (not null)",
              "meta": {
                "nativeType": "int4",
                "nullable": false
              }
            }
          ]
        }
      ]
    }
  },
  "meta": {
    "configPath": "/path/to/prisma-next.config.ts",
    "dbUrl": "postgresql://user:pass@localhost/db"
  },
  "timings": {
    "total": 42
  }
}
```

**Error Codes:**
- `PN-CLI-4010`: Missing driver in config — provide a driver descriptor
- `PN-CLI-4005`: Missing database connection — provide `--db <url>` or set `db.connection` in config

**Family Requirements:**

The family must provide:
1. A `create()` method in the family descriptor that returns a `ControlFamilyInstance` with an `introspect()` method
2. An optional `toSchemaView()` method on the `ControlFamilyInstance` to project family-specific schema IR into `CoreSchemaView`

```typescript
interface ControlFamilyInstance {
  introspect(options: {
    driver: ControlDriverInstance;
    contractIR?: ContractIR;
    schema?: string;
  }): Promise<FamilySchemaIR>;

  toSchemaView?(schema: FamilySchemaIR): CoreSchemaView;
}
```

The SQL family provides this via `@prisma-next/family-sql/control`. The `introspect()` method queries the database catalog and returns `SqlSchemaIR`, and `toSchemaView()` projects it into a `CoreSchemaView` for display.

**Note:** The introspection output displays native database types (e.g., `int4`, `text`, `timestamptz`) rather than mapped codec IDs (e.g., `pg/int4@1`). This reflects the actual database state, which may be enriched with type mappings later.

### `prisma-next db sign`

Mark the database as matching the emitted contract by writing or updating the contract marker. This command verifies that the database schema satisfies the contract before signing, ensuring the marker is only written when the database is fully aligned.

**Command:**
```bash
prisma-next db sign [--db <url>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next db sign

# Specify database URL
prisma-next db sign --db postgresql://user:pass@localhost/db

# JSON output
prisma-next db sign --json

# Verbose output
prisma-next db sign -v
```

**Config File Requirements:**

The `db sign` command requires a `driver` in the config to connect to the database and a `contract.output` path to locate the emitted contract:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/target-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
  db: {
    connection: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Signing Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Creates a `ControlPlaneStack` via `createControlPlaneStack()` and passes it to `config.family.create(stack)` to create a family instance
4. **Schema Verification (Precondition)**: Calls `familyInstance.schemaVerify()` to verify the database schema matches the contract:
   - If verification fails: Prints schema verification output and exits with code 1 (marker is not written)
   - If verification passes: Proceeds to marker signing
5. **Sign**: Calls `familyInstance.sign()` which:
   - Ensures the marker schema and table exist
   - Reads any existing marker from the database
   - Compares contract hashes with existing marker:
     - If marker is missing: Inserts a new marker row
     - If hashes differ: Updates the existing marker row
     - If hashes match: No-op (idempotent)

**Output Format (TTY):**

Success (new marker):
```
✔ Database signed (marker created)
  storageHash: sha256:abc123...
  profileHash: sha256:def456...
  Total time: 42ms
```

Success (updated marker):
```
✔ Database signed (marker updated from sha256:old-hash)
  storageHash: sha256:abc123...
  profileHash: sha256:def456...
  previous storageHash: sha256:old-hash
  Total time: 42ms
```

Success (already up-to-date):
```
✔ Database already signed with this contract
  storageHash: sha256:abc123...
  profileHash: sha256:def456...
  Total time: 42ms
```

Failure (schema mismatch):
```
✖ Schema verification failed
  [Schema verification tree output]
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Database signed (marker created)",
  "contract": {
    "storageHash": "sha256:abc123...",
    "profileHash": "sha256:def456..."
  },
  "target": {
    "expected": "postgres",
    "actual": "postgres"
  },
  "marker": {
    "created": true,
    "updated": false
  },
  "meta": {
    "configPath": "/path/to/prisma-next.config.ts",
    "contractPath": "/path/to/src/prisma/contract.json"
  },
  "timings": {
    "total": 42
  }
}
```

For updated markers:
```json
{
  "ok": true,
  "summary": "Database signed (marker updated from sha256:old-hash)",
  "contract": {
    "storageHash": "sha256:abc123...",
    "profileHash": "sha256:def456..."
  },
  "target": {
    "expected": "postgres",
    "actual": "postgres"
  },
  "marker": {
    "created": false,
    "updated": true,
    "previous": {
      "storageHash": "sha256:old-hash",
      "profileHash": "sha256:old-profile-hash"
    }
  },
  "meta": {
    "configPath": "/path/to/prisma-next.config.ts",
    "contractPath": "/path/to/src/prisma/contract.json"
  },
  "timings": {
    "total": 42
  }
}
```

**Error Codes:**
- `PN-CLI-4010`: Missing driver in config — provide a driver descriptor
- `PN-CLI-4005`: Missing database connection — provide `--db <url>` or set `db.connection` in config
- Exit code 1: Schema verification failed — database schema does not match contract (marker is not written)

**Relationship to Other Commands:**
- **`db schema-verify`**: `db sign` calls `schemaVerify` as a precondition before writing the marker. If schema verification fails, `db sign` exits without writing the marker.
- **`db verify`**: `db verify` checks that the marker exists and matches the contract, then runs tolerant schema verification by default. `db sign` writes the marker that `db verify` checks. Use `db verify --fast` for marker-only verification.

**Idempotency:**
The `db sign` command is idempotent and safe to run multiple times:
- If the marker already matches the contract (same hashes), no database changes are made
- The command reports success in all cases (new marker, updated marker, or already up-to-date)
- Safe to run in CI/deployment pipelines

**Family Requirements:**
The family must provide a `create()` method in the family descriptor that returns a `ControlFamilyInstance` with `schemaVerify()` and `sign()` methods:

```typescript
interface ControlFamilyInstance {
  schemaVerify(options: {
    driver: ControlDriverInstance;
    contractIR: ContractIR;
    strict: boolean;
    contractPath: string;
    configPath?: string;
  }): Promise<VerifyDatabaseSchemaResult>;

  sign(options: {
    driver: ControlDriverInstance;
    contractIR: ContractIR;
    contractPath: string;
    configPath?: string;
  }): Promise<SignDatabaseResult>;
}
```

The SQL family provides this via `@prisma-next/family-sql/control`. The `sign()` method handles ensuring the marker schema/table exist, reading existing markers, comparing hashes, and writing/updating markers internally.

### `prisma-next db init`

Initialize a database schema from the contract. This command plans and applies **additive-only** operations (create missing tables/columns/constraints/indexes) until the database satisfies the contract, then writes the contract marker.

**Command:**
```bash
prisma-next db init [--db <url>] [--config <path>] [--dry-run] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--dry-run`: Only show the migration plan, do not apply it
- `--json [format]`: Output as JSON (`object` only; `ndjson` is not supported for this command)
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Initialize database with config defaults
prisma-next db init

# Preview migration plan without applying
prisma-next db init --dry-run

# Specify database URL
prisma-next db init --db postgresql://user:pass@localhost/db

# JSON output
prisma-next db init --json
```

**Config File Requirements:**

The `db init` command requires a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/target-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
  db: {
    connection: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Initialization Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Creates a `ControlPlaneStack` via `createControlPlaneStack()` and passes it to `config.family.create(stack)` to create a family instance
4. **Introspect Schema**: Calls `familyInstance.introspect()` to get the current database schema IR
5. **Validate wiring**: Ensures the contract is compatible with the CLI config:
   - `contract.targetFamily` matches `config.family.familyId`
   - `contract.target` matches `config.target.targetId`
   - `contract.extensionPacks` (if present) are provided by `config.extensionPacks` (matched by descriptor `id`)
6. **Create Planner/Runner**: Uses `config.target.migrations.createPlanner()` and `config.target.migrations.createRunner()`
7. **Plan Migration**: Calls `planner.plan()` with the contract IR, schema IR, additive-only policy, and `frameworkComponents` (the active target/adapter/extension descriptors)
   - On conflict: Returns a structured failure with conflict list
   - On success: Returns a migration plan with operations
8. **Apply Migration** (if not `--dry-run`):
   - Calls `runner.execute()` to apply the plan
   - After execution, verifies schema matches contract
   - Writes contract marker (and records a ledger entry via the target runner)

**Output Format (TTY - Plan Mode):**

```
prisma-next db init ➜ Bootstrap a database to match the current contract
  config:          prisma-next.config.ts
  contract:        src/prisma/contract.json
  mode:            plan (dry run)

✔ Planned 4 operation(s)
│
├─ Create table user [additive]
├─ Add unique constraint user_email_key on user [additive]
├─ Create index user_email_idx on user [additive]
└─ Add foreign key post_userId_fkey on post [additive]

Destination hash: sha256:abc123...

This is a dry run. No changes were applied.
Run without --dry-run to apply changes.
```

**Output Format (TTY - Apply Mode):**

```
prisma-next db init ➜ Bootstrap a database to match the current contract
  config:          prisma-next.config.ts
  contract:        src/prisma/contract.json

Applying migration plan and verifying schema...
  → Create table user...
  → Add unique constraint user_email_key on user...
  → Create index user_email_idx on user...
  → Add foreign key post_userId_fkey on post...
✔ Applied 4 operation(s)
  Marker written: sha256:abc123...
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "mode": "apply",
  "plan": {
    "targetId": "postgres",
    "destination": {
      "storageHash": "sha256:abc123..."
    },
    "operations": [
      {
        "id": "table.user",
        "label": "Create table user",
        "operationClass": "additive"
      }
    ]
  },
  "execution": {
    "operationsPlanned": 4,
    "operationsExecuted": 4
  },
  "marker": {
    "storageHash": "sha256:abc123..."
  }
}
```

**Error Codes:**
- `PN-CLI-4004`: Contract file not found
- `PN-CLI-4005`: Missing database URL
- `PN-CLI-4008`: Unsupported JSON format (`--json ndjson` is rejected for `db init`)
- `PN-CLI-4010`: Missing driver in config
- `PN-CLI-4020`: Migration planning failed (conflicts)
- `PN-CLI-4021`: Target does not support migrations
- `PN-RTM-3000`: Runtime error (includes marker mismatch failures)

**Behavior Notes:**

- If the database already has a marker that matches the destination contract, `db init` succeeds as a noop (0 operations planned/executed).
- If the database has a marker that does **not** match the destination contract, `db init` fails (including in `--dry-run` mode). Use `db init` for bootstrapping; use your migration workflow to reconcile existing databases.

### `prisma-next db update`

Update your database schema to match the currently emitted contract.

`db update` differs from `db init`:

- Works on any database, whether or not it has been initialized with `db init` (creates the signature table if missing)
- Allows `additive`, `widening`, and `destructive` operation classes where supported by planner/runner
- Disables per-operation runner execution checks by default (precheck/postcheck/idempotency)
- In `--dry-run` mode for SQL targets, prints a DDL preview derived from planned operations
- In interactive mode, destructive plans require confirmation before apply
- In non-interactive mode, destructive plans fail unless `-y, --yes` is provided

**Command:**
```bash
prisma-next db update [--db <url>] [--config <path>] [--dry-run] [-y|--yes] [--interactive|--no-interactive] [--json] [-v] [-q] [--color/--no-color]
```

**Error codes (additional to shared CLI/runtime codes):**
- `RUNNER_FAILED`: runner rejected apply (origin mismatch, failed checks, policy failures, or execution errors)

**Config File (`prisma-next.config.ts`):**

The CLI uses a config file to specify the target family, target, adapter, extensionPacks, and contract.

**Config Discovery:**
- `--config <path>`: Explicit path (relative or absolute)
- Default: `./prisma-next.config.ts` in current working directory
- No upward search (stays in CWD)

**Note:** The CLI uses `c12` for config loading, but constrains it to the current working directory (no upward search) to match the style guide's discovery precedence.

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgres from '@prisma-next/target-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
});
```

Prefer helper utilities for authoring mode selection:
- `typescriptContract(contractIR, outputPath?)` from `@prisma-next/sql-contract-ts/config-types` for TS-authored contracts
- `prismaContract(schemaPath, { output?, target? })` from `@prisma-next/sql-contract-psl/provider` for PSL-authored providers
- Provider failures are returned as structured diagnostics for CLI rendering

The `contract.output` field specifies the path to `contract.json`. This is the canonical location where other CLI commands can find the contract JSON artifact. Defaults to `'src/prisma/contract.json'` if not specified.

`contract.d.ts` is always colocated with `contract.json` and derived from `contract.output` (`contract.json` → `contract.d.ts`).

**Output:**
- `contract.json`: Includes `_generated` metadata field indicating it's a generated artifact (excluded from canonicalization/hashing)
- `contract.d.ts`: Includes warning header comments indicating it's a generated file

### `prisma-next migration plan`

Plan a migration from contract changes. Compares the emitted contract against the latest on-disk migration state and produces a new migration package with the required operations. No database connection is needed — fully offline.

```bash
prisma-next migration plan [--config <path>] [--name <slug>] [--from <hash>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--config <path>`: Path to `prisma-next.config.ts`
- `--name <slug>`: Name slug for the migration directory (default: `migration`)
- `--from <hash>`: Explicit starting contract hash (overrides latest chain leaf detection)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)

**What it does:**
1. Loads config and reads `contract.json` (the "to" contract)
2. Reads existing migrations from `config.migrations.dir` (default: `migrations/`)
3. Reconstructs the migration chain and finds the leaf (current state)
4. Diffs the leaf contract against the new contract using the target's migration planner (same planner as `db init`)
5. Writes a new migration package (`migration.json` + `ops.json`) and attests the `migrationId`

### `prisma-next migration show`

Display a migration package's operations, DDL preview, and metadata. Accepts a directory path, a hash prefix (git-style matching against `migrationId`), or defaults to the latest migration.

```bash
prisma-next migration show [target] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `[target]`: Migration directory path or migrationId hash prefix (defaults to latest)
- `--config <path>`: Path to `prisma-next.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output

**What it does:**
1. If `target` is a path (contains `/` or `\`), reads that directory directly
2. If `target` is a hash prefix, scans all attested migrations and matches against `migrationId`
3. If no target, defaults to the latest migration (chain leaf)
4. Displays operations with operation class badges, destructive warnings, and DDL preview

**Destructive warnings:** When a migration contains destructive operations (e.g., `DROP TABLE`, `ALTER COLUMN TYPE`), the output includes a prominent `⚠` warning about potential data loss.

### `prisma-next migration status`

Show the migration graph and applied status. Adapts based on context:

- **With DB connection**: Shows applied/pending markers and "you are here" indicators
- **Without DB connection**: Shows the graph structure from disk only

```bash
prisma-next migration status [--db <url>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--db <url>`: Database connection string (enables online mode)
- `--config <path>`: Path to `prisma-next.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output

**What it does:**
1. Reads migration packages from disk and reconstructs the chain
2. If a DB connection is available, reads the marker to determine applied/pending status
3. Displays the graph as a linear chain with `◄ DB` and `◄ Contract` markers
4. Shows operation summaries with destructive operation highlighting
5. Falls back to offline mode if DB connection fails

**Known limitation:** Branched migration graphs (multiple leaves) produce an error. Only linear chains are visualized.

### `prisma-next migration apply`

Apply planned migrations to the database. Executes previously planned migrations (created by `migration plan`). Compares the database marker against the migration chain to determine which migrations are pending, then executes them sequentially. Each migration runs in its own transaction. Does not plan new migrations — run `migration plan` first.

```bash
prisma-next migration apply [--db <url>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection`)
- `--config <path>`: Path to `prisma-next.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)

**What it does:**
1. Reads attested migration packages from `config.migrations.dir`
2. Reconstructs the migration chain (skips drafts with `migrationId: null`)
3. Reads the current contract hash from `contract.json`
4. Connects to the database and reads the current marker hash
5. Finds the path from the marker hash to the current contract hash
6. Executes each pending migration in order using the target's `MigrationRunner`
7. Each migration runs in its own transaction with prechecks, postchecks, and idempotency checks enabled
8. After each migration, the runner verifies the schema and updates the marker/ledger

**Config requirements:** Requires `driver` and `db.connection` (or `--db`). `migrations.dir` is optional and defaults to `migrations/`.

**Resume semantics:** If a migration fails, previously applied migrations are preserved. Re-running `migration apply` resumes from the last successful migration.

**Planning requirement:** `migration apply` now requires the current contract hash to exist in attested on-disk migrations. If the contract has changed and no migration was planned, apply exits with an error and asks you to run `migration plan`.

### `prisma-next migration verify`

Verify a migration package's integrity by recomputing the content-addressed `migrationId`.

```bash
prisma-next migration verify --dir <path>
```

- **Verified**: stored `migrationId` matches recomputed value
- **Draft**: `migrationId` is null — automatically attests the package
- **Mismatch**: package has been modified since attestation (command exits non-zero)

## Architecture

```mermaid
flowchart TD
    CLI[CLI Entry Point]
    CMD_EMIT[Emit Command]
    CMD_DB[DB Commands]
    CMD_MIG[Migration Commands]
    LOAD[TS Contract Loader]
    EMIT[Emitter]
    CTRL[Control Client]
    MIG_TOOLS["@prisma-next/migration-tools"]
    FS[File System]

    CLI --> CMD_EMIT
    CLI --> CMD_DB
    CLI --> CMD_MIG
    CMD_EMIT --> LOAD
    LOAD --> EMIT
    CMD_DB --> CTRL
    CMD_MIG --> CTRL
    CMD_MIG --> MIG_TOOLS
    MIG_TOOLS --> FS
    CTRL --> FS
```

## Config Validation and Normalization

The `defineConfig()` function validates and normalizes configs using Arktype:

- **Validation**: Validates config structure using Arktype schemas
- **Normalization**: Applies default values (e.g., `contract.output` defaults to `'src/prisma/contract.json'`)
- **Error Messages**: Provides clear, actionable error messages on validation failure

See `.cursor/rules/config-validation-and-normalization.mdc` for detailed patterns.

## Components

### CLI Entry Point (`cli.ts`)
- Main entry point using commander
- Parses arguments and routes to command handlers
- Handles global flags (`--help`, `--version`)
- Exit codes: 0 (success), 1 (runtime error), 2 (usage/config error)
- **Error Handling**: Uses `exitOverride()` to catch unhandled errors (non-structured errors that fail fast) and print stack traces. Commands handle structured errors themselves via `process.exit()`.
- **Command Taxonomy**: Groups commands by domain/plane (e.g., `contract emit`)
- **Help Formatting**: Uses `configureHelp()` to customize help output with styled format matching normal command output. Root help shows "prisma-next" title with command tree; command help shows "prisma-next <command> ➜ <description>" with options and docs URLs. See `utils/formatters/help.ts` for help formatters.
- **Command Descriptions**: See the “Command Descriptions” section above for `setCommandDescriptions()` usage.

### Contract Emit Command (`commands/contract-emit.ts`)
- Canonical command implementation using commander
- Supports global flags (JSON, verbosity, color, interactive, yes)
- **Error Handling**: Uses structured errors (`CliStructuredError`), Result pattern, and `process.exit()`. Commands return `Result<T, CliStructuredError>`, process results with `handleResult()`, and call `process.exit(exitCode)` directly. See `.cursor/rules/cli-error-handling.mdc` for details.
- Loads the user's config module (`prisma-next.config.ts`)
- Resolves contract from provider:
  - Calls `config.contract.source()` and expects `Result<ContractIR, Diagnostics>`
  - Source-specific parsing/loading stays inside providers
  - Provider diagnostics are surfaced as actionable CLI failures
  - Throws error if `config.contract` is missing
- Uses artifact path from `config.contract.output` (already normalized by `defineConfig()` with defaults applied)
- Creates family instance via `config.family.create()` (assembles operation registry, type imports, extension IDs)
- Calls `familyInstance.emitContract()` with raw contract (instance handles stripping mappings and validation internally)
- Outputs human-readable or JSON format based on flags

### Programmatic API (`api/emit-contract.ts`)
- **`emitContract(options)`**: Programmatic API for emitting contracts
  - Accepts resolved contract IR, output paths, and assembly data
  - Caller is responsible for loading the contract and resolving paths
  - Returns result with hashes, file paths, and timings
  - Used by CLI command internally

### Error Handling (`utils/errors.ts`, `utils/cli-errors.ts`, `utils/result.ts`, `utils/result-handler.ts`)
- **Structured Errors**: Call sites throw `CliStructuredError` instances with full context (why, fix, docsUrl, etc.)
- **Result Pattern**: Commands return `Result<T, CliStructuredError>` and use `handleResult()` for output and exit codes
- **Error Conversion**: `CliStructuredError.toEnvelope()` converts errors to envelopes for output formatting
- **Result Processing**: `handleResult()` processes Results, formats output, and returns exit codes
- **Exit Codes**:
  - Usage/config errors (PN-CLI-4001-4007) → exit code 2
  - Runtime errors (PN-RTM-3xxx) → exit code 1
  - Success → exit code 0
- **Fail Fast**: Non-structured errors propagate and are caught by Commander.js's `exitOverride()` with stack traces
- See `.cursor/rules/cli-error-handling.mdc` for detailed patterns

### Pack Assembly
- **Family instances** now handle pack assembly internally. The CLI creates a family instance via `config.family.create()` and reads assembly data (operation registry, type imports, extension IDs) from the instance.
- **Removed**: `pack-assembly.ts` has been removed. Pack assembly is now handled by family instances. For SQL family, tests can import pack-based helpers directly from `packages/2-sql/3-tooling/family/src/core/assembly.ts` using relative paths.
- Assembly logic is family-specific and owned by each family's instance implementation (e.g., `createSqlFamilyInstance` in `@prisma-next/family-sql`).

### Output Formatting (`utils/formatters/`)
- **Command Output Formatters**: Format human-readable output for commands (emit, verify, etc.)
  - Paths are shown as relative paths from current working directory (using `relative(process.cwd(), path)`)
  - Success indicators use consistent checkmark (✔) throughout
- **Error Output Formatters**: Format error output for human-readable and JSON display
- **Styled Headers**: `formatStyledHeader()` creates styled headers for command output with "prisma-next <command> ➜ <description>" format
  - Parameter labels include colons (e.g., `config:`, `contract:`)
  - Uses fixed 20-character left column width for consistent alignment
- **Help Formatters**:
  - `formatRootHelp()` - Formats root help with "prisma-next" title, command tree, and multiline description
  - `formatCommandHelp()` - Formats command help with "prisma-next <command> ➜ <description>", options, subcommands, docs URLs, and multiline description
  - `renderCommandTree()` - Shared function to render hierarchical command trees with tree characters (├─, └─, │)
  - **Fixed-Width Formatting**: All two-column output (help, styled headers) uses fixed 20-character left column width
  - **Text Wrapping**: Right column wraps at 90 characters using `wrap-ansi` for ANSI-aware wrapping
  - **Default Values**: Options with default values display `default: <value>` on the following line (dimmed)
  - **ANSI-Aware Padding**: Uses `string-width` and `strip-ansi` to measure and pad text correctly with ANSI codes
  - Help formatters use the same styling system as normal command output (colors, dim text, badges)
  - Short descriptions appear in command trees and headers; long descriptions appear at the bottom of help output
  - Help formatting is configured via `configureHelp()` in `cli.ts` to apply to all commands

### Family Descriptor (provided by family /cli entrypoint)
- The SQL family (and other families) provide:
  - `create(options)` - Creates a family instance that implements domain actions
  - `hook` - Target family hook for contract emission
- Family instances provide:
  - `validateContractIR(contractJson)` - Validates and normalizes contract, returns ContractIR without mappings
  - `emitContract(options)` - Emits contract (handles stripping mappings and validation internally)
  - `verify(options)` - Verifies database marker against contract
  - `schemaVerify(options)` - Verifies database schema against contract
  - `introspect(options)` - Introspects database schema

### Descriptor Declarative Fields
- Families expose component descriptors (target, adapter, driver, extensions) as plain TypeScript objects. Each descriptor includes **declarative fields**: metadata that describes what the component *provides* (independent of its runtime implementation), and that the CLI can safely copy into emitted artifacts.
  - Common declarative keys:
    - **`version`**: Component version included in emitted metadata (useful for debugging and reproducibility).
    - **`capabilities`**: Feature flags the component contributes (e.g., adapter/runtime lowering requirements). Typically namespaced by target (e.g., `{ postgres: { returning: true } }`) so contracts can be validated against the active target.
    - **`types`**: Type import specs and type IDs contributed by the component. Common examples:
      - `types.codecTypes.import`: Where to import codec type mappings for `contract.d.ts`.
      - `types.operationTypes.import`: Where to import operation type mappings for `contract.d.ts` (extensions).
      - `types.storage`: Storage type bindings (`typeId`, `nativeType`, etc.) used in authoring/emission.
    - **`operations`**: Operation signatures the component contributes (extensions), used for type generation and (optionally) validation/lowering.
    - **Component-specific metadata**:
      - Extensions may also include control-plane-only metadata like `databaseDependencies` (used by verify/schema-verify and not required at runtime).

Unlike the older **manifest-based IR** approach (separate JSON manifests + a parsing/validation step to build an IR), descriptors are imported directly from packages (e.g., `@prisma-next/*/control`). This removes a file-format boundary and keeps the data and its types co-located.
- Benefits: fewer moving parts (no JSON parsing), easier refactors (TypeScript catches drift), and clearer ownership (the package exports the canonical descriptor object).
- Trade-offs: descriptors must be available as build-time imports (less dynamic discovery vs scanning arbitrary manifest files).

**Illustrative example (descriptor object):**

```typescript
import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';

const exampleExtension: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'example',
  version: '1.0.0',
  familyId: 'sql',
  targetId: 'postgres',
  capabilities: { postgres: { 'example/feature': true } },
  types: {
    operationTypes: {
      import: {
        package: '@prisma-next/extension-example/operation-types',
        named: 'OperationTypes',
        alias: 'ExampleOperationTypes',
      },
    },
  },
  operations: [],
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

export default exampleExtension;
```

**How CLI consumers import/use it:**
- Config imports descriptors directly and passes them to `defineConfig()` (see “Config File Requirements” under `prisma-next contract emit` above; also see “Entrypoints” below for the `@prisma-next/*/control` subpaths):

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import exampleExtension from '@prisma-next/extension-example/control';

export default defineConfig({
  // family/target/adapter/driver omitted for brevity
  extensionPacks: [exampleExtension],
});
```

## Dependencies

- **`commander`**: CLI argument parsing and command routing
- **`esbuild`**: Bundling TypeScript contract files with import allowlisting
- **`@prisma-next/emitter`**: Contract emission engine (returns strings)
- **`@prisma-next/migration-tools`**: On-disk migration I/O, attestation, and chain reconstruction
- **`@prisma-next/core-control-plane`**: Config types, migration operation types, error types, control plane stack

## Design Decisions

1. **Import Allowlist**: Only `@prisma-next/*` packages allowed (MVP). Expand later if needed.
2. **Utility Separation**: TS contract loading is a utility function, not a command. Commands use utilities.
3. **CLI Framework**: Use `commander` library for robust CLI argument parsing.
4. **File I/O**: CLI handles all I/O; emitter returns strings (no file operations in emitter).
5. **Generated File Metadata**: Adds `_generated` metadata field to `contract.json` to indicate it's a generated artifact. This field is excluded from canonicalization/hashing to ensure determinism. The `contract.d.ts` file includes warning header comments generated by the emitter hook.

## Testing

The CLI package includes unit tests, integration tests, and e2e tests:

- **Unit tests**: Test individual functions and utilities in isolation
- **Integration tests**: Test component interactions (e.g., config loading, pack assembly)
- **E2E tests**: Test complete command execution with real config files

### E2E Test Patterns

E2E tests use a shared fixture app pattern to ensure proper module resolution:

- **Shared fixture app**: `test/cli-e2e-test-app/` contains a static `package.json` with dependencies
- **Fixture organization**: Fixtures are organized by command in subdirectories (e.g., `fixtures/emit/`, `fixtures/db-verify/`)
- **Ephemeral test directories**: Each test creates an isolated directory with files copied from fixtures
- **No package.json in test directories**: Test directories inherit workspace dependencies from the parent `package.json` at the root
- **Helper function**: `setupTestDirectoryFromFixtures()` handles directory setup and returns a cleanup function
- **Cleanup responsibility**: Each test must clean up its own directory (use `afterEach` hooks or `finally` blocks)

**Example:**
```typescript
import { setupTestDirectoryFromFixtures } from './utils/test-helpers';

const fixtureSubdir = 'emit';

it('test description', async () => {
  const testSetup = setupTestDirectoryFromFixtures(
    fixtureSubdir,
    'prisma-next.config.emit.ts',
  );
  const cleanupDir = testSetup.cleanup;

  try {
    // ... test code ...
  } finally {
    cleanupDir(); // Each test cleans up its own directory
  }
});
```

See `.cursor/rules/cli-e2e-test-patterns.mdc` for detailed patterns and examples.

Run tests:
```bash
pnpm test                    # Run all tests
pnpm test:unit              # Run unit tests only
pnpm test:integration       # Run integration tests only
pnpm test:e2e               # Run e2e tests only
```

## Programmatic Control API

The CLI package provides a programmatic control client for running control-plane operations without using the command line. This is useful for:

- Integration with build tools and CI pipelines
- Custom orchestration workflows
- Test automation
- Programmatic database management

### Basic Usage

```typescript
import { createControlClient } from '@prisma-next/cli/control-api';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';

// Create a control client with framework component descriptors
const client = createControlClient({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
});

try {
  // Connect to database
  await client.connect(databaseUrl);

  // Run operations
  const verifyResult = await client.verify({ contractIR });
  const initResult = await client.dbInit({ contractIR, mode: 'apply' });
  const updateResult = await client.dbUpdate({ contractIR, mode: 'apply' });
  const introspectResult = await client.introspect();
} finally {
  // Clean up
  await client.close();
}
```

### Available Operations

| Method | Description |
|--------|-------------|
| `connect(url)` | Establishes database connection |
| `close()` | Closes connection (idempotent) |
| `readMarker()` | Reads contract marker from database (null if none) |
| `verify(options)` | Verifies database marker matches contract |
| `schemaVerify(options)` | Verifies database schema satisfies contract |
| `sign(options)` | Writes contract marker to database |
| `dbInit(options)` | Initializes database schema from contract |
| `dbUpdate(options)` | Updates database schema to match contract |
| `migrationApply(options)` | Applies pre-planned migration edges to database |
| `introspect(options)` | Introspects database schema |

### Result Types

Operations return structured result types:

- `readMarker()` → `ContractMarkerRecord | null`
- `verify()` → `VerifyDatabaseResult`
- `schemaVerify()` → `VerifyDatabaseSchemaResult`
- `sign()` → `SignDatabaseResult`
- `dbInit()` → `Result<DbInitSuccess, DbInitFailure>` (uses Result pattern)
- `dbUpdate()` → `Result<DbUpdateSuccess, DbUpdateFailure>` (uses Result pattern)
- `migrationApply()` → `Result<MigrationApplySuccess, MigrationApplyFailure>` (uses Result pattern)
- `introspect()` → Schema IR (family-specific)

### Error Handling

- **Connection errors**: Thrown as exceptions from `connect()`
- **Not connected errors**: Thrown if operations called before `connect()`
- **Driver not configured**: Thrown if driver is not provided in options
- **Operation failures**: Returned as structured results (not thrown)

### Key Differences from CLI

| Aspect | CLI | Control API |
|--------|-----|-------------|
| Config | Reads `prisma-next.config.ts` | Accepts descriptors directly |
| File I/O | Reads contract.json from disk | Accepts contract IR directly |
| Output | Formats for console | Returns structured data |
| Exit codes | Uses `process.exit()` | Returns results/throws |

## Entrypoints

The CLI package exports several subpaths for different use cases:

- **`@prisma-next/cli`** (main export): Exports `loadContractFromTs` and `createContractEmitCommand`
- **`@prisma-next/cli/config-types`**: Exports `defineConfig` and config types
- **`@prisma-next/cli/control-api`**: Exports `createControlClient` and control API types
- **`@prisma-next/cli/commands/db-init`**: Exports `createDbInitCommand`
- **`@prisma-next/cli/commands/db-update`**: Exports `createDbUpdateCommand`
- **`@prisma-next/cli/commands/db-introspect`**: Exports `createDbIntrospectCommand`
- **`@prisma-next/cli/commands/db-schema-verify`**: Exports `createDbSchemaVerifyCommand`
- **`@prisma-next/cli/commands/db-sign`**: Exports `createDbSignCommand`
- **`@prisma-next/cli/commands/db-verify`**: Exports `createDbVerifyCommand`
- **`@prisma-next/cli/commands/contract-emit`**: Exports `createContractEmitCommand`
- **`@prisma-next/cli/commands/migration-plan`**: Exports `createMigrationPlanCommand`
- **`@prisma-next/cli/commands/migration-show`**: Exports `createMigrationShowCommand`
- **`@prisma-next/cli/commands/migration-status`**: Exports `createMigrationStatusCommand`
- **`@prisma-next/cli/commands/migration-apply`**: Exports `createMigrationApplyCommand`
- **`@prisma-next/cli/commands/migration-verify`**: Exports `createMigrationVerifyCommand`
- **`@prisma-next/cli/config-loader`**: Exports `loadConfig` function

**Important**: `loadContractFromTs` is exported from the main package (`@prisma-next/cli`). See `.cursor/rules/cli-package-exports.mdc` for import patterns.

## Package Location

This package is part of the **framework domain**, **tooling layer**, **migration plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: tooling
- **Plane**: migration
- **Path**: `packages/1-framework/3-tooling/cli`

## See Also

- [`@prisma-next/emitter`](../emitter/README.md) - Contract emission engine
- Project Brief — CLI Support for Extension Packs: `docs/briefs/complete/20-CLI-Support-for-Extension-Packs.md`
