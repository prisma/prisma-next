### Title

Split Introspection & Verification and Simplify SQL Family SPI

### Overview

The current SQL family / schema-verify design has inverted layering and over-coupled responsibilities:

- The **SQL family**:
  - Assembles codec registries itself (importing `pack-assembly`).
  - Calls domain actions (e.g. `verifyDatabaseSchema`) from inside the family descriptor.
- The **FamilyDescriptor SPI**:
  - Nests all DB-related hooks under `verify` (`verify.readMarker`, `verify.introspectSchema`, `verify.verifySchema`).
  - Makes `verifySchema` a monolithic hook that does both introspection and verification.
- The **domain / CLI**:
  - `core-control-plane`’s `verifyDatabaseSchema` both introspects and verifies.
  - The CLI API `verify-database-schema.ts` delegates to the family’s `verifySchema` hook instead of clearly orchestrating domain actions.

This brief defines a cleaner architecture:

- The **SQL family** is a “dumb” provider of low-level operations (read marker, introspect schema, verify contract vs schema), and never assembles registries or calls domain actions.
- The **domain layer** exposes two actions:
  - `introspectDatabaseSchema` (introspection only, returns `SchemaIR`).
  - `verifySchemaAgainstContract` (verification only, accepts contract IR + schema IR).
- The **CLI** (`db schema-verify`) orchestrates:
  1. Load config, driver, contract IR, assemble registries.
  2. Call `introspectDatabaseSchema`.
  3. Call `verifySchemaAgainstContract`.
  4. Format results.

### Goals

- **Clean layering**:
  - Domain actions call family hooks; families never call domain actions.
  - Registry assembly lives in CLI/domain, not inside families.
- **Single SQL family descriptor**:
  - One `FamilyDescriptor<SqlSchemaIR>` instance (in `@prisma-next/family-sql`) that:
    - Implements emitter `TargetFamilyHook`.
    - Exposes introspection/verification hooks used by domain actions.
- **Separation of concerns**:
  - Introspection action: builds `SqlSchemaIR` from DB.
  - Verification action: compares contract IR vs schema IR and returns issues.
- **Easier implementation and test story**:
  - Domain actions are small and testable independently.
  - SQL family tests focus on schema IR shape and compatibility rules, not registry assembly or domain orchestration.

### Non-Goals

- Changing the emitted contract structure (`SqlContract`, `SqlStorage`, `SqlSchemaIR`) beyond what’s necessary for type compatibility.
- Changing CLI UX or flags for `db schema-verify` (output shape and behavior should remain compatible).
- Removing `FamilyDescriptor.verify` entirely; we’ll refactor its contents but keep existing fields as much as possible.

---

## Current State (Problems)

### 1. Family assembles registries

**File: `packages/sql/family/src/verify.ts`**

- `introspectSchema` currently does:

```ts
import { assembleCodecRegistry } from '@prisma-next/cli/pack-assembly';

export async function introspectSchema(options: {
  readonly driver: ControlPlaneDriver;
  readonly contractIR?: unknown;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
}): Promise<SqlSchemaIR> {
  const { driver, contractIR, adapter, extensions } = options;

  // Assemble codec registry from adapter + extensions
  const codecRegistry = await assembleCodecRegistry(adapter, extensions);

  // Delegate to Postgres adapter ...
  return introspectPostgresSchema(driver, codecRegistry, contractIR);
}
```

This pulls CLI concerns (pack assembly, codec registry construction) down into the SQL family, violating layering and making testing harder.

### 2. Everything nested under `verify`

**File: `packages/framework/core-control-plane/src/types.ts`**

Relevant snippet:

```ts
export interface FamilyDescriptor<TSchemaIR = unknown> {
  readonly kind: 'family';
  readonly id: string;
  readonly hook: TargetFamilyHook;
  readonly verify?: {
    readMarker: (driver: ControlPlaneDriver) => Promise<ContractMarkerRecord | null>;
    collectSupportedCodecTypeIds?: (...): readonly string[];
    introspectSchema?: (options: { ... }) => Promise<TSchemaIR>;
    verifySchema?: (options: { ... }) => Promise<VerifyDatabaseSchemaResult>;
  };
  readonly convertOperationManifest: (manifest: OperationManifest) => OperationSignature;
  readonly validateContractIR: (contractJson: unknown) => unknown;
  readonly stripMappings?: (contract: unknown) => unknown;
}
```

