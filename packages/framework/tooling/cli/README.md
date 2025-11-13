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

## Commands

### `prisma-next contract emit` (canonical)

Emit `contract.json` and `contract.d.ts` from `config.contract`.

**Canonical command:**
```bash
prisma-next contract emit [--config <path>] [--json] [-v] [-q] [--timestamps] [--color/--no-color]
```

**Legacy alias:**
```bash
prisma-next emit [--config <path>]
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

**Note:** The `contract emit` command is the canonical form. The `emit` command is kept as a legacy alias for backward compatibility.

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

The `db verify` command requires a `queryRunnerFactory` in the config to connect to the database:

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
import { contract } from './prisma/contract';
import { Client } from 'pg';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
    types: 'src/prisma/contract.d.ts',
  },
  db: {
    url: process.env.DATABASE_URL, // Optional: can also use --db flag
    queryRunnerFactory: (url: string) => {
      const client = new Client({ connectionString: url });
      client.connect();
      return {
        query: async <Row = Record<string, unknown>>(
          sql: string,
          params?: readonly unknown[],
        ): Promise<{ readonly rows: Row[] }> => {
          const result = await client.query<Row>(sql, params as unknown[]);
          return { rows: result.rows };
        },
        close: async (): Promise<void> => {
          await client.end();
        },
      };
    },
  },
});
```

The `queryRunnerFactory` must return an object with:
- `query<Row>(sql: string, params?: readonly unknown[]): Promise<{ readonly rows: Row[] }>` - Execute a SQL query
- `close?(): Promise<void>` - Optional cleanup method

**Verification Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.db.queryRunnerFactory(url)` to create a query runner
3. **Read Marker**: Executes the marker SELECT statement provided by `config.family.verify.readMarkerSql()`
4. **Compare**:
   - Marker presence: Returns `PN-RTM-3001` if marker is missing
   - Target compatibility: Returns `PN-RTM-3003` if contract target doesn't match config target
   - Core hash: Returns `PN-RTM-3002` if `coreHash` doesn't match
   - Profile hash: Returns `PN-RTM-3002` if `profileHash` doesn't match (when present)
5. **Codec Coverage** (optional): If `config.family.verify.collectSupportedCodecTypeIds` is provided, compares contract column types against supported codec types and reports missing codecs

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

- `PN-CLI-4006`: Missing db.queryRunnerFactory in config — provide a query runner factory
- `PN-CLI-4007`: Missing family.verify.readMarkerSql() — ensure family verify helpers are exported
- `PN-RTM-3001`: Marker missing - Contract marker not found in database
- `PN-RTM-3002`: Hash mismatch - Contract hash does not match database marker
- `PN-RTM-3003`: Target mismatch - Contract target does not match config target

**Family Requirements:**

The family must provide a `verify` helper in the family descriptor:

```typescript
{
  verify: {
    readMarkerSql: () => ({ sql: string, params: readonly unknown[] }),
    collectSupportedCodecTypeIds?: (descriptors) => readonly string[],
  },
}
```

The SQL family provides this via `@prisma-next/family-sql/cli`.

**Config File (`prisma-next.config.ts`):**

The CLI uses a config file to specify the target family, target, adapter, extensions, and contract.

**Config Discovery:**
- `--config <path>`: Explicit path (relative or absolute)
- Default: `./prisma-next.config.ts` in current working directory
- No upward search (stays in CWD)

**Note:** The CLI uses `c12` for config loading, but constrains it to the current working directory (no upward search) to match the style guide's discovery precedence.

```typescript
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import sql from '@prisma-next/family-sql/cli';
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
- **Error Handling**: Uses `exitOverride()` to map error envelopes to appropriate exit codes
- **Command Taxonomy**: Groups commands by domain/plane (e.g., `contract emit`)
- **Legacy Commands**: Legacy `emit` command is available as alias alongside canonical `contract emit`

### Contract Emit Command (`commands/contract-emit.ts`)
- Canonical command implementation using commander
- Supports global flags (JSON, verbosity, color, timestamps)
- **Error Handling**: Maps errors to PN-CLI-4xxx envelopes with Why/Fix/Where and docs URLs. Throws errors instead of calling `process.exit()`. Commander.js handles errors and exits with appropriate codes (1 for runtime errors, 2 for usage/config errors).
- Loads the user's config module (`prisma-next.config.ts`)
- Resolves contract from config:
  - Uses `config.contract.source` (supports sync and async functions)
  - User's config is responsible for loading the contract (can use `loadContractFromTs` or any other method)
  - Throws error if `config.contract` is missing
