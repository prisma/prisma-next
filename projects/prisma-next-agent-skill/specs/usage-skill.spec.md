# Summary

Define a published agent-skill package `@prisma-next/agent-skill` (one npm package, multiple skill subdirectories), version-locked to Prisma Next, whose body teaches an LLM agent how to operate Prisma Next end-to-end: adopt it into a new or existing project, edit the contract, plan and review migrations, write queries across the available query interfaces, wire up `db.ts`, integrate Prisma Next into the project's build system (Vite today, Next.js later), debug structured errors, and file bug reports or feature requests against Prisma Next itself. Define the in-repo authoring layout (`packages/0-shared/agent-skill/`), the `SKILL.md` skeleton every skill follows, the ten-skill cluster that fits the workflows under the 500-line-per-`SKILL.md` budget, the description-tuning convention that includes foreign-ORM trigger vocabulary, the *"What Prisma Next doesn't do yet"* honesty pattern that names unbuilt features instead of confabulating APIs (and routes the user to the feedback skill so missing features become a backlog signal rather than a dead end), and the *content-rotation policy* that keeps the skill body fresh as the framework evolves.

This skill is the *Layer 1 + Layer 2* artifact for the project: it closes the agent-side onboarding gap to zero (an agent dropped into a fresh Prisma Next project produces a working first query without external docs) and eliminates the daily-friction tax on common operations (schema edits, migration authoring, query writing, runtime configuration). It is the surface every partner-hosted agent (Supabase, v0, Lovable) consumes when its user is on Prisma Next.

This spec depends on [`upgrade-skill.spec.md`](upgrade-skill.spec.md)'s recipe-coverage CI check (FR13/FR14): the usage-skill package is added to the same coverage rule so any breaking-change PR that requires an upgrade recipe also requires a skill-content update in the same PR.

# Context

## At a glance

Today, the *agent's* experience of Prisma Next is essentially nonexistent. Open an IDE agent against a Prisma Next project, ask it to "add a User model and let me list users", and watch it default to Prisma 7's `prisma/schema.prisma` + `prisma generate` patterns — even though the project's `prisma-next.config.ts` says otherwise. The agent has no signal that Prisma Next exists, no understanding of `contract.json`, no awareness of the `db.sql` vs `db.orm` split, no idea what a capability is. The Prisma Next docs are accessible to it, but the agent has no reason to read them: it has a confident answer already.

This spec ships the artifact that fixes that: a small, structured, agent-readable surface installed once at project scaffold time. The artifact is **one npm package** containing **ten skill subdirectories**, each with its own `SKILL.md` and per-skill `references/`. The matcher fires on the relevant `description` field; the agent loads only that skill's body; deeper material loads on demand. The same install command (`npx skills add @prisma-next/agent-skill`) registers all ten skills with the agent runtime; `prisma-next init` invokes it on the user's behalf (handled in [`init-integration.spec.md`](init-integration.spec.md)).

The ten skills:

| # | Skill | Scope |
|---|---|---|
| 1 | `prisma-next` | Router — catches vague prompts and routes to a specific skill. ~50 lines. |
| 2 | `prisma-next-quickstart` | Adoption: greenfield + brownfield-DB. |
| 3 | `prisma-next-contract` | Contract authoring + editing across PSL, TS, no-emit. |
| 4 | `prisma-next-migrations` | Migration authoring + the `db update` vs `migration plan` decision. |
| 5 | `prisma-next-migration-review` | Deployment, concurrency, "what runs on merge?", CI integration. |
| 6 | `prisma-next-queries` | Query builders, ORM client, query-interface decision. |
| 7 | `prisma-next-runtime` | `db.ts` wiring, middleware, environment config. |
| 8 | `prisma-next-build` | Build-system / dev-server integration via Prisma Next build-tool plugins (Vite today; Next.js later). |
| 9 | `prisma-next-debug` | Signal-routing + per-error-domain references. |
| 10 | `prisma-next-feedback` | File a bug report or a feature request against Prisma Next. |

A user-facing flow, end-to-end:

```text
$ pnpm dlx prisma-next init my-app
  ✓ Scaffolds prisma-next.config.ts, schema.psl, db.ts
  ✓ Installs @prisma-next/agent-skill (registers 8 skills with the agent runtime)

$ cd my-app && open .

user> "add a Profile model with a unique email field and let me list profiles"
agent> (matches prisma-next-contract description; loads SKILL.md)
       Reads prisma-next.config.ts to confirm target=postgres, authoring=psl
       Edits schema.psl, runs `prisma-next contract emit`, types check
agent> (chains to prisma-next-migrations for the DB side)
       Runs `prisma-next db update` (dev flow), prompt confirmed
agent> (chains to prisma-next-queries)
       Writes a list-profiles handler using `db.orm.Profile.select(...).all()`
       Runs the handler — green.

user> "I'm about to merge — what migrations are going to run?"
agent> (matches prisma-next-migration-review description; loads SKILL.md)
       Runs `prisma-next migration status --ref staging` against the staging URL
       Reports the two pending migrations + the from/to hashes
```

The point is not that any individual workflow above is exotic — it is that none of them requires the user to paste documentation, re-explain Prisma Next's posture, or correct the agent's first guess. The skill makes the steps mechanical.

## Problem

Three concrete problems motivate this spec:

**1. Agents default to Prisma 7 in Prisma Next projects.** Without an installed skill, an IDE agent has no signal that Prisma Next is the framework in use — even in a project whose `package.json` already lists `@prisma-next/postgres`. The agent fabricates `prisma generate`, hand-writes a `prisma/schema.prisma`, and produces code that fails the type-check against the actual contract. The user spends the next several turns correcting it. This pattern repeats on every fresh task. Multiply it across the 2026 IDE-agent-adoption curve and Prisma Next is invisible to its primary consumption channel.

**2. The information the agent needs is structured, but unreachable without a skill.** Prisma Next's deliberate posture — `contract.d.ts` for types, `contract.json` for the runtime, capability-gated features, the `migration.json` + `ops.json` split, the `db.sql` / `db.orm` boundary — is *more* readable for an agent than typical ORM surfaces, *if* the agent knows the conventions. The skill is the encoding of those conventions. Without it, the agent has to derive the conventions by trial and error against the type-checker, which is slow, confusing, and often produces a near-miss that compiles but is wrong.

**3. Capability gaps in early-access Prisma Next confound the agent.** Prisma Next is in `0.x`. Several common ORM concerns (model validations, lifecycle callbacks, scopes, soft-delete, runtime-apply migrations, Studio, `EXPLAIN` integration, prepared statements, `db.batch()`, multi-database routing) are not yet implemented. Without explicit acknowledgement, the agent confabulates: it writes plausible-looking API calls against `db.orm.User.validates(...)` that don't exist, the type-check fails, the user is none the wiser about why. The skill must be honest about what Prisma Next doesn't do, name the workaround, and link to the feature request — for every gap, in every skill.

Underneath all three is a single bet: the agent is the primary consumer of Prisma Next's surface in 2026. The skill is what makes that consumption work.

## Approach

