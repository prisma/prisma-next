# Tasks — `prisma-next db init` Command

## Branching Plan

To keep PRs small and reviewable, implement these tasks as a sequence of **self-contained branches**, where each branch includes its own tests that fully prove correctness for the slice being added:

- **Branch 1 — Core migration types & IR (no real behavior yet)**
  - Covers tasks **1.1**, **1.2**, **1.3**.
  - Deliverables: `MigrationPolicy`, `PlannerResult`, in-memory `MigrationPlan` IR, plus unit/type tests for these types.
  - No real planning logic yet; just the vocabulary and basic construction helpers.

- **Branch 2 — Planner SPI + Postgres planner implementation**
  - Covers tasks **1.4**, **1.5**, **1.6**.
  - Deliverables: `MigrationPlanner` interface, target-driven planner construction, and a Postgres-aware planner that enforces the `init` policy and returns either a valid plan or a structured failure with all conflicts, plus planner tests.

- **Branch 3 — Runner SPI + Postgres runner + marker/ledger wiring**
  - Covers tasks **2.1**, **2.2**, **2.3**, **2.4**.
  - Deliverables: `MigrationRunner` interface, target-driven runner construction, Postgres runner that executes plans with pre/post checks and integrates marker/ledger updates, plus integration tests using the dev database utilities.
  - **Manual developer test (between Branch 3 and 4)**: After this branch lands, add a small, ad-hoc harness (script or focused test) that:
    - Loads a real SQL contract (e.g. from `prisma-next-demo`).
    - Connects to a dev Postgres instance.
    - Introspects schema IR via the family/target stack.
    - Calls `planner.plan(...)` and, on success, `runner.execute(...)`.
    - Verifies manually (e.g. via psql or a separate script) that tables, marker, and ledger match expectations before proceeding to Branch 4.

- **Branch 4 — Schema IR & verification integration**
  - Covers tasks **4.1**, **4.2**, **4.3**.
  - Deliverables: reusable schema-vs-contract verification helpers wired into planner/runner, and tests that prove `db init` leaves the DB in a contract-satisfying state.

- **Branch 5 — CLI command & E2E wiring**
  - Covers tasks **3.1**, **3.2**, **3.3**, **3.4**, **3.5**.
  - Deliverables: `createDbInitCommand`, orchestration over planner/runner, human + JSON output, and E2E tests for all DB states (empty, subset, superset, conflicting).

- **Branch 6 — Documentation & standards alignment**
  - Covers tasks **5.1**, **5.2**, **5.3**.
  - Deliverables: updated docs and READMEs only, aligned with implementation; no behavior changes.

Tasks in section **6** (“Future-Facing / Fast-Follow Items”) are explicitly out of scope for v1 and should be implemented as separate follow-up branches.

## 1. Planner & Policy Design (SQL Family / Target-Aware)

- [x] **1.1 Define migration policy model**
  - Specify a `MigrationPolicy` type that supports at least:
    - `mode: 'init' | 'update'` (extensible).
    - `allowedOperationClasses: readonly ('additive' | 'widening' | 'destructive')[]`.
  - Document how `db init` uses `mode: 'init'` + `['additive']` and how `db update` will extend this later.
  - ✅ Implemented via `MigrationPolicy` in `packages/2-sql/3-tooling/family/src/core/migrations/types.ts` plus `INIT_ADDITIVE_POLICY` in `packages/2-sql/3-tooling/family/src/core/migrations/policies.ts`. The CLI now keeps "init vs update" context separately while the shared policy carries only the enforcement set (`allowedOperationClasses`), eliminating the incentive for downstream systems to branch on mode.

- [x] **1.2 Define planner result shape**
  - Design a `PlannerResult` type that can represent:
    - `success` with a `MigrationPlan`.
    - `failure` with a structured list of **all** conflicts (not just the first).
  - Include fields for:
    - Conflict kind (e.g., `typeMismatch`, `nullabilityConflict`, `indexIncompatible`, `missingButNonAdditive`).
    - Location (table, column, constraint, index).
    - Human-oriented `summary`/`why` fields suitable for CLI error mapping.
  - ✅ `PlannerResult`, `PlannerConflict*`, `plannerSuccess`, and `plannerFailure` live in `packages/2-sql/3-tooling/family/src/core/migrations/types.ts`.

- [x] **1.3 Define migration plan IR**
  - Introduce an in-memory `MigrationPlan` type for additive operations, including:
    - Ordered list of operations.
    - Per-operation identifiers.
    - Per-operation `precheckSql`, `executeSql`, `postcheckSql` (or equivalent execution units).
  - Ensure the IR is target-agnostic at the interface level, but can carry Postgres-specific details via the target implementation.
  - ✅ `MigrationPlan`, `MigrationPlanOperation`, `MigrationPlanOperationStep`, and `createMigrationPlan()` (same path as above) provide the IR plus helpers and tests under `packages/2-sql/3-tooling/family/test/migrations.types.test.ts`.

