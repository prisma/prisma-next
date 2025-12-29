## `prisma-next db init` — Contract-Driven Database Bootstrap

### Overview and Motivation

`prisma-next db init` is the **bootstrap** entrypoint for bringing a database under contract control.

Its responsibilities:

- **Establish the initial contract state** for a database that has **no contract marker** yet.
- **Apply only additive/widening changes** needed to satisfy the current contract.
- **Write the contract marker** so the database becomes a first-class participant in the migration system.

It is intentionally **more conservative** than `db update`:

- `db init` **never performs destructive operations** (no drops, no type narrowing).
- It is safe to run against:
  - An **empty** database.
  - A database that has a **subset** of the required structures.
  - A database that is a **superset** of the required structures (extra tables/columns/indexes).
- It **fails** when the existing schema is **incompatible** with the contract and would require destructive change to repair.

This doc defines the `db init` command behavior, the TS primitives it composes, and the migration planner/runner slice needed to support it. It builds on:

- `docs/architecture docs/subsystems/7. Migration System.md`
- `docs/architecture docs/adrs/ADR 028 - Migration Structure & Operations.md`
- `docs/architecture docs/Contract-Driven DB Update.md`
- `docs/CLI Style Guide.md`

---

## Scope and Non-Goals

### In Scope (v1)

- **Targets / families**
  - SQL family with Postgres target/adapter/driver (same stack as the demo app).
  - Architecture general enough to extend to other SQL targets later.

- **Schema changes**
  - Create missing tables (with columns and primary keys).
  - Add missing columns:
    - Scalar columns (nullable and with non-null defaults).
    - `pgvector` columns (nullable and with non-null defaults) provided by the `@prisma-next/extensions-pgvector` pack.
  - Add missing:
    - Primary keys.
    - Unique constraints.
    - Foreign keys (when referenced tables/columns exist).
    - Simple indexes (non-partial, non-functional).
    - Extension-owned indexes (e.g. pgvector indexes) when modeled in the contract.

- **Extension handling**
  - Honor explicit **extension constraints** in the contract, e.g.:
    - `contract.extensions.pgvector.enabled === true`.
  - Use extension packs to:
    - Provide migration operations for enabling required extensions (e.g. `createExtension('pgvector')`).
    - Provide operations for creating extension-owned indexes and related objects.

- **Contract marker**
  - Write or update the `prisma_contract.marker` row to reflect the **desired contract** when `db init` succeeds.
  - Use the same marker storage and UPSERT pattern as the Migration System subsystem.

- **Planner behavior**
  - Implement a **family-owned** planner entrypoint (SQL family) that:
    - Diffs a **from-contract** and **to-contract**.
    - Respects a `MigrationOperationPolicy` governing allowed operation classes.
    - Produces a **pure in-memory MigrationPlan IR** (no file I/O).
  - Use the **same operation vocabulary** as the SQL migration system, restricted to:
    - Additive and widening operations.
    - Extension operations that are additive.

- **Runner behavior**
  - Implement an execution primitive that:
    - Applies a `MigrationPlan` to the database with pre/post checks.
    - Acquires advisory locks.
    - **Updates the marker** atomically with the apply.
    - Writes to the migration ledger in the same format as on-disk migrations.

- **CLI surface**
  - New command: `prisma-next db init`.
  - Respects global CLI conventions:
    - Config loading from `prisma-next.config.ts` (framework domain).
    - `--json` output mode via the existing result/formatter pipeline.
    - Structured errors + `performAction` + `handleResult` + `process.exit()` (per CLI rules).
  - Supports a **plan-only** mode:
    - `prisma-next db init --plan --db <url>`.

### Out of Scope (v1)

- **Destructive operations**
  - No drops or type narrowing:
    - No dropping columns/tables/indexes.
    - No changing column nullability from nullable → non-nullable or vice versa.
    - No data rewrites.

- **Full generality of SQL**
  - We do **not** plan/create:
    - Check constraints.
    - Generated/computed columns.
    - Partial/functional indexes.
    - Views/materialized views.
    - Triggers, partitioning, sequences beyond what is implicit in column types.
  - These are tolerated as **extra structure** in the DB if present, but not generated from contract in v1.

- **Non-SQL families**
  - Planner and runner are designed to be family-scoped; v1 only implements SQL family planning logic.

---

## Command Behavior

### CLI Surface

Command shape follows the existing CLI style:

```bash
prisma-next db init --db <url> [--plan] [--json]
```

