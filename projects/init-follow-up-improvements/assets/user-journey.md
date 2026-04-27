# User Journeys: `prisma-next init` follow-up

This document catalogs how real users (and agents) experience `prisma-next init` today, what works, and where they hit friction. It is the primary input for the project spec at [`../spec.md`](../spec.md).

The previous shaping ([`projects/one-package-install/`](../../one-package-install/)) shipped a working `init` command and the per-target facade (`@prisma-next/postgres`, `@prisma-next/mongo`). This follow-up is about making `init` actually deliver on the experience that spec promised — for **every** combination of (target × authoring × persona × project state), not just the Postgres-PSL happy path.

---

## How this document was produced

Friction is annotated with **[E#]** evidence pointers. Evidence comes from one of:

- **Live runs** of `pnpm dlx prisma-next@latest init` (or scaffolded equivalents). The captured outputs live under [`evidence/`](./evidence/) — see [`evidence/README.md`](./evidence/README.md) for the E1–E14 index and reproduction instructions. (The original runs were performed in the gitignored `wip/init-experiments/` tree; this directory is the in-repo, committed snapshot.)
- **Code reads** of [`packages/1-framework/3-tooling/cli/src/commands/init/`](../../../packages/1-framework/3-tooling/cli/src/commands/init/) and the published `@prisma-next/{postgres,mongo}` runtimes (`node_modules/@prisma-next/mongo/dist/runtime.d.mts`, etc.).
- **Reproductions of user-reported behaviour** in the prior chat (TML-2263).

Test environment: macOS, Node 24.13.0, pnpm 10.27.0, npm 11.6.2. Published packages at versions: `prisma-next@0.4.1`, `@prisma-next/postgres@0.4.1`, `@prisma-next/mongo@0.4.1` (latest dist-tag).

---

## Personas

| ID | Persona | Distinguishing traits |
|---|---|---|
| **P1** | **Greenfield Postgres user** | New project, no existing config, `pnpm init`'d. Picks defaults at every prompt. The "demo path". |
| **P2** | **Greenfield Mongo user** | Same as P1 but picks MongoDB. Currently the worst-served first-class persona. |
| **P3** | **TypeScript-authoring user** | Picks "TypeScript (.ts)" instead of PSL when prompted. Cuts across P1/P2. |
| **P4** | **AI coding agent / CI script** | Has no TTY, can't navigate clack widgets, expects flags + JSON output. |
| **P5** | **Bare-directory bootstrapper** | Runs `pnpm dlx prisma-next init` in an empty folder, expecting the tool to bootstrap everything (à la `npm create vite`). |
| **P6** | **Existing-project adopter** | Adds Prisma Next to a real Next.js / Vite / Astro app with an existing `tsconfig.json` (with comments), existing `.gitignore`, etc. |
| **P7** | **Iterator / re-runner** | Runs `init` more than once: first run failed, or they want to switch target / authoring. |
| **P8** | **Monorepo user** | Adds Prisma Next to one workspace package (pnpm/turbo/nx workspaces). Cwd is a sub-package, not the repo root. |

P1 is what `init` was designed for. P2–P8 currently range from "subtly broken" to "completely blocked".

---

## J1 — P1: Greenfield Postgres + PSL (the "demo path")

### What the user does

1. `mkdir my-app && cd my-app`
2. `pnpm init` (creates an empty `package.json`)
3. `pnpm dlx prisma-next@latest init`
4. Accepts every default: PostgreSQL, Prisma Schema Language, `prisma/contract.prisma`.
5. Watches files get scaffolded, deps get installed, contract gets emitted.
6. Reads `prisma-next.md`, opens `prisma/contract.prisma`, edits a model.
7. `pnpm prisma-next contract emit`.
8. Writes `import { db } from './prisma/db'` and a query.

### What works

- The 5-file scaffold (contract, config, db.ts, quick-reference.md, agent skill) lands as advertised.
- Templates are correct PSL with realistic models.
- After `npm install` finishes, `npx prisma-next contract emit` produces a clean `contract.json` + `contract.d.ts` with **no missing-deps warning** [**E1**: `02-pg-psl/install-npm-output.txt`].
- Once `@types/node` is present and `tsconfig.types` is set to `["node"]`, a real `db.orm.User.where(...).first()` query typechecks cleanly. [**E2**: ditto + `query.ts` in same dir]

### Friction

- **F1 — `tsc --noEmit` fails out of the box.** The scaffolded `prisma-next.config.ts` references `process.env['DATABASE_URL']`, but init doesn't install `@types/node` and the scaffolded `tsconfig.json` doesn't add `"types": ["node"]`. The user gets `error TS2591: Cannot find name 'process'.` on a fresh install before they've written any of their own code. [**E3**: `02-pg-psl/install-npm-output.txt` "TSC_EXIT=2"]
- **F2 — No `.env` is created.** `prisma-next.md` and the agent skill both reference a `.env` file with `DATABASE_URL=...` but `init` doesn't create one. The user has to read a markdown doc to discover this and write it themselves. The first thing they hit when they try to actually run a query is a connection error.
- **F3 — No `package.json` scripts.** `pnpm prisma-next contract emit` works but the user gets no convenience scripts in `package.json`. Other scaffolders (Prisma ORM, Drizzle, Vite) add at least `db:generate` / `db:push` style scripts.
- **F4 — No `.gitignore` updates.** Init does not add `dist/`, `.env`, or anything else to `.gitignore`. The scaffolded `tsconfig.json` defines `"outDir": "dist"` but nothing tells git to ignore it.
- **F5 — No "what next?" actionables tied to the user's database.** The outro ("Done! Open `prisma-next.md` to get started.") is information-poor. There's no `pnpm prisma-next db init` suggestion, no `pnpm dev` pointer, no link to a starter query.
- **F6 — `pnpm install` fails for some users.** When init detects pnpm and runs `pnpm add prisma-next`, it can fail with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` (`@prisma-next/core-control-plane@workspace:*` leaks via `@prisma-next/migration-tools`) or `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER` (`arktype@catalog:` leaks the same way). The same install via npm succeeds. Init has no fallback strategy. [**E4**: `02-pg-psl/install-output.txt` initial error block]
- **F7 — No `.gitattributes` updates.** Init emits `prisma/contract.json` and `prisma/contract.d.ts` and tells the user to commit them. Without a `linguist-generated` mark on these files, GitHub treats every emit as a hand-written diff: PRs balloon, the repo's "Languages" stat is dominated by emitted JSON/TS, and reviewers are nudged to scrutinize generated code. The Prisma Next monorepo itself solves this with [`.gitattributes`](../../../.gitattributes) (lines 3–4) — user projects need the same entries.
- **F8 — No DB-target version requirement is enforced anywhere in the system.** Prisma Next does not declare a minimum required Postgres / MongoDB server version, does not check it at `init` / `contract emit` / `db init` / first connection, and does not surface incompatibilities until the user hits a runtime error from the driver. The user could happily `init` against Postgres 9 or MongoDB 3.6 and only discover the gap when a query fails for unexplained reasons. Init is the natural place to detect (or at least communicate) the supported version range.

### Severity

P1 is the scenario `init` was designed for, and it's the closest to working. F1 + F2 + F6 between them mean "happy path" still requires a non-trivial recovery for the average pnpm user.

---

## J2 — P2: Greenfield Mongo + PSL

### What the user does

Identical to J1 except they pick MongoDB at the first prompt.

### What works

- Scaffold is correct PSL Mongo schema (`ObjectId`, `@map("_id")`, `@@map`).
- `npm install @prisma-next/mongo dotenv && npm i -D prisma-next` succeeds against `0.4.1`.
- Contract emit produces a clean `contract.json` + `.d.ts` with **no missing-deps warning** when installed via npm into `node_modules/` (because `@prisma-next/mongo@0.4.1`'s `package.json` lists `@prisma-next/adapter-mongo` and `@prisma-next/mongo-contract` as direct deps). [**E5**: `03-04-05-mongo-psl/install-npm-output.txt`]

### Friction

All of P1's friction (F1–F8) plus:

- **F9 — Agent skill is wrong for Mongo.** [`agent-skill-mongo.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-mongo.md) tells the agent to use `db.orm.User.where(...)`. With the published `@prisma-next/mongo@0.4.1`, `db` is `MongoClient<Contract>` which **has no `.orm` property** — `tsc` says `Property 'orm' does not exist on type 'MongoClient<Contract>'`. An LLM following this skill would generate non-compiling code on the very first query. [**E6**: `03-04-05-mongo-psl/query.ts`+ tsc output]
- **F10 — Even the *correct* documented Mongo pattern doesn't typecheck.** [`quick-reference-mongo.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/quick-reference-mongo.md) tells the human user to do `const client = await db.connect(url, 'mydb'); client.orm.User.where(...)`. With the published facade, `client.orm.User.where` resolves as `Property 'where' does not exist on type 'never'` — even though `@prisma-next/mongo-orm` clearly exports a typed orm. The Mongo type chain breaks somewhere between the facade and the orm. [**E7**: same file]
- **F11 — Mongo agent skill is a copy-paste of the Postgres skill.** Line 26 of [`agent-skill-mongo.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-mongo.md) says "Only fall back to `db.sql` if the user explicitly asks for raw queries". `db.sql` is meaningless on Mongo. The skill also uses Postgres examples (`field.eq`, `orderBy`) without verifying they work for Mongo's orm.
- **F12 — Mongo and Postgres facades aren't at parity.** Postgres: `db.orm.User.where(...).first()` works directly off the runtime client. Mongo: requires an explicit `connect(url, dbName)` call before any query, and even then the typed orm is broken. The mongo-flavoured `prisma-next.md` papers over this with a different code sample, but the asymmetry leaks into every doc, every tutorial, every agent skill.
- **F13 — Mongo TS schema requires a `dbName` argument that doesn't exist anywhere in the scaffold.** Both `prisma-next.md` and the agent skill assume the user knows to put the database name (`'mydb'`) in code. There's no prompt for it during init, no `.env` variable for it, no comment in `db.ts` mentioning it.
- **F14 — Mongo-specific feature gaps surface only at runtime.** Several Mongo features (e.g. multi-document transactions, change streams, `$lookup` aggregations used by relations) require a replica-set deployment and a minimum server version. Init doesn't ask the user about their deployment shape and doesn't warn that a standalone `mongod` will silently degrade behaviour. (See also F8 for the system-wide DB-version-check gap.)

### Severity

P2 is silently broken end-to-end for typed querying. The agent skill misleads agents; the quick-reference misleads humans; the facade is incomplete. This is the single largest gap surfaced by this exercise.

---

## J3 — P3: TypeScript authoring (cuts across P1/P2)

### What the user does

Same as J1/J2 but selects "TypeScript (.ts)" at the second prompt.

### What works

- The right schema file gets scaffolded (`prisma/contract.ts`).
- The config and `db.ts` correctly point at `contract.ts`.
- The TS schema for **Postgres** uses the callback builder pattern (`defineContract({family,target}, ({field, model, rel}) => ({...}))`).
- The TS schema for **Mongo** uses a top-level imports pattern (`import {field, model, rel} from ...; defineContract({family, target, models})`).

### Friction

All of P1/P2 friction plus:

- **F15 — `prisma-next.md` is wrong for TS users.** The scaffolded quick-reference shows a **PSL `model User { ... }` code block** even when the user picked TypeScript. The doc only differentiates by target (`postgres`/`mongo`), not by authoring (`psl`/`typescript`). A new user reading this is told "your schema looks like this" and shown syntax that has nothing to do with the file they actually have. [**E8**: `03-04-05-pg-ts/prisma-next.md` lines 10–19]
- **F16 — Agent skill has the same problem.** [`agent-skill-{postgres,mongo}.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/) hard-codes `prisma/contract.prisma` and PSL examples. A TS-authoring project gets an agent skill that contradicts the actual contract.
- **F17 — TS schema templates are inconsistent across targets.** Four axes of divergence between `starterSchemaTsPostgres()` and `starterSchemaTsMongo()` (see [`code-templates.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts) lines 66–135):
  1. Builder API: callback `(builders) => ({...})` for Postgres vs. top-level `field/model/rel` imports for Mongo.
  2. `defineContract` signature: 2-arg curried for Postgres vs. single-object with `models` key for Mongo.
  3. Field method names: `field.text()` for Postgres vs. `field.string()` for Mongo.
  4. Relation references: `'User'` string for Postgres vs. `User.ref('_id')` for Mongo.
  None of this is documented; switching from PG to Mongo (or learning both) requires re-learning the API.
- **F18 — TS contract requires direct imports from packages init doesn't always install.** The TS Postgres template imports from `@prisma-next/family-sql/pack`, `@prisma-next/sql-contract-ts/contract-builder`, `@prisma-next/target-postgres/pack`. The TS Mongo template imports from `@prisma-next/family-mongo/pack`, `@prisma-next/mongo-contract-ts/contract-builder`, `@prisma-next/target-mongo/pack`. With pnpm strict isolation, these may not resolve from the project root unless the facade lists them as direct deps (and re-exports their builders).

### Severity

P3 is currently a second-class citizen. The presence of "TypeScript (.ts)" as a first-prompt option implies parity; the artefacts say otherwise.

---

## J4 — P4: AI coding agent / CI script

### What the user does

An agent or script wants to run `prisma-next init` non-interactively. It either:

- Runs `pnpm dlx prisma-next init --yes --target postgres --authoring psl`, or
- Pipes nothing into stdin and expects the CLI to use defaults, or
- Runs in a CI environment with no TTY.

### What works

Nothing. There is no non-interactive mode.

### Friction

- **F19 — `--yes` is rejected as `unknown option`.** [**E9**: `06-noninteractive/init-output.txt`]
- **F20 — No init-specific flags exist.** The init command only registers `--no-install`. There is no `--target`, `--authoring`, `--schema-path`, `--force`. [Code: [`commands/init/index.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/init/index.ts) lines 13–15.]
- **F21 — No-TTY exit is silent and lies about success.** Run `prisma-next init </dev/null` (simulating any CI/agent environment): the CLI renders the first clack `select` prompt, then aborts when stdin closes — and exits with **status code 0**. No error message, no `--no-interactive` advice, no files created. An automation that doesn't check for files-on-disk would think init succeeded. [**E10**: `06-noninteractive/init-output.txt` "EXIT=0"]
- **F22 — No machine-readable output.** Even if the prompts were skippable, the spinner output goes to stderr and has no `--json` mode. An agent that wants to know "what files were written, what packages were installed, what's the next command" has nothing structured to parse.
- **F23 — No `addGlobalOptions` wiring.** The CLI's standard global flags (`--json`, `-q`, `-v`, `--trace`, `--no-color`, `--interactive`, `--no-interactive`, `-y`) are defined in [`utils/command-helpers.ts`](../../../packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts) but not applied to the `init` command. Every other command gets them; init doesn't.

