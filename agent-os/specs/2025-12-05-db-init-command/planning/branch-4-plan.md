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

### 4.2 Provide a runner-friendly verification helper

Create a helper in `@prisma-next/family-sql/control` area (or a new module under migrations) that maps schema verification failures into the runner’s structured `MigrationRunnerFailure` (without throwing).

Proposed shape:

```ts
import type { ControlDriverInstance, OperationContext } from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { MigrationRunnerFailure } from './migrations/types';
import type { Result } from '@prisma-next/core-control-plane/result';

export async function verifyDatabaseSatisfiesContractForRunner(options: {
  readonly family: SqlControlFamilyInstance;
  readonly driver: ControlDriverInstance;
  readonly contract: SqlContract<SqlStorage>;
  readonly strict: boolean;
  readonly context?: OperationContext;
}): Promise<Result<void, MigrationRunnerFailure>>;
```

Implementation detail:

- Internally calls `family.schemaVerify({ driver, contractIR: contract, strict, context })`
- If verification fails, return `runnerFailure('SCHEMA_VERIFY_FAILED', schemaVerifyResult.summary, { meta: { issues: ... } })`
- Avoid extra defensive branches (the helper is only called with validated `contract`).

Then refactor the Postgres runner to call this helper rather than duplicating failure mapping logic (behavior should remain the same; this is a small consolidation and makes future runner changes cheaper).

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

## Commit-by-Commit Execution Plan (TDD + clean history)

### Commit 1 — Add failing unit test skeleton for pure verifier

- Add `schema-verify.basic.test.ts` with failing expectation for `verifySqlSchema` (module does not exist yet).

### Commit 2 — Introduce pure verifier module (minimal passing behavior)

- Add `verifySqlSchema` with minimal table/column comparison to satisfy tests.
- Keep it pure.

### Commit 3 — Expand verifier to match current behavior (constraints + extensions)

- Add PK/UK/FK/index + extensions comparisons as needed.
- Extend unit tests correspondingly.

### Commit 4 — Refactor `schemaVerify()` to call pure verifier

- Move comparison logic out of `instance.ts`, keep orchestration and output shape stable.
- Add a small regression test if needed (unit-level) ensuring schemaVerify still reports same result shape for a mocked schema IR (if possible without mocking driver; otherwise rely on existing consumers + integration tests).

### Commit 5 — Export `./schema-verify` subpath

- Add `src/exports/schema-verify.ts`
- Update `tsup.config.ts` and `package.json` exports
- Add a minimal import test if needed.

### Commit 6 — Add runner verification helper + refactor runner to use it

- Add helper returning `Result<void, MigrationRunnerFailure>`
- Update Postgres runner to use helper (no behavior change expected).
- Update affected runner tests if necessary (should be minimal).

### Commit 7 — Add/extend integration test (real DB drift detection)

- Add new integration test demonstrating mismatch detection after DB mutation.

### Commit 8 — Docs / README alignment

- Update `@prisma-next/family-sql` README with:
  - new `verifySqlSchema` export
  - intended usage by planner/runner
  - architecture diagram update if needed
- Update `agent-os/specs/.../tasks.md` checkboxes for 4.1–4.3 when done.

## Implementation Notes / Risks

- `VerifyDatabaseSchemaResult` is a shared core-control-plane type; keep its semantics stable.
- The current `schemaVerify()` has some defensive checks that are likely unreachable after `validateContract`; when extracting, remove those to avoid coverage dead spots.
- Keep the verifier free of driver/adapters so it remains usable in planner logic.

## Commands (when executing Branch 4)

From repo root:

- Unit tests (family-sql):
  - `pnpm --filter @prisma-next/family-sql test`
- Integration tests (postgres target):
  - `pnpm --filter @prisma-next/target-postgres test`
- Typecheck:
  - `pnpm --filter @prisma-next/family-sql typecheck`
  - `pnpm --filter @prisma-next/target-postgres typecheck`


