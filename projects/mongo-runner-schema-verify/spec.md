# Summary

Bring Mongo migration runner guarantees to parity with the SQL/Postgres runner by introspecting the live database after applying operations and verifying it matches the destination contract before writing the marker/ledger. On drift, fail with `SCHEMA_VERIFY_FAILED` and leave the marker at its origin so re-running the (idempotent) migration is the recovery path.

# Description

The Mongo migration runner ([`packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts)) currently applies operations and goes straight to marker CAS + ledger write — there is no introspection + contract comparison step. This violates a core guarantee of the migration system documented in [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md) and diverges from the Postgres runner ([`packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) lines 146–171), which performs the verification and returns `SCHEMA_VERIFY_FAILED` on drift.

The infrastructure is already partially in place:

- `introspectSchema(db)` exists in [`packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts) and produces a `MongoSchemaIR`.
- `contractToMongoSchemaIR` exists in `@prisma-next/target-mongo/control` for the reverse direction.
- `diffMongoSchemas` in [`packages/2-mongo-family/9-family/src/core/schema-diff.ts`](../../packages/2-mongo-family/9-family/src/core/schema-diff.ts) compares two `MongoSchemaIR`s and emits `SchemaIssue[]` + a `SchemaVerificationNode` tree.
- `MongoFamilyInstance.schemaVerify(...)` ([`packages/2-mongo-family/9-family/src/core/control-instance.ts`](../../packages/2-mongo-family/9-family/src/core/control-instance.ts):140-179) already wraps introspect + diff into a `VerifyDatabaseSchemaResult`. This is what `prisma-next db verify --schema-only` calls — the exact pipeline the runner needs to reuse.

What's missing, and what this project delivers:

1. A pure `verifyMongoSchema(...)` function — analogous to `verifySqlSchema` — that takes `{ contract, schema, strict, frameworkComponents }` and returns a `VerifyDatabaseSchemaResult`. No DB I/O.
2. A new `@prisma-next/family-mongo/schema-verify` export so consumers (the runner, planners, CLI) can import the pure verifier without pulling in family-instance plumbing.
3. `MongoFamilyInstance.schemaVerify` refactored to delegate to the new pure function (single canonical implementation; `db verify` and the runner stay in lockstep).
4. An `introspectSchema` callback on `MongoRunnerDependencies`, wired by `createMongoRunnerDeps` against the same `Db` instance used for command/inspection execution.
5. `MongoMigrationRunner.execute()` extended: after the operation loop, before the marker CAS / ledger write, call `deps.introspectSchema()` then `verifyMongoSchema(...)`. On failure return `SCHEMA_VERIFY_FAILED` with structured `meta.issues`; do not write the marker or ledger entry.
6. A `strictVerification?: boolean` runner option (default `true`), matching `SqlMigrationRunnerExecuteOptions`.
7. `destinationContract: unknown` tightened to `destinationContract: MongoContract` in the runner's options, matching the Postgres pattern.

# Requirements

## Functional Requirements

### Pure schema verifier

1. **Implement `verifyMongoSchema(options)`.** Pure function in `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts`. Signature mirrors `verifySqlSchema` shape (with the Mongo-relevant subset of inputs):

   ```typescript
   export interface VerifyMongoSchemaOptions {
     readonly contract: MongoContract;
     readonly schema: MongoSchemaIR;
     readonly strict: boolean;
     readonly context?: OperationContext;
     readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
   }
   export function verifyMongoSchema(options: VerifyMongoSchemaOptions): VerifyDatabaseSchemaResult;
   ```

   - Internally calls `diffMongoSchemas(schema /* live */, contractToMongoSchemaIR(contract) /* expected */, strict)` and assembles the `VerifyDatabaseSchemaResult` envelope (with `contract`, `target`, `schema: { issues, root, counts }`, `meta`, `timings`) — the exact shape `MongoFamilyInstance.schemaVerify` produces today.
   - Uses `validateMongoContract<MongoContract>(contract)` only when the input could be `unknown`. Once tightened to `MongoContract`, callers are responsible for passing a validated contract; the runner already has one.
   - No DB I/O. Pure.

2. **Add `@prisma-next/family-mongo/schema-verify` export.** New `packages/2-mongo-family/9-family/src/exports/schema-verify.ts` re-exporting `verifyMongoSchema` and its options type, plus a corresponding `./schema-verify` entry in [`packages/2-mongo-family/9-family/package.json`](../../packages/2-mongo-family/9-family/package.json).

3. **Refactor `MongoFamilyInstance.schemaVerify` to delegate.** Replace the inline introspect + diff logic with `await introspectSchema(db) → verifyMongoSchema(...)`. External behavior is unchanged; the function now serves as a thin "DB I/O + pure verify" wrapper. This guarantees `db verify --schema-only` and the runner share one canonical verifier.

### Runner introspection capability

4. **Extend `MongoRunnerDependencies` with `introspectSchema`.** Add `readonly introspectSchema: () => Promise<MongoSchemaIR>` to the interface in [`packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts).