### Severity

P4 is **completely blocked**. This is the headline finding from TML-2263. For agent-driven workflows (which is increasingly how new tools get adopted), Prisma Next is invisible until init is scriptable.

---

## J5 — P5: Bare-directory bootstrapper

### What the user does

`mkdir new-app && cd new-app && pnpm dlx prisma-next@latest init`. They expect this to "just work" the way `npm create vite@latest` or `pnpm create next-app` does — bootstrap a project from nothing.

### What works

The CLI detects there's no `package.json` and prints a clear error.

### Friction

- **F24 — The CLI bails instead of bootstrapping.** Output: `■ No package.json or deno.json found. Initialize your project first (e.g. npm init or deno init), then re-run prisma-next init.` This is correct as a precondition check, but it's the wrong default for a tool whose goal is "fast time to first query". [**E11**: `01-blank-dir/init-output.txt`]
- **F25 — No `--bootstrap` / `create` mode.** Tools that win the "0 → working app in 60 seconds" race (Vite, Next, T3, Drizzle Kit) all support being run in an empty directory. Prisma Next requires the user to know about and run `npm init` / `pnpm init` first, then re-run dlx, which downloads the tarball a second time (no-op cached but visible).

### Severity

Medium. The current behaviour is at least correct and gives an actionable hint, but the friction is exactly the kind that loses users to "I tried it once, doesn't work" reviews.

