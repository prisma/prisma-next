# Summary

The Mongo migration runner currently applies operations and writes the marker without verifying that the resulting schema matches the destination contract. This is a parity gap with the Postgres runner and a hole in a core migration-system guarantee: a successful `migration apply` should be the runner's promise that the live database satisfies the contract.

This project closes the gap.

**Linear issue:** [TML-2285](https://linear.app/prisma-company/issue/TML-2285/mongo-migration-runner-should-verify-resulting-schema-against)

# Decision

`MongoMigrationRunner.execute()` performs **post-apply schema verification** inside the same call, between the operation loop and the marker/ledger write. On drift, it returns `SCHEMA_VERIFY_FAILED` with structured `meta.issues` and the marker stays at its origin. The verifier is extracted as a pure function and shared with `prisma-next db verify --schema-only` so the two surfaces agree on "matches the contract" by construction.

The new shape of `execute()`:

```typescript
async execute(options: MongoMigrationRunnerExecuteOptions): Promise<RunnerResult> {
  // (1) Read marker, plan operations, run pre-checks.
  // (2) Operation loop: apply each operation, run post-checks.

  if (operationsExecuted === 0 && markerMatches) {
    return runnerSuccess({ ... });   // unchanged short-circuit
  }

  // ───── NEW: post-apply schema verification ─────
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
  // ───────────────────────────────────────────────

  // (3) Marker CAS + ledger write.
}
```

## Where each piece lives

| Piece | File / package | Status |
|---|---|---|
| Pure verifier `verifyMongoSchema` | `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts`; exported via `@prisma-next/family-mongo/schema-verify` | New |
| `MongoFamilyInstance.schemaVerify` | `packages/2-mongo-family/9-family/src/core/control-instance.ts` | Refactored to delegate to the pure verifier |
| `MongoRunnerDependencies.introspectSchema` callback | `packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts` | New |
| Wiring (composes `family.introspect`) | `packages/3-mongo-target/2-mongo-adapter/src/core/runner-deps.ts` | Updated |
| `MongoMigrationRunnerExecuteOptions.destinationContract` | Same file as the runner | Tightened from `unknown` to `MongoContract` |
| `MongoMigrationRunnerExecuteOptions.strictVerification` | Same file as the runner | New, defaults to `true` |
| Verify step inside `execute()` | Same file as the runner | New, between operation loop and marker write |

## Why this shape (composition layering)

`migration apply` is a compound domain action with a single audit/intent boundary at the runner's outer entry. The runner therefore **composes framework primitives** — `family.introspect` and `verifyMongoSchema` — rather than calling the peer action `family.schemaVerify`. See [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md) for the full layering principle.

This is also why `MongoFamilyInstance.schemaVerify` is refactored, not just left alone: extracting `verifyMongoSchema` as a primitive means *both* the family-instance action and the runner compose the same canonical implementation. `db verify --schema-only` and `migration apply` agree on "matches the contract" by construction, not convention.

The runner stays decoupled from `mongodb` itself per [ADR 198](../../docs/architecture%20docs/adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md): `introspectSchema` is a deps callback. The wiring layer (`createMongoRunnerDeps`) implements it as `() => family.introspect({ driver })`, so the system composes the framework SPI primitive at the wiring boundary, not the adapter helper.

# Requirements

The design must satisfy these user-visible properties.

| # | Requirement | How the design satisfies it |
|---|---|---|
| R1 | A successful `migration apply` against MongoDB guarantees the live schema satisfies the destination contract. | The verify step runs before the marker/ledger write; the marker only advances when verification passes. |
| R2 | On schema drift, `migration apply` fails honestly. | Returns `SCHEMA_VERIFY_FAILED` with `meta.issues` populated *before* `markerOps.updateMarker` / `initMarker` / `writeLedgerEntry` is called. Marker stays at origin; ledger has no new entry. |
| R3 | The recovery path is "fix the drift, re-run." | Operations are already idempotent (post-check probes enforce this). A second run executes zero operations and re-runs verification. Persistent drift → persistent failure; transient drift → success on retry. |
| R4 | `db verify --schema-only` and `migration apply` agree on what "matches the contract" means. | Both compose the same pure `verifyMongoSchema`. `MongoFamilyInstance.schemaVerify` is refactored to delegate to it; the runner imports it directly. Behavioral drift between the two surfaces is impossible by construction. |
| R5 | Verification is opt-out for tests and lenient tooling. | New runner option `strictVerification?: boolean` (default `true`) is threaded into `verifyMongoSchema(strict: ...)`, matching the existing `diffMongoSchemas(... , strict)` semantics: non-strict mode treats out-of-band structure (e.g., extra indexes) as warnings rather than failures. |
| R6 | The runner is type-safe about the contract it verifies against. | `MongoMigrationRunnerExecuteOptions.destinationContract` is tightened from `unknown` to `MongoContract`, matching the Postgres pattern. The descriptor wrapper and tests are updated to pass typed contracts. |
| R7 | The runner remains decoupled from `mongodb` driver internals. | `introspectSchema` is added as a deps callback per [ADR 198](../../docs/architecture%20docs/adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md). The runner has no `mongodb` import; the wiring layer composes `family.introspect({ driver })`. |
| R8 | The runner does not call peer domain actions. | Per [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md), the runner composes primitives (`family.introspect`, `verifyMongoSchema`) rather than calling the peer action `family.schemaVerify`. |

# Acceptance Criteria

## Pure verifier

- [ ] `verifyMongoSchema(options): VerifyDatabaseSchemaResult` exists at `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts`. No DB I/O.
- [ ] Signature accepts `{ contract: MongoContract, schema: MongoSchemaIR, strict: boolean, context?: OperationContext, frameworkComponents }`.
- [ ] Exported via `@prisma-next/family-mongo/schema-verify` (new entry in `package.json`).
- [ ] `MongoFamilyInstance.schemaVerify` delegates to `verifyMongoSchema` (no inline `diffMongoSchemas` call). Existing `db verify --schema-only` behavior unchanged.
- [ ] Unit tests cover happy path (empty + matching) and each drift kind: missing collection, missing index, extra index (strict + non-strict), validator missing/extra/mismatched, collection-options mismatched. All pass.

## Runner integration

- [ ] `MongoRunnerDependencies` carries `readonly introspectSchema: () => Promise<MongoSchemaIR>`.
- [ ] `createMongoRunnerDeps(driver, family)` wires `introspectSchema` as `() => family.introspect({ driver })`.
- [ ] `MongoMigrationRunnerExecuteOptions.destinationContract` has type `MongoContract` (not `unknown`).
- [ ] `MongoMigrationRunnerExecuteOptions.strictVerification` is `boolean | undefined` with default `true` at the call site.
- [ ] After the operation loop and before marker/ledger writes, `execute()` calls `introspectSchema()` then `verifyMongoSchema()` and returns `SCHEMA_VERIFY_FAILED` on `!ok` (with `meta.issues` populated).
- [ ] On `SCHEMA_VERIFY_FAILED`, `execute()` does not call `markerOps.updateMarker`, `markerOps.initMarker`, or `markerOps.writeLedgerEntry`.

## Integration tests (against `mongodb-memory-server`)

- [ ] **Happy path:** runner applies operations → verification passes → marker + ledger written.
- [ ] **Tampered DB:** out-of-band index/collection/validator drift → `SCHEMA_VERIFY_FAILED`, `meta.issues` non-empty, marker at origin, no ledger entry.
- [ ] **Recovery:** after fixing the drift, re-running succeeds with zero operations executed and verification passing.
- [ ] **Strict opt-out:** `strictVerification: false` lets an extra (out-of-band) index through; runner proceeds to write marker + ledger.

## CLI parity

- [ ] `prisma-next migration apply` against a Mongo target with drift surfaces the same `SCHEMA_VERIFY_FAILED` envelope already surfaced for Postgres (no Mongo-specific CLI rendering path).

## Build / layering

- [ ] `pnpm lint:deps`, `pnpm typecheck`, `pnpm test:packages` all pass.

# Constraints

- **Mongo cannot roll back applied operations.** No DDL transactions. On `SCHEMA_VERIFY_FAILED` the database may have advanced past its origin state; only the marker has not. Recovery is explicit: investigate the drift, correct it (or fix the contract / migration), re-run.
- **Verification cost is one introspection round per `migration apply`** that does work. Same shape as the existing `db verify --schema-only` introspection. Negligible on small/medium DBs; large schemas pay the same cost they already pay there.
- **Postgres has a stronger concurrency guarantee than Mongo** because of its surrounding transaction + advisory lock. The Mongo runner already accepts weaker concurrency semantics (no advisory locking, optimistic CAS on marker). Out-of-band schema mutations between operation execution and verification are exactly the failure mode `SCHEMA_VERIFY_FAILED` exists to surface — the next run re-verifies after the operator fixes the drift.

# Decisions made during shaping

These were debated; defaults are committed. Each can be revisited at review with a localized code change.

1. **Skip verification on the no-op short-circuit.** When `operationsExecuted === 0` and the marker already matches, the runner returns success without verifying. Matches Postgres. Operators wanting "verify the live DB regardless" run `db verify --schema-only` — that's what it's for.
2. **`verifyMongoSchema` accepts `MongoContract`, not `unknown`.** Validation is the family instance's job (`MongoFamilyInstance.schemaVerify` validates before delegating). The runner already has a typed `MongoContract` after R6.
3. **`OperationContext` is included in `VerifyMongoSchemaOptions` for symmetry with `verifySqlSchema`.** Threaded into the result envelope; not used by any logic yet. Keeping it now avoids a future signature change for telemetry/tracing.
4. **No framework-level hoisting yet.** Both runners continue to perform their own `family.introspect + verify*Schema` calls. Promotion to a shared base runner / framework SPI is out of scope, tracked as [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi).

# Alternatives considered

- **Call `family.schemaVerify` from inside the runner.** Rejected. `migration apply` is a compound domain action with one audit/intent boundary; calling a peer domain action mid-flow doublecounts the user intent at every cross-cutting concern (analytics, audit, distributed tracing, CLI metadata). See [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md).
- **Inline `diffMongoSchemas` in the runner without extracting a pure verifier.** Rejected. The diff logic is already invoked by `MongoFamilyInstance.schemaVerify`; inlining a second copy in the runner means R4 (single source of truth between `db verify --schema-only` and `migration apply`) holds by convention, not construction. Extracting `verifyMongoSchema` once and composing it from both surfaces makes drift impossible.
- **Wire `introspectSchema` directly to the adapter helper `introspectSchema(db)`.** Rejected. The adapter helper is an implementation detail of `family.introspect`. Composing the framework primitive at the wiring boundary keeps the system composing the SPI all the way down, which is what makes future hoisting (TML-2319) a mechanical refactor rather than an interface redesign.
- **Verify even on the no-op short-circuit.** Rejected as the default. Pays an introspection round-trip on every `migration apply` regardless of whether anything changed; doesn't match Postgres; and `db verify --schema-only` already exists for the explicit "check the live DB regardless of marker state" entry point. The change is small (~3 lines) if a future review prefers the opposite default.
- **Hoist `family.introspect + verify` into a framework-level base runner now.** Deferred to [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi). The hoist makes more sense once two families have implemented the same pattern; doing it preemptively risks the wrong abstraction.
- **Roll back applied operations on drift.** Not possible on MongoDB (no DDL transactions). Postgres can rely on its surrounding transaction; Mongo cannot. The recovery path is idempotent re-run.

# References

- Linear: [TML-2285](https://linear.app/prisma-company/issue/TML-2285/mongo-migration-runner-should-verify-resulting-schema-against)
- Migration system architecture: [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- Mongo subsystem: [`docs/architecture docs/subsystems/10. MongoDB Family.md`](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md)
- ADR 204 (actions vs primitives): [`docs/architecture docs/adrs/ADR 204 - Domain actions vs composable primitives in the control plane.md`](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md)
- ADR 198 (runner ↔ driver decoupling): [`docs/architecture docs/adrs/ADR 198 - Runner decoupled from driver via visitor SPIs.md`](../../docs/architecture%20docs/adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md)
- Reference implementation (Postgres): [`packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts):146-171
- Reference verifier (pure SQL): [`packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts`](../../packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts)
- Existing Mongo introspection: [`packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts)
- Existing Mongo diff: [`packages/2-mongo-family/9-family/src/core/schema-diff.ts`](../../packages/2-mongo-family/9-family/src/core/schema-diff.ts)
- Existing family-level `schemaVerify`: [`packages/2-mongo-family/9-family/src/core/control-instance.ts`](../../packages/2-mongo-family/9-family/src/core/control-instance.ts):140-179
- Companion project: [`projects/mongo-schema-migrations/`](../mongo-schema-migrations/) (the SPI + vertical-slice work; this project closes the post-apply-verify gap left by it)
- Layering: [`architecture.config.json`](../../architecture.config.json)
