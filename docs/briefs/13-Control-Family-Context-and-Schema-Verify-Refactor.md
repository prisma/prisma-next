# Brief: Control-Plane Family Context & Schema Verify Refactor

## Problem

The control-plane schema verification flow is conceptually generic, but some SQL-specific mechanics still leak into the framework CLI:

- `db schema-verify`:
  - Imports SQL-family types (`SqlFamilyContext`) and helpers (`createSqlTypeMetadataRegistry`).
  - Hydrates adapter instances and calls `adapter.profile.codecs()` directly.
  - Builds a SQL type metadata registry in the CLI rather than delegating to the family.
- `FamilyDescriptor.verify`:
  - Uses a nested `verify` namespace; schema-related hooks live under `verify.*`.
  - Lacks a first-class hook for “prepare family-specific control-plane context from descriptors”.

We want:

- A **control-plane-specific family descriptor** (separate from runtime) with:
  - A flattened SPI (no nested `verify`).
  - A `prepareControlContext` hook to build context (e.g., SQL type metadata) from descriptors.
- A **family-specific context type** (`TCtx extends TargetFamilyContext`) that:
  - Encodes control-plane state (e.g., `SqlFamilyContext` with `types`).
  - Is constructed by the family, not by the CLI.
- A **generic domain action flow**:
  - CLI → `family.prepareControlContext` → `verifyDatabaseSchema` → `introspectDatabaseSchema` + `verifySchemaAgainstContract`.
  - The CLI remains family-agnostic; all SQL-specific strategy lives in the SQL family.

## Goals

- Flatten `FamilyDescriptor.verify` into top-level control-plane hooks:
  - `readMarker`, `collectSupportedCodecTypeIds`, `prepareControlContext`, `introspectSchema`, `verifySchema`.
- Introduce/standardize a family-specific control-plane context:
  - For SQL: `SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & { types: SqlTypeMetadataRegistry }`.
- Move all SQL-specific context assembly into the SQL family:
  - Control-plane code no longer calls `adapter.profile.codecs()` or `createSqlTypeMetadataRegistry` directly in the CLI.
- Keep `verifyDatabaseSchema` and `introspectDatabaseSchema` generic over `TCtx extends TargetFamilyContext`:
  - They should orchestrate family hooks, not know anything about SQL.

## Out of Scope

- Runtime family descriptors and contexts (execution plane).
- Changing the semantics of `verifyDatabaseSchema` results or JSON envelopes.

## Implementation Plan

### 1. Flatten FamilyDescriptor control-plane hooks

- File: `packages/framework/core-control-plane/src/types.ts`
- Changes:
  - Replace the nested `verify?: { ... }` structure in `FamilyDescriptor` with top-level optional hooks:

    - `readMarker?: (driver: ControlPlaneDriver) => Promise<ContractMarkerRecord | null>`
    - `collectSupportedCodecTypeIds?: (...) => readonly string[]`
    - `prepareControlContext?: (options: { contractIR, target, adapter, extensions }) => Promise<Omit<TCtx, 'schemaIR'>>>`
    - `introspectSchema?: (options: { driver, contextInput, contractIR?, target, adapter, extensions }) => Promise<TCtx['schemaIR']>>`
    - `verifySchema?: (options: { contractIR, schemaIR, target, adapter, extensions }) => Promise<{ issues: SchemaIssue[] }>>`

  - Update comments to describe the new flattened SPI and how `TCtx` is used.

### 2. Update domain actions to use flattened hooks

- Files:
  - `packages/framework/core-control-plane/src/actions/introspect-database-schema.ts`
  - `packages/framework/core-control-plane/src/actions/verify-database-schema.ts`
- Changes:
  - `introspectDatabaseSchema`:
    - Replace `family.verify?.introspectSchema` with `family.introspectSchema`.
    - Update error messages accordingly (“Family introspectSchema() is required”).
  - `verifyDatabaseSchema`:
    - Continue to call `introspectDatabaseSchema` and `verifySchemaAgainstContract` as today.
    - No SQL-specific changes; just rely on the flattened SPI exposed via `FamilyDescriptor`.

### 3. Implement prepareControlContext for SQL family