---

## J6 — P6: Existing-project adopter (Next.js, Astro, Remix, …)

### What the user does

`cd my-existing-next-app && pnpm dlx prisma-next@latest init`. They have:

- A real `tsconfig.json` (with comments — JSONC is the TypeScript/VS Code default).
- A `.gitignore` they already curate.
- A `package.json` with framework deps and possibly conflicting scripts.
- An existing `prisma/` directory if they came from Prisma ORM.

### What works

`hasProjectManifest()` detects the existing `package.json`, so the bare-dir guard doesn't fire.

### Friction

- **F26 — `mergeTsConfig` crashes on JSONC `tsconfig.json`.** `init` calls [`mergeTsConfig`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig.ts) which does `JSON.parse(existing)` directly. Real-world `tsconfig.json` files have `// comments` (officially supported by TS, used by `tsc --init` output, used by every Next.js scaffolder). `init` then throws `SyntaxError: Expected property name or '}' in JSON` and **leaves the project half-initialized** (the schema, config, and db.ts files are written before tsconfig is merged). [**E12**: `08-existing-tsconfig/scaffold-output.txt`]
- **F27 — No collision detection for existing `prisma/` artefacts.** If the user already has `prisma/schema.prisma` (from Prisma ORM) or another `db.ts`, init silently overwrites them with no warning. The only existing-file check is for `prisma-next.config.ts` itself.
- **F28 — No framework detection.** Init doesn't notice it's running inside a Next.js project. There's no Next-specific advice ("add `experimental.serverActions = true`"), no plugin auto-install (the quick-reference mentions an unspecified "Prisma Next plugin"), no `app/` vs `pages/` awareness.
- **F29 — `package.json` script collisions.** Init doesn't add scripts, but if it did (per F3), it has no logic to detect existing `db:generate` / similar scripts the framework template might already define.
- **F30 — `.gitignore` is not modified.** Even if `dist/` is already ignored, `.env` may not be. Init doesn't help.

