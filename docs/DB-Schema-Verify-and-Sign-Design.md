# Design: DB Schema Verify & Sign (v2)

## Overview

This document specifies the production-ready design for:

- `prisma-next db schema-verify` — catalog-based verification that the *live database schema* satisfies the emitted contract, ignoring the marker table.
- The `db sign` flow’s dependency on schema verification — `db sign` will reuse the same verification behavior with a shared strictness flag.

This replaces the earlier “Option A” brief under `docs/briefs/07-CLI-DB-Schema-Verify-Option-A.md` (now removed) and aligns with the current architecture:

- Contract-first, with `contract.json` as the canonical source of schema requirements.
- Control-plane executor living in `@prisma-next/control-plane`, with the framework CLI target-agnostic.
- Family/target/extension-specific logic implemented behind family hooks (no target-branches in the framework CLI).

### Goals

- Provide a deterministic, target-agnostic `db schema-verify` command that:
  - Loads config and emitted contract.
  - Connects to the configured database.
  - Delegates all schema comparison to family/target/extension hooks.
  - Reports whether the DB schema satisfies the contract (permissive mode first; strict mode stubbed).
- Prepare a stable programmatic API (`verifyDatabaseSchema`) that `db sign` can call.
- Keep JSON envelopes, exit codes, and PN error codes consistent with the CLI Style Guide.

### Non-goals (v1)

- No automatic contract emission or contract profile selection; `contract.json` must already exist.
- No multi-environment switching or shadow database support; we always use the primary DB from config (or `--db` override when we add it).
- No fully implemented strict mode; strictness is wired through but the strict strategy itself is allowed to be a stub.

## User-facing CLI

### Command shape

- Canonical command: `prisma-next db schema-verify`
  - Grouped under the existing `db` command alongside `db verify` and (later) `db sign`.
  - Flat subcommand name `schema-verify` for now (no nested `db schema verify` group).

### Flags

- Shared/global flags (per CLI Style Guide):
  - `--config <path>`: path to `prisma-next.config.*` (optional; default discovery applies).
  - `--json[=object|ndjson]`: JSON output (object for this command).
  - `-q, --quiet`: errors only.
  - `-v, --verbose`: debug info, timings.
  - `-vv, --trace`: deeper internals, stack traces.
  - `--timestamps`: prefix lines with ISO timestamps.
  - `--color`, `--no-color`: control ANSI output.
- Command-specific flags:
  - `--strict`: enable strict strategy (fail on extra schema elements); wired through but initially stubbed.
  - Future-compatible (not in v1): `--db <url>` override, `--mode=<strategy>` if we add additional strategies.

### Behavior

- Baseline behavior (permissive mode, default):
  - Load CLI config using existing loader (same as `db verify`):
    - Resolve `configPath` from `--config` or default discovery.
  - Resolve database URL:
    - v1: use primary DB from `config.db.url` (no shadow DB, no environment flag).
  - Load `contract.json`:
    - Resolve path from `config.contract.output` if present, otherwise `src/prisma/contract.json`.
    - Fail if file does not exist (no auto-emit).
  - Validate contract:
    - Use `config.family.validateContractIR(contractJson)` to produce a validated `contractIR`.
  - Delegate to control-plane:
    - Construct a `ControlExecutor`-like path for schema verification via a family-level schema verify hook (details below).
  - Interpret results:
    - `ok: true` → exit code `0`, success output.
    - `ok: false` with schema violations → exit code `1`, PN-SCHEMA error code.
    - Usage/config errors (missing DB URL, missing contract file, missing family hook) → exit code `2` with PN-CLI codes per existing patterns.

### Output (TTY)

- For TTY/human output:
  - Header via `formatStyledHeader`:
    - `command: db schema-verify`.
    - `description: Verify database schema satisfies emitted contract`.
    - `details`:
      - `config: <configPath>`.
      - `contract: <contractJsonPath>`.
      - Optionally `database: <dbUrl>` when we add `--db`.
  - Success:
    - First line: `✓ Database schema satisfies contract`.
    - Optional second line(s) with core hash/profile hash and total timing at `-v`.
  - Failure (schema mismatch):
    - First line: `✖ Contract requirements not met (PN-SCHEMA-XXXX)`.
    - Followed by a compact, structured list of unmet requirements, e.g.:
      - `Contract requirements not met:`
      - `- table posts: not present`
      - `- table users`
      - `  - column name`
      - `    - type mismatch: expected text, found integer`
    - Only list requirements that the contract depends on; ignore extra schema in permissive mode.

### Output (JSON)

- `--json` (or `--json=object`) produces a single JSON object to stdout:

```jsonc
{
  "ok": true,
  "code": null,
  "summary": "Database schema satisfies contract",
  "contract": {
    "coreHash": "…",
    "profileHash": "…"
  },
  "target": {
    "expected": "postgres",
    "actual": "postgres"
  },
  "schema": {
    "issues": []
  },
  "meta": {
    "configPath": "prisma-next.config.ts",
    "contractPath": "src/prisma/contract.json",
    "strict": false
  },
  "timings": {
    "total": 42
  }
}
```

- When requirements are not met:

```jsonc
{
  "ok": false,
  "code": "PN-SCHEMA-0001",
  "summary": "Contract requirements not met",
  "contract": {
    "coreHash": "…",
    "profileHash": "…"
  },
  "target": {
    "expected": "postgres",
    "actual": "postgres"
  },
  "schema": {
    "issues": [
      {
        "kind": "missing_table",
        "table": "posts",
        "message": "Table posts is required by the contract but not present."
      },
      {
        "kind": "missing_column",
        "table": "users",
        "column": "name",
        "message": "Column users.name is required by the contract but not present."
      },
      {
        "kind": "type_mismatch",
        "table": "users",
        "column": "name",
        "expected": "text",
        "actual": "integer",
        "message": "Column users.name has incompatible type; expected text, found integer."
      }
    ]
  },
  "meta": {
    "configPath": "…",
    "contractPath": "…",
    "strict": false
  },
  "timings": {
    "total": 57
  }
}
```

Notes:

- Envelope mirrors `VerifyDatabaseResult` from `db verify`:
  - Top-level `ok`, `code`, `summary`, `contract`, `target`, `meta`, `timings`.
  - Schema-specific details live under `schema.{ issues: [] }`.
- `code`:
  - `null` or omitted for success.
  - `PN-SCHEMA-0001` for “contract requirements not met” (single generic schema mismatch code).
- Exit codes:
  - `0`: `ok: true`.
  - `1`: runtime/schema error (`ok: false` with `code` in `PN-SCHEMA-*`).
  - `2`: usage/config error (`PN-CLI-*` or similar), consistent with CLI Style Guide.

## Programmatic API: verifyDatabaseSchema

We add a programmatic API in the framework CLI package, parallel to `verifyDatabase`:

- Location: `packages/framework/tooling/cli/src/api/verify-database-schema.ts`.
- Signature (conceptual):

```ts
export interface VerifyDatabaseSchemaOptions {
  readonly dbUrl?: string;
  readonly configPath?: string;
  readonly strict?: boolean;
}

export interface SchemaIssue {
  readonly kind:
    | 'missing_table'
    | 'missing_column'
    | 'type_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'extension_missing';
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
}

export interface VerifyDatabaseSchemaResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly schema: {
    readonly issues: readonly SchemaIssue[];
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
    readonly strict: boolean;
  };
  readonly timings: {
    readonly total: number;
  };
}
```

### Responsibilities

- `verifyDatabaseSchema` (framework CLI):
  - Load config (via `loadConfig`).
  - Resolve DB URL (for now: `config.db.url` only).
  - Resolve and read `contract.json` (fail fast if missing).
  - Validate contract via `config.family.validateContractIR`.
  - Construct or obtain a `ControlPlaneDriver` from the configured driver (same pattern as `verifyDatabase`).
  - Delegate schema comparison to family/target/extension via a single `verifySchema` hook.
  - Normalize the family’s result into `VerifyDatabaseSchemaResult`.
  - Ensure the driver is closed.
  - Throw CLI-typed errors (`errorDatabaseUrlRequired`, `errorFileNotFound`, `errorFamilySchemaVerifierRequired`, etc.) as needed.

- Family/target/extension (via control-plane/family SPI):
  - Perform catalog introspection and comparison.
  - Own type compatibility rules, nullability semantics, index naming, etc.
  - Only read schema elements that the contract depends on (tables, columns, and relationships referenced by the contract).

## Family SPI for Schema Verification

We extend the control-plane family descriptor with a schema verification hook:

- In `@prisma-next/control-plane/types` (or equivalent), we enrich `FamilyDescriptor.verify`:

```ts
export interface FamilyDescriptor {
  // existing fields …
  readonly verify?: {
    readMarker: (driver: ControlPlaneDriver) => Promise<ContractMarkerRecord | null>;
    collectSupportedCodecTypeIds?: (
      descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
    ) => readonly string[];
    verifySchema?: (options: {
      readonly driver: ControlPlaneDriver;
      readonly contractIR: unknown;
      readonly target: TargetDescriptor;
      readonly adapter: AdapterDescriptor;
      readonly extensions: ReadonlyArray<ExtensionDescriptor>;
      readonly strict: boolean;
      readonly startTime: number;
      readonly contractPath: string;
      readonly configPath?: string;
    }) => Promise<VerifyDatabaseSchemaResult>;
  };
}
```

Key points:

