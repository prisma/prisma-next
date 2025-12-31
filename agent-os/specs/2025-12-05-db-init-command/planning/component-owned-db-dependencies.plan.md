---
name: Component-Owned Database Dependencies (Data-Driven)
status: draft
owners:
  - sql-family
  - postgres-target
  - cli
---

# Component-Owned Database Dependencies (Data-Driven)

## Problem

The Postgres migration planner/runner currently hardcodes ecosystem knowledge (pgvector) via maps/special-casing. This causes:

- **Terminology conflation**: “extension” is used for both a Prisma Next *framework component* and a Postgres *database extension*.
- **Architecture violation**: targets become “fat with ecosystem knowledge” (pgvector today, postgis/pgcrypto/etc tomorrow), violating “thin targets, fat components”.
- **Planning correctness risk**: as we add subset/superset behavior (see tasks 8.1), the planner must reason about component persistence requirements in a principled way. Hardcoding will accumulate special cases or produce inconsistent conflict output as components evolve.

## Goal

Make component database dependencies **data-driven and component-owned**, by modeling them as migration operations and consuming them uniformly in:

- planner (to emit operations)
- runner (to apply operations)
- verifier (to check satisfaction)

No target should contain hardcoded mappings for pgvector (or any other ecosystem component).

## Non-goals

- Define a universal “database extension” concept (Postgres-specific).
- Fully implement subset/superset planning (this plan prepares the primitives so 8.1 can be correct).
- Build hosted/cloud module loading (preflight) in this slice.

## Current State (evidence)

Postgres target hardcodes pgvector database extension handling:

```ts
// Postgres migration planner special cases pgvector
const PG_EXTENSION_SQL: Record<string, string> = { pgvector: 'CREATE EXTENSION IF NOT EXISTS vector' };
```

SQL verification also hardcodes pgvector-ish matching and labels.

## Core Insight

“Database dependencies” are not a single universal primitive like “Postgres extensions”.

Instead: a framework component may require database-side persistence structures (extensions, schemas, functions, tables, indexes…). These can be modeled uniformly as **migration operations**.

Operations already carry everything needed:

- **precheck**: validate prerequisites / determine safety
- **execute**: make it so (prefer idempotent `IF NOT EXISTS`)
- **postcheck**: verify satisfaction (this is the verifier’s truth source)

If the planner emits these operations as part of `db init`, we can treat component persistence requirements like any other declared requirement and eliminate hardcoded maps.

## Proposed Design

### 1) Add “database dependencies” to component descriptors

Each framework component descriptor (especially extension components, but could apply to any component) may declare **database dependencies** for the target family.

Each dependency is:

- a **name/id** (stable identifier)
- a set of **install operations**

Important: we should **reuse the existing migration operation types** rather than minting new “component operation” shapes:

- Framework/core: `MigrationPlanOperation` (display-oriented base type)
- SQL family: `SqlMigrationPlanOperation<TTargetDetails>` (extends `MigrationPlanOperation` and adds `precheck/execute/postcheck` SQL steps)

```ts
type ComponentDatabaseDependency<TTargetDetails> = {
  /** Stable identifier for the dependency (e.g. 'postgres.extension.vector') */
  readonly id: string;
  /** Human label for output (e.g. 'Enable vector extension') */
  readonly label: string;
  /**
   * Operations that install/ensure the dependency.
   * Use SqlMigrationPlanOperation so we inherit the existing precheck/execute/postcheck contract.
   */
  readonly install: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  /**
   * Pure verification hook: checks whether this dependency is already installed
   * based on the in-memory schema IR (no DB I/O).
   *
   * This must return structured issues suitable for CLI and tree output, not just a boolean.
   */
  readonly verifyDatabaseDependenciesInstalled: (schema: SqlSchemaIR) => readonly SchemaIssue[];
};

type ComponentDatabaseDependencies<TTargetDetails> = {
  /**
   * Dependencies required for db init.
   * Future: update dependencies can be added later (e.g. widening/destructive).
   */
  readonly init?: readonly ComponentDatabaseDependency<TTargetDetails>[];
};
```

Where to hang this:

- Today: on the hydrated component descriptors (adapter/target/extensions) so planner can consume it without target-specific branches.
- Future: could also be emitted into `contract.extensions.<componentId>` as deterministic data, but that’s optional for this slice.

### Contract (invariant)

For each component dependency:

- `verifyDatabaseDependenciesInstalled(schemaIR)` is **pure** and checks the schema IR only.
- `install` operations are **idempotent** and safe to include in a `MigrationPlan`.

Invariant we rely on for planning/apply correctness:

- After applying dependency install operations, dependency verification should pass:

  \[
  \text{runner executes install ops} \Rightarrow \text{verifyDatabaseDependenciesInstalled(schemaIR) returns no issues}
  \]

This is what allows `db init` to plan/apply dependency installation and then confidently verify the resulting schema state.

### 2) Planner consumes database dependencies generically

In `db init` planning:

- Build a list of “active components” in composition order: `[target, adapter, ...extensions]`
- Collect `databaseDependencies.init` from each component descriptor
- For each dependency, include `dependency.install` operations in the plan (or report conflicts if unsupported)
- Emit dependency install operations before table/index/constraint operations (or in a defined phase ordering)

This replaces:

- Postgres `PG_EXTENSION_SQL` map
- `extensionDatabaseName` remapping
- any special-casing for pgvector

### 3) Verifier checks dependency satisfaction using operation postchecks

Rather than interpreting `contract.extensions` keys as “database extensions”, the verifier should:

- use the same component database dependency model (`databaseDependencies.init`)
- evaluate dependency satisfaction via **pure** schema IR checks (`verifyDatabaseDependenciesInstalled(schemaIR)`)

For Postgres, that means checking `SqlSchemaIR` facts deterministically (e.g., installed extension names),
not fuzzy matching like `pgvector` ↔ `vector`.

### 4) Introspection

Introspection should provide whatever information is needed for:

- subset/superset planning later
- richer error messages / tree output

Because verification is intended to be pure/in-memory, schema introspection must surface the facts needed to
evaluate dependency satisfaction. For Postgres extension installation this means `pg_extension` presence, but
the abstraction remains “database dependencies”, not “extensions”.

For v1:

- Ensure the introspector populates the minimal schema IR facts required by the component dependencies used in tests (pgvector as reference).
- Keep the verification logic pure and deterministic (no fuzzy matching).

## Implementation Steps

1. **Define a reusable “database dependencies” type**
   - Define `ComponentDatabaseDependency` / `ComponentDatabaseDependencies` type(s) in SQL family control-plane types (or shared framework types if appropriate).
   - Ensure the dependency references existing `SqlMigrationPlanOperation` types for the target family.
   - Define/standardize the pure verification hook name: `verifyDatabaseDependenciesInstalled(schemaIR)`.

2. **Teach pgvector component to declare its persistence requirement**
   - Move “enable vector extension” operation definition into the pgvector component descriptor (descriptor-side declaration).
   - Keep it additive and idempotent.
   - Implement pure verification for pgvector dependency satisfaction based on schema IR (no DB I/O).

3. **Update Postgres planner**
   - Remove `PG_EXTENSION_SQL`, `ADAPTER_LEVEL_EXTENSIONS`, and `extensionDatabaseName`.
   - Replace extension operation generation with “collect and emit component database dependencies”.

4. **Update verifier**
   - Remove pgvector-specific fuzzy matching and labels.
   - Verify dependency satisfaction via the pure dependency verification hook(s) against schema IR.

5. **Update tests**
   - Update migration planner tests to assert that dependency operations come from component database dependencies (not target hardcoding).
   - Add at least one test proving that adding/removing a component changes planned operations deterministically.

## “Done” Criteria

- Postgres target contains **no pgvector-specific logic**.
- Enabling vector is emitted as normal migration operations sourced from the pgvector component’s **database dependency** declaration.
- Verification uses deterministic, pure schema IR checks (no fuzzy matching like `pgvector` ↔ `vector` and no DB I/O during verify).
- Planner output remains stable and principled as more components are added.

## Notes / Naming

Use **framework component** terminology in docs and code. “Extension pack” is a delivery mechanism; “framework component” is the model.

## Documentation Deliverables (required)

When implementing this plan, update documentation so the design is discoverable and enforced:

- **Architecture docs / ADRs**: document the “database dependency” model, the pure verification hook contract, and why targets must not hardcode ecosystem knowledge.
- **READMEs**: update the relevant package READMEs (SQL family, Postgres target, pgvector component) to describe:
  - how components declare database dependencies
  - how planners consume them
  - how verification works (pure schema IR)
  - how install operations are expected to be idempotent