- **Config resolution**
  - CLI loads `prisma-next.config.ts` per the existing configuration pipeline.
  - Family/target/adapter/driver/extension descriptors are resolved from config.
  - The CLI passes **normalized config** and **desired contract IR** into TS primitives; it does not perform planning or schema logic itself.

- **Contract loading**
  - CLI uses the existing **emit/introspect/contract-loading** story:
    - Loads the emitted `contract.json` and `contract.d.ts` (as done elsewhere).
    - Validates the contract structure via the SQL contract validators.

### High-Level Flow

1. **Load config and contract**
   - CLI:
     - Loads `prisma-next.config.ts`.
     - Resolves SQL family, Postgres target, adapter, driver, and extensions (e.g. pgvector).
     - Loads and validates the desired **contract IR** for the app.

2. **Create family instance**
   - CLI:
     - Instantiates the SQL family via `family.create({ target, adapter, driver, extensions })`.
   - Family instance exposes:
     - `planMigration(input)` (planner primitive).
     - `executeMigration(plan, connection)` (runner primitive).
     - Existing domain actions (`emitContract`, `verify`, `schemaVerify`, `introspect`, etc.).

3. **Introspect database schema**
   - CLI:
     - Opens a connection using the configured driver.
     - Invokes family/target-provided **introspection** to obtain the **live schema IR**.

4. **Check for existing marker**
   - Runner helpers (reused by CLI):
     - Query `prisma_contract.marker`.
   - Behavior:
     - **Marker present**:
       - Treat `db init` as **idempotent verify-only**:
         - Verify the database satisfies the desired contract and marker matches that contract.
         - If OK: no migration planned or applied; command reports success.
         - If NOT OK: error instructing the user to use `db update` or explicit migrations.
     - **Marker absent**:
       - Proceed with `db init` planning and apply (see below).

5. **Plan migration (marker absent)**
   - CLI:
     - Calls `family.planMigration()` with:
       - `fromContract`: the **empty contract** for the SQL family (see below).
       - `toContract`: the desired contract.
       - `liveSchema`: the current schema IR.
       - `hints`: optional authoring hints (initially empty for `db init` v1).
       - `policy`: additive-only, init-specific policy (see Migration Policy).
   - Family planner:
     - Computes a `MigrationPlan` (in-memory IR) describing the operations necessary to move from **empty** to the desired state, constrained by:
       - Existing live schema (must not require destructive repairs).
       - Migration policy (additive-only).

6. **Plan-only vs apply**
   - **Plan mode (`--plan`)**:
     - CLI:
       - Receives `MigrationPlan`.
       - In human mode:
         - Renders a textual summary of operations (create table X, add column Y, enable pgvector, etc.) using CLI formatters.
       - In `--json` mode:
         - Emits a structured envelope containing:
           - Command metadata (mode, status).
           - The serialized view of `MigrationPlan` (using the serializable migration IR).
           - Marker state before/after (before will have `hasMarker: false`).
     - No changes are applied to the DB; no marker write occurs.

   - **Apply mode (default)**:
     - CLI:
       - Passes `MigrationPlan` and DB connection to `family.executeMigration(plan, connection)`.
     - Runner:
       - Validates marker is absent (or in a compatible initial state if we later support more advanced bootstraps).
       - Acquires an advisory lock per migration system rules.
       - Applies operations in order with pre/post checks.
       - **Updates the marker** atomically to `{ core_hash: toCoreHash, profile_hash: toProfileHash, contract_json: desiredContractJson }`.
       - Appends a ledger entry for the applied edge.
     - CLI:
       - In human mode: prints a summary.
       - In `--json` mode: emits a result envelope describing:
         - `plan` (the applied edge).
         - Marker state before/after (before: no marker; after: marker with final hashes).
         - Status and any structured diagnostics.

---

## Behavior by Database State (Marker Absent)

When **no marker row exists** in `prisma_contract.marker`:

### Case 1 — Empty Database

- **Definition**: No user tables; only system schemas.
- **Behavior**:
  - Planner:
    - Treats `fromContract` as the **empty contract** node (`H∅`).
    - Plans all operations needed to realize the desired contract:
      - Create required tables, columns, PK/UK/FK, indexes, extension-owned objects.
      - For any enabled extension (e.g. `extensions.pgvector.enabled === true`), plan an operation to ensure the extension is installed (e.g. `createExtension('pgvector')`).
  - Runner:
    - Applies the full plan.
    - Writes marker with `{ core_hash: hash(desiredContract), profile_hash: profileHash }`.
    - Writes a ledger entry representing the edge `H∅ → Hdesired`.

### Case 2 — Database is a Subset of Contract