### Severity

High for adoption. P6 is the most common real-world scenario after P1, and F23 is a hard crash on what TypeScript itself considers normal config.

---

## J7 — P7: Iterator / re-runner

### What the user does

Runs `prisma-next init` more than once. Reasons:

- First run failed (any of F6, F18, F23) and they're retrying.
- They want to switch from Postgres to Mongo (or PSL to TS) after experimenting.
- They got the schema path wrong and want to redo it.

### What works

The re-init prompt: `"This project is already initialized. Re-initialize? This will overwrite all generated files."` — single confirm, accepts → overwrites.

### Friction

- **F31 — Re-init leaves stale emitted artefacts.** The re-init code path overwrites `contract.prisma`, `prisma-next.config.ts`, `db.ts`, `prisma-next.md`, and the agent skill. It does **not** delete `prisma/contract.json` or `prisma/contract.d.ts`. Switching from Postgres to Mongo: the user ends up with a Mongo `contract.prisma` next to a Postgres `contract.d.ts` until they remember to run `contract emit`. The published init does emit at the end of the run *if install succeeded*, but if install fails (F6) or `--no-install` is used, the stale types persist. [**E13**: `07-reinit/` listing]
- **F32 — No "switch target" / "switch authoring" path.** The mental model "I want to switch from PSL to TS" is reasonable but undocumented. The user has to know that re-init covers it.
- **F33 — Re-init doesn't roll back package.json changes.** If the user switched from Postgres to Mongo, `@prisma-next/postgres` stays in `dependencies` alongside the newly added `@prisma-next/mongo`. Subsequent `pnpm install` works but the user is shipping dead deps.
- **F34 — Re-init doesn't roll back tsconfig changes.** If `mergeTsConfig` ran successfully on the first init, re-init re-runs it (idempotent), but if the user manually adjusted the merged config, the second run silently re-asserts the required options.

