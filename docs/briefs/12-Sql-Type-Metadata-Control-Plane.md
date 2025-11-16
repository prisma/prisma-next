# Brief: SQL Type Metadata for Control Plane & Execution Plane

## Problem

The same codec registry abstraction is used for both runtime encoding/decoding and control-plane type metadata:

- Execution plane (`CodecRegistry` in `sql-relational-core`):
  - Correctly used to encode/decode values, choose codecs, etc.
- Control plane (`SqlCodecRegistry` and `SqlFamilyContext` in `sql-contract` + CLI):
  - Used only for metadata: mapping DB native types to contract type IDs during schema introspection.
  - Forces control-plane context types into `sql-contract` and makes the CLI import runtime codec machinery.

We need a separate **SQL type metadata** abstraction for the control plane (and for runtime when it only needs metadata), and we want the SQL family to provide helpers to build it from adapter + extensions.

## Goals

- Introduce `SqlTypeMetadata` / `SqlTypeMetadataRegistry` for type availability and mapping.
- Make SQL family introspection depend on metadata, not codecs.
- Let the SQL family expose a helper that builds a type metadata registry from:
  - Adapter codecs.
  - Control-plane extension metadata (per the control-plane extensions design).
- Remove control-plane codec types from `@prisma-next/sql-contract`.
- Stop the framework CLI from importing execution-plane codec registry implementations directly.

## Out of Scope

- Changing runtime codec behavior or registry structure.
- New type-level capabilities beyond what’s needed for DB native type → typeId mapping and coverage checks.

## Implementation Plan

### 1. Define SqlTypeMetadata and SqlTypeMetadataRegistry

- Add types in a SQL-control-plane-friendly package (e.g., `packages/sql/family/src/types.ts` or a small `sql-type-metadata` module):

```ts
export interface SqlTypeMetadata {
  readonly typeId: string;
  readonly targetTypes: readonly string[];
  readonly nativeType?: string;
}

export interface SqlTypeMetadataRegistry {
  values(): IterableIterator<SqlTypeMetadata>;
}
```

- Provide a simple concrete implementation (e.g., backed by an array or map) with just `values()` and internal construction helpers; keep the surface minimal.

### 2. Add a helper to build metadata from adapter + extensions

- In the SQL family (or a closely related module), add:

```ts
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlTypeMetadata, SqlTypeMetadataRegistry } from './types';
import type { ExtensionDescriptor } from '@prisma-next/core-control-plane/types';

export interface SqlTypeMetadataSource {
  readonly codecRegistry?: CodecRegistry;
  readonly typeMetadata?: ReadonlyArray<SqlTypeMetadata>;
}

export function createSqlTypeMetadataRegistry(
  sources: ReadonlyArray<SqlTypeMetadataSource>,
): SqlTypeMetadataRegistry;
```

- Implementation:
  - From `codecRegistry`:
    - Iterate `codecRegistry.values()`.
    - For each codec, project to `SqlTypeMetadata` using `codec.id`, `codec.targetTypes`, and `codec.meta?.db?.sql?.postgres?.nativeType`.
  - From `typeMetadata`: include as-is.
  - Deduplicate by `typeId`, with adapter entries winning over extensions and later entries.

- Control-plane use:
  - Adapter contributes via its runtime codecs (through a `CodecRegistry` obtained from `adapter.profile.codecs()`).
  - Control-plane extensions contribute via a `typeMetadata` field wired from their control-plane entrypoints.

### 3. Refactor Postgres introspection to use type metadata

- Change `introspectPostgresSchema` in `packages/targets/postgres-adapter/src/exports/introspect.ts`:
  - Signature from `(driver, codecRegistry, contract?, schema?)` to `(driver, types: SqlTypeMetadataRegistry, contract?, schema?)`.
  - Update `mapDatabaseTypeToCodec` to `mapDatabaseTypeToTypeMetadata(databaseType, types)`:
    - Iterate `types.values()`.
    - Use `SqlTypeMetadata.nativeType` for DB type matching and `typeId` for the returned type ID.

