# Design: SQL Type Metadata for Control Plane & Execution Plane

## Overview

This document defines a dedicated **SQL type metadata** abstraction that both the **execution plane** and the **control plane** can use, instead of overloading the runtime `CodecRegistry` for metadata-only tasks.

Today we use the same codec registry abstraction for:

- Execution plane: encoding/decoding values during query execution.
- Control plane: checking which SQL storage types exist and how they map to contract type IDs.

The control plane only needs “what types are available and how they map to native database types,” not encode/decode behavior. This design separates those concerns and removes control-plane types from `@prisma-next/sql-contract`.

## Current State

### Where codec registry is defined and used

- `@prisma-next/sql-relational-core/ast`:
  - Defines concrete `CodecRegistry` and codec implementations (execution plane).
  - Used by the runtime (`sql-runtime`), Postgres adapter, tests, etc.
- `@prisma-next/sql-contract` (`packages/sql/contract/src/types.ts`):
  - Defines a `Codec` interface and `SqlCodecRegistry` interface.
  - Defines `SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & { codecRegistry: SqlCodecRegistry }`.
  - These are explicitly tagged as control-plane interfaces but live in a contract package.
- SQL family verify SPI (`packages/sql/family/src/verify.ts`):
  - `introspectSchema` takes `contextInput: Omit<SqlFamilyContext, 'schemaIR'>` and pulls out `codecRegistry`.
  - Delegates to `introspectPostgresSchema(driver, codecRegistry, contractIR)`.
- Postgres adapter introspection (`packages/targets/postgres-adapter/src/exports/introspect.ts`):
  - `introspectPostgresSchema(driver, codecRegistry, contract?, schema?)`.
  - `mapDatabaseTypeToCodec(databaseType, codecRegistry)`:
    - Iterates over `codecRegistry.values()`.
    - Reads `codec.id` and `codec.meta?.db?.sql?.postgres?.nativeType`.
    - Does not use encode/decode or lookup helpers; only metadata.
- CLI `db schema-verify` (`packages/framework/tooling/cli/src/commands/db-schema-verify.ts`):
  - Imports `createCodecRegistry` from `@prisma-next/sql-relational-core/ast` and `SqlCodecRegistry` from `@prisma-next/sql-contract/types`.
  - Builds a `SqlCodecRegistry` using adapter codecs, passes it into a SQL-family context, and then into `verifyDatabaseSchema`.

### Problems

- **Layering leak**:
  - `sql-contract` imports `TargetFamilyContext` from the control plane and defines `SqlFamilyContext`.
  - Contract types should be plane-agnostic; control-plane context does not belong here.
- **Codec registry overreach**:
  - `SqlCodecRegistry` exposes encode/decode-oriented APIs (`get`, `has`, `getByScalar`, `getDefaultCodec`, `register`), but control plane only uses:
    - `values()` iteration.
    - `codec.id` and `codec.meta.db.sql.postgres.nativeType`.
- **CLI coupling to execution-plane packages**:
  - Framework CLI imports runtime `createCodecRegistry` solely to access codec metadata.
  - This makes the control plane depend directly on execution-plane code.

## Design Goals

- Introduce a clear **SQL type metadata abstraction** that both planes can use for “what types exist” questions.
- Remove control-plane types (`SqlCodecRegistry`, `SqlFamilyContext`) from `@prisma-next/sql-contract`.
- Make the control plane depend on the **metadata view**, not on execution-plane codec registries.
- Let the SQL family be responsible for building type metadata from:
  - The adapter’s codecs.
  - Control-plane extension objects (per the control-plane extensions design).

## Type Metadata Abstraction

We introduce a minimal type metadata view that both planes can rely on when they only need type availability and mapping information.

Conceptual interfaces:

```ts
export interface SqlTypeMetadata {
  readonly typeId: string;              // e.g. 'pg/int4@1', 'pg/text@1'
  readonly targetTypes: readonly string[]; // contract scalar types handled by this typeId
  readonly nativeType?: string;         // e.g. 'integer', 'text', 'character varying'
}

export interface SqlTypeMetadataRegistry {
  values(): IterableIterator<SqlTypeMetadata>;
}
```

