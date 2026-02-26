# M4 Task Plan: SQL Lowering

## Summary

Update the contract-to-contract planner to produce `SqlMigrationPlanOperation[]` directly instead of `AbstractOp[]`. Drop the abstract ops layer entirely. Update all consumers, tests, and types. This is the prerequisite tracked in `plan.md` Milestone 4.

**Spec reference:** RD-6 (Direct SQL on disk), FR-1 (lowers directly to target SQL), NFR-2 (layering compliance).

## Architecture

### Current State

```
contract-planner.ts (sql domain)
    → produces AbstractOp[] (framework types)
    → AbstractOp carries structured pre/post checks (AbstractCheck)
    → no SQL generation

postgres/control.ts (target domain)
    → calls planContractDiff() → gets ContractDiffResult with AbstractOp[]
    → passes through to ControlClient.contractDiff()

migration-plan.ts (CLI, framework domain)
    → calls client.contractDiff() → gets ContractDiffResult
    → writes AbstractOp[] to ops.json
```

### Target State

```
contract-planner.ts (sql domain)
    → performs structural diffing (same as today)
    → delegates SQL generation to an injected SqlEmitter
    → produces SqlMigrationPlanOperation<TTargetDetails>[]

postgres/control.ts (target domain)
    → creates a PostgresSqlEmitter implementing SqlEmitter
    → calls planContractDiff({ from, to, emitter }) → gets SqlMigrationPlanOperation[]
    → passes through to ControlClient.contractDiff()

migration-plan.ts (CLI, framework domain)
    → calls client.contractDiff() → gets ContractDiffResult with MigrationPlanOperation[]
    → writes SqlMigrationPlanOperation[] to ops.json (opaque at framework level)
```

### Key Layering Constraint

The contract planner lives in `packages/2-sql/3-tooling/family/` (sql domain). The SQL generation helpers (`quoteIdentifier`, `escapeLiteral`, `buildCreateTableSql`, etc.) live in `packages/3-targets/6-adapters/postgres/` (targets domain). The sql domain **cannot import from the targets domain**.

**Solution: SqlEmitter interface.** Define a `SqlEmitter` interface in the sql family that the contract planner calls for SQL generation. The Postgres target provides an implementation that uses its own SQL helpers. This follows the same pattern as `TargetMigrationsCapability` — the framework defines the interface, the target provides the implementation.

```
sql-family (defines interface)     targets/postgres (implements)
┌──────────────────────────┐       ┌─────────────────────────────┐
│ SqlEmitter<TDetails>     │       │ PostgresSqlEmitter           │
│   emitCreateTable()      │◄──────│   uses quoteIdentifier()     │
│   emitAddColumn()        │       │   uses escapeLiteral()       │
│   emitAddPrimaryKey()    │       │   uses buildCreateTableSql() │
│   emitAddUnique()        │       └─────────────────────────────┘
│   emitCreateIndex()      │
│   emitAddForeignKey()    │
│   emitEnableExtension()  │
│   emitCreateStorageType()│
└──────────────────────────┘
```

## Tasks

### Phase 1: Prep — Move EMPTY_CONTRACT_HASH, define SqlEmitter

**1.1 Move `EMPTY_CONTRACT_HASH` out of `abstract-ops.ts`**

- Move to `packages/1-framework/1-core/migration/control-plane/src/constants.ts` (new file)
- Update the `exports/abstract-ops.ts` barrel to re-export from `constants.ts`
- Update all import sites to import from the new location
- This makes `abstract-ops.ts` deletable in Phase 4

Files:
- Create: `packages/1-framework/1-core/migration/control-plane/src/constants.ts`
- Update: `packages/1-framework/1-core/migration/control-plane/src/abstract-ops.ts` — remove `EMPTY_CONTRACT_HASH`
- Update: `packages/1-framework/1-core/migration/control-plane/src/exports/abstract-ops.ts` — re-export from constants
- Create: `packages/1-framework/1-core/migration/control-plane/src/exports/constants.ts` — new export barrel
- Update: all import sites (`migration-plan.ts`, `migration-plan.test.ts`, `dag.ts`, fixtures, etc.)

**1.2 Define `SqlEmitter` interface in sql family**

The emitter converts structural diff information into `SqlMigrationPlanOperation[]` for a specific target. Each method takes the structural information (table name, columns, etc.) and returns one or more `SqlMigrationPlanOperation<TTargetDetails>`.

```typescript
interface SqlEmitter<TTargetDetails> {
  emitCreateTable(table: string, def: StorageTable): SqlMigrationPlanOperation<TTargetDetails>;
  emitAddColumn(table: string, column: string, def: StorageColumn): SqlMigrationPlanOperation<TTargetDetails>;
  emitAddPrimaryKey(table: string, constraintName: string, columns: readonly string[]): SqlMigrationPlanOperation<TTargetDetails>;
  emitAddUniqueConstraint(table: string, constraintName: string, columns: readonly string[]): SqlMigrationPlanOperation<TTargetDetails>;
  emitCreateIndex(table: string, indexName: string, columns: readonly string[]): SqlMigrationPlanOperation<TTargetDetails>;
  emitAddForeignKey(table: string, constraintName: string, args: ForeignKeyArgs): SqlMigrationPlanOperation<TTargetDetails>;
  emitEnableExtension(extension: string, dependencyId: string): SqlMigrationPlanOperation<TTargetDetails>;
  emitCreateStorageType(typeName: string, typeInstance: StorageTypeInstance): SqlMigrationPlanOperation<TTargetDetails>;
}
```