- Ensure `SqlSchemaIR` still stores `typeId` and `nativeType` as before; only the source of type mapping changes.

### 4. Update SQL family verify SPI and context

- Move `SqlFamilyContext` out of `sql-contract` into a SQL family-local module (e.g., `packages/sql/family/src/context.ts`):

```ts
import type { TargetFamilyContext } from '@prisma-next/control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { SqlTypeMetadataRegistry } from './types';

export type SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & {
  readonly types: SqlTypeMetadataRegistry;
};
```

- Update `introspectSchema` in `packages/sql/family/src/verify.ts`:
  - Accept `contextInput: Omit<SqlFamilyContext, 'schemaIR'>`.
  - Extract `types` from `contextInput` instead of `codecRegistry`.
  - Call `introspectPostgresSchema(driver, types, contractIR)`.

- Remove `SqlCodecRegistry` and control-plane codec interfaces from `packages/sql/contract/src/types.ts`.

### 5. Wire type metadata into db-schema-verify CLI

- In `packages/framework/tooling/cli/src/commands/db-schema-verify.ts`:
  - Stop importing `createCodecRegistry` from `@prisma-next/sql-relational-core/ast`.
  - Instead:
    - Hydrate the adapter instance as today (from `config.adapter.adapter` or `adapter.create()`).
    - Obtain a runtime `CodecRegistry` from `adapterInstance.profile.codecs()`.
    - Build a `SqlTypeMetadataRegistry` by calling the SQL family helper:

      ```ts
      const codecRegistry = adapterInstance.profile.codecs();
      const extensionTypeMetadata = (config.extensions ?? []).flatMap(
        (ext) => ext.typeMetadata ?? [],
      );
      const types = createSqlTypeMetadataRegistry([
        { codecRegistry },
        { typeMetadata: extensionTypeMetadata },
      ]);
      ```

    - Pass `{ types }` as part of `contextInput` into `verifyDatabaseSchema<SqlFamilyContext>`.

- This ensures the CLI:
  - Still constructs type metadata from real runtime codec definitions.
  - Also incorporates control-plane extension metadata when available.
  - Avoids manipulating `SqlCodecRegistry` directly.

### 6. Clean up sql-contract

- In `packages/sql/contract/src/types.ts`:
  - Remove the control-plane `Codec` and `SqlCodecRegistry` interfaces.
  - Remove `SqlFamilyContext` and any imports of `TargetFamilyContext`.
  - Keep only contract-related types (storage, models, mappings, etc.).

- Ensure no remaining control-plane or execution-plane dependencies leak into `sql-contract`.

### 7. Tests & Validation

- Update SQL family tests:
  - Add focused tests for `createSqlTypeMetadataRegistry` (adapter-only, extension-only, merged sources).
  - Update `verify-schema.test.ts` to build a `SqlTypeMetadataRegistry` and pass it through the new path.
- Update Postgres adapter introspection tests to assert:
  - DB types are correctly mapped to `typeId` and `nativeType` via the metadata registry.
- Update CLI tests for `db schema-verify`:
  - Ensure the command still works end-to-end and JSON output is unchanged.
  - Confirm no direct dependency on `SqlCodecRegistry` survives.

## Acceptance Criteria

- `SqlTypeMetadata` and `SqlTypeMetadataRegistry` are defined and used by:
  - Postgres introspection.
  - SQL family `introspectSchema`.
  - `db schema-verify` control-plane path.
- `SqlCodecRegistry` and control-plane `Codec` interfaces are removed from `@prisma-next/sql-contract`.
- `SqlFamilyContext` lives in a SQL family module, not in `sql-contract`.
- Framework CLI no longer assembles a `SqlCodecRegistry` or imports `createCodecRegistry` directly for schema verification; it uses the SQL family helper to create a `SqlTypeMetadataRegistry` from:
  - Adapter codecs.
  - Control-plane extension metadata (`typeMetadata`) when available.
- All existing `db schema-verify` behavior (JSON envelope, TTY output, exit codes) remains the same from the user’s perspective.

