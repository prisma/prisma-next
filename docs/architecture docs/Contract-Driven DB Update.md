## Contract-Driven `db update`: Safe Schema Evolution Without Migrations on Disk

### Overview and Motivation

Most teams today assume that **versioned migrations in source control** are the only safe way to evolve a production schema. Historically, “db push”‑style commands have been positioned as dev‑only conveniences. This design proposes a new path:

This document builds on the **Migration System** subsystem and **ADR 028 – Migration Structure & Operations**:

- See `docs/architecture docs/subsystems/7. Migration System.md` for markers, edges, and ledgers.
- See `docs/architecture docs/adrs/ADR 028 - Migration Structure & Operations.md` for the migration IR and canonicalization.

Those documents define the core primitives; this one specifies how `db update` reuses them for a planner‑authored, migrationless surface.

- The **contract** is the source of truth for application expectations.
- A **planner** can synthesize a **deterministic, lossless change plan** from the database’s current contract to the desired contract.
- A **runner** can execute that plan safely, with full verification and audit, **without requiring hand-authored migration files on disk**.

The core idea: **`prisma-next db update`** becomes “update this database to match the current contract” under strict safety, determinism, and auditability guarantees.

The goal is to make `db update` a **production‑grade, contract‑driven alternative to file‑based migrations**, not just a dev‑only tool. The planning behavior is identical to migration planning: the same planner diffs a “from” contract and a “to” contract and produces a single edge with operations and pre/post checks. The difference is lifecycle: migration planning writes that edge to disk for later execution, while `db update` asks the planner and runner to synthesize and apply a safe edge immediately for a specific database, without a migration file checked in for that change.

---

## Authoring States: Active, Deprecated, Deleted

From the author’s perspective, a field/table can be in three logical states in the **authoring surface** (PSL or TS builder). Each state describes constraints that must be satisfied for the database to meet the expectations of the contract (and therefore the application).

- **Active**
  - Must be present in the database for the contract to be satisfied.
  - May be queried and updated by the application.
  - Present in the canonical contract and can be referenced by other parts of the contract (for example as an intermediate structure).

- **Deprecated**
  - May not be accessed by the application, because it does not appear in the canonical contract.
  - The database may or may not still have this structure; both states satisfy the contract, since the application cannot depend on it.
  - Tracked in the authoring surface (for example via `@deprecated`) and migrations so that planners and humans can see the lifecycle, but omitted from the canonical contract projection.

- **Deleted**
  - No longer appears in the canonical contract (same as deprecated) and therefore is not required by the application.
  - Eligible for physical removal from a database if it is still present, provided that the previous contract for that environment did not require this field/table (for example it had already moved through the deprecated phase).
  - Represented in the authoring surface (for example via `@deleted`) or planning metadata so the planner can emit `DROP` operations when policy allows.

The **authoring layer** is free to carry richer state (deprecated vs deleted, hints, historical names), but the canonical contract remains the narrow, canonical definition of what must exist in the database for the application to run.

---

## What Does and Doesn’t End Up in the Contract (and Why)

The **canonical contract IR** (what is emitted as `contract.json`, hashed into `coreHash`, and consumed by runtime/lanes/CLI) is intentionally **strict and pure**:

- It describes **only the structures the application requires**:
  - Models, fields, relations.
  - Storage layout (tables, columns, PK/UK/FK, indexes).
  - Capabilities and extension-owned metadata.
- It is **planner-agnostic**:
  - No planner hints.
  - No deprecation/delete flags that exist solely to drive migration planning.
  - No rollout or environment-specific policy decisions.

In other words, the canonical contract IR **never encodes planner or rollout decisions**; those live only in **authoring metadata** and **migration history**, and are interpreted by the migration planner/control-plane.

Given the semantics:

- **If something is present in the contract and absent in the DB**, the DB does **not** satisfy the contract:
  - `db update` must either **create/repair** it or fail.
- **If something is absent in the contract and present in the DB**, that **does not** violate the contract:
  - Extra columns/tables are tolerated; the app simply doesn’t depend on them.

In that light, deprecation/delete metadata behaves as follows:

- **`@deprecated`**
  - Authoring retains knowledge of the field/table and its history.
  - **Canonical contract omits it**, since the application no longer requires it.
  - DB may or may not still have it; both satisfy the contract.
  - Types and lints enforce “don’t depend on this anymore” by not exposing it in the normal surface (or surfacing only under a clearly deprecated API).

- **`@deleted`**
  - Authoring marks intent to physically remove.
  - Canonical contract also omits it (same as deprecated).
  - Planner and migration system use authoring metadata plus history to decide:
    - Whether a `DROP` operation is allowed for a given environment.
    - Whether it should be treated as a no-op (if the object is already gone).

This preserves the contract’s role as **“required shape”** while letting authoring and migrations carry the richer lifecycle state.

---

## `prisma-next db update`: Definition

**Purpose**: Safely transition a live database from its **current contract state** to the **desired contract state** (current `contract.json`), using only lossless or policy-allowed operations, without hand-authored migrations on disk.

### Inputs

- **Desired contract**:
  - `contract.json` in the repo at the point of invocation
- **Current database state**:
  - DB marker row, which includes `{ core_hash, profile_hash, contract_json, ... }`.
  - The planner reads `contract_json` as the environment’s **marker contract** (its current contract); the hashes are used to name the edge and to validate marker equality before apply.
  - Live schema (introspected as needed for pre/post checks).
- **Authoring metadata**:
  - `@deprecated` / `@deleted` states.
  - Planner hints (`@hint(was: "old_name")`, etc.), all living in the authoring layer.

### Behavior (Planner)

- Receive as inputs:
  - The **marker contract** (from `marker.contract_json`),
  - The **desired contract** (from `contract.json`),
  - The **authoring metadata** for those contracts (deprecations, deletions, hints).
- Interpret the authoring metadata in the context of the two contracts.
- Compute `fromCoreHash` as the hash of the marker contract and `toCoreHash` as the hash of the desired contract.
- Compute a **single migration edge** (change plan) from `fromCoreHash` to `toCoreHash`:
  - Only include operations that:
    - Are **additive or lossless**, or
    - Are drops/reshapes that are explicitly allowed by:
      - Authoring metadata (`@deprecated`/`@deleted`, hints),
      - Environment history (for example, this environment has already gone through the deprecation phase),
      - Policy (environment-level constraints).
- Emit:
  - Edge header (from/to hashes, hints used, planning strategy).
  - Ops list (DDL/DML IR).
  - Pre/post checks per operation.

The planner reasons **purely in contract space**: it diffs the marker contract against the desired contract, guided by authoring metadata and policy. It does **not** diff directly against the live schema; live schema is only consulted via pre/post checks at apply-time.

This edge uses the **same IR as normal migrations** (as defined in ADR 028 and the Migration System subsystem), but is **planner-authored and ephemeral**: it need not be checked into `migrations/`, though it is still logged.

### Behavior (Runner)

- Validate DB marker versus edge `fromCoreHash` / `fromProfileHash`.
- Acquire advisory lock.
- Execute ops in order, honoring:
  - Preconditions (must pass before each op).
  - Transactional DDL fallback strategies.
  - Idempotency classifications (already-satisfied postconditions are treated as applied).
- On success:
  - Update marker to `toCoreHash` / `toProfileHash`.
  - Append a ledger entry capturing:
    - Edge header.
    - Environment, timestamp, outcome.

### CLI Surface

- **Primary command**:

```bash
prisma-next db update --db <url>
```

- **Default mode**: safe update:
  - Only planner-allowed operations per policy.
  - Aborts if a required change cannot be expressed as a safe plan.

Optional flags could later extend this (for example `--allow-destructive`), but the base semantics are “no data loss unless explicitly and narrowly allowed.” Even with such flags, the planner continues to operate **only on contract deltas and extension-defined operations**; there is no escape hatch for arbitrary SQL.

---

## Developer Workflow

From a dev’s point of view, the flow looks like this.

### Initial setup

- Define contract via PSL/TS.
- `prisma-next emit` produces `contract.json` plus `.d.ts`.
- Provision a DB and write the initial marker (via migrations or `db update` on an empty DB).

### Local evolution

- Working on a feature:
  - Update the contract (add fields/tables, etc.).
  - Optional: mark fields/tables as \@deprecated\ if the application no longer depends on them