- `readMarker`, `introspectSchema`, and `verifySchema` are all nested under `.verify`, making concrete implementations clumsy and forcing tests to jump through `family.verify!.verifySchema!`.
- `verifySchema` is defined as a large one-shot hook that returns the full result shape the CLI expects; this blends domain concerns into the family.

### 3. Family calling domain actions

**File: `packages/sql/family/src/exports/control.ts`** (previous state; we just removed `verifySchema` but this was the shape):

```ts
readonly verify = {
  readMarker,
  collectSupportedCodecTypeIds,
  introspectSchema,
  verifySchema: async (options) => {
    return verifyDatabaseSchema({
      driver: options.driver,
      contractIR: options.contractIR,
      family: this,
      target: options.target,
      adapter: options.adapter,
      extensions: options.extensions,
      strict: options.strict,
      startTime: options.startTime,
      contractPath: options.contractPath,
      ...(options.configPath ? { configPath: options.configPath } : {}),
    });
  },
};
```

This inverts the intended dependency: the family should not know about `@prisma-next/core-control-plane/verify-database-schema`.

### 4. Domain action conflates introspection and verification

**File: `packages/framework/core-control-plane/src/actions/verify-database-schema.ts`**

- `verifyDatabaseSchema`:
  - Validates contract structure (coreHash, target).
  - Checks for `family.verify?.introspectSchema`.
  - Calls `family.verify.introspectSchema(...)` to get `schemaIR`.
  - Compares contract IR vs schema IR and builds `SchemaIssue[]`.
  - Returns a full `VerifyDatabaseSchemaResult`.

**File: `packages/framework/tooling/cli/src/api/verify-database-schema.ts`**

- CLI API:
  - Loads config, driver, reads contract JSON.
  - Validates via `config.family.validateContractIR`.
  - Used to call `config.family.verify.verifySchema` and reinterpret the result.
  - We recently rewired it to call the domain `verifyDatabaseSchema` directly, but the underlying action is still a monolith.

This coupling makes it hard to:

- Reuse introspection independently (e.g., for a future `db schema-dump`).
- Unit test verification logic independently of DB access.

---

## Proposed Design

### 1. Refine FamilyDescriptor SPI

We’ll adjust the family SPI to:

- Keep `verify` for backward compatibility, but stop putting orchestration in it.
- Make family hooks low-level, pure from a domain perspective.

**Target shape (conceptual):**

```ts
export interface FamilyDescriptor<TSchemaIR = unknown> {
  readonly kind: 'family';
  readonly id: string;
  readonly hook: TargetFamilyHook;

  // DB marker reading (for db verify)
  readonly verify?: {
    readMarker: (driver: ControlPlaneDriver) => Promise<ContractMarkerRecord | null>;

    /** Optional: coverage metadata, unchanged */
    collectSupportedCodecTypeIds?: (
      descriptors: ReadonlyArray<TargetDescriptor | AdapterDescriptor | ExtensionDescriptor>,
    ) => readonly string[];

    /** Low-level introspection: no registry assembly, no domain actions */
    introspectSchema?: (options: {
      readonly driver: ControlPlaneDriver;
      readonly target: TargetDescriptor;
      readonly adapter: AdapterDescriptor;
      readonly extensions: ReadonlyArray<ExtensionDescriptor>;
      readonly codecRegistry: import('@prisma-next/sql-relational-core/ast').CodecRegistry;
      readonly contractIR?: unknown;
    }) => Promise<TSchemaIR>;

    /** Optional low-level verification helper: contract + schema IR -> issues */
    verifySchema?: (options: {
      readonly contractIR: unknown;
      readonly schemaIR: TSchemaIR;
      readonly target: TargetDescriptor;
      readonly adapter: AdapterDescriptor;
      readonly extensions: ReadonlyArray<ExtensionDescriptor>;
    }) => Promise<{ readonly issues: readonly SchemaIssue[] }>;
  };

  readonly convertOperationManifest: (manifest: OperationManifest) => OperationSignature;
  readonly validateContractIR: (contractJson: unknown) => unknown;
  readonly stripMappings?: (contract: unknown) => unknown;
}
```

