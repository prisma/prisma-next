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
- **Extension Pack Loading**: Load adapter and extension pack manifests for emission
- **Help Output Formatting**: Custom styled help output with command trees and formatted descriptions
- **Config Management**: Load and validate `prisma-next.config.ts` files using Arktype validation

**Note**: Control plane domain actions (database verification, contract emission) are implemented in `@prisma-next/core-control-plane`. The CLI uses the control plane domain actions programmatically but does not define control plane types itself.

## Command Descriptions

Commands use separate short and long descriptions via `setCommandDescriptions()`:

- **Short description**: One-liner used in command trees and headers (e.g., "Emit signed contract artifacts")
- **Long description**: Multiline text shown at the bottom of help output with detailed context

See `.cursor/rules/cli-command-descriptions.mdc` for details.

## Commands

### `prisma-next contract emit` (canonical)

Emit `contract.json` and `contract.d.ts` from `config.contract`.

**Canonical command:**
```bash
prisma-next contract emit [--config <path>] [--json] [-v] [-q] [--timestamps] [--color/--no-color]
```

**Config File Requirements:**

The `contract emit` command requires a `driver` in the config (even though it doesn't use it) because `ControlFamilyDescriptor.create()` requires it for consistency:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/targets-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver, // Required even though emit doesn't use it
  extensions: [],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
    types: 'src/prisma/contract.d.ts',
  },
});
```

Options:
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--timestamps`: Add timestamps to output
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next contract emit

# JSON output
prisma-next contract emit --json

# Verbose output with timestamps
prisma-next contract emit -v --timestamps
```

### `prisma-next db verify`

Verify that a database instance matches the emitted contract by checking marker presence, hash equality, and target compatibility.

**Command:**
```bash
prisma-next db verify [--db <url>] [--config <path>] [--json] [-v] [-q] [--timestamps] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional, falls back to `config.db.url` or `DATABASE_URL` environment variable)
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--timestamps`: Add timestamps to output
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next db verify

# Specify database URL
prisma-next db verify --db postgresql://user:pass@localhost/db

# JSON output
prisma-next db verify --json

# Verbose output with timestamps
prisma-next db verify -v --timestamps
```

**Config File Requirements:**

The `db verify` command requires a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/targets-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
    types: 'src/prisma/contract.d.ts',
  },
  db: {
    url: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Verification Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Calls `config.family.create()` with target, adapter, driver, and extensions to create a family instance
4. **Verify**: Calls `familyInstance.verify()` which:
   - Reads the contract marker from the database
   - Compares marker presence: Returns `PN-RTM-3001` if marker is missing
   - Compares target compatibility: Returns `PN-RTM-3003` if contract target doesn't match config target
   - Compares core hash: Returns `PN-RTM-3002` if `coreHash` doesn't match
   - Compares profile hash: Returns `PN-RTM-3002` if `profileHash` doesn't match (when present)
   - Checks codec coverage (optional): Compares contract column types against supported codec types and reports missing codecs

**Output Format (TTY):**

Success:
```
✔ Database matches contract
  coreHash: sha256:abc123...
  profileHash: sha256:def456...
```

Failure:
```
✖ Marker missing (PN-RTM-3001)
  Why: Contract marker not found in database
  Fix: Run `prisma-next db sign --db <url>` to create marker
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Database matches contract",
  "contract": {
    "coreHash": "sha256:abc123...",
    "profileHash": "sha256:def456..."
  },
  "marker": {
    "coreHash": "sha256:abc123...",
    "profileHash": "sha256:def456..."
  },
  "target": {
    "expected": "postgres"
  },
  "missingCodecs": [],
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
- `PN-RTM-3001`: Marker missing - Contract marker not found in database
- `PN-RTM-3002`: Hash mismatch - Contract hash does not match database marker
- `PN-RTM-3003`: Target mismatch - Contract target does not match config target

**Family Requirements:**

The family must provide a `create()` method in the family descriptor that returns a `FamilyInstance` with a `verify()` method:

```typescript
interface FamilyDescriptor {
  create(options: {
    target: TargetDescriptor;
    adapter: AdapterDescriptor;
    extensions: ExtensionDescriptor[];
  }): FamilyInstance;
}

interface FamilyInstance {
  verify(options: {
    driver: ControlPlaneDriver;
    contractIR: ContractIR;
    expectedTargetId: string;
    contractPath: string;
    configPath?: string;
  }): Promise<VerifyDatabaseResult>;
}
```

The SQL family provides this via `@prisma-next/family-sql/control`. The `verify()` method handles reading the marker, comparing hashes, and checking codec coverage internally.

### `prisma-next db introspect`

Inspect the live database schema and display it as a human-readable tree or machine-consumable JSON.

**Command:**
```bash
prisma-next db introspect [--db <url>] [--config <path>] [--json] [-v] [-q] [--timestamps] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional, falls back to `config.db.url` or `DATABASE_URL` environment variable)
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--timestamps`: Add timestamps to output
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next db introspect

# Specify database URL
prisma-next db introspect --db postgresql://user:pass@localhost/db

# JSON output
prisma-next db introspect --json

# Verbose output with timestamps
prisma-next db introspect -v --timestamps
```

