## Slice 7 — Remove Legacy Packages & Clean Up

### Context
- By the end of Slice 6, every functional area has its own package, but we still have transitional shims (`@prisma-next/sql-query`, `@prisma-next/runtime`, legacy path aliases) kept around to avoid massive code churn mid-migration.
- There are no external consumers, so we can safely delete those shims once all internal imports point to the new packages.
- This slice also finalizes documentation: the README must explain the Clean Architecture rings (with a Mermaid diagram) so contributors immediately understand the structure.
- Think of this slice as the “stabilization” pass: remove dead code, update docs, and ensure lint/dependency guardrails see a clean graph.

### Goals
1. **Remove legacy packages/facades**
   - Delete `packages/sql-query` entirely (or leave a trivial readme linking to the new packages if needed for npm history).
   - Remove `@prisma-next/runtime`’s transitional re-exports; callers must import `@prisma-next/runtime-core` or `@prisma-next/sql-runtime` directly.
   - Delete any other transitional modules introduced in prior slices (e.g., old exports directories, TODO-labeled bridges).

2. **Purge obsolete path aliases / workspace entries**
   - Update `tsconfig.base.json`, `pnpm-workspace.yaml`, `turbo.json`, and scripts to remove references to deleted packages.
   - Ensure `pnpm lint:deps` reports zero violations and that no code imports from the legacy packages.

3. **Update documentation**
   - Architecture Overview, ADR 140, Slice 12 brief, and any reference docs must mention only the new package names.
   - Add a “Clean Architecture Rings” section to the root `README.md`:
     - Brief explanation referencing Clean Architecture.
     - Bulleted ring order (core → authoring → targets → lanes → runtime core → family runtime → adapters → compat).
     - Mermaid diagram showing the rings and allowed dependency directions.
     - Links to ADR 140 and the Package Layering doc.

4. **Ensure tests/linting all pass in the final layout**
   - Full unit/integration/e2e test matrix must pass without relying on legacy packages.
   - `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`, and `pnpm test` should succeed on a clean working tree.

### Non-goals
- Introducing new features or refactors. This slice is purely cleanup/documentation.
- Rewriting examples beyond updating import paths.

### Deliverables
- Legacy packages removed (git history preserved via directory deletions).
- Clean configuration files reflecting the new package names only.
- README updated with the rings section + Mermaid diagram.
- Docs (Architecture Overview, ADR 140, Slice 12, reference guides) updated to mention the final structure.
- Guardrail script (`pnpm lint:deps`) reports zero violations.

### Step Outline
1. **Search & replace imports**
   - Use `rg` to find `@prisma-next/sql-query`, `@prisma-next/runtime`, and other legacy imports.
   - Update each occurrence to point to `@prisma-next/sql-lane`, `@prisma-next/sql-orm-lane`, `@prisma-next/sql-contract-ts`, `@prisma-next/sql-runtime`, etc.

2. **Delete legacy directories**
   - Remove `packages/sql-query`, `packages/runtime` (if it becomes empty), and any other transitional folders.
   - Remove associated config files (tsconfig, vitest configs) tied to those packages.

3. **Clean configs**
   - Update `tsconfig.base.json`, `pnpm-workspace.yaml`, `turbo.json`, `package.json` scripts, and CI workflows to remove references to deleted packages.
   - Ensure new packages remain in the workspace lists.

4. **Documentation pass**
   - Update README with the rings section + diagram.
   - Update docs/briefs, ADR references, and any onboarding material to reflect the final package names.

5. **Run verification commands**
   - `pnpm lint`, `pnpm lint:deps`, `pnpm typecheck`, `pnpm test`, plus targeted example/e2e suites.

### Testing / Verification
- `pnpm lint`
- `pnpm lint:deps`
- `pnpm typecheck`
- `pnpm test` (or `turbo run test`)
- `pnpm --filter @prisma-next/e2e-tests test`
- `pnpm --filter examples/prisma-next-demo test` (or relevant examples)

### Notes
- Delete directories rather than moving them again to keep history readable.
- Reference ADR 140 and Slice 12 in the README section so contributors can dive deeper if needed.
- Once this slice lands, the repo should have zero TODOs referencing “remove after slice X” regarding package moves.