- Single monolithic `verifySchema` hook to keep the framework CLI simple.
- The framework CLI passes:
  - `driver`: already created from the configured driver descriptor.
  - `contractIR`: validated contract IR from the family.
  - `target`, `adapter`, `extensions`: same descriptors passed to `ControlExecutor`.
  - `strict`: strictness flag from the CLI; strict mode is stubbed in v1 but wired through.
  - `startTime`, `configPath`, `contractPath`: allow the family to set timings and meta.
- The hook returns a fully populated `VerifyDatabaseSchemaResult` (or a family-internal equivalent that the CLI can adapt 1:1).

### Strict vs permissive

- Permissive mode (default, `strict === false`):
  - Fail if any *contract-required* schema structure is missing or incompatible:
    - Missing table.
    - Missing column.
    - Incompatible column type or nullability, as defined by the family’s compatibility rules.
    - Missing required index/unique/foreign key/primary key that the contract depends on.
    - Missing extension-backed types when the contract uses them.
  - Ignore extra tables/columns/indexes not referenced by the contract.

- Strict mode (`strict === true`, v1 stub):
  - The hook *receives* `strict: true`, but is allowed to treat it like permissive mode initially.
  - Later, strict mode will:
    - Fail when extra tables/columns/indexes exist in the schema that aren’t represented in the contract, *within the managed schema(s)*.
    - Possibly enforce stricter type equalities instead of family-defined compatibility.

## Relation to db sign

`db sign` will build on top of `db schema-verify` and the `verifyDatabaseSchema` API:

- CLI:
  - `prisma-next db sign` will:
    - Accept `--strict` and propagate it to `verifyDatabaseSchema`.
    - Refuse to sign when `verifyDatabaseSchema` returns `ok: false` unless `--force` is provided.
    - Use the existing marker read/write helpers for marker management.
- Programmatic:
  - The `sign` API will:
    - Call `verifyDatabaseSchema`.
    - If `ok: false` and not forced, surface the schema issues alongside PN-SCHEMA code.
    - If forced, carry the schema issues into the sign result (e.g., with `forced: true` and a separate warning code).

This design ensures:

- `db schema-verify` can be used independently (e.g., in CI).
- `db sign` reuses the same verification hook and result shape, avoiding divergence.

## Error handling & PN codes

- Schema mismatch:
  - Generic schema mismatch code: `PN-SCHEMA-0001`.
  - Summary: `"Contract requirements not met"`.
  - `schema.issues` carries detailed, machine-readable issue list.
- Config/usage errors:
  - Exit code `2`.
  - Reuse existing `PN-CLI-*` codes where appropriate:
    - Missing DB URL (no `db.url` in config and no `dbUrl` override).
    - Missing contract file (`ENOENT` when reading contract).
  - Add a new CLI error for missing family schema verifier:
    - `errorFamilySchemaVerifierRequired` producing a `PN-CLI-*` code with summary:
      - `"Family verifySchema helper is required for db schema-verify"`.
- Runtime/driver/family errors:
  - Exit code `1`.
  - Use `errorRuntime` or family-specific PN codes, but keep schema mismatch under `PN-SCHEMA-*`.

## Implementation notes

- Framework CLI:
  - New API module `verify-database-schema.ts` mirrors `verify-database.ts`:
    - Shared config loading, contract reading, and driver creation.
    - Different delegation: call `family.verify.verifySchema` instead of `ControlExecutor.verifyAgainst`.
  - New command module `db-schema-verify.ts`:
    - Register under `db` in `cli.ts` as `schema-verify`.
    - Use `formatStyledHeader`, `handleResult`, and new formatting helpers (`formatSchemaVerifyOutput`, `formatSchemaVerifyJson`).
    - Map non-OK results with `code === 'PN-SCHEMA-0001'` to PN errors when needed, but primarily rely on the structured result for output.

- Family implementation (SQL, Postgres first):
  - Implement the schema verification logic in `packages/sql/tooling/cli` (or a similar family-specific tooling package), wired through the family’s `/cli` entrypoint.
  - Use a migration-plane driver interface (`ControlPlaneDriver`) and catalog queries (e.g., Postgres `pg_catalog` tables) to:
    - Discover tables/columns/indexes/constraints relevant to the contract.
    - Compute `SchemaIssue[]` according to the family’s type compatibility and constraint semantics.
  - Keep all SQL-specific details out of the framework CLI package; only the family knows how to interpret `contractIR` and catalog metadata.

## Related docs

- CLI Style Guide: `docs/CLI Style Guide.md`
- Control Plane Executor: `docs/briefs/complete/Control-Plane-Executor.md`
- DB Verify: `docs/briefs/complete/02-CLI-DB-Verify.md`
- DB Sign: `docs/DB-Sign-CLI.md`, `docs/briefs/03-CLI-DB-Sign.md`
