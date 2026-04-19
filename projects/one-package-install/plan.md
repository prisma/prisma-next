# One-Package Install — Execution Plan

## Summary

Deliver a seamless Prisma Next setup experience: a single `prisma-next init` command that scaffolds files, installs one target package (`@prisma-next/postgres`), and emits a fully-typed contract — replacing the current 9-step, error-prone manual process. Success means a user can go from zero to typed queries in under a minute with no architecture knowledge.

**Spec:** [spec.md](spec.md)

## Milestones

### Milestone 1: Target `/config` facades (Postgres + Mongo)

The foundation — `@prisma-next/postgres` and `@prisma-next/mongo` each export a simplified `defineConfig` that pre-wires all target internals. Validated when a config using each facade produces byte-identical emit output to the equivalent manually-wired config.

**Tasks:**

#### Postgres

- [ ] **1.1 Add control-plane dependencies to `@prisma-next/postgres`** — Add `@prisma-next/family-sql`, `@prisma-next/target-postgres`, `@prisma-next/driver-postgres`, `@prisma-next/sql-contract-psl`, `@prisma-next/sql-contract-ts`, `@prisma-next/config`, and `@prisma-next/framework-components` to `package.json` dependencies. Verify that this set, combined with existing deps (`@prisma-next/adapter-postgres`, `@prisma-next/sql-contract`, `@prisma-next/contract`), covers all packages referenced in a Postgres `contract.d.ts`.
- [ ] **1.2 Implement `defineConfig` facade** — Create `src/config/define-config.ts` in the postgres package. Accepts `PostgresConfigOptions` (`{ contract: string, db?, extensions?, migrations? }`). Internally: detects contract provider from file extension (`.prisma` → `prismaContract`, `.ts` → `typescriptContract`), derives output path by swapping extension to `.json`, assembles contributions, and delegates to the low-level `defineConfig` from `@prisma-next/config`. See spec section "The `/config` Facade API" → "What it does internally" for the exact wiring steps.
- [ ] **1.3 Add `/config` export** — Create `src/exports/config.ts` barrel, add `"./config"` entry to `package.json` exports, and update `tsdown.config.ts` to include the new entry point.
- [ ] **1.4 Write facade tests** — Test in `test/config/`:
  - A config using facade `defineConfig` and a manually-wired config using the low-level API produce byte-identical `contract.json` and `contract.d.ts` output (AC6).
  - `contract: './foo/bar.prisma'` derives output `'./foo/bar.json'` (AC7).
  - `contract: './foo/bar.ts'` selects the TypeScript contract provider (AC8).
  - Extensions passed via `extensions` are correctly wired into authoring and PSL interpretation contributions.
- [ ] **1.5 Build and verify** — Run `pnpm build` for the postgres package, verify the `/config` export resolves, run typecheck.

#### Mongo

- [ ] **1.6 Create `@prisma-next/mongo` package** — Create a new package at `packages/3-extensions/mongo/` following the same structure as `@prisma-next/postgres`. Add dependencies covering all Mongo contract type imports: `@prisma-next/adapter-mongo`, `@prisma-next/driver-mongo`, `@prisma-next/family-mongo`, `@prisma-next/mongo-contract`, `@prisma-next/mongo-contract-psl`, `@prisma-next/mongo-runtime`, `@prisma-next/mongo-orm`, `@prisma-next/mongo-query-builder`, `@prisma-next/contract`, `@prisma-next/config`, `@prisma-next/framework-components`. Include a `/runtime` export wrapping the Mongo runtime facade (analogous to the Postgres runtime facade) and a `/config` export.
- [ ] **1.7 Implement Mongo `defineConfig` facade** — Create `src/config/define-config.ts` in the mongo package. Accepts `MongoConfigOptions` (`{ contract: string, db?, extensions? }`). Internally wires `mongoFamilyDescriptor`, `mongoTargetDescriptor`, `mongoAdapter`, `mongoDriver`, and `mongoContract` provider. The same file-extension detection applies (`.prisma` → PSL, `.ts` → TypeScript).
- [ ] **1.8 Write Mongo facade tests** — Same test patterns as 1.4 but for the Mongo stack. Verify facade output matches a manually-wired Mongo config.

### Milestone 2: Post-emit dependency validation

The safety net — after emitting `contract.d.ts`, the emitter checks that all referenced packages are installed. Validated when a missing package produces a clear warning and a present package produces no warning.

**Tasks:**

- [ ] **2.1 Implement dependency resolution check in the emitter** — In `packages/1-framework/3-tooling/emitter/`, after writing `contract.d.ts`, extract all `import type … from '<package>'` specifiers from the generated file content (the emitter already has these as it generates the import lines). For each package specifier, attempt to resolve it from the user's project root using Node's `createRequire` or equivalent. Collect any that fail.
- [ ] **2.2 Format and print the warning** — If any packages are unresolvable, print a warning to stderr listing the missing packages and the install command (e.g. `pnpm add @prisma-next/adapter-postgres`). The emit still succeeds — the warning is informational. If a `TerminalUI` instance is available in the emit context, use it; otherwise write directly to stderr.
- [ ] **2.3 Write validation tests** — Test in `packages/1-framework/3-tooling/emitter/test/`:
  - When all packages referenced in `contract.d.ts` are resolvable, no warning is printed (AC13).
  - When a package is not resolvable, the warning names the missing package and includes an install command (AC12).
  - The emit still completes successfully and writes both files regardless of missing packages.

### Milestone 3: `prisma-next init` command

The user-facing entry point — `prisma-next init` scaffolds files, installs dependencies, and emits the contract. Validated by running init in an empty project and getting a fully-typed setup with no manual steps.

