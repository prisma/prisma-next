# ADR 154 — Component-owned database dependencies

## Context

Some framework components (targets, adapters, extensions) require database-side persistence structures that are not part of the core contract storage model, for example:

- Postgres extensions (`CREATE EXTENSION …`)
- Auxiliary schemas
- Functions / operators
- Other catalog-level prerequisites

Historically, it’s tempting to encode this knowledge in targets (e.g., hardcoding `pgvector → vector`) or to infer it from `contract.extensionPacks`. Both approaches couple low-level components to ecosystem details and lead to fragile “fuzzy matching” logic.

## Decision

Model database-side prerequisites as **component-owned database dependencies**, declared on **framework component descriptors** and consumed uniformly by:

- migration planning (`db init` planner)
- migration execution (runner + post-apply schema verification)
- pure schema verification over schema IR

The CLI passes a **list of configured framework components** (`frameworkComponents`) into planning/execution/verification. SQL-family code structurally narrows the components that declare `databaseDependencies` and evaluates their dependency hooks.

### Key constraints

- **No inference from `contract.extensionPacks`**: schema verification must not interpret `contract.extensionPacks` as database prerequisites.
- **No fuzzy matching**: matching component IDs to database facts via string heuristics is forbidden. Dependencies must be declared explicitly by components.
- **Pure verification**: dependency verification must be a pure function over the in-memory `SqlSchemaIR` (no DB I/O).
- **Idempotent install operations**: dependency install operations are migration operations with pre/post checks; they must be safe to include in an init plan.

## Model

### Database dependency

A component can declare `databaseDependencies.init`, where each dependency provides:

- a stable `id` (e.g., `postgres.extension.vector`)
- a human `label`
- `install` operations (`SqlMigrationPlanOperation`) for `db init`

Verification is generic: the planner and schema verifier check whether a dependency's `id` is present in `SqlSchemaIR.dependencies`. No per-component verification callbacks are needed.

### Schema IR representation

`SqlSchemaIR` carries a target-agnostic `dependencies: readonly DependencyIR[]` array, where `DependencyIR = { readonly id: string }`. This replaces the earlier Postgres-specific `extensions: readonly string[]` field.

- **Introspection** (online path): the adapter maps database objects to dependency IDs. For Postgres, `pg_extension` rows are mapped using the convention `postgres.extension.<extname>`.
- **`contractToSchemaIR`** (offline path): dependency IDs are collected from active framework components' `databaseDependencies.init[].id`.
- **Planner**: skips install ops for dependencies already present in `schemaIR.dependencies`; emits them for missing ones.

### Data sources

This ADR distinguishes three concepts:

- **Framework extensions / packs**: registered via config; their identity and namespace appear in `contract.extensionPacks` for type/codec/operation namespacing.
- **Database dependencies** (`DependencyIR`): a target-agnostic node in `SqlSchemaIR` representing an installed prerequisite. Populated by introspection (online) or `contractToSchemaIR` (offline).
- **Component database dependencies**: the bridge between components and schema facts, declared by components. The dependency `id` matches the `DependencyIR.id` in the schema IR.

## Consequences

### Positive

- Targets stay “thin”: no target-specific maps for ecosystem components.
- Verification is deterministic: no fuzzy matching or hidden inference.
- `db init` becomes data-driven: adding/removing components changes planned dependency ops predictably.

### Negative / tradeoffs

- Callers must consistently pass the active `frameworkComponents` list to planner/runner/verification.
- Adapters own the convention for mapping database objects to dependency IDs (e.g., Postgres uses `postgres.extension.<extname>`). Extension components must follow the adapter's convention.

### Known limitation (accepted for now)

The current detection model is intentionally limited to dependency shapes the adapter can introspect into `SqlSchemaIR.dependencies`.

- For Postgres today, this means dependency presence is based on `pg_extension` mapping (`postgres.extension.<extname>`).
- Non-`pg_extension` dependency shapes (for example, prerequisites represented by specific tables, functions, or settings) are not yet composable without additional adapter support.
- Some extension behavior is better modeled as regular contract storage (tables/columns/constraints) instead of dependency installation side effects.

This limitation is accepted for v1. A future iteration may add a component-contributed dependency detector model (or detector registry) that can project richer installed-state facts into `SqlSchemaIR.dependencies` while keeping planner/verifier logic structural (`requiredId ∈ schema.dependencies`).

## Related

- ADR 005 — Thin Core Fat Targets
- ADR 150 — Family-Agnostic CLI and Pack Entry Points
- Subsystem: Migration System