- **Definition**: Some required tables/columns/constraints/indexes are missing, but no conflicting structures are present.
- **Behavior**:
  - Planner:
    - Still uses `fromContract = emptyContract`, but **consults live schema IR** to avoid planning conflicting operations.
    - Treats existing structures that match the contract as already-satisfied postconditions.
    - Plans only **additive** operations to fill in the missing structures (tables, columns, PK/UK/FK, indexes, extension-owned objects).
  - Runner:
    - Applies only the additive operations.
    - Writes marker to the desired contract state.

### Case 3 — Database is a Superset of Contract

- **Definition**: All required structures are present and compatible, but there are extra tables/columns/indexes not mentioned in the contract.
- **Behavior**:
  - Planner:
    - Treats **extra structures** as tolerated drift:
      - Does not plan any operations to remove or modify them.
    - Plans **no operations** if the DB already satisfies all required contract structures.
  - Runner:
    - Receives an empty or no-op plan.
    - Writes marker to the desired contract state.
  - Result:
    - `db init` effectively **signs** the DB without altering user data or extra objects.

### Case 4 — Database Conflicts with Contract

- **Definition**: Existing schema contains structures incompatible with the contract, e.g.:
  - Mismatched column type for a required column.
  - Nullability conflicts (contract requires non-nullable, DB has nullable or vice versa).
  - Primary/foreign key configuration conflicts.
  - Indexes that must exist per contract but are incompatible in shape.
- **Behavior**:
  - Planner:
    - Fails fast with a **structured planning error** when resolving required operations would entail destructive or non-additive changes.
  - Runner:
    - Not invoked.
  - CLI:
    - Surfaces a CLI-structured error explaining that `db init` cannot repair this DB and that explicit migrations (or `db update` in a later slice) are required.

---

## Behavior When Marker Already Exists

When a marker row is present in `prisma_contract.marker`:

- **Idempotent verify-only behavior**:
  - If the marker’s `{ core_hash, profile_hash }` **already match** the desired contract, and the DB schema satisfies the contract:
    - `db init` reports success.
    - No migration plan is generated or applied.
    - Marker may optionally have its `contract_json` refreshed if needed, but hashes must not change.
  - If the marker exists but:
    - The contract hashes do not match the desired contract, or
    - The DB schema does not satisfy the desired contract,
    - `db init` fails with a structured error instructing the user to use:
      - `db update` (for safe contract-driven updates), or
      - Explicit migrations and `db sign` (for more complex rollouts).

This preserves a clear separation of responsibility:

- **`db init`**: “take me from untracked DB → desired contract, additively, and sign”.
- **`db update`**: “move from current marker contract → new contract under expand/contract rules”.

---

## Migration Planner: In-Memory IR and Policy

### In-Memory `MigrationPlan` IR

To mirror the contract-authoring pattern, we introduce a family-scoped **in-memory migration IR**, distinct from the serialized on-disk edge model in ADR 028:

- **In-memory IR**:
  - Can carry planner decisions, intermediate metadata, and debugging info that do not belong in the canonical on-disk edge representation.
  - Is not subject to the same hashing/canonicalization requirements.
  - Is the primary input to the runner for both `db init` and `db update`.

- **Serializable IR**:
  - Used when writing edges to disk (`migration.json` / `ops.json`).
  - Follows ADR 028’s schema and canonicalization rules.
  - Can be derived from the in-memory IR when we want to persist the edge.

For v1, `MigrationPlan` will be:

- A **linear sequence of operations** (no explicit dependency graph):
  - Order is chosen by the planner.
  - Dependencies are enforced by **pre/post checks** and operation ordering.
- Operations drawn from the subset of the ADR 028 vocabulary needed for:
  - Creating tables.
  - Adding columns (with types, nullability, defaults).
  - Adding PK/UK/FK.
  - Adding indexes.
  - Executing extension-owned operations (e.g. `createExtension('pgvector')`, create pgvector index).

### Empty Contract Origin

`db init` edges are modeled as transitions from the **empty contract node** to the desired contract:

- `fromCoreHash = hash(emptyContract)` where `emptyContract` is the SQL family’s canonical empty contract IR.
- `toCoreHash = hash(desiredContract)`.
- `fromProfileHash` / `toProfileHash` follow the existing profile-hash rules.

This is consistent with:

- `docs/architecture docs/subsystems/7. Migration System.md` (edges from `H∅`).
- ADR 028’s DAG model.

### Migration Policy

`planMigration` takes a `MigrationOperationPolicy` to govern what kinds of operations may be emitted. For v1:

- **Operation classes**
  - Represented as a list of allowed operation classes:
    - `allowedOperationClasses: readonly ('additive' | 'widening')[]`.
  - For `db init` v1:
    - `allowedOperationClasses = ['additive', 'widening']`.
    - `destructive` class is **omitted** and thus disallowed.

- **Mode**
  - A simple mode discriminator:
    - `mode: 'init' | 'update'`.
  - For `db init` v1:
    - `mode: 'init'`.
  - Allows us to plug in tighter rules (e.g. never plan drops/renames) and distinct error messages per mode without branching on targets.

- **Extension operations**

  Rather than baking extension policy into the planner, we:

  - Aggregate available operations from:
    - Target.
    - Adapter.
    - Extension packs (e.g. `@prisma-next/extensions-pgvector`).
  - The contract expresses constraints in a **generic extension section**, e.g.:

    ```json
    {
      "extensions": {
        "pgvector": {
          "enabled": true
        }
      }
    }
    ```

  - Planner:
    - Reads extension constraints from the contract (e.g. `extensions.pgvector.enabled === true`).
    - Matches them to extension-provided migration operations (e.g. `createExtension('pgvector')` and pgvector index creation ops).
    - Emits these ops when:
      - The DB does not yet satisfy the constraint (extension not installed, index missing, etc.).
      - Operation class is allowed by policy (`'additive'`).

Drift tolerance policies (e.g. whether to ignore non-contract indexes, extra tables, etc.) are kept minimal in v1 and deferred for later slices:

- Extra structures are tolerated as long as they **do not conflict** with required contract structures.
- Full drift-tolerance configuration can be added later without changing the basic planner API.

---

## Runner Integration and Marker Updates

### `executeMigration(plan, connection)`

The runner primitive:

- Accepts:
  - The in-memory `MigrationPlan`.
  - A connection/driver abstraction owned by the family/target.
- Responsibilities:
  - Validate the current marker (or lack thereof) against the plan’s `fromCoreHash` / `fromProfileHash`.
  - Acquire an advisory lock (per ADR 043).
  - Execute operations in order, honoring:
    - Precondition checks.
    - Postcondition checks.
    - Transactional DDL fallback semantics (ADR 037).
    - Idempotency classification (ADR 038).
  - On success:
    - **Update the marker row** via the shared marker helper:
      - Upsert `{ core_hash = toCoreHash, profile_hash = toProfileHash, contract_json = desiredContractJson, ... }`.
    - Append a ledger entry equivalent to a normal on-disk migration edge apply.

This keeps the existing **atomicity** guarantee:

- We never change the schema without ensuring the marker and ledger reflect the same state transition.

### Relationship to `db sign`

- `db sign` is already modeled as a separate operation:
  - It **does not plan or apply** any operations.
  - It uses the same marker helper to upsert `{ core_hash, profile_hash, ... }` based on a contract the operator asserts matches the DB schema.
- `executeMigration` reuses the same marker helper but is responsible for:
  - Ensuring schema and marker move in lockstep when a `MigrationPlan` is applied.

No CLI command calls another CLI command:

- `db init` composes:
  - Introspect → `planMigration` → (optional) `executeMigration`.
  - Never shells out to `db sign`.

---

## CLI Implementation Notes

Implementation of the CLI command will follow the existing CLI architecture and style:

- **Command creation**
  - `createDbInitCommand()` in the CLI package under `packages/1-framework/3-tooling/cli`.
  - Uses `setCommandDescriptions()` to provide:
    - Short description: e.g. “Bootstrap a database to match the current contract and write the contract marker.”
    - Long description: explaining the init semantics (additive-only, no drops, idempotent with marker).

- **Action handler**
  - Uses `performAction()` to run the core logic and capture `CliStructuredError`s.
  - Uses `handleResult()` to format human/JSON output.
  - Calls `process.exit(exitCode)` based on `handleResult` return value.

- **Result envelope (JSON)**
  - Reuses the existing CLI formatter patterns for `--json`, likely including:
    - `command`: `"db init"`.
    - `status`: `"ok"` / `"error"`.
    - `mode`: `"plan"` / `"apply"`.
    - `plan`: serialized view of the migration edge (or `null` when no ops).
    - `marker`: `{ before: { hasMarker, coreHash, profileHash }, after: { ... } }`.
    - `error`: CLI error envelope when status is `"error"`.
  - No human-readable `summary` strings in JSON; formatting is reserved for human mode.

---

## Implementation Slices and Testing Strategy

We will implement `db init` in the following slices, each individually testable end-to-end and aligned with the repo’s testing guide.

