## Project Brief — Adopt Domains, Layers, and Planes (and Align Guardrails)

### Context

We are simplifying our architectural model to be: Domains → Layers → Planes.

- Domains: framework (target‑agnostic) plus one branch per target family (SQL today, others later).
- Layers: a small set of responsibility layers. Layers allow lateral and downward deps, never upward.
- Planes: migration/authoring (build time) vs runtime/query (run time). Migration plane must not import runtime code; runtime consumes artifacts (contracts, manifests), not code, from migration.

This brief updates docs, guardrails, and READMEs to reflect the new terminology and enforceable rules, replacing prior “rings only” phrasing.

### Goals

1. Update architecture docs and slice briefs to use Domains/Layers/Planes terminology and rules.
2. Add clear trees for the Framework and SQL domains so contributors know where new code belongs.
3. Replace the bespoke import guard with a data‑driven configuration that enforces: lateral + downward only within a domain, migration→runtime imports forbidden, cross‑domain imports forbidden except into framework.
4. Refresh package READMEs/descriptions to label each package with its domain, layer, and plane.

### Non‑Goals

- Changing any public APIs (lanes, runtime, CLI) as part of this brief.
- Removing legacy packages (that’s covered by Slice 7 cleanup).

### Deliverables

- Docs updated: `docs/architecture docs/Package-Layering.md`, Slice 12 and 01–07 briefs, ADR 140 wording.
- New guardrail config: `architecture.config.json` at repo root.
- Updated `scripts/check-imports.mjs` to load config and enforce the new rules.
- READMEs in key packages (runtime, relational-core, adapter-postgres, sql-contract-ts) annotated with Domain/Layer/Plane.

### Domain and Layer Trees (for reference)

Framework (target‑agnostic)

```
* framework
|-- core
|   |-- @prisma-next/contract
|   |-- @prisma-next/plan
|   |-- @prisma-next/operations
|-- authoring
|   |-- @prisma-next/contract-authoring
|   |-- @prisma-next/contract-ts (future)
|   |-- @prisma-next/contract-psl (future)
|   |-- tooling
|   |   |-- @prisma-next/cli
|   |   |-- @prisma-next/emitter
|   |   |-- guardrail/lint packages
|   |-- runtime-core
|       |-- @prisma-next/runtime-core (target-neutral execution kernel)
```

SQL Target Family

```
* sql target family
|-- authoring (migration plane)
|   |-- @prisma-next/sql-contract-ts
|-- targets (migration→runtime boundary)
|   |-- @prisma-next/sql-contract-types
|   |-- @prisma-next/sql-operations
|   |-- @prisma-next/sql-contract-emitter
|   |-- (legacy) @prisma-next/sql-target
|-- lanes (runtime plane)
|   |-- @prisma-next/sql-relational-core
|   |-- @prisma-next/sql-lane
|   |-- @prisma-next/sql-orm-lane
|   |-- (legacy) @prisma-next/sql-query
|-- runtime (query plane)
|   |-- @prisma-next/sql-runtime (planned; runtime code currently in @prisma-next/runtime)
|-- adapters / compat (query plane)
    |-- @prisma-next/adapter-postgres
    |-- @prisma-next/driver-postgres
    |-- @prisma-next/compat-prisma
```

### Migration Planning & Apply — Where It Lives

We split migration responsibilities by what is generic vs family‑specific, and by plane:

- Framework Tooling (migration plane)
  - Owns the family‑agnostic planner engine: load current/next contracts, diff them at a neutral IR level, orchestrate ordering and policy checks.
  - Delegates to family hooks for concrete operations (e.g., SQL may split DDL into phased ops).
  - Produces framework plan artifacts (edges, ops) using `@prisma-next/plan` types so downstream tools can inspect without importing family code.

- Family Targets (migration plane)
  - Own the family‑specific operation vocabulary and manifests: e.g., `@prisma-next/sql-operations`, plus DDL types in `@prisma-next/sql-contract-types`.
  - Provide planner hooks that map framework diffs to concrete family ops, and emitter hooks to validate/emit family artifacts.

- Apply (tooling orchestrates, runtime executes)
  - Tooling coordinates apply/verify/policy but does not import adapters directly.
  - Execution crosses the plane boundary through the runtime SPI: Tooling calls `@prisma-next/runtime-core` interfaces; the family runtime (`@prisma-next/sql-runtime`) implements those and uses adapters/drivers to talk to the database.

Rules to enforce
- Framework tooling must not import family runtimes/adapters; it only consumes family hooks from the Targets layer.
- Apply uses the runtime SPI only; no direct adapter imports from tooling.
- Family‑specific ops vocabulary stays in Targets; execution stays in Runtime/Adapters.

