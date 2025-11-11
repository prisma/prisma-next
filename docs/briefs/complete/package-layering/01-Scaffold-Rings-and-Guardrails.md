## Slice 1 — Scaffold Layers & Guardrails (Domains/Planes)

### Context
- Based on [Slice 12 — Package Layering & Ownership](../12-Package-Layering.md) and [ADR 140 — Package Layering & Target-Family Namespacing](../../architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md). We now use Domains → Layers → Planes: framework vs family domains; layers allow lateral + downward deps; migration and runtime planes must not import each other.
- No files have been moved yet; `@prisma-next/sql-query` still hosts contract authoring + lanes.
- Goal is to lay the groundwork so subsequent slices can move code without violating dependency rules.

### Goals
1. Create the top-level folder skeleton (`packages/core`, `packages/authoring`, `packages/lanes`, `packages/runtime`, `packages/sql`, `packages/document`, `packages/compat`, and optionally `packages/targets/<concrete>` for extension packs). Tag each package by domain/layer/plane in the guardrail config.
2. Update `pnpm-workspace.yaml` to include the new globs (even if empty) so tooling recognizes the future packages.
3. Add TypeScript path aliases + project references for the new packages (stubs pointing to placeholder `src/index.ts`).
4. Configure import guardrails enforcing Domains/Layers/Planes: same‑layer + downward allowed; upward denied; migration→runtime imports denied; cross‑domain imports denied except into framework.
5. Add a CI-safe import-graph check by wiring a `pnpm lint:deps` command that runs `madge` (or Dependency Cruiser) against the TypeScript sources and fails on inward/circular dependencies. This is mandatory—manual checks are not acceptable after this slice.
6. Do **not** move existing code; this slice should be purely scaffolding + guardrails.

### Non-goals / Out of Scope
- Moving any source files or updating existing package names.
- Editing build/test pipelines beyond adding the guardrail steps.
- Rewriting exports or deleting anything from `@prisma-next/sql-query`.

### Deliverables
- Empty (or placeholder) package folders with minimal `package.json`, `src/index.ts`, and `tsconfig.json` files so tooling resolves path aliases.
- Updated `pnpm-workspace.yaml`, `tsconfig.base.json`, `turbo.json` (if needed), and `.eslintrc` / `biome` / `lint-staged` configs to recognize new packages.
- A `pnpm lint:deps` (or similarly named) script wired into CI that fails when dependency direction is violated, driven by `architecture.config.json`.

### Step Outline
1. Create skeleton directories and placeholder files (`src/index.ts` exporting nothing yet).
2. Register new packages in workspace + tsconfig paths.
3. Introduce ESLint path restrictions and/or `madge` rule.
4. Update docs (if necessary) pointing to the new guardrail command.
5. Run lint + typecheck to ensure scaffolding is accepted.

### Testing / Verification
- `pnpm lint`
- `pnpm typecheck` (or `pnpm --filter ./... typecheck` depending on tooling)
- `pnpm lint:deps`

### Notes
- Keep placeholder packages private (`"private": true`) until populated.
- Document any temporary suppressions so the next slice can clean them up immediately.