**Config File Requirements:**

The `db introspect` command requires a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/targets-postgres/control';
import sql from '@prisma-next/family-sql/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  db: {
    url: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Introspection Process:**

1. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
2. **Create Family Instance**: Calls `config.family.create()` with target, adapter, driver, and extensions to create a family instance
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
                "typeId": "pg/int4@1",
                "nullable": false,
                "nativeType": "int4"
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
- `PN-CLI-4011`: Missing database URL — provide `--db` flag or `config.db.url` or `DATABASE_URL` environment variable

**Family Requirements:**

The family must provide:
1. A `create()` method in the family descriptor that returns a `FamilyInstance` with an `introspect()` method
2. An optional `toSchemaView()` method on the `FamilyInstance` to project family-specific schema IR into `CoreSchemaView`

```typescript
interface FamilyInstance {
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
prisma-next db sign [--db <url>] [--config <path>] [--json] [-v] [-q] [--timestamps] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional, falls back to `config.db.url` or `DATABASE_URL` environment variable)
- `--config <path>`: Optional. Path to `prisma-next.config.ts` (defaults to `./prisma-next.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--timestamps`: Add timestamps to output
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma-next db sign

# Specify database URL
prisma-next db sign --db postgresql://user:pass@localhost/db

# JSON output
prisma-next db sign --json

# Verbose output with timestamps
prisma-next db sign -v --timestamps
```

**Config File Requirements:**