The approach is structural — pick a small set of decisions that pin the shape of every skill in the cluster, then let the inventory of workflows determine the per-skill content. The decisions below are all settled (see [Decisions resolved during refinement](#decisions-resolved-during-refinement)).

### One published package, eight skill subdirectories

The [agentskills.io](https://agentskills.io/specification) format treats one *skill* as one directory containing one `SKILL.md`. A package is a container for multiple skill directories; the agent matcher fires on each skill's `description` field independently. `npx skills add owner/repo` registers every `SKILL.md` in the package.

The package is `@prisma-next/agent-skill`, sourced from `packages/0-shared/agent-skill/` in this monorepo. Its layout:

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
    │   └── references/
    ├── prisma-next-migrations/
    │   ├── SKILL.md
    │   └── references/
    ├── prisma-next-migration-review/
    │   ├── SKILL.md
    │   └── references/
    ├── prisma-next-queries/
    │   ├── SKILL.md
    │   └── references/
    ├── prisma-next-runtime/
    │   ├── SKILL.md
    │   └── references/
    ├── prisma-next-build/
    │   ├── SKILL.md
    │   └── references/
    ├── prisma-next-debug/
    │   ├── SKILL.md
    │   └── references/
    └── prisma-next-feedback/
        └── SKILL.md
```

Tier choice (`0-shared/`) aligns with the upgrade-skill packages from [`upgrade-skill.spec.md`](upgrade-skill.spec.md). The skill names are all brand-prefixed (`prisma-next-*`) so the matcher doesn't collide with other ORMs' skills installed in the same agent runtime.

### Canonical mental model — every `SKILL.md` opens with it

Every `SKILL.md` body opens with the same headline and three-step model:

> **Edit your data contract. Prisma handles the rest.**
>
> Concretely:
>
> 1. You edit your data contract.
> 2. The system plans the migrations for you.
> 3. If you need data migrations, you edit `migration.ts` and execute it.

This is the organising principle the agent chains back to in every workflow. The headline appears in every skill's preamble; the three-step expansion appears in the at-least-one skill body where it's first relevant (the contract skill is the natural home).

### `SKILL.md` skeleton — adopted wholesale from `get-convex/agent-skills`

Every skill follows the same Markdown structure, validated against the Convex skill set (six published skills, 53–377 lines each) as the closest-fit precedent. Other surveyed packages (Drizzle, Sequelize, TypeORM, Kysely, Active Record, Supabase, Vercel) are inconsistent on structure; Convex is consistent and load-bearingly clear.

```text
---
name: prisma-next-<X>
description: <see description-field convention below>
---

# <Title Case Skill Name>

<one-paragraph preamble — what this skill covers, plus the canonical
mental-model headline in one line>

## When to Use
<3–6 bullet triggers — prompts that should fire this skill>

## When Not to Use
<3–6 bullet anti-triggers — for X instead, use the `prisma-next-Y` skill>

## Key Concepts (or First Step / Guardrails)
<small number of mental models the agent needs before any workflow>

## Workflow
<numbered 5–10-step procedure for the canonical workflow this skill teaches>

## <Topic sections>
<decision tables, bad/good code pairs, Critical Rules, per-feature
branches>

## Common Pitfalls
<numbered, 4–8>

## What Prisma Next doesn't do yet
<see "Capability-gap honesty" below>

## Reference Files
<bulleted list of references/*.md with one-line descriptions>

## Checklist
<10–15 verifiable items the agent self-grades against>
```

The "When Not to Use" section is load-bearing: it routes the agent to the right adjacent skill when the prompt matches the wrong one. The "Checklist" is the self-grading instrument the agent (and the human reviewer) uses to determine whether the workflow finished. Both are non-optional.

The "Workflow" section is *procedural*: numbered steps with explicit commands, file paths, and validation checkpoints. Other sections may be *conceptual* (decision tables, what-is-X paragraphs); workflows are not. This split matches the agent's loading model — workflows are what the agent re-reads under pressure; references are what it reads once to ground.

### Description-field convention

Every `description` follows the same shape:

> *\<Action verb\> \<noun phrase\> with \<key concepts\>. Use for \<comma-separated trigger phrases including the exact CLI flags, error codes, feature names, and foreign-ORM vocabulary the user would type\>.*

Length: 25–35 words. The "Use for ..." tail is a lexical match list for the agent matcher.

**Cross-ORM trigger keywords are mandatory.** The matcher fires on text the user actually types, and users coming from other ORMs type their ORM's vocabulary. The contract skill's description includes *validations, callbacks, scopes, soft delete, models, schema, fields, attributes*. The migration skill's includes *introspect, push, generate, dev, deploy, db push, prisma migrate*. The debug skill's includes *Studio, prisma studio, explain, query log, prepared statements*. The skill's *answer* may be "we don't do that yet, here's the workaround," but the matcher must still fire — otherwise the user gets no skill at all and the agent confabulates.

### Capability-gap honesty — *"What Prisma Next doesn't do yet"*

Prisma Next is in early access. Several common ORM features are not yet built. The skill must be honest about that rather than fabricate API surfaces.

Every skill carries a top-level **What Prisma Next doesn't do yet** section listing the gaps relevant to that skill's domain. Format per entry:

> - **\<Feature\>**: Prisma Next doesn't do \<X\> for you. \<User-side workaround in one or two sentences\>. If you need this built-in, file a feature request via the `prisma-next-feedback` skill.

The route to `prisma-next-feedback` (FR19b) replaces what would otherwise be a bare URL in every gap entry. The feedback skill is the canonical, agent-readable surface for filing the request — it walks the agent through producing a minimal-repro / desired-API-shaped body the framework team can act on, instead of a one-line link the user may or may not click.

When the list bulks up the SKILL.md body past the budget (FR4), spill it into `references/not-yet-supported.md` and link from the section header.

The pattern double-serves: it tells the user the truth, and it gives the agent something concrete to say when the user asks about an unbuilt feature — preventing confabulation. Without it, the dominant failure mode is the agent inventing a plausible-looking call against an API that does not exist.

The capability-gap entries in each skill are enumerated in the [Cluster scope](#cluster-scope--per-skill-inventory) section below. The list is not exhaustive — it captures known gaps at spec-authoring time. New gaps land in the skill as part of the breaking-change PR that introduces them, governed by the content-rotation policy.

### Bad/good code pairs as the dominant teaching device

Convex's skills use `// Bad:` / `// Good:` code-block pairs more than any other structural element. Every workflow step that has a wrong-vs-right contrast — and most do — gets a bad/good pair instead of prose explanation. Prose is for the *why*; code pairs are for the *what*.

The pattern is denser, more directly actionable for the agent, and easier to maintain than prose: each pair is a single hunk that survives or fails on its own merits when the surface changes.

### Glossary is source of truth for user-facing terminology

[`docs/glossary.md`](../../../docs/glossary.md) is the canonical user-facing vocabulary. Skill prose uses glossary terms — *contract*, *extension*, *query builder*, *middleware*, *marker*, *capability*. Internal package and config-field names (e.g. `extensionPacks` in `prisma-next.config.ts`, `lane` in package paths) stay as-is in code samples; surrounding prose uses the user-facing term.

The terminology-alignment tracker at the bottom of the glossary lists the currently-pending internal renames (`extensions` vs `extensionPacks`, `query builder` vs `lane`). The skill is not responsible for fixing those; it is responsible for using the user-facing term in prose while leaving the code accurate.

We do **not** ship per-source-ORM translation reference files (no `references/from-drizzle.md` etc.). Cross-ORM vocabulary alignment is handled by including foreign-ORM trigger keywords in skill descriptions (above) plus extending `docs/glossary.md` as new terminology gaps surface. Per-source-ORM *migrate-from* skills are out of scope for this spec and are tracked as separately-installable skills in their own future projects.

### Single skill set across targets and monorepo shapes

Target-keyed content (Postgres vs Mongo) and contract-space-keyed content (single-contract vs aggregate-contract monorepo) lives *inside* skill bodies as branching steps, not split into separate skills per target or per monorepo shape. The CLI handles target-keyed scaffolding at `init` time (a Mongo project gets a `mongo` `prisma-next.config.ts`); from then on, every skill reads the config and branches its instructions accordingly.

Rationale: the user mental model is "I'm using Prisma Next", not "I'm using Prisma Next Postgres." Skills should follow the user's mental model, not the internal target distinction.

### The router skill

Once seven workflow skills are installed, the matcher will misfire on vague prompts like *"help me with Prisma Next"* — the user gave the matcher no specific signal, and seven skills' worth of descriptions are roughly equally lukewarm matches. Convex hit this problem and shipped a 53-line `convex` router skill purely to catch these and re-fire on the right specific skill.

PN does the same: the `prisma-next` skill is ~50 lines, has no `references/`, and exists *only* to disambiguate vague prompts. Its body lists the seven workflow skills with one-line trigger conditions each, ending with *"if you can't tell which to use, ask the user what they want to do."*

The router is not a bootstrap skill. `prisma-next init` is the user's first contact with PN; there is no agent-activation moment between `init`-completing and the user's first real prompt for a bootstrap to occupy. The router catches *under-specified* prompts, not first-contact prompts.

### Content-rotation policy — co-location + PR-template item, defer the rest

As Prisma Next evolves, skill content goes stale. The minimum-viable policy for the 0.x phase, settled in shaping, is two mechanisms:

1. **Co-location + PR-template item.** Every PR that changes a user-facing surface (CLI commands or flags, public TypeScript APIs, `prisma-next.config.ts` fields, error codes, the glossary) must either touch `packages/0-shared/agent-skill/` *or* state in the PR description, in a free-text "Skill update" field, why no skill update is needed. The check is human (PR reviewer's eyes on the PR-template field), not CI-enforced. The skill source's co-location with the framework code (same monorepo, same workspace, same PR) is what makes this lightweight enough to be sustainable.
2. **Skill-coverage check piggybacks on the upgrade-recipe coverage check.** The CI check from [`upgrade-skill.spec.md`](upgrade-skill.spec.md) FR13 / FR14 extends to one additional sub-check: any PR whose diff requires an upgrade recipe (i.e. touches `examples/` or `packages/3-extensions/` as a downstream consequence of a framework refactor) must also touch `packages/0-shared/agent-skill/`. The rationale is the same as the recipe-coverage rule: a breaking change that produces an upgrade recipe is one whose surface description necessarily changed, which means the skill body necessarily needs updating. Failure mode: the PR's CI fails with a structured error naming the expected directory and the rule (FR9).

Deferred until 0.x churn slows: reverse-CODEOWNERS, scheduled freshness rotation, CI-enforced fingerprinting against source revisions, dogfooded journey tests in CI. Revisit then.

### Validation strategy — dogfood, not unit tests

Skill effectiveness is measured by agent behaviour, not by tests against the skill's source text. The validation flow:

1. After the skill set is authored, install it locally (`npx skills add file:packages/0-shared/agent-skill/`).
2. Point an agent (Claude / Cursor / the partner-hosted runtime under test) at one of the example apps under `examples/`.
3. Run the agent through a fixed set of *journey tests* — prompts the skill is meant to handle (e.g. "add a model and let me list it", "what migrations will run when I merge?", "I'm getting a `MIGRATION.HASH_MISMATCH` error", "I'm migrating from a Drizzle project").
4. Observe each journey's outcome: did the agent reach a green state? Did it follow the skill's workflow? Did it confabulate APIs?
5. Refine the skill bodies, descriptions, and reference material based on observed fumbles. Re-run.

The acceptance criteria in [Acceptance Criteria](#acceptance-criteria) name the specific journeys the skill must support. The journey tests live as Markdown checklists in `packages/0-shared/agent-skill/journey-tests/` — *not* automated assertions, by design. Automating agent behaviour against a moving model surface is its own research project (cf. Anthropic's `skill-creator` tool, which Convex's contributing notes recommend for the same loop); this spec defers that project.

# Requirements

## Functional Requirements

### Published package — `@prisma-next/agent-skill`

- **FR1. Distribution.** A single npm package, `@prisma-next/agent-skill`, installable via `npx skills add @prisma-next/agent-skill`. Published lockstep with every PN release (FR2). Source-controlled in this monorepo at `packages/0-shared/agent-skill/`.

- **FR2. Version-locking.** Every PN release publishes the agent-skill package at the same version. The publish workflow refuses to ship without it (NFR8 from [`upgrade-skill.spec.md`](upgrade-skill.spec.md) extends to cover this package). Consumers at PN `0.7.x` get the `0.7.x`-tagged agent-skill set; the framework cannot ship without the skill, and the skill cannot ship without the framework.

- **FR3. Ten-skill cluster.** The package contains exactly the ten skill subdirectories listed in [The ten skills](#at-a-glance), each with its own `SKILL.md`. Additional skills require this spec to be amended. The skill names are fixed as specified.

- **FR4. Per-`SKILL.md` size budget.** Every `SKILL.md` body fits within ~350 lines (target; ~500 lines hard ceiling per the agentskills.io spec recommendation). Content that exceeds the budget moves to per-skill `references/*.md` files referenced from the SKILL.md body. The `prisma-next` router skill is exempt from the lower bound — it is intentionally tiny (~50 lines).

- **FR5. Progressive disclosure.** Each skill loads in three tiers:
  1. **Metadata** (`name` + `description`) — loaded at startup for every installed skill. The matcher fires on this.
  2. **Instructions** (full `SKILL.md` body) — loaded only when the matcher activates the skill.
  3. **Resources** (per-skill `references/`, `assets/`) — loaded only when the SKILL.md body links to them during a workflow.

  The skill is structured so the agent loads no resource files unless the active workflow demands them.

### `SKILL.md` shape

- **FR6. Common skeleton.** Every `SKILL.md` follows the structure defined in [SKILL.md skeleton](#skillmd-skeleton--adopted-wholesale-from-get-convexagent-skills). The sections appear in the order specified: frontmatter, title, preamble, *When to Use*, *When Not to Use*, *Key Concepts*, *Workflow*, additional topic sections, *Common Pitfalls*, *What Prisma Next doesn't do yet*, *Reference Files*, *Checklist*. The *When Not to Use* and *Checklist* sections are non-optional.

- **FR7. Canonical mental-model preamble.** Every `SKILL.md` body opens with the headline `Edit your data contract. Prisma handles the rest.` as the first sentence of the preamble. At least one skill (`prisma-next-contract` is the natural home) expands the headline into the three-step model from [Canonical mental model](#canonical-mental-model--every-skillmd-opens-with-it).

- **FR8. Description-field convention.** Every skill's `description` field follows the *\<Action verb\> \<noun phrase\> with \<key concepts\>. Use for \<trigger-keyword list\>* shape from [Description-field convention](#description-field-convention). The trigger-keyword list includes:
  - PN-specific terms the user types (CLI command names, config field names, error codes).
  - Foreign-ORM vocabulary the user might type instead (e.g. *validations* for the contract skill, *prisma migrate dev* for the migrations skill, *prisma studio* for the debug skill). The "Use for ..." list per skill is enumerated in the implementation; the spec pins the rule, not the exact text.
  - Length: 25–35 words.

- **FR9. Capability-gap section.** Every skill has a *What Prisma Next doesn't do yet* section listing unbuilt features in that skill's domain. Format per [Capability-gap honesty](#capability-gap-honesty--what-prisma-next-doesnt-do-yet); minimum entries per skill enumerated in [Cluster scope](#cluster-scope--per-skill-inventory) below. Each entry closes with a route to the `prisma-next-feedback` skill (FR19b) instead of a bare feature-request URL — the feedback skill is the canonical, agent-readable surface for filing the request and the capability-gap entry's last line is *"file this via the `prisma-next-feedback` skill"* or equivalent. Adding or removing entries as the framework evolves is governed by the content-rotation policy ([Content-rotation policy](#content-rotation-policy--co-location--pr-template-item-defer-the-rest)).

- **FR10. Bad/good code pairs.** Every workflow step that has a wrong-vs-right contrast uses a `// Bad:` / `// Good:` code-block pair rather than prose explanation. The judgement call about which steps need a pair is the skill author's; the rule is that whenever a contrast is shown, it is shown as code, not as English.

- **FR11. Glossary-aligned terminology.** Skill prose uses the user-facing terms from [`docs/glossary.md`](../../../docs/glossary.md). Code samples retain the current internal names (e.g. `extensionPacks:` in config snippets) where those have not yet caught up to the user-facing term; surrounding prose uses the glossary term (e.g. *"add the extension to `extensionPacks`"*).

### Cluster scope — per-skill inventory

Each skill's content is bounded by the inventory below. *Bullets are workflows* unless explicitly labelled as decision tables or reference material.

- **FR12. `prisma-next` — Router.** ~50 lines, no `references/`. Body lists the nine workflow skills with one-line trigger conditions each, ends with *"if you can't tell which to use, ask the user what they want to do."*

- **FR13. `prisma-next-quickstart` — Adoption.** Two branching paths:
  - **Path 1 — Greenfield.** `prisma-next init` → pick target → first model → first `contract emit` → `db init` → first query.
  - **Path 2 — Brownfield-DB.** `prisma-next contract infer` → review and clean up the inferred PSL → `contract emit` → `db sign` → wire `db.ts` → first query.

  No "migrate from another ORM" content (out of scope — those are separately-installable skills).

- **FR14. `prisma-next-contract` — Contract authoring + editing.** Workflows:
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
  - Decision table: PSL vs TS builder vs no-emit TS-first.
  - Use no-emit (Vite plugin / Next plugin auto-emit).
  - Work in an aggregate-contract monorepo: pick the right contract space (see [ADR 212](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)).
  - Run `contract emit` and verify.

  *What PN doesn't do yet:* validations (use arktype/zod in app code), lifecycle callbacks (use middleware or app code), soft delete (`paranoid`/`deletedAt` — add a column, filter in queries).

- **FR15. `prisma-next-migrations` — Migration authoring.** Workflows:
  - Decision table: `db update` quick path vs `migration plan` + `apply` migration path.
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

  *What PN doesn't do yet:* runtime-apply migrations (use the CLI from the deploy pipeline), seeds-as-first-class (run setup queries from app code).

- **FR16. `prisma-next-migration-review` — Deployment + concurrency.** Workflows:
  - Answer "what's about to run on merge?" for a given env ref: `migration status --ref <env>`, optionally `--db <env-url>`.
  - Render the migration graph from the topic branch vs `main`.
  - Detect that `main` advanced ahead of the topic branch.
  - **Resolve a concurrent-migration conflict** — the canonical 5-step procedure: (1) rebase the topic branch onto the new `main`; (2) delete the topic branch's locally-planned migration directory; (3) re-run `migration plan --name <slug>`; (4) port any data-transform customizations from the original `migration.ts` into the new one; (5) re-emit. Same workflow whether the two branches converged on the same destination hash or diverged.
  - `migration ref set/get/delete/list`.
  - Run a migration against a ref instead of the latest contract hash.
  - Decide what to do when CI reports the `from` hash doesn't match prod's marker.
  - Verify in CI that the branch can advance the target environment without manual intervention.

  No capability gaps documented here at spec-authoring time; entries added as gaps surface.

- **FR17. `prisma-next-queries` — Query authoring.** Workflows:
  - Decision table: which query interface for this query? (SQL query builder / Raw SQL / ORM client / TypedSQL.)
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
  - Use TypedSQL: author a `.sql` file with typed params + result types.
  - Stream large result sets.

  *What PN doesn't do yet:* `EXPLAIN` integration (run via `db.sql.raw\`EXPLAIN ...\``), prepared statements (use the raw lane), `db.batch()` for multi-statement batching (sequential calls only), automatic N+1 detection (capability-gated `includeMany` is the manual approach).

- **FR18. `prisma-next-runtime` — Wiring `db.ts`.** Workflows:
  - Compose `postgres()` / `mongo()` with extensions + middleware.
  - Add `createTelemetryMiddleware()`.
  - Add `lints()` middleware.
  - Add `budgets({ ... })` middleware.
  - Add an extension-contributed middleware.
  - Configure connection: `db.connection` in config vs `DATABASE_URL` env var vs `--db` flag.
  - Per-environment config (dev vs prod).
  - Switch targets (Postgres ↔ Mongo).

  Build-system / dev-server integration (Vite, future Next.js) is **out of scope** here and belongs to `prisma-next-build` (FR18b). The runtime skill's *When Not to Use* section routes those prompts.

  *What PN doesn't do yet:* multi-database routing / read replicas (configure separate `db.ts` instances per service), connection pooling tuning as first-class (pass driver options through).

- **FR18b. `prisma-next-build` — Build-system / dev-server integration.** Workflows:
  - Decision table: do I need a build-system plugin at all? (Yes if I want no-emit dev: contract artifacts regenerate automatically on `schema.psl` / `contract.ts` edits during `vite dev`. No if I'm fine running `prisma-next contract emit` by hand or wiring a `prebuild` script.)
  - Install [`@prisma-next/vite-plugin-contract-emit`](../../../packages/1-framework/3-tooling/vite-plugin-contract-emit/README.md) (Vite 7 or 8).
  - Wire `prismaVitePlugin('prisma-next.config.ts')` into `vite.config.ts`.
  - Configure the plugin: `debounceMs`, `logLevel` (`silent` / `info` / `debug`).
  - Verify the dev loop: start the dev server, edit `schema.psl`, see the contract artifacts re-emit (success log line) without a manual command.
  - Recover when the plugin warns about config-only watching (the loader could not resolve `contract.source.inputs`).
  - Read an error overlay produced by an emit failure (PSL syntax, missing namespace, conflicting extensions); chain to `prisma-next-debug` for resolution.
  - Verify the published-pair invariant (`contract.d.ts` renamed before `contract.json`) is happening — the user does not need to do anything beyond letting the plugin run.
  - Tear down: explicit `disposeEmitQueue(outputJsonPath)` is the plugin's responsibility and is not user-surface; mention it for users embedding their own Vite plugin.
  - Diagnose dev-server / HMR interactions with React Router v7 Framework Mode (the [`examples/react-router-demo`](../../../examples/react-router-demo/) case): the contract auto-emit and the framework's own SSR re-load run side-by-side.

  *What PN doesn't do yet (build-system gaps the skill must name):*
  - **Next.js plugin.** No first-party Next.js plugin exists yet. Workaround: run `prisma-next contract emit` from a `prebuild` script in `package.json` and from a manual command during development. If you need an integrated Next.js plugin, file a feature request via `prisma-next-feedback`.
  - **Vite < 7.** The plugin requires Vite 7 or 8 (the peer-dependency range). Vite 6 is not supported and is not on the support matrix.
  - **Other bundlers (Webpack, esbuild, Rollup, Turbopack).** Not first-party. Run `prisma-next contract emit` from the bundler's pre-build hook. If you need a first-party plugin, file a feature request.
  - **Build-time-only emission outside dev.** The plugin runs in `vite dev` and re-emits on file changes; it does not run during `vite build`. For CI / production builds, use the explicit `prisma-next contract emit` step.

- **FR19. `prisma-next-debug` — When things break.** Workflows (signal-routing table — symptom → reference file):
  - "My query won't typecheck" — contract stale, capability missing, query-interface mismatch.
  - "My query throws at runtime" — read the error envelope, look up the stable code.
  - "Capability X isn't available" — what to enable / which extension to install.
  - "Migration won't apply" — marker mismatch, precondition failed, runner refused.
  - "Emit fails" — PSL syntax, missing namespace, conflicting extensions.
  - "Contract is out of sync with the DB" — drift detection.
  - "`MIGRATION.HASH_MISMATCH`" — `migration.ts` edited after emit.
  - Read a planner-conflict failure — rename hints missing, destructive ops blocked.

  Reference material per error-code domain:
  - `references/cli-errors.md` — `PN-CLI-4xxx`.
  - `references/migration-errors.md` — `PN-MIG-2xxx`.
  - `references/runtime-errors.md` — `PN-RUN-3xxx`.
  - `references/contract-errors.md` — contract emit / wiring validation failures.

  *What PN doesn't do yet:* Studio / GUI database browser (use `prisma-next db schema` for CLI tree output), query logger middleware as first-class (add via custom middleware for now).

- **FR19b. `prisma-next-feedback` — Bug reports and feature requests.** Short skill (~80–120 lines, no `references/`). The single most-fired path from every other skill's *What Prisma Next doesn't do yet* entries: when the agent confirms a capability gap, it routes the user here instead of dropping a feature-request URL in passing. Workflows:
  - Decide bug report vs feature request: it's a bug if the documented surface behaved unexpectedly (CLI exited with the wrong code, a documented query interface produced a wrong result, an error envelope's `fix` field was misleading, a published TypeScript signature didn't match runtime behaviour); it's a feature request otherwise.
  - Collect a minimal, public-safe reproduction: a redacted `schema.psl` / contract excerpt, the failing command + its full output (with `-v` if a structured error is involved), the Prisma Next version (`pnpm ls @prisma-next/postgres` or equivalent) and the runtime (Node version, OS), the package manager (pnpm / npm / yarn / bun). Do not include `DATABASE_URL` secrets or proprietary schema fragments.
  - Render the report on the existing GitHub Issues forms at <https://github.com/prisma/prisma-next/issues/new/choose>. If issue templates are not present (early-access — see *What PN doesn't do yet* below), the skill instructs the agent to open a free-form issue with a structured body the agent fills in: *Summary*, *Steps to reproduce*, *Expected behaviour*, *Actual behaviour*, *Environment*, *Workaround (if any)*.
  - For feature requests: name the unbuilt feature, name the user's workaround (the agent already has this from the capability-gap entry that triggered the route), describe the desired API or behaviour in one paragraph, and link the source skill's capability-gap entry that triggered the request. The link makes the surface area concrete.
  - For bug reports: the skill walks the agent through producing a minimal repro that the framework team can re-run locally. Where possible, the repro is a small change against [`examples/prisma-next-demo`](../../../examples/prisma-next-demo/) so the team can reproduce against the canonical substrate.
  - Confirm with the user before submitting: the skill must surface the rendered title and body to the user for review, never auto-submit silently. Submission via `gh` CLI is the recommended path when available; otherwise the skill opens the *new issue* URL in the browser with the body prefilled.
  - Optional: encourage the user to install the `prisma-next-upgrade` skill if the bug is fixed by a newer Prisma Next release; chain to a quick *upgrade then verify* loop.

  No `references/` directory by default; the skill is small enough that everything lives in the body.

  *What PN doesn't do yet:*
  - **First-class issue templates.** The repository may not yet expose GitHub Issue Forms (`.github/ISSUE_TEMPLATE/*.yml`). Until it does, the skill prescribes the structured-body shape itself. If you want first-class issue templates in the repository, file a feature request — via this skill, of course.
  - **In-product feedback channel.** Prisma Next does not phone home and does not have an in-product "send feedback" command. The repository's GitHub Issues page is the canonical surface. If you want a CLI-side `prisma-next feedback` command, file a feature request.

  The feedback skill is the **terminal of the capability-gap routing pattern**: any skill body that lists *What Prisma Next doesn't do yet* must close each entry with *"file this via the `prisma-next-feedback` skill"* (the exact prose may vary; the route must be present). The feedback skill is also reachable directly via prompts like *"this is a bug"*, *"this should be a feature"*, *"how do I report this?"*, and *"file an issue against Prisma Next"*.

### Project-context reasoning

- **FR20. Read `prisma-next.config.ts` before acting.** Every workflow whose answer depends on target, extensions, or contract source begins by reading `prisma-next.config.ts`. The `SKILL.md` instructs the agent to do this explicitly as the first workflow step. For monorepo projects with multiple `prisma-next.config.ts` files (the aggregate-contract pattern from [`examples/multi-extension-monorepo/`](../../../examples/multi-extension-monorepo/)), the skill reasons about which contract space the user is operating in and reads the corresponding config.

- **FR21. Read the active contract source.** Workflows that edit the contract begin by reading the contract source (`schema.psl` or the `.ts` builder file, as `prisma-next.config.ts` declares). Workflows that read the contract for type information (most query workflows) read `contract.d.ts`. Neither workflow assumes a fixed filename — both consult the config.

### Content-rotation policy

- **FR22. Co-location.** The skill source lives in the same monorepo as the framework source. A breaking change to the framework and the skill update that covers it land in the same PR, reviewed together, merged together, published together.

- **FR23. PR-template "Skill update" item.** The repo's `.github/PULL_REQUEST_TEMPLATE.md` gains a free-text field for skill updates:

  > **Skill update.** If this PR changes any user-facing surface (CLI commands or flags, public TypeScript APIs, `prisma-next.config.ts` fields, error codes, glossary terminology), describe the skill update made in this PR or state why no update is required.

  The check is human (PR reviewer); CI does not enforce content correctness. The presence of *some* text in the field is the only mechanical signal.

- **FR24. Skill-coverage check extends the upgrade-recipe coverage check.** The `check:recipe-coverage` CI step from [`upgrade-skill.spec.md`](upgrade-skill.spec.md) FR13 / FR14 gains a third sub-check: if either of the existing two sub-checks fires (i.e. the PR requires a user or extension upgrade recipe), the PR must also touch `packages/0-shared/agent-skill/`. The failure error names the expected package directory and points at this spec's rationale. Implementer's note: this requires a small amendment to the `check:recipe-coverage` implementation specified in [`upgrade-skill.spec.md`](upgrade-skill.spec.md); the cross-spec wiring is the follow-up tracked in [Open Questions](#open-questions) below.

### In-repo authoring

- **FR25. Workspace package shape.** `packages/0-shared/agent-skill/` is a standard pnpm workspace package: `package.json` with a `name` of `@prisma-next/agent-skill`, an empty `dependencies` (the skill is content, not code), the standard `publishConfig` block. The `files` field includes the `skills/` directory and `README.md`. No build step; the markdown ships as-is.

- **FR26. `architecture.config.json` entry.** The package is classified as `framework` / `tooling` / `shared` (same classification as the upgrade-skill packages from [`upgrade-skill.spec.md`](upgrade-skill.spec.md)). `pnpm lint:deps` must pass with the new entry.

- **FR27. Journey-test inventory.** Journey tests live as Markdown checklists at `packages/0-shared/agent-skill/journey-tests/<journey>.md`. Each file names the prompt the agent receives, the example app to point it at, and the expected end-state criteria. Implementation enumeration is the implementer's call; the spec pins the inventory (every Acceptance Criterion `AC4`+ corresponds to one journey test).

## Non-Functional Requirements

- **NFR1. Source co-location.** Source-controlled in this monorepo. Ships via the existing `publish.yml` workflow. No separate skill-source repo, no out-of-band publish channel.
- **NFR2. Version-locked.** Every published agent-skill artifact ships at the same version as the Prisma Next release that publishes it. Same constraint as [`upgrade-skill.spec.md`](upgrade-skill.spec.md)'s NFR8; the same publish step picks both up.
- **NFR3. Progressive-disclosure load shape.** Each `SKILL.md` body fits within the FR4 budget. The agent should never need to load more than one `SKILL.md` plus its referenced `references/*.md` files to complete a single workflow.
- **NFR4. Agent-tool-agnostic.** The skill set is read by every agent runtime that consumes the agentskills.io format. The published artifact does not include vendor-specific (`.cursor/` / `.claude/`) directory layouts; consumers' agent runtimes are responsible for their own discovery on top of the standard `SKILL.md` shape.
- **NFR5. No backward-compat shims.** The current hand-rolled template at [`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md) (and its `agent-skill-mongo.md` sibling) is removed by the `prisma-next init` integration task ([`init-integration.spec.md`](init-integration.spec.md)), not retained as a fallback. The published skill replaces the same surface.
- **NFR6. No phone-home.** The skill artifact is read-only Markdown; nothing in the skill set issues network requests, reads tokens, or emits telemetry. Any telemetry about skill firing is the agent runtime's responsibility, not the skill's.
- **NFR7. Honest about gaps.** Capability-gap entries (FR9) name the feature, the workaround, and the feature-request URL. Skill authors do not paper over gaps with "this is undocumented but possible" language; if PN doesn't do it, the skill says so.

## Non-goals

- **Per-source-ORM `migrate-from-*` skills.** Migrating an existing Drizzle / Sequelize / TypeORM / Prisma 6 / Prisma 7 / Kysely / Knex / raw-driver project to Prisma Next is a substantial topic in its own right, with content that is irrelevant to the always-on usage skill set. Each `migrate-from-X` is a candidate for a separately-installable skill (e.g. `@prisma-next/migrate-from-drizzle-skill`) tracked in its own future project. Not part of this spec.
- **Partner-specific skills.** `@prisma-next/agent-skill-supabase` and equivalents are out of scope. The usage skill *recognises* partner extensions present in `prisma-next.config.ts` and orients its instructions accordingly; partner-specific content lives in partner-specific skills shipped from those partners' extension projects.
- **Demo content.** Recorded videos, landing-page copy, partner-pitch artifacts are separate efforts.
- **A "skill quality" scoring framework.** Skill effectiveness is measured by acceptance criteria — does the agent complete the journey — not by a numeric metric.
- **Cross-agent-runtime automated testing harness.** Journey tests are Markdown checklists run manually (or by the skill author with Anthropic's `skill-creator`, which is a tooling choice the spec does not pin). A cross-runtime automated harness is its own research project; deferred.
- **CI-enforced freshness rotation.** The content-rotation policy is the human-attestation PR-template item plus the lightweight CI extension to recipe-coverage (FR23 / FR24). CI-enforced scheduled freshness rotations, reverse-CODEOWNERS, and source-revision fingerprinting are deferred until the 0.x churn slows.
- **Studio-replacement content, runtime-apply-migration content, validation framework content.** All of these are capability gaps documented under *What PN doesn't do yet*. The skill does not paper over them with workarounds invented for the skill's sake.

# Acceptance Criteria

- **AC1. Published package shape.** A stable release publishes `@prisma-next/agent-skill` to npm at the same version as the rest of the PN packages. `npm view @prisma-next/agent-skill dist-tags.latest` returns the same value as `npm view @prisma-next/postgres dist-tags.latest`. The package contains exactly the ten skill subdirectories named in FR12 – FR19b. Covers FR1, FR2, FR3, NFR1, NFR2.

- **AC2. Per-skill structure conforms to the skeleton.** Each of the ten `SKILL.md` files has the sections from FR6 in order: frontmatter, title, preamble (with the FR7 headline as its first sentence), *When to Use*, *When Not to Use*, *Key Concepts*, *Workflow*, optional topic sections, *Common Pitfalls*, *What Prisma Next doesn't do yet*, *Reference Files*, *Checklist*. Verified by a structural check (a small script that asserts the section headings are present in order); part of `pnpm test --filter @prisma-next/agent-skill` if such a test is added, otherwise verified manually by the reviewer. Covers FR6, FR7, FR9.

- **AC3. Size budget.** Each `SKILL.md` body fits within the FR4 budget: ≤500 lines hard, ≤350 lines target, plus the router-skill exemption. Covers FR4, NFR3.

- **AC4. Journey — onboarding to first query (Layer 1).** An agent with `@prisma-next/agent-skill` installed, given a freshly-scaffolded Prisma Next project (a checkout of `pnpm dlx prisma-next init`'s output, no other prompts or context), receives the prompt *"add a User model with id and email, and let me list all users"* and produces:
  - An edited `schema.psl` (or `prisma/contract.ts`, depending on the project's authoring choice) containing the `User` model with `id` and `email` fields.
  - A run of `prisma-next contract emit` (or the equivalent for the project's authoring mode).
  - A migration created via `db update` or `migration plan` + `migration apply`.
  - A query file that calls `db.orm.User.select(...).all()` and returns the rows.
  - All of the above pass typecheck and execute green against the project's dev DB.

  Without consulting external docs, without the user pasting Prisma Next API surface, and without trial-and-error against the type-checker. Verified by running the journey test `journey-tests/01-onboarding-first-query.md`. Covers FR6 – FR8, FR12 – FR19, the project spec's FR6.

- **AC5. Journey — Layer 2 operations.** An agent with the skill installed completes each of the following journeys end-to-end without the user pasting external docs:
  - **AC5a.** Add a new model + relation, regenerate the contract, apply the migration locally, write a query using the relation.
  - **AC5b.** Rename a column using `@hint(was: "old_name")`, plan the migration, verify the plan handles the rename correctly.
  - **AC5c.** Author a migration with a data-transform placeholder, fill the placeholder, re-emit, apply.
  - **AC5d.** Write a query using a capability-gated feature (`returning()`), recognise the capability isn't enabled, enable it, re-run.
  - **AC5e.** Read a structured error envelope on a `MIGRATION.HASH_MISMATCH`, recover by re-running `node migrations/<dir>/migration.ts`.
  - **AC5f.** Answer *"what migrations are about to run on merge?"* for a staging environment by running `prisma-next migration status --ref staging`.
  - **AC5g.** Resolve a diamond-convergence migration conflict using the 5-step rebase-replan-port-emit procedure (FR16).
  - **AC5h.** Pick the right query interface (DSL vs raw SQL vs ORM client) given a prompt that includes a Postgres-specific feature, justify the choice from the decision table.

  Each journey is one Markdown checklist at `journey-tests/02-*.md`. Covers FR13 – FR19, the project spec's FR7.

- **AC6. Capability-gap honesty.** For each of the following user prompts, the agent (with the skill installed) responds with the *What Prisma Next doesn't do yet* entry from the matching skill, names the workaround, and routes to `prisma-next-feedback` to file the request — *not* a fabricated API call:
  - **AC6a.** *"Add a validation: email must contain `@`."* Skill: `prisma-next-contract`.
  - **AC6b.** *"Run a `beforeSave` hook on User to lowercase the email."* Skill: `prisma-next-contract`.
  - **AC6c.** *"Open Prisma Studio."* Skill: `prisma-next-debug`.
  - **AC6d.** *"`EXPLAIN` this query."* Skill: `prisma-next-queries`.
  - **AC6e.** *"Apply pending migrations from app startup code."* Skill: `prisma-next-migrations`.
  - **AC6f.** *"Wire this up with Next.js."* Skill: `prisma-next-build` (gap: no first-party Next.js plugin yet).

  Verified by running the journey test `journey-tests/03-capability-gaps.md`. Covers FR9, FR19b, NFR7.

- **AC7. Foreign-ORM trigger keywords fire the right skill.** Prompts that use vocabulary from competing ORMs match the correct PN skill:
  - **AC7a.** *"`prisma migrate dev` equivalent"* → `prisma-next-migrations`.
  - **AC7b.** *"How do I `introspect` an existing database?"* → `prisma-next-quickstart` (brownfield path).
  - **AC7c.** *"Use Drizzle-style query builder"* → `prisma-next-queries` (decision table).
  - **AC7d.** *"Add a `paranoid: true` flag"* → `prisma-next-contract` (capability-gap entry on soft delete).
  - **AC7e.** *"`db push`"* → `prisma-next-migrations` (decision table: `db update` is the equivalent).

  Each prompt verifies the matcher fires on the correct skill. Covers FR8.

- **AC8. Router skill catches vague prompts.** Prompts like *"help me with Prisma Next"*, *"I'm new to PN, where do I start?"*, *"explain Prisma Next"* match the `prisma-next` router skill. The router's body asks the user a disambiguating question (e.g. *"What do you want to do — add a model, run a migration, write a query, or debug an error?"*) and routes accordingly, including to `prisma-next-build` and `prisma-next-feedback` for the matching prompt shapes. Covers FR12.

- **AC8b. `prisma-next-build` covers the Vite plugin end-to-end.** An agent with the skill installed, given a fresh Vite + React project that has run `prisma-next init` (project-level skill installed), receives the prompt *"set up automatic contract emission during `vite dev`"* and:
  - Installs `@prisma-next/vite-plugin-contract-emit` as a devDependency.
  - Edits `vite.config.ts` to register `prismaVitePlugin('prisma-next.config.ts')`.
  - Starts `vite dev`, edits the contract source, and demonstrates that the contract artifacts regenerate without a manual `prisma-next contract emit` step.

  For the Next.js prompt — *"do the same in Next.js"* — the agent surfaces the *What PN doesn't do yet* entry (no first-party Next.js plugin yet), recommends the `prebuild` script workaround, and routes the user to `prisma-next-feedback` if they want the gap closed. Verified by running the journey test `journey-tests/05-build-vite.md` and `journey-tests/05b-build-nextjs-gap.md`. Covers FR18b.

- **AC8c. `prisma-next-feedback` produces a structured, public-safe issue body.** An agent with the skill installed, prompted with *"I want to report that `prisma-next migration plan` exits 0 even when the planner found no diff — that's surprising"*, walks the user through:
  - Classifying it as a bug report (not a feature request).
  - Producing a minimal reproduction against [`examples/prisma-next-demo`](../../../examples/prisma-next-demo/) (or the user's own project, with secrets redacted).
  - Capturing the Prisma Next version + Node version + package manager + OS.
  - Rendering the issue title and body in the structured shape from FR19b (*Summary / Steps to reproduce / Expected / Actual / Environment / Workaround*).
  - Surfacing the rendered body for user confirmation before submission.
  - Submitting via `gh issue create` if `gh` is installed, otherwise opening the prefilled new-issue URL.

  For the feature-request prompt — *"this is missing, can you file a feature request?"* originating from any `prisma-next-*` skill's capability-gap entry — the rendered body references back to the capability-gap entry that triggered the route, naming the source skill. Verified by running the journey test `journey-tests/06-feedback-bug.md` and `journey-tests/06b-feedback-feature.md`. Covers FR19b.

- **AC9. Monorepo / aggregate-contract reasoning.** An agent with the skill installed, given a checkout of [`examples/multi-extension-monorepo/`](../../../examples/multi-extension-monorepo/), receives the prompt *"add a `Post` model to the blog package"* and:
  - Reads the blog package's `prisma-next.config.ts` (not the root one).
  - Identifies which contract space the change belongs to.
  - Edits the right contract source.
  - Runs `prisma-next contract emit` from the blog package directory.
  - Does *not* modify any unrelated contract space.

  Verified by `journey-tests/04-aggregate-contract.md`. Covers FR20, the project spec's FR9.

- **AC10. PR-template Skill-update field is mandatory text.** `.github/PULL_REQUEST_TEMPLATE.md` carries the FR23 Skill-update field. PRs with the field left empty are flagged in review (the human check). Covers FR23.

- **AC11. Skill-coverage CI sub-check fails when expected.** Open a PR that touches `examples/` (triggering the upgrade-skill recipe-coverage check) but does *not* touch `packages/0-shared/agent-skill/`. PR CI fails with a structured error naming the expected directory. Adding a skill update to the PR makes CI pass. Covers FR24.

- **AC12. `pnpm lint:deps` accepts the new package.** `packages/0-shared/agent-skill/` carries an `architecture.config.json` entry of `framework` / `tooling` / `shared`. `pnpm lint:deps` passes after the package is added. Covers FR26.

- **AC13. Journey tests directory exists.** `packages/0-shared/agent-skill/journey-tests/` contains one Markdown checklist per AC4 – AC9 journey. Each file names the prompt, the example app, and the expected end-state. The tests are not automated; each file is human-runnable and produces a pass/fail verdict. Covers FR27.

- **AC14. Glossary alignment.** A sample of skill prose (one passage per skill, taken at random by the reviewer) uses the user-facing terms from `docs/glossary.md`. Code samples may retain internal names (`extensionPacks:`, `lane`) where the glossary tracker shows the rename is pending. Covers FR11.

- **AC15. Capability-gap entries are present and route to `prisma-next-feedback`.** Every skill body whose FR specifies capability-gap entries (FR14, FR15, FR17, FR18, FR18b, FR19) has a *What Prisma Next doesn't do yet* section listing at least the entries from that FR. Each entry follows the FR9 format: feature name, one-line workaround, route to the `prisma-next-feedback` skill (replacing what would otherwise be a bare URL). Covers FR9, FR19b.

# Other Considerations

## Security

- **Read-only content.** The skill artifact is Markdown plus reference material. Nothing in the skill set executes on installation or on agent activation. Trust model is the same as installing any npm package — by installing the skill, the user (or their agent) trusts the Prisma Next publish pipeline. The package is published with npm provenance attestations (inheriting `publish.yml`'s `NPM_CONFIG_PROVENANCE: "true"`), so consumers can verify provenance.
- **Prompt-injection surface.** The skill bodies are pure agent instructions read by the agent runtime. They are not interpreted as code. Prompt-injection risk is bounded to whatever surface area the agent runtime applies to skill content; PN does not add to that surface area.
- **No secrets in the skill.** The skill must not reference credentials, tokens, or environment variables that would assume specific values. Where the skill instructs the agent to reach for a connection string, it names the standard env var (`DATABASE_URL`) and the canonical `--db` flag; it does not embed secrets.

## Cost

- **Distribution.** Trivial. The whole package is a few hundred KB of text per release.
- **Authoring cost.** The largest authoring effort in the project. Estimated 2–3 weeks of agent-and-human iteration to land all eight skills at acceptance-quality, including journey-test runs against multiple example apps. The cost is front-loaded; subsequent maintenance is driven by the content-rotation policy and is expected to be incremental.
- **CI cost.** The skill-coverage sub-check (FR24) extends an existing CI step; marginal cost is the additional `git diff` query and the directory-existence check. Sub-second per PR.
- **Per-consumer runtime cost.** At install time, `npx skills add` writes the skill files to the consumer's skills-discovery path. At runtime, the agent loads `SKILL.md` bodies on matcher fire; cost is dominated by the agent's own context-window economics, which the skill's FR4 size budget bounds.

## Observability

- **Skill-firing observability.** Whether the skill fired, which skill fired, and which references the agent loaded is observable only via the agent runtime's own telemetry (Claude / Cursor / partner-hosted runtimes). The skill itself emits no telemetry.
- **Publish-pipeline observability.** Existing GitHub Actions logs cover the new workspace package picked up by `pnpm -r publish` and the extended `check:recipe-coverage` step. No new dashboards.

## Data Protection

- The skill processes no user data. It is read-only Markdown consumed in the agent's existing security context.

## Analytics

- Not applicable. Adoption analytics are the agent runtime's responsibility, not the skill's.

# References

- [`upgrade-skill.spec.md`](upgrade-skill.spec.md) — the upgrade-skill mechanism this spec depends on for the skill-coverage CI sub-check.
- [`package-json-versioning.spec.md`](package-json-versioning.spec.md) — the prerequisite for version-locked publishing.
- [`init-integration.spec.md`](init-integration.spec.md) — the task that wires `prisma-next init` to install this skill, removing the existing hand-rolled template.
- [TML-2514](https://linear.app/prisma-company/issue/TML-2514) — parent Linear ticket for the Prisma Next agent-skill project.
- [`docs/glossary.md`](../../../docs/glossary.md) — the canonical user-facing vocabulary the skill prose aligns to.
- [`docs/architecture docs/`](../../../docs/architecture%20docs/) — the durable architecture context the skill draws from.
- [`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`](../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md), `agent-skill-mongo.md` — the hand-rolled templates this spec's artifact replaces (removed by [`init-integration.spec.md`](init-integration.spec.md)).
- [`examples/multi-extension-monorepo/`](../../../examples/multi-extension-monorepo/) — the aggregate-contract substrate AC9 anchors against.
- [`packages/1-framework/3-tooling/cli/README.md`](../../../packages/1-framework/3-tooling/cli/README.md) — the CLI command surface the skills describe.
- [`packages/1-framework/3-tooling/vite-plugin-contract-emit/README.md`](../../../packages/1-framework/3-tooling/vite-plugin-contract-emit/README.md) — the canonical surface the `prisma-next-build` skill teaches.
- [`https://github.com/prisma/prisma-next/issues/new/choose`](https://github.com/prisma/prisma-next/issues/new/choose) — the canonical submission surface the `prisma-next-feedback` skill points at.
- [`docs/architecture docs/adrs/ADR 212 - Contract spaces.md`](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) — the durable doc the contract skill links to for aggregate-contract reasoning.
- [`get-convex/agent-skills`](https://github.com/get-convex/agent-skills) — the upstream Markdown skeleton this spec adopts.
- [`projects/prisma-next-agent-skill/references/`](../references/) — competitive-survey notes (Drizzle, Sequelize, TypeORM, Kysely, Active Record, Convex, Supabase, Vercel) consulted during shaping.

# Open Questions

The substantive design questions were resolved during shaping (see [Decisions resolved during refinement](#decisions-resolved-during-refinement) below). Two residual implementer choices remain:

1. **Cross-spec wiring for the skill-coverage sub-check.** FR24 extends the `check:recipe-coverage` CI step from [`upgrade-skill.spec.md`](upgrade-skill.spec.md) with a third sub-check. The implementer decides whether to:
   - Amend [`upgrade-skill.spec.md`](upgrade-skill.spec.md) to embed the third sub-check directly (cleaner if the implementer of the upgrade-skill mechanism is the same as the implementer of this spec).
   - Keep this spec's FR24 as a follow-up amendment to the existing step (cleaner if the upgrade-skill mechanism has already shipped and this is a follow-on PR).
   - Implement as a small, separately-named step (`check:skill-coverage`) that runs alongside `check:recipe-coverage` and shares the same trigger logic.

   **Default:** integrate into the existing step (option 1 or 2 above) rather than creating a parallel step. The trigger logic is identical and a parallel step duplicates the diff query for no benefit. The amendment-vs-direct-edit choice depends on landing order; either works.

2. **Journey-test runner conventions.** FR27 names the directory but does not pin a runner. Implementer choices:
   - Pure Markdown checklists (no runner; reviewer runs them by hand against a checked-out agent runtime).
   - Lightweight shell scripts that invoke the agent runtime's CLI with a fixed prompt and assert on the resulting filesystem state.
   - The Anthropic `skill-creator` tool (which Convex's contributing notes recommend) for a more rigorous loop.

   **Default:** Markdown checklists for the initial implementation; revisit if checklist runs prove insufficient. Automating agent behaviour against a moving model surface is its own project and is deferred from this spec.

## Decisions resolved during refinement

- **One package, ten skills.** Verified the multi-skill-per-package pattern against Convex (6 skills), Vercel (6 skills), and Supabase (5 skills). The package-shape constraint does not bound skill count; the SKILL.md size budget does.
- **Convex SKILL.md skeleton, adopted wholesale.** Validated against six published Convex skills (53–377 lines each). Rejected alternatives: Supabase's lighter shape (no Checklist / Common Pitfalls — leaves too much to the agent's judgement), Vercel's more verbose shape (too long per skill for our budget).
- **Ten-skill cluster.** Started at eight (router + adoption / contract / migrations / migration-review / queries / runtime / debug). Build-system / dev-server integration was originally folded into `runtime`, but the surface is distinct enough (Vite plugin install, dev-server lifecycle, error overlay, the no-emit dev loop) and is the focal point for new partner integrations (Next.js plugin next), so it gets its own `prisma-next-build` skill. Bug reports and feature requests were originally a one-line URL appended to every capability-gap entry, but every other skill in the cluster needs to terminate its "what PN doesn't do yet" routing somewhere, and a dedicated `prisma-next-feedback` skill (a) walks the agent through producing a structured, public-safe issue body the framework team can act on and (b) makes "this is a bug" / "this should be a feature" prompts directly matchable. Both new skills are small (~80–150 lines target). Rejected alternatives: keeping build-system content inside `runtime` (fragments the runtime workflow and obscures the partner-integration story), keeping feedback as a bare URL per capability-gap entry (the URL is unconfirmable from the skill, and the framework team gets unstructured reports the gap-entry doesn't shape).
- **Brand-prefixed skill names.** `prisma-next-<X>` for every skill so the matcher does not collide with other ORMs' skills installed in the same agent runtime. Rejected alternative: bare names like `migrations`, `queries` — too generic; risk of false matches against unrelated installed skills.
- **Canonical mental-model preamble.** *Edit your data contract. Prisma handles the rest.* — the single sentence the agent chains back to. Rejected alternatives: a longer preamble (clutters every skill), no shared preamble (loses the unifying frame the agent benefits from carrying across skill activations).
- **"What Prisma Next doesn't do yet" pattern.** Honest about gaps; lists the workaround and the feature-request URL. Rejected alternative: silent omission of unbuilt features — the dominant failure mode without explicit acknowledgement is the agent confabulating API surfaces that look right but don't exist.
- **Foreign-ORM trigger keywords in descriptions.** The matcher must fire on what the user types, not on what the framework calls things. *Validations*, *prisma migrate dev*, *prisma studio*, *db push*, *introspect* all appear in PN skill descriptions even though the skill's *answer* may be a capability-gap entry. Rejected alternative: PN-only vocabulary — leaves cross-ORM users with no skill firing at all.
- **Glossary as source of truth, not per-source-ORM reference files.** Extending `docs/glossary.md` as cross-ORM vocabulary gaps surface is cheaper to maintain than per-source-ORM `references/from-X.md` files. Rejected alternative: bundle a `from-drizzle.md` etc. with every relevant skill — explodes the package, encourages migrate-from content to leak into the always-on usage skill.
- **Migrate-from-X out of scope.** Migrating from a competitor is a substantial topic per source ORM, with content irrelevant to the always-on usage skill. Each migration is a candidate for a separately-installable skill in its own future project. Rejected alternative: bundle migrate-from content with the relevant usage skills — explodes the package, fires the wrong skill on first contact for migrating users.
- **Single skill set across targets and monorepo shapes.** Target-keyed and contract-space-keyed branches live *inside* skill bodies, not in separate skill packages per target/shape. Rejected alternative: `@prisma-next/agent-skill-postgres` vs `-mongo` — fragments the install surface, and the user mental model is "I'm using Prisma Next" not "I'm using PN Postgres."
- **No dedicated bootstrap skill, but a router skill.** `prisma-next init` is the entry point; the agent's first prompt after `init` fires a specific workflow skill, not a bootstrap skill. The router skill exists for *vague* prompts after the user is past first-contact (e.g. *"help me with PN"*). Rejected alternative: a dedicated bootstrap skill — no agent-activation moment for it to occupy.
- **Bad/good code pairs as the dominant teaching device.** Convex's empirical result; denser and more directly actionable than prose. Adopted wholesale.
- **Content-rotation policy: co-location + PR-template item; defer the rest.** Minimum-viable policy for the 0.x phase. Reverse-CODEOWNERS, scheduled freshness rotation, CI-fingerprinting, and journey-tests-in-CI are deferred until the 0.x churn slows. The PR-template item is human-checked, not CI-enforced; the skill-coverage CI sub-check (FR24) is the only mechanical enforcement.
- **Validation by dogfood, not by unit tests.** Skill effectiveness is observed agent behaviour. Automated assertions against agent behaviour are deferred.
- **Source location at `packages/0-shared/agent-skill/`.** Aligns with the upgrade-skill packages. `architecture.config.json` classification: `framework` / `tooling` / `shared`.
- **Description length budget — 25–35 words.** Empirical from the surveyed skill packages; longer descriptions stop being well-indexed by the matcher.
- **`SKILL.md` size budget — 350-line target, 500-line ceiling.** Convex's range (53–377 lines) sets the empirical bar. The router skill is exempted from the lower bound by design.
