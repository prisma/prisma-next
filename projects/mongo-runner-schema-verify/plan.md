# Mongo Runner Post-Apply Schema Verification

## Summary

Close the parity gap between the Mongo and Postgres migration runners by introspecting the live DB after the operation loop and verifying it against the destination contract before writing the marker/ledger. Extract the verifier as a pure function (`verifyMongoSchema`) shared with `db verify --schema-only`, wire it through a new `introspectSchema` callback on `MongoRunnerDependencies`, and tighten the runner's `destinationContract` typing while we're there.

**Spec:** [`projects/mongo-runner-schema-verify/spec.md`](spec.md)
**Linear issue:** [TML-2285](https://linear.app/prisma-company/issue/TML-2285/mongo-migration-runner-should-verify-resulting-schema-against)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Reviewer | Saevar | Migration system owner; verified the Postgres runner pattern this mirrors |
| Collaborator | WS4 (Mongo) | Closes a known gap raised in the PR #349 review for the data-migrations work |

## Milestones

A single milestone — the work is small, cohesive, and only validatable end-to-end against `mongodb-memory-server`.

### Milestone 1: Introspect + verify in `MongoMigrationRunner.execute()`

Delivers the runner-level guarantee that a successful `migration apply` against MongoDB has produced a schema that satisfies the destination contract, with a `SCHEMA_VERIFY_FAILED` failure path on drift that leaves the marker untouched.

**Tasks:**

**Pure verifier:**

- [ ] **1.1 Write unit tests for `verifyMongoSchema`** at `packages/2-mongo-family/9-family/test/schema-verify.test.ts`. Cover: happy path (empty schema vs empty contract, matching schema), missing collection, missing index, extra index (strict vs non-strict), validator missing/extra/mismatched, collection-options mismatched. Each case asserts both `result.ok` and the `result.schema.issues`/`result.meta` envelope. Tests fail until 1.2 lands.

- [ ] **1.2 Implement `verifyMongoSchema`** at `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts`. Pure function with the signature in the spec; internally calls `contractToMongoSchemaIR(contract)` + `diffMongoSchemas(live, expected, strict)` and assembles the `VerifyDatabaseSchemaResult` envelope. Mirror the `verifySqlSchema` envelope shape exactly so downstream consumers (CLI rendering, telemetry) stay symmetric across families. Make 1.1 pass.

- [ ] **1.3 Add the `@prisma-next/family-mongo/schema-verify` export.** New `src/exports/schema-verify.ts` re-exporting `verifyMongoSchema` + `VerifyMongoSchemaOptions`; new `./schema-verify` entry in [`packages/2-mongo-family/9-family/package.json`](../../packages/2-mongo-family/9-family/package.json) (mirror the `./control` and `./migration` entries). Run the package's `pnpm build` to refresh `dist/*.d.mts`.

- [ ] **1.4 Refactor `MongoFamilyInstance.schemaVerify` to delegate.** Replace the inline `introspectSchema` + `diffMongoSchemas` block in [`control-instance.ts`](../../packages/2-mongo-family/9-family/src/core/control-instance.ts) (lines 140-179) with `introspectSchema(db)` followed by `verifyMongoSchema(...)`. External behavior unchanged; existing `db verify --schema-only` tests continue to pass.

**Runner deps + options:**

- [ ] **1.5 Extend `MongoRunnerDependencies` with `introspectSchema`.** Add `readonly introspectSchema: () => Promise<MongoSchemaIR>` to the interface in [`packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts). Update the existing fakes/stubs in [`packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts`](../../packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts) (and any other call sites under `test/`) to provide a stub implementation.

- [ ] **1.6 Wire `introspectSchema` in `createMongoRunnerDeps`.** Update [`packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts) to capture the `Db` instance and expose `introspectSchema: () => introspectSchema(db)`, importing `introspectSchema` from `./introspect-schema` (already in the same package).

- [ ] **1.7 Tighten `destinationContract` typing.** Change `destinationContract: unknown` → `destinationContract: MongoContract` in `MongoMigrationRunnerExecuteOptions`. Update the `mongoTargetDescriptor.migrations.createRunner` wrapper in [`packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts`](../../packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts) and any test call sites that pass `{}` as the contract.

- [ ] **1.8 Add `strictVerification?: boolean` runner option.** Default `true`. Threaded into the `verifyMongoSchema(...)` call as `strict`.

**Runner execution flow:**

- [ ] **1.9 Write unit-ish runner tests for the verify failure path.** Stub `introspectSchema` and `verifyMongoSchema` in `packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts` (or a new `mongo-runner.schema-verify.test.ts`) and assert: when verification fails, the runner returns `SCHEMA_VERIFY_FAILED` with `meta.issues` populated and **never** calls `markerOps.updateMarker`/`markerOps.initMarker`/`markerOps.writeLedgerEntry`. Tests fail until 1.10 lands.

- [ ] **1.10 Insert the verify step into `MongoMigrationRunner.execute()`** between the operation loop (currently ending around line 175) and the marker CAS / ledger write (currently lines 178-220):

  ```typescript
  const liveSchema = await deps.introspectSchema();
  const verifyResult = verifyMongoSchema({
    contract: options.destinationContract,
    schema: liveSchema,
    strict: options.strictVerification ?? true,
    frameworkComponents: options.frameworkComponents,
  });
  if (!verifyResult.ok) {
    return runnerFailure('SCHEMA_VERIFY_FAILED', verifyResult.summary, {
      why: 'The resulting database schema does not satisfy the destination contract.',
      meta: { issues: verifyResult.schema.issues },
    });
  }
  ```

  Skip verification when the runner short-circuits because no operations were executed and the marker already matches (matches Postgres). Make 1.9 pass.

**Integration coverage (real MongoDB):**

- [ ] **1.11 Integration test: happy path.** New `packages/3-mongo-target/2-mongo-adapter/test/mongo-runner.schema-verify.integration.test.ts` using `mongodb-memory-server`. A migration that creates an index on a collection: runner applies → verify passes → marker + ledger written. Inspect the database directly to confirm the marker advanced.

- [ ] **1.12 Integration test: tampered DB.** Same setup, but seed an out-of-band index that the contract doesn't declare before running the migration → assert `SCHEMA_VERIFY_FAILED`, `meta.issues` non-empty, marker still at origin (or absent), no ledger entry. Then drop the rogue index and re-run → verify passes; second run executes zero operations (idempotent) and writes the marker.

- [ ] **1.13 Integration test: strict opt-out.** With `strictVerification: false`, an extra (out-of-band) index does not fail verification; runner proceeds to write marker + ledger.

**Build / hygiene:**

- [ ] **1.14 Run `pnpm lint:deps`, `pnpm typecheck`, `pnpm test:packages`.** Fix any layering / type / test failures introduced by the change. Refresh `dist/*.d.mts` for `@prisma-next/family-mongo` (touched exports) and `@prisma-next/target-mongo` (touched runner options) via `pnpm build`.

- [ ] **1.15 Update package READMEs / DEVELOPING.md if necessary.** If the `@prisma-next/family-mongo` README documents exported entry points, add `./schema-verify`. Otherwise skip — no user-facing surface change.

**Follow-ups:**

- [x] **1.16 File a Linear follow-up for hoisting `family.introspect + verify` into a framework-shared runner SPI.** Filed as [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi). Out of scope here; see [Open Items](#open-items).

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| `verifyMongoSchema` exists, no DB I/O | Unit | 1.1 / 1.2 | Tests must not import `mongodb-memory-server` |
| `@prisma-next/family-mongo/schema-verify` export resolves | Build | 1.3 / 1.14 | `pnpm typecheck` against an importer is sufficient |
| `MongoFamilyInstance.schemaVerify` delegates without behavior change | Unit | 1.4 | Existing `control.test.ts` covers the surface; verify it still passes |
| Unit tests cover happy path + each drift kind | Unit | 1.1 | Six drift kinds, see spec |
| `MongoRunnerDependencies` carries `introspectSchema` | Unit | 1.5 / 1.9 | Tests construct a deps object that satisfies the interface |
| `createMongoRunnerDeps` wires `introspectSchema` | Integration | 1.11 | Implicit: integration tests exercise the wired-up dep |
| `destinationContract: MongoContract` (not `unknown`) | TypeCheck | 1.7 / 1.14 | `pnpm typecheck` would fail with `unknown` callers |
| `strictVerification?: boolean` accepted, default `true` | Unit / Integration | 1.9 / 1.13 | Default in unit; opt-out path in 1.13 |
| Verify runs after operations, before marker/ledger; emits `SCHEMA_VERIFY_FAILED` on drift | Unit + Integration | 1.9 / 1.10 / 1.12 | |
| Marker/ledger NOT written on `SCHEMA_VERIFY_FAILED` | Unit + Integration | 1.9 / 1.12 | Inspect `_prisma_migrations` directly in 1.12 |
| Happy path against real MongoDB | Integration | 1.11 | `mongodb-memory-server` |
| Tampered DB → fail; correction → succeeds idempotently | Integration | 1.12 | Two runs: fail, fix, re-run |
| Strict opt-out lets extra structure through | Integration | 1.13 | |
| CLI parity (`migration apply` surfaces `SCHEMA_VERIFY_FAILED`) | Manual | Verified during close-out | The failure envelope flows through existing CLI rendering — no Mongo-specific path |
| `pnpm lint:deps`, `pnpm typecheck`, `pnpm test:packages` pass | CI | 1.14 | |

## Open Items

1. **Verify on the no-op short-circuit?** When `operationsExecuted === 0` and the marker already matches the destination, the runner short-circuits today without writing. The plan **keeps the short-circuit** (matches Postgres). If reviewers prefer "verify always," 1.10 changes by moving the verify step before the short-circuit. Decision can be deferred until 1.10 review — code change is small.

2. **`OperationContext` in `VerifyMongoSchemaOptions`?** `verifySqlSchema` accepts an optional `context: OperationContext`. The plan **includes it** in the Mongo signature for symmetry, but does not thread it through any logic yet. Drop later if reviewers think YAGNI.

3. **Hoist `family.introspect + verify` into the framework runner SPI.** Both the Postgres and (post-this-project) Mongo runners will perform an identical "introspect → pure verify → fail with `SCHEMA_VERIFY_FAILED`" sequence. A future project could promote this to a shared helper or a base runner class consumed by both. Filed as [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi); not in scope here.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`spec.md`](spec.md).
- [ ] Determine whether the verify-step in the runner warrants a paragraph in [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md) (it currently describes "pre/post-operation checks make migrations self-verifying" but doesn't single out the post-apply schema verify). If yes, update; if not, document the decision here and move on.
- [ ] Strip repo-wide references to `projects/mongo-runner-schema-verify/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/mongo-runner-schema-verify/`.