- [x] **1.4 Establish planner SPI between family and target**
  - Define a `MigrationPlanner` interface in the SQL family/control-plane layer (shared plane).
  - Add a method on the **target control descriptor** (e.g., Postgres) to construct a concrete planner instance given a `ControlFamilyInstance<'sql'>`.
  - Ensure the interface and construction pattern are compatible with future non-Postgres targets.

- [x] **1.5 Implement Postgres-specific planner**
  - Implement a Postgres-aware planner that:
    - Accepts `(contractIr, schemaIr, policy)`.
    - Computes diffs against the contract using existing schema/contract tooling where possible.
    - For `mode: 'init'` with additive-only policy:
      - Emits only additive operations (create table, add column, add index/constraint, etc.).
      - Records all non-additive-required changes as structured conflicts in a `failure` result.
  - Ensure planner is **non-destructive by construction** under the `init` policy.

- [x] **1.6 Planner tests**
  - Add unit/integration tests for the planner covering at least:
    - Empty database schema IR → full additive plan matching the contract.
    - Subset schema IR → plan only missing tables/columns/indexes/constraints.
    - Superset schema IR → empty plan when all required structures are compatible.
    - Conflicting schema IR → planner `failure` with a complete conflict list.
  - Use object matchers for asserting plan structure and conflicts, following testing guidelines.

## 2. Runner Design & Implementation (Postgres Target)

- **2.1 Define runner interface**
  - Design a `MigrationRunner` interface that:
    - Accepts a `MigrationPlan`, a connection/driver abstraction, and contract/marker context as needed.
    - Executes operations in order with pre/post checks.
    - Reports structured errors.
  - Add a method on the **target control descriptor** to construct a concrete runner given a `ControlFamilyInstance<'sql'>`.

- **2.2 Marker and ledger integration contract**
  - Specify a small internal API for:
    - Ensuring the contract marker table exists (create-if-missing semantics).
    - Reading/writing a single marker row keyed by contract identity.
    - Appending a migration ledger entry that records:
      - Origin contract hash and JSON (empty or previous marker’s contract).
      - Destination contract hash and JSON.
      - Full list of executed operations (with precheck/execute/postcheck SQL).
  - Align this with the existing migration system’s marker and ledger schemas.

- **2.3 Implement Postgres runner**
  - Implement the runner so that it:
    - Acquires appropriate advisory locks before applying a plan.
    - Runs `precheckSql` for each operation and fails with structured error on violation.
    - Executes `executeSql` and verifies success with `postcheckSql`.
    - After all operations:
      - Re-runs contract vs. schema verification to ensure the database now satisfies the contract.
      - Upserts the contract marker row with destination contract info.
      - Appends a migration ledger entry with all required fields.
  - Ensure no destructive operations are ever executed under the `init` policy.

- **2.4 Runner tests**
  - Add integration tests (using `@prisma-next/test-utils` dev database helpers) that:
    - Apply a non-empty `MigrationPlan` to an empty database and assert:
      - Schema matches the contract.
      - Marker row exists and matches the destination contract.
      - A ledger entry is written with correct origin/destination and operations.
    - Apply an empty/no-op plan and assert:
      - Schema is unchanged.
      - Marker is ensured/updated appropriately.
    - Simulate failing pre/post checks and assert that:
      - Partial changes are handled according to transaction semantics.
      - Failures are surfaced as structured errors with useful messages.

## 3. CLI Command Wiring (`prisma-next db init`)

- **3.1 Add command factory**
  - Implement `createDbInitCommand()` under the CLI package (e.g., `packages/framework/tooling/cli/src/commands/db-init.ts`).
  - Register the new command in the CLI command tree so `prisma-next db init` is available.

- **3.2 Use CLI style and error-handling patterns**
  - Apply `setCommandDescriptions()` to provide:
    - Short description: “Bootstrap a database to match the current contract and write the contract marker.”
    - Long description explaining additive-only semantics, supported states, and idempotence.
  - Wrap the core logic in `performAction()`/`handleResult()`:
    - Throw `CliStructuredError` for expected failures.
    - Call `process.exit(exitCode)` with the value from `handleResult`.

- **3.3 Orchestration logic**
  - In the command action:
    - Load config via the existing config loader (`prisma-next.config.ts`).
    - Load and validate the contract (`contract.json` + `contract.d.ts`).
    - Build a `ControlFamilyInstance<'sql'>` from family/target/adapter/driver descriptors.
    - Ask the target descriptor to construct:
      - A `MigrationPlanner` instance (passing the family instance).
      - A `MigrationRunner` instance (passing the family instance).
    - Introspect the live database schema into a schema IR via the family/target stack.
    - Invoke `planner.plan({ contractIr, schemaIr, policy: initPolicy })`.
      - On `failure`, map conflicts to a structured CLI error and exit non-zero.
      - On `success`:
        - If `--plan` is set:
          - Render tree-like, human-readable summary plus optional JSON plan.
        - Otherwise:
          - Pass the plan and connection to `runner.execute`.
          - After execution, surface a success summary including:
            - Applied operations count.
            - Marker and ledger confirmation.

