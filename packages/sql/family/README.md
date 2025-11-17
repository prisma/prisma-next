# @prisma-next/family-sql

SQL family descriptor for control plane and runtime.

## Purpose

Provides the SQL family descriptors (`FamilyDescriptor`) for both control plane and runtime:
- **Control plane**: schema verification, marker reading, type metadata, and contract validation.
- **Runtime** (future): lowering and runtime family integration.

## Structure

This package uses a multi-plane structure with separate entrypoints:

- **`./control`** – Control plane entrypoint
  - Exports control-plane `FamilyDescriptor<SqlFamilyContext>` for use in CLI configuration files.
  - Provides family hook, operation conversion, contract validation, and schema verification hooks.
  - Used by the framework CLI and core control-plane domain actions.

- **`./runtime`** – Execution plane entrypoint
  - Placeholder for future runtime family hooks.
  - Will be implemented when runtime family integration is needed.

## Responsibilities

- **Family Descriptor Export (Control Plane)**:
  - Exports the SQL control-plane `FamilyDescriptor<SqlFamilyContext>` for use in `prisma-next.config.*`.
  - Integrates the SQL target family hook (`sqlTargetFamilyHook`) from `@prisma-next/sql-contract-emitter`.
  - Provides `convertOperationManifest` to convert `OperationManifest` to `SqlOperationSignature` (adds lowering spec).
  - Provides `validateContractIR` and `stripMappings` to validate and normalize contracts.
  - Implements control-plane hooks for DB-connected commands:
    - `readMarker` – read contract marker rows.
    - `prepareControlContext` – build SQL control-plane context from descriptors.
    - `introspectSchema` – introspect database schema and produce `SqlSchemaIR`.
    - `verifySchema` – compare contract IR against schema IR and return `SchemaIssue[]`.

## Usage

### Control Plane (CLI)

```typescript
import sql from '@prisma-next/family-sql/control';

// sql is a control-plane FamilyDescriptor<SqlFamilyContext> with:
// - kind: 'family'
// - id: 'sql'
// - hook: TargetFamilyHook
// - convertOperationManifest: (manifest) => OperationSignature
// - validateContractIR: (contractJson) => ContractIR (without mappings)
// - stripMappings?: (contract) => contract (removes mappings)
// - readMarker?: (driver) => Promise<ContractMarkerRecord | null>
// - prepareControlContext?: ({ contractIR, target, adapter, extensions }) => Promise<SqlFamilyContext>
// - introspectSchema?: ({ driver, contextInput, contractIR, target, adapter, extensions }) => Promise<SqlSchemaIR>
// - verifySchema?: ({ contractIR, schemaIR, target, adapter, extensions }) => Promise<{ issues: SchemaIssue[] }>
```

### Runtime (Future)

```typescript
// Placeholder for future runtime family hooks
import sqlRuntime from '@prisma-next/family-sql/runtime';
```

## Architecture

This package is structured as a multi-plane package:

- **`src/exports/control.ts`**: Control plane entrypoint
  - Exports the SQL control-plane family descriptor.
  - Binds together schema verification hooks, SQL family context, and type metadata helpers.
- **`src/exports/runtime.ts`**: Execution plane entrypoint (placeholder for future runtime family hooks).
- **`src/context.ts`**: Defines `SqlFamilyContext` (control-plane context).
- **`src/type-metadata.ts`** & `src/types.ts`: Define SQL type metadata (`SqlTypeMetadata`, `SqlTypeMetadataRegistry`) and helpers (e.g., `createSqlTypeMetadataRegistry`).
- **`src/verify.ts`**: Shared verification logic used by the control-plane family descriptor (`readMarker`, `introspectSchema`, `verifySchema`).

The package follows the multi-plane entrypoint pattern established by adapter packages like `@prisma-next/adapter-postgres`, allowing it to serve both control and runtime planes while maintaining strict plane boundaries.

## Dependencies

- **`@prisma-next/core-control-plane`**: Control plane descriptor types (`FamilyDescriptor`, `TargetFamilyContext`, `SchemaIssue`, etc.)
- **`@prisma-next/sql-contract-emitter`**: SQL target family hook (`sqlTargetFamilyHook`)
- **`@prisma-next/sql-contract-ts`**: Contract validation (`validateContract`)
- **`@prisma-next/sql-contract`**: SQL contract types (`SqlContract`, `SqlStorage`)
- **`@prisma-next/sql-operations`**: SQL operation signature types (`SqlOperationSignature`)
- **`@prisma-next/sql-schema-ir`**: SQL schema IR types (`SqlSchemaIR`)

**Dependents:**
- CLI configuration files import this package to register the SQL family
