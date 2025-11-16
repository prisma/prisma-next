## Project Brief: SQL Schema IR – Verification Phase

### Overview

This project refactors SQL schema verification (`db schema-verify`) to operate over a **target‑agnostic SQL Schema IR** instead of raw Postgres catalogs and ad‑hoc logic. The goal is to make verification correct, explicit, and extensible, while laying a clean foundation for the upcoming migration planner.

### Goals

- **Define and adopt `SqlSchemaIR`** as the canonical in‑memory representation of SQL schemas for the SQL family.
- **Make type verification explicit** by using codec/column metadata for native DB type, instead of parsing codec IDs.
- **Isolate target‑specific introspection** in a Postgres introspector that produces `SqlSchemaIR`.
- **Refactor the SQL family `verifySchema`** implementation to:
  - Compare contract vs `SqlSchemaIR` (tables, columns, types, constraints, indexes).
  - Aggregate extension‑level checks via an extension SPI hook.
- **Demonstrate extension verification** by adding a `verifySchema` implementation to the pgvector extension pack.

### Non‑Goals (for this phase)

- Designing or implementing the full migration planner (only its relationship to `SqlSchemaIR` is considered).
- Supporting non‑Postgres SQL targets.
- Changing the external CLI contract for `db schema-verify` (command name, flags, output envelope).

### Deliverables

- **Types & IR**
  - `SqlSchemaIR`, `SqlTableIR`, `SqlColumnIR`, `SqlForeignKeyIR`, `SqlUniqueIR`, `SqlIndexIR`, `SqlAnnotations` types in the SQL family (e.g. `packages/sql/contract` or a new `packages/sql/schema-ir`).
- **Codec Metadata**
  - Extended codec definitions with explicit `nativeType` metadata per target (starting with Postgres + pgvector).
- **Postgres Introspector**
  - `introspectPostgresSchema(driver): Promise<SqlSchemaIR>` containing:
    - Tables, columns (with `nativeType`), PK/FK/uniques/indexes.
    - Extension list and any Postgres annotations needed for verification.
- **Refactored `verifySchema`**
  - SQL family `verifySchema` implementation that:
    - Consumes `SqlSchemaIR` + contract.
    - Emits `VerifyDatabaseSchemaResult` with the same external shape.
    - No longer queries `information_schema` directly.
- **Extension SPI & Example**
  - Extended `ExtensionDescriptor` with optional `verifySchema` hook.
  - A concrete implementation in `@prisma-next/extension-pgvector` that:
    - Checks presence/health of the pgvector extension for relevant contract usage.
    - Produces extension‑level issues integrated into `SchemaIssue`.
- **Tests**
  - Updated unit tests for the SQL family verifier to cover IR‑based behavior.
  - Updated CLI API + E2E tests for `db schema-verify` that still assert:
    - Correct exit codes and error envelopes.
    - Correct JSON/human output for schema mismatches.
    - Correct behavior when extension checks fail (e.g. pgvector not installed).

### Scope & Tasks (Near‑Term Verification)

#### 1. Define `SqlSchemaIR` Types

- Add IR types in a shared SQL package:
  - `SqlSchemaIR` with `tables`, `extensions`, `annotations`.
  - `SqlTableIR`, `SqlColumnIR`, `SqlForeignKeyIR`, `SqlUniqueIR`, `SqlIndexIR`, `SqlAnnotations`.
- Export these types for:
  - SQL family `verifySchema`.
  - Future migration code.

#### 2. Add Explicit Native Type Metadata to Codecs

- Extend Postgres codec type definitions (core + pgvector) with `nativeType` metadata, e.g.:
  - `CodecMeta.db.sql.postgres.nativeType = 'integer' | 'text' | 'vector' | 'timestamp with time zone' | …`.
- Ensure this metadata is available:
  - Where the SQL family assembles codecs for the contract.
  - To the Postgres introspector when constructing `SqlColumnIR.nativeType`.
