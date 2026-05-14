# Usage skill — design doc

## Status

**Shaping, near-complete.** This document captures the design decisions for the published usage skill described as task 3 in [`spec.md`](spec.md). Open questions are largely resolved after a competitive survey of Drizzle, Sequelize, TypeORM, Kysely, Active Record, and Convex (surveys in [`references/competitive-survey/`](references/competitive-survey/)). The remaining open question is the content-rotation policy; everything else is locked. When that's settled, the content moves to `specs/usage-skill.spec.md` in the project-spec shape and this file is deleted.

## What we're designing

A set of agent skills published as `@prisma-next/agent-skill` — one package, eight skills, each with its own `SKILL.md`. Installed via `npx skills add @prisma-next/agent-skill` (the canonical install) or automatically by `prisma-next init` (task 4 in the project spec).

The skills teach an LLM agent how to operate Prisma Next end-to-end, organised around the canonical mental model below.

## Decisions settled

### Canonical mental model

Every SKILL.md opens with this:

> **Edit your data contract. Prisma handles the rest.**
>
> Concretely:
>
> 1. You edit your data contract.
> 2. The system plans the migrations for you.
> 3. If you need data migrations, you edit `migration.ts` and execute it.

This is the agent's organising principle. Every workflow chains back to it. The headline one-liner ("Edit your data contract; Prisma handles the rest") leads every skill's preamble.

### Cluster shape — eight skills

Locked. One router + seven workflow skills.

| # | Skill | Scope |
|---|---|---|
| 1 | `prisma-next` | Router — catches vague prompts and routes to a specific skill. ~50 lines. |
| 2 | `prisma-next-quickstart` | Adoption: greenfield (new project) + brownfield-DB (existing DB, no ORM). Two branching paths in one skill. |
| 3 | `prisma-next-contract` | Contract authoring + editing: PSL, TS builder, no-emit, type aliases, embeddables, inheritance, extensions, contract spaces (aggregate-monorepo), `contract emit`. |
| 4 | `prisma-next-migrations` | Migration authoring: `migration plan`, fill placeholders, self-emit, `migration show`, `migration apply` (local dev), `db update` quick path, the decision tree between quick path and migration path, drift recovery. |
| 5 | `prisma-next-migration-review` | Deployment + concurrency: `migration status`, refs, "what runs on merge?", the rebase-replan-port-emit concurrency procedure, CI integration patterns. |
| 6 | `prisma-next-queries` | Query builders (DSL, raw SQL), ORM client + custom collections, the which-interface decision, capability-gated features, transactions, streaming. |
| 7 | `prisma-next-runtime` | `db.ts` wiring, middleware composition, extension setup, environment config, Vite/Next plugin. |
| 8 | `prisma-next-debug` | Signal-routing table + per-error-domain reference files (`PN-CLI-*`, `PN-MIG-*`, `PN-RUN-*`). |