- Uses artifact paths from `config.contract.output/types` (already normalized by `defineConfig()` with defaults applied)
- Strips mappings if family provides `stripMappings()` function
- Uses framework CLI assembly functions to loop over descriptors
- Calls `config.family.validateContractIR()` to validate and normalize contract
- Passes resolved contract IR, paths, and assembly data to programmatic API (`emitContract()`)
- Outputs human-readable or JSON format based on flags

### Programmatic API (`api/emit-contract.ts`)
- **`emitContract(options)`**: Programmatic API for emitting contracts
  - Accepts resolved contract IR, output paths, and assembly data
  - Caller is responsible for loading the contract and resolving paths
  - Returns result with hashes, file paths, and timings
  - Used by CLI command internally

### Error Handling (`utils/errors.ts`)
- **Error Envelopes**: All errors are mapped to standardized `CliErrorEnvelope` with PN-CLI-4xxx codes
- **Exit Code Mapping**:
  - Usage/config errors (PN-CLI-4001, PN-CLI-4002) → exit code 2
  - Runtime errors → exit code 1
  - Success → exit code 0
- **Commander.js Integration**: Uses `exitOverride()` to handle custom exit codes from error envelopes

### Legacy Emit Command (`commands/emit.ts`)
- Command implementation using commander
- **Error Handling**: Throws errors instead of calling `process.exit()`. Commander.js handles errors and exits with code 1 automatically.
- Loads the user's config module (`prisma-next.config.ts`)
- Resolves contract from config:
  - If `config.contract.source` is a function, calls it (supports sync and async functions)
  - Otherwise uses `config.contract.source` directly
  - Throws error if `config.contract` is missing
- Uses artifact paths from `config.contract.output` and `config.contract.types` (already normalized by `defineConfig()` with defaults applied)
- Strips mappings if family provides `stripMappings()` function
- Uses framework CLI assembly functions to loop over descriptors:
  - `assembleOperationRegistry(descriptors, family)` - Loops over descriptors, extracts operations, calls `family.convertOperationManifest()` for each
  - `extractCodecTypeImports(descriptors)` - Extracts codec type imports from descriptors
  - `extractOperationTypeImports(descriptors)` - Extracts operation type imports from descriptors
  - `extractExtensionIds(adapter, target, extensions)` - Extracts extension IDs in deterministic order
- Calls `config.family.validateContractIR()` to validate and normalize contract, returns ContractIR without mappings
- Calls `emit()` from emitter with the assembled inputs and `family.hook`
- Adds `_generated` metadata field to `contract.json` to indicate it's a generated artifact
- Writes `contract.json` and `contract.d.ts` to the paths specified in `config.contract.output` and `config.contract.types`

### Pack Assembly (`pack-assembly.ts`)
- Generic assembly functions that loop over descriptors/packs:
  - `assembleOperationRegistry(descriptors, family)` - Loops over descriptors, extracts operations, delegates to `family.convertOperationManifest()` for conversion
  - `extractCodecTypeImports(descriptors)` - Extracts codec type imports from descriptors
  - `extractOperationTypeImports(descriptors)` - Extracts operation type imports from descriptors
  - `extractExtensionIds(adapter, target, extensions)` - Extracts extension IDs in deterministic order
  - Pack-based versions for tests: `assembleOperationRegistryFromPacks`, `extractCodecTypeImportsFromPacks`, etc.
- These functions handle the generic looping logic; family-specific conversion is delegated to `family.convertOperationManifest()`.

### Family Descriptor (provided by family /cli entrypoint)
- The SQL family (and other families) provide:
  - `convertOperationManifest(manifest)` - Converts `OperationManifest` to `OperationSignature` (family-specific, e.g., SQL adds lowering spec)
  - `validateContractIR(contractJson)` - Validates and normalizes contract, returns ContractIR without mappings
  - `stripMappings?(contract)` - Optionally strips runtime-only mappings from contract
- The framework CLI handles generic looping; families provide conversion logic.

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

## Package Location

This package is part of the **framework domain**, **tooling layer**, **migration plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: tooling
- **Plane**: migration
- **Path**: `packages/framework/tooling/cli`

## See Also

- [`@prisma-next/emitter`](../emitter/README.md) - Contract emission engine
- Project Brief — CLI Support for Extension Packs: `docs/briefs/complete/20-CLI-Support-for-Extension-Packs.md`
