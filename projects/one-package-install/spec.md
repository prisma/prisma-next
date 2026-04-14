# Summary

Reduce the Prisma Next setup experience from a multi-step, error-prone process requiring deep architecture knowledge to a single `init` command that scaffolds files, installs dependencies, and leaves the user with a working, fully-typed project.

# Description

Today, setting up Prisma Next in a new app requires the user to: manually create a config file with ~10 imports from ~6 packages referencing internal architecture concepts; figure out which of ~24 `@prisma-next/*` packages to install; write a runtime setup file (`db.ts`) by copying from examples; and debug silent type failures caused by missing transitive type dependencies that `skipLibCheck: true` hides.

The full user journey and roadblock catalog are documented in [user-journey.md](user-journey.md).

This project delivers three changes that eliminate these roadblocks:

1. **`prisma-next init` command** — an interactive CLI command that scaffolds all required files (`contract.prisma`, `prisma-next.config.ts`, `db.ts`), detects the user's package manager, and installs the required dependencies automatically.

2. **One-package-per-target facades** — extend `@prisma-next/postgres` (and create `@prisma-next/mongo`) to export both a `/config` and `/runtime` entry point. The config entry point provides a simplified `defineConfig` that pre-wires target internals. The package's transitive dependencies ensure that all packages referenced by the emitted `contract.d.ts` are always installed.

3. **Post-emit dependency validation** — after writing `contract.d.ts`, the emitter checks that every package referenced in its import statements is resolvable from the user's project. If any are missing, it prints a clear warning with the install command.

# Requirements

## Functional Requirements

### `prisma-next init` command

- F1: The CLI exposes a `prisma-next init` command, usable via `pnpm dlx @prisma-next/cli init` (or `npx`, `bunx`, `yarn dlx`) without prior installation.
- F2: The init command prompts the user for their target database (Postgres or Mongo).
- F3: The init command prompts for schema file location (default: `prisma/contract.prisma`) and contract output location (default: `src/prisma/contract.json`).
- F4: The init command generates three files:
  - `prisma/contract.prisma` — a starter schema with example models (e.g. `User` and `Post`).
  - `prisma-next.config.ts` — a complete, working config file that imports from the target facade package's `/config` export.
  - A `db.ts` file at a location relative to the contract output (e.g. `src/prisma/db.ts`) that imports from the target facade package's `/runtime` export, plus the emitted contract types and JSON.
- F5: The init command detects the user's package manager (pnpm, npm, yarn, bun) from lockfiles or project configuration.
- F6: The init command installs the required dependencies using the detected package manager:
  - The target facade package (e.g. `@prisma-next/postgres`) as a runtime dependency.
  - `@prisma-next/cli` as a dev dependency.
- F7: The init command provides a `--no-install` flag (or equivalent) to skip automatic dependency installation and instead print the install commands for the user to run manually.
- F8: The init command does not overwrite existing files without confirmation.
- F9: After installing dependencies, the init command runs `prisma-next contract emit` automatically to produce `contract.json` and `contract.d.ts`. This ensures the generated `db.ts` has valid imports and the user has a fully-typed, working setup immediately.
- F10: After completion, the init command prints a summary of what was created and the next steps (e.g. "edit your schema and re-run `prisma-next contract emit`").

### Target facade packages

- F11: `@prisma-next/postgres` exports a `/config` entry point that provides a `defineConfig` function. This function accepts a simplified options object (schema path, output path, db connection, optional extensions list) and returns a fully-wired config object compatible with the CLI's existing config loader.
- F12: `@prisma-next/postgres`'s `/config` `defineConfig` handles all internal wiring: family, target, adapter, driver, contribution assembly (`assembleAuthoringContributions`, `assemblePslInterpretationContributions`), and PSL contract provider setup. The user does not interact with these concepts.
- F13: `@prisma-next/postgres`'s `/config` `defineConfig` accepts an `extensions` option — a flat array of extension descriptors (e.g. `[pgvector]`). The facade wires extensions into both authoring and PSL interpretation contributions internally.
- F14: `@prisma-next/postgres`'s `dependencies` in `package.json` include all packages that the emitted `contract.d.ts` imports from for a Postgres target (at minimum: `@prisma-next/adapter-postgres`, `@prisma-next/sql-contract`, `@prisma-next/contract`). This ensures that installing `@prisma-next/postgres` alone makes all contract type imports resolvable.
- F15: `@prisma-next/postgres`'s existing `/runtime` export continues to work unchanged.
- F16: A `@prisma-next/mongo` package is created with the same pattern: `/config` and `/runtime` exports, with transitive dependencies covering all Mongo contract type imports.

### Post-emit dependency validation

- F17: After writing `contract.d.ts`, the emitter resolves every `import type … from '<package>'` statement in the generated file against the user's project root.
- F18: If any imported package is not resolvable, the emitter prints a warning listing the missing packages and the install command to fix it (using the detected or assumed package manager).
- F19: The validation is a warning, not an error — the emit still succeeds and writes the files. The user may have legitimate reasons for the packages to be temporarily missing.