Key changes:

- `introspectSchema` takes a **ready-made `codecRegistry`**, not adapter/extension descriptors only.
- The family’s `verifySchema` hook becomes an optional helper for computing issues from `(contractIR, schemaIR, descriptors)`, not a full CLI result.
- We stop requiring families to return `VerifyDatabaseSchemaResult`; that is domain/CLI’s job.

### 2. Introduce explicit domain actions

We split responsibilities into two domain actions in `@prisma-next/core-control-plane`:

#### 2.1 `introspectDatabaseSchema`

**New file**: `packages/framework/core-control-plane/src/actions/introspect-database-schema.ts`

```ts
export interface IntrospectDatabaseSchemaOptions<TSchemaIR = unknown> {
  readonly driver: ControlPlaneDriver;
  readonly family: FamilyDescriptor<TSchemaIR>;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  readonly codecRegistry: CodecRegistry;
}

export interface IntrospectDatabaseSchemaResult<TSchemaIR = unknown> {
  readonly schemaIR: TSchemaIR;
}

export async function introspectDatabaseSchema<TSchemaIR = unknown>(
  options: IntrospectDatabaseSchemaOptions<TSchemaIR>,
): Promise<IntrospectDatabaseSchemaResult<TSchemaIR>> {
  const { driver, family, target, adapter, extensions, codecRegistry } = options;

  if (!family.verify?.introspectSchema) {
    throw errorUnexpected('Family introspectSchema() is required', {
      why: 'Family verify.introspectSchema is required for schema verification',
    });
  }

  const schemaIR = await family.verify.introspectSchema({
    driver,
    target,
    adapter,
    extensions,
    codecRegistry,
  });

  return { schemaIR };
}
```

#### 2.2 `verifySchemaAgainstContract`

**New file**: `packages/framework/core-control-plane/src/actions/verify-schema-against-contract.ts`

We have two options; this design uses the domain action as the canonical comparator, while allowing family-specific logic:

```ts
export interface VerifySchemaOptions<TSchemaIR = unknown> {
  readonly contractIR: unknown;
  readonly schemaIR: TSchemaIR;
  readonly family: FamilyDescriptor<TSchemaIR>;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
}

export interface VerifySchemaResult {
  readonly issues: readonly SchemaIssue[];
}

/**
 * Compare contract vs schema IR.
 * If family.verify.verifySchema is provided, defer to it; otherwise use generic SQL comparison.
 */
export async function verifySchemaAgainstContract<TSchemaIR = unknown>(
  options: VerifySchemaOptions<TSchemaIR>,
): Promise<VerifySchemaResult> {
  const { contractIR, schemaIR, family, target, adapter, extensions } = options;

  if (family.verify?.verifySchema) {
    return family.verify.verifySchema({ contractIR, schemaIR, target, adapter, extensions });
  }

  // Fallback: call built-in comparison (existing logic from verifyDatabaseSchema)
  const issues: SchemaIssue[] = compareContractToSchema(contractIR, schemaIR);
  return { issues };
}
```

`compareContractToSchema` can be factored out of the existing `verifyDatabaseSchema` implementation so we don’t duplicate comparisons.

### 3. Make CLI `db schema-verify` orchestrate these actions

**File: `packages/framework/tooling/cli/src/api/verify-database-schema.ts`**

Refactor this API to:

1. Load config and contract (current behavior).
2. Resolve DB URL and create driver (current behavior).
3. Assemble codec registry via `assembleCodecRegistry(config.adapter, config.extensions ?? [])`.
4. Call `introspectDatabaseSchema` domain action.
5. Call `verifySchemaAgainstContract`.
6. Combine timing information and build the CLI result.

Sketch:

```ts
import { introspectDatabaseSchema } from '@prisma-next/core-control-plane/introspect-database-schema';
import { verifySchemaAgainstContract } from '@prisma-next/core-control-plane/verify-schema-against-contract';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { assembleCodecRegistry } from './pack-assembly';

export async function verifyDatabaseSchema(
  options: VerifyDatabaseSchemaOptions = {},
): Promise<VerifyDatabaseSchemaResult> {
  const startTime = Date.now();
  const config = await loadConfig(options.configPath);
  // ... dbUrl, driver, contractIR as today ...

  // Assemble registry once
  const codecRegistry = await assembleCodecRegistry(config.adapter, config.extensions ?? []);

  // 1) Introspect
  const { schemaIR } = await introspectDatabaseSchema<SqlSchemaIR>({
    driver,
    family: config.family as FamilyDescriptor<SqlSchemaIR>,
    target: config.target,
    adapter: config.adapter,
    extensions: config.extensions ?? [],
    codecRegistry,
  });

  // 2) Verify
  const { issues } = await verifySchemaAgainstContract<SqlSchemaIR>({
    contractIR,
    schemaIR,
    family: config.family as FamilyDescriptor<SqlSchemaIR>,
    target: config.target,
    adapter: config.adapter,
    extensions: config.extensions ?? [],
  });

  const ok = issues.length === 0;
  const code = ok ? undefined : 'PN-SCHEMA-0001';
  const summary = ok
    ? 'Database schema matches contract'
    : `Contract requirements not met: ${issues.length} issue${issues.length === 1 ? '' : 's'} found`;

  return {
    ok,
    ...(code ? { code } : {}),
    summary,
    contract: {
      coreHash: contractCoreHash,
      ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
    },
    target: {
      expected: config.target.id,
      actual: config.target.id,
    },
    schema: { issues },
    meta: {
      ...(configPath ? { configPath } : {}),
      contractPath: contractJsonPath,
      strict: options.strict ?? false,
    },
    timings: {
      total: Date.now() - startTime,
    },
  };
}
```

**CLI command** `db schema-verify` (`packages/framework/tooling/cli/src/commands/db-schema-verify.ts`) remains unchanged; it simply calls this API and formats results.

---

## Implementation Plan for an Agent

### Slice 1: Refine `FamilyDescriptor` SPI (types only)

- **File**: `packages/framework/core-control-plane/src/types.ts`
  - Adjust `FamilyDescriptor.verify` type:
    - Add `codecRegistry` parameter to `introspectSchema` options.
    - Change `verifySchema` to accept `contractIR` + `schemaIR` and return `{ issues: SchemaIssue[] }`.
  - Keep existing fields but mark old `verifySchema` shape as deprecated (if needed) to avoid breaking other families; SQL will adopt the new shape.

### Slice 2: SQL family changes

- **File**: `packages/sql/family/src/verify.ts`
  - Remove `assembleCodecRegistry` usage and import.
  - Change `introspectSchema` signature to accept a `codecRegistry` parameter and **not** construct it internally.
  - Ensure `introspectSchema`:
    - Calls `introspectPostgresSchema(driver, codecRegistry, contractIR)` as before.
    - Throws if `target.id !== 'postgres'` (as today).
  - Introduce a `verifySchema` implementation (or helper) that:
    - Accepts `{ contractIR, schemaIR, target, adapter, extensions }`.
    - Uses the comparison logic currently in `verifyDatabaseSchema` (mismatched tables, columns, type/nullability mismatches, etc.) but scoped to SQL.
    - Returns `{ issues: SchemaIssue[] }`.

- **File**: `packages/sql/family/src/exports/control.ts`
  - Wire `verify.introspectSchema` to `introspectSchema`.
  - Wire `verify.verifySchema` to the new low-level `verifySchema` (if we choose to implement it in family; otherwise domain will use its generic fallback).
  - Ensure no import of `@prisma-next/core-control-plane/verify-database-schema` or `assembleCodecRegistry` remains.

### Slice 3: Domain actions

