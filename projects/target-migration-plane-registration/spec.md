# Register target-package migration subtrees as migration plane

## Summary

Update `architecture.config.json` so that `src/core/migrations/**` in `@prisma-next/target-postgres` (and the equivalent path in `@prisma-next/target-sqlite` if/when it exists) is registered as `plane: migration` rather than being implicitly shared. The intent is to make dep-cruiser enforce the plane boundary on code that is plainly control-plane (planner, emitter, operation factories, resolver) but currently sits under a path that is either unregistered or registered as shared, hiding several latent plane violations.

## Context

### Today's registration

`architecture.config.json` currently registers, for the postgres target:

```json
{ "glob": "packages/3-targets/3-targets/postgres/src/exports/control.ts",  "plane": "migration" },
{ "glob": "packages/3-targets/3-targets/postgres/src/exports/runtime.ts",  "plane": "runtime"  }
```

`packages/3-targets/3-targets/postgres/src/core/**` is **not registered at all** — dep-cruiser treats it as legacy and enforces no plane rule.

For the sqlite target:

```json
{ "glob": "packages/3-targets/3-targets/sqlite/src/core/**",               "plane": "shared"    },
{ "glob": "packages/3-targets/3-targets/sqlite/src/exports/control.ts",    "plane": "migration" },
{ "glob": "packages/3-targets/3-targets/sqlite/src/exports/pack.ts",       "plane": "shared"    },
{ "glob": "packages/3-targets/3-targets/sqlite/src/exports/runtime.ts",    "plane": "runtime"   }
```

### Why the current registration is wrong for postgres

`packages/3-targets/3-targets/postgres/src/core/` contains:

- `authoring.ts`, `descriptor-meta.ts`, `types.ts` — genuinely shared (used from both migration and runtime entrypoints).
- `migrations/` — a tree of ~22 files covering planner, emitter, resolver, TS rendering, and ~8 operation factories (`operations/columns.ts`, `operations/data-transform.ts`, …). All of this is control-plane work executed at `node migration.ts` time; none of it is referenced from the runtime-plane entrypoint.

Inside `src/core/migrations/` there are already real plane violations that dep-cruiser does not catch because the path is unregistered:

- `src/core/migrations/operations/data-transform.ts:33` — `import { lowerSqlPlan } from '@prisma-next/sql-runtime'` (runtime plane → migration plane is forbidden).
- `src/core/migrations/operation-resolver.ts` — same `sql-runtime` import plus `import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter'` (the adapter package is also incorrectly listed as a `devDependency` of target-postgres — `package.json:36` — a separate packaging bug closed out by the larger DI fix).

Registering `src/core/migrations/**` as migration plane makes dep-cruiser surface these violations immediately. Fixing them is the scope of `projects/migration-control-adapter-di/spec.md`, so this spec is **paired with** that one — registering the path without landing the DI fix would break CI. Either land both in one PR, or land the registration gated behind a short-lived dep-cruiser allow-list that is removed when the DI PR merges.

### Why include sqlite

The same structural split is what we want across targets even if sqlite's `src/core/migrations/**` directory does not exist today (sqlite's `src/core/` currently only contains `control-target.ts`, `descriptor-meta.ts`, `runtime-target.ts`, all genuinely shared). Adding the glob now keeps the two target registrations symmetric and ensures that when migration-plane code is added under sqlite's `src/core/migrations/**`, it starts out on the correct plane rather than inheriting the shared registration by accident.

An independent observation: `packages/3-targets/3-targets/sqlite/src/core/runtime-target.ts:3` contains `import type { SqlRuntimeTargetDescriptor } from '@prisma-next/sql-runtime'` — a type-only import from a runtime-plane package into a shared-plane file. Whether dep-cruiser flags pure type-only imports depends on the project's dep-cruiser configuration; if it does, this becomes a surfaced latent violation and needs to be fixed (likely by relocating the type to `@prisma-next/family-sql` shared-plane exports). Out of scope for this spec; just flagged.

## Changes

### `architecture.config.json`