### Severity

Medium. Most users won't re-init. Those who do hit a half-initialized project that's hard to reason about.

---

## J8 — P8: Monorepo user

### What the user does

`cd packages/api && pnpm dlx prisma-next init` inside a pnpm/turbo/nx workspace. They want Prisma Next set up only in the `api` package, not at the repo root.

### What works (untested but inferred from code)

- `hasProjectManifest()` checks for `package.json` in the cwd, so a sub-package works.
- Lockfile detection walks up via the package manager itself; `pnpm add` from a workspace package will modify that package's `package.json`.

### Friction (inferred)

- **F35 — Lockfile is at the repo root, not the cwd.** [`detectPackageManager`](../../../packages/1-framework/3-tooling/cli/src/commands/init/detect-package-manager.ts) checks for lockfiles in `baseDir`. In a pnpm workspace, only the root has `pnpm-lock.yaml`. The detector likely falls back to `npm` for sub-packages, leading to mixed-PM installs (npm in a pnpm workspace).
- **F36 — `pnpm-workspace.yaml` interferes with `pnpm dlx`.** Confirmed live: even our scratch dir under `wip/` had pnpm resolve `@prisma-next/mongo@latest` to `0.3.0` (an older version) instead of `0.4.1`, presumably because the parent workspace's catalog/store cache won. The published `latest` is 0.4.1; pnpm installed 0.3.0. The 0.3.0 version doesn't list `@prisma-next/adapter-mongo` and `@prisma-next/mongo-contract` as direct deps, so it would also re-trigger the missing-deps warning. [**E14**: `04b-mongo-pnpm/install-pnpm-output.txt`]
- **F37 — Prisma Next config and contract paths are relative to cwd.** No friction in itself, but the agent skill / quick-ref docs assume project root layout (`./prisma/db.ts`). In a monorepo, the user might want `apps/api/prisma/db.ts` but the docs don't help them think about this.