Files:
- Create: `packages/2-sql/3-tooling/family/src/core/migrations/sql-emitter.ts`
- Update: `packages/2-sql/3-tooling/family/src/exports/control.ts` — export the interface

**1.3 Define new `ContractDiffResult` type**

Replace the current `ContractDiffResult` (carries `AbstractOp[]`) with one that carries `SqlMigrationPlanOperation[]`. The result type stays in the sql family since it's an sql-domain concept. The framework-level `TargetMigrationsCapability.planContractDiff` returns a framework-level result type carrying `MigrationPlanOperation[]` (the base interface).

```typescript
// In sql family — full typed result
interface SqlContractDiffSuccess<TTargetDetails> {
  readonly kind: 'success';
  readonly ops: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}

// ContractDiffFailure stays the same (conflicts)
type SqlContractDiffResult<TTargetDetails> = SqlContractDiffSuccess<TTargetDetails> | ContractDiffFailure;

// In framework — base result for TargetMigrationsCapability
interface ContractDiffSuccess {
  readonly kind: 'success';
  readonly ops: readonly MigrationPlanOperation[];
}

type ContractDiffResult = ContractDiffSuccess | ContractDiffFailure;
```

Files:
- Update: `packages/2-sql/3-tooling/family/src/core/migrations/types.ts` — add `SqlContractDiffResult`
- Update: `packages/1-framework/1-core/migration/control-plane/src/migrations.ts` — redefine `ContractDiffResult` with `MigrationPlanOperation[]`

### Phase 2: Implement PostgresSqlEmitter

Extract the SQL generation logic from the existing Postgres planner into a `PostgresSqlEmitter` that implements `SqlEmitter<PostgresPlanTargetDetails>`. The existing planner methods (`buildCreateTableSql`, `buildAddColumnSql`, `columnExistsCheck`, etc.) are already the right shape — they just need to be wrapped in the emitter interface.

Files:
- Create: `packages/3-targets/3-targets/postgres/src/core/migrations/sql-emitter.ts`
- This reuses the existing SQL generation helpers from `planner.ts` (they can stay as private functions in the same package, or be extracted to a shared `sql-helpers.ts`)

Tests:
- Unit test the emitter methods directly: given structural input, verify the SQL output matches what the existing planner produces

### Phase 3: Update contract planner

Update `planContractDiff` to accept a `SqlEmitter` and produce `SqlMigrationPlanOperation[]` instead of `AbstractOp[]`.

The structural diffing logic (conflict detection, satisfaction predicates, deterministic ordering) is unchanged. The change is:
- Instead of building `AbstractOp` objects with structured `pre`/`post` checks, call `emitter.emitXxx()` methods that return `SqlMigrationPlanOperation` with resolved SQL
- The function signature changes: `planContractDiff({ from, to, emitter }) → SqlContractDiffResult<TTargetDetails>`

Files:
- Update: `packages/2-sql/3-tooling/family/src/core/migrations/contract-planner.ts`
  - Add `emitter: SqlEmitter<TTargetDetails>` to `ContractPlannerOptions`
  - Replace all `AbstractOp` construction with `emitter.emitXxx()` calls
  - Remove all `AbstractCheck`, `AbstractColumnDefinition`, `toAbstractColumn`, `toAbstractDefault` usage
  - Return type changes to `SqlContractDiffResult<TTargetDetails>`

Tests:
- Update: `packages/2-sql/3-tooling/family/test/contract-planner.test.ts`
  - Create a test `PostgresSqlEmitter` (or use the real one from the Postgres target)
  - All assertions change from `AbstractOp` shape checks to `SqlMigrationPlanOperation` shape checks
  - Assertions on `op.op === 'createTable'` become assertions on `op.id === 'table.users'` + `op.execute[0].sql` containing `CREATE TABLE`
  - Pre/post check assertions change from structured `AbstractCheck` predicates to SQL string assertions

### Phase 4: Update consumer chain

**4.1 Update `TargetMigrationsCapability.planContractDiff`**

Files:
- Update: `packages/1-framework/1-core/migration/control-plane/src/migrations.ts`
  - Return type: `ContractDiffResult` (new version with `MigrationPlanOperation[]`)
  - Remove import of old `ContractDiffResult` from `abstract-ops`

**4.2 Update Postgres target descriptor**

Files:
- Update: `packages/3-targets/3-targets/postgres/src/exports/control.ts`
  - `planContractDiff` implementation creates a `PostgresSqlEmitter` and passes it to `planContractDiff()`
  - Maps the `SqlContractDiffResult<PostgresPlanTargetDetails>` to the framework-level `ContractDiffResult`

