## Slice 7 — Remove Legacy Packages & Clean Up

### Context
- After Slices 2–6, new packages exist but transitional re-exports (e.g., `@prisma-next/sql-query`, `@prisma-next/runtime`) may still be present for compatibility.
- There are no external consumers, so we can remove the shims once all internal imports are updated.

### Goals
1. Remove or significantly slim the legacy `@prisma-next/sql-query` package, replacing it with thin facades (or deleting it if unused).
2. Remove transitional exports from `@prisma-next/runtime` by pointing callers directly at `@prisma-next/runtime-core` or `@prisma-next/sql-runtime` as appropriate.
3. Delete deprecated path aliases and TODO comments introduced in earlier slices.
4. Update documentation (Architecture Overview, reference guides, README, examples) to use the new package names exclusively.
5. Ensure all tests (unit/integration/e2e) pass without the old packages.
6. Add a "Clean Architecture Rings" section to the root `README.md`, referencing Clean Architecture, listing the ring order, and embedding a Mermaid diagram depicting the rings and dependency direction.

### Non-goals
- Introducing new features or refactors; this is strictly a cleanup slice.
- Rewriting examples beyond updating imports.

### Deliverables
- Removal (or stub) of `packages/sql-query` and other obsolete directories.
- Updated docs referencing the new packages.
- Clean dependency graph (no references to legacy paths).

### Step Outline
1. Search for imports from `@prisma-next/sql-query` or `@prisma-next/runtime` and replace them with the new packages.
2. Remove the legacy packages + build configs.
3. Update docs/examples and ensure `pnpm lint`, `pnpm test`, and `pnpm typecheck` pass.
4. Remove transitional path aliases + workspace entries.
5. Update `README.md` with the rings section + diagram, linking back to ADR 140 / Architecture Overview.

### Testing / Verification
- Full test matrix (`pnpm test`, e2e, integration).
- Lint/typecheck/guardrail commands.

### Notes
- Keep git history readable by deleting whole directories rather than moving files around at this stage.
- Update ADR 140 / Slice 12 doc if the final structure deviates during implementation, and ensure the new README section references those docs.
