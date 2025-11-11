## Slice 10 — Adopt Dependency Cruiser for Layering Enforcement (Domain: Tooling, Layer: tooling, Plane: migration)

### Context
- `scripts/check-imports.mjs` currently regex-parses every TS file under `packages/` to enforce the domain/layer/plane guardrails defined in `architecture.config.json`. It is expensive on large diffs, blind to actual module resolution, and hard to keep aligned with temporary exceptions.
- Layering violations now surface late (CI) and we cannot easily scope the check to the packages touched in a commit or lint-staged hook.
- Dependency Cruiser already solves “graph + rule” validation for JS/TS projects, supports TypeScript path resolution, and can ignore or focus specific entrypoints—exactly what we need for incremental linting.
- We plan to drop the remaining hand-coded exceptions (CLI → SQL targets/authoring) as soon as the corresponding refactors land, so the new tool should keep exceptions declarative and easy to delete.

### Goals
1. Replace `scripts/check-imports.mjs` with Dependency Cruiser while preserving the existing layering semantics (same-layer + downward allowed, upward/cross-domain/migration↔runtime imports blocked unless explicitly whitelisted).
2. Keep `architecture.config.json` as the single source of truth for package metadata—generate or load rule groups from it so we never duplicate mappings.
3. Update `pnpm lint:deps` (and the CI job that calls it) to run Dependency Cruiser, ensuring the command fails on violations and emits actionable output.
4. Enable fast, package-scoped checks for lint-staged by focusing Dependency Cruiser on the staged files’ containing packages (`depcruise --focus` / `--include-only`), so local devs do not pay repo-wide scans on every commit.
5. Remove `scripts/check-imports.mjs` and refresh `.cursor/rules/import-validation.mdc` / other docs to reference Dependency Cruiser instead of the custom script.

### Non-goals
- Rewriting the layering model or adding new domains—this is a tooling swap, not an architecture change.
- Introducing new temporary exceptions; we only carry over the ones still needed at merge time and plan to remove them quickly.
- Enforcing runtime artifact usage; Dependency Cruiser will continue to focus on code imports only.

### Deliverables
- `dependency-cruiser` plus any helper packages added to `devDependencies`, wired into the workspace via `pnpm` scripts (e.g., `pnpm lint:deps` → `depcruise ...`).
- `dependency-cruiser.config.mjs` (or `.ts`) that:
  - Loads `architecture.config.json`, derives named module groups per domain/layer/plane, and encodes the “same-layer/downward only” graph.
  - Defines explicit `forbidden` rules for cross-domain imports, migration↔runtime boundaries, and any temporary allowances (tagged with TODO + doc link).
  - Sets `options.doNotFollow` / `tsConfig` / `reporterOptions` so output matches current expectations (human-readable + CI-friendly).
- Updated lint-staged config (or helper script) that shells out to Dependency Cruiser with a focused file list.
- CI + local documentation updates: `.cursor/rules/import-validation.mdc`, README snippets, and `docs/Architecture Overview.md` references brought current.

### High-Level Approach
1. **Scaffold tooling**
   - Add Dependency Cruiser (`dependency-cruiser`) to the repo, along with a pnpm script (`"lint:deps": "depcruise --config dependency-cruiser.config.mjs"`) and ensure Turbo pipeline jobs use it.
   - Author `dependency-cruiser.config.mjs`, importing `architecture.config.json` to build module sets (e.g., `/packages/framework/core-plan/` → `framework-core`).
2. **Encode rules**
   - Translate the current script’s semantics into `forbidden` rule blocks: upward layer transitions, cross-domain imports except framework-consuming-framework, migration→runtime, runtime→migration, and any special cases (CLI ↔ SQL until removed).
   - Add TODO references to the briefs/issues that justify each exception so we know when to delete them.
3. **Integrate incremental flow**
   - Add a helper (Node script or shell snippet) that gathers staged files (`git diff --cached --name-only`) and runs `depcruise --focus` / `--include-only` on the affected package roots.
   - Wire this helper into lint-staged so pre-commit runs are scoped; document how to fall back to `pnpm lint:deps` for full checks.
4. **Remove legacy script + update docs**
   - Delete `scripts/check-imports.mjs`, replace references in docs/rules/briefs, and ensure `pnpm lint:deps` now points to Dependency Cruiser.
   - Update `.cursor/rules/import-validation.mdc` to describe the new enforcement path, linking to the config file and usage instructions.
5. **Verify + iterate**
   - Run `pnpm lint:deps`, `pnpm lint:deps -- --include-only "^packages/(framework|sql)/"` (smoke test), and any targeted runs from lint-staged to confirm behavior.
   - Adjust rule expressions until the repo is green without new regressions.

### Testing / Verification
- `pnpm lint:deps` (full repo run).
- `pnpm lint:deps -- --include-only "^packages/(...)"` for scoped checks.
- Lint-staged hook in action (`npx lint-staged`) to ensure staged-only runs pass/fail as expected.
- Optional: Dependency Cruiser JSON output consumed by CI (can diff before/after for a sanity check).

### Follow-ups
1. Remove any left-over temporary allowances once the CLI/SQL refactors land; delete the corresponding `forbidden` rule overrides.
2. Evaluate whether other repos can reuse the same config by exporting a shared helper (e.g., `./scripts/create-depcruise-config.mjs`).
3. Consider visual graph exports (`depcruise --output-type dot`) for architecture docs once the config stabilizes.