## Non-Functional Requirements

- NF1: The init command completes in under 30 seconds (excluding dependency installation time, which depends on network).
- NF2: The simplified `defineConfig` in the facade packages produces a config object that is semantically identical to a manually-wired config using the low-level API. There is no behavioral difference at emit time or runtime.
- NF3: The post-emit validation adds negligible time to the emit process (< 500ms for checking package resolution).

## Non-goals

- An `init` command that supports every possible configuration option. The init command covers the common case; power users can edit the generated files afterward.
- Replacing the low-level config API (`defineConfig` from `@prisma-next/cli/config-types`). The facade's `defineConfig` delegates to it. The low-level API remains available for advanced use cases and extension authors.
- A plugin or template system for the init command. Hard-coded templates for Postgres and Mongo are sufficient. Additional targets can be added as simple template additions.
- Migrating existing projects. The init command targets new projects. Existing projects can adopt the simplified config manually if desired.
- Interactive schema editing or model generation during init. The starter schema is a static template.

# Acceptance Criteria

## Init command

- [ ] Running `pnpm dlx @prisma-next/cli init` in an empty directory (with a `package.json`) scaffolds `contract.prisma`, `prisma-next.config.ts`, and `db.ts`.
- [ ] The generated `prisma-next.config.ts` has a single import from the target facade package's `/config` export.
- [ ] The generated `db.ts` imports from the target facade package's `/runtime` export.
- [ ] The init command detects pnpm, npm, yarn, and bun from their respective lockfiles.
- [ ] The init command installs the target facade package and `@prisma-next/cli` using the detected package manager.
- [ ] The init command runs `contract emit` after installation, producing `contract.json` and `contract.d.ts`.
- [ ] After init completes, the emitted `contract.d.ts` type imports all resolve without additional package installations.
- [ ] After init completes, the generated `db.ts` has valid imports (contract types and JSON exist).
- [ ] `--no-install` skips installation and emit, and prints the manual commands instead.
- [ ] The init command does not overwrite existing files without prompting.

## Facade `/config` export

- [ ] `@prisma-next/postgres` exports a `defineConfig` from `/config` that accepts `{ schema, output, db, extensions? }` and returns a valid CLI config.
- [ ] A config using the facade `defineConfig` produces identical emit output to the equivalent manually-wired config.
- [ ] Extensions passed via the `extensions` option are correctly wired into both authoring and PSL interpretation contributions.

## Transitive dependency coverage

- [ ] Installing only `@prisma-next/postgres` makes all `contract.d.ts` imports resolvable for a Postgres target (including `@prisma-next/adapter-postgres/codec-types`, `@prisma-next/sql-contract/types`, `@prisma-next/contract/types`).
- [ ] Installing only `@prisma-next/mongo` makes all `contract.d.ts` imports resolvable for a Mongo target.

## Post-emit validation

- [ ] When `contract.d.ts` references a package not installed in the user's project, the emitter prints a warning naming the missing package(s) and the install command.
- [ ] The warning does not prevent the emit from completing successfully.
- [ ] When all packages are installed, no warning is printed.

# Other Considerations

## Security

No new security considerations. The init command runs locally, generates local files, and installs packages from the npm registry using the user's existing package manager. No credentials, secrets, or network services are involved beyond standard npm registry access.

## Cost

No infrastructure or runtime cost. This is a developer tooling change. The only "cost" is the additional transitive dependencies pulled into `node_modules`, which is negligible.

## Observability

Not applicable — this is CLI tooling with direct terminal output. Errors and warnings are printed to stderr/stdout.

## Data Protection

Not applicable — no user data is collected, stored, or transmitted.

## Analytics

**Assumption:** No telemetry or analytics are collected by the CLI today, and none are added by this project. If telemetry is introduced in the future, `init` command usage would be a natural event to track.

# References

- [User journey and roadblock catalog](user-journey.md) — documents the current setup experience and the specific pain points this project addresses.
- Existing `@prisma-next/postgres` package: `packages/3-extensions/postgres/`
- CLI package: `packages/1-framework/3-tooling/cli/`
- Example configs: `examples/prisma-next-demo/prisma-next.config.ts`, `examples/mongo-demo/prisma-next.config.ts`

# Open Questions

None — all questions resolved during spec drafting. Decisions recorded in the functional requirements above:

- **Init runs `contract emit` automatically** (F9) — the user gets a fully working, typed setup. They can edit the schema and re-emit trivially.
- **`db.ts` is colocated with the contract output** (F4) — e.g. `src/prisma/db.ts` alongside `src/prisma/contract.json`.
- **Facade `defineConfig` delegates to the existing config infrastructure** (F10, F11) — it's a thin wrapper that constructs the same config object the low-level API produces.
- **Starter schema contains `User` and `Post` models** (F4) — gives the user something concrete with a relation to emit and query immediately.