**4.3 Update ControlClient**

Files:
- Update: `packages/1-framework/3-tooling/cli/src/control-api/types.ts` — `contractDiff()` return type
- Update: `packages/1-framework/3-tooling/cli/src/control-api/client.ts` — implementation (no logic change, just types)

**4.4 Update `migration-plan` command**

Files:
- Update: `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts`
  - Remove `AbstractOp` import
  - `diffResult.ops` is now `MigrationPlanOperation[]` (framework-level, but actual JSON payload is `SqlMigrationPlanOperation[]`)
  - Update `MigrationPlanResult.operations` mapping (no more `op.op`, use `op.id` and `op.operationClass`)

**4.5 Update `migration-tools` types**

Files:
- Update: `packages/1-framework/3-tooling/migration/src/types.ts`
  - `MigrationOps` changes from `readonly AbstractOp[]` to `readonly MigrationPlanOperation[]`
  - Remove `AbstractOp` import, add `MigrationPlanOperation` import from `@prisma-next/core-control-plane/types`

**4.6 Update `migration-tools` fixtures and tests**

Files:
- Update: `packages/1-framework/3-tooling/migration/test/fixtures.ts`
  - `createTestOps()` returns `MigrationPlanOperation[]` instead of `AbstractOp[]`
  - Fixtures use `{ id, label, operationClass }` shape (the base interface)

- Update: `packages/1-framework/3-tooling/cli/test/commands/migration-plan.test.ts`
  - `createTableOp()` helper returns `MigrationPlanOperation` instead of `AbstractOp`

### Phase 5: Delete abstract ops + cleanup

**5.1 Delete `abstract-ops.ts`**

Files:
- Delete: `packages/1-framework/1-core/migration/control-plane/src/abstract-ops.ts`
- Delete: `packages/1-framework/1-core/migration/control-plane/src/exports/abstract-ops.ts`
- Update: any `package.json` exports map that references `./abstract-ops`
- Verify no remaining imports of `@prisma-next/core-control-plane/abstract-ops`

**5.2 Update docs**

Files:
- Update: `packages/1-framework/3-tooling/migration/README.md`
  - Replace `AbstractOp[]` references with `MigrationPlanOperation[]` / `SqlMigrationPlanOperation[]`
  - Update architecture diagram
  - Update dependencies table (remove `AbstractOp` reference)

**5.3 Verify**

- `pnpm build` — all packages compile
- `pnpm test:packages` — all tests pass
- `pnpm lint:deps` — no layering violations
- `pnpm typecheck` — no type errors

## Sequencing

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5
 (prep)     (emitter)   (planner)   (consumers)  (cleanup)
```

Each phase produces a committable state (no broken builds between phases). The cleanest review structure is one commit per phase, but phases 1-3 could be a single commit if preferred.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Existing Postgres planner breaks | No changes to existing planner — only the contract planner changes. The existing planner already produces `SqlMigrationPlanOperation`. |
| SQL output differs from existing planner | Phase 2 tests compare emitter output against known Postgres planner output to ensure parity. |
| Layering violation | SqlEmitter interface in sql domain, implementation in target domain — follows established pattern. Verify with `pnpm lint:deps` after each phase. |
| Test blast radius | Phase 3 and 4 update all test files systematically. No test should reference `AbstractOp` after Phase 5. |

## Files Changed (Complete)

### Created
- `packages/1-framework/1-core/migration/control-plane/src/constants.ts`
- `packages/1-framework/1-core/migration/control-plane/src/exports/constants.ts`
- `packages/2-sql/3-tooling/family/src/core/migrations/sql-emitter.ts`
- `packages/3-targets/3-targets/postgres/src/core/migrations/sql-emitter.ts`

### Updated
- `packages/1-framework/1-core/migration/control-plane/src/abstract-ops.ts`
- `packages/1-framework/1-core/migration/control-plane/src/exports/abstract-ops.ts`
- `packages/1-framework/1-core/migration/control-plane/src/migrations.ts`
- `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts`
- `packages/1-framework/3-tooling/cli/src/control-api/types.ts`
- `packages/1-framework/3-tooling/cli/src/control-api/client.ts`
- `packages/1-framework/3-tooling/cli/test/commands/migration-plan.test.ts`
- `packages/1-framework/3-tooling/migration/src/types.ts`
- `packages/1-framework/3-tooling/migration/test/fixtures.ts`
- `packages/1-framework/3-tooling/migration/README.md`
- `packages/2-sql/3-tooling/family/src/core/migrations/contract-planner.ts`
- `packages/2-sql/3-tooling/family/src/core/migrations/types.ts`
- `packages/2-sql/3-tooling/family/src/exports/control.ts`
- `packages/2-sql/3-tooling/family/test/contract-planner.test.ts`
- `packages/3-targets/3-targets/postgres/src/exports/control.ts`

### Deleted
- `packages/1-framework/1-core/migration/control-plane/src/abstract-ops.ts`
- `packages/1-framework/1-core/migration/control-plane/src/exports/abstract-ops.ts`
