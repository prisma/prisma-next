# Summary

Make `prisma-next init` deliver on the experience the previous shaping promised: a fast, reliable path from "empty project" to "first typed query" for **every** combination of database target × authoring style × persona × project state — not just the Postgres-PSL happy path. This project closes the gap between the [`one-package-install`](../one-package-install/spec.md) facade promise and what `init` actually produces today, fixes the Mongo facade so it's at parity with Postgres, makes `init` scriptable for AI agents and CI, and locks in the small-but-essential project hygiene files (`.env`, `.gitignore`, `.gitattributes`, scripts) that every credible scaffolder ships.

# Description

## Problem

After [TML-2263](https://linear.app/prisma-company/issue/TML-2263/init-follow-up-improvements) shipped the foundational `init` command and the per-target facades (`@prisma-next/postgres`, `@prisma-next/mongo`), live testing across 8 personas surfaced 11 cross-cutting roadblocks (R1–R11) and 37 friction points (F1–F37). See [`assets/user-journey.md`](./assets/user-journey.md) for the full narrative; [`assets/evidence/`](./assets/evidence/) holds the captured reproductions (terminal output, scaffolded files, the `tsc` failure cases) referenced as E1–E14.

The headline findings:

- The `init` command is **not scriptable**. There is no `--yes`, no `--target`, no `--authoring`. Run with stdin closed (any CI / agent environment), it silently aborts and exits 0. AI-agent / CI adoption is blocked.
- The Mongo path is **a trap**. Init scaffolds a project that compiles but cannot be queried with types: the agent skill points at `db.orm.User.where(...)` which `tsc` rejects (`Property 'orm' does not exist on type 'MongoClient<Contract>'`); even the documented explicit-`connect()` pattern resolves `where` as `never`. An LLM following the shipped agent skill would generate broken code on the very first query. Postgres delivers on the facade; Mongo doesn't.
- A freshly initialised project **doesn't typecheck**. `init` references `process.env` in the scaffolded config but doesn't install `@types/node` or set `"types": ["node"]` — `tsc --noEmit` errors out before the user has written any code.
- `init` doesn't create the **project hygiene files** every other scaffolder creates: `.env`, `.gitignore` updates, `.gitattributes` to mark emitted artefacts as `linguist-generated`, and `package.json` scripts.
- `init` doesn't survive **hostile-but-normal inputs**. JSONC `tsconfig.json` (the TS-team-blessed default) crashes the merge with a half-initialised project. Re-init leaves stale `contract.json` from the previous target. `pnpm install` can fail because `@prisma-next/migration-tools` still leaks `workspace:*` and `arktype@catalog:` references at publish time.
- The system has **no declared minimum DB version** anywhere. The user can `init` against Postgres 9 or MongoDB 3.6 and only discover the gap when a query fails for unexplained reasons. There is no version probe, no advisory output, no documentation surface.
- Templates **don't differentiate by authoring**: TS-authoring users get a `prisma-next.md` and an agent skill that show PSL `model User { ... }` blocks contradicting the actual scaffold.

## Users affected

- **P1 / P2 — Greenfield Postgres / Mongo users.** First impression is muddy (project doesn't typecheck; missing `.env`); Mongo is unusable end-to-end.
- **P3 — TypeScript-authoring users** (cuts across P1 / P2). Second-class: docs and agent skills don't match the scaffold.
- **P4 — AI coding agents / CI scripts.** Completely blocked. Headline TML-2263 finding.
- **P5 — Bare-directory bootstrappers.** Bails out instead of bootstrapping. Loses the "0 → working app in 60 seconds" race.
- **P6 — Existing-project adopters** (Next.js, Astro, Remix). Hard crash on JSONC `tsconfig.json`; project left half-initialised.
- **P7 — Re-runners / iterators.** Stale emitted artefacts after a target switch.
- **P8 — Monorepo users.** Lockfile detection in workspace sub-package falls back to `npm`, mixing PMs.

See [`assets/user-journey.md`](./assets/user-journey.md) §"Personas" / §"J1"–"J8" for the per-persona breakdown.

## Scope

This project addresses the roadblocks that block adoption today. It is **not** a rewrite. The 5-file scaffold layout, the per-target facade design, the PSL templates, and the re-init confirm-once UX are all correct and stay (see [`assets/user-journey.md`](./assets/user-journey.md) §"What's already correct (don't regress)").

In scope: R1, R2, R3, R4, R5, R6, R7 (JSONC survival), R8, R9, R10, R11.

Out of scope (phase 2): framework auto-detection, telemetry, a dedicated `prisma-next doctor` command, deep monorepo workspace integration. See "Non-goals" below.

## Technology preferences

- Reuse existing CLI scaffolding (`commander`, `@clack/prompts`, `addGlobalOptions` in [`utils/command-helpers.ts`](../../packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts)).
- For JSONC parsing, use `jsonc-parser` (the standard the TS team itself uses; preserves comments and trailing commas during edits).
- For DB version probing: target's existing driver (`pg` for Postgres, `mongodb` for Mongo) — no new heavy deps.
- For the `--json` output schema: arktype (matches the rest of the codebase per [`.cursor/rules/arktype-usage.mdc`](../../.cursor/rules/arktype-usage.mdc)).

# Requirements

## Functional Requirements

### FR1 — `init` is fully scriptable (closes R1, R10)

- **FR1.1** `init` exposes target-specific flags: `--target {postgres|mongodb}`, `--authoring {psl|typescript}`, `--schema-path <path>`, `--force` (allow overwrite without re-init prompt).
- **FR1.2** `init` wires `addGlobalOptions`, inheriting `--yes`, `--no-interactive`, `--json`, `-q`, `-v`, `--no-color`, `--trace` from the rest of the CLI.
- **FR1.3** With every required input supplied via flags (or `--yes` plus defaults), `init` runs without rendering a single interactive prompt.
- **FR1.4** When stdin is non-TTY *and* a required input is missing, `init` exits **non-zero** with an actionable message naming the missing flags. No silent exit-0.
- **FR1.5** With `--json`, `init` writes a single structured JSON document to stdout describing files written, packages installed, the chosen target/authoring, and a `nextSteps` array; all human-oriented spinner output goes to stderr.
- **FR1.6** Exit codes are stable and documented: `0` success, non-zero with distinct codes for "preconditions not met" / "user aborted" / "install failed" / "emit failed" / "internal error".

### FR2 — A freshly initialised project typechecks (closes R5)

- **FR2.1** `init` adds `@types/node` to `devDependencies` if it isn't already present (transitively or directly).
- **FR2.2** Scaffolded `tsconfig.json` includes the minimal compiler options needed for the scaffolded `prisma-next.config.ts` and `db.ts` to typecheck (notably `"types": ["node"]` when `moduleResolution` is `bundler` and Node types are otherwise hidden).
- **FR2.3** Running `tsc --noEmit` against a freshly initialised project (no edits) succeeds with exit 0 for all four (target × authoring) cells.

### FR3 — Project hygiene files are created / updated (closes R6)

- **FR3.1** `init` writes a `.env.example` with target-appropriate `DATABASE_URL` placeholder, the minimum supported DB version (see FR8), and (for Mongo) the database-name placeholder.
- **FR3.2** `init` creates a `.env` (gitignored) on opt-in. In non-interactive mode this is opt-in via `--write-env` (default: only `.env.example`).
- **FR3.3** `init` idempotently ensures `.gitignore` contains `.env`, `dist/`, `node_modules/`. If the file exists, it appends only missing entries; never duplicates.
- **FR3.4** `init` idempotently ensures `.gitattributes` contains `linguist-generated` entries for the emitted artefacts (`prisma/contract.json`, `prisma/contract.d.ts`, future `prisma/end-contract.*`, `prisma/ops.json`). Mirrors the relevant subset of [`/.gitattributes`](../../.gitattributes). Creates the file if missing; appends-with-dedup if present.
- **FR3.5** `init` adds `package.json` scripts (at minimum `contract:emit` → `prisma-next contract emit`) idempotently. The script name mirrors the CLI subcommand path. If a script of the same name exists with a different command, `init` skips with a warning rather than overwriting. (No watch-mode script is added — file-watching during dev is the build tool's job; framework integrations like Vite plugins are the right home.)

### FR4 — Mongo facade is at parity with Postgres (closes R2)

- **FR4.1** `@prisma-next/mongo` exposes `db.orm` directly off `MongoClient<Contract>`. The user can write `db.orm.User.where(...).first()` without an explicit `connect()` call, exactly as for Postgres.
- **FR4.2** Connection is lazy: `const db = mongo({...})` returns a fully-typed client; the first query triggers `connect`. Mirrors Postgres semantics.
- **FR4.3** A query of the form `db.orm.User.where({...}).first()` typechecks (no `Property 'where' does not exist on type 'never'`) and runs against a real `mongod`.
- **FR4.4** Multi-document transactions remain available via an explicit transaction API (e.g. `db.transaction(async (tx) => ...)`); replica-set requirement is documented in `prisma-next.md`. Dev-environment replica-set provisioning (docker-compose, `mongodb-memory-server`, Atlas) is **out of scope** for this project and is tracked separately in [TML-2313](https://linear.app/prisma-company/issue/TML-2313/mongo-dev-replica-set-story-is-missing-transactions-change-streams).
- **FR4.5** `quick-reference-mongo.md` and `agent-skill-mongo.md` are rewritten so the primary code samples match FR4.1; references to `db.sql` are removed from the Mongo skill.

### FR5 — Templates differentiate by (target × authoring) (closes R3)

- **FR5.1** `prisma-next.md` renders an authoring-appropriate schema sample (PSL `model { … }` for PSL, TS `defineContract(...)` for TypeScript).
- **FR5.2** Agent skill files reference the correct contract path (`prisma/contract.prisma` vs `prisma/contract.ts`) and authoring-appropriate query examples for the chosen target.
- **FR5.3** TS schema templates for Postgres and Mongo share a single builder shape — same `defineContract` signature, same field method names where the underlying capabilities match, same relation reference syntax. The four divergence axes called out in F17 are reconciled.
- **FR5.4** Template snapshot tests cover all four (postgres × psl), (postgres × ts), (mongodb × psl), (mongodb × ts) cells; each scaffolded project typechecks against the published facade.

### FR6 — `init` survives hostile-but-normal inputs (closes R7)

- **FR6.1** `mergeTsConfig` parses JSONC using `jsonc-parser`, preserving the user's comments and trailing commas where possible. JSON5 inputs (rare) are also accepted; bare unparseable inputs error with a clear message naming the file.
- **FR6.2** `init` runs all preconditions and validations *before* writing any file. A failure mid-run does not leave a half-initialised project.
- **FR6.3** When `init` cannot proceed cleanly, it prints what it would have done and exits non-zero. (No "wrote 3 of 5 files; the other 2 failed" outcome.)

### FR7 — `pnpm install` works for the published packages (closes R4)

- **FR7.1** Publish-time build strips residual `workspace:*` and `catalog:` references from every published package (`@prisma-next/migration-tools` is the known offender; the build verifies the constraint for every package).
- **FR7.2** `init` falls back from `pnpm add` to `npm install` only when `pnpm` fails with a recognised workspace/catalog resolution error, and surfaces a clear warning explaining the fallback.
- **FR7.3** Inside a pnpm workspace where the catalog overrides `latest`, `init` either uses the catalog version or pins the published `latest` and warns about the override; documented in `prisma-next.md`.

### FR8 — DB target version compatibility is declared and surfaced (closes R11)

- **FR8.1** Each target package declares a minimum supported server version in a stable, programmatically-readable place (e.g. a `prismaNext.minServerVersion` field in its `package.json`, or an exported constant). Postgres and Mongo targets each declare their own.
- **FR8.2** `init` reads the chosen target's minimum version and writes it as a comment / placeholder into `.env.example` and as a "Requirements" section in `prisma-next.md`.
- **FR8.3** `init` never **requires** a live database connection to complete. The DB-version probe is opt-in: triggered by `--probe-db` (non-interactive) or by interactive consent when `DATABASE_URL` is set. When triggered, `init` connects, calls `SELECT version()` (Postgres) / `db.runCommand({buildInfo:1})` (Mongo), and prints a warning if the server is below the declared minimum. Probe failures (no `DATABASE_URL`, network error, auth error) are non-fatal; `init` continues and exits 0. `--strict-probe` escalates probe **failures** to fatal but never triggers a probe by itself — without `--probe-db` and without interactive consent, `init` opens no network connections at all.
- **FR8.4** For Mongo specifically, `prisma-next.md` documents the replica-set requirement for transactions and change streams, and links to the dev-environment guidance tracked under [TML-2313](https://linear.app/prisma-company/issue/TML-2313/mongo-dev-replica-set-story-is-missing-transactions-change-streams). `init` does not auto-provision a replica set; it advises.
- **FR8.5** First `db.connect` at runtime checks server version once and emits a structured warning (via the framework's logger) if the server is below the declared minimum.

### FR9 — Re-init is clean (closes R9)

- **FR9.1** Re-init deletes the previously-emitted contract artefacts (`prisma/contract.json`, `prisma/contract.d.ts`, and any sibling `*.d.ts`/`.json` emitted by the previous run) before writing new templates.
- **FR9.2** Re-init that switches target removes the previous facade dependency (`@prisma-next/postgres` ↔ `@prisma-next/mongo`) from `package.json`. Confirms in interactive mode; honoured under `--force` non-interactively.
- **FR9.3** Re-init is idempotent on `tsconfig.json`, `.gitignore`, `.gitattributes`, and `package.json#scripts` — second runs do not duplicate entries.

### FR10 — Information-rich outro (closes R8)

- **FR10.1** Outro prints a structured "Next steps" list naming concrete commands: set `DATABASE_URL` in `.env`, run a starter query, where to find the docs, the agent skill location.
- **FR10.2** With `--json`, the same data appears as a `nextSteps: string[]` field in the JSON output document.

## Non-Functional Requirements

- **NFR1 — Performance.** `init` end-to-end (scaffold + install + emit) completes in ≤ 30 seconds with a warm `pnpm` / `npm` cache, ≤ 90 seconds cold, on a typical developer laptop. (No regression vs. today.)
- **NFR2 — Determinism.** Given the same `(target, authoring, schemaPath, projectName)` inputs, `init` produces byte-identical output files, modulo `package.json` versions and timestamps.
- **NFR3 — Atomicity.** `init` either completes fully or leaves the project in its pre-init state. Mid-run failures roll back. (NFR addressed primarily by FR6.2.)
- **NFR4 — Safety.** `init` never modifies files outside the project root and the explicitly named scaffold paths.
- **NFR5 — Cross-platform.** `init` runs on macOS, Linux, and Windows (PowerShell + Git Bash). Path handling uses `pathe` per [`.cursor/rules/use-pathe-for-paths.mdc`](../../.cursor/rules/use-pathe-for-paths.mdc).
- **NFR6 — Cross-PM.** `init` works under `npm`, `pnpm`, `yarn` (classic + berry), and `bun`. The package-manager detection picks the right one in the common cases (lockfile present in cwd; lockfile in a workspace ancestor; `package.json#packageManager`).
- **NFR7 — Backwards compatibility.** Existing scaffolded projects (from the prior `init`) continue to work after the user upgrades the facade — no breaking changes to the facade's public API surface beyond what's needed for FR4 (Mongo parity), and where breakage is unavoidable, it is documented and accompanied by a codemod or clear migration note.
- **NFR8 — Observability.** `init` emits structured warnings (DB version, pnpm fallback, script collisions) at default verbosity. With `-q` only errors. With `-v` debug-level details.
- **NFR9 — Offline-friendly.** `init` succeeds without a live database connection. The optional DB-version probe (FR8.3) is the only network operation involving the user's data plane; it is gated, opt-in, and non-fatal on failure. Package installation (the only other network operation) is governed by the user's chosen package manager and can be disabled with `--no-install`.

## Non-goals

- **NG1 — Bootstrap mode (P5).** `init` in a bare directory still bails with the existing actionable message ("Run `npm init` first"). Phase 2 may add `--bootstrap` or a dedicated `create-prisma-next` package. **Assumption:** worth deferring; the marginal users we lose to this are smaller than the build complexity of supporting it correctly across all PMs.
- **NG2 — Framework auto-detection.** Detecting Next.js / Astro / Remix and auto-installing framework-specific plugins is out of scope. Phase 2.
- **NG3 — Telemetry.** Anonymised init-success / init-failure tracking is out of scope. Phase 2 if at all.
- **NG4 — `prisma-next doctor` command.** A standalone diagnostic command is out of scope. The post-init validation logic lives inside `init`'s own success path.
- **NG5 — Editor integration.** VS Code extension, language server features, etc. — out of scope.
- **NG6 — Migration tooling.** `prisma-next db init` / migration scaffolding is a separate concern; this project only ensures `init` points the user at it via the outro / `nextSteps`.

# Acceptance Criteria

Grouped by the functional requirement that produced each criterion. Every criterion is binary and verifiable.

## Non-interactive mode (FR1, FR10)

- [ ] Running `prisma-next init --yes --target postgres --authoring psl` in a directory with `package.json` scaffolds without rendering any prompt, exits 0.
- [ ] Same with `--target mongodb`. Same with `--authoring typescript`. Same with explicit `--schema-path ./db/contract.prisma`.
- [ ] Running `prisma-next init </dev/null` (no TTY, no flags) exits **non-zero** with an error message naming the missing required flags. No "Done" banner. No files created.
- [ ] Running `prisma-next init --yes --json --target postgres --authoring psl > out.json` produces a JSON document on stdout containing `filesWritten`, `packagesInstalled`, `target`, `authoring`, `nextSteps[]`. The document validates against the published JSON schema.
- [ ] `prisma-next init --help` lists every flag (target, authoring, schema-path, force, write-env, probe-db, plus inherited globals).

## Project typechecks (FR2)

- [ ] In a fresh project after `prisma-next init --yes --target postgres --authoring psl && npm install`, `npx tsc --noEmit` exits 0.
- [ ] Same for `--target postgres --authoring typescript`.
- [ ] Same for `--target mongodb --authoring psl`.
- [ ] Same for `--target mongodb --authoring typescript`.

## Hygiene files (FR3)

- [ ] After `init`, `.env.example` exists and contains a target-appropriate `DATABASE_URL` line and a `# Requires <db> >= <version>` comment.
- [ ] After `init` in a directory with no `.gitignore`, `.gitignore` exists with `.env`, `dist/`, `node_modules/` lines.
- [ ] After `init` in a directory with an existing `.gitignore` already containing `node_modules/`, the file gains `.env` and `dist/` but `node_modules/` is not duplicated.
- [ ] After `init`, `.gitattributes` contains `prisma/contract.json linguist-generated` and `prisma/contract.d.ts linguist-generated`.
- [ ] Re-running `init --force` does not duplicate any line in `.gitignore` / `.gitattributes` / `package.json#scripts`.
- [ ] After `init`, `package.json#scripts` has a `contract:emit` entry mapping to `prisma-next contract emit`. If a script of that name already exists with a different command, `init` warns and skips.

## Mongo facade parity (FR4)

- [ ] In a TS file `import { db } from './prisma/db'; const u = await db.orm.User.where({}).first()`, `tsc --noEmit` exits 0 against the published `@prisma-next/mongo`.
- [ ] The same code, run against a live `mongod`, returns a typed result.
- [ ] `quick-reference-mongo.md` and `agent-skill-mongo.md` use `db.orm.…` as the primary example. Neither file references `db.sql`.
- [ ] Multi-document transactions are demonstrated via `db.transaction(async (tx) => …)` in `prisma-next.md` and noted as requiring a replica set.

## Templates × authoring (FR5)

- [ ] `prisma-next init --target postgres --authoring typescript` produces a `prisma-next.md` whose schema example block is TypeScript (no PSL `model { ... }`).
- [ ] Same for Mongo.
- [ ] The agent-skill file in a TS-authoring scaffold references `prisma/contract.ts` (not `.prisma`).
- [ ] The Postgres TS template and the Mongo TS template share `defineContract` signature, builder API shape, and field method names where capabilities overlap. (Snapshot test.)

## Hostile inputs (FR6)

- [ ] `init` against an existing JSONC `tsconfig.json` (with `// comments` and trailing commas) succeeds. The file's comments and ordering are preserved post-merge where possible.
- [ ] When `init` would have to fail mid-run (e.g. tsconfig is unparseable JSONC and JSON5), the project on disk is byte-identical to its pre-init state. `init` exits non-zero with an actionable error.

## pnpm install (FR7)

- [ ] No published Prisma Next package contains `workspace:*` or `catalog:` in its dependency specifiers (CI check at publish time, blocking).
- [ ] `pnpm dlx prisma-next@latest init --yes --target postgres --authoring psl` succeeds in a clean directory outside any pnpm workspace.
- [ ] When `pnpm add` fails with a workspace/catalog resolution error, `init` falls back to `npm install` and prints a clear warning naming the cause.

## DB version (FR8, NFR9)

- [ ] Both target packages export a programmatically-readable minimum server version.
- [ ] `init` writes the chosen target's minimum version into `.env.example` (as a comment) and `prisma-next.md` (as a "Requirements" section).
- [ ] When `DATABASE_URL` is set and `--probe-db` is passed, `init` connects, prints the server version, and warns if below minimum. Connection failure is non-fatal unless `--strict-probe`.
- [ ] When `--probe-db` is **not** passed and the user gives no interactive consent, `init` opens no network connection to the user's database under any flag combination — including `--strict-probe` alone, which is a no-op without `--probe-db`. (Network-trace test in CI.)
- [ ] First runtime `db.connect` against a below-minimum server emits exactly one structured warning via the framework's logger.

## Re-init (FR9)

- [ ] After `init --target postgres` then `init --force --target mongodb`, the project contains no Postgres-target artefacts (no `@prisma-next/postgres` in `package.json#dependencies`; no Postgres `contract.d.ts` lingering).
- [ ] After two consecutive `init --force` runs with the same arguments, the diff between the project after run 1 and run 2 is empty (modulo `package.json` ordering, which is itself stable).

## Outro (FR10)

- [ ] The interactive outro lists at least: how to set `DATABASE_URL`, the next command to run, the path to the agent skill.
- [ ] The `--json` outro contains a `nextSteps` array with the same content (one string per step, ordered).

# Other Considerations

## Security

- `init --json` MUST NOT echo `DATABASE_URL` or any credential read from `.env` into stdout. The probe (FR8.3) reports only `target`, `serverVersion`, and a `meetsMinimum` boolean.
- `.env` is added to `.gitignore` (FR3.3) before any `.env` content is written (FR3.2). `init` must not write `.env` if it cannot first ensure `.gitignore` contains it.
- `init` does not chmod / chown anything outside the project root, and writes only to declared scaffold paths (NFR4).

## Cost

- Zero ongoing cost. `init` is a CLI tool; no infrastructure dependency. The DB probe (FR8.3) makes one short-lived connection to the user's own DB.

## Observability

- Structured logger output at three verbosity levels (`-q` / default / `-v`). Default surfaces: pnpm fallback, script-collision skip, DB-version warnings.
- `--json` mode produces a single document (not a stream) on stdout for easy capture and parsing.
- Exit codes are documented (FR1.6) so callers can branch on them. **Assumption:** the existing `cli-error-handling` rule (see [`.cursor/rules/cli-error-handling.mdc`](../../.cursor/rules/cli-error-handling.mdc)) already covers the conventions; we extend rather than redefine.

## Data Protection

- `init` does not collect or transmit any user data (NG3 — telemetry deferred). The DB probe (FR8.3) is local-only — it connects from the user's machine to the user's database and reports the result back to the same machine.
- `.env` files written by `init` (FR3.2) live only on the user's disk and are gitignored before being created.

## Analytics

- Out of scope for phase 1 (NG3). When telemetry is added in a follow-up, it must be opt-in, anonymised, and clearly disclosed in `init`'s first run.

# References

- Linear issue: [TML-2263 — `init` follow-up improvements](https://linear.app/prisma-company/issue/TML-2263/init-follow-up-improvements)
- Spun-off Linear issue: [TML-2313 — Mongo dev replica-set story](https://linear.app/prisma-company/issue/TML-2313/mongo-dev-replica-set-story-is-missing-transactions-change-streams) (owns FR4.4 / FR8.4 dev-environment provisioning gap).
- Live-tested research with evidence index: [`assets/user-journey.md`](./assets/user-journey.md) (8 personas, 37 friction points, 11 roadblocks, E1–E14 reproducible scenarios).
- Previous shaping: [`projects/one-package-install/spec.md`](../one-package-install/spec.md) — the per-target facade design that this project completes.
- Repo `.gitattributes` (template for emitted-artefact diff hygiene): [`/.gitattributes`](../../.gitattributes).
- CLI scaffolding entry points:
  - [`packages/1-framework/3-tooling/cli/src/commands/init/`](../../packages/1-framework/3-tooling/cli/src/commands/init/)
  - [`packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts`](../../packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts) (`addGlobalOptions`)
  - [`packages/3-extensions/{postgres,mongo}/`](../../packages/3-extensions/) (the facades)
- Relevant cursor rules:
  - [`.cursor/rules/cli-error-handling.mdc`](../../.cursor/rules/cli-error-handling.mdc)
  - [`.cursor/rules/cli-package-exports.mdc`](../../.cursor/rules/cli-package-exports.mdc)
  - [`.cursor/rules/cli-e2e-test-patterns.mdc`](../../.cursor/rules/cli-e2e-test-patterns.mdc)
  - [`.cursor/rules/use-pathe-for-paths.mdc`](../../.cursor/rules/use-pathe-for-paths.mdc)

# Decisions

Decisions resolved with the project sponsor on 2026-04-26. Each is wired to the FR / NG / NFR it changes (or confirms). No questions remain open before planning.

1. **Mongo facade fix (FR4).** Fix `MongoClient<Contract>` so `db.orm.User` works directly off the runtime, mirroring Postgres. The explicit-`connect()` model is deprecated. (Confirms FR4.1, FR4.2.)
2. **Always add `@types/node` (FR2).** Always add `@types/node` to `devDependencies` if it is not already declared anywhere; always set `"types": ["node"]` in the scaffolded `tsconfig.json` when `moduleResolution` is `bundler` and Node types would otherwise be hidden. (Confirms FR2.1, FR2.2.)
3. **`init` is offline-by-default (FR8, NFR9).** DB-version probe is opt-in. **`init` never requires a live DB connection** — explicitly added as NFR9 and reinforced in FR8.3: `--strict-probe` only escalates probe **failures** to fatal, it never causes a probe to be attempted on its own. Without `--probe-db` and without interactive consent, `init` opens no network connection to the user's database.
4. **Mongo replica-set: doc-only in this project; gap tracked separately.** FR4.4 / FR8.4 document the requirement and link to [TML-2313](https://linear.app/prisma-company/issue/TML-2313/mongo-dev-replica-set-story-is-missing-transactions-change-streams), which owns the dev-environment provisioning story (docker-compose / mongodb-memory-server / Atlas + runtime warning). `init` advises, never auto-provisions.
5. **`.gitattributes` — forward-looking subset (FR3.4).** Mirror the user-project-relevant subset of [`/.gitattributes`](../../.gitattributes): `prisma/contract.json`, `prisma/contract.d.ts`, `prisma/end-contract.*`, `prisma/start-contract.*`, `prisma/ops.json`, `prisma/migration.json` — all marked `linguist-generated`. We write the entries on first `init` even for files that don't exist until a later `prisma-next` command runs; this avoids a re-init churn cycle. (Confirms FR3.4.)
6. **`contract:emit` script name (FR3.5).** The npm script name mirrors the CLI subcommand path (`prisma-next contract emit`) rather than namespacing under the package name. Short, conventional, and leaves `contract:check`, `contract:diff` available for future commands without prefix churn. (Resolves FR3.5: `contract:emit` over `prisma-next:emit` / `db:generate` / `prisma:emit`.)
7. **Bootstrap mode deferred (NG1).** `init` in a bare directory keeps its existing actionable error ("Run `npm init` first"). `--bootstrap` and a dedicated `create-prisma-next` package remain phase 2.
8. **pnpm catalog: honour-and-warn (FR7.3).** Inside a pnpm workspace whose catalog overrides `latest`, `init` uses the catalog version and emits a structured warning naming the override so the user can pin the published `latest` if they want.
9. **No watch-mode script (FR3.5).** The `package.json` scripts written by `init` do **not** include a `contract:emit:watch`. File-watching during dev belongs to the build tool (Vite plugins, etc.) — adding a half-working watch script in `init` would just compete with whatever the user's framework already provides.