- Use the emitted types/view of tables/models to implement application logic.
- To try changes locally against a dev DB:

```bash
prisma-next db update --db $DEV_DB_URL
```

- Planner synthesizes a safe edge from the dev DB’s marker to the new contract.
- Runner applies it or aborts with a concrete diagnostic.

### Removing old fields/tables

- Phase 1: mark fields/tables `@deprecated` in authoring.
  - They disappear from the main typed surface and canonical contract.
  - DB still has them; contract just no longer requires them.
  - CI prevents building the app if it attempts to consume deprecated fields, guaranteeing that if the DB's contract stipulates a field is deprecated, a subsequent update is safe to delete them
- Phase 2: once all environments have been updated and app code no longer depends on them:
  - Mark them as `@deleted` or remove from authoring, with enough metadata retained in planning state to know what to drop.
  - Subsequent `db update` calls can legally generate drops for them, subject to policy.

### Branch and PR

- Commit contract and code changes on a topic branch.
- CI (branch-level) runs contract diffs and compatibility checks (see next section).
- Reviewers see both the contract diff and (optionally) a rendered summary of what `db update` would do.

---

## CI Workflow

CI’s job is to **gate contract changes** and ensure `db update` remains safe by construction. It does this with **contract diffs, authoring metadata, and environment markers**; it does not need to simulate full DDL to enforce expand/contract.

### A. On topic branches (no prod access)

For a PR targeting main:

1. **Classify contract changes**
   - Use the contract library or CLI to compare the previous main contract and the new contract for this branch.
   - Classify changes using the Compatibility Rules:
     - Additive (add table/column, new index).
     - Rename/drop/type change.
     - Capability-only changes.

2. **Enforce expand/contract at the contract level**
   - Core behavior:
     - Additive changes are always compatible from the contract’s point of view.
     - Introducing deprecations in the authoring surface (so fields/tables disappear from the canonical contract) is also compatible; code compiled against the new contract cannot reference them.

Because deprecated fields/tables are omitted from the canonical contract and its generated types, code compiled against the new contract cannot reference them. That keeps the “contract omits deprecations” story aligned with reality: the app for this contract truly does not depend on them.

### B. On promotion to a specific environment (staging/prod)

When promoting a particular contract version to an environment `E`:

1. **Read environment marker**
   - Read `prisma_contract.marker` in `E` to obtain `{ core_hash, profile_hash, contract_json, ... }`.
   - Treat `contract_json` as the environment’s current contract.

