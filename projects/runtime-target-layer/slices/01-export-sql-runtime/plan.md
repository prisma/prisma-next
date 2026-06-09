## Dispatch plan

One dispatch — a mechanical single-symbol rename plus one additive export. Recognised "surgical substrate change" shape; passes dispatch-INVEST as a single coherent outcome.

### Dispatch 1: rename SqlRuntimeImpl → SqlRuntime and export it

- **Outcome:** `SqlRuntimeImpl` is renamed to `SqlRuntime` at all reference sites and exported from `@prisma-next/sql-runtime`; `createRuntime` still returns it; behaviour unchanged.
- **Builds on:** the slice's chosen design (spec).
- **Hands to:** an exported, subclassable `SqlRuntime` family-layer class — the host for slice 2's `executeWithSessionBootstrap`.
- **Focus:** the four reference sites only — `class SqlRuntimeImpl` and the `new SqlRuntimeImpl(...)` call in `packages/2-sql/5-runtime/src/sql-runtime.ts`; the `describe(...)` label in `packages/2-sql/5-runtime/test/sql-runtime-abort.test.ts`; the comment in `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts` — plus adding `SqlRuntime` to `packages/2-sql/5-runtime/src/exports/index.ts`. No alias for the old symbol. Do **not** touch `createRuntime`'s signature/return type or add any new methods.
- **Completed when:**
  - [ ] `rg "SqlRuntimeImpl"` returns zero results across the workspace.
  - [ ] `SqlRuntime` is exported from `@prisma-next/sql-runtime` (present in `src/exports/index.ts`) and importable.
  - [ ] `pnpm --filter @prisma-next/sql-runtime typecheck` green (including the test project).
  - [ ] `pnpm --filter @prisma-next/sql-runtime test` green, with no test assertion changes beyond the renamed `describe` label.
  - [ ] `pnpm --filter @prisma-next/sql-runtime lint` clean.
  - [ ] `pnpm lint:deps` passes (public export surface changed).
- **Implementer tier:** sonnet-mid.
