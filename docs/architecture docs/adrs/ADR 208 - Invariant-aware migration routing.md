# ADR 208 — Invariant-aware migration routing

## Context

Graph-based migrations route between contract hashes as edges ([ADR 001 — Migrations as Edges](./ADR%20001%20-%20Migrations%20as%20Edges.md)). Two databases can share the same structural hash while differing in data state ([ADR 176 — Data migrations as invariant-guarded transitions](./ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)). The CLI must pick a **shortest** path whose edges **cover** ref-declared invariant ids, persist which invariants have **ever** been applied on the marker, and surface structured outcomes when routing cannot satisfy the ref.

## Problem

We need durable decisions for: (1) how data-transform **identity** splits between display/retry and routing; (2) what the marker’s `invariants` field **means** relative to data-transform `check`; (3) how merges stay **atomic** per storage family; (4) how **ref-driven applies** stay idempotent; (5) how the pathfinder exposes **unreachable vs unsatisfiable** without CLI-side BFS duplication; (6) how **`providedInvariants`** flows from attested manifests into runners (vs a parallel runner option channel).

## Decision

### D4 — Split identity on `DataTransformOperation`

- **`name`** stays the human-facing and retry/ledger-facing label (display, logs, duplicate-run identity as today).
- **`invariantId?: string`** is optional; when set, the transform is **routing-visible** — refs may require that id. When unset, the transform is path-dependent and not referenceable from refs.
- Renaming **`name`** does not break routing; renaming **`invariantId`** is a deliberate, reviewable act with a clear blast radius.

### Marker semantics — applied-at-least-once, not “currently true”

`ContractMarkerRecord.invariants` is **set-semantic** and **monotonic**: on every successful apply that updates the marker, the storage layer **unions** newly provided ids into the existing set; it **never shrinks** on rollback or re-run. **Two authorities:** the data transform’s **`check`** answers “does the data satisfy X *right now*?”; **`marker.invariants`** answers “has a migration that provides X been **successfully applied at least once** (history)?” — not the same claim.

### Server-side merge for invariants

- **Postgres** — marker UPDATE sets `invariants` with a **single self-referential** expression (reads current row under the update lock, unions, dedupes, sorts):

```sql
invariants = array(select distinct unnest(invariants || $8::text[]) order by 1)
```

(Source: `packages/3-targets/3-targets/postgres/src/core/migrations/statement-builders.ts` — `buildMergeMarkerStatements`.)

- **MongoDB** — `updateMarker` uses an **aggregation pipeline** with `$setUnion` and `$sortArray` when `destination.invariants` is supplied; omitting `invariants` leaves the field untouched. (Source: `packages/3-mongo-target/1-mongo-target/src/core/marker-ledger.ts`.)

- **SQLite** — no native text array merge in SQL; the runner merges **inside** `BEGIN EXCLUSIVE` together with marker read/write paths (same transaction as the migration), documented inline on the SQLite runner. (Source: `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts`.)

No client-side **compare-and-set loop** on `invariants`; atomicity is at the statement / document / exclusive transaction boundary.

### CLI marker subtraction (idempotent `--ref`)

`migration apply --ref` computes:

`effectiveRequired = ref.invariants \ marker.invariants`

(set difference after `readMarker`). That single subtraction makes **second applies** with the same ref **omit** satisfied invariants. Combined with `findPathWithInvariants(..., ∅)` ≡ structural `findPath` (`migration-graph.ts` in `@prisma-next/migration-tools`), a re-apply with an empty effective required set matches **structural** routing behavior.

### Discriminated `FindPathOutcome`

`findPathWithDecision` returns:

| `kind` | Meaning |
|--------|---------|
| `ok` | Path exists covering `required`; `decision` holds selection metadata. |
| `unreachable` | No structural path `from → to`. |
| `unsatisfiable` | Structurally reachable but no path covers every required invariant; includes `structuralPath` (= `findPath(from,to)`) and `missing` (⊆ `required` not covered on that fallback). |

The pathfinder **owns** the structural fallback BFS for the unsatisfiable case; callers use `outcome.missing` and `outcome.structuralPath` directly (e.g. `MIGRATION.NO_INVARIANT_PATH`). No second structural BFS in the CLI beyond this API.

