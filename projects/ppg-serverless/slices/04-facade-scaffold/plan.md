# Slice 4 — Dispatch plan

Slice spec: [`./spec.md`](./spec.md)

## Sizing rationale

Single-package scaffold — like Slice 1 but for the facade extension instead of the driver. All pieces are hard-coupled (package files + arch-config globs must land together for `pnpm install` + `pnpm lint:deps` to be green). One reviewer sitting; one logical state ("facade package exists, builds, lints, has the six required exports as compileable stubs"). Splitting carves at non-stable joints. Matches **Single-package new feature** per [`drive/calibration/sizing.md`](../../../../drive/calibration/sizing.md).

Estimated size ~15 files, ~250 LoC (mostly mechanical mirroring of the postgres facade — the six stubs are tiny).

## Dispatch plan

### Dispatch 1: Land `@prisma-next/prisma-postgres-serverless` scaffold + arch-config globs

- **Outcome:** New package at `packages/3-extensions/prisma-postgres-serverless/` named `@prisma-next/prisma-postgres-serverless`. Builds (`pnpm --filter ... build` emits 6 `dist/*.mjs` files + matching `.d.mts`). Lints clean (`pnpm lint:deps`, `pnpm lint`). Six exports: `./family` / `./migration` / `./target` re-forward one-liners (identical to postgres facade); `./config` / `./contract-builder` / `./runtime` placeholder stubs that throw at runtime but compile cleanly. No `pg` or `@types/pg` in manifest. `architecture.config.json` carries six new entries for the new export files.

- **Builds on:** Slice 1's `@prisma-next/driver-ppg-serverless` (workspace dep) + the chosen design in [`./spec.md`](./spec.md).

- **Hands to:** A buildable facade shell that Slice 5 fills in: `./config` gets a real `defineConfig`, `./contract-builder` gets a real `defineContract`, `./runtime` gets a real `runtime()` factory returning `PrismaPostgresServerlessClient<TContract>`.

- **Focus:**
  - Mirror `@prisma-next/postgres` aggressively. Copy `tsconfig*.json`, `biome.jsonc`, `vitest.config.ts` verbatim. Copy `package.json` with the deltas listed in the spec (remove `pg`/`@types/pg`, swap driver dep, drop `./control`/`./serverless`).
  - `./family` / `./migration` / `./target` are one-liners — `export { default } from '...'` or `export * from '...'`. Copy verbatim from postgres facade.
  - `./config`, `./contract-builder`, `./runtime` stub bodies: use **neutral wording** for the "not yet implemented" messages — NO transient project IDs (lesson from F1/F2/F3). Working pinned wording in the spec.
  - **Working positions on Open Questions** (operator confirmed via "continue"):
    - OQ1 — neutral wording per spec.
    - OQ2 — include `@prisma-next/cli` dep (mirror postgres facade).
    - OQ3 — Package Classification + Overview + Exports shell README, with neutral pending pointers.
  - Architecture-config: six new entries beside the existing postgres facade entries.

#### Completed when

1. `pnpm install` from repo root completes clean (no unresolved workspace deps, no unused catalog entries).
2. `pnpm --filter @prisma-next/prisma-postgres-serverless build` exits 0; emits `dist/{config,contract-builder,family,migration,runtime,target}.mjs` and matching `.d.mts` files.
3. `pnpm lint:deps` exits 0 (no glob-coverage warnings; no layering violations).
4. `pnpm --filter @prisma-next/prisma-postgres-serverless lint` exits 0.
5. `pnpm --filter @prisma-next/prisma-postgres-serverless typecheck` exits 0.
6. `jq -r '.dependencies, .devDependencies | keys[]?' packages/3-extensions/prisma-postgres-serverless/package.json | sort -u | grep -E '^(pg|@types/pg)$'` returns no matches (exit 1).
7. **No transient project IDs in source or README** (canonical regex per `.agents/rules/no-transient-project-ids-in-code.mdc`):
   ```sh
   git diff --cached -U0 -- ':!projects/' | grep -E '^\+' | grep -oE '\b(T[0-9]+\.[0-9]+|TC-?[0-9]+|AC-?[0-9]+|FR[0-9]+|NFR[0-9]+|CKPT-[0-9]+|AM[0-9]+|D[0-9]+|M[0-9]+\.[0-9]+|P[0-9]+ R[0-9]+|M[0-9]+ review|Slice [0-9]+)\b' | sort -u
   ```
   Must return empty. Plus manual prose-attribution sweep (`later slice`, `per project decision`, `slice surface`, `sub-spec`, `out of scope per`, `per spec`, `deferred per`).
8. `package.json` exports map carries exactly 7 entries: `./config`, `./contract-builder`, `./family`, `./migration`, `./runtime`, `./target`, `./package.json` — no `./control`, no `./serverless`.
9. Importing `defineConfig` / `defineContract` / `runtime` from the built `dist/` succeeds at module load time (the throw is inside the function body — calling them throws, but importing them doesn't).

#### Halt conditions

- `pnpm install` fails due to a workspace-dep mismatch or version drift — surface; don't silently bump versions.
- `pnpm lint:deps` rejects the glob shape — surface (the postgres facade pattern should work identically).
- A stub export's type signature requires importing from a surface that doesn't exist yet — surface; the stub typings should be self-contained.
- Diff exceeds ~20 files OR ~600 LoC — likely scope expansion; surface for re-decomposition.

## Hand-off completeness check

Slice-DoD per [`./spec.md`](./spec.md):

- [x] `pnpm --filter ... build` emits the 6 `dist/*.mjs` files — covered by Dispatch 1 #2.
- [x] `pnpm lint:deps` green — covered by Dispatch 1 #3.

Inherited: no `pg`/`@types/pg` (#6), no transient IDs (#7), typecheck/lint clean (#4, #5).

The single dispatch's `Hands to` (working scaffold) directly enables Slice 5's substantive `defineConfig` / `defineContract` / `runtime()` implementations.
