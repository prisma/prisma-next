# prisma-next `db init` Command

## Overview

`prisma-next db init` is a **safe, additive-only bootstrap command** for bringing an existing PostgreSQL database under a Prisma Next SQL contract. Given a valid `contract.json`/`contract.d.ts` and a database connection, it:

- Introspects the current database schema into a **schema IR**.
- Computes a **migration plan** that creates any *missing* structures required by the contract, subject to a strict *additive-only* policy.
- Executes the plan against the database via the configured **Postgres driver/adapter**.
- Verifies that the resulting schema satisfies the contract.
- Writes or updates the **contract marker** and appends a **migration ledger entry** describing the transition.

The command is designed to be **failure-tolerant but non-destructive**. In the current implementation it succeeds on empty databases, refuses to operate on non-empty schemas, and clearly reports unsupported states. Subset/superset planning is a fast-follow enhancement.

## Problem Statement

Today, bringing an existing PostgreSQL database under Prisma Next’s contract-first model requires manual steps:

- Emit a SQL contract (`contract.json`/`contract.d.ts`).
- Manually create or migrate the physical schema to match the contract.
- Manually write a contract marker and (eventually) a migration ledger entry.

This is error-prone and undermines the **agent-first** goal of Prisma Next: agents and humans alike should be able to declaratively state “this is my contract, make the database match it safely” and get a deterministic, debuggable result.

We need a first-class, documented command that:

- Takes a contract + connection and **initializes** a database instance to that contract.
- Applies only **additive** changes (no drops, no narrowing).
- Leaves the database in a state where future operations (`db verify`, `db update`, `db sign`, etc.) see a consistent marker and ledger history.

## Goals

1. **Safe bootstrap**: Given an empty or partially-provisioned PostgreSQL database, create or complete all required structures so that the database satisfies the current SQL contract, without performing any destructive or narrowing operations.
2. **Contract‑driven behavior**: Treat the emitted `contract.json`/`contract.d.ts` as the single source of truth; all planning and verification is done by comparing the contract IR to the introspected schema IR under a well-defined policy.
3. **Target-aware planning**: Implement v1 using the Postgres adapter/driver, but design the **planner/runner interfaces and policies** so they can be reused for other SQL targets.
4. **Thin CLI orchestration**: Keep the CLI layer responsible only for wiring (config, contract loading, connection management, planner/runner orchestration, output formatting), not for database- or family-specific logic.
5. **Marker & ledger integration**: After a successful run, ensure that:
   - The **contract marker** table exists and accurately reflects the satisfied contract.
   - A **migration ledger entry** records the transition from the origin contract to the destination contract, including the operations used to effect the change.
6. **Clear failure modes**: When the current schema cannot be reconciled with the contract under an additive‑only policy, surface a single structured error that enumerates all conflicts rather than failing on the first one.

## Non-Goals

- Implementing **destructive** or **widening** migration logic (`ALTER COLUMN TYPE`, dropping columns/tables/indexes, changing nullability to be stricter, etc.). Those will be introduced later under a separate `db update` command with an expanded policy.
- Supporting **non-Postgres targets** in v1. The design should remain extensible, but the initial implementation will only use the Postgres adapter and driver.
- Automatically emitting or regenerating `contract.json`/`contract.d.ts`. v1 assumes the contract artifacts already exist on disk and are valid.
- Implementing **extension-specific** bootstrap logic (e.g. installing pgvector, creating vector indexes). Extension-aware initialization is a fast-follow on top of this general mechanism.
- Implementing subset/superset schema diffing and partial provisioning support in v1. The current Postgres planner is “empty-db only”; additive subset/superset planning is a fast-follow enhancement.

## User Stories

1. **Bootstrap a new database from a contract**
   - As a backend engineer, I have a freshly provisioned PostgreSQL database and a checked‑in Prisma Next SQL contract. I run `pnpm prisma-next db init --db <connection-string>` and expect all required tables, columns, indexes, and constraints from the contract to be created, the final schema to be validated, and a marker/ledger entry to be written.