(Source: `FindPathOutcome` in `packages/1-framework/3-tooling/migration/src/migration-graph.ts`.)

### Plan envelope carries `providedInvariants`; runners do not re-derive

**Implemented decision:** the canonical manifest value flows through the control-api boundary on `MigrationApplyStep.providedInvariants` and onward via `MigrationPlan.providedInvariants?`; each target runner reads `options.plan.providedInvariants ?? []` for marker writes and self-edge no-op detection. **Why:** single source of truth aligned with the manifest (`migration verify` re-derives `providedInvariants` from ops at load time and rejects manifest mismatch — `MIGRATION.PROVIDED_INVARIANTS_MISMATCH`), removing both the spec's earlier `SqlMigrationRunnerExecuteOptions.invariants?` caller channel and the redundant runner-side `deriveProvidedInvariants(plan.operations)` call. Earlier spec text proposing either pattern is **obsolete-by-design**.

### Status diagnostic: `MIGRATION.INVARIANTS_PENDING`

When the marker’s structural hash matches the **ref target** but **required invariants remain** (`effectiveRequired` non-empty after subtracting marker invariants / path decision semantics), **`migration status --ref`** emits an **`severity: 'info'`** diagnostic with code **`MIGRATION.INVARIANTS_PENDING`** so the UX does not claim “up to date” while invariant work remains. (Source: `packages/1-framework/3-tooling/cli/src/commands/migration-status.ts`; integration Journey T — `test/integration/test/cli-journeys/invariant-routing.e2e.test.ts`.)

### Relation to ADR 001 self-edges

Data-op-gated **`from === to`** self-edges, pathfinder covering behavior vs structural **`findPath`**, and runner **upfront skip** / **post-hoc no-op skip** semantics are documented in [ADR 001](./ADR%20001%20-%20Migrations%20as%20Edges.md).

## Verification

Coverage audit for invariant-aware routing acceptance criteria (M1–M4). Project close-out (**AC-Z05**) removes the superseded transient spec/plan once this ADR and ADR 001 amendment land.

### Authoring + attestation

| AC ID | Evidence (path — test name or note) |
|-------|-------------------------------------|
| AC-A01 | `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` — type + JSDoc |
| AC-A02 | `migration-tools` — `packages/1-framework/3-tooling/migration/src/invariants.ts` (`deriveProvidedInvariants`); `packages/1-framework/3-tooling/migration/test/invariants.test.ts` |
| AC-A03 | `invariants.ts` / `packages/1-framework/3-tooling/migration/test/invariants.test.ts` — malformed id cases |
| AC-A04 | `invariants.ts` / `packages/1-framework/3-tooling/migration/test/invariants.test.ts` / `packages/1-framework/3-tooling/migration/src/errors.ts` |
| AC-A05 | `packages/1-framework/3-tooling/migration/src/io.ts` (`MigrationMetadataSchema`); `deriveProvidedInvariants` sort/dedupe |
| AC-A06 | Emit uses `deriveProvidedInvariants` — `packages/1-framework/3-tooling/migration/test/migration-base.test.ts`, `packages/1-framework/3-tooling/migration/test/io.test.ts`; runners consume `options.plan.providedInvariants ?? []` (postgres/sqlite/mongo) |
| AC-A07 | `io.ts` re-derive + `packages/1-framework/3-tooling/migration/src/errors.ts`; tests `packages/1-framework/3-tooling/migration/test/io.test.ts` |
| AC-A08 | `computeMigrationHash` / `packages/1-framework/3-tooling/migration/test/migration-graph.test.ts` |

### Edge-level invariants

| AC ID | Evidence |
|-------|----------|
| AC-E01 | `packages/1-framework/3-tooling/migration/src/graph.ts` — `MigrationEdge.invariants` |
| AC-E02 | `migration-graph.ts` — reconstruct from manifest `providedInvariants` |
| AC-E03 | `migration-graph.test.ts`, `find-path-with-invariants.test.ts` |

### Pathfinder primitive