2. **Validate that planned drops are env-safe**
   - For any object that the planner would be allowed to drop (absent from the desired contract and marked as deleted in authoring):
     - Check that the environment’s current contract does not require it (for example it is already absent from the _database's_ `contract_json`).
   - If the environment’s current contract still contains the object, block promotion: that environment has not yet been updated to a contract that stops requiring it.

3. **Authorize `db update`**
   - If checks pass, CI/CD is allowed to run:

```bash
prisma-next db update --db $ENV_DB_URL
```

   - `db update` will:
     - Apply additive and widening operations.
     - Apply drops only for objects that the desired contract does not require and that the environment’s current contract also does not require.
   - The resulting edge is logged in the same migration ledger used by the Migration System subsystem; from the ledger’s perspective there is no difference between an edge applied via `db update` and an edge applied from disk.

Optionally, you can still add **preflight** (shadow apply) for operational concerns (locks, run time), but **expand/contract enforcement itself relies only on contracts, authoring metadata, and environment markers.**

---

## Safety, Determinism, and Auditability Requirements

For `db update` to be credible as a production flow, it must meet the same bar as (or higher than) hand-authored migrations.

### Safety

- **No silent data loss in default mode**
  - Planner may:
    - Add tables/columns/indexes/FKs that are safe.
    - Widen types (where known safe).
  - Planner may only drop objects when:
    - They are **absent from the desired contract**, and
    - Authoring/migration history and policy mark them as eligible (deprecated to deleted lifecycle).

- **Contract and marker verification**
  - Runner refuses to run if DB marker’s `core_hash` does not match the edge’s `fromCoreHash`.
  - Prevents applying a plan against the wrong state.

- **Pre/post checks per operation**
  - Use the existing pre/post vocabulary for:
    - Existence checks (table/column/index present/absent).
    - Data invariants (for example “no nulls before tightening nullability”, if ever allowed).
  - Fail fast on violations; do not proceed with subsequent operations.

### Determinism

- **Deterministic planning**
  - Given:
    - From-contract,
    - To-contract,
    - Authoring metadata (hints, deprecations),
    - Target adapter profile,
  - Planner must produce the **same edge** (same content, same hash).

- **Canonicalization**
  - Edge headers and ops are canonicalized and hashed (as in ADR 028).
  - Any change to planner inputs or ops changes the edge hash.

- **Idempotency**
  - Each operation is classified and implemented with idempotency semantics:
    - Rerunning a successful `db update` is either a no-op or revalidates already-satisfied postconditions.

### Auditability

- **Contract marker**
  - DB marker always reflects the contract hash for which `db update` last ran successfully.

- **Migration ledger**
  - Each `db update` produces a ledger entry in the same format and table as a normal migration apply:
    - Edge header, including from/to hashes, hints used, planning strategy.
    - Environment, timestamp, status.
  - Whether an edge originated from a file on disk or was synthesized on demand by `db update`, the ledger records a uniform “from contract → to contract” state transition. This provides a durable record you can query: “what changed this DB and when?”

- **Inspectable plans**
  - Tools can render edges in a human-readable form:
    - “Add column X to table Y…”
    - “Drop deprecated column Z…”
  - This is important for review and incident analysis even if edges are not stored in Git.

---

## Extensibility: Pack-Defined Planning Operations

The planner and runner are not limited to core SQL operations; they must be **extension-aware**.

- **Extension packs define migration operations**
  - Via the existing extension migration SPI:
    - Pack-owned ops (`kind: "ext.op"`, `extId`) with schemas, pre/post rules, and executors.
  - Examples:
    - Creating extension-specific indexes (for example pgvector).
    - Managing extension-owned views/materialized views.

- **Planner can use extension ops in `db update`**
  - When the desired contract uses pack-owned constructs, and the environment has the necessary capabilities, the planner may:
    - Create or alter pack-owned objects via extension ops.
    - Apply safe changes that are analogous to core additive/widening operations.

- **Same guarantees apply**
  - Extension ops participate in:
    - Capability gating (must be declared in contract and adapter).
    - Idempotency classification.
    - Pre/post checks and canonicalization.

This ensures `db update` works not just for “vanilla SQL” but for the full ecosystem of packs, under the same safety, determinism, and auditability guarantees.

---

## Notes and Non-Goals

- **Not all changes can be auto-planned**
  - Semantic reshapes (splits/joins, enum value removal, complex data migrations) still require:
    - Explicit migrations, and/or
    - Userland data migration scripts and rollout choreography.
  - `db update` should reject such changes with actionable errors, not try to be clever. For example: `PN-CLI-4xxx: Destructive change requires on-disk migration (narrowing column type from text to varchar(10)).`

- **Migrations-on-disk remain first-class**
  - Teams can continue to use hand-authored or planner-generated migrations in Git for:
    - Regulatory and audit reasons.
    - Complex migrations that require bespoke scripts.
  - `db update` is a **new, safe default path** for the large class of evolutions that fit its rules.

- **Multiple environments**
  - Each environment maintains its own marker and progresses through:
    - Active to deprecated to deleted lifecycle at its own pace.
  - CI enforces that you do not skip phases for a given environment.

---

## Related Commands

`db update` sits alongside other contract-driven commands:

- **`prisma-next contract verify`** (`docs/Contract-Verify-Command.md`): Validates that a contract is well-formed and compatible with its family/target.
- **`prisma-next db schema verify`** (`docs/Db-Schema-Verify-Command.md`): Checks that a database’s live schema satisfies a given contract without changing the database.
- **`prisma-next db sign`** (`docs/Db-Sign-Command.md`): Writes or refreshes the contract marker for an existing database, establishing its current contract state.

Together, this defines a **contract-driven, planner-authored `db update`** story that remains faithful to the core architecture (contracts, markers, edges), but offers a migrationless ergonomic surface for a large, safe subset of schema evolution.



