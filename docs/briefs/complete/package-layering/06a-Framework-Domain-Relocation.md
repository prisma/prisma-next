## Slice 06a — Framework Domain Relocation (Domains/Layers/Planes)

### Context
We’ve completed Slice 05 (SQL Targets split). Before extracting the runtime kernel in Slice 06, we want the filesystem to reflect Domains → Layers → Planes explicitly. That means giving the framework domain a first‑class root (symmetry with `packages/sql/**`) while keeping published package names unchanged.

This is a pure path/layout refactor: no API changes, no behavior changes. It reduces future churn by letting Slice 06 write the runtime kernel directly to `packages/framework/runtime-core` and clarifies where framework code lives.

### Goals
- Move target‑agnostic packages under a `packages/framework/**` domain root.
- Keep published package names the same (no changes to `package.json#name`).
- Update workspace globs, TS path aliases, guardrails (architecture.config.json), and scripts accordingly.
- Keep everything building and green without modifying downstream imports in examples/tests.

### Domain / Layer / Plane
- Domain: framework
- Layers moved in this slice: core, authoring, tooling (migration plane); (runtime‑core folder will be used by Slice 06)
- Plane: migration (authoring/tooling) + shared (core); runtime‑core will be populated in Slice 06

### Filesystem changes (paths → published names stay the same)

Move the following directories (git mv to preserve history):

- Core (target‑agnostic types)
  - `packages/core/contract` → `packages/framework/core-contract` → `@prisma-next/contract`
  - `packages/core/plan` → `packages/framework/core-plan` → `@prisma-next/plan`
  - `packages/core/operations` → `packages/framework/core-operations` → `@prisma-next/operations`

- Authoring (framework, migration plane)
  - `packages/authoring/contract-authoring` → `packages/framework/authoring/contract-authoring` → `@prisma-next/contract-authoring`
  - `packages/authoring/contract-ts` → `packages/framework/authoring/contract-ts` → `@prisma-next/contract-ts`
  - `packages/authoring/contract-psl` → `packages/framework/authoring/contract-psl` → `@prisma-next/contract-psl`

- Tooling (framework, migration plane)
  - `packages/cli` → `packages/framework/tooling/cli` → `@prisma-next/cli`
  - `packages/emitter` → `packages/framework/tooling/emitter` → `@prisma-next/emitter`

- Runtime core (framework, runtime plane)
  - If present: `packages/runtime/core` → `packages/framework/runtime-core` → `@prisma-next/runtime-core`
  - Otherwise, Slice 06 will create `packages/framework/runtime-core`

### Config updates
- `pnpm-workspace.yaml`
  - Replace `packages/core/*`, `packages/authoring/*`, `packages/cli`, `packages/emitter`, `packages/runtime/core` globs with `packages/framework/**` equivalents.

- `tsconfig.base.json` (paths)
  - Update framework paths, e.g.:
    - `"@prisma-next/contract": ["packages/framework/core-contract/src/index.ts"]`
    - `"@prisma-next/plan": ["packages/framework/core-plan/src/index.ts"]`
    - `"@prisma-next/operations": ["packages/framework/core-operations/src/index.ts"]`
    - `"@prisma-next/contract-authoring": ["packages/framework/authoring/contract-authoring/src/index.ts"]`
    - `"@prisma-next/contract-psl": ["packages/framework/authoring/contract-psl/src/index.ts"]`
    - `"@prisma-next/cli": ["packages/framework/tooling/cli/src/exports/index.ts"]`
    - `"@prisma-next/emitter": ["packages/framework/tooling/emitter/src/exports/index.ts"]`
    - `"@prisma-next/runtime-core": ["packages/framework/runtime-core/src/index.ts"]` (Slice 06)

- `architecture.config.json`
  - Update framework mappings: `{ "glob": "packages/framework/**", "domain": "framework", ... }` per layer/plane.

- `scripts/check-imports.mjs`
  - Ensure domain/layer/plane resolution uses the updated globs.

- `turbo.json` / CI config
  - Update pipeline patterns if they reference old paths.

### Step Outline
1. Create `packages/framework/**` directories and git mv the listed packages.
2. Update workspace globs, TS path aliases, turbo pipeline, architecture.config.json, and check-imports to the new paths.
3. Build/test/lint:
   - `pnpm -w build`
   - `pnpm -w test`
   - `pnpm lint`, `pnpm typecheck`, `pnpm lint:deps`
4. Spot check examples resolve `@prisma-next/*` imports correctly (published names unchanged).

### Acceptance Criteria
- All framework packages live under `packages/framework/**` with their published names unchanged.
- Builds, tests, and lints pass at the workspace root and in examples.
- Guardrails (lint:deps) map the framework domain via `packages/framework/**` globs and report zero violations.
- Slice 06 can write runtime kernel code to `packages/framework/runtime-core` directly.

### Notes
- This is an organizational refactor only; no API changes.
- If any package has deep relative imports, fix them to use local barrel exports or `@prisma-next/*` paths after the move.