### Dependency Rules (enforced by guardrails)

- Within a domain, layers may depend laterally (same layer) and downward (toward core), but never upward.
- Migration plane (authoring, tooling, targets) must not import runtime‑plane code.
- Runtime plane may consume artifacts (contracts, manifests) from migration, but not code imports from authoring/tooling internals.
- Cross‑domain imports are forbidden except into the framework domain.

### Guardrails — Config and Script

1) Add `architecture.config.json` (domain/layer/plane mapping):

```
{
  "packages": [
    { "glob": "packages/core/**",                 "domain": "framework", "layer": "core",          "plane": "shared" },
    { "glob": "packages/authoring/**",            "domain": "framework", "layer": "authoring",     "plane": "migration" },
    { "glob": "packages/cli/**",                  "domain": "framework", "layer": "tooling",       "plane": "migration" },
    { "glob": "packages/emitter/**",              "domain": "framework", "layer": "tooling",       "plane": "migration" },
    { "glob": "packages/runtime/core/**",         "domain": "framework", "layer": "runtime-core",  "plane": "runtime" },

    { "glob": "packages/targets/sql/**",          "domain": "sql",       "layer": "targets",      "plane": "migration" },
    { "glob": "packages/sql/authoring/**",        "domain": "sql",       "layer": "authoring",    "plane": "migration" },
    { "glob": "packages/sql/lanes/**",            "domain": "sql",       "layer": "lanes",        "plane": "runtime" },
    { "glob": "packages/sql/sql-runtime/**",      "domain": "sql",       "layer": "runtime",      "plane": "runtime" },
    { "glob": "packages/sql/postgres/**",         "domain": "sql",       "layer": "adapters",     "plane": "runtime" },
    { "glob": "packages/compat/**",               "domain": "sql",       "layer": "adapters",     "plane": "runtime" }
  ],
  "rules": {
    "sameLayer": "allow",
    "downward": "allow",
    "upward": "deny",
    "crossDomain": "denyExceptFramework",
    "migrationToRuntime": "deny",
    "runtimeToMigration": "allowArtifactsOnly"
  }
}
```

2) Rewrite `scripts/check-imports.mjs` to:

- Load `architecture.config.json` and map each file to {domain, layer, plane} based on glob matches.
- Resolve imports using TS path aliases and each target package.json `name` field.
- Enforce:
  - Lateral (same layer) and downward (toward core) allowed; upward denied.
  - Cross‑domain denied except when importing framework packages.
  - Migration→runtime code imports denied.
  - Runtime→migration code imports denied; artifact consumption is out‑of‑band (JSON/manifest), not direct imports.
- Provide a changed‑files mode for pre‑commit and a full scan for CI (`pnpm lint:deps`).

### Docs and Briefs to Update

- `docs/architecture docs/Package-Layering.md`: adopt Domains/Layers/Planes, include both trees, clarify rules.
- `docs/briefs/12-Package-Layering.md`: terminology + rules refresh; note that family authoring (`sql-contract-ts`) may depend on family targets (`sql-contract-types`).
- Slice briefs 01–07: replace “rings” with “layers/domains/planes”; keep steps intact.
- ADR 140: update wording to reflect domains/layers/planes model.

### READMEs to Annotate

- `packages/runtime/README.md` (until split): mark planned move to `@prisma-next/runtime-core`; label Domain: framework, Layer: runtime-core (planned), Plane: runtime.
- `packages/sql/lanes/relational-core/README.md`: Domain: sql, Layer: lanes, Plane: runtime.
- `packages/sql/authoring/sql-contract-ts/README.md`: Domain: sql, Layer: authoring, Plane: migration.
- `packages/sql/postgres/postgres-adapter/README.md`: Domain: sql, Layer: adapters, Plane: runtime.

### Step Outline

1. Update docs/briefs/ADRs with new terminology and trees.
2. Add `architecture.config.json` and refactor `scripts/check-imports.mjs` to use it.
3. Update `.husky/pre-commit` to run the script in changed‑files mode; keep `pnpm lint:deps` in CI.
4. Add domain/layer/plane badges/sections to the key READMEs.
5. Run full `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`, and the package test suites.

### Acceptance Criteria

- Docs consistently use Domains/Layers/Planes with clear framework + SQL trees and rules.
- Guardrail script enforces the new rules and passes on the repo.
- READMEs annotate packages with domain/layer/plane.
- No new migration→runtime or cross‑domain infractions; ORM→SQL‑lane import remains blocked per Slice 04a.