- Files:
  - `packages/sql/family/src/context.ts` (already defines `SqlFamilyContext`).
  - `packages/sql/family/src/type-metadata.ts` (already defines `createSqlTypeMetadataRegistry`).
  - `packages/sql/family/src/verify.ts` or a nearby module for family SPI exports.
- Changes:
  - Add a `prepareControlContext` implementation in the SQL family control export:
    - Hydrate the adapter instance from `AdapterDescriptor` (using `adapter.adapter` or `adapter.create()`).
    - Obtain a runtime `CodecRegistry` from `adapterInstance.profile.codecs()`.
    - Collect extension `typeMetadata` from control-plane extensions (typed as `SqlTypeMetadata[]`).
    - Call `createSqlTypeMetadataRegistry([{ codecRegistry }, { typeMetadata: extensionTypeMetadata }])`.
    - Return `{ types }` as `Omit<SqlFamilyContext, 'schemaIR'>`.
  - Wire this function into the control-plane family descriptor export (`packages/sql/family/src/exports/control.ts`) as `prepareControlContext`.

### 4. Simplify db-schema-verify CLI to be family-agnostic

- File: `packages/framework/tooling/cli/src/commands/db-schema-verify.ts`
- Changes:
  - Remove all SQL-specific imports and logic:
    - Drop imports of `SqlFamilyContext` and `createSqlTypeMetadataRegistry`.
    - Remove adapter hydration and codec registry handling from the command.
  - After loading config and contract and resolving DB URL:
    - If `config.family.prepareControlContext` is present, call it:

      ```ts
      const contextInput =
        (config.family.prepareControlContext
          ? await config.family.prepareControlContext({
              contractIR,
              target: config.target,
              adapter: config.adapter,
              extensions: config.extensions ?? [],
            })
          : ({} as Omit<TCtx, 'schemaIR'>));
      ```

      (Where `TCtx` is generic in the domain action; the CLI can pass `contextInput` as `unknown`/`any` as long as types line up in TypeScript.)

    - Call `verifyDatabaseSchema` with:
      - `family: config.family`
      - `target: config.target`
      - `adapter: config.adapter`
      - `extensions: config.extensions ?? []`
      - `contextInput` from the family
    - Keep the rest of the behavior (header formatting, JSON/TTY output, exit codes) unchanged.
  - Ensure no direct references to SQL-specific types or helpers remain in this command.

### 5. Update SQL family control export

- File: `packages/sql/family/src/exports/control.ts`
- Changes:
  - Ensure the control-plane `FamilyDescriptor<SqlFamilyContext>` exposes:
    - `prepareControlContext`
    - `introspectSchema`
    - `verifySchema`
    - `readMarker` (existing marker helper)
  - Confirm that the `family` object exported from here matches the flattened SPI in `core-control-plane/types.ts`.

### 6. Tests and validation

- Update or add tests to cover the new flow:
  - Core control-plane:
    - Unit tests for `introspectDatabaseSchema` and `verifyDatabaseSchema` using a fake family with `prepareControlContext`, `introspectSchema`, and `verifySchema`.
  - SQL family:
    - Unit tests for `prepareControlContext`:
      - Adapter codec → type metadata → registry.
      - Extension `typeMetadata` contributions.
    - Existing `verify-schema` tests should continue to pass, now consuming `types` via `SqlFamilyContext`.
  - CLI:
    - `db-schema-verify` e2e tests should:
      - Use configs that point to the SQL control family.
      - Confirm that the command succeeds/fails as before and that JSON/TTY output shape and PN codes are unchanged.

## Acceptance Criteria

- `FamilyDescriptor` in `core-control-plane/types.ts` exposes flattened control-plane hooks (no nested `verify`).
- `SqlFamilyContext` is the only control-plane context type for SQL; it is constructed via `prepareControlContext`, not in the CLI.
- The SQL family control export (`/control`) implements:
  - `prepareControlContext`, `introspectSchema`, `verifySchema`, and `readMarker`.
- `verifyDatabaseSchema` and `introspectDatabaseSchema` remain generic and use only `FamilyDescriptor` hooks and `contextInput`, not SQL-specific abstractions.
- `db schema-verify` command:
  - No longer imports SQL-specific helpers or types.
  - Builds family-specific context exclusively via `family.prepareControlContext`.
  - Keeps existing user-facing behavior (flags, output, exit codes, JSON envelope).

