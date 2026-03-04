# PSL contract parity missing behaviors — Plan

## Summary

Close the parity gaps encountered when using PSL (`@prisma-next/sql-contract-psl/provider`) as the contract source for `examples/prisma-next-demo`. Success looks like PSL-emitted contracts including required `extensionPacks` + `capabilities`, `dbInit` succeeding for pgvector `vector(N)` columns authored via named types, and Prisma-style FK naming via `@relation(..., map: "...")` being supported — all enforced by CI regression tests.

**Spec:** `projects/psl-contract-authoring/specs/psl-contract-parity-missing-behaviors.spec.md`

## Collaborators


| Role         | Person/Team                | Context                                                             |
| ------------ | -------------------------- | ------------------------------------------------------------------- |
| Maker        | William Madden             | Drives implementation + test coverage                               |
| Reviewer     | SQL/PSL authoring reviewer | Contract-psl interpreter/provider + migration planner changes       |
| Collaborator | Postgres migrations owner  | Validate DDL rendering expectations + extension dependency behavior |
| Collaborator | CLI/emitter owner          | Validate how config wiring supplies pack metadata/capabilities      |


## Milestones

### Milestone 1: Repro harness + regression tests (before fixes)

Establish test coverage that fails on the current behavior (or captures the exact failure modes) so we can prove fixes and prevent regressions.

**Tasks:**

- Add a fixture that uses a **pgvector named type** (e.g. `Embedding1536 = Bytes @pgvector.column(length: 1536)`) and emits a contract via PSL provider.
- Add an end-to-end test that runs **PSL provider → emitted artifacts → dbInit** and asserts it succeeds for a schema containing `vector(N)` (previously failed with `type "vector(1536)" does not exist`).
- Add a regression assertion that PSL-emitted contracts include **non-empty `extensionPacks`** when composed packs are configured.
- Add a regression assertion that PSL-emitted contracts include the required `**capabilities.postgres**` entries to enable pgvector cosine operations (and any other required demo capabilities, enumerated explicitly).
- Add a fixture/test for Prisma relation FK naming: `@relation(..., map: "post_userId_fkey")`, asserting interpretation succeeds and the FK name is recorded in contract storage.
- Add a demo-level end-to-end test that proves the **demo passes in both modes** (TS-authored contract source and PSL-authored contract source). This can be implemented as:
  - two `prisma-next.config.*.ts` files (ts vs psl), or
  - a single config file with an explicit toggle,
  and a test runner that executes the demo test suite against each mode.

### Milestone 2: Fix pgvector `vector(N)` contract shape / DDL rendering

Make PSL-emitted contracts render valid Postgres DDL for parameterized vector types without app-level post-processing.

**Tasks:**

- Decide the contract representation for “parameterized type via named type”:
  - prefer: preserve typing affordances while enabling planner rendering (e.g. column has `nativeType: "vector"` + `typeParams.length`, and keeps/doesn’t keep `typeRef` depending on planner semantics).
- Implement the chosen representation in the PSL interpreter (`@prisma-next/sql-contract-psl`) for:
  - named type declarations using `@pgvector.column(length: N)`
  - columns that reference those named types
- Update Postgres migration planning/rendering if needed so parameterized native types expand correctly even when a `typeRef` exists (and do not become quoted identifiers like `"vector(1536)"`).
- Ensure extension dependency (`CREATE EXTENSION IF NOT EXISTS vector`) is planned/applied as appropriate when vector columns exist (verify `dbInit` passes on a fresh database).

### Milestone 3: Emit framework metadata for PSL: `extensionPacks` + `capabilities`

Ensure PSL-emitted contracts are “complete” for downstream runtime behavior and tooling, without requiring consumer-side enrichment.

**Tasks:**

- Decide the source of truth and merge rules for capabilities/pack metadata:
  - derived from target + composed extension packs vs explicit config vs merged.
- Implement `extensionPacks` emission for composed packs (pgvector as the first target) so `contract.extensionPacks.pgvector` matches pack metadata.
- Implement `capabilities` emission so `contract.capabilities.postgres` includes pgvector cosine capability (and other required entries per spec).
- Add/adjust tests to ensure the metadata is present and stable/deterministic.
- Update any snapshots/fixtures impacted by adding metadata (hash changes are expected; capture them intentionally).

### Milestone 4: Support `@relation(..., map: "...")` for FK naming

Support Prisma-style relation constraint naming in PSL and propagate the name through contract storage and migrations/verify.

**Tasks:**

- Update PSL interpreter to accept `map` on FK-side `@relation` and write it into the emitted FK metadata (e.g. `storage.tables.<table>.foreignKeys[].name`).
- Ensure the migration planner/runner uses the FK name when generating `ALTER TABLE ... ADD CONSTRAINT <name> FOREIGN KEY ...` (or equivalent).
- Add/extend introspection assertions (where available) to validate the FK is created with the expected name.

### Milestone 5: Close-out for this slice

Verify all acceptance criteria are met via tests and remove any temporary workarounds introduced during debugging.

**Tasks:**

- Confirm each spec acceptance criterion has a test mapping (see table below) and passes in CI.
- Ensure docs/spec references are accurate (no repo-wide links into `projects/` outside of the project itself).
- (If needed) file follow-ups for any open questions not resolved by this slice.

## Test Coverage


| Acceptance Criterion                                          | Test Type              | Task/Milestone  | Notes                                                                                  |
| ------------------------------------------------------------- | ---------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `extensionPacks` emitted for composed pgvector                | Integration / snapshot | Milestone 1 + 3 | Assert `contract.extensionPacks.pgvector` exists and matches pack meta shape           |
| `capabilities.postgres` emitted (incl. `pgvector/cosine`)     | Integration / snapshot | Milestone 1 + 3 | Enumerate required keys explicitly in assertions                                       |
| `dbInit` succeeds for PSL `vector(N)`                         | E2E / integration      | Milestone 1 + 2 | Must cover prior failure mode `type "vector(1536)" does not exist`                     |
| Vector contract shape compatible with migrations              | Unit + integration     | Milestone 2     | Assert planner renders `vector(1536)` unquoted; no `"vector(1536)"`                    |
| `@relation(..., map: "...")` supported and FK name propagated | Integration            | Milestone 1 + 4 | Assert interpretation success + FK name in contract storage; introspect DB if feasible |
| Demo can switch between TS/PSL and still pass                 | E2E (demo)             | Milestone 1 + 5 | Run the demo’s test suite twice: once per contract source mode                         |
| No regression                                                 | Suite                  | Milestone 5     | Existing contract-psl and postgres migration tests still pass                          |


## Open Items

- Hash/rollout strategy for newly populated `capabilities`/`extensionPacks` in PSL-emitted contracts (update fixtures intentionally).
- Decide whether planner must support parameterized rendering with `typeRef` present, or whether interpreter should avoid emitting `typeRef` for parameterized aliases.
- Confirm which Postgres capabilities the demo truly requires vs what can be derived automatically.

