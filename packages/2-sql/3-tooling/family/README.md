# @prisma-next/family-sql

SQL family descriptor for Prisma Next.

## Purpose

Provides the SQL family descriptor (`ControlFamilyDescriptor`) that includes:
- The SQL target family hook (`sqlTargetFamilyHook`)
- Factory method (`create()`) to create family instances

## Responsibilities

- **Family Descriptor Export**: Exports the SQL `ControlFamilyDescriptor` for use in CLI configuration files
- **Family Instance Creation**: Creates `SqlFamilyInstance` objects that implement control-plane domain actions (`verify`, `schemaVerify`, `introspect`, `emitContract`, `validateContractIR`)
- **Planner & Runner SPI**: Owns the `MigrationPlanner` / `MigrationRunner` interfaces plus the `SqlControlTargetDescriptor` helper so targets can expose planners and runners (e.g., Postgres init planner/runner)
- **Family Hook Integration**: Integrates the SQL target family hook (`sqlTargetFamilyHook`) from `@prisma-next/sql-contract-emitter`
- **Control Plane Entry Point**: Serves as the control plane entry point for the SQL family, enabling the CLI to select the family hook and create family instances

## Usage

```typescript
import sql from '@prisma-next/family-sql/control';

// sql is a ControlFamilyDescriptor with:
// - kind: 'family'
// - id: 'sql'
// - familyId: 'sql'
// - hook: TargetFamilyHook
// - create: (options) => SqlFamilyInstance

// Create a family instance for control-plane operations
const familyInstance = sql.create({
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor, // Required
  extensions: [pgVectorExtensionDescriptor],
});

// Use instance methods for domain actions
const contractIR = familyInstance.validateContractIR(contractJson);
const verifyResult = await familyInstance.verify({ driver, contractIR, ... });
const emitResult = await familyInstance.emitContract({ contractIR: rawContract }); // Handles stripping mappings and validation internally

// Targets that implement SqlControlTargetDescriptor can build planners
const planner = postgresTargetDescriptor.createPlanner(familyInstance);
const planResult = planner.plan({ contract: sqlContract, schema, policy });

// Targets also provide runners for executing plans
const runner = postgresTargetDescriptor.createRunner(familyInstance);
const executeResult = await runner.execute({ plan: planResult.plan, driver, contract: sqlContract });
```

## Architecture

This package is the control plane entry point for the SQL family. It composes:
- `@prisma-next/sql-contract-emitter` - Provides the SQL family hook
- `@prisma-next/sql-operations` - SQL operation signature types
- `@prisma-next/sql-contract-ts` - Contract validation

The framework CLI uses this descriptor to:
1. Create family instances for control-plane operations (via `create()`)

Family instances implement domain actions:
- **`validateContractIR(contractJson)`**: Validates and normalizes contract, returns ContractIR without mappings
- **`verify()`**: Verifies database marker against contract (compares target, coreHash, profileHash)
- **`schemaVerify()`**: Verifies database schema against contract (compares contract requirements vs live schema)
- **`introspect()`**: Introspects database schema and returns `SqlSchemaIR`
- **`toSchemaView(schema)`**: Projects `SqlSchemaIR` into `CoreSchemaView` for human-readable display. Always displays native database types (e.g., `int4`, `text`) rather than mapped codec IDs (e.g., `pg/int4@1`) to reflect actual database state.
- **`emitContract({ contractIR })`**: Emits contract JSON and DTS as strings. Handles stripping mappings and validation internally. Uses preassembled state (operation registry, type imports, extension IDs).

The descriptor is "pure data + factory" - it only provides the hook and factory method. All family-specific logic lives on the instance.

## Package Structure

- **`src/core/descriptor.ts`**: `SqlFamilyDescriptor` class implementing `ControlFamilyDescriptor` interface (pure data + factory)
- **`src/core/instance.ts`**: `createSqlFamilyInstance` function that creates `SqlFamilyInstance` with domain action methods (`validateContractIR`, `verify`, `schemaVerify`, `introspect`, `toSchemaView`, `emitContract`). Contains `convertOperationManifest` function used internally by instance creation and test utilities in the same package.
- **`src/core/assembly.ts`**: Assembly helpers for building operation registries and extracting type imports from descriptors. Test utilities import `convertOperationManifest` from the same package via relative path.
- **`src/core/verify.ts`**: Verification helpers (`readMarker`, `collectSupportedCodecTypeIds`)
- **`src/core/control-adapter.ts`**: SQL control adapter interface (`SqlControlAdapter`) for control-plane operations
- **`src/core/migrations/`**: Migration IR helpers plus planner and runner SPI types (`MigrationPlanner`, `MigrationRunner`, `SqlControlTargetDescriptor`)
- **`src/exports/control.ts`**: Control plane entry point (exports `SqlFamilyDescriptor` instance)
- **`src/exports/runtime.ts`**: Runtime entry point (placeholder for future functionality)

## Entrypoints

- **`./control`**: Control plane entry point for CLI/config usage (exports `SqlFamilyDescriptor`)
- **`./control-adapter`**: SQL control adapter interface (`SqlControlAdapter`, `SqlControlAdapterDescriptor`) for target-specific adapters
- **`./runtime`**: Runtime entry point (placeholder for future functionality)
- **`./verify`**: Verification utilities (`readMarker`, `readMarkerSql`, `parseContractMarkerRow`) for reading contract markers from databases

## Dependencies

- **`@prisma-next/core-control-plane`**: Control plane types (`ControlFamilyDescriptor`, `ControlTargetDescriptor`, `ControlAdapterDescriptor`, `ControlDriverDescriptor`, `ControlExtensionDescriptor`, `ControlDriverInstance`, etc.)
- **`@prisma-next/sql-contract-emitter`**: SQL target family hook (`sqlTargetFamilyHook`)
- **`@prisma-next/sql-contract-ts`**: Contract validation (`validateContract`)
- **`@prisma-next/sql-contract`**: SQL contract types (`SqlContract`, `SqlStorage`)
- **`@prisma-next/sql-operations`**: SQL operation signature types (`SqlOperationSignature`)

**Dependents:**
- CLI configuration files import this package to register the SQL family

