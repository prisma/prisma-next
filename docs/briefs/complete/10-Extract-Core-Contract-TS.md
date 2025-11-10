## Extract Core Contract-TS — Brief

### Objective

Extract the shared TS contract authoring logic from `packages/sql/authoring/sql-contract-ts` into the framework layer placeholder at `packages/framework/authoring/contract-ts`, so the authoring ring provides a reusable core for SQL, adapters, and any future target families.

### Background & Design References

- Architecture overview + layering goals: [docs/Architecture Overview.md](../Architecture%20Overview.md)
- Package-layering plan: [docs/architecture docs/Package-Layering.md](../architecture%20docs/Package-Layering.md)
- Authoring ring roadmap (sits in `.cursor/plans` and `docs/briefs/complete` slices)
- Existing SQL builder/validation implementation: `packages/sql/authoring/sql-contract-ts`
- PSL/contract-TS placeholders: [packages/framework/authoring/contract-ts](../../packages/framework/authoring/contract-ts)

### Scope

- Identify reusable pieces of the SQL contract authoring surface: builder primitives, normalization/validation helpers, mapping utilities, typing invariants, etc.
- Move those pieces into `packages/framework/authoring/contract-ts` while keeping the SQL package as the canonical consumer/exporter for the SQL integration.
- Ensure the framework package exposes the same public API surface (builder + `validateContract`/`computeMappings`) without leaking SQL-specific types.
- Preserve existing tests by updating imports to the new location where appropriate; keep SQL-specific tests and fixtures under the SQL package.
- Keep bridging shims minimal — the SQL package should re-export the framework core and any SQL-only extensions (caps, runtime metadata).

### High-Level Approach

1. Split `src/contract.ts` into a framework core (moved to `packages/framework/authoring/contract-ts/src`) and a SQL-specific layer that reuses it.
2. Adjust TS path aliases, exports, and package.json fields so both packages can be built/tested independently (`@prisma-next/contract-ts` will provide the core dist files).
3. Update the SQL package to depend on the framework package for core logic; keep any SQL-only helpers or tests within the SQL package.
4. Ensure Vitest configs and coverage targets continue to pass after the split.

### Migration Tasks

1. Create the framework package structure (if not already) and copy core files (`contract.ts`, helper modules) over.
2. Update relative imports, types, and builder logic to reference the new package layout and to avoid SQL-only dependencies.
3. Re-export the core API from `packages/framework/authoring/contract-ts/src/index.ts` and update `packages/framework/authoring/contract-ts/package.json` to match.
4. Adjust the SQL package to import from the framework core (e.g., `import { validateContract } from '@prisma-next/contract-ts/contract'`) and re-export its API under `@prisma-next/sql-contract-ts`.
5. Run `pnpm --filter @prisma-next/contracts test:coverage` (or equivalent) to confirm coverage/thresholds stay green.
6. Update docs/rules referencing contract authoring to point at the new package location where applicable.

### Acceptance Criteria

- The framework package (`@prisma-next/contract-ts`) builds/tests independently and exposes the builder/validation helpers.
- SQL-specific exports continue to work by re-exporting the framework core plus any SQL extensions.
- No functionality is lost (all previous tests pass, coverage thresholds satisfied).
- Documentation (architecture briefs, layering docs, package READMEs) references the new structure.

### Follow-ups

1. Once the extraction is done, update `docs/briefs/complete/Slice-TS-Only-Authoring-Mode.md` or related slices to reference the framework package as the canonical authoring surface.
2. Evaluate whether `@prisma-next/contract-psl` should also consume the framework core once the PSL parser is ready.