**Tasks:**

- [ ] **3.1 Implement package manager detection** — Create `detect-package-manager.ts` in the init command module. Check lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`/`bun.lockb`), fall back to `package.json` `packageManager` field, default to `npm`. Use `pathe` for path operations, `node:fs` for existence checks.
- [ ] **3.2 Create file templates** — Create `templates.ts` with string-template functions per target:
  - `postgresSchema()` → starter `contract.prisma` with `User` and `Post` models.
  - `postgresConfig(contractPath: string)` → `prisma-next.config.ts` with single import from `@prisma-next/postgres/config`.
  - `postgresDb()` → `db.ts` with imports from `@prisma-next/postgres/runtime`, `./contract.d`, and `./contract.json`.
  - `prismaNextMd(target, paths)` → `prisma-next.md` quick-reference for human developers (file locations, common commands, query example).
  - `agentSkill(target, paths)` → `.agents/skills/prisma-next/SKILL.md` agent skill with equivalent content framed for AI agents.
  - Equivalent `mongo*` templates for the Mongo target.
- [ ] **3.3 Implement the init command flow** — Create `init.ts` with the main flow:
  1. Check for prior init (`prisma-next.config.ts` exists). If found, prompt once: "This project is already initialized. Re-initialize?" If declined, exit. If accepted, proceed and overwrite all scaffolded files without further per-file prompts.
  2. Prompt for target (Postgres/Mongo) using `clack.select()`.
  3. Prompt for schema location using `clack.text()` with default `prisma/contract.prisma`.
  4. Write the five scaffolded files (schema, config, db.ts, prisma-next.md, agent skill).
  5. Detect package manager.
  6. Install dependencies (`@prisma-next/postgres` as dep, `prisma-next` as devDep) with a spinner.
  7. Run contract emit programmatically via `executeContractEmit`.
  8. Print completion summary and next steps.
  Handle `--no-install` flag: skip steps 5-7, print manual commands instead.
- [ ] **3.4 Register the init command** — Create `src/commands/init/index.ts` with commander registration. Register in the CLI's main command setup alongside existing commands. Ensure it works via `pnpm dlx prisma-next init`.
- [ ] **3.5 Write init command tests** — Test in `packages/1-framework/3-tooling/cli/test/commands/init/`:
  - Happy path: empty directory with `package.json`, selecting Postgres → all seven files created (5 scaffolded + 2 emitted) (AC1).
  - Generated config has single import from facade `/config` and passes `contract` as string (AC2).
  - Generated `db.ts` has single `@prisma-next` import from facade `/runtime` (AC3).
  - Package manager detection from each lockfile type: pnpm, npm, yarn, bun (AC9).
  - `--no-install` produces five scaffolded files but no emitted files, prints manual commands (AC10).
  - Re-init detection: running init when `prisma-next.config.ts` exists prompts once to re-initialize; accepting overwrites all scaffolded files; declining exits cleanly (AC11).
  - Mock `execFileSync` for install and `executeContractEmit` for emit.

### Milestone 4: End-to-end verification and close-out

Full integration validation and project wrap-up.

**Tasks:**

- [ ] **4.1 End-to-end type verification** — In a temporary project directory, run `prisma-next init` (selecting Postgres), then verify:
  - `tsc --noEmit` reports no errors in `prisma/db.ts` with `skipLibCheck: true` (AC4).
  - Renaming `prisma/contract.d.ts` to `prisma/contract.ts` and running `tsc --noEmit` reports no errors, proving type imports resolve (AC5).
- [ ] **4.2 Update example apps** — Update `examples/prisma-next-demo/prisma-next.config.ts` to use the facade `defineConfig` as a demonstration. Verify emit output is unchanged.
- [ ] **4.3 Verify all acceptance criteria** — Walk through every acceptance criterion from the spec and confirm it passes.
- [ ] **4.4 Close-out** — Migrate any long-lived documentation into `docs/`. Strip repo-wide references to `projects/one-package-install/**`. Delete `projects/one-package-install/`.

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| AC1: Init produces file layout | Unit (mocked IO) | 3.5 | Mock `execFileSync` + emit |
| AC2: Config has single facade import | Unit | 3.5 | Assert on generated file content |
| AC3: db.ts has single runtime import | Unit | 3.5 | Assert on generated file content |
| AC4: `tsc --noEmit` no errors in db.ts | E2E | 4.1 | Requires real project + tsc |
| AC5: contract.d.ts → .ts resolves | E2E | 4.1 | Proves transitive deps work |
| AC6: Facade ≡ manual config output | Integration | 1.4 | Byte-identical comparison |
| AC7: Derived output path | Unit | 1.4 | Extension swap logic |
| AC8: .ts extension → TS provider | Unit | 1.4 | Provider selection logic |
| AC9: PM detection (pnpm/npm/yarn/bun) | Unit | 3.5 | Lockfile fixtures |
| AC10: --no-install skips install+emit | Unit | 3.5 | Assert files + printed commands |
| AC11: Re-init detection + single prompt | Unit | 3.5 | Mock confirm prompt |
| AC12: Missing package → warning | Unit | 2.3 | Mock resolution failure |
| AC13: All packages present → no warning | Unit | 2.3 | Mock resolution success |

## Open Items

- **Published package versions**: The init command installs packages from npm. For internal testing within the monorepo, the install step will need to be mocked or use `workspace:*` protocol. The implementer should determine the right approach — options include mocking `execFileSync` in unit tests (already planned in 3.5) and using a local verdaccio registry or `pnpm link` for E2E tests.