The `db sign` command requires a `driver` in the config to connect to the database and a `contract.output` path to locate the emitted contract:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import postgres from '@prisma-next/targets-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
    types: 'src/prisma/contract.d.ts',
  },
  db: {
    url: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Signing Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Calls `config.family.create()` with target, adapter, driver, and extensions to create a family instance
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
✓ Database signed (marker created)
  coreHash: sha256:abc123...
  profileHash: sha256:def456...
  Total time: 42ms
```

Success (updated marker):
```
✓ Database signed (marker updated from sha256:old-hash)
  coreHash: sha256:abc123...
  profileHash: sha256:def456...
  previous coreHash: sha256:old-hash
  Total time: 42ms
```

Success (already up-to-date):
```
✓ Database already signed with this contract
  coreHash: sha256:abc123...
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
    "coreHash": "sha256:abc123...",
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
    "coreHash": "sha256:abc123...",
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
      "coreHash": "sha256:old-hash",
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
- `PN-CLI-4011`: Missing database URL — provide `--db` flag or `config.db.url` or `DATABASE_URL` environment variable
- Exit code 1: Schema verification failed — database schema does not match contract (marker is not written)

**Relationship to Other Commands:**
- **`db schema-verify`**: `db sign` calls `schemaVerify` as a precondition before writing the marker. If schema verification fails, `db sign` exits without writing the marker.
- **`db verify`**: `db verify` checks that the marker exists and matches the contract. `db sign` writes the marker that `db verify` checks.

**Idempotency:**
The `db sign` command is idempotent and safe to run multiple times:
- If the marker already matches the contract (same hashes), no database changes are made
- The command reports success in all cases (new marker, updated marker, or already up-to-date)
- Safe to run in CI/deployment pipelines

**Family Requirements:**
The family must provide a `create()` method in the family descriptor that returns a `FamilyInstance` with `schemaVerify()` and `sign()` methods:

```typescript
interface FamilyInstance {
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

**Config File (`prisma-next.config.ts`):**

The CLI uses a config file to specify the target family, target, adapter, extensions, and contract.

**Config Discovery:**
- `--config <path>`: Explicit path (relative or absolute)
- Default: `./prisma-next.config.ts` in current working directory
- No upward search (stays in CWD)

**Note:** The CLI uses `c12` for config loading, but constrains it to the current working directory (no upward search) to match the style guide's discovery precedence.

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgres from '@prisma-next/targets-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract, // Can be a value or a function: () => import('./contract').then(m => m.contract)
    output: 'src/prisma/contract.json', // Optional: defaults to 'src/prisma/contract.json'
    types: 'src/prisma/contract.d.ts', // Optional: defaults to output with .d.ts extension
  },
});
```

The `contract.source` field can be:
- A direct value: `source: contract`
- A synchronous function: `source: () => contract`
- An asynchronous function: `source: () => import('./contract').then(m => m.contract)`

The `contract.output` field specifies the path to `contract.json`. This is the canonical location where other CLI commands can find the contract JSON artifact. Defaults to `'src/prisma/contract.json'` if not specified.

The `contract.types` field specifies the path to `contract.d.ts`. Defaults to `output` with `.d.ts` extension (replaces `.json` with `.d.ts` if output ends with `.json`, otherwise appends `contract.d.ts` to the directory containing output).

**Output:**
- `contract.json`: Includes `_generated` metadata field indicating it's a generated artifact (excluded from canonicalization/hashing)
- `contract.d.ts`: Includes warning header comments indicating it's a generated file

## Architecture

```mermaid
flowchart TD
    CLI[CLI Entry Point]
    CMD[Emit Command]
    LOAD[TS Contract Loader]
    EMIT[Emitter]
    FS[File System]

    CLI --> CMD
    CMD --> LOAD
    LOAD --> EMIT
    EMIT --> CMD
    CMD --> FS
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
- **Help Formatting**: Uses `configureHelp()` to customize help output with styled format matching normal command output. Root help shows "prisma-next" title with command tree; command help shows "prisma-next <command> ➜ <description>" with options and docs URLs. See `utils/output.ts` for help formatters.
- **Command Descriptions**: Commands use `setCommandDescriptions()` to set separate short and long descriptions. See `utils/command-helpers.ts` and `.cursor/rules/cli-command-descriptions.mdc`.

### Contract Emit Command (`commands/contract-emit.ts`)
- Canonical command implementation using commander
- Supports global flags (JSON, verbosity, color, timestamps)
- **Error Handling**: Uses structured errors (`CliStructuredError`), Result pattern (`performAction`), and `process.exit()`. Commands wrap logic in `performAction()`, process results with `handleResult()`, and call `process.exit(exitCode)` directly. See `.cursor/rules/cli-error-handling.mdc` for details.
- Loads the user's config module (`prisma-next.config.ts`)
- Resolves contract from config:
  - Uses `config.contract.source` (supports sync and async functions)
  - User's config is responsible for loading the contract (can use `loadContractFromTs` or any other method)
  - Throws error if `config.contract` is missing
- Uses artifact paths from `config.contract.output/types` (already normalized by `defineConfig()` with defaults applied)
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
- **Result Pattern**: Commands wrap logic in `performAction()` which only catches `CliStructuredError` instances
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
- **Removed**: `pack-assembly.ts` has been removed. Pack assembly is now handled by family instances. For SQL family, tests can import pack-based helpers directly from `packages/sql/family/src/core/assembly.ts` using relative paths.
- Assembly logic is family-specific and owned by each family's instance implementation (e.g., `createSqlFamilyInstance` in `@prisma-next/family-sql`).

### Output Formatting (`utils/output.ts`)
- **Command Output Formatters**: Format human-readable output for commands (emit, verify, etc.)
  - Paths are shown as relative paths from current working directory (using `relative(process.cwd(), path)`)
  - Success indicators use consistent checkmark (✓) throughout
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

### Pack Manifest Types (IR)
- Families define their manifest IR and related types under their own tooling packages. CLI treats manifests as opaque data.

## Dependencies

- **`commander`**: CLI argument parsing and command routing
- **`esbuild`**: Bundling TypeScript contract files with import allowlisting
- **`@prisma-next/emitter`**: Contract emission engine (returns strings)

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

## Package Location

This package is part of the **framework domain**, **tooling layer**, **migration plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: tooling
- **Plane**: migration
- **Path**: `packages/framework/tooling/cli`

## See Also

- [`@prisma-next/emitter`](../emitter/README.md) - Contract emission engine
- Project Brief — CLI Support for Extension Packs: `docs/briefs/complete/20-CLI-Support-for-Extension-Packs.md`
