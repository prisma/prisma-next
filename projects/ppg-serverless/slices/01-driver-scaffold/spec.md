# Slice: Driver package scaffold + `@prisma/ppg` catalog entry

_Parent project: [`projects/ppg-serverless/`](../../). Outcome this slice contributes: the new driver package exists in the right place in the layering graph, with `@prisma/ppg` pinned in the workspace catalog, so subsequent slices can fill in the runtime without fighting topology or version drift._

## At a glance

Create `packages/3-targets/7-drivers/ppg-serverless/` as a buildable, lintable, layering-clean package whose only export is a placeholder `./runtime` descriptor (`familyId: 'sql'`, `targetId: 'postgres'`). Pin `@prisma/ppg` at exact `1.0.1` in `pnpm-workspace.yaml`'s catalog, and consume it from the new package's `dependencies` (as `"@prisma/ppg": "catalog:"`) so `cleanupUnusedCatalogs` doesn't strip the entry before Slice 2 starts importing it.

## Chosen design

The scaffold mirrors `@prisma-next/driver-postgres` shape-for-shape, with three deliberate deltas:

| Surface | `driver-postgres` | `driver-ppg-serverless` (this slice) |
|---|---|---|
| `package.json` exports | `./control`, `./runtime`, `./package.json` | `./runtime`, `./package.json` only (D4) |
| `tsdown.config.ts` entry | `['src/exports/control.ts', 'src/exports/runtime.ts']` | `['src/exports/runtime.ts']` |
| Runtime deps | `pg` (catalog), `pg-cursor` | `@prisma/ppg` (catalog) — no `pg` / `pg-cursor` / `@types/pg` (NFR2) |

Everything else (tsconfigs, biome config, vitest config, common framework deps, the `descriptor-meta` pattern) is copied verbatim and renamed.

### Package layout

```
packages/3-targets/7-drivers/ppg-serverless/
├── README.md
├── biome.jsonc
├── package.json
├── tsconfig.json
├── tsconfig.prod.json
├── tsdown.config.ts
├── vitest.config.ts
└── src/
    ├── core/
    │   └── descriptor-meta.ts
    └── exports/
        └── runtime.ts
```

### `src/core/descriptor-meta.ts`

```ts
export const ppgServerlessDriverDescriptorMeta = {
  kind: 'driver',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'ppg-serverless',
  version: '0.0.1',
  capabilities: {},
} as const;
```

Same `familyId` / `targetId` as the TCP driver (the spec calls this out: the target pack and adapter are reused), but a distinct driver `id` so the descriptor is identifiable in logs / telemetry.

### `src/exports/runtime.ts` (placeholder)

A minimal `RuntimeDriverDescriptor<'sql', 'postgres', ..., ...>` whose `create()` returns an object that throws `"not implemented yet"` on every `SqlDriver` method. The descriptor compiles against `@prisma-next/framework-components/execution` and `@prisma-next/sql-relational-core/ast`, so the layering wiring is exercised; the runtime behaviour comes in Slice 2.

The placeholder ships no `PpgBinding` type yet — Slice 2 introduces it alongside the real implementation.

### `package.json` shape

```jsonc
{
  "name": "@prisma-next/driver-ppg-serverless",
  "version": "0.11.0",
  "license": "Apache-2.0",
  "type": "module",
  "sideEffects": false,
  "scripts": { /* identical to driver-postgres */ },
  "dependencies": {
    "@prisma-next/contract": "workspace:0.11.0",
    "@prisma-next/errors": "workspace:0.11.0",
    "@prisma-next/framework-components": "workspace:0.11.0",
    "@prisma-next/sql-contract": "workspace:0.11.0",
    "@prisma-next/sql-errors": "workspace:0.11.0",
    "@prisma-next/sql-operations": "workspace:0.11.0",
    "@prisma-next/sql-relational-core": "workspace:0.11.0",
    "@prisma-next/utils": "workspace:0.11.0",
    "@prisma/ppg": "catalog:",
    "arktype": "^2.2.0"
  },
  "devDependencies": { /* test-utils, tsconfig, tsdown, typescript, vitest — no @types/pg, no pg-mem */ },
  "exports": {
    "./runtime": "./dist/runtime.mjs",
    "./package.json": "./package.json"
  }
}
```

### `pnpm-workspace.yaml` catalog delta

```diff
 catalog:
   '@prisma/dev': 0.24.7
+  '@prisma/ppg': 1.0.1
   '@types/node': 25.6.0
```

Exact pin (no caret), per FR4 ("Early Access — breakage must be visible at upgrade time").

### `architecture.config.json` delta

Two new entries beside the existing `driver-postgres` entries:

```jsonc
{
  "glob": "packages/3-targets/7-drivers/ppg-serverless/src/core/**",
  "domain": "targets",
  "layer": "drivers",
  "plane": "shared"
},
{
  "glob": "packages/3-targets/7-drivers/ppg-serverless/src/exports/runtime.ts",
  "domain": "targets",
  "layer": "drivers",
  "plane": "runtime"
}
```

(No `control.ts` entry — D4.)

## Coherence rationale

One package shell + the catalog entry that shell depends on. The catalog entry alone would be removed by `cleanupUnusedCatalogs: true` at the next install; the package shell alone would either fail `pnpm install` (no catalog resolution for `"@prisma/ppg": "catalog:"`) or force the next slice to bundle catalog plumbing into its own diff. Landing them together is the smallest coherent reviewable unit; rollback is `git rm -rf packages/3-targets/7-drivers/ppg-serverless` plus reverting the catalog + architecture-config hunks.

## Scope

**In:**
- `packages/3-targets/7-drivers/ppg-serverless/` package directory (all files listed above).
- `@prisma/ppg: 1.0.1` entry in `pnpm-workspace.yaml`'s `catalog:` block.
- Two new entries in `architecture.config.json` for the new package's `src/core/**` and `src/exports/runtime.ts`.
- Brief `README.md` for the new package (Package Classification, one-paragraph Overview noting Slice-2-pending status, copy of the `descriptor + connect` usage block adapted to PPG bindings).

**Out:**
- Any real `SqlDriver` implementation (the placeholder throws). → Slice 2.
- The `PpgBinding` type union and `{ kind: 'url' } | { kind: 'ppgClient' }` discrimination. → Slice 2.
- `normalize-error.ts`. → Slice 2.
- Facade package `@prisma-next/prisma-postgres-serverless`. → Slice 4.
- Integration tests against `@prisma/dev`. → Slice 6.
- Updates to `docs/onboarding/Repo-Map-and-Layering.md`. → Slice 6 (close-out).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `cleanupUnusedCatalogs: true` would strip a catalog entry that no package consumes | Mitigated in scope | New package's `dependencies` includes `"@prisma/ppg": "catalog:"` from Slice 1; placeholder doesn't import it yet, but the manifest reference is enough to keep the catalog entry pinned. |
| `pnpm lint:deps` enforces layering glob coverage | Mitigated in scope | New `architecture.config.json` entries land in the same slice as the new package directory. |

## Slice-specific done conditions

- [ ] `pnpm lint:deps` is green with no `architecture.config.json` glob-coverage warnings for the new package.

(CI-green, reviewer-accept, and the project-DoD floor — `pnpm build`, `pnpm test:packages`, no `pg`/`pg-cursor`/`@types/pg` in the new package's manifest — are inherited and not restated.)

## Open Questions

1. **Driver `id` field — `'ppg-serverless'` or `'postgres-ppg-serverless'`?** Working position: `'ppg-serverless'` (matches the package name's stem; the `targetId: 'postgres'` already conveys the family). The TCP driver uses `id: 'postgres'`, so they don't collide.
ANSWER: ppg serverless
2. **Placeholder runtime: throw on `create()` or throw on first method call?** Working position: descriptor `create()` succeeds and returns an object whose `SqlDriver` methods throw `"driver-ppg-serverless: runtime not implemented; landing in Slice 2"`. This keeps descriptor-construction smoke tests green and localises the failure to the actual use site.
ANSWER: does not matter, your choice
3. **README scope for this slice — full driver README, or stub pointing at "coming in Slice 2"?** Working position: write the full Package-Classification + Overview shell now (cheap, mostly verbatim from `driver-postgres`'s README with the WS-only / no-`pg-cursor` deltas noted) but leave the Architecture mermaid and the Usage code block as `<!-- TODO Slice 2 -->`. Avoids a docs-only churn slice later.
ANSWER: does not matter, your choice

## References

- Parent project: [`projects/ppg-serverless/spec.md`](../../spec.md), [`projects/ppg-serverless/plan.md`](../../plan.md)
- Existing TCP driver (the template we mirror): [`packages/3-targets/7-drivers/postgres/`](../../../../packages/3-targets/7-drivers/postgres/)
- SQL driver seam: [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts)
- Layering / lint config: [`architecture.config.json`](../../../../architecture.config.json)
- Catalog: [`pnpm-workspace.yaml`](../../../../pnpm-workspace.yaml)
- ADR 159 — Driver Terminology and Lifecycle: [`docs/architecture docs/adrs/ADR 159 - Driver Terminology and Lifecycle.md`](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)