2. **Complete a partially provisioned database**
   - As an operator, I have a database where some tables and indexes already exist (e.g., created manually or by a previous system), but the schema is missing a few contract fields. I run `db init` and expect it to fill in the missing pieces, leave any extra objects untouched, and then sign the database against the contract.

3. **Detect and surface conflicts**
   - As a developer, I accidentally drifted my schema away from the contract (e.g., changed a column type in the DB). When I run `db init`, I expect it to fail without making changes, and to show me a clear report of all mismatches that would require destructive or non‑policy operations to fix.

4. **Repeatable initialization**
   - As a CI pipeline, I can safely run `db init` against the same database multiple times; if the schema already satisfies the contract and is signed, the command is effectively a no‑op that simply confirms the state and exits successfully.

## Functional Requirements

### Inputs

1. **Contract input**
   - `db init` consumes an already-emitted SQL contract:
     - `contract.json` (canonical contract IR, including hashes).
     - `contract.d.ts` (static type information).
   - Contract loading and validation use existing SQL contract tooling (e.g., `validateContract<TContract>(json)`).

2. **Configuration**
   - Database connection information is provided via:
     - The Prisma Next CLI configuration (`prisma-next.config.ts`), and/or
     - A dedicated CLI flag (e.g. `--db <connection-string>`).
   - **No implicit environment conventions** are built into the core command (e.g., no hard-coded `DATABASE_URL` semantics). If environment variables are used, they are resolved within config, not in the CLI domain logic.

3. **Planner policy**
   - `db init` invokes planning with an explicit **migration policy**:
     - `mode: 'init'`.
     - `allowedOperationClasses: ['additive']`.
   - The same planning surface will later be reused for `db update` with a broader policy (e.g. `['additive', 'widening']`).

### Behavior Over Database & Marker States

All behavior below assumes a PostgreSQL target and a valid contract.

1. **Empty database, no marker**
   - The system:
     1. Introspects the database into a schema IR.
     2. Calls the planner with `(contract IR, schema IR, policy: { mode: 'init', additive-only })`.
     3. Receives a plan consisting solely of additive operations that:
        - Create all required tables, columns, indexes, constraints, etc.
     4. Passes the plan to the runner, which:
        - Executes pre-check SQL, DDL SQL, and post-check SQL for each operation.
        - Ensures the contract marker table exists.
        - Writes/updates the contract marker to reference the destination contract.
        - Appends a migration ledger entry describing the transition from the empty contract to the destination contract.
     5. Re-runs contract vs. schema verification to guarantee the database now satisfies the contract; fails if verification does not pass.

2. **Subset database, with or without marker**
   - A “subset” database is one where:
     - All existing relevant structures are compatible with the contract (types, nullability, keys, indexes).
     - Some required structures are missing (e.g., missing columns or tables).
  - **Status**:
    - Fast-follow enhancement (planner currently supports empty databases only).

3. **Superset database, with or without marker**
   - A “superset” database is one where:
     - All required structures are present and compatible with the contract.
     - Extra tables/columns/indexes may exist beyond what the contract describes.
  - **Status**:
    - Fast-follow enhancement (planner currently supports empty databases only).

4. **Conflicting database (requires non-allowed operations)**
   - A “conflicting” database is one where at least one required contract element cannot be satisfied under the current policy without a disallowed operation, e.g.:
     - Type mismatch (DB column type incompatible with contract type).
     - Nullability mismatch that would require tightening (e.g. `NULL` → `NOT NULL`).
     - Incompatible primary/foreign key definitions.
     - Index shape or uniqueness constraints that cannot be made compliant additively.
  - **Status**:
    - Partial in v1. The current Postgres planner reports “non-empty schema” as an unsupported state rather than performing schema-vs-contract conflict analysis.

5. **Existing marker with matching contract**
   - If a contract marker already exists and its contract hash matches the contract being used:
     - Planner will typically return an empty plan (no changes required) if the schema is fully compatible.
     - Runner ensures the marker table and row are present and up-to-date (idempotent).
     - Command exits successfully without performing DDL.

