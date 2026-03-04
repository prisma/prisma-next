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
- **Component Database Dependencies**: Consumes database dependencies declared by framework components (target/adapter/extension packs). Callers pass the active `frameworkComponents` list into planning/execution/verification; SQL layers structurally narrow to components that declare `databaseDependencies` and use their pure verification hooks (no fuzzy matching against `contract.extensionPacks`).
- **Contract-to-SchemaIR Conversion**: Converts `SqlStorage` from a contract into `SqlSchemaIR` for offline migration planning, enabling `migration plan` to work without a database connection
- **Destructive Change Detection**: Compares two `SqlStorage` values and identifies destructive changes (dropped tables/columns) for migration policy enforcement
- **Storage Type Control Hooks**: Extracts codec-owned control hooks for planning/verification/introspection of `storage.types` without adding enum-specific fields to shared IR
- **Codec Ownership**: Enforces a single owner per `codecId` for parameterized renderers and control-plane hooks to prevent ambiguous conflicts during assembly
- **Parameterized Type Verification**: Expands contract `typeParams` into expected native type strings during schema verification and flags missing parameters as type mismatches
- **Schema Defaults Policy**: Ignores execution mutation defaults during schema verification since they are applied before DB writes
- **Foreign Key Config Awareness**: Schema verification respects the contract's `foreignKeys` configuration — when `foreignKeys.constraints` is `false`, FK constraint checks are skipped during verification (see [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md))
- **Referential Action Verification**: When a contract FK specifies `onDelete` or `onUpdate`, the verifier compares them against the introspected schema and reports `foreign_key_mismatch` on mismatch (see [ADR 166](../../../docs/architecture%20docs/adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md))

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
const planner = postgresTargetDescriptor.migrations.createPlanner(familyInstance);
// frameworkComponents should include the active target, adapter, and any extension descriptors so
// planner/runner can resolve database dependencies declared by those components.
const planResult = planner.plan({
  contract: sqlContract,
  schema,
  policy,
  frameworkComponents: [postgresTargetDescriptor, postgresAdapterDescriptor, pgVectorExtensionDescriptor],
});

// Targets also provide runners for executing plans
const runner = postgresTargetDescriptor.migrations.createRunner(familyInstance);
const executeResult = await runner.execute({
  plan: planResult.plan,
  driver,
  destinationContract: sqlContract,
  frameworkComponents: [postgresTargetDescriptor, postgresAdapterDescriptor, pgVectorExtensionDescriptor],
});

// executeResult is a Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>
if (executeResult.ok) {
  console.log(`Executed ${executeResult.value.operationsExecuted} operations`);
} else {
  console.error(`Migration failed: ${executeResult.failure.code} - ${executeResult.failure.summary}`);
}
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
- **`verify()`**: Verifies database marker against contract (compares target, storageHash, profileHash)
- **`schemaVerify()`**: Verifies database schema against contract (compares contract requirements vs live schema)
- **`introspect()`**: Introspects database schema and returns `SqlSchemaIR`
- **`toSchemaView(schema)`**: Projects `SqlSchemaIR` into `CoreSchemaView` for human-readable display. Always displays native database types (e.g., `int4`, `text`) rather than mapped codec IDs (e.g., `pg/int4@1`) to reflect actual database state.
- **`emitContract({ contractIR })`**: Emits contract JSON and DTS as strings. Handles stripping mappings and validation internally. Uses preassembled state (operation registry, type imports, extension IDs).

The descriptor is "pure data + factory" - it only provides the hook and factory method. All family-specific logic lives on the instance.

## Package Structure