- **New file**: `packages/framework/core-control-plane/src/actions/introspect-database-schema.ts`
  - Implement `IntrospectDatabaseSchemaOptions`, `IntrospectDatabaseSchemaResult`, and `introspectDatabaseSchema` as described.
  - Reuse `SchemaIssue` type from `actions/verify-database-schema.ts` (no new type needed).

- **New file**: `packages/framework/core-control-plane/src/actions/verify-schema-against-contract.ts`
  - Extract comparison logic from `verify-database-schema.ts` into `compareContractToSchema`.
  - Implement `VerifySchemaOptions`, `VerifySchemaResult`, and `verifySchemaAgainstContract`.
  - For SQL, consider reusing the existing comparison logic; for other families, treat `family.verify.verifySchema` as optional.

- **File**: `packages/framework/core-control-plane/dist/exports/types.d.ts` (generated)
  - Ensure `tsconfig` / build output stays aligned; no manual edits.

### Slice 4: CLI API rewrite

- **File**: `packages/framework/tooling/cli/src/api/verify-database-schema.ts`
  - Remove dependency on `config.family.verify.verifySchema`.
  - Import `introspectDatabaseSchema` and `verifySchemaAgainstContract`.
  - Assemble codec registry via existing `assembleCodecRegistry`.
  - Call the two domain actions in order and assemble the final `VerifyDatabaseSchemaResult` shape as described.

- **File**: `packages/framework/tooling/cli/src/utils/cli-errors.ts`
  - If `errorFamilySchemaVerifierRequired` is now unused, either:
    - Remove it, or
    - Clearly mark as deprecated in case other families still use the old pattern.

### Slice 5: Test updates

- **File**: `packages/sql/family/test/verify-schema.test.ts`
  - Ensure tests no longer call `sqlFamilyDescriptor.verify!.verifySchema!`.
  - Use the **domain** `verifyDatabaseSchema` action in tests where we want full orchestration, and `introspectSchema` / `verifySchema` hooks directly where we want to test family behavior in isolation.
  - Ensure contracts use fully qualified type IDs (`pg/int4@1`, `pg/text@1`), matching `SqlSchemaIR` introspection.

- **File**: `packages/framework/tooling/cli/test/api/verify-database-schema.test.ts`
  - Update tests that currently:
    - Expect `verifySchema` hook to be present.
    - Spy on `family.verify.verifySchema`.
  - Replace them with tests that:
    - Spy on `family.verify.introspectSchema` (for parameter coverage) and/or use **real** SQL family to exercise the domain actions.
    - Verify `verifyDatabaseSchema` API returns proper `VerifyDatabaseSchemaResult` for:
      - Matching schema.
      - Mismatches (missing table, type mismatch, etc.).
      - Missing `introspectSchema` hook (errorUnexpected).

### Slice 6: Docs

- **File**: `docs/DB-Schema-Verify-and-Sign-Design.md`
  - Update “Family SPI for Schema Verification” to:
    - Show the new `FamilyDescriptor` shape (introspection + verification as low-level hooks).
    - Explain the split into `introspectDatabaseSchema` and `verifySchemaAgainstContract`.
    - Clarify that `db schema-verify` CLI orchestrates the two domain actions, not the family.

- **File**: `docs/briefs/consolidate-sql-family.md`
  - Align the brief with this refined design to maintain consistency.

### Slice 7: Safety checks

- Run:
  - `pnpm --filter @prisma-next/family-sql typecheck && pnpm --filter @prisma-next/family-sql test`
  - `pnpm --filter @prisma-next/core-control-plane typecheck && pnpm --filter @prisma-next/core-control-plane test`
  - `pnpm --filter @prisma-next/cli typecheck && pnpm --filter @prisma-next/cli test`
  - `pnpm lint:deps` to ensure:
    - No SQL → framework-domain imports (e.g. family no longer imports domain actions or pack-assembly).
    - Domain actions only depend on family SPI, not the other way around.

If you hand this brief to another agent, they should be able to follow the slices in order and end up with:

- A “dumb” SQL family implementing low-level SPI only.
- Clear domain actions (`introspectDatabaseSchema`, `verifySchemaAgainstContract`) that orchestrate verification.
- A CLI `db schema-verify` command that simply wires config → domain actions → format result.