- **3.4 CLI output formatting**
  - Implement human-readable formatting that:
    - Shows a **tree of changes** similar to `schema-verify` (per-table, per-column/index/constraint).
    - Logs each operation as it executes (`creating table ...`, `creating index ...`).
  - Implement `--json` output that:
    - Uses the standard result envelope (`status`, `error`, etc.).
    - Embeds `originContract`, `destinationContract`, `plan`, and `marker` before/after snapshots.
    - Includes conflicts list when planning fails.

- **3.5 CLI tests**
  - Add CLI-level tests (likely in `test/e2e/framework`) to cover:
    - Empty DB: `db init --plan` and `db init` (apply) behaviors + JSON mode.
    - Subset DB: only missing pieces planned/applied; marker/ledger correct.
    - Superset DB: no-op plan; marker/ledger identity transition.
    - Conflicting DB: failure with conflict list; no schema or marker changes.
  - Use the shared E2E dev database utilities and object matchers for result assertions.

## 4. Schema IR & Verification Integration

- **4.1 Reuse or expose schema-verify primitives**
  - Identify and reuse the existing **schema vs. contract verification** logic used by the `schema-verify` command.
  - Ensure the planner has access to:
    - Contract IR.
    - Introspected schema IR.
    - A reusable diff/verification primitive or library for detecting missing vs. conflicting structures.

- **4.2 Contract verification after execution**
  - Implement a helper that, given a connection and contract, re-runs verification after the runner finishes:
    - Fails with a structured error if the final schema does not fully satisfy the contract.
    - Integrate this helper into the runner or the CLI orchestration layer as appropriate.

- **4.3 Verification tests**
  - Add tests that:
    - Intentionally introduce mismatches after running `db init` and ensure verification catches them.
    - Confirm that a successful `db init` always leaves the database in a verifiable, contract-satisfying state.

## 5. Documentation & Standards Alignment

- **5.1 Update CLI and migration docs**
  - Update or add documentation under `docs/` to:
    - Describe `prisma-next db init` semantics, including:
      - Supported database states (empty, subset, superset, conflicting).
      - Policy model and relation to future `db update`.
      - Marker and ledger behavior.
    - Show example usage:
      - Human output.
      - `--plan`.
      - `--json` envelopes.
  - Cross-link from existing migration system and CLI style docs.

- **5.2 Ensure alignment with agent-os standards**
  - Check the implementation and docs against:
    - Backend standards (`api`, `migrations`, `models`, `queries`).
    - Global documentation, coding-style, error-handling, and validation standards.
    - TypeScript standards (error handling, naming, testing, best practices).

- **5.3 Package READMEs**
  - For any package that gains new responsibilities (e.g., SQL family migrations tooling, CLI), update its README to:
    - Describe the new surfaces (planner, runner, `db init`).
    - Document dependencies and relationships to other packages.
    - Include or update architecture diagrams if necessary.

## 6. Future-Facing / Fast-Follow Items (Not in v1 Scope)

> These are explicitly **not required for the initial implementation**, but should be tracked as follow-ups.

- **6.1 `db update` policy & command**
  - Extend the migration policy model to support widening and, later, destructive operations.
  - Introduce a `db update` command that reuses the same planner/runner interfaces with a different policy.

- **6.2 Extension-aware initialization (e.g., pgvector)**
  - Add extension-specific operations (installing pgvector, creating vector indexes) into the planner/runner surfaces.
  - Coordinate with extension pack manifests and capabilities.

- **6.3 Richer drift-tolerance configuration**
  - Allow users to configure which forms of extra or non-contract schema objects are tolerated or warned on.
  - Extend conflict taxonomy and CLI reporting accordingly.

## 7. Follow-up Cleanup

- **7.1 Remove pgvector-specific logic from Postgres target**
  - Strip any hard-coded references to pgvector (extension SQL, naming conventions, etc.) from `@prisma-next/targets-postgres`.
  - Ensure extension-specific behavior is provided exclusively via extension packs so the target remains neutral.

## 8. Postgres Planner Enhancements

- **8.1 Support additional additive initialization scenarios**
  - Extend the Postgres migration planner to handle additive “subset” and “superset” database states (e.g., missing columns, indexes, or constraints).
  - Generate additive operations for partially provisioned schemas and ensure the planner produces full conflict reports when non-additive changes are required.


