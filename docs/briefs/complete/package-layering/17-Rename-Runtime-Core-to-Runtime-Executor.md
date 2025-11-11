## Slice 17 — Rename Runtime-Core to Runtime-Executor (Domain: Framework, Layer: runtime, Plane: runtime)

### Context
- The term "runtime-core" collides with "Core" (the innermost layer in layer order) and causes ambiguity in code reviews and docs. Developers intuitively associate "core" with the core layer, but the package actually lives in the runtime layer.
- The package owns orchestration of query execution (hash checks, plugins/lints/budgets, adapter coordination, codecs) — it is the execution engine, not a core layer.

### Decision
- Rename the layer and package from "runtime-core" to "runtime-executor".
- Introduce the `Executor` class (or `QueryExecutor`) as the primary public API of the package.

### Goals
1. Disambiguate naming: "executor" clearly denotes execution/orchestration and avoids "core" overload.
2. Preserve downward dependency direction (lanes → runtime-executor → adapters/drivers).
3. Minimize churn by maintaining a short-lived re-export under the old name.

### Non-Goals
- Changing adapter/driver SPIs or the plugin system.
- Reworking query lanes or SQL family packages.

### Deliverables
- Layer label and package rename:
  - Layer label: `runtime-core` → `runtime-executor`.
  - Package path: `packages/framework/runtime-core/**` → `packages/framework/runtime-executor/**`.
  - Package name: `@prisma-next/runtime-core` → `@prisma-next/runtime-executor`.
- Optional compatibility shim: publish a transitional `@prisma-next/runtime-core` that re-exports from `@prisma-next/runtime-executor` (one release cycle).
- Updated docs: Architecture Overview, Agent Onboarding, package READMEs.
- Updated config: `architecture.config.json` and dep-cruise rules reflect the new label and globs.

### Responsibilities (runtime-executor)
- Verify `coreHash`/`profileHash` against marker.
- Enforce capability gates (e.g., returning, includeMany).
- Orchestrate plugins/lints/budgets pre/post execution.
- Prepare/execute statements via adapters; stream rows; decode via codecs.

### Proposed API Sketch
```ts
export interface AdapterCapabilities { returning: boolean; includeMany: boolean; [k: string]: boolean }
export interface PreparedStatement { sql: string; params: unknown[] }
export interface ExecutionResult<Row = unknown> { rows: AsyncIterable<Row>; rowCount?: number }

export class Executor {
  constructor(opts: { adapter: RuntimeAdapter; codecs: CodecRegistry; plugins?: RuntimePlugin[]; logger?: Logger }) {}
  prepare(plan: Plan): PreparedStatement {}
  execute<Row = unknown>(planOrStmt: Plan | PreparedStatement): Promise<ExecutionResult<Row>> {}
  close(): Promise<void> {}
}
```

### Architecture Config Changes
- Update layer order and package map in `architecture.config.json`:
  - `layerOrder.framework`: replace `"runtime-core"` with `"runtime-executor"`.
  - Update/replace any package entries pointing to `packages/framework/runtime-core/**` with `packages/framework/runtime-executor/**` and set `layer: "runtime-executor"`.

### Dependency Cruiser Changes
- Update config patterns to match the new path and layer name.
- No rule semantic changes: lanes may depend downward on runtime-executor; runtime-executor depends on adapters/drivers; no upward imports allowed.

### Docs Changes
- Architecture Overview: replace "Runtime-core" with "Runtime executor"; describe it as the execution engine hosting plugins and adapters.
- AGENT_ONBOARDING: update domain/layer descriptions and commands.
- Package README: explain responsibilities and public API (`Executor`).

### Migration Plan
1. Copy/rename directory `packages/framework/runtime-core` → `packages/framework/runtime-executor`.
2. Update `package.json` name to `@prisma-next/runtime-executor`; add a deprecation note in `README.md`.
3. Adjust tsconfig path aliases and references (turbo pipeline scopes if any).
4. Update imports across the repo (`rg -n "@prisma-next/runtime-core"`) to `@prisma-next/runtime-executor`.
5. Update `architecture.config.json` layer order and package entries; run `pnpm lint:deps` to verify layering.
6. Update dep-cruise config globs/labels if hard-coded.
7. Docs sweep: Architecture Overview, AGENT_ONBOARDING, package READMEs.
8. Optionally publish a transient `@prisma-next/runtime-core` that re-exports from `@prisma-next/runtime-executor` for a single cycle; then remove.

### Acceptance Criteria
- No remaining imports of `@prisma-next/runtime-core` in repo code.
- `architecture.config.json` uses `runtime-executor` in layer order and package map.
- `pnpm lint:deps` passes; no new exceptions added.
- Docs updated; the role of "Runtime executor" is clear and distinct from the "Core" layer.

### Risks and Mitigations
- Import churn: mitigate with a transient re-export and automated search/replace.
- External references: clearly document the rename in CHANGELOG/README; keep the shim for one cycle if needed.
- Reader confusion: add a one-liner definition near the first mention — "Runtime executor: execution engine that verifies, plans, and orchestrates adapters and plugins".

