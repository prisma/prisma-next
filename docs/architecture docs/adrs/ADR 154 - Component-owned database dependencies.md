# ADR 154 — Component-owned database dependencies

## Context

Some framework components (targets, adapters, extensions) require database-side persistence structures that are not part of the core contract storage model, for example:

- Postgres extensions (`CREATE EXTENSION …`)
- Auxiliary schemas
- Functions / operators
- Other catalog-level prerequisites

Historically, it’s tempting to encode this knowledge in targets (e.g., hardcoding `pgvector → vector`) or to infer it from `contract.extensions`. Both approaches couple low-level components to ecosystem details and lead to fragile “fuzzy matching” logic.

## Decision

Model database-side prerequisites as **component-owned database dependencies**, declared on **framework component descriptors** and consumed uniformly by:

- migration planning (`db init` planner)
- migration execution (runner + post-apply schema verification)
- pure schema verification over schema IR

The CLI passes a **bag of configured framework components** (`frameworkComponents`) into planning/execution/verification. SQL-family code structurally narrows the components that declare `databaseDependencies` and evaluates their dependency hooks.

### Key constraints

- **No inference from `contract.extensions`**: schema verification must not interpret `contract.extensions` as database prerequisites.
- **No fuzzy matching**: matching component IDs to database facts via string heuristics is forbidden. Dependencies must be declared explicitly by components.
- **Pure verification**: dependency verification must be a pure function over the in-memory `SqlSchemaIR` (no DB I/O).
- **Idempotent install operations**: dependency install operations are migration operations with pre/post checks; they must be safe to include in an init plan.

## Model

### Database dependency

A component can declare `databaseDependencies.init`, where each dependency provides:

- a stable `id` (e.g., `postgres.extension.vector`)
- a human `label`
- `install` operations (`SqlMigrationPlanOperation`) for `db init`
- `verifyDatabaseDependencyInstalled(schemaIR)` — pure verification hook producing `SchemaIssue[]`

### Data sources

This ADR distinguishes three concepts:

- **Framework extensions / packs**: registered via config; their identity and namespace appear in `contract.extensions` for type/codec/operation namespacing.
- **Database extensions** (Postgres): introspected into `SqlSchemaIR.extensions` as a database fact.
- **Database dependencies**: the bridge between components and schema facts, declared by components and verified via pure hooks.

## Consequences

### Positive

- Targets stay “thin”: no target-specific maps for ecosystem components.
- Verification is deterministic: no fuzzy matching or hidden inference.
- `db init` becomes data-driven: adding/removing components changes planned dependency ops predictably.

### Negative / tradeoffs

- Callers must consistently pass the active `frameworkComponents` bag to planner/runner/verification.
- Some schema IR fields may have target-specific vocabulary (e.g., `extensions` for Postgres); this is acceptable as long as the CLI remains family-agnostic and no inference is performed.

## Related

- ADR 005 — Thin Core Fat Targets
- ADR 150 — Family-Agnostic CLI and Pack Entry Points
- Subsystem: Migration System