5. **Wire `introspectSchema` in `createMongoRunnerDeps`.** Update [`packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts) to capture the `Db` instance and expose `introspectSchema: () => introspectSchema(db)` (re-using the existing import from `@prisma-next/adapter-mongo/control`).

### Runner options

6. **Tighten `destinationContract` typing.** Change `destinationContract: unknown` → `destinationContract: MongoContract` in `MongoMigrationRunner.execute(options)`. Update the `mongoTargetDescriptor.migrations.createRunner` wrapper in [`packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts`](../../packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts) and any test call sites.

7. **Add `strictVerification?: boolean` option.** Default `true`. Threaded into the `verifyMongoSchema(...)` call as `strict`. CLI-driven `migration apply` runs with the default; tests may opt out.

### Runner execution flow

8. **Insert the verify step into `MongoMigrationRunner.execute()`.** Position: after the operation loop completes successfully, before the marker CAS / ledger write block (currently lines 178–220). Logic:

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

   - Runs **only** when at least one operation was executed OR the marker did not already match the destination. (Matches the existing early-return at lines 184–189: when `operationsExecuted === 0` and the marker already matches, the runner short-circuits without writing — verification adds no value in that path. **Open question: should we still verify even on the short-circuit?** See [Open Questions](#open-questions).)
   - On `SCHEMA_VERIFY_FAILED`, neither `markerOps.updateMarker`/`initMarker` nor `markerOps.writeLedgerEntry` is called. The marker remains at its origin.

### Tests

9. **Unit tests for `verifyMongoSchema`.** Located alongside the new function (`packages/2-mongo-family/9-family/test/schema-verify.test.ts`). Cover: happy path (empty IR vs empty contract; matching IR), missing collection, missing index, extra index (strict=fail / non-strict=warn), validator missing/extra/mismatched, collection-options mismatched. Each case asserts both `ok` and the `meta`/`schema.issues` envelope.

10. **Integration tests for `MongoMigrationRunner` in the adapter package.** New file `packages/3-mongo-target/2-mongo-adapter/test/mongo-runner.schema-verify.test.ts` (or extend `mongo-runner.test.ts`) using `mongodb-memory-server`:
    - **Happy path:** runner applies operations → introspect + verify pass → marker and ledger written.
    - **Tampered DB (post-apply drift):** seed an out-of-band index/collection/validator that doesn't match the contract → `SCHEMA_VERIFY_FAILED` → marker still at origin (or absent), no ledger entry written. Re-running the migration after correcting the drift succeeds.
    - **Strict opt-out:** with `strictVerification: false`, an extra (out-of-band) index does not fail; the runner proceeds to write the marker/ledger.
    - **Failure surfaces issues in `meta`:** verify the failure's `meta.issues` matches `diffMongoSchemas`' `SchemaIssue[]`.

## Non-Functional Requirements

- **Single source of truth.** `db verify --schema-only` (CLI), `MongoFamilyInstance.schemaVerify` (control API), and `MongoMigrationRunner.execute()` (runner) all share the same pure `verifyMongoSchema` underneath. Changes to verification semantics happen in exactly one place.
- **No silent marker writes on drift.** A `SCHEMA_VERIFY_FAILED` failure must guarantee the marker and ledger are unchanged. This is the only honest signal to the next run that the migration did not complete.
- **Idempotent recovery.** Operations are idempotent (the runner already enforces this via post-check probes). Re-running a failed migration must execute zero operations on the second attempt (because they're already applied), then re-verify. If drift is persistent, the failure persists; if drift was a transient concurrent edit (or `strictVerification: false` is used), the next run can succeed.
- **Layering.** `verifyMongoSchema` lives in the `mongo` family domain (allowed: `mayImportFrom: ["framework"]`); the runner lives in the `targets` domain (allowed: `mayImportFrom: ["framework", "sql", "mongo"]`), so it can import the pure verifier. Confirmed against [`architecture.config.json`](../../architecture.config.json).
- **Performance.** Introspection runs once per `runner.execute()` call (one round-trip per collection for `listIndexes`/`listCollections`/`db.command({collMod:...})`-style metadata, already implemented in `introspectSchema`). No measurable impact on small/medium databases; large schemas pay the same cost they already pay for `db verify`.

## Non-goals

- **Hoisting verification into the framework SPI.** The Postgres runner and the new Mongo runner will continue to perform their own `family.introspect` + `verify*Schema` calls. A future project could promote this to a shared "post-apply verify" step in a framework-level base runner. Tracked as [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi).
- **Rolling back applied operations on drift.** Mongo lacks DDL transactions. Operations are idempotent; the recovery path is to re-run the migration after the operator investigates the drift. (Postgres can roll back its operations via the surrounding transaction; Mongo cannot.)
- **Verifying `db verify --marker-only` vs `--schema-only` semantics.** Out of scope; `db verify` already has its own coverage.
- **Changing how `MongoSchemaIR` is constructed from a contract.** `contractToMongoSchemaIR` is reused as-is.
- **New diagnostic shapes.** Reuses the existing `SchemaIssue` and `SchemaVerificationNode` types and the existing `diffMongoSchemas` output.

# Acceptance Criteria

### Pure verifier

- [ ] `verifyMongoSchema(options)` exists at `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts`, signature matches the spec, no DB I/O.
- [ ] `@prisma-next/family-mongo/schema-verify` export is published from `packages/2-mongo-family/9-family/package.json` and `src/exports/schema-verify.ts`.
- [ ] `MongoFamilyInstance.schemaVerify` delegates to `verifyMongoSchema` (no inline `diffMongoSchemas` call); existing `db verify --schema-only` behavior unchanged.
- [ ] Unit tests cover happy path + each drift kind (missing collection, missing index, extra index strict/non-strict, validator missing/extra/mismatched, collection-options mismatched). All pass.

### Runner integration

- [ ] `MongoRunnerDependencies` carries `introspectSchema: () => Promise<MongoSchemaIR>`.
- [ ] `createMongoRunnerDeps` wires `introspectSchema` against the same `Db` instance used for command/inspection execution.
- [ ] `MongoMigrationRunner.execute(options)` types `destinationContract: MongoContract`.
- [ ] `MongoMigrationRunner.execute(options)` accepts `strictVerification?: boolean` (default `true`).
- [ ] After the operation loop and before marker/ledger writes, the runner calls `introspectSchema` + `verifyMongoSchema` and returns `SCHEMA_VERIFY_FAILED` on `!ok`, with `meta.issues` populated.
- [ ] On `SCHEMA_VERIFY_FAILED`, the runner does not call `markerOps.updateMarker`, `markerOps.initMarker`, or `markerOps.writeLedgerEntry`.

### Integration tests

- [ ] Happy path: runner applies operations against `mongodb-memory-server`, verification passes, marker + ledger written.
- [ ] Tampered DB: out-of-band index/collection/validator drift causes `SCHEMA_VERIFY_FAILED`; marker stays at origin; ledger has no new entry; `meta.issues` is non-empty.
- [ ] Strict opt-out: `strictVerification: false` allows extra (out-of-band) indexes through without failing.
- [ ] Re-running the migration after a `SCHEMA_VERIFY_FAILED` (with the drift corrected) succeeds: zero operations executed, verification passes, marker + ledger written.

### CLI parity

- [ ] `prisma-next migration apply` against a Mongo target with a contract whose live schema drifts surfaces the same `SCHEMA_VERIFY_FAILED` envelope already surfaced for Postgres.

### Layering / build

- [ ] `pnpm lint:deps` passes (no new layer violations).
- [ ] `pnpm typecheck` passes for `@prisma-next/family-mongo`, `@prisma-next/target-mongo`, `@prisma-next/adapter-mongo`.
- [ ] `pnpm test:packages` passes including new unit + integration tests.

# Other Considerations

## Concurrency / drift between introspect and operation loop

The runner introspects the live DB **after** the operation loop has finished. If a third party mutates the database between the last operation and the introspection (or between the introspection and the marker write), drift could appear/disappear. Mitigation:

- The marker CAS check on update (`updateMarker(expectedFrom, ...)`) detects concurrent migration runs and fails with `MARKER_CAS_FAILURE`.
- Out-of-band schema mutations by an operator/DBA are exactly the failure mode `SCHEMA_VERIFY_FAILED` exists to surface — re-running with the operator's fix re-verifies.
- Postgres has a stronger guarantee here because of its surrounding transaction + advisory lock; Mongo cannot. The Mongo runner already accepts this trade-off in its existing design (no advisory locking, optimistic CAS on marker).

## CLI / observability

- The `SCHEMA_VERIFY_FAILED` failure flows through the existing CLI rendering path used by Postgres; no CLI changes are needed.
- Telemetry: no changes; the runner already emits operation start/complete callbacks. Verification is a single bounded operation that completes (or fails) atomically.

## Data protection / cost

Not applicable — this is internal migration plumbing with no user data handling, no external service calls beyond the existing MongoDB driver, and no measurable hosting cost change.

# References

- Linear issue: [TML-2285 — Mongo migration runner should verify resulting schema against destination contract](https://linear.app/prisma-company/issue/TML-2285/mongo-migration-runner-should-verify-resulting-schema-against)
- Migration system architecture: [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- Mongo subsystem: [`docs/architecture docs/subsystems/10. MongoDB Family.md`](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md)
- Companion project: [`projects/mongo-schema-migrations/`](../mongo-schema-migrations/) (the SPI + vertical-slice work; this project closes the post-apply-verify gap left by it)
- Reference implementation (Postgres): [`packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts):146-171
- Reference verifier (pure SQL): [`packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts`](../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)
- Existing Mongo introspection: [`packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts)
- Existing Mongo diff: [`packages/2-mongo-family/9-family/src/core/schema-diff.ts`](../../packages/2-mongo-family/9-family/src/core/schema-diff.ts)
- Existing family-level schemaVerify: [`packages/2-mongo-family/9-family/src/core/control-instance.ts`](../../packages/2-mongo-family/9-family/src/core/control-instance.ts):140-179
- Layering: [`architecture.config.json`](../../architecture.config.json)

# Open Questions

1. **Verify even when `operationsExecuted === 0` and marker already matches?** Today the Mongo runner short-circuits at lines 184–189 (and Postgres has analogous logic). If we add verification before this short-circuit, every `migration apply` call performs a full introspection — even when there's nothing to do. If we add it after, a contract whose marker already matches is trusted without re-checking the live DB.

   **Default assumption:** keep the short-circuit; verify only when operations were executed or the marker was advanced. This matches Postgres' behavior. Operators wanting a "verify the live DB regardless" entry point already have `db verify --schema-only`.

2. **Should `verifyMongoSchema` accept `unknown` and validate, or accept `MongoContract` and trust the caller?** Postgres' `verifySqlSchema` takes `Contract<SqlStorage>` (already validated). I've assumed the same Mongo design: `verifyMongoSchema` takes a validated `MongoContract`. The runner has one (after we tighten `destinationContract`); `MongoFamilyInstance.schemaVerify` validates inside before delegating.

   **Default assumption:** typed `MongoContract` input. Validation is the family instance's job.

3. **`OperationContext` parameter — keep or drop?** `verifySqlSchema` accepts an optional `context: OperationContext`, threaded into the result envelope. For Mongo, `MongoFamilyInstance.schemaVerify` doesn't currently use it.

   **Default assumption:** include it in `VerifyMongoSchemaOptions` as optional, ignored for now (forward compatibility).