6. **Existing marker with additive drift**
   - If a marker exists for contract `C`, but the current schema is a **subset** of `C` (i.e., some additive pieces are missing but no conflicts exist):
     - `db init` is allowed to **fill in the missing pieces** under the same `init` policy.
     - Planner returns a plan of additive operations; runner executes it, verifies the schema, updates the marker to `C`, and appends a ledger entry from `C` to `C` (recording the operations applied).
   - The existence of a marker does not by itself force the user to use `db update`; the **policy** is the source of truth for what kinds of changes are allowed.

### Outputs

1. **Human-readable output**
   - Before execution:
     - A **tree-like summary** of the planned changes, in a format analogous to `schema-verify`, showing:
       - Which tables/columns/indexes/constraints are missing and will be created.
       - Which elements are already satisfied.
       - (In future `db update`, which elements would be modified or dropped.)
   - During execution:
     - A clear, ordered log of operations, e.g.:
       - `creating table "user"...`
       - `creating index "user_email_idx"...`
       - Each with success/failure markers and optional spinners/progress indicators.
   - On success:
     - A concise summary of:
       - Number of operations executed.
       - Number of objects created.
       - Confirmation that the schema matches the contract and the marker/ledger were updated.
   - On failure:
     - A human-readable explanation of conflicts or errors, including references to the conflicting tables/columns/constraints.

2. **JSON output**
   - When invoked with `--json`, the command emits a structured envelope (reusing the existing CLI error/result patterns), for example:
     - `status`: `'ok' | 'error'`.
     - `contract`: `{ hash, path, ... }`.
     - `originContract`: `{ hash, jsonPath }`.
     - `destinationContract`: `{ hash, jsonPath }`.
     - `plan`: array of operation objects, each including:
       - `kind` / `id`.
       - `precheckSql`.
       - `executeSql`.
       - `postcheckSql`.
     - `marker`: `{ before: {...}, after: {...} }`.
     - `conflicts` (for failure cases): list of structured conflict descriptions.
     - `error`: structured error payload (code, message, why, fix, metadata).

## Architectural Responsibilities

### CLI Layer (`prisma-next db init`)

The CLI command is a **thin orchestrator**:

1. Parse flags and load configuration:
   - Resolve the family, target, adapter, driver, and any configured extensions from `prisma-next.config.ts`.
   - Resolve the database connection string (from config and/or explicit `--db`).

2. Load and validate the contract:
   - Load `contract.json` and `contract.d.ts`.
   - Validate the JSON against the typed contract using the SQL contract validator.

3. Construct control-plane dependencies:
   - Create a **family instance** (`ControlFamilyInstance<'sql'>`) using the configured descriptors for family/target/adapter/driver.
   - Ask the **target** (via its control-plane descriptor) to construct:
     - A `MigrationPlanner` instance, given the family instance.
     - A `MigrationRunner` instance, given the family instance.

4. Orchestrate planning and execution:
   - Use the family/target to:
     - Introspect the database into a schema IR.
     - Call `planner.plan({ contractIr, schemaIr, policy })`.
     - If planning returns a `success` result with a plan:
       - In `--plan` mode, render the plan (and/or serialize it to JSON) and exit without executing.
       - In default mode, call `runner.execute({ plan, connection })`, then verify and sign.
     - If planning returns a `failure` result:
       - Map the failure into a structured CLI error and exit non‑zero, without side effects on the DB.

5. Emit output:
   - Map successes and failures into human-readable or JSON output via the standard CLI result handler.

The CLI **must not**:

- Contain Postgres-specific DDL logic.
- Perform ad-hoc schema diffs or apply partial fixes outside of the planner/runner.

### Planner (Target-Aware, Policy-Driven)

The planner is responsible for transforming **(contract IR, schema IR, policy)** into either:

- A **valid migration plan** composed entirely of operations allowed under the given policy; or
- A **structured failure** describing all conflicts that cannot be resolved under that policy.

Key responsibilities:

