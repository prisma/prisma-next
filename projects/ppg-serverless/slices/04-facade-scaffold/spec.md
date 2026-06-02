# Slice: Facade package scaffold

_Parent project: [`projects/ppg-serverless/`](../../). Outcome this slice contributes: the new facade package exists at `packages/3-extensions/prisma-postgres-serverless/`, builds, lints, ships the six required exports as compileable stubs. Slice 5 then fills in the substantive `defineConfig` / `defineContract` / `runtime()` implementations._

## At a glance

Create `packages/3-extensions/prisma-postgres-serverless/` as a buildable, lintable, layering-clean package named `@prisma-next/prisma-postgres-serverless`. Mirror `@prisma-next/postgres`'s shape with three deliberate deltas: no `./control` export (D4), no `./serverless` export (D3), and `@prisma-next/driver-ppg-serverless` instead of `@prisma-next/driver-postgres` in the dependency list (no `pg` / `@types/pg`). Six exports — `./config`, `./contract-builder`, `./family`, `./migration`, `./runtime`, `./target` — ship as **stubs**: `./family` / `./migration` / `./target` re-forward from upstream packs (identical one-liners to the postgres facade); `./config` / `./contract-builder` carry placeholder modules that compile but throw / return TODO sentinels; `./runtime` is a placeholder descriptor wrapper. The substantive `defineConfig` (control-driver wiring) and `defineContract` (target/family inference) implementations land in Slice 5.

## Chosen design

The scaffold mirrors `@prisma-next/postgres` shape-for-shape with five deliberate deltas:

| Surface | `@prisma-next/postgres` | `@prisma-next/prisma-postgres-serverless` (this slice) |
|---|---|---|
| `package.json` exports | `./config`, `./contract-builder`, `./control`, `./family`, `./migration`, `./runtime`, `./serverless`, `./target`, `./package.json` (9 entries) | `./config`, `./contract-builder`, `./family`, `./migration`, `./runtime`, `./target`, `./package.json` (7 entries — no `./control` per D4, no `./serverless` per D3) |
| `tsdown.config.ts` entries | 8 (one per export above) | 6 (one per non-package.json export) |
| Runtime driver dep | `@prisma-next/driver-postgres: workspace` | `@prisma-next/driver-ppg-serverless: workspace` |
| `pg` / `@types/pg` deps | present (`pg: catalog`, `@types/pg: catalog` in devDeps) | **absent** — neither in `dependencies` nor `devDependencies` |
| `./config`, `./contract-builder`, `./runtime` contents | Substantive: `defineConfig`, `defineContract`, `runtime()` factory | **Placeholders** that compile-and-throw — Slice 5 fills them in |

Everything else (tsconfigs, biome config, vitest config, README structure, the family/migration/target one-liner re-forwards) is copied verbatim and renamed.

### Package layout

```
packages/3-extensions/prisma-postgres-serverless/
├── README.md
├── biome.jsonc
├── package.json
├── tsconfig.build.json
├── tsconfig.json
├── tsconfig.prod.json
├── tsdown.config.ts
├── vitest.config.ts
└── src/
    └── exports/
        ├── config.ts
        ├── contract-builder.ts
        ├── family.ts
        ├── migration.ts
        ├── runtime.ts
        └── target.ts
```

No `src/config/`, `src/contract/`, `src/runtime/` subdirectories — those land in Slice 5 when the substantive implementations arrive.

### Export stub contents

**`src/exports/family.ts`** (identical to postgres facade):
```ts
export { default } from '@prisma-next/family-sql/pack';
```

**`src/exports/target.ts`** (identical):
```ts
export { default } from '@prisma-next/target-postgres/pack';
```

**`src/exports/migration.ts`** (identical):
```ts
export * from '@prisma-next/target-postgres/migration';
```

**`src/exports/config.ts`** (placeholder — Slice 5 replaces):
```ts
const SLICE_5_PENDING_MESSAGE =
  'prisma-postgres-serverless: defineConfig is not implemented yet; the facade scaffold landed before the runtime wiring did. Use @prisma-next/postgres for now or wait for the next release.';

export interface PrismaPostgresServerlessConfigOptions {
  // shape pinned in Slice 5
}

export function defineConfig(_options: PrismaPostgresServerlessConfigOptions): never {
  throw new Error(SLICE_5_PENDING_MESSAGE);
}
```

**`src/exports/contract-builder.ts`** (placeholder):
```ts
const SLICE_5_PENDING_MESSAGE =
  'prisma-postgres-serverless: defineContract is not implemented yet; the facade scaffold landed before the runtime wiring did. Use @prisma-next/postgres for now or wait for the next release.';

export function defineContract(..._args: unknown[]): never {
  throw new Error(SLICE_5_PENDING_MESSAGE);
}
```

