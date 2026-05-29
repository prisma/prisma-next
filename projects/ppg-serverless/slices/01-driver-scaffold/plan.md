# Slice 1 — Dispatch plan

Slice spec: [`./spec.md`](./spec.md)

## Sizing rationale

This slice is a single-package scaffold. The catalog entry and the package directory are hard-coupled (`pnpm install` can't resolve `"@prisma/ppg": "catalog:"` without the catalog entry; `cleanupUnusedCatalogs: true` would strip the catalog entry without the package reference). The `architecture.config.json` globs and the source-file paths are hard-coupled (`pnpm lint:deps` fails the moment a source file lands without matching glob coverage). The README references the same surfaces as the placeholder descriptor.

That's one logical state: "the new driver package exists in the layering graph, builds, lints clean, and the workspace catalog pins its upstream dep." Splitting into multiple dispatches (e.g. package vs. catalog vs. README) would carve at joints that aren't stable hand-off states — every intermediate state would have `pnpm install` or `pnpm build` red.

Per [`drive/calibration/sizing.md § Dispatch-shape patterns this repo runs cleanly`](../../../../drive/calibration/sizing.md#dispatch-shape-patterns-this-repo-runs-cleanly), this matches **Single-package new feature** — one new surface, ships with tests-or-verifiability, one binary outcome.

## Dispatch plan

### Dispatch 1: Land `@prisma-next/driver-ppg-serverless` scaffold + `@prisma/ppg` catalog pin

- **Outcome:** The package `@prisma-next/driver-ppg-serverless` exists at `packages/3-targets/7-drivers/ppg-serverless/`, builds via `pnpm build`, passes `pnpm lint:deps` and `pnpm lint`, has zero `pg`/`pg-cursor`/`@types/pg`/`pg-mem` references in its manifest, and exports a single `./runtime` descriptor with `familyId: 'sql'`, `targetId: 'postgres'`, `id: 'ppg-serverless'` whose `create()` returns an object whose `SqlDriver` methods throw `"driver-ppg-serverless: runtime not implemented; landing in Slice 2"`. `@prisma/ppg` is pinned at exact `1.0.1` in `pnpm-workspace.yaml`'s `catalog:` and consumed via `"@prisma/ppg": "catalog:"` from the new package's `dependencies`. `architecture.config.json` has two new glob entries for the new package's `src/core/**` and `src/exports/runtime.ts`.

- **Builds on:** The chosen design pinned in [`./spec.md`](./spec.md) (mirrors `@prisma-next/driver-postgres` shape-for-shape with the three deltas in the spec's "Chosen design" table: `./runtime`-only exports, single-entry tsdown, `@prisma/ppg` instead of `pg`/`pg-cursor`).

- **Hands to:** A buildable, lintable, layering-clean driver package shell that Slice 2 fills in with the real `SqlDriver<PpgBinding>` runtime. Specifically: a `PpgServerlessRuntimeDriver` type alias and an unbound-driver class exist as the implementation seam; Slice 2 replaces the throwing method bodies with the one-shot session lifecycle without renaming the descriptor or shifting the package's exports.

- **Focus:** Mirror `@prisma-next/driver-postgres` aggressively — copy `tsconfig.json`, `tsconfig.prod.json`, `biome.jsonc`, `vitest.config.ts` verbatim where the contents are independent of `pg`. Diverge only on the three points the spec calls out (exports map, tsdown entry list, deps). README ships the Package-Classification + Overview shell verbatim from `driver-postgres`'s README with the WS-only / no-`pg-cursor` deltas noted, leaving the Architecture mermaid and Usage code block as `<!-- TODO Slice 2 -->`. No tests beyond what `pnpm build` and `pnpm lint:deps` enforce — runtime-behaviour tests come in Slice 2.

#### Completed when

1. `pnpm install` from the repo root completes without warnings about unresolved catalog entries or unused catalog entries.
2. `pnpm --filter @prisma-next/driver-ppg-serverless build` exits 0 and emits `dist/runtime.mjs` + `dist/runtime.d.mts`.
3. `pnpm lint:deps` exits 0 (no glob-coverage warnings for the new package; no layering violations).
4. `pnpm --filter @prisma-next/driver-ppg-serverless lint` exits 0.
5. `jq '.dependencies | keys[], .devDependencies | keys[]' packages/3-targets/7-drivers/ppg-serverless/package.json` does not list `pg`, `pg-cursor`, `@types/pg`, `@types/pg-cursor`, or `pg-mem`.
6. `grep -F '"@prisma/ppg": 1.0.1' pnpm-workspace.yaml` (or the equivalent YAML form) returns a hit in the `catalog:` block.
7. Importing the descriptor in a TypeScript file outside the package and reading `.familyId` / `.targetId` / `.id` returns `'sql'` / `'postgres'` / `'ppg-serverless'` respectively (verifiable via a one-liner `pnpm exec tsx -e '...'` or a smoke unit test if the executor prefers).

#### Halt conditions

- If `pnpm install` complains about `@prisma/ppg@1.0.1` (e.g. registry-side issue, `minimumReleaseAge: 1440` rejecting the version), halt and surface the upstream signal — do not silently bump to a different version. The catalog pin is load-bearing for Slice 6's integration tests; an unexpected version change is a discussion-mode trigger.
- If `pnpm lint:deps` rejects the proposed `architecture.config.json` glob shape (e.g. wants a `core.ts`-style flat file rather than `core/**`), halt and surface — the layering convention may have shifted since the `driver-postgres` entries were authored.
- If the framework SPI (`@prisma-next/framework-components/execution` or `@prisma-next/sql-relational-core/ast`) has drifted such that the placeholder descriptor can't be typed without importing surfaces beyond the spec's chosen design, halt and surface — the spec assumed type-shape parity with `driver-postgres/src/exports/runtime.ts` as it stands today.

## Hand-off completeness check

Slice-DoD per [`./spec.md`](./spec.md) § Slice-specific done conditions:

- [x] `pnpm lint:deps` is green — covered by Dispatch 1's `Completed when` #3.

Inherited (project-DoD floor): `pnpm build`, `pnpm test:packages`, no `pg`/`pg-cursor`/`@types/pg` in the new driver's manifest — all covered by Dispatch 1's `Completed when` #2, #5.

The single dispatch's `Hands to` adds up to the slice-DoD with no gap.