### Slice 1 — Additive Migration Planner (TS-Only, SQL/Postgres)

- **Goals**
  - Implement `planMigration()` on the SQL family instance using:
    - `fromContract` (empty contract for `db init`).
    - `toContract` (desired contract).
    - `liveSchema` (SQL schema IR from introspection).
    - `policy` (init mode, additive-only).
  - Emit an in-memory `MigrationPlan` containing only allowed operations.

- **Implementation**
  - Place planner and in-memory IR in `packages/2-sql/3-tooling/migrations` (or similar).
  - Expose `planMigration()` on `@prisma-next/family-sql/control` by delegating into that module.

- **Testing**
  - Unit/integration tests in SQL family packages:
    - Empty DB schema IR → full plan to create all structures.
    - Partial schema IR → plan only missing pieces.
    - Superset IR → no-op plan.
    - Conflicting IR → planning errors (no plan).
  - Include cases with `extensions.pgvector.enabled === true` and vector columns/indexes.

### Slice 2 — Runner Integration & Marker Updates

- **Goals**
  - Implement `executeMigration(plan, connection)` for the in-memory IR.
  - Ensure marker updates and ledger entries align with the Migration System.

- **Implementation**
  - Reuse existing runner primitives from the migration subsystem where possible.
  - Ensure `executeMigration`:
    - Validates marker state (absent for `db init`).
    - Applies operations with pre/post checks.
    - Writes marker via the shared marker helper.
    - Appends appropriate ledger entries.

- **Testing**
  - Integration tests using the dev database utilities from `@prisma-next/test-utils`:
    - Apply a `MigrationPlan` to an empty DB and verify:
      - Schema matches contract.
      - Marker row matches `toCoreHash` / `toProfileHash`.
      - Ledger entry is written.
    - Apply a no-op plan and verify:
      - Schema unchanged.
      - Marker updated appropriately (if we decide to sign anyway).
    - Verify failure paths when pre/post checks fail.

### Slice 3 — `db init` CLI Command

- **Goals**
  - Wire the CLI command to the TS primitives:
    - Config loading.
    - Contract loading/validation.
    - Introspection.
    - `planMigration` + `executeMigration`.
  - Implement `--plan` and `--json` modes.

- **Implementation**
  - Add `createDbInitCommand()` under the CLI package and register it in the command tree.
  - Use existing helpers (`performAction`, `handleResult`, `setCommandDescriptions`) and error factories.

- **Testing**
  - E2E tests in `test/e2e/framework` or example apps:
    - Empty DB:
      - `db init --plan` shows plan to create full schema.
      - `db init` applies schema and writes marker; subsequent `db init` is idempotent verify-only.
    - Partial DB:
      - Planner emits only missing objects; runner applies them; marker written.
    - Superset DB:
      - Planner emits no ops; CLI signs DB.
    - Conflict DB:
      - `db init` fails with structured error.
  - JSON mode tests:
    - Assert that `--json` output matches expected envelope and schema (using object matchers per testing guidelines).

### Slice 4 — Extension Integration (pgvector)

- **Goals**
  - Ensure pgvector extension is fully integrated into `db init` flows:
    - Contract expresses `extensions.pgvector.enabled === true`.
    - Extension pack provides:
      - Migration op to install/enable the extension.
      - Ops for creating vector indexes.
    - Planner and runner can:
      - Emit and apply these ops.
      - Use them in both `--plan` and apply modes.

- **Implementation**
  - Update `@prisma-next/extensions-pgvector` pack manifests to:
    - Declare extension constraints and capabilities.
    - Provide migration ops for enabling the extension and creating extension-owned objects.
  - Ensure SQL planner consumes pack-provided ops and ties them to contract constraints.

- **Testing**
  - Example app scenario (e.g. similarity search demo):
    - Contract with:
      - `extensions.pgvector.enabled === true`.
      - A table with a `vector` column and pgvector index.
    - Run `db init` against a fresh Postgres instance with no pgvector installed:
      - `db init --plan` shows:
        - `createExtension('pgvector')` (or equivalent op).
        - Table/column/index creation.
      - `db init` applies the plan, installs pgvector, and writes marker.
    - Run the app’s similarity search query to verify end-to-end behavior.

---

This design aligns `db init` with the existing migration architecture (contracts, markers, edges, ledger) while providing a conservative, additive-only bootstrap flow. It introduces the minimal set of new primitives (family-owned `planMigration`, in-memory `MigrationPlan` IR, and `db init` CLI wiring) needed to support a safe and testable initial implementation, and it leaves clear extension points for `db update` and more advanced policies in later slices.