- Remove or deprecate string‑based inference of DB types from codec IDs in verification logic.

#### 3. Implement `introspectPostgresSchema(driver) → SqlSchemaIR`

- Extract the existing Postgres catalog queries from `verifySchema` into a dedicated `introspectPostgresSchema(driver)` function that returns `SqlSchemaIR`.
- Populate:
  - `tables`, `columns`, PK/FK/uniques/indexes.
  - `nativeType` for each column using `data_type`/`udt_name` and codec metadata.
  - `extensions` from `pg_extension` (or via annotations under `pg` namespace).
- Ensure this is the only place that contains Postgres‑specific SQL for schema introspection.

#### 4. Refactor SQL Family `verifySchema` to Use IR

- Change implementation (not SPI) of SQL family `verifySchema` to:
  - Call the Postgres introspector to obtain `SqlSchemaIR`.
  - Compare contract vs IR instead of contract vs raw catalog rows.
  - Produce `SchemaIssue`s solely from IR + contract + extension hooks.
- Keep:
  - `VerifyDatabaseSchemaResult` shape unchanged.
  - Family descriptor SPI unchanged for framework/CLI.

#### 5. Add Extension‑Level `verifySchema` SPI

- Extend `ExtensionDescriptor` with an optional `verifySchema` hook that receives:
  - `driver`, `contractIR`, `schemaIR`, `strict`.
- Update SQL family `verifySchema` to:
  - Call each extension’s `verifySchema` hook (if present).
  - Map extension‑level issues into family‑level `SchemaIssue`s (e.g. `extension_missing`, `index_mismatch`, etc.).
- Ensure the mapping preserves enough detail (issue kind, table, column, message) for CLI output.

#### 6. Implement pgvector `verifySchema` Hook

- In `@prisma-next/extension-pgvector`:
  - Implement `verifySchema` that:
    - Confirms the vector extension is “present” according to `schemaIR` (e.g. via `extensions` or `annotations.pg.extensions`).
    - Validates that vector columns in the contract:
      - Have compatible `nativeType` (`vector`).
      - Satisfy any pgvector‑specific constraints encoded in annotations (dimensions, distance metric), if those are modeled.
    - Optionally checks presence/shape of vector indexes, if we have a representation in `SqlSchemaIR`.
  - Return extension‑level issues if any invariants are violated.

#### 7. Update Tests and CLI Wiring

- Update SQL family unit tests to:
  - Assert correctness of IR‑based verification for core cases (missing tables, columns, type mismatches, nullability, PK/FK/index mismatches).
- Update CLI API + E2E tests for `db schema-verify` to:
  - Confirm behavior is unchanged from the user’s perspective:
    - Same exit codes for success/failure.
    - Same PN error codes where applicable (e.g. missing DB URL, missing family hook).
    - Same `ok / code / summary / schema.issues` structure in JSON output.
  - Add tests specifically for extension‑level verification (e.g. pgvector not installed).

### Risks & Considerations

- **Type metadata plumbing**: Codec `nativeType` metadata must be consistently wired from packs into the places where the IR is constructed; missing metadata can degrade verification quality.
- **IR stability**: `SqlSchemaIR` should be designed carefully to avoid frequent breaking changes, since both verification and future migration planning will depend on it.
- **Transition period**: During refactor, we must avoid diverging behaviors between “old” and “IR‑based” verification; tests must guard against regressions.

### Success Criteria

- `db schema-verify` passes all existing tests and any new IR‑based tests with no behavioral regressions from the user’s perspective.
- SQL family `verifySchema` no longer talks directly to Postgres catalogs; all target‑specific work is done in the Postgres introspector.
- Extension packs (pgvector) can express extension‑level invariants via `verifySchema`, and those invariants are reported as schema issues when violated.
- The `SqlSchemaIR` shape is stable and demonstrably suitable for both verification and the upcoming migration planner.


