# Mongo Runner Post-Apply Schema Verification

## Summary

Close the parity gap between the Mongo and Postgres migration runners by introspecting the live DB after the operation loop and verifying it against the destination contract before writing the marker/ledger. Extract the verifier as a pure function (`verifyMongoSchema`) shared with `db verify --schema-only`, and tighten the runner's `destinationContract` typing while we're there.

**Spec:** [`spec.md`](spec.md) (decision, requirements, constraints, alternatives)
**Linear issue:** [TML-2285](https://linear.app/prisma-company/issue/TML-2285/mongo-migration-runner-should-verify-resulting-schema-against)

## Design recap

After the operation loop and before the marker/ledger write, `MongoMigrationRunner.execute()` calls `deps.introspectSchema()` then `verifyMongoSchema(...)` and returns `SCHEMA_VERIFY_FAILED` on drift (with `meta.issues` populated and the marker untouched). The pure `verifyMongoSchema` is shared with `MongoFamilyInstance.schemaVerify`, so `db verify --schema-only` and `migration apply` agree on "matches the contract" by construction. The introspection callback wires to `family.introspect({ driver })` at `createMongoRunnerDeps`, composing the framework SPI primitive at the system boundary (per [ADR 198](../../docs/architecture%20docs/adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md) + [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md)).

See [`spec.md#decision`](spec.md#decision) for the full design and [`spec.md#alternatives-considered`](spec.md#alternatives-considered) for the rejected alternatives.

## Approach

The implementation order is **bottom-up**: extract the pure verifier first (1.1–1.4), then add runner-side wiring (1.5–1.8), then make the execution-flow change that consumes both (1.9–1.10), then validate end-to-end against a real MongoDB (1.11–1.13), then build hygiene (1.14–1.15). This sequence keeps every test we write paired with its production code at landing time, and avoids a half-wired runner with no pure verifier underneath.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Reviewer | Saevar | Migration system owner; verified the Postgres runner pattern this mirrors |
| Collaborator | WS4 (Mongo) | Closes a known gap raised in the PR #349 review for the data-migrations work |

## Milestone 1: Introspect + verify in `MongoMigrationRunner.execute()`

A single milestone — small, cohesive, only fully validatable end-to-end against `mongodb-memory-server`.

### Pure verifier

- [ ] **1.1 Write unit tests for `verifyMongoSchema`** at `packages/2-mongo-family/9-family/test/schema-verify.test.ts`. Cover happy path (empty + matching) and each drift kind: missing collection, missing index, extra index strict/non-strict, validator missing/extra/mismatched, collection-options mismatched. Each case asserts both `result.ok` and the `result.schema.issues` / `result.meta` envelope. Tests fail until 1.2 lands.

- [ ] **1.2 Implement `verifyMongoSchema`** at `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts`. Pure function with the signature in the spec (`{ contract: MongoContract, schema: MongoSchemaIR, strict, context?, frameworkComponents }`); internally calls `contractToMongoSchemaIR(contract)` + `diffMongoSchemas(live, expected, strict)` and assembles the `VerifyDatabaseSchemaResult` envelope. Mirror the `verifySqlSchema` envelope shape exactly. Make 1.1 pass.

- [ ] **1.3 Add the `@prisma-next/family-mongo/schema-verify` export.** New `src/exports/schema-verify.ts` re-exporting `verifyMongoSchema` + `VerifyMongoSchemaOptions`; new `./schema-verify` entry in [`package.json`](../../packages/2-mongo-family/9-family/package.json) (mirror the existing `./control` and `./migration` entries). Run the package's `pnpm build` to refresh `dist/*.d.mts`.

- [ ] **1.4 Refactor `MongoFamilyInstance.schemaVerify` to delegate.** Replace the inline `introspectSchema` + `diffMongoSchemas` block in [`control-instance.ts`](../../packages/2-mongo-family/9-family/src/core/control-instance.ts) (lines 140–179) with `introspectSchema(db)` followed by `verifyMongoSchema(...)`. External behavior unchanged; existing `db verify --schema-only` tests continue to pass.

### Runner deps + options

- [ ] **1.5 Extend `MongoRunnerDependencies` with `introspectSchema`.** Add `readonly introspectSchema: () => Promise<MongoSchemaIR>` to the interface in [`mongo-runner.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts). Update the existing fakes/stubs in [`mongo-runner.test.ts`](../../packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts) (and any other call sites under `test/`) to provide a stub implementation.

- [ ] **1.6 Wire `introspectSchema` to compose `family.introspect`.** Thread the `family` instance from `mongoTargetDescriptor.migrations.createRunner(family)` (currently `_family`, unused) through to `createMongoRunnerDeps(driver, family)`. Inside `createMongoRunnerDeps` ([`runner-deps.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts)), expose `introspectSchema: () => family.introspect({ driver })` — composing the framework SPI primitive at the wiring boundary, not the adapter helper. The runner stays decoupled (sees only a callback returning `MongoSchemaIR`).

- [ ] **1.7 Tighten `destinationContract` typing.** Change `destinationContract: unknown` → `destinationContract: MongoContract` in `MongoMigrationRunnerExecuteOptions`. Update the `mongoTargetDescriptor.migrations.createRunner` wrapper in [`mongo-target-descriptor.ts`](../../packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts) and any test call sites that pass `{}` as the contract.

- [ ] **1.8 Add `strictVerification?: boolean` runner option.** Default `true`. Threaded into the `verifyMongoSchema(...)` call as `strict`.

### Runner execution flow

- [ ] **1.9 Write unit-ish runner tests for the verify failure path** in `packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts` (or a new `mongo-runner.schema-verify.test.ts`). Stub `introspectSchema` and `verifyMongoSchema` and assert: when verification fails, the runner returns `SCHEMA_VERIFY_FAILED` with `meta.issues` populated and **never** calls `markerOps.updateMarker` / `initMarker` / `writeLedgerEntry`. Tests fail until 1.10 lands.

- [ ] **1.10 Insert the verify step into `MongoMigrationRunner.execute()`** between the operation loop (currently ending around line 175) and the marker CAS / ledger write (currently lines 178–220):

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

### Integration coverage (real MongoDB)

- [ ] **1.11 Integration test: happy path.** New `packages/3-mongo-target/2-mongo-adapter/test/mongo-runner.schema-verify.integration.test.ts` using `mongodb-memory-server`. A migration that creates an index on a collection: runner applies → verify passes → marker + ledger written. Inspect the database directly to confirm the marker advanced.

- [ ] **1.12 Integration test: tampered DB + recovery.** Same setup, but seed an out-of-band index that the contract doesn't declare before running the migration → assert `SCHEMA_VERIFY_FAILED`, `meta.issues` non-empty, marker still at origin (or absent), no ledger entry. Then drop the rogue index and re-run → verify passes; second run executes zero operations (idempotent) and writes the marker.

- [ ] **1.13 Integration test: strict opt-out.** With `strictVerification: false`, an extra (out-of-band) index does not fail verification; runner proceeds to write marker + ledger.

### Build / hygiene

- [ ] **1.14 Run `pnpm lint:deps`, `pnpm typecheck`, `pnpm test:packages`.** Fix any layering / type / test failures introduced by the change. Refresh `dist/*.d.mts` for `@prisma-next/family-mongo` (touched exports) and `@prisma-next/target-mongo` (touched runner options) via `pnpm build`.

- [ ] **1.15 Update package READMEs / DEVELOPING.md if necessary.** If the `@prisma-next/family-mongo` README documents exported entry points, add `./schema-verify`. Otherwise skip — no user-facing surface change.

### Follow-ups

- [x] **1.16 File a Linear follow-up for hoisting `family.introspect + verify` into a framework-shared runner SPI.** Filed as [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi). Out of scope here.

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

## Decisions made during shaping

These mirror [`spec.md#decisions-made-during-shaping`](spec.md#decisions-made-during-shaping); listed here so an implementer can see them without flipping back.

1. **Skip verification on the no-op short-circuit.** Matches Postgres; `db verify --schema-only` already serves the "verify the live DB regardless" use case. Revisit cost: ~3 lines to flip if a reviewer prefers the opposite.
2. **`OperationContext` included in `VerifyMongoSchemaOptions`** for symmetry with `verifySqlSchema`. Threaded into the result envelope; no logic uses it yet.
3. **No framework-level hoisting yet** — see [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi).

## Close-out (required)

- [ ] Verify all acceptance criteria in [`spec.md`](spec.md).
- [ ] Determine whether the verify-step in the runner warrants a paragraph in [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md). If yes, update and link [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md); if not, document the decision here and move on.
- [ ] Confirm [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md) is durable in `docs/`.
- [ ] Strip repo-wide references to `projects/mongo-runner-schema-verify/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/mongo-runner-schema-verify/`.