1. Interpret the SQL contract IR and schema IR in a **target-agnostic way** where possible, deferring target-specific details to the target’s schema/model implementations.
2. Enforce the **migration policy**:
   - For `mode: 'init'`, generate only additive operations (create table, add column, add index/constraint, etc.).
   - Explicitly identify any required change that would require widening or destructive operations and emit it as a conflict instead of producing an invalid plan.
3. Model the plan as an ordered list of operations, each with:
   - A stable identifier.
   - Pre-check SQL (or equivalent) to verify preconditions.
   - Execute SQL (the DDL/data operation).
   - Post-check SQL to confirm the desired state.
4. Support multi-target extension:
   - The planner interface is defined at the SQL family/control-plane level, while concrete implementations are constructed by the **target descriptor** (e.g., Postgres vs. MySQL).

### Runner (Target-Specific Execution)

The runner is responsible for executing a validated plan against a specific database connection, enforcing safety and recording outcomes.

Responsibilities:

1. Execute each operation in order:
   - Run pre-check SQL and fail fast (with structured error) if preconditions are not met.
   - Run execute SQL.
   - Run post-check SQL to confirm success.
2. Manage transactional and concurrency semantics in a **target-aware** way:
   - For Postgres, use appropriate transaction boundaries and advisory locks to serialize `db init` and future migration operations.
3. Ensure marker and ledger consistency:
   - Ensure the **marker table** exists, creating it if necessary.
   - After successful execution of all operations:
     - Re-run contract vs. schema verification to ensure the database satisfies the contract.
     - Upsert the **contract marker** row with:
       - Origin contract hash and/or reference.
       - Destination contract hash and any additional metadata (e.g., timestamp, tool version).
     - Append a **ledger entry** capturing:
       - Origin contract hash and JSON.
       - Destination contract hash and JSON.
       - The full list of operations (including precheck/execute/postcheck SQL).
4. Do not attempt to “fix” conflicts:
   - If any operation fails due to an underlying conflict that was not detected at planning time, fail with a clear, structured error and avoid partial silent drift.

## Error Handling & Reporting

`db init` participates in the existing CLI error-handling pattern:

- All expected failures (planning conflicts, verification failures, marker/ledger issues) are expressed as **structured errors** with:
  - A domain-specific error code (e.g., `PN-CLI-4xxx` for CLI/config problems, `PN-RTM-3xxx` for runtime/migration issues).
  - `summary`, `why`, `fix`, and `meta` fields that agents and humans can consume.
- The CLI uses the shared `performAction` + `handleResult` helpers to:
  - Catch structured errors from the planner/runner.
  - Map them into consistent console and JSON output.
  - Exit with an appropriate non-zero status on failure.

## Open Questions & Future Work

1. **Precise conflict taxonomy**
   - Which conflict categories do we want to surface explicitly in the planner’s failure result (e.g., `typeMismatch`, `nullabilityConflict`, `indexIncompatible`, `unknownTable`, etc.)?
2. **Policy evolution for `db update`**
   - How will we extend the migration policy model to capture widening and destructive changes?
   - How do we present `db init` and `db update` as a coherent set of commands to users and agents?
3. **Extension-aware initialization**
   - How should the planner expose extension-specific operations (e.g., pgvector installation, index creation) under an additive policy?
   - What are the right abstractions for “extension capabilities” in the context of planning and verification?
4. **Identity and replayability**
   - How should ledger entries from `db init` interact with future migration runs (e.g., replaying or diffing plans, generating human-readable histories, etc.)?

## References

- `docs/Db-Init-Command.md` — original, more detailed design and slicing; this spec intentionally relaxes over‑prescriptive implementation details while preserving the core problem and constraints.
- `docs/Architecture Overview.md` — overall architecture, contract-first and migration model.
- `docs/architecture docs/subsystems/1. Data Contract.md` — SQL contract structure and semantics.
- `docs/architecture docs/subsystems/3. Query Lanes.md` — SQL family and runtime context.
- `docs/architecture docs/subsystems/5. Adapters & Targets.md` — control-plane descriptors and target/family separation.
- `docs/Testing Guide.md` — testing expectations for new CLI commands and migration features.




