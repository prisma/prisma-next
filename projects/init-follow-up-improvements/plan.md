# `init` Follow-up Improvements — Project Plan

## Summary

This is a sketch. The detailed plan (milestones with tasks, owners, ordering, and test mapping back to acceptance criteria) is generated via `drive-generate-plan` once `spec.md` is finalised.

**Spec:** [`spec.md`](./spec.md)
**Research:** [`assets/user-journey.md`](./assets/user-journey.md)

The milestones below are organised so each one is independently shippable: every milestone closes a roadblock (or set of related roadblocks) end-to-end and yields user-visible value. They are ordered by a mix of dependency (the publish-time fix in M2 unblocks others), risk (Mongo facade is the single largest gap), and TML-2263 priority (non-interactive mode is the headline).

## Milestones

### Milestone 1 — Non-interactive mode + structured output (R1, R10)

Closes FR1 and FR10. Headline TML-2263 finding; unblocks every CI / agent flow.

**Tasks (sketch):**

- [ ] Wire `addGlobalOptions` into the `init` command (registers `--yes`, `--no-interactive`, `--json`, `-q`, `-v`, `--no-color`).
- [ ] Add init-specific flags: `--target`, `--authoring`, `--schema-path`, `--force`, `--write-env`, `--probe-db`, `--strict-probe`.
- [ ] Refactor `runInit` so every clack prompt has a flag-driven equivalent and a non-interactive fallback that errors clearly when input is missing.
- [ ] Detect non-TTY stdin: error non-zero with an actionable message instead of silently exit-0 (closes FR1.4).
- [ ] Define `arktype` schema for the `--json` output document; emit on stdout exclusively, route human output to stderr.
- [ ] Document stable exit codes; add E2E coverage for each.
- [ ] Replace the bare "Done" outro with a structured `nextSteps` list (FR10).

### Milestone 2 — Publish hygiene + pnpm reliability (R4)

Closes FR7. Unblocks `pnpm dlx` for the published packages and is a precondition for end-to-end M5 / M6 testing against published builds.

**Tasks (sketch):**

- [ ] Audit every published package for residual `workspace:*` and `catalog:` dependency specifiers.
- [ ] Add a publish-time CI gate that fails when any published package has a `workspace:*` / `catalog:` dependency.
- [ ] Strip the leak in `@prisma-next/migration-tools` (and any other offenders found by the audit).
- [ ] Implement the `pnpm` → `npm` fallback in `init` with a clear warning on the recognised error class.
- [ ] Detect `pnpm-workspace.yaml` catalog entries that override the packages `init` installs and emit a structured warning (FR7.3 / Decision 8).
- [ ] Document workspace-catalog interaction with `pnpm dlx` in `prisma-next.md` (FR7.3).

### Milestone 3 — Mongo facade parity (R2)

Closes FR4. Highest user-impact gap surfaced by the research; without this, the Mongo init produces a project that compiles but cannot be queried with types.

**Tasks (sketch):**