Notes:

- This is **read-only**: callers can iterate, not mutate.
- It intentionally does not expose encode/decode or lookup helpers; those belong to the execution-plane `CodecRegistry`.
- `SqlTypeMetadata` is derived from codec definitions and/or extension metadata, but the abstraction itself does not mention codecs.

## Building Metadata from Adapter + Extensions

The SQL family provides a helper that constructs a `SqlTypeMetadataRegistry` from:

- The adapter’s codec registry.
- Control-plane extension objects that may contribute additional type metadata.

Conceptual helper:

```ts
export interface SqlTypeMetadataSource {
  // Adapters contribute via their runtime codecs
  readonly codecRegistry?: CodecRegistry;

  // Control-plane extensions can contribute metadata directly
  readonly typeMetadata?: ReadonlyArray<SqlTypeMetadata>;
}

export function createSqlTypeMetadataRegistry(
  sources: ReadonlyArray<SqlTypeMetadataSource>,
): SqlTypeMetadataRegistry;
```

Responsibilities:

- For each source:
  - If it has a `codecRegistry`, project each codec into metadata:
    - `typeId` from `codec.id`.
    - `targetTypes` from `codec.targetTypes`.
    - `nativeType` from `codec.meta?.db?.sql?.postgres?.nativeType` (for PostgreSQL).
  - If it has explicit `typeMetadata`, include those entries as-is.
- Deduplicate entries by `typeId` while preserving stable resolution order:
  - Adapter types first.
  - Then extension types.
  - Then any app-provided overrides, if we add them later.

### Plane responsibilities

- **Execution plane**:
  - Runtime can construct `SqlTypeMetadataRegistry` from its `CodecRegistry` when needed (e.g., for tooling, plan rendering, or debugging).
  - Execution-plane code remains the owner of codec definitions and runtime registry behavior.

- **Control plane**:
  - CLI/Control-plane domain actions hand the SQL family:
    - Adapter instance (or a `CodecRegistry` derived from it).
    - Control-plane extension objects that expose `typeMetadata` (or a helper to produce it).
  - The SQL family constructs a `SqlTypeMetadataRegistry` from these sources and passes it into introspection.

## Changes to Introspection & Verify SPI

### Postgres introspection

We change `introspectPostgresSchema` to depend on metadata, not codecs:

- From:

```ts
export async function introspectPostgresSchema(
  driver: ControlPlaneDriver,
  codecRegistry: CodecRegistry,
  contract?: unknown,
  schema = 'public',
): Promise<SqlSchemaIR>;
```

- To:

```ts
export async function introspectPostgresSchema(
  driver: ControlPlaneDriver,
  types: SqlTypeMetadataRegistry,
  contract?: unknown,
  schema = 'public',
): Promise<SqlSchemaIR>;
```

And change the mapper:

- From `mapDatabaseTypeToCodec(databaseType, codecRegistry)` to:

```ts
function mapDatabaseTypeToTypeMetadata(
  databaseType: string | undefined,
  types: SqlTypeMetadataRegistry,
): { typeId: string; nativeType: string } | undefined;
```

Implementation stays the same structurally:

- Normalize DB type name.
- Iterate over `types.values()` and match by `nativeType`.
- Fall back to alias mapping if needed.
- Return `typeId` and the original DB type as `nativeType`.

### SQL family verify SPI

The SQL family’s control-plane SPI no longer sees a codec registry in its context. Instead:

- `SqlFamilyContext` becomes:

```ts
export type SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & {
  readonly types: SqlTypeMetadataRegistry;
};
```

- `introspectSchema` receives a `types` field rather than `codecRegistry`:

