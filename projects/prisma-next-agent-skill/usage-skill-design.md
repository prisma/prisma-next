# Usage skill — design doc

## Status

**Shaping.** This document captures design decisions and context for the published usage skill described as task 3 in [`spec.md`](spec.md). It is not a spec yet — when the open questions below are settled, this content moves to `specs/usage-skill.spec.md` in the project-spec shape and this file is deleted.

## What we're designing

A published agent skill (or, more accurately, a *set of skill subdirectories under one published package*) that teaches an agent how to operate Prisma Next end-to-end. The published artefact name is provisionally `@prisma-next/agent-skill`. Installed via `npx skills add @prisma-next/agent-skill` or automatically by `prisma-next init` (task 4).

## Decisions settled

### One published package, multiple skill subdirectories

The [agentskills.io](https://agentskills.io/specification) format treats one *skill* as one directory containing one `SKILL.md`. A *repo* (or a published npm package) is a container for *multiple* skill directories, each with its own `name` and `description`, each matched independently by the agent matcher. `npx skills add owner/repo` discovers every SKILL.md in the package and registers all of them.

This is the standard pattern. Verified against:

- [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) — 6 skills in one package, one install command.
- [`supabase/agent-skills`](https://github.com/supabase/agent-skills) — ~5 skills, same shape, with optional per-skill install via `--skill <name>`.

Implication: the number of skills under `@prisma-next/agent-skill` is a content-design choice, not a packaging constraint.

### Per-SKILL.md target: under 500 lines

The Agent Skills spec recommends each SKILL.md body fit in under 500 lines (≈5000 tokens). This is what bounds skill granularity: a skill whose topic doesn't fit in 500 lines should be split. The constraint cuts the other way too — a skill whose body is comfortably small leaves room for headroom; we don't need to split prematurely.

### Progressive disclosure is the loading model

The spec defines three tiers; we design to it:

1. **Metadata** (`name` + `description`) — loaded at startup for *every* installed skill. Used by the matcher to decide which skills apply to a prompt.
2. **Instructions** (full SKILL.md body) — loaded only when the matcher activates the skill.
3. **Resources** (`scripts/`, `references/`, `assets/`) — loaded only when the SKILL.md body links to them during a workflow.

This is the loading shape our SKILL.md design assumes: short body, deep reference material that gets pulled in on demand.

### Description-field tuning is workflow-oriented

Each skill's `description` field is the text the agent matcher fires on. It should read like a user prompt, not like a feature list. Keyword density matters; PN-internal vocabulary doesn't (except where users will see the term anyway — `contract.d.ts`, `prisma-next.config.ts`).

Pattern:

> *Use this when the user wants to \<verb> \<noun> \<context>. Triggers on \<keywords/phrases users actually type>.*

### SKILL.md structure: orientation → workflows → reference index

Every skill's SKILL.md follows the same shape:

1. **Preamble** (1–2 short paragraphs) — what this skill covers; what to invoke instead for adjacent work.
2. **Orient yourself** — files the agent must read before any workflow (`prisma-next.config.ts`, the contract source, etc.). One block, deduplicated across all workflows in the skill.
3. **Workflows table** — `If user asks ... | Follow workflow file`. The agent picks the right workflow row from the user's prompt; the workflow file is a step-by-step procedure.
4. **Reference index** — concept-shaped files the agent loads on demand or when a workflow links to one.

Workflows are *procedural* (step 1, step 2, "if X then Y, here's the command, here's how to validate"). Reference material is *conceptual* (what is a contract, what's a capability, what's the migration ledger). Workflows link to reference; reference does not embed procedure.

### Single skill across targets and monorepo shapes

Target-keyed content (Postgres vs Mongo) and contract-space-keyed content (single-contract vs aggregate-contract monorepo) lives *inside* skill bodies as branching steps, not split into separate skills per target. The CLI handles target-keyed scaffolding at `init` time; the skill handles target-keyed runtime behavior from then on.

Rationale: the user mental model is "I'm using Prisma Next" not "I'm using Prisma Next Postgres." Skills should follow that model.

### No bootstrap skill

The earlier shape proposed a small `bootstrap` skill that orchestrates first-project setup. Dropped because `prisma-next init` is the user's first contact with PN — `init` does the scaffolding *and* installs the skills. The user's first prompt after `init` ("add a Profile model", "let me list users") fires the matching workflow-shaped skill directly. There's no agent-activation moment between `init`-completing and the first real prompt for a bootstrap skill to occupy.

If onboarding ever needs more orchestration than `init` provides, the relevant content lives inside the workflow that fires (e.g., the schema-editing skill's first workflow can include a "if this is a fresh project, first do X" branch).

### Source location

Published from a single workspace package at `packages/0-shared/agent-skill/`. The directory layout under it matches what `npx skills add` expects:

```text
packages/0-shared/agent-skill/
├── package.json            # @prisma-next/agent-skill
├── README.md               # user-facing index of skills in the package
└── skills/
    ├── <skill-1>/
    │   ├── SKILL.md
    │   ├── workflows/
    │   │   ├── <wf-1>.md
    │   │   └── ...
    │   └── references/
    │       ├── <ref-1>.md
    │       └── ...
    ├── <skill-2>/
    │   └── ...
    └── ...
```

Tier choice (`0-shared/`) aligned with the upgrade-skill packages from [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md); same architectural-config wiring applies.

### Authoring strategy — dogfood + seed-from-template

The existing hand-rolled template at [`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`](../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md) is a usable starting seed. Plan:

1. Decompose the template's content across the new skill set's workflow + reference structure.
2. Write each skill's SKILL.md + workflow files + reference material.
3. Dogfood: install the in-progress skill set locally, point an agent at one of the example apps under [`examples/`](../../examples/), give it real user-shaped tasks, observe where the agent fumbles, refine.
4. Iterate until the skill set produces the journey-test outcomes from `spec.md`'s AC4 + AC5.

Validation is dogfood, not unit tests. The agent's behavior is the bar.

## Open questions

These are the substantive shape questions that this design doc *doesn't* answer. They get resolved when we map the workflow inventory below, because the inventory determines what fits in 500 lines per skill and what doesn't.

1. **How many skills?** Lower bound is 1 (everything in one skill); upper bound is ~10 before the matcher landscape gets confused. The right number depends on which workflows naturally cluster — see the inventory.
2. **Skill names.** Likely workflow-shaped — `schema`, `migrations`, `queries`, `runtime` — but defer until the cluster shape is settled.
3. **Description tuning.** Each skill's description text is its firing surface; needs per-skill drafting after the cluster shape is settled.
4. **Content-rotation policy.** As PN evolves, skill content goes stale. Whether rotation is a CODEOWNERS expectation, a PR-template item, or a separate authoring quality gate is deferred. The upgrade-skill mechanism handles user-side recipe rotation but not the usage skill's body.

## Workflow + topic inventory (work-in-progress)

This is the input to the skill-split decision: enumerate every distinct topic the usage skill needs to cover, group them, then pick a split.

Two flavors of content per the SKILL.md structure decision: **workflows** (procedural — *user wants to do X, do Y*) and **reference** (conceptual — *what is X*).

### Workflows (procedural)

Bulleted, grouped by rough topic. Each is one workflow file; each is one row in some skill's workflows table.

**Modeling — schema-shaped work**

- Add a model (PSL)
- Add a model (TS builder)
- Edit a field on an existing model (rename, change type, add/remove attribute)
- Add a relation (1-1, 1-many, many-many)
- Add a unique constraint or index
- Add an enum
- Install an extension pack (e.g. cipherstash, supabase)
- Configure an extension pack on a field or model
- Compose multiple extension packs
- Author a contract entirely in TS (when PSL doesn't fit — e.g., dynamic / generated schemas)
- Work in an aggregate-contract monorepo: pick the right contract space for a change

**Migrations — projection-shaped work**

- Generate a migration after a schema change
- Apply migrations to dev DB
- Apply migrations to production (deployment workflow)
- Reset / replay against a fresh DB
- Handle a stuck migration (failure mid-apply)
- Author a hand-written migration step (when the generator can't express what's needed)
- Inspect migration state on disk vs in DB
- Resolve a contract-vs-DB mismatch

**Queries — execution-shaped work**

- Write a SELECT (DSL)
- Write a SELECT with JOINs and projection (DSL)
- Write a SELECT with relations included (ORM)
- Write an INSERT / UPDATE / DELETE
- Use `returning()` (capability-gated)
- Use `includeMany` (capability-gated)
- Decide between DSL, ORM, TypedSQL, raw — picking a lane
- Parameterise a TypedSQL query
- Drop to raw SQL when needed
- Wrap operations in a transaction
- Read query results (use the inferred types)
- Stream / paginate large result sets

**Runtime config — wiring-shaped work**

- Set up `prisma-next.config.ts` for a new project (target, extension packs, paths)
- Switch targets (Postgres ↔ Mongo)
- Configure connection strings per environment
- Install / configure runtime middleware
- Enable a capability that's currently gated off
- Configure target-specific runtime options (e.g. postgres pool size)

**Debugging — when things break**

- "My query won't typecheck" (contract is stale, capability not enabled, lane mismatch)
- "My query throws at runtime" (read the error envelope, find the error code)
- "Capability X isn't available" (figure out what to enable in `prisma-next.config.ts`)
- "Migration won't apply" (read the failure, look at marker tables, decide on recovery)
- "Emit fails" (PSL syntax, missing namespace, conflicting extension packs)
- "Contract is out of sync with the DB"

### Reference (conceptual)

Each is one reference file; loaded by workflows on demand.

- What is a contract? `contract.json` and `contract.d.ts` structure
- What is `prisma-next.config.ts`? Full surface (target, extension packs, paths, runtime middleware)
- PSL vs TS — when each is appropriate, capabilities each one expresses
- Extension packs — what they are, how they compose
- Migration anatomy — `migration.json`, `ops.json`, the manifest, the ledger
- Capabilities — what capability-gating is, how to read a capability error, how to enable
- Aggregate contracts / monorepo — multiple contract spaces, the aggregate root, which space owns what
- Error envelope — shape, stable codes, structured remediation hints
- The four query lanes — why each exists, when each is appropriate
- Hashes — `storageHash`, `profileHash`, `migrationHash`; what they guarantee
- Targets — Postgres-specific behavior, Mongo-specific behavior (or a per-target file each)

### Things explicitly out-of-scope for the usage skill

- The upgrade flow (covered by `@prisma-next/upgrade-skill`).
- Extension authoring (covered by `@prisma-next/extension-upgrade-skill`'s author-side content and extension-author docs in the repo).
- Internal PN architecture (not a user-facing concern; only surfaced when load-bearing for a workflow).
- Setting up Postgres / Mongo on a partner platform (covered by partner-specific extensions when they exist).

## Next steps

1. Iterate the inventory above with the user — add anything missing, drop anything misframed.
2. Cluster the workflows into skills, respecting the 500-line per-SKILL.md limit. Settle skill count and names.
3. Draft each skill's `description` field.
4. Settle the open content-rotation policy.
5. Convert this design doc into `specs/usage-skill.spec.md` in the project-spec shape (problem / approach / FRs / NFRs / ACs).
6. Hand the spec off for implementation alongside the upgrade-skill mechanism work.
