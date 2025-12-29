# Branch 4 Plan — Schema IR & Verification Integration

## Goal (Branch 4)

Make **schema-vs-contract verification** reusable as a **pure (no DB I/O) primitive** so it can be used by:

- `db schema-verify` (existing command; stays as orchestrator + formatting)
- `MigrationRunner` (post-execution verification; consistent failure mapping)
- `MigrationPlanner` (future: classify **missing** vs **conflicting** without talking to the DB)

Branch 4 covers tasks **4.1**, **4.2**, **4.3** in `tasks.md`.

## Current State (What Exists Today)

### Verification entrypoint today

- SQL family instance (`packages/2-sql/3-tooling/family/src/core/instance.ts`) implements:
  - `schemaVerify({ driver, contractIR, strict, context })`
  - It **introspects live schema inside `schemaVerify()`** (`controlAdapter.introspect(driver, contractIR)`), then performs contract-vs-schema comparison and returns a `VerifyDatabaseSchemaResult` tree.

### Consumers today

- CLI `db schema-verify` and `db sign` call `familyInstance.schemaVerify(...)`.
- Postgres migration runner calls `family.schemaVerify(...)` after applying operations.

### Problem for Branch 4

Planner already has `(contract, schemaIR)` in `MigrationPlannerPlanOptions`, but there is **no exported pure verifier** it can call because verification is currently bundled with introspection in `schemaVerify()`.

## Design Principles / Constraints

- **No subprocess calls** (verification must be callable as TypeScript functions).
- **No target branches** in shared/core packages; target-specific logic stays in target packages.
- **Avoid defensive dead branches**: once `validateContract<SqlContract<SqlStorage>>()` has succeeded, prefer assertions over “shouldn’t happen” checks.
- **No new barrels**; only re-export through `src/exports/*` entrypoints.
- **TDD + small commits**: each logical change is preceded by failing tests and followed by a git commit.
- End state includes **real DB integration tests** using `createDevDatabase()` (some exist already for runner; Branch 4 adds/extends coverage for the new primitive).

## Schema IR realism check (avoid backfiring)

This branch assumes `SqlSchemaIR` can remain target-agnostic *and* useful. That is realistic if we treat it as **contract-addressable schema**, not a lossless representation of every dialect’s DDL/catalog.

### Non-goal: lossless, universal DDL model

`SqlSchemaIR` should not attempt to model every possible target feature (partial/functional indexes, computed columns, collations/charsets, engine specifics, etc.). If we try, the IR will bloat and still be incomplete.

### Goal: faithfully represent the contract-expressed subset

The IR must be able to represent the subset of schema facts the contract can express today (tables, columns, native types, nullability, PK/UK/FK, basic indexes, extensions), plus a structured escape hatch for target-specific fidelity via `annotations`.

### Invariant: canonicalization happens at the target boundary

The family-level verifier can be generic only if each target introspector **normalizes** the schema it reads into canonical forms for that target (especially `nativeType` and index/constraint shapes).

If introspection emits raw catalog strings (or inconsistent aliases), verification will devolve into brittle string comparisons and we’ll be forced into target-specific verification.

### Escape hatch: target-specific annotations

When a target needs to capture additional details beyond the contract-expressed subset, it should attach them under namespaced `annotations` (e.g. `annotations.pg.*`, `annotations.mysql.*`) so:

- the generic verifier can ignore them by default
- future contract features or target-specific verification extensions can read them intentionally

## Proposed Implementation

### 4.1 Extract pure verification primitive

#### New module (pure)

Create a new pure function inside `@prisma-next/family-sql`:

- `src/core/schema-verify/verify-sql-schema.ts`

Proposed signature:

```ts
import type { OperationContext } from '@prisma-next/core-control-plane/types';
import type { VerifyDatabaseSchemaResult } from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

export interface VerifySqlSchemaOptions {
  readonly contract: SqlContract<SqlStorage>;
  readonly schema: SqlSchemaIR;
  readonly strict: boolean;
  readonly context?: OperationContext;
  // pass-through for type consistency warnings (keeps it pure)
  readonly typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
}

export function verifySqlSchema(options: VerifySqlSchemaOptions): VerifyDatabaseSchemaResult;
```

Notes:

- This function must not depend on `driver` or on any adapter introspection code.
- It returns the existing family-agnostic `VerifyDatabaseSchemaResult` shape (tree + issues + counts).
- It should reuse the existing compare helpers currently in `instance.ts` (columns/PK/FK/uniques/indexes/extensions) by moving them into this module (or sibling modules under `core/schema-verify/`).
- Remove redundant “contractNativeType missing” / “schema nativeType missing” defensive checks where contract/schema types already guarantee presence. Prefer `assert`/non-null assertions after validation.

#### Refactor `schemaVerify()` to orchestrate

Keep the public API `schemaVerify({ driver, contractIR, strict, context })` unchanged, but refactor to:

1. `validateContract<SqlContract<SqlStorage>>(contractIR)`
2. `controlAdapter.introspect(driver, contractIR)` → `schemaIR`
3. `verifySqlSchema({ contract, schema: schemaIR, strict, context, typeMetadataRegistry })`

This keeps CLI behavior stable and makes verification logic reusable by planner/runner without DB I/O.

#### Export surface

Add a new package export subpath for the pure verifier:

- `src/exports/schema-verify.ts` → `export { verifySqlSchema } from '../core/schema-verify/verify-sql-schema'`
- Update `packages/2-sql/3-tooling/family/package.json` exports with `./schema-verify`
- Update `packages/2-sql/3-tooling/family/tsup.config.ts` entry map accordingly

This allows targets (e.g. Postgres planner) to import:

```ts
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
```

### 4.2 Verification as a runner postcondition (introspect + pure verify)

The runner must enforce: **never commit unless the post-state schema satisfies the destination contract**. That requirement forces verification to occur *inside* the runner’s transaction boundary, but it does not mean verification logic lives in the runner.

We do **not** introduce a family-level “runner verification helper” whose job is to map schema verification results into `MigrationRunnerFailure`. Error shaping remains in the target runner package.

#### Target runner flow

Inside the runner transaction (and lock scope), do:

- Apply plan operations
- Call `family.introspect({ driver, contractIR: destinationContract })` to obtain a schema snapshot (DB I/O, family-owned orchestration)
- Call `verifySqlSchema({ contract: destinationContract, schema: schemaIR, strict, ... })` (pure verifier)
- If verification fails: return `runnerFailure('SCHEMA_VERIFY_FAILED', ...)` and include diagnostics (at least `issues`, optionally the full verification tree) in the failure payload/meta
- Only commit after verification passes and marker/ledger writes succeed

Rationale:

- Avoids turning `schemaVerify()` (an orchestrated “command”) into a dependency for runners.
- Keeps runner error shaping in the target package where the runner lives.
- Keeps the verification logic reusable and pure (`contract + schemaIR -> VerifyDatabaseSchemaResult`).

### 4.3 Tests (TDD)

#### Unit tests (new)

Add unit tests inside `@prisma-next/family-sql` for the pure verifier:

- `packages/2-sql/3-tooling/family/test/schema-verify.basic.test.ts`
- Focus: verifySqlSchema(contract, schemaIR) returns correct `ok`, `schema.issues`, and a stable tree shape.

Test cases (minimum set):

- matching schema → `ok: true`
- missing table → `missing_table`
- missing column → `missing_column`
- type mismatch → `type_mismatch`
- nullability mismatch → `nullability_mismatch`
- (optional) PK/UK/index mismatch cases as lightweight objects

These tests should not connect to a DB; they build minimal `SqlSchemaIR` objects and a minimal `SqlContract`.

#### Integration tests (real DB)

Extend integration coverage in the Postgres target package to prove the new primitive catches real drift:

- Add a new test file under:
  - `packages/3-targets/3-targets/postgres/test/migrations/schema-verify.after-runner.integration.test.ts`

Approach:

1. Use `createDevDatabase()` (as existing runner tests do).
2. Run a successful plan via planner+runner to create schema + marker.
3. Mutate the DB to introduce mismatch (e.g., `alter table "user" alter column email drop not null` or change type if allowed).
4. Call `familyInstance.schemaVerify(...)` (or the runner helper if we want to validate that helper too) and assert `ok: false` and issue shape matches.

Notes:

- Keep tests under 500 lines, split by functionality if needed.
- Avoid nested DB connections (respect dev DB single connection limitation).