```ts
export async function introspectSchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contextInput: Omit<SqlFamilyContext, 'schemaIR'>; // now includes .types
  readonly contractIR?: unknown;
  readonly target: TargetDescriptor<SqlFamilyContext>;
  readonly adapter: AdapterDescriptor<SqlFamilyContext>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<SqlFamilyContext>>;
}): Promise<SqlSchemaIR> {
  const { driver, contractIR, contextInput } = options;
  const types = contextInput.types;

  // Delegate to Postgres adapter
  if (options.target.id !== 'postgres') {
    throw new Error(`Schema introspection for target '${options.target.id}' is not yet supported`);
  }

  return introspectPostgresSchema(driver, types, contractIR);
}
```

The rest of `verifySchema` continues to compare contract IR with `SqlSchemaIR` based on `typeId` and other structural information; it does not need to know about codecs.

## CLI Changes (Control Plane)

`db schema-verify` will stop assembling a codec registry directly and instead delegate to the SQL family to produce type metadata:

- Today in `db-schema-verify.ts`:
  - CLI imports `createCodecRegistry` from `@prisma-next/sql-relational-core/ast`.
  - CLI builds a `SqlCodecRegistry` by:
    - Creating a registry.
    - Registering adapter codecs.
  - CLI passes `{ codecRegistry }` into `contextInput` for schema verification.

- After refactor:
  - CLI imports a helper from the SQL family (e.g., `createSqlTypeMetadataRegistryFromConfig`) or uses a generic control-plane helper that:
    - Takes the adapter descriptor (and control-plane extensions).
    - Obtains an adapter instance (and extension metadata).
    - Calls `createSqlTypeMetadataRegistry(...)`.
  - CLI passes `{ types }` into `contextInput`.
  - CLI no longer needs to import `createCodecRegistry` from the execution-plane package.

This keeps the framework CLI target-family agnostic; SQL-specific logic lives in the SQL family and adapter packages.

## Moving Control-Plane Types Out of sql-contract

With the metadata abstraction in place:

- `SqlCodecRegistry` and control-plane `Codec` interfaces are no longer needed in `@prisma-next/sql-contract`.
- `SqlFamilyContext` and other control-plane context types should live alongside:
  - SQL family verify SPI (`packages/sql/family/src`).
  - SQL schema IR types (`@prisma-next/sql-schema-ir`).

Plan:

- Move `SqlFamilyContext` to a SQL family-local context module (e.g., `packages/sql/family/src/context.ts`).
- Remove control-plane codec interfaces from `sql-contract`:
  - Keep only contract-level types (storage, mappings, etc.).
- Ensure no dependency cycles:
  - SQL family can depend on core-control-plane types and SQL schema IR.
  - Contract package remains independent of control-plane types.

## Extensions and Type Metadata

Per the control-plane extensions design:

- Each extension has a **control-plane entrypoint** that can optionally provide type metadata:

```ts
export interface ControlExtension {
  readonly id: string;
  readonly family: string;
  readonly manifest: ExtensionPackManifest;
  readonly verifySchema?: (...args) => Promise<ExtensionSchemaIssue[]>;
  readonly typeMetadata?: ReadonlyArray<SqlTypeMetadata>;
}
```

- The SQL family’s `createSqlTypeMetadataRegistry` helper should:
  - Use adapter codecs (via a `CodecRegistry`) as a primary source of metadata.
  - Merge in extension `typeMetadata` entries (control-plane specific).

This way:

- Extensions can declare additional types (e.g., vector types) directly in the control plane.
- We don’t need to instantiate runtime extensions just to surface metadata in the control plane.

## Summary

This design:

- Separates **execution-plane codec behavior** from **control-plane type metadata**.
- Removes control-plane types from `@prisma-next/sql-contract`.
- Gives both planes a clear, minimal abstraction for “what DB types exist and how do they map to contract types?”.
- Makes the SQL family responsible for constructing type metadata from adapter and extension inputs, keeping the framework CLI target-agnostic and layered.

Implementation details and task breakdown are described in the companion brief at `docs/briefs/12-Sql-Type-Metadata-Control-Plane.md`.