1. **Add migration-plane entries for the target migration subtrees**. Insert after the existing `packages/3-targets/3-targets/postgres/src/exports/runtime.ts` entry:

   ```json
   {
     "glob": "packages/3-targets/3-targets/postgres/src/core/migrations/**",
     "domain": "extensions",
     "layer": "targets",
     "plane": "migration"
   }
   ```

   And after the existing sqlite entries:

   ```json
   {
     "glob": "packages/3-targets/3-targets/sqlite/src/core/migrations/**",
     "domain": "extensions",
     "layer": "targets",
     "plane": "migration"
   }
   ```

2. **Add a shared-plane entry for postgres target's `src/core/**`** (sqlite already has one). Insert alongside the new migration-plane entry:

   ```json
   {
     "glob": "packages/3-targets/3-targets/postgres/src/core/**",
     "domain": "extensions",
     "layer": "targets",
     "plane": "shared"
   }
   ```

   This ensures the truly shared files under `src/core/` (`authoring.ts`, `descriptor-meta.ts`, `types.ts`) are enforced at the shared plane instead of running unregistered.

### Dep-cruiser config

Confirm whether `dependency-cruiser.config.mjs` resolves each source file to a single most-specific glob or unions all matching globs into multiple module groups. The current implementation (reviewed at `dependency-cruiser.config.mjs:43-60`) does the latter: files match every group whose pattern contains them. With the entries proposed above, files under `src/core/migrations/` would match both the `src/core/**` (shared) group and the `src/core/migrations/**` (migration) group, so every rule from both groups would be evaluated against them.

Two resolution paths:

- **(a) Most-specific wins (preferred).** Update `dependency-cruiser.config.mjs` so each source file is placed in exactly the module group corresponding to its longest-matching glob. This makes the registration semantics match the author's intent and is a one-time fix that benefits every target package with a shared/migration split.
- **(b) Mutually-exclusive globs.** Rewrite the broader glob to exclude the migrations subtree (e.g. explicitly enumerate the files, or use a negated pattern if the glob engine supports it). Local patch; less robust.

Pick (a) unless there is a reason to avoid touching the config loader in this PR.

## Acceptance criteria

- `architecture.config.json` includes the new migration-plane entries for `postgres/src/core/migrations/**` and `sqlite/src/core/migrations/**`, plus a shared-plane entry for `postgres/src/core/**`.
- Dep-cruiser resolves each file under `postgres/src/core/migrations/**` to exactly one module group (migration plane, targets layer, extensions domain).
- Running the repo-standard dep-cruiser command produces the expected violations for `data-transform.ts:33` and `operation-resolver.ts` (both `sql-runtime` imports, both now flagged as migration→runtime). These are *expected-to-fail* after this spec lands and are resolved by `projects/migration-control-adapter-di/spec.md`.
- Alternatively, if shipped in the same PR as the DI fix: zero new dep-cruiser violations, and a green CI run demonstrating that the DI refactor resolves everything the new registration surfaces.

## Coordination with `migration-control-adapter-di`

Three options for landing:

1. **Single PR**: this spec's registration change + the full DI refactor from `migration-control-adapter-di/spec.md` land together. Cleanest, largest.
2. **Registration first, temporary allow-list**: land the registration change with a narrow dep-cruiser allow-list entry for the two offending files, to be removed when the DI PR lands. Smaller PRs, but introduces a temporary suppression.
3. **DI first, registration later**: land the DI refactor without changing registrations; `src/core/migrations/**` stays unregistered. The DI fix removes the illegal imports anyway. Then this spec lands as a pure registration tightening to prevent regression. Safest, highest confidence at each step.

Recommend option 3: the DI fix is the load-bearing change, and the registration tightening becomes a pure defence-in-depth PR once there's nothing illegal to surface.

## Out of scope

- The actual refactor of `data-transform.ts` and `operation-resolver.ts` to remove the illegal imports (see `projects/migration-control-adapter-di/spec.md`).
- Moving or renaming directories in the target packages.
- Any changes to mongo-target plane registration (covered separately if/when needed).
- Fixing the `devDependency` placement of `@prisma-next/adapter-postgres` in `target-postgres/package.json` — falls out of the DI fix, not this registration change.