| AC ID | Evidence |
|-------|----------|
| AC-P01–P07 | `packages/1-framework/3-tooling/migration/test/find-path-with-invariants.test.ts` (+ `migration-graph.ts` implementation) |

### Decision metadata + error surface

| AC ID | Evidence |
|-------|----------|
| AC-D01–D07 | `migration-graph.ts`, `migration-graph.test.ts`; `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts`, `command-helpers.test.ts`; `packages/1-framework/3-tooling/migration/src/errors.ts`, `migration/test/errors.test.ts`; `migration-status.ts`, `migration-apply.ts`; `test/integration/test/cli-journeys/invariant-routing.e2e.test.ts` (Journey O) |

### Unknown-invariant pre-check

| AC ID | Evidence |
|-------|----------|
| AC-U01–U05 | `command-helpers.ts` (`collectDeclaredInvariants`); `migration-apply.ts`, `migration-status.ts` order vs connect/pathfinder; `packages/1-framework/3-tooling/cli/test/commands/migration-invariants.test.ts`; e2e Journeys P/Q + mongo parity |

### Marker-side applied invariants

| AC ID | Evidence |
|-------|----------|
| AC-M01 | `packages/3-targets/3-targets/postgres/src/core/migrations/statement-builders.ts`, `statement-builders.test.ts` |
| AC-M02 | Postgres marker DDL only; Arktype row parse — no probe |
| AC-M03 | `packages/3-mongo-target/1-mongo-target/src/core/marker-ledger.ts` |
| AC-M04 | `@prisma-next/contract` — `ContractMarkerRecord.invariants` |
| AC-M05 | **PASS — superseded** — runner reads `options.plan.providedInvariants` (manifest-canonical via `MigrationApplyStep`); this ADR records the deviation from spec F12's `SqlMigrationRunnerExecuteOptions.invariants?` channel |
| AC-M06 | Postgres UPDATE expression above; SQLite merge in txn (`runner.ts`); Mongo `$setUnion` pipeline |
| AC-M07 | `packages/3-mongo-target/1-mongo-target/test/marker-ledger.test.ts` |
| AC-M08 | `db update` / flows with empty derived set; mongo `omit-vs-empty` tests in marker-ledger |
| AC-M09 | `marker-ledger.test.ts`, sqlite `runner.idempotency.test.ts`, postgres runner idempotency integration |
| AC-M10 | e2e Journey O step O.10 + mongo parity + marker-ledger union tests |
| AC-M11 | `marker-ledger.test.ts` absent field |

### CLI integration

| AC ID | Evidence |
|-------|----------|
| AC-C01–C06 | `migration-apply.ts` (effectiveRequired); `migration-status.ts` (tree + JSON); Journey O (`invariant-routing.e2e.test.ts`); `find-path-with-invariants.test.ts` F8; CLI snapshots `migration-cli.test.ts`, `output.json-shapes.test.ts` |

### M5 close-out (this PR)

| AC ID | Evidence |
|-------|----------|
| AC-Z01 | This §Verification section |
| AC-Z02 | [ADR 001](./ADR%20001%20-%20Migrations%20as%20Edges.md) amendment (self-edge + references) |
| AC-Z03 | This ADR |
| AC-Z04 | Inbound refs updated to ADR 208 (`data-migrations-spec.md`); `rg` after spec/plan removal |
| AC-Z05 | `git rm` transient `invariant-aware-routing.spec.md` / `...-plan.md` (umbrella folder retained) |
| AC-Z06 | `data-migrations-spec.md` re-read at close-out — routing pointers aim at ADR 208 |

## References

- [ADR 001 — Migrations as Edges](./ADR%20001%20-%20Migrations%20as%20Edges.md)
- [ADR 176 — Data migrations as invariant-guarded transitions](./ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)

## Decision record

We adopt **`invariantId`** as the opt-in routing key on data transforms; **monotonic marker union** via **family-specific atomic merge**; **`FindPathOutcome`** discrimination for unreachable vs unsatisfiable; **CLI subtraction** `ref.invariants − marker.invariants`; and **manifest-threaded `providedInvariants`** on the migration plan envelope (runners read `options.plan.providedInvariants ?? []`, with **`migration verify`** as the integrity gate against ops).
