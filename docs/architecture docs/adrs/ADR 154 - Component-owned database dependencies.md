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

The CLI passes a **list of configured framework components** (`frameworkComponents`) into planning/execution/verification. SQL-family code structurally narrows the components that declare `databaseDependencies` and consumes their declared dependency metadata.

The target architecture is that components own both:

- dependency declaration (`id`, `label`, `install` ops), and
- dependency verification logic (pure schema-IR evaluation that determines whether the dependency is installed).

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
- (future target architecture) component-owned verification logic (pure over `SqlSchemaIR`) that determines installed-state for that dependency

Planner and verifier stay structural consumers: they avoid target-level fuzzy matching or inference from `contract.extensionPacks`.

### Schema IR representation

`SqlSchemaIR` carries a target-agnostic `dependencies: readonly DependencyIR[]` array, where `DependencyIR = { readonly id: string }`. This replaces the earlier Postgres-specific `extensions: readonly string[]` field.

- **Introspection** (online path): the adapter maps database objects to dependency IDs. For Postgres, `pg_extension` rows are mapped using the convention `postgres.extension.<extname>`.
- **`contractToSchemaIR`** (offline path): dependency IDs are collected from active framework components' `databaseDependencies.init[].id`.
- **Planner** (current v1): uses dependency-ID presence (`requiredId ∈ schemaIR.dependencies`) to decide skip/emit for dependency install ops.

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
- Adapters still own the base introspection surfaces and conventions used to materialize schema facts (for example, Postgres `pg_extension` -> `postgres.extension.<extname>`).

### Current implementation compromise (v1)

The current implementation intentionally simplifies verification to adapter-owned ID-presence checks:

- `ComponentDatabaseDependency` no longer includes a per-dependency verify callback.
- Planner and schema verification currently use `requiredId ∈ schemaIR.dependencies`.
- For Postgres today, `schemaIR.dependencies` is populated from adapter-owned `pg_extension` introspection (`postgres.extension.<extname>`).
- This works for the current dependency set because all active dependencies are extension-shaped and map cleanly from `pg_extension`.

This is a temporary compromise, not the target architecture. When non-extension dependency shapes emerge (for example, prerequisites represented by functions, settings, or catalog/table facts), we should restore component-owned verification through component-contributed detectors/hooks that project installed-state facts into `SqlSchemaIR.dependencies`, while keeping planner/verifier matching structural.

### Known limitation (accepted for now)

The v1 model is intentionally narrow and has a known source-of-truth limitation:

- **Live path** (`db update`, `db schema-verify`): dependency IDs come from adapter introspection of the database.
- **Offline path** (`migration plan`): dependency IDs are synthesized from currently active `frameworkComponents`.

This means offline dependency evidence is currently composition-coupled and not a first-class projection derived from historical `fromContract` dependency state. The model is acceptable for extension-shaped presence checks today, but insufficient for richer extension-owned dependency semantics (for example, auth plugins that require structural or behavioral invariants beyond ID presence).

Related design issue: planner inputs are asymmetric (`from` as `SqlSchemaIR`, `to` as contract), which increases the risk that dependency semantics stay distributed across code paths instead of being represented in one canonical diff surface.

## Related

- ADR 005 — Thin Core Fat Targets
- ADR 150 — Family-Agnostic CLI and Pack Entry Points
- Subsystem: Migration System