- **`src/core/control-descriptor.ts`**: `SqlFamilyDescriptor` class implementing `ControlFamilyDescriptor` interface (pure data + factory)
- **`src/core/control-instance.ts`**: `createSqlFamilyInstance` function that creates `SqlFamilyInstance` with domain action methods (`validateContractIR`, `verify`, `schemaVerify`, `introspect`, `toSchemaView`, `emitContract`). Contains `convertOperationManifest` function used internally by instance creation and test utilities in the same package.
- **`src/core/assembly.ts`**: Assembly helpers for building operation registries, extracting type imports, and collecting codec-owned storage type control hooks. Test utilities import `convertOperationManifest` from the same package via relative path.
- **`src/core/verify.ts`**: Verification helpers (`readMarker`, `collectSupportedCodecTypeIds`)
- **`src/core/control-adapter.ts`**: SQL control adapter interface (`SqlControlAdapter`) for control-plane operations
- **`src/core/migrations/`**: Migration IR helpers plus planner and runner SPI types (`MigrationPlanner`, `MigrationRunner`, `SqlControlTargetDescriptor`). Runners return `MigrationRunnerResult` which is a union of success/failure.
- **`src/core/migrations/contract-to-schema-ir.ts`**: `contractToSchemaIR(storage)` converts a contract's `SqlStorage` to `SqlSchemaIR` for offline migration planning (used by `migration plan` to synthesize the "from" schema without a database connection). Also exports `detectDestructiveChanges(from, to)` which compares two `SqlStorage` values and returns a list of destructive changes (dropped tables, dropped columns) for migration policy enforcement.

### Migration Runner Error Codes

The runner returns structured errors with the following codes:

- **`DESTINATION_CONTRACT_MISMATCH`**: Plan destination hash doesn't match provided contract hash
- **`MARKER_ORIGIN_MISMATCH`**: Existing marker doesn't match plan's expected origin
- **`POLICY_VIOLATION`**: Operation class is not allowed by the plan's policy
- **`PRECHECK_FAILED`**: Operation precheck returned false
- **`POSTCHECK_FAILED`**: Operation postcheck returned false after execution
- **`SCHEMA_VERIFY_FAILED`**: Resulting schema doesn't satisfy the destination contract
- **`EXECUTION_FAILED`**: SQL execution error during operation execution
- **`src/exports/control.ts`**: Control plane entry point (exports `SqlFamilyDescriptor` instance)
- **`src/exports/runtime.ts`**: Runtime plane entry point

## Entrypoints

- **`./control`**: Control plane entry point for CLI/config usage (exports `SqlFamilyDescriptor`)
- **`./control-adapter`**: SQL control adapter interface (`SqlControlAdapter`, `SqlControlAdapterDescriptor`) for target-specific adapters
- **`./runtime`**: Runtime plane identity exports only (family ID, types, descriptor identity). Does **not** export runtime creation helpers—use `createExecutionStack`, `instantiateExecutionStack` from `@prisma-next/core-execution-plane/stack` and `createExecutionContext`, `createRuntime` from `@prisma-next/sql-runtime`. See [ADR 152](../../../docs/architecture%20docs/adrs/ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md).
- **`./verify`**: Verification utilities (`readMarker`, `readMarkerSql`, `parseContractMarkerRow`) for reading contract markers from databases

## Dependencies

- **`@prisma-next/core-control-plane`**: Control plane types (`ControlFamilyDescriptor`, `ControlTargetDescriptor`, `ControlAdapterDescriptor`, `ControlDriverDescriptor`, `ControlExtensionDescriptor`, `ControlDriverInstance`, etc.)
- **`@prisma-next/sql-contract-emitter`**: SQL target family hook (`sqlTargetFamilyHook`)
- **`@prisma-next/sql-contract-ts`**: Contract validation (`validateContract`)
- **`@prisma-next/sql-contract`**: SQL contract types (`SqlContract`, `SqlStorage`)
- **`@prisma-next/sql-operations`**: SQL operation signature types (`SqlOperationSignature`)

**Dependents:**
- CLI configuration files import this package to register the SQL family

## How to debug `db init`

- **CLI orchestration**: `packages/1-framework/3-tooling/cli/src/commands/db-init.ts`
- **Planner/runner SPI types**: `packages/2-sql/3-tooling/family/src/core/migrations/types.ts`
- **Pure schema verifier (used by planner + runner)**: `@prisma-next/family-sql/schema-verify` (source: `packages/2-sql/3-tooling/family/src/core/schema-verify/`)
- **Postgres implementation**:
  - Planner: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
  - Runner: `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`
- **Tests**:
  - CLI integration: `test/integration/test/cli.db-init.e2e.test.ts`
  - Target unit/integration: `packages/3-targets/3-targets/postgres/test/migrations/*`