### Severity

Medium. Monorepos are common for Prisma Next's likely audience (apps that scale).

---

## Cross-cutting Roadblocks

These cut across multiple journeys.

### R1 — No non-interactive mode (F19, F20, F21, F22, F23)

Headline TML-2263 finding. Blocks every automation, every CI, every agent. Should ship `--target`, `--authoring`, `--schema-path`, `--force`, and inherit the standard global flags (`--yes`, `--no-interactive`, `--json`, `-q`, `-v`).

### R2 — Mongo facade isn't at parity with Postgres (F9, F10, F12, F13)

The facade ships, but its runtime API requires explicit `connect()`, the typed orm doesn't actually surface through the published package, and the docs we ship contradict each other and the runtime. Until this is fixed, **the Mongo init is a trap**: it produces a project that compiles but can't be queried with types.

### R3 — Templates don't accommodate authoring choice (F15, F16, F17)

The `(target × authoring)` matrix has 4 cells. Quick-reference and agent skill templates only differentiate by target. The TS templates themselves are inconsistent in API across targets, which then bleeds into docs that can't be unified.

### R4 — pnpm install can't always install the published packages (F6, F36)

`workspace:*` (originally TML-2263 cause) is fixed for `prisma-next` itself, but `@prisma-next/migration-tools` still leaks `workspace:*` and `arktype@catalog:` references. Plus pnpm's workspace catalog can shadow the published `latest` tag. Either install with npm (init falls back) or strip residual workspace/catalog refs at publish time.

### R5 — The scaffold doesn't produce a project that typechecks (F1)

Out of the box: `tsc --noEmit` fails on the scaffolded `prisma-next.config.ts`. Adding `@types/node` to dev deps + `"types": ["node"]` to the scaffolded tsconfig closes this.

### R6 — Critical files the user needs aren't created (F2, F3, F4, F7, F30)