Inventory scope per skill is in the [Cluster scope](#cluster-scope--per-skill-inventory) section below.

### Skill naming convention

All skills are brand-prefixed `prisma-next-<X>` so the matcher doesn't collide with skills from other ORMs installed alongside (Drizzle / Sequelize / Convex / etc., per the survey).

The names track [`docs/glossary.md`](../../docs/glossary.md) user-facing terminology — *contract* (not "schema"), *queries* (encompassing query builder + ORM client), *migrations* (plain English).

### One published package, multiple skill subdirectories

The [agentskills.io](https://agentskills.io/specification) format treats one *skill* as one directory containing one `SKILL.md`. A package is a container for multiple skill directories, each with its own `name` and `description`, each matched independently by the agent matcher. `npx skills add owner/repo` discovers every SKILL.md in the package and registers all of them.

Verified against:

- [`get-convex/agent-skills`](https://github.com/get-convex/agent-skills) — 6 skills in one package.
- [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) — 6 skills.
- [`supabase/agent-skills`](https://github.com/supabase/agent-skills) — 5 skills.

### Per-SKILL.md target: under 500 lines

The Agent Skills spec recommends each SKILL.md body fit in under 500 lines (~5000 tokens). Empirical reference: Convex's skills are 53–377 lines, with ~180 lines as the typical size. Our target: aim for 200–350 lines per skill body; spill depth into per-skill `references/*.md` files.

### Progressive disclosure is the loading model

The spec defines three tiers:

1. **Metadata** (`name` + `description`) — loaded at startup for every installed skill. Used by the matcher to decide which skills apply to a prompt.
2. **Instructions** (full SKILL.md body) — loaded only when the matcher activates the skill.
3. **Resources** (`scripts/`, `references/`, `assets/`) — loaded only when the SKILL.md body links to them during a workflow.

SKILL.md body stays short; per-skill `references/` holds the depth.

### SKILL.md skeleton — Convex template, adopted wholesale

Every skill follows the same structure, derived from [`get-convex/agent-skills`](https://github.com/get-convex/agent-skills) and validated against five competing skill packages (see [`references/competitive-survey/convex.md`](references/competitive-survey/convex.md) for the full analysis):

```
---
name: <prisma-next-X>
description: <see "Description-field convention" below>
---

# <Title Case Skill Name>

<one-paragraph preamble — what this skill covers, the canonical mental
model in one line>

## When to Use
<3–6 bullet triggers — prompts that should fire this skill>

## When Not to Use
<3–6 bullet anti-triggers — for X instead, use the `prisma-next-Y` skill>

## Key Concepts (or First Step / Guardrails)
<small number of mental models the agent needs before any workflow>

## Workflow
<numbered 5–10 step procedure for the canonical workflow this skill teaches>

## <Topic sections>
<decision tables, bad/good code pairs, Critical Rules, per-feature branches>

## Common Pitfalls
<numbered 4–8>

## What Prisma Next doesn't do yet
<see "Capability-gap honesty" below>

## Reference Files
<bulleted list of references/*.md with one-line descriptions>

## Checklist
<10–15 verifiable items the agent self-grades against>
```

The "When Not to Use" section is load-bearing: it routes the agent to the right adjacent skill when the prompt matches the wrong one. The "Checklist" is how the agent self-grades and how reviewers grade the agent. Both are non-optional.

### Description-field convention

Every `description` follows the same shape:

> *\<Action verb\> \<noun phrase\> with \<key concepts\>. Use for \<comma-separated trigger phrases including the exact error names, CLI flags, and foreign-ORM vocabulary the user would type\>.*

The "Use for ..." tail is a lexical match list for the agent matcher. Include trigger keywords from competing ORMs explicitly — e.g. the contract skill description should fire on *validations*, *callbacks*, *scopes* even though PN's answer is "we don't do that yet, here's the workaround" (see "Capability-gap honesty" below). Otherwise the matcher will never fire on those prompts and the user will get no skill at all.

Length: 25–35 words. Examples in the Convex survey.

### Capability-gap honesty — "What Prisma Next doesn't do yet"

PN is early access. Many features users expect from established ORMs aren't built yet. The skill must be honest about this rather than confabulate API surfaces that don't exist.

Every relevant skill has a **What Prisma Next doesn't do yet** section listing the gaps in that skill's domain. Format per entry:

> - **\<Feature\>**: Prisma Next doesn't do \<X\> for you. \<User-side workaround\>. If you need this built-in, file a feature request: \<URL\>.

Concrete examples by skill are listed inline in the [Cluster scope](#cluster-scope--per-skill-inventory) section below.

When the gap list gets long enough to bulk up the SKILL.md body, spill it into `references/not-yet-supported.md` and link from the section.

The pattern double-serves: it's honest about scope, and it gives the agent something concrete to say when asked about features that don't exist. Without it, the agent's likely failure mode is to confabulate.

### Bad/good code pairs as the dominant teaching device

Convex's skills use `// Bad:` / `// Good:` code-block pairs more than any other structural element. Per the Convex survey:

> *"This is denser and more agent-actionable than prose explanation."*

Every workflow step that has a wrong/right contrast (and most do) gets a bad/good pair instead of prose explanation. Prose is for the *why*; code pairs are for the *what*.

### Glossary is source of truth for terminology

[`docs/glossary.md`](../../docs/glossary.md) is the canonical user-facing vocabulary. Skill prose uses glossary terms — *contract*, *extension*, *query builder*, *middleware*, *marker*, *capability*. Internal package names (`extensionPacks:` in `prisma-next.config.ts` code samples, `lane` in package paths) stay as-is in code; prose uses the user-facing term.

The terminology alignment tracker at the bottom of the glossary shows where internal naming hasn't caught up yet:

- `extensions` (prose) vs `extensionPacks` (config field, pending refactor)
- `query builder` (prose) vs `lane` (package names, pending refactor)
- `middleware` (already aligned)

Skill descriptions also include foreign-ORM trigger keywords (validations, callbacks, scopes, push, generate, introspect, Studio, entities, DataSource, etc.) so prompts from cross-ORM users still fire on the right skill.

We do **not** ship per-source-ORM translation reference files. The glossary handles cross-ORM vocabulary translation; we extend it as we discover gaps.

### Single skill across targets and monorepo shapes

Target-keyed content (Postgres vs Mongo) and contract-space-keyed content (single-contract vs aggregate-contract monorepo) lives inside skill bodies as branching steps, not split into separate skills per target. The CLI handles target-keyed scaffolding at `init` time; skills handle target-keyed behavior from then on.

Rationale: the user mental model is "I'm using Prisma Next", not "I'm using Prisma Next Postgres."

### No bootstrap skill, but a router skill

`prisma-next init` is the user's first contact with PN — it does the scaffolding *and* installs the skills. There's no agent-activation moment between `init`-completing and the first prompt for a bootstrap skill to occupy.

However: once 7+ workflow skills are installed, the matcher will mis-fire on vague prompts like *"help me with Prisma Next"* — Convex hit this problem and shipped a 53-line `convex` router skill purely to catch these and re-fire on the right specific skill. Same pattern for PN: the `prisma-next` router skill exists *only* to disambiguate vague prompts.

Router and bootstrap are different jobs. Router is in; bootstrap is not.

### Source location

Published from a single workspace package at `packages/0-shared/agent-skill/`:

```text
packages/0-shared/agent-skill/
├── package.json            # @prisma-next/agent-skill
├── README.md               # user-facing index of skills in the package
└── skills/
    ├── prisma-next/                   # router
    │   └── SKILL.md
    ├── prisma-next-quickstart/
    │   ├── SKILL.md
    │   └── references/
    ├── prisma-next-contract/
    │   ├── SKILL.md
    │   ├── workflows/
    │   └── references/
    └── ...
```

Tier choice (`0-shared/`) aligned with the upgrade-skill packages from [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md).

### Authoring strategy — dogfood + skill-creator loop

The existing hand-rolled template at [`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`](../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md) is a usable starting seed for `prisma-next-contract` + `prisma-next-queries`. Plan:

1. Decompose the template's content across the new skill set's workflow + reference structure.
2. Author each skill in the SKILL.md skeleton above.
3. Validate via dogfood: install the in-progress skill set locally, point an agent at one of the example apps under [`examples/`](../../examples/), give it real user-shaped tasks, observe where the agent fumbles, refine.
4. Use Anthropic's `skill-creator` tool (recommended by Convex's contributing notes) for the rigorous validation loop.
5. Iterate until the skill set produces the journey-test outcomes from `spec.md`'s acceptance criteria.

Validation is dogfood, not unit tests. The agent's behavior is the bar.

## Open questions

1. **Content-rotation policy.** As PN evolves, skill content goes stale. Whether rotation is a CODEOWNERS expectation, a PR-template item, or a separate authoring quality gate is deferred. The upgrade-skill mechanism handles user-side recipe rotation but not the usage skill's body.

## Follow-ups raised during shaping

- ~~Stale Kysely references in the architecture docs.~~ **Resolved** in commit `5908394` ("docs: strip stale Kysely lane references").
- **Product question.** Where do validations, callbacks, scopes, and similar ORM-shaped concerns eventually live in PN? Captured as "What PN doesn't do yet" entries in the relevant skills today; revisit when the product roadmap addresses them.

## Cluster scope — per-skill inventory

Locked inventory per skill. Each bullet is one workflow file (or one decision-tree section, where decisions become first-class content). Capability gaps go under "What PN doesn't do yet" inside the relevant skill.

### `prisma-next` — Router

~50 lines, no `references/`. Catches underspecified prompts and routes to the right specific skill. Lists sibling skills with one-line trigger conditions each.

### `prisma-next-quickstart` — Adoption

The user has no PN contract on disk yet. Get them to the state where the other skills apply.

Workflows (two branching paths in one SKILL.md):

- **Path 1 — Greenfield**: `prisma-next init` → pick target → first model → first `contract emit` → `db init` → first query.
- **Path 2 — Brownfield-DB**: `prisma-next contract infer` → review and clean up the inferred PSL → `contract emit` → `db sign` → wire `db.ts` → first query.

### `prisma-next-contract` — Contract authoring + editing

Workflows:

- Add a model (PSL).
- Add a model (TS builder).
- Edit a field — rename (`@hint(was: "old_name")`), change type, add/remove attributes.
- Add a relation (1-1, 1-many, many-many) with explicit FK config.
- Add a unique constraint or index.
- Add an enum.
- Add a type alias (PSL `types { ... }` — extension-typed scalars like `pgvector.Vector(1536)`).
- Add a custom embeddable / value object (PSL `type X { ... }`).
- Add an inheritance hierarchy (`@@discriminator` / `@@base`).
- Install an extension (modify `extensionPacks` in `prisma-next.config.ts`).
- Configure an extension on a field or model.
- Compose multiple extensions.
- **Decision**: PSL vs TS builder vs no-emit TS-first — comparison table + per-row downstream pointer.
- Use no-emit (Vite plugin / Next plugin auto-emit).
- Work in an aggregate-contract monorepo: pick the right contract space ([ADR 212](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)).
- Run `contract emit` and verify the result.

**What PN doesn't do yet:**

- *Validations* — use arktype/zod in app code.
- *Soft delete / `paranoid`* — add a `deletedAt` column, filter in queries.
- *Callbacks / lifecycle hooks* (`beforeSave`, `afterCreate`) — use middleware for cross-cutting concerns, app code otherwise.

### `prisma-next-migrations` — Migration authoring

Workflows:

- **Decision**: `db update` quick path vs `migration plan` + `apply` migration path — when to use each.
- Update DB to match contract via quick path: `db update`.
- Plan a migration: `migration plan --name <slug>`.
- Inspect a planned migration: `migration show [target]`.
- Fill in placeholder data-transforms in `migration.ts`.
- Re-emit after editing: `node migrations/<dir>/migration.ts`.
- Re-author a migration by hand.
- Apply pending migrations locally: `migration apply`.
- Inspect what's actually in the DB: `db schema`.
- Verify DB matches contract: `db verify`.
- Re-sign a DB after manual fix-up: `db sign`.
- Recover from a drifted database.
- Recover from a stuck or failed migration mid-apply.
- Resolve a destructive-operation prompt (interactive `db update` or `migration apply`).
- Recover from `MIGRATION.HASH_MISMATCH` (migration.ts edited after emit).

**What PN doesn't do yet:**

- *Runtime-apply migrations* (apply from app startup code) — use the CLI from your deploy pipeline.
- *Seeds-as-first-class* — run setup queries from app code in dev/test for now.

### `prisma-next-migration-review` — Deployment + concurrency

The "what's about to run when I merge this PR?" skill. Includes the unique-to-PN concurrent-migration resolution flow.

Workflows:

- Answer "what's about to run on merge?" for a given environment ref: `migration status --ref <env>`, optionally `--db <env-url>`.
- Render the migration graph from the topic branch to compare against `main`.
- Detect that `main` advanced ahead of the topic branch (new migrations landed concurrently).
- Resolve a concurrent-migration conflict — the canonical 5-step rebase-replan-port-emit procedure (schema first, then re-apply data customizations):

  1. Rebase the topic branch onto the new `main`.
  2. Delete the topic branch's locally-planned migration directory.
  3. Re-run `migration plan --name <slug>`.
  4. Port any data-transform customizations from the original `migration.ts` into the new one.
  5. Re-emit: `node migrations/<dir>/migration.ts`.

  Same workflow whether the two branches converged on the same destination hash or diverged to different ones.

- Set / get / delete / list named refs: `migration ref set/get/delete/list`.
- Run a migration against a ref instead of the latest contract hash: `--ref staging`.
- Decide what to do when CI reports `from` hash doesn't match prod's marker (rebase, replan, or pin via `--ref`).
- Verify in CI that the branch can advance the target environment without manual intervention.

### `prisma-next-queries` — Query authoring

Workflows:

- **Decision**: which query interface for this query? Comparison table for SQL query builder (DSL) / Raw SQL / ORM client / TypedSQL.
- Write a SELECT using the SQL query builder.
- Write a SELECT using the ORM client.
- Use `.first()` / `.first({ id })` / `.all()` for single-row vs many-row reads.
- Filter with `.where(predicate)`.
- Project with `.select(...)`.
- Sort with `.orderBy(...)`.
- Limit / paginate with `.take(N)` and cursor-style pagination.
- Include relations (`.include('relation', builder => ...)`).
- Write INSERT / UPDATE / DELETE via the ORM client.
- Use capability-gated features (`returning()`, `includeMany`).
- Define and use custom ORM collections.
- Wrap operations in a transaction.
- Write a Raw SQL query with annotations (`db.sql.raw\`...\``).
- Use TypedSQL: author a `.sql` file with typed params and result types.
- Stream large result sets.

**What PN doesn't do yet:**

- *`EXPLAIN` integration* — run via `db.sql.raw\`EXPLAIN ...\`` for now.
- *Prepared statements* — use the raw lane.
- *`db.batch()` for multi-statement batching* — sequential calls only.
- *Automatic N+1 detection* — capability-gated `includeMany` is the manual approach; automatic detection isn't built.

### `prisma-next-runtime` — Wiring `db.ts`

Workflows:

- Compose `postgres()` / `mongo()` with extensions + middleware.
- Add `createTelemetryMiddleware()`.
- Add `lints()` middleware.
- Add `budgets({ maxRows, defaultTableRows, tableRows, maxLatencyMs })`.
- Add an extension-contributed middleware (cipherstash bulk-encrypt, etc.).
- Configure connection: `db.connection` in config vs `DATABASE_URL` env var vs `--db` flag.
- Per-environment config (dev vs prod connection strings).
- Switch targets (Postgres ↔ Mongo).
- Use the Vite plugin for no-emit dev flow.
- Use the Next plugin equivalent.

**What PN doesn't do yet:**

- *Multi-database routing / read replicas* — configure separate `db.ts` instances per service; the framework doesn't route automatically.
- *Connection pooling tuning as first-class* — pass driver options through; the framework doesn't expose a pooling layer.

### `prisma-next-debug` — When things break

Workflows (signal-routing table format — symptom → reference file):

- "My query won't typecheck" — contract stale, capability missing, lane mismatch.
- "My query throws at runtime" — read the error envelope, look up the stable code.
- "Capability X isn't available" — what to enable / which extension to install.
- "Migration won't apply" — marker mismatch, precondition failed, runner refused.
- "Emit fails" — PSL syntax, missing namespace, conflicting extensions.
- "Contract is out of sync with the DB" — drift detection.
- "`MIGRATION.HASH_MISMATCH`" — `migration.ts` edited after emit.
- Read a planner-conflict failure — rename hints missing, destructive ops blocked.

Per-error-domain reference files in `references/`:

- `references/cli-errors.md` — `PN-CLI-4xxx`.
- `references/migration-errors.md` — `PN-MIG-2xxx`.
- `references/runtime-errors.md` — `PN-RUN-3xxx`.
- `references/contract-errors.md` — contract emit / wiring validation failures.

**What PN doesn't do yet:**

- *Studio / GUI database browser* — use `prisma-next db schema` for CLI tree output.
- *Query logger middleware as first-class* — add via custom middleware for now.

## Things explicitly out-of-scope for the usage skill

- The upgrade flow (covered by `@prisma-next/upgrade-skill`).
- Extension authoring (covered by `@prisma-next/extension-upgrade-skill` and extension-author docs in the repo).
- **Migrate-from-X flows** (Prisma 6/7, Drizzle, Kysely, TypeORM, Sequelize, Knex, raw drivers). Candidate for separately-installable per-source skills (e.g. `@prisma-next/migrate-from-drizzle-skill`) installed only by users actually doing that migration.
- **Features not yet built** (validations, callbacks, lifecycle hooks, soft delete, Studio, runtime-apply migrations, `EXPLAIN` integration, prepared statements, `db.batch()`, multi-database routing, seeds-as-first-class). These get one-paragraph "What PN doesn't do yet" entries in the relevant skill, *not* fabricated workflows.
- Internal PN architecture (not a user-facing concern; surfaced only when load-bearing for a workflow).
- Setting up Postgres / Mongo on a partner platform (covered by partner-specific extensions when they exist).
- PPg-specific features (preflight, ledger features beyond the marker) — likely a separate downstream skill when PPg ships.

## Next steps

1. Resolve the content-rotation policy (the last open question).
2. Convert this design doc into `specs/usage-skill.spec.md` in the project-spec shape.
3. Hand the spec off for implementation alongside the upgrade-skill mechanism work.