(_Source-string note: per `.agents/rules/no-transient-project-ids-in-code.mdc`, the placeholder messages above CANNOT mention "Slice 5". Reword to neutral language before committing. Working position: `"prisma-postgres-serverless: defineConfig is not yet implemented; this is a scaffold package whose runtime wiring is pending."`_)

**`src/exports/runtime.ts`** (placeholder — Slice 5 replaces with real `runtime()` factory):
```ts
const NOT_YET_IMPLEMENTED =
  'prisma-postgres-serverless: runtime() is not yet implemented; this is a scaffold package whose runtime wiring is pending.';

export type PpgServerlessFacadeBinding = { url: string } | { ppgClient: unknown };

export interface PrismaPostgresServerlessOptions {
  binding: PpgServerlessFacadeBinding;
}

export default function runtime(_options: PrismaPostgresServerlessOptions): never {
  throw new Error(NOT_YET_IMPLEMENTED);
}
```

(Exact type shapes don't matter at scaffold time — Slice 5 settles them. The point is: the export compiles and its consumers can import a callable function without erroring at build time.)

### `package.json` shape

```jsonc
{
  "name": "@prisma-next/prisma-postgres-serverless",
  "version": "0.12.0",
  "license": "Apache-2.0",
  "type": "module",
  "sideEffects": false,
  "description": "Edge/serverless-friendly Prisma Postgres client composition for Prisma Next",
  "scripts": { /* identical to postgres facade */ },
  "dependencies": {
    "@prisma-next/adapter-postgres": "workspace:0.12.0",
    "@prisma-next/cli": "workspace:0.12.0",
    "@prisma-next/config": "workspace:0.12.0",
    "@prisma-next/contract": "workspace:0.12.0",
    "@prisma-next/driver-ppg-serverless": "workspace:0.12.0",
    "@prisma-next/family-sql": "workspace:0.12.0",
    "@prisma-next/framework-components": "workspace:0.12.0",
    "@prisma-next/sql-contract": "workspace:0.12.0",
    "@prisma-next/sql-contract-psl": "workspace:0.12.0",
    "@prisma-next/sql-contract-ts": "workspace:0.12.0",
    "@prisma-next/sql-builder": "workspace:0.12.0",
    "@prisma-next/sql-orm-client": "workspace:0.12.0",
    "@prisma-next/sql-relational-core": "workspace:0.12.0",
    "@prisma-next/sql-runtime": "workspace:0.12.0",
    "@prisma-next/target-postgres": "workspace:0.12.0",
    "@prisma-next/utils": "workspace:0.12.0",
    "pathe": "^2.0.3"
  },
  "devDependencies": {
    "@prisma-next/psl-parser": "workspace:0.12.0",
    "@prisma-next/test-utils": "workspace:0.12.0",
    "@prisma-next/tsconfig": "workspace:0.12.0",
    "@prisma-next/tsdown": "workspace:0.12.0",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "peerDependencies": {
    "typescript": ">=5.9"
  },
  "peerDependenciesMeta": {
    "typescript": { "optional": true }
  },
  "files": ["dist", "src"],
  "types": "./dist/runtime.d.mts",
  "exports": {
    "./config": "./dist/config.mjs",
    "./contract-builder": "./dist/contract-builder.mjs",
    "./family": "./dist/family.mjs",
    "./migration": "./dist/migration.mjs",
    "./runtime": "./dist/runtime.mjs",
    "./target": "./dist/target.mjs",
    "./package.json": "./package.json"
  },
  "engines": { "node": ">=24" },
  "repository": { /* ... */ }
}
```

Deltas vs `@prisma-next/postgres`:
- `pg: catalog` removed from deps.
- `@types/pg: catalog` removed from devDeps.
- `@prisma-next/driver-postgres: workspace` → `@prisma-next/driver-ppg-serverless: workspace`.
- Exports map drops `./control` and `./serverless`.

### `architecture.config.json` delta

Six new glob entries beside the existing `@prisma-next/postgres` facade entries (around lines 291–338):

```jsonc
{
  "glob": "packages/3-extensions/prisma-postgres-serverless/src/exports/config.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/prisma-postgres-serverless/src/exports/contract-builder.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/prisma-postgres-serverless/src/exports/family.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/prisma-postgres-serverless/src/exports/migration.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "migration"
},
{
  "glob": "packages/3-extensions/prisma-postgres-serverless/src/exports/runtime.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "runtime"
},
{
  "glob": "packages/3-extensions/prisma-postgres-serverless/src/exports/target.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
}
```

No `src/config/**` or `src/contract/**` entries — those land in Slice 5 when the source directories appear.

## Coherence rationale

One package scaffold + the architecture-config wiring that lets `pnpm lint:deps` see it. Splitting (e.g. "package shell now, exports next") leaves the package directory in an intermediate non-buildable state. Rollback is `git rm -rf packages/3-extensions/prisma-postgres-serverless` plus reverting the architecture-config hunk.

## Scope

**In:**
- `packages/3-extensions/prisma-postgres-serverless/` package directory and all files inside (package.json, tsconfigs, biome.jsonc, tsdown.config.ts, vitest.config.ts, README.md, six export stub files).
- `architecture.config.json` — six new glob entries.

**Out:**
- The substantive `defineConfig`, `defineContract`, `runtime()` implementations. → Slice 5.
- `src/config/`, `src/contract/`, `src/runtime/` subdirectories. → Slice 5.
- Tests. The stubs throw "not yet implemented" — no test surface to exercise this slice. Slice 5 adds tests when the substantive surface arrives.
- README's Usage section. The scaffold README ships Package Classification + Overview + Exports shells (with placeholder pointers to Slice-5 content); no real code examples this slice.

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| `pnpm lint:deps` enforces glob coverage. | Architecture-config entries land in the same slice as the source files. |
| The stub `./config` / `./contract-builder` / `./runtime` files throw at runtime. Could a downstream type-check consumer (e.g. Slice 5's tests) trip over this? | No — `throw` doesn't affect compile-time type inference. Type signatures are honoured (`defineConfig` returns `never`, callable as `(options) => never` — TypeScript-compatible). |
| `@prisma-next/cli` dep on the new facade. | The postgres facade depends on `@prisma-next/cli`; mirroring this for the new facade is mechanical. The CLI hooks up via the family/target packs, not via the facade's own runtime. |
| The `./family` / `./migration` / `./target` re-forwards return `default` from upstream packs (the postgres adapter packs). Tsdown emits them as `dist/<name>.mjs` re-exports. | Verified by the postgres facade's identical pattern — passes build and lint:deps. |

## Slice-specific done conditions

- [ ] `pnpm --filter @prisma-next/prisma-postgres-serverless build` emits `dist/{config,contract-builder,family,migration,runtime,target}.mjs` + corresponding `.d.mts` files.
- [ ] `pnpm lint:deps` green (no glob-coverage warnings for the new package; no layering violations).

CI-green, reviewer-accept, project-DoD floor (no `pg` / `@types/pg` in the facade's manifest; no bare `as`; no transient project IDs) inherited.

## Open Questions

1. **Stub placeholder messages — neutral wording.** The text "Slice 5 fills it in" must not leak into the stub messages (per the no-transient-IDs rule, lesson from F1/F2). Working position: use `"prisma-postgres-serverless: defineConfig is not yet implemented; this is a scaffold package whose runtime wiring is pending."` (or similar neutral phrasing) and let Slice 5 replace the bodies wholesale. _Same calibration applies to README placeholders._
2. **`@prisma-next/cli` in deps?** Postgres facade has it; rationale unclear from outside (likely for migration-tool wiring). Working position: include it (mirror postgres facade). If Slice 5 finds it's unused, drop it then. _Override: drop now if you can verify it's not pulled by the facade's own modules._
3. **`README.md` content for scaffold slice.** Working position: write the Package Classification + Overview + Exports shells (mirroring `@prisma-next/postgres`'s README), with placeholder pointers to the "pending" surfaces. Avoid a docs-only churn slice later. _Override: stub README pointing entirely at Slice 5._

## References

- Parent project: [`projects/ppg-serverless/spec.md`](../../spec.md) — FR2 (facade exports list), D3 (no `./serverless`), D4 (no `./control`).
- Slice plan: [`projects/ppg-serverless/plan.md`](../../plan.md) § Slice 4.
- Existing facade (the structural template): [`packages/3-extensions/postgres/`](../../../../packages/3-extensions/postgres/) — package.json, tsconfigs, export shapes.
- Driver from prior slices: [`packages/3-targets/7-drivers/ppg-serverless/`](../../../../packages/3-targets/7-drivers/ppg-serverless/) — for the `@prisma-next/driver-ppg-serverless` workspace dep.
- Layering config: [`architecture.config.json`](../../../../architecture.config.json) — existing extensions/adapters glob patterns.

## Adapter-impact section

Per `drive/spec/README.md`, slices touching `packages/3-extensions/**` declare adapter impact (extensions are the consumer-facing surface; adapters are the substrate).

**Adapters affected:** None new. The new facade reuses `@prisma-next/adapter-postgres` and `@prisma-next/target-postgres` unchanged. No adapter-level code changes this slice (or any slice in this project).
