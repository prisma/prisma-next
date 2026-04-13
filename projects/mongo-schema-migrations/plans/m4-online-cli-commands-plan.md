# M4: Online CLI Commands + Live Introspection

## Summary

Wire MongoDB support for all CLI commands that interact with a live database: `db schema`, `db init`, `db update`, `db verify`, `db sign`, `migration status --db`, and `migration show`. The central enabler is live schema introspection — reading indexes, validators, and collection options from a running MongoDB instance and producing a `MongoSchemaIR`. Along the way, introduce decoupled "view interfaces" that let CLI commands consume family-produced views without family-specific imports, prototyping a pattern we'll later extract for SQL.

**Spec:** `projects/mongo-schema-migrations/spec.md` (Milestone 4)
**Linear:** [TML-2233](https://linear.app/prisma-company/issue/TML-2233)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Reviewer | Saevar | CLI generalization; migration system owner |

## Design principles (from shaping)

1. **CLI commands define view interfaces, not families.** Each command declares the shape of data it needs to render (e.g. `CoreSchemaView`, `OperationPreview`). Families produce those views. The CLI never imports family-specific types.

2. **SchemaIR stays opaque to the framework.** `ControlFamilyInstance.introspect()` returns `TSchemaIR` (generic parameter); only the family knows how to produce views from it.

3. **Prototype in Mongo, extract later.** We implement the view interfaces cleanly for Mongo. SQL's existing coupling (`PslPrintableSqlSchemaIR` import in `inspect-live-schema.ts`, `sql` field naming) is noted as tech debt but not refactored in this milestone.

4. **`OperationPreview` replaces `string[]`.** Instead of `extractOperationStatements` returning `string[]`, families produce structured `OperationPreview` objects containing statements with `text` and `language` metadata. This is richer and avoids the framework needing to know about DDL formats.

## Milestones

### Milestone 1: Live introspection + `db schema`

Implement the core capability (reading live MongoDB state) and prove it works through the simplest consumer (`db schema`).

**Tasks:**

- [ ] **4.1 Implement `introspectSchema` for Mongo.** Use `MongoInspectionExecutor` (already wired in `packages/3-mongo-target/2-mongo-adapter/src/core/command-executor.ts`) to execute `ListCollectionsCommand` and `ListIndexesCommand` against a live MongoDB. Map results to a `MongoSchemaIR` — symmetric to `contractToMongoSchemaIR`. Package placement: `packages/3-mongo-target/2-mongo-adapter/src/core/introspect-schema.ts`.

  *Tests:* Integration tests with `mongodb-memory-server`. Scenarios:
  - Empty database → empty `MongoSchemaIR`
  - Database with collections, indexes, validators, collection options → correct IR nodes
  - Round-trip: `contractToMongoSchemaIR` → apply via runner → `introspectSchema` → equivalent IR

- [ ] **4.2 Wire `introspect()` on `MongoControlFamilyInstance`.** Replace the `throw new Error('Mongo introspect is not implemented')` stub in `packages/2-mongo-family/9-family/src/core/control-instance.ts`. The implementation calls `introspectSchema` via the driver's `Db` handle, returning `MongoSchemaIR`.

  *Tests:* Unit test that the control instance delegates correctly.

- [ ] **4.3 Implement `toSchemaView` for Mongo.** Map `MongoSchemaIR` to a `CoreSchemaView` tree (the framework-level generic tree representation already used by SQL). Collections become top-level nodes; indexes, validators, and collection options become child nodes. Register the capability via `hasSchemaView` on the Mongo family instance.

  *Tests:* Unit tests: MongoSchemaIR with various node types → correct `CoreSchemaView` tree structure. Integration test: live DB → `introspect` → `toSchemaView` → tree contains expected nodes.

- [ ] **4.4 Generalize `inspect-live-schema.ts` for non-SQL families.** Currently imports `PslPrintableSqlSchemaIR` and calls `validatePrintableSqlSchemaIR`. Refactor so the SQL-specific validation is conditional on `familyId === 'sql'`. For Mongo (and other families), the result type uses `unknown` schema IR and relies on `toSchemaView()` for the tree view. The `InspectLiveSchemaResult.schema` type becomes `unknown` (was `PslPrintableSqlSchemaIR`).

  *Tests:* Existing SQL tests continue to pass. New unit test with a mock Mongo family instance.

- [ ] **4.5 Wire `db schema` end-to-end for Mongo.** Verify the full path: config loader → control client → `introspect()` → `toSchemaView()` → tree/JSON output.

  *Tests:* Integration test with `mongodb-memory-server`: create collections + indexes + validators → `db schema` → output contains expected elements (tree mode and `--json` mode).

### Milestone 2: `db verify` + `db sign`

Wire verification and signing, which depend on introspection + marker reads.

**Tasks:**

- [ ] **4.6 Implement `verify()` on `MongoControlFamilyInstance`.** Read the contract marker via `readMarker()` (already implemented). Compare `storageHash` and `profileHash` against the contract. Return `VerifyDatabaseResult` with appropriate codes (`PN-RUN-3001` marker missing, `PN-RUN-3002` hash mismatch, `PN-RUN-3003` target mismatch). No live introspection needed — this is marker-only verification.

  *Tests:* Unit tests: no marker → 3001, hash mismatch → 3002, match → ok. Integration test with `mongodb-memory-server`.

- [ ] **4.7 Implement `schemaVerify()` on `MongoControlFamilyInstance`.** Introspect the live schema → diff against `contractToMongoSchemaIR(contract)`. Produce `VerifyDatabaseSchemaResult` with `SchemaVerificationNode` tree. Support `strict` mode (extra elements = error). Reuse the planner's diffing logic where appropriate (the planner already knows how to compare `MongoSchemaIR` states).

  *Tests:* Unit tests: matching schema → ok, missing index → drift, extra index (strict) → drift. Integration tests with `mongodb-memory-server`.

- [ ] **4.8 Implement `sign()` on `MongoControlFamilyInstance`.** Verify the live schema satisfies the contract (delegate to `schemaVerify()`), then write/update the marker via `findOneAndUpdate` with CAS semantics (consistent with `readMarker` implementation). Return `SignDatabaseResult`.

  *Tests:* Unit tests: schema mismatch → fail, schema matches → marker written. Integration test: full flow on `mongodb-memory-server`.

- [ ] **4.9 Wire `db verify` end-to-end for Mongo.** The CLI command (`db-verify.ts`) is already family-agnostic — it delegates to `client.verify()` and `client.schemaVerify()`. This task validates the full path works: `--marker-only`, `--schema-only`, default (full), `--strict`. JSON and tree output.

  *Tests:* Integration tests with `mongodb-memory-server` covering all mode combinations.

- [ ] **4.10 Wire `db sign` end-to-end for Mongo.** The CLI command (`db-sign.ts`) delegates to `client.sign()`. Validate the full path.

  *Tests:* Integration test: sign after init → marker written, re-sign (no drift) → idempotent success.

### Milestone 3: `db init` + `db update`

Wire the migration-based commands that use introspection + planner + runner.

**Tasks:**

- [ ] **4.11 Define `OperationPreview` view interface.** A structured replacement for the `sql` field (currently `string[]`) in `MigrationCommandResult` and `MigrationShowResult`. The interface carries an array of `{ text: string; language: string }` statements, where `language` identifies the DDL dialect (e.g. `'sql'`, `'mongodb-shell'`). Define in framework-components or CLI types.

  *Tests:* Type-level tests for the interface shape.

- [ ] **4.12 Implement `extractOperationPreview` for Mongo.** A Mongo-specific function that maps `MigrationPlanOperation[]` to `OperationPreview` using the `MongoDdlCommandFormatter` visitor. Covers the full M2 DDL vocabulary: `createIndex`, `dropIndex`, `createCollection`, `dropCollection`, `collMod`. Produces MongoDB shell-style strings.

  *Tests:* Unit tests: operations with each command type → correct preview strings with `language: 'mongodb-shell'`.

- [ ] **4.13 Wire `extractOperationStatements` to dispatch to Mongo.** Update `extract-operation-statements.ts` to add a `'mongo'` case that calls `extractOperationPreview` and maps the result to `string[]` for backward compatibility with the existing `sql` field. (The structured `OperationPreview` replaces this field in a follow-up, but for now we maintain compatibility.)

  *Tests:* Unit test: Mongo operations → non-empty string array.

- [ ] **4.14 Wire `db init` for Mongo.** The `executeDbInit` function in `control-api/operations/db-init.ts` is already family-agnostic: it calls `familyInstance.introspect()`, `planner.plan()`, and `runner.execute()`. With `introspect()` implemented (4.2), this should work. Validate the full path: empty DB + contract → plan → apply → indexes/validators/collections created → marker written.

  *Tests:* Integration test with `mongodb-memory-server`: `db init` in plan mode → shows operations. `db init` in apply mode → database matches contract. `db init` when already at target → no-op.

- [ ] **4.15 Wire `db update` for Mongo.** The `executeDbUpdate` function in `control-api/operations/db-update.ts` is similarly family-agnostic. Validate: existing DB state → contract change → `db update` plans correct add/drop/modify operations. Support `--accept-data-loss` for destructive operations.

  *Tests:* Integration test with `mongodb-memory-server`: additive update (add index) → works without confirmation. Destructive update (drop index) → requires confirmation. Mixed operations → correct classification.

### Milestone 4: `migration status --db` + `migration show`

Wire the remaining migration commands.

**Tasks:**

- [ ] **4.16 Wire `migration status --db` for Mongo.** The offline `migration status` is family-agnostic (reads migration graph from disk). The `--db` flag adds live marker comparison. With `readMarker()` already implemented, this should work. Validate: applied vs pending display, edge case with no marker (fresh DB).

  *Tests:* Integration test with `mongodb-memory-server`: apply some migrations → `migration status --db` shows correct applied/pending state.

- [ ] **4.17 Wire `migration show` for Mongo.** The command reads migration packages from disk and calls `extractOperationStatements`. With 4.13 wired, Mongo operations render correctly. Validate: a saved Mongo migration package → `migration show` displays operations in MongoDB shell syntax.

  *Tests:* Unit test with a hand-crafted Mongo migration manifest → `migration show` output includes expected MongoDB shell commands.

### Close-out

- [ ] **4.18 Verify all M4 acceptance criteria.** Walk through each criterion in `projects/mongo-schema-migrations/spec.md` § Milestone 4 and confirm it passes.
- [ ] **4.19 Update architecture docs.** Update the MongoDB Family subsystem doc to cover live introspection and online CLI command support. Update CLI command docs if any behavior differs between families.
- [ ] **4.20 Document SQL coupling as tech debt.** Add an open item or follow-up issue for:
  - Removing `PslPrintableSqlSchemaIR` import from `inspect-live-schema.ts` (replace with the family-agnostic path introduced in 4.4)
  - Renaming `sql` field to `statements` (or `OperationPreview`) in `MigrationCommandResult` and `MigrationShowResult`
  - Extracting `OperationPreview` to a framework-level abstraction

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| Live schema introspection reads indexes, validators, collection options | Integration | 4.1 | `mongodb-memory-server` |
| `introspectSchema` produces `MongoSchemaIR` from live state | Integration | 4.1 | Round-trip symmetry with `contractToMongoSchemaIR` |
| `db init` works with Mongo (additive-only bootstrap) | Integration | 4.14 | Plan + apply modes |
| `db update` works with Mongo (reconcile, interactive destructive) | Integration | 4.15 | Additive, destructive, and mixed operations |
| `db verify` works with Mongo (`--marker-only`, `--schema-only`, `--strict`) | Integration | 4.9 | All mode combinations |
| `db sign` works with Mongo (verify + write marker) | Integration | 4.10 | Full sign flow |
| `db schema` works with Mongo (tree + `--json` output) | Integration | 4.5 | Both output formats |
| `migration status --db` works with Mongo (applied vs pending) | Integration | 4.16 | Live marker comparison |
| `migration show` renders Mongo operations readably | Unit | 4.17 | MongoDB shell syntax |

## Dependencies

| Dependency | Status | Impact |
|---|---|---|
| M1 (SPI + vertical slice) | In progress (1.9–1.13 remain) | Must complete runner + marker + target wiring before M4 can fully integrate. 4.1 (introspection) can start independently. |
| M2 (full vocabulary) | Implemented on base branch | Schema IR, planner, DDL commands, contract types — all available |
| M3 (polymorphic indexes) | Not started | Independent of M4. Polymorphic indexes will benefit from live introspection but don't block it. |

## Open Items

- **M1 completion.** Tasks 1.9–1.13 (runner, marker, target wiring, end-to-end proof, demo) must land before `db init` / `db update` / `db sign` can work end-to-end. Live introspection (4.1–4.3) and `db schema` (4.4–4.5) can proceed independently.
- **`OperationPreview` scope.** Introduced for Mongo in 4.11–4.12 but the SQL side continues using `extractSqlDdl → string[]`. Full migration to `OperationPreview` across both families is a follow-up.
- **`contract infer` for Mongo.** Out of scope per spec. Would require Mongo-to-PSL reverse mapping.
- **`inspect-live-schema.ts` SQL coupling.** Task 4.4 introduces a conditional path but doesn't fully remove the SQL import (that's tech debt documented in 4.20).
