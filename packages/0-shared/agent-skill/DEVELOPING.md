# Developing `@prisma-next/agent-skill`

Contributor guide for the agent-skill cluster. If you are *using* the skills, read [`README.md`](./README.md) and stop here. If you are *authoring or maintaining* a skill in this package, read this file first.

## What this cluster is

A small set of `SKILL.md` files that teach an LLM agent how to operate Prisma Next end-to-end. Each skill is workflow-scoped (one user goal per skill), runtime-matched by its `description:` frontmatter, and lives at `skills/<skill-name>/SKILL.md`. The router skill (`prisma-next`) catches vague prompts and points at the right specific skill.

## Authoring rules

These rules are load-bearing for the cluster. A new skill or a skill rewrite that doesn't honour them is a defect, not a style preference. Where this list differs from the general Prisma Next contributor guide, this list takes precedence *for files under `skills/`*.

### Teach concepts, not procedures

**The principle: teach the system's mental model and show the queries that reveal each piece of state. Reserve rigid step-by-step procedures for the rare case where there's literally one safe path and any deviation is costly.**

Procedural workflow sections — *"step 1: run X; step 2: read Y; step 3: if Z, do W"* — teach the agent to follow a memorised script. When the situation drifts from what the script's author anticipated, the agent escalates or confabulates. Concept-based sections — *"the concept is X; ask the system about it with `command --flag`"* — teach the agent to *compose* the right action from the model. Concept-based sections cover more ground in fewer words and degrade gracefully on situations the author didn't anticipate.

**Symptoms a workflow section is wearing concept's clothes but is actually procedural:**

- More than three numbered steps.
- The section names two states whose names don't appear in the skill's *Key Concepts*.
- The section can't be rewritten as *"the concept is X; ask the system about it with `command --flag`."*

**The carve-out.** Some operations are genuinely one-safe-path (data-loss-risk migrations, irreversible operations, security-critical sequences where the agent must not improvise). Those workflow sections may be procedural — explicitly say *"this is the one-safe-path case"* in the section header so future maintainers don't strip the steps thinking they're cargo-culted.

#### Worked example — `prisma-next-migration-review`

The pilot rewrite of [`skills/prisma-next-migration-review/SKILL.md`](./skills/prisma-next-migration-review/SKILL.md) is the canonical worked example for this principle in this cluster. Before that rewrite, the skill contained:

- A five-step *"diamond convergence procedure"* for resolving concurrent migrations.
- A four-step *"detect that main advanced"* workflow.
- Procedural recipes for setting up refs, applying refs, and checking ref status.
- Factually wrong tool surface (it referenced `migrations/refs.json`, `ref set --env`, etc. — APIs that don't exist).

After the rewrite, the same ground is covered by one *Key Concepts* block that names the moving parts (**origin** = live DB marker, **destination** = ref or contract head, **migration graph** = path between them) and three short workflow sections that say *"the navigation is X → Y; ask the system about it with `migration status --ref <name> --db $URL`."* Diamond convergence collapsed from five steps to one paragraph: *"it's the normal `edit → plan → apply` loop applied to the post-merge state; port any data-transform logic from the abandoned `migration.ts` over."* The skill is 175 lines instead of 266, and an agent reading it can resolve situations the original five-step procedure didn't anticipate.

Read the diff if you want a before/after; read the rewrite itself if you want the template for new workflow sections.

### Other authoring rules

These are well-trodden but worth listing in one place:

- **`description:` frontmatter is a runtime matcher, not marketing prose.** Include the exact phrases — CLI flags, error codes, feature names, foreign-tool vocabulary — a user would type for this workflow.
- **One workflow per skill.** Cluster size is bounded by the per-skill line ceiling. If a workflow grows past it, split — don't sprawl.
- **`What Prisma Next doesn't do yet` is mandatory.** It names a concrete gap, describes today's workaround, and routes to `prisma-next-feedback`. Never confabulate an API that doesn't exist.
- **No cross-cluster references that drift.** When a skill links to a sibling skill, link by skill name, not by line range.
- **Skill content ships in lockstep with the framework.** Stale skill content is worse than no skill. When a PR touches framework surface a skill references, the skill update is part of the PR scope, not follow-up work.
- **Verify the tool surface before you author the workflow.** Read the actual CLI / API source for the commands the workflow uses. The migration-review pilot caught four factually-wrong tool references — they had been in the file from day one because nobody re-checked against the actual implementation. Authoring against an imagined surface is the most common defect on a first draft.

## Authoring workflow

1. Read [`README.md`](./README.md) for the user-facing scope of the cluster.
2. Read the [`skill-specialist` persona](https://github.com/prisma/ignite/blob/main/skills/.curated/drive-agent-personas/personas/skill-specialist.md) in the Ignite persona library — it's the canonical lens for skill-cluster work.
3. Read [`skills/prisma-next-migration-review/SKILL.md`](./skills/prisma-next-migration-review/SKILL.md) for the cluster's worked example of concepts-over-procedures.
4. Draft `SKILL.md` with:
   - `description:` frontmatter as a matcher (CLI flags, error codes, feature names).
   - Preamble + canonical mental-model headline.
   - *When to Use* / *When Not to Use*.
   - *Key Concepts* — name the moving parts.
   - *Workflow* — for each workflow, *concept block + the query that reveals state*.
   - *Common Pitfalls*.
   - *What Prisma Next doesn't do yet* — concrete gap + workaround + route to `prisma-next-feedback`.
   - *Reference Files* (when applicable; the migration-review skill omits this and points at `--help` instead).
   - *Checklist*.
5. Re-read your workflow sections against the symptoms above. Procedural? Rewrite as concept + query.
6. Verify every command, flag, file path, and config key against the actual implementation in the framework packages. Authoring against an imagined surface is the most common first-draft defect.

## Journey tests

[`journey-tests/`](./journey-tests/) contains Markdown checklists for the workflows the cluster supports. Each checklist names the prompt, the example app, and the expected end-state. Tests are run by hand against an example app and a configured agent runtime; cross-runtime automation is deferred.

When you add or rewrite a skill workflow, add or update a journey test that exercises it end-to-end.

## Project specs

While the cluster is in active development, the canonical spec and plan live under [`projects/prisma-next-agent-skill/`](../../../projects/prisma-next-agent-skill) in this monorepo. After the project closes, those artifacts migrate into `docs/` and the `projects/` directory is deleted. After that point, this `DEVELOPING.md` is the durable contributor home.

## Where to surface defects

- **Skill content drift / staleness** — fix in-PR or open a follow-up under this project / Linear ticket. Don't merge a framework-surface change without the skill update.
- **Skill cluster scope or shape issues** — surface to `tech-lead` (orchestration) or the `skill-specialist` lens (cluster shape). See the [persona library](https://github.com/prisma/ignite/blob/main/skills/.curated/drive-agent-personas).
- **Framework affordance gaps the skill is papering over** — file via the `prisma-next-feedback` skill or open the Linear ticket directly. Don't bury an affordance gap as a workaround in a skill body without naming it in *What Prisma Next doesn't do yet* and routing the user to feedback.
