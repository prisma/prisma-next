# Prisma Next workflows catalog

The set of user workflows the Prisma Next agent skill cluster codifies. Built as a reference for devrel to write user-facing documentation against — every entry below is something a Prisma Next user should be able to do, and something the skill cluster teaches an agent to do on their behalf.

**Source of truth.** This catalog is derived from `projects/prisma-next-agent-skill/specs/usage-skill.spec.md` (FR12–FR19b) and reconciled against the shipped `packages/0-shared/agent-skill/skills/<skill>/SKILL.md` files. The spec is the planning document; the SKILL.md files are the agent-facing rendering of the same content; this catalog is the documentation-author-facing rendering.

**How to read each entry.** Bullets are user-level workflows (things a developer does) unless explicitly labelled *decision table* (the agent's reasoning step) or *reference material*. Each skill's *Capability gaps* block names features Prisma Next does not yet support and what the user does instead today; these gaps are the natural source of *"known limitations"* sections in user docs.

**Cluster map.** Ten skills:

- `prisma-next` — router (the agent's dispatch layer; no user workflows of its own).
- `prisma-next-quickstart` — adoption (greenfield + brownfield-DB).
- `prisma-next-contract` — contract authoring and editing.
- `prisma-next-migrations` — migration authoring (local-dev loop).
- `prisma-next-migration-review` — deployment + concurrency (the team-level workflow).
- `prisma-next-queries` — query authoring across all lanes.
- `prisma-next-runtime` — wiring `db.ts`.
- `prisma-next-build` — build-system / dev-server integration.
- `prisma-next-debug` — diagnosing failures.
- `prisma-next-feedback` — bug reports and feature requests.

---

## `prisma-next` — router

No user-facing workflows. Catches vague prompts like *"help me with Prisma Next"* and routes to the right specific skill. Not a candidate for standalone documentation; its content belongs in the cluster overview if you write one.

---

## `prisma-next-quickstart` — adoption

Two branching paths. A doc page per path is the natural fit.

### Path 1 — Greenfield

- `prisma-next init` → pick target → first model → first `contract emit` → `db init` → first query.

### Path 2 — Brownfield-DB

- `prisma-next contract infer` → review and clean up the inferred PSL → `contract emit` → `db sign` → wire `db.ts` → first query.

**Out of scope here.** Migrating from another ORM (Drizzle, Prisma 7, TypeORM, Sequelize, Kysely, raw drivers). These are separately-installable skills tracked as their own future projects.

### Capability gaps

Nothing skill-specific beyond Prisma Next's overall not-yet list (which surfaces in the relevant downstream skills).

---

## `prisma-next-contract` — contract authoring and editing

The largest skill in the cluster. Each bullet is a candidate doc section; the *decision table* bullets are the natural place for a "which authoring mode should I use?" guide.

### Workflows

- Add a model (PSL).
- Add a model (TS builder).
- Edit a field — rename (`@hint(was: "old_name")`), change type, add/remove attributes.
- Add a relation (1-1, 1-many, many-many) with explicit FK config.
- Add a unique constraint or index.
- Add an enum.
- Add a type alias (PSL `types { ... }` — extension-typed scalars like `pgvector.Vector(1536)`).
- Add a custom embeddable / value object (PSL `type X { ... }`).
- Add an inheritance hierarchy (`@@discriminator` / `@@base`).
- Install an extension (modify `extensions` in `prisma-next.config.ts`).
- Configure an extension on a field or model.
- Compose multiple extensions.
- *Decision table* — PSL vs TS builder vs no-emit TS-first.
- Use no-emit (Vite plugin / Next plugin auto-emit).
- Work in an aggregate-contract monorepo: pick the right contract space (see [ADR 212](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)).
- Run `contract emit` and verify.

### Capability gaps

- **Validations.** Use arktype/zod in app code.
- **Lifecycle callbacks.** Use middleware or app code.
- **Soft delete (`paranoid` / `deletedAt`).** Add a column and filter in queries.

---

## `prisma-next-migrations` — migration authoring (local dev)

The everyday migration loop. Two-mode (`db update` quick path vs `migration plan` + `apply`) is the headline doc decision.

### Workflows

- *Decision table* — `db update` quick path vs `migration plan` + `apply` migration path.
- `db update` (quick path).
- `migration plan --name <slug>`.
- `migration show [target]`.
- Fill in placeholder data-transforms in `migration.ts`.
- Re-emit after editing (`node migrations/<dir>/migration.ts`).
- Re-author a migration by hand.
- `migration apply` (local dev).
- `db schema` to inspect the DB.
- `db verify` to compare contract vs DB.
- `db sign` to re-sign after manual fix-up.
- Recover from a drifted database.
- Recover from a stuck or failed migration mid-apply.
- Resolve a destructive-operation prompt.
- Recover from `MIGRATION.HASH_MISMATCH`.

### Framework-rendered files

`migration.ts` files under `migrations/<scope>/<timestamp>/` are **rendered by the framework** (`prisma-next migration create`), not authored from a blank file. Users edit specific holes — chiefly replacing `placeholder(...)` sentinels with `dataTransform(...)` callbacks. Worth a doc callout — it's a recurring source of confusion.

### Capability gaps

- **Runtime-apply migrations from app startup.** Use the CLI from the deploy pipeline.
- **Seeds as a first-class concept.** Run setup queries from app code.

---

## `prisma-next-migration-review` — deployment and concurrency

The team-level workflow. Distinct audience from `prisma-next-migrations` (deployers / reviewers, not the developer authoring the migration). Natural fit for a *Deploying Prisma Next* doc section.

### Workflows

- Answer *"what's about to run on merge?"* for a given env ref: `migration status --ref <env>`, optionally `--db <env-url>`.
- Render the migration graph from the topic branch vs `main`.
- Detect that `main` advanced ahead of the topic branch.
- **Resolve a concurrent-migration conflict** — the canonical 5-step procedure:
  1. Rebase the topic branch onto the new `main`.
  2. Delete the topic branch's locally-planned migration directory.
  3. Re-run `migration plan --name <slug>`.
  4. Port any data-transform customizations from the original `migration.ts` into the new one.
  5. Re-emit.
  Same workflow whether the two branches converged on the same destination hash or diverged.
- `migration ref set / get / delete / list`.
- Run a migration against a ref instead of the latest contract hash.
- Decide what to do when CI reports the `from` hash doesn't match prod's marker.
- Verify in CI that the branch can advance the target environment without manual intervention.

### Capability gaps

No gaps documented at catalog-authoring time; entries will be added as gaps surface.

---

## `prisma-next-queries` — query authoring

The cross-lane skill. The *decision table* is the headline.

### Workflows

- *Decision table* — which query interface for this query? (SQL query builder / Raw SQL / ORM client / TypedSQL.)
- Write a SELECT using the SQL query builder.
- Write a SELECT using the ORM client.
- `.first()` / `.first({ id })` / `.all()` for single-row vs many-row.
- Filter with `.where(predicate)`.
- Project with `.select(...)`.
- Sort with `.orderBy(...)`.
- Limit / paginate with `.take(N)` and cursor-style pagination.
- Include relations (`.include('relation', builder => ...)`).
- Write INSERT / UPDATE / DELETE via the ORM client.
- Use capability-gated features (`returning()`, `includeMany`).
- Define and use custom ORM collections.
- Wrap operations in a transaction.
- Write a Raw SQL query with annotations.
- Use TypedSQL: author a `.sql` file with typed params and result types.
- Stream large result sets.

### Capability gaps

- **`EXPLAIN` integration.** Run via `db.sql.raw\`EXPLAIN ...\``.
- **Prepared statements as first-class.** Use the raw lane.
- **`db.batch()` for multi-statement batching.** Sequential calls only.
- **Automatic N+1 detection.** Capability-gated `includeMany` is the manual approach.

---

## `prisma-next-runtime` — wiring `db.ts`

Composition of the runtime client. Build-system integration is *out of scope* here — that's the `prisma-next-build` skill.

### Workflows

- Compose `postgres()` / `mongo()` with extensions + middleware.
- Add `createTelemetryMiddleware()`.
- Add `lints()` middleware.
- Add `budgets({ ... })` middleware.
- Add an extension-contributed middleware.
- Configure connection: `db.connection` in config vs `DATABASE_URL` env var vs `--db` flag.
- Per-environment config (dev vs prod).
- Switch targets (Postgres ↔ Mongo).

### Capability gaps

- **Multi-database routing / read replicas.** Configure separate `db.ts` instances per service.
- **Connection pooling tuning as first-class.** Pass driver options through.
- **Mongo runtime middleware / `mongoRaw` / `validateMongoContract`** — façade gap, see [TML-2526](https://linear.app/prisma-company/issue/TML-2526).

---

## `prisma-next-build` — build-system and dev-server integration

The Vite plugin is the only first-party integration today; everything else is a documented gap with a workaround.

### Workflows

- *Decision table* — do I need a build-system plugin at all? (Yes if you want no-emit dev: contract artifacts regenerate automatically on contract-source edits during `vite dev`. No if you're fine running `prisma-next contract emit` by hand or wiring a `prebuild` script.)
- Install [`@prisma-next/vite-plugin-contract-emit`](../../../packages/1-framework/3-tooling/vite-plugin-contract-emit/README.md) (Vite 7 or 8).
- Wire `prismaVitePlugin('prisma-next.config.ts')` into `vite.config.ts`.
- Configure the plugin: `debounceMs`, `logLevel` (`silent` / `info` / `debug`).
- Verify the dev loop: start the dev server, edit the contract source, observe contract artifacts re-emit (success log line) without a manual command.
- Recover when the plugin warns about config-only watching (the loader could not resolve `contract.source.inputs`).
- Read an error overlay produced by an emit failure (PSL syntax, missing namespace, conflicting extensions); chain to `prisma-next-debug` for resolution.
- Verify the published-pair invariant (`contract.d.ts` renamed before `contract.json`) is happening — the user does not need to do anything beyond letting the plugin run.
- Tear down: explicit `disposeEmitQueue(outputJsonPath)` is the plugin's responsibility and not user-surface; documented for users embedding their own Vite plugin.
- Diagnose dev-server / HMR interactions with React Router v7 Framework Mode (see [`examples/react-router-demo`](../../../examples/react-router-demo/)).

### Capability gaps

- **Next.js plugin.** No first-party plugin yet. Workaround: run `prisma-next contract emit` from a `prebuild` script in `package.json` and a manual command during development.
- **Vite < 7.** Plugin requires Vite 7 or 8 (peer-dependency range). Vite 6 not on the support matrix.
- **Other bundlers (Webpack, esbuild, Rollup, Turbopack).** Not first-party. Run `prisma-next contract emit` from the bundler's pre-build hook.
- **Build-time-only emission outside dev.** The plugin runs in `vite dev` and re-emits on file changes; it does not run during `vite build`. For CI / production builds, use the explicit `prisma-next contract emit` step.

---

## `prisma-next-debug` — diagnosing failures

Signal-routing skill. Each entry is a doc page candidate for a *"when X happens, what's going on?"* style troubleshooting guide.

### Symptom → cause routing

- *"My query won't typecheck"* — contract stale, capability missing, query-interface mismatch.
- *"My query throws at runtime"* — read the error envelope, look up the stable code.
- *"Capability X isn't available"* — what to enable, which extension to install.
- *"Migration won't apply"* — marker mismatch, precondition failed, runner refused.
- *"Emit fails"* — PSL syntax, missing namespace, conflicting extensions.
- *"Contract is out of sync with the DB"* — drift detection.
- *"`MIGRATION.HASH_MISMATCH`"* — `migration.ts` edited after emit.
- Read a planner-conflict failure — rename hints missing, destructive ops blocked.

### Error-code reference families

- `PN-CLI-4xxx` — CLI exit-code envelopes.
- `PN-MIG-2xxx` — migration runtime.
- `PN-RUN-3xxx` — runtime / driver errors.
- Contract emit / wiring validation failures (no number prefix today).

### Capability gaps

- **Studio / GUI database browser.** Use `prisma-next db schema` for CLI tree output.
- **Query logger middleware as first-class.** Add via custom middleware.

---

## `prisma-next-feedback` — bug reports and feature requests

Terminal skill in the capability-gap routing pattern. Every other skill's *What Prisma Next doesn't do yet* entry closes with *"file this via the `prisma-next-feedback` skill"*. Not a primary doc-section candidate — its content lives in the contributing guide.

### Workflows

- Decide bug report vs feature request.
- Collect a minimal, public-safe reproduction (redacted contract excerpt, failing command + full output with `-v`, Prisma Next version, Node version, OS, package manager).
- Render the report on the existing GitHub Issue Forms at <https://github.com/prisma/prisma-next/issues/new/choose>. If issue templates are not present, render the structured body the skill prescribes (*Summary / Steps to reproduce / Expected / Actual / Environment / Workaround*).
- For feature requests: name the unbuilt feature, the workaround, the desired API or behaviour, and link the source skill's capability-gap entry that triggered the request.
- For bug reports: produce a minimal repro the framework team can re-run locally — preferably a small change against [`examples/prisma-next-demo`](../../../examples/prisma-next-demo/).
- Confirm the rendered title and body with the user before submitting; submission via `gh` CLI when available, otherwise opening the prefilled new-issue URL.
- Optional: chain to `prisma-next-upgrade` if the bug is fixed by a newer Prisma Next release.

### Capability gaps

- **In-product feedback channel.** Prisma Next does not phone home and has no in-product *"send feedback"* command. The GitHub Issues page is the canonical surface. A CLI-side `prisma-next feedback` command would be a feature request.

---

## Cross-cutting context for documentation authors

A few patterns repeated across skills, worth knowing before writing any of the per-workflow pages:

- **Read `prisma-next.config.ts` first.** Every workflow whose answer depends on target, extensions, or contract source starts by reading `prisma-next.config.ts`. In a monorepo with multiple `prisma-next.config.ts` files (the aggregate-contract pattern from [`examples/multi-extension-monorepo/`](../../../examples/multi-extension-monorepo/)), pick the contract space the user is operating in and read the corresponding config.

- **Façade-only imports.** Every user-authored file imports from `@prisma-next/<target>/<subpath>` (target façade) or `@prisma-next/extension-<name>/<subpath>` (extension façade) or `@prisma-next/<bundler>-plugin-<purpose>` (build-tool plugin façade). The verbose `family` / `target` / `adapter` / `driver` composition is internal and not user-facing. The one current exception is framework-rendered `migration.ts`, whose imports the framework manages (tracked in [TML-2526](https://linear.app/prisma-company/issue/TML-2526)). When that lands, the rendered imports switch to `@prisma-next/postgres/migration` and the exception goes away.

- **`db update` vs `migration plan + apply`.** The most consequential everyday decision a Prisma Next user makes. Worth a top-level doc page; both `prisma-next-migrations` and `prisma-next-quickstart` route to it.

- **Capability gating.** Several features (`returning()`, `includeMany`, certain target-specific operations) are *capability-gated* — they exist as types but require a capability declaration in the contract or an extension to be usable at runtime. The error envelope tells the user which capability and how to enable it. The pattern repeats across queries / contract / runtime skills.

- **Error envelopes are structured.** Every runtime error carries a `code` (e.g. `MIGRATION.HASH_MISMATCH`, `PN-RUN-3xxx`), `why`, `fix`, and `severity` field. Documentation should preserve those fields verbatim where possible; the agent-facing skills key off the stable code, and user docs should help users do the same.

- **What PN doesn't do yet.** Each skill names its capability gaps with the workaround and a route to file a feature request. These are the most accurate source of *"known limitations"* for user docs — they're maintained in lockstep with the framework via the cluster's content-rotation policy.
