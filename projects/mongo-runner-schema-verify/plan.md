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

- [ ] **1.14 Run the full validation gate suite.** Run `pnpm lint:deps`, `pnpm lint`, `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:examples`. Fix any layering / lint / type / test failures introduced by the change. Refresh `dist/*.d.mts` for `@prisma-next/family-mongo` (touched exports) and `@prisma-next/target-mongo` (touched runner options) via `pnpm build`. _Gate expanded twice during the loop: R1 added `test:integration` + `test:examples` after surfacing two correctness regressions invisible to `test:packages` alone; R3 added `pnpm lint` after surfacing a biome lint failure invisible to the other gates. See `orchestrator-notes.md` § "Validation-gate gap surfaced" and § "Lint gate gap surfaced (R3)"._

- [ ] **1.15 Update package READMEs / DEVELOPING.md if necessary.** If the `@prisma-next/family-mongo` README documents exported entry points, add `./schema-verify`. Otherwise skip — no user-facing surface change.

### Follow-ups

- [x] **1.16 File a Linear follow-up for hoisting `family.introspect + verify` into a framework-shared runner SPI.** Filed as [TML-2319](https://linear.app/prisma-company/issue/TML-2319/hoist-post-apply-schema-verify-into-framework-runner-spi). Out of scope here.

### Round 2: correctness fixes (added 2026-04-26 after R1)

R1 reviewer surfaced two `must-fix` correctness findings invisible to the original validation gates. Both are in scope for this PR (see [`orchestrator-notes.md`](orchestrator-notes.md) for the F2 scope decision). The implementer addresses these alongside re-running the expanded gates from 1.14.

- [ ] **1.17 Fix F1: synthetic-contract test fixtures crash the verifier.** The fixture sites that pass `{}` (or otherwise unstructured stand-ins) as `destinationContract` cause `contractToMongoSchemaIR` ([`packages/3-mongo-target/1-mongo-target/src/core/contract-to-schema.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/contract-to-schema.ts)) to read `contract.storage.collections` and `TypeError` before the `strictVerification: false` flag is consulted. Make those fixtures pass a minimally well-formed `MongoContract` shape — `{ storage: { storageHash: 'sha256:authoring-test', collections: {} } } as unknown as MongoContract` — at the three known sites the reviewer reproduced:
   - `test/integration/test/mongo/migration-authoring-e2e.test.ts`
   - `examples/mongo-demo/test/manual-migration.test.ts`
   - `examples/retail-store/test/manual-migration.test.ts`
   
   Each cast must carry an inline justification comment per AGENTS.md § Typesafety. Add a unit-level regression test in `packages/3-mongo-target/1-mongo-target/test/schema-verify.test.ts` that exercises `verifyMongoSchema` with `strict: false` and a contract whose `storage.collections` is empty `{}` — must succeed without throwing. Prefer this concrete-paths-from-the-reviewer order; if there are additional fixtures `rg 'destinationContract' test/ examples/` surfaces, fix them too.

- [ ] **1.18 Fix F2: canonicalization asymmetry between contract IR and introspected schema.** Five Mongo feature families round-trip non-deterministically because `contractToMongoSchemaIR` and `introspectSchema` disagree on the canonical IR shape for server-applied defaults. Without this fix, a fresh `migration apply` immediately fails `SCHEMA_VERIFY_FAILED` for any contract that uses these features, inverting spec [R1](spec.md#requirements). Normalize the introspected output (preferred over enriching the contract IR) in [`packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts) — or via a co-located normalizer module if cleaner — to:
   1. **Text indexes** — project the introspected key shape (server expands `{ field: 'text' }` to `_fts/_ftsx` weighted vectors) back to the contract-side `{ field: 'text' }` form.
   2. **Collation** — drop server-only collation fields (`version`, `caseFirst: 'off'`, etc.) that the contract does not declare.
   3. **Timeseries** — drop `bucketMaxSpanSeconds` (server-applied derived value) when the contract does not declare it.
   4. **Clustered indexes** — drop `key` / `unique` / `v` from the introspected clusteredIndex spec when the contract specifies only `unique` semantics.
   5. **`changeStreamPreAndPostImages`** — treat introspected `{ enabled: false }` as equivalent to `undefined`/absent on the contract side.
   
   Add regression coverage in `packages/3-mongo-target/1-mongo-target/test/schema-verify.test.ts` (or a focused canonicalization-test file) for each feature family — feed an introspection-shaped IR and a contract-shaped IR that should match post-normalization, assert `verifyMongoSchema` returns `ok`. Then re-run T1.11–T1.13 integration tests + `pnpm test:integration` + `pnpm test:examples` to confirm the affected fixtures now pass.

### Round 4: lint hygiene (added 2026-04-26 after R3)

R3 reviewer surfaced one `should-fix` finding when triaging the implementer's biome-warning observation. The plan's T1.14 gates were missing `pnpm lint`; with that gate now added, F4 must close before SATISFIED.

- [ ] **1.19 Fix F4: pre-existing biome `noNonNullAssertion` in `sortTextKeys` fails `pnpm lint`.** The R2 commit (`85df12f2a`) introduced a `sortedText[textIdx++]!` non-null assertion in `sortTextKeys` at [`packages/3-mongo-target/1-mongo-target/src/core/schema-verify/canonicalize-introspection.ts:145`](../../packages/3-mongo-target/1-mongo-target/src/core/schema-verify/canonicalize-introspection.ts) (lines may have shifted slightly post-R3 cleanup). The package-level `lint` task runs `biome check . --error-on-warnings`, so this currently exits non-zero under `pnpm lint` / `pnpm --filter @prisma-next/target-mongo lint`. AGENTS.md § Typesafety prohibits suppressing biome lints. Refactor to remove the non-null assertion: replace the post-increment-with-`!` pattern with an explicit early-throw guard (or equivalent algorithmic restructure inside `sortTextKeys`). The exact patch is suggested in [`reviews/code-review.md` § F4](reviews/code-review.md). The 11 baseline + 13 F2-regression cases in `schema-verify.test.ts` must remain green after the refactor (functionally equivalent inside the established invariant). Validation: `pnpm --filter @prisma-next/target-mongo lint` exits 0 with zero diagnostics, and the full T1.14 suite (now including `pnpm lint`) passes.

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
| `pnpm lint:deps`, `pnpm lint`, `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:examples` pass | CI | 1.14 | Expanded R1 + R3 |
| Synthetic-contract test fixtures opt-out of verification cleanly (no `TypeError`) | Unit + Integration | 1.17 | F1 from R1 |
| Real-contract round-trip canonicalization for text / collation / timeseries / clusteredIndex / `changeStreamPreAndPostImages` | Unit + Integration | 1.18 | F2 from R1 |
| `pnpm lint` (biome `--error-on-warnings`) green on `target-mongo` | CI | 1.19 | F4 from R3 |

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