`.env`, `.gitignore` modifications, `.gitattributes` for emitted artefacts (so PR diffs don't drown in generated content), `package.json` scripts. Every successful CLI scaffolder creates these. We don't.

### R7 — The CLI gives up on hostile-but-normal inputs (F26, F24, F36)

JSONC `tsconfig.json` crashes the merge. Bare directory bails instead of bootstrapping. pnpm catalog interference is silently honoured. We need to either survive these or recover with a clear, actionable next step.

### R8 — Outro is information-poor (F5)

"Done! Open `prisma-next.md` to get started." doesn't tell the user the next concrete thing to do (set `DATABASE_URL`, run `prisma-next db init`, write a query). For agents this is even more critical: they need a structured next-step list, not a markdown link.

### R9 — Re-init is partial (F31, F33, F34)

Stale `contract.json` / `contract.d.ts`, dead deps, untouched manual edits.

### R10 — The CLI lies on stdin-closed (F21)

`exit 0` after silent abort is not just unfriendly, it's a correctness bug. Anything wrapping the CLI assumes success unless the caller checks for files-on-disk.

### R11 — No DB-target version compatibility is enforced anywhere (F8, F14)

Prisma Next has no declared minimum supported Postgres or MongoDB server version, no version probe, and no advisory output. Init is the natural surface for this — it's the moment we know the user's target and the moment we could check it (best-effort, e.g. "if `DATABASE_URL` is set, try `SELECT version()` / `db.runCommand({buildInfo:1})`; otherwise emit the requirement into `.env.example` / `prisma-next.md`"). Mongo is most exposed (transactions / change streams need a replica set + ≥4.0; relations via `$lookup` have version-specific behaviour) but Postgres is not exempt (e.g. minimum version for the SQL features we generate).

---

## What's already correct (don't regress)

- The 5-file scaffold layout (`prisma/{contract.*,db.ts,…}` + root `prisma-next.config.ts` + root `prisma-next.md` + `.agents/skills/prisma-next/SKILL.md`).
- The PSL starter schemas for both targets — they're realistic, small, and emit cleanly.
- The Postgres TS starter schema — it's wordier than PSL, but it does work end-to-end (queries typecheck).
- The single-package facade idea (`@prisma-next/postgres` / `@prisma-next/mongo`) — Postgres delivers on it; Mongo is the gap, not the design.
- Re-init confirm-once UX (vs. per-file prompts) — the right primitive even if the implementation needs F28's cleanup.
- The post-emit `validateContractDeps` warning — useful, just doesn't fire in npm-flat-tree installs because deps actually resolve.

---

## Open Questions for the spec phase

> **All resolved 2026-04-26.** See [`../spec.md` § Decisions](../spec.md#decisions). The list below is preserved as a research-phase snapshot — it captures the questions the user-journey raised, not the final answers.


1. **Bootstrap mode (P5).** Should `init` in a bare directory `npm init -y` for the user? Or print the command and offer to run it? Or stay strict and just improve the error message?
2. **Mongo facade fix vs. work-around.** Fix `MongoClient` so `db.orm.User` works directly (Postgres parity) — or update docs to reflect the explicit-`connect()` model and accept the asymmetry. Recommend the former.
3. **Framework detection scope.** Do we ship Next.js auto-detection (and reference the not-yet-existing plugin) in this iteration, or save it for a follow-up?
4. **Bootstrapping vs. detection of `@types/node`.** Always install it? Detect existing types support? Update tsconfig with `"types": ["node"]` even when `@types/node` is already present?
5. **Monorepo lockfile detection.** Walk up to find a workspace root, or use `package.json#packageManager`, or both?
6. **Telemetry.** Track init success/failure (anonymized) to learn which scenarios actually break in the wild?
7. **`prisma-next-doctor`-equivalent.** Should `init --check` (or a new `prisma-next doctor` command) re-run the post-init validations and print a green/red list?
8. **DB version policy and where to enforce it (R11).** Where does the supported-version range live (per-target package metadata? the family contract? `target-postgres` / `target-mongo`?)? Does `init` *probe* (requires `DATABASE_URL` at init time, which we don't currently demand) or just *declare* (write the requirement into `.env.example` + `prisma-next.md` and defer the actual check to first connection or a separate `prisma-next doctor`)? For Mongo, do we go further and require / advise a replica-set deployment?
9. **`.gitattributes` ownership.** Always create one? Append to an existing one? Use `linguist-generated` (GitHub-only) or also `merge=binary` / `-diff` (universal)? Which paths exactly — just `prisma/contract.{json,d.ts}` or also future emitted artefacts (`prisma/migrations/...`, `prisma/ops.json`, `prisma/end-contract.*`)? Mirror exactly the entries from this repo's [`.gitattributes`](../../../.gitattributes), or a project-scoped subset?

---

## Evidence index

The captured outputs are committed under [`evidence/`](./evidence/). See [`evidence/README.md`](./evidence/README.md) for the full index with reproduction instructions.

| ID | Source |
|---|---|
| E1 | [`evidence/02-pg-psl/install-npm-output.txt`](./evidence/02-pg-psl/install-npm-output.txt) (Postgres install + emit, no warning) |
| E2 | [`evidence/02-pg-psl/query.ts`](./evidence/02-pg-psl/query.ts) + tsc result (`TSC_EXIT=0` after `--types node`) |
| E3 | [`evidence/02-pg-psl/install-npm-output.txt`](./evidence/02-pg-psl/install-npm-output.txt) (`TSC_EXIT=2` without `--types node`) |
| E4 | [`evidence/02-pg-psl/install-output.txt`](./evidence/02-pg-psl/install-output.txt) (initial `pnpm` attempt before fallback to npm) |
| E5 | [`evidence/03-04-05-mongo-psl/install-npm-output.txt`](./evidence/03-04-05-mongo-psl/install-npm-output.txt) (Mongo emit succeeds, no warning) |
| E6 | [`evidence/03-04-05-mongo-psl/query.ts`](./evidence/03-04-05-mongo-psl/query.ts) (tsc: `Property 'orm' does not exist on type 'MongoClient<Contract>'`) |
| E7 | Same file, modified to `client = await db.connect(...)` (tsc: `Property 'where' does not exist on type 'never'`) |
| E8 | [`evidence/03-04-05-pg-ts/prisma-next.md`](./evidence/03-04-05-pg-ts/prisma-next.md) (PSL code block in TS scaffold) |
| E9 | [`evidence/06-noninteractive/init-output.txt`](./evidence/06-noninteractive/init-output.txt) (`error: unknown option '--yes'`) |
| E10 | Same file (`</dev/null` run, exits 0 after rendering first prompt) |
| E11 | [`evidence/01-blank-dir/init-output.txt`](./evidence/01-blank-dir/init-output.txt) |
| E12 | [`evidence/08-existing-tsconfig/scaffold-output.txt`](./evidence/08-existing-tsconfig/scaffold-output.txt) (`SyntaxError: Expected property name or '}'`) |
| E13 | [`evidence/07-reinit/directory-listing.txt`](./evidence/07-reinit/directory-listing.txt) (no `contract.json` rewrite after target switch) |
| E14 | [`evidence/04b-mongo-pnpm/install-pnpm-output.txt`](./evidence/04b-mongo-pnpm/install-pnpm-output.txt) (`@prisma-next/mongo 0.3.0 (0.4.1 is available)`) |

[`evidence/scaffold.ts`](./evidence/scaffold.ts) is the deterministic-scaffold reproduction script. It imports the CLI's template functions directly and writes their output to a target directory — bypassing `clack` so the scaffold step is reproducible without TTY simulation. To regenerate any scenario, copy it into the gitignored `wip/` tree and run from there:

```bash
mkdir -p wip/init-experiments
cp projects/init-follow-up-improvements/assets/evidence/scaffold.ts wip/init-experiments/

# Re-run the missing-deps + facade tests:
pnpm exec tsx wip/init-experiments/scaffold.ts wip/init-experiments/02-pg-psl postgres psl
cd wip/init-experiments/02-pg-psl && npm install && npx prisma-next contract emit && npx tsc --noEmit --types node
cd ../03-04-05-mongo-psl && npm install && npx prisma-next contract emit && npx tsc --noEmit --types node

# Re-run the no-TTY test:
mkdir -p wip/init-experiments/06-noninteractive && cd wip/init-experiments/06-noninteractive && pnpm init -y && pnpm dlx prisma-next@latest init </dev/null

# Re-run the JSONC tsconfig test:
pnpm exec tsx wip/init-experiments/scaffold.ts wip/init-experiments/08-existing-tsconfig postgres psl
```