- [ ] Add `db.orm` directly to `MongoClient<Contract>` with lazy connection semantics (FR4.1, FR4.2). Accept binding-style connection inputs (`{ url } | { uri, dbName } | { mongoClient, dbName }`) mirroring Postgres.
- [ ] Pin the type chain that resolves `db.orm.<collection>.where(...)` against an emitter-style Contract with a `.test-d.ts` regression test. Standardise on lowercased plural root accessors (e.g. `db.orm.users`) — the PascalCase names are not emitted.
- [ ] Document the replica-set requirement for transactions and change streams in `prisma-next.md` and the Mongo agent skill; defer the `db.transaction()` API and runtime end-to-end to [TML-2313](https://linear.app/prisma-company/issue/TML-2313/mongo-dev-replica-set-story-is-missing-transactions-change-streams).
- [ ] Rewrite `quick-reference-mongo.md` and `agent-skill-mongo.md` so the primary code samples use `db.orm.<collection>` lazily (no manual `connect()` step); remove `db.sql` references from the Mongo skill.
- [ ] Add E2E coverage: `tsc --noEmit` + a real `db.orm.users.where(...).first()` query against `mongodb-memory-server` (`MongoMemoryReplSet`).

### Milestone 4 — Project hygiene + scaffold typechecks (R5, R6)

Closes FR2 and FR3. Eliminates the "fresh init doesn't typecheck / is missing the files every other scaffolder writes" friction.

**Tasks (sketch):**

- [ ] Add `@types/node` to scaffolded devDeps and `"types": ["node"]` to the scaffolded `tsconfig.json` (FR2).
- [ ] Write `.env.example` per target with `DATABASE_URL` placeholder + minimum DB-version comment (FR3.1, FR8.2).
- [ ] Optional `.env` write under `--write-env` / interactive opt-in (FR3.2).
- [ ] Idempotent `.gitignore` updater (FR3.3).
- [ ] Idempotent `.gitattributes` updater mirroring the relevant subset of [`/.gitattributes`](../../.gitattributes) (FR3.4).
- [ ] Idempotent `package.json#scripts` updater with collision detection (FR3.5).
- [ ] E2E test: `tsc --noEmit` exits 0 in all four (target × authoring) cells.

### Milestone 5 — Templates × authoring (R3)

Closes FR5. Eliminates the "TS-authoring users get PSL docs" mismatch and the four-axis divergence between the Postgres TS and Mongo TS templates.

**Tasks (sketch):**

- [ ] Reconcile the Postgres and Mongo TS schema templates to a single shape (FR5.3).
- [ ] Parametrise `prisma-next.md` and `agent-skill-{postgres,mongo}.md` by `(target, authoring)`.
- [ ] Add snapshot tests covering all four cells (FR5.4); each scaffolded project typechecks against the published facade.
- [ ] **Carried from M4:** automated `tsc --noEmit` E2E in all four (target × authoring) cells (FR2.3). M4 ships the constituent pieces (FR2.1/FR2.2 — devDep + tsconfig); the four-cell composition piggy-backs on FR5.4's tarball-build-and-typecheck infrastructure.

### Milestone 6 — Hostile-input survival + atomic init (R7, R10)

Closes FR6 and the atomicity NFR (NFR3).

**Tasks (sketch):**

- [ ] Replace `JSON.parse(existing)` in `mergeTsConfig` with `jsonc-parser` (preserve comments / trailing commas).
- [ ] Reorder `runInit` so all preconditions and validations run before any file write.
- [ ] Add E2E coverage: `init` against an existing JSONC `tsconfig.json` succeeds; `init` mid-run failure leaves the project byte-identical to its pre-init state.

### Milestone 7 — DB target version compatibility (R11)

Closes FR8.

**Tasks (sketch):**

- [ ] Declare minimum supported server version in `@prisma-next/target-postgres` and `@prisma-next/target-mongo` (FR8.1).
- [ ] Surface the requirement in `.env.example` and `prisma-next.md` (FR8.2, FR8.4).
- [ ] Add the optional probe (FR8.3): `SELECT version()` for Postgres, `db.runCommand({buildInfo:1})` for Mongo, gated on `--probe-db` / interactive opt-in.
- [ ] Add a runtime-side check on first `db.connect` that emits a structured warning once if below minimum (FR8.5).

### Milestone 8 — Re-init cleanup (R9)

Closes FR9.

**Tasks (sketch):**

- [ ] On re-init, delete previously-emitted contract artefacts before rewriting templates (FR9.1).
- [ ] On target switch, remove the previous facade dep from `package.json` with confirm (FR9.2).
- [ ] Verify idempotency on `tsconfig.json`, `.gitignore`, `.gitattributes`, `package.json#scripts` (FR9.3).

## Decisions baked in

All 9 spec-phase open questions are resolved — see [`spec.md` § Decisions](./spec.md#decisions). Notable consequences for this plan:

- **M1** picks up the offline-friendly guarantee (NFR9): probe is opt-in, `--strict-probe` is a no-op without `--probe-db`, no network connection to the user's DB without explicit consent.
- **M3** (Mongo facade parity) explicitly **excludes** both dev-environment replica-set provisioning and the `db.transaction(...)` runtime API — both are owned by [TML-2313](https://linear.app/prisma-company/issue/TML-2313/mongo-dev-replica-set-story-is-missing-transactions-change-streams). M3 ships only the lazy facade, type chain, templates, and the replica-set documentation.
- **M4** writes `package.json#scripts.contract:emit` (not `prisma-next:emit`) and adds the forward-looking `.gitattributes` subset (including future `prisma/end-contract.*`, `prisma/ops.json`, `prisma/migration.json`).

## Close-out (required)

- [ ] Verify all acceptance criteria in [`spec.md`](./spec.md#acceptance-criteria).
- [ ] Migrate long-lived docs into `docs/` (notably: a `docs/architecture/` subsystem doc on the `init` command's contract, and any ADR worth keeping for the Mongo-facade type-chain fix).
- [ ] Strip repo-wide references to `projects/init-follow-up-improvements/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/init-follow-up-improvements/`.
