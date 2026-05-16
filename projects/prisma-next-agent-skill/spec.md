# Summary

This project ships the agent-facing surface of Prisma Next: a set of installable agent skills that make Prisma Next *usable by agents at all*, plus the in-repo authoring infrastructure that keeps those skills accurate as Prisma Next evolves. Three published artifacts plus one prerequisite refactor: a **published usage skill** that teaches agents how to onboard to and operate Prisma Next end-to-end, a **published upgrade-skill mechanism** that lets agents perform Prisma Next version upgrades deterministically, a **`prisma-next init` integration** that installs the usage skill in every new project by default, and a **`package.json`-versioning refactor** that prerequisites the upgrade-skill mechanism by making the in-flight Prisma Next version readable from any branch's `package.json` instead of computed at publish time. The versioning refactor (task 1) **shipped** — its policy now lives canonically at [`docs/oss/versioning.md`](../../docs/oss/versioning.md). The upgrade-skill mechanism (task 2) is implementation-ready ([`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md)); the usage skill and the init integration are still being shaped.

# Context

## At a glance

The user experience of Prisma Next, in practice, is overwhelmingly **agent-mediated**. A developer using Prisma Next today is almost always pairing with an IDE agent, a CLI agent, or a partner-hosted agent (Supabase's, v0, Lovable). Without an agent skill, those agents have no idea Prisma Next exists, can't read a `contract.json`, can't tell apart `db.sql.from(...)` from a Drizzle query, and fall back to Prisma 7 patterns or fabricate code that fails contract validation. The skill *is* the agent's experience of Prisma Next.

The project produces four artifacts. Three are user-facing; one is the in-repo refactor that makes the upgrade-skill mechanism implementable.

| artifact | Audience | What it does | Status |
|---|---|---|---|
| **`package.json`-versioning refactor** | The Prisma Next team (and any agent authoring breaking-change PRs) | Replaces publish-time version computation with `package.json`-as-source-of-truth. After this lands, every branch's `package.json` advertises the current in-flight minor, and a deliberate version-bump PR is the only way to advance it. Prerequisite to the upgrade-skill mechanism (recipe-directory keying and the freeze rule both consume the new source-of-truth). | **Shipped** — canonical doc at [`docs/oss/versioning.md`](../../docs/oss/versioning.md) |
| **`@prisma-next/upgrade-skill`** + **`@prisma-next/extension-upgrade-skill`** + **`@prisma-next/extension-pin-check`** | Users; extension authors | Two deterministic, agent-executable recipe sets (one per audience) for each `(from-minor, to-minor)` Prisma Next transition, plus a small pin-check tool that enforces the exact-pin rule on extensions' `@prisma-next/*` peer-deps. The agent runs the recipes step-by-step, validates, and commits one transition per step — no manual outreach from the framework team. | **Implementation-ready** ([`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md)) |
| **`@prisma-next/agent-skill`** (working name) | Users (humans pairing with agents) | Onboards an agent to a fresh Prisma Next project (zero-friction first query) and powers everyday operations (schema edits, migrations, capability-gated features) without the agent re-deriving the API from scratch each time. | **Shaping** — task spec next |
| **`prisma-next init` integration** | Users (one-time, at project bootstrap) | `init` always installs `@prisma-next/agent-skill` at the project level (replacing the current hand-rolled template). User-level installation is opt-in. | **Shaping** — depends on the usage skill landing |

The versioning refactor and the upgrade-skill mechanism are paired: the refactor lands first, and the upgrade-skill mechanism builds on the refactored model. Both ship on this branch ([`tml-2514`](https://linear.app/prisma-company/issue/TML-2514)) — as two sequential commits, or as two PRs in series, at the implementer's discretion. The usage skill and the init integration ship on later branches off `main` after task-1 and task-2 merge.

A user-facing trace of the published artifacts working together:

```text
$ mkdir my-app && cd my-app
$ pnpm dlx prisma-next init
  ✓ Scaffolds prisma-next.config.ts, schema.psl, package.json
  ✓ Installs @prisma-next/agent-skill at project level

  $ open .

  user> "add a Profile model with a unique email and let me list profiles"
  agent> (reads .agents/skill/prisma-next/SKILL.md, navigates to schema-editing entry)
  agent> Edits schema.psl, runs `prisma-next emit`, types check
  agent> Authors a migration, runs it against the dev DB
  agent> Writes a list-profiles handler using db.sql.from(...).select(...)
  agent> Done. Runs the handler — green.

  (six weeks later, on the same project)

  user> "upgrade Prisma Next"
  agent> (firing @prisma-next/upgrade-skill description)
  agent> Detects current 0.6.1 → target 0.7.0. Applies 0.6 → 0.7 recipe.
  agent> pnpm typecheck && pnpm test → green. Commit staged.
```

The flow assumes nothing the agent couldn't learn elsewhere on the open web. The point is that none of the steps — model editing, migration, query authoring, version upgrade — require the user to switch contexts, paste documentation, or re-explain Prisma Next concepts to the agent. The skills make those steps mechanical.

## Problem

Three concrete problems motivate the project:

**1. Agents don't know Prisma Next exists.** Open any IDE agent, ask it to "add a user model to my app," and watch it default to Prisma 7's `prisma/schema.prisma` with `prisma generate` patterns — even in a Prisma Next project. The Prisma Next docs are accessible to the agent, but the agent has no reason to read them: it has a confident answer already. Without a skill in the agent's effective context, Prisma Next is invisible to the dominant developer interaction pattern of 2026. The contract-first workflow, the type-parameter pattern, the capability-gated features — none of it is reachable by the agent. This is Layer 1: agents need an explicit hand-off into Prisma Next territory or they never enter it.

**2. Even when agents know Prisma Next exists, daily operations are noisy.** Each non-trivial operation (a schema edit + migration; a contract-diff investigation; a capability mismatch debug; a write path that needs `returning()`) is currently a multi-turn conversation between the user and the agent — the user pastes Prisma Next docs, the agent fabricates a near-miss API call, the user corrects it, etc. The framework's *correctness* (the contract telling the truth about what's possible) is wasted if the agent has to learn it by trial-and-error against the type-checker. Layer 2 is where Prisma Next's contract-first posture pays off: the same correctness becomes mechanical execution because the agent reads the contract directly and acts on it.

**3. Prisma Next is on a weekly breaking-change cadence.** PN sits at `0.6.1` with breaking changes every minor release — the right velocity for a project converging its API surface in `0.x`. The cost today is manual outreach: every breaking change costs the team a round of chasing each user and each extension author, pasting fix scripts, hoping nothing regressed. That doesn't scale past the next handful of consumers; it doesn't scale at all once the framework reaches partner-hosted agent populations. The upgrade-skill mechanism — recipes that ship in lockstep with Prisma Next releases, validated by the change author on the in-repo substrate before merge — replaces that outreach with an artifact agents consume.

Underneath all three is a single bet: agents are the durable interaction layer Prisma Next is being built for. The skill artifacts are what make that bet operational — without them, Prisma Next is a framework that's hard for agents to use, and "hard for agents to use" in 2026 is most of the way to "hard to use."

## Approach

The project ships four artifacts. Three are user-facing skills with shared structural constraints; the fourth is the in-repo versioning refactor that makes the upgrade-skill mechanism implementable.

**Shared constraints (apply to all published skills).** All published skills are source-controlled inside the Prisma Next monorepo (under `packages/0-shared/`), published to npm via the existing `publish.yml` workflow, version-locked to Prisma Next (the skill version matches the PN release that publishes it), and installable via `npx skills add @prisma-next/<skill-name>`. The in-repo authoring surface for each skill lives in `.agents/skills/` so both Claude and Cursor agents can consult it. Skill content is organised for **organic exploration** — a small `SKILL.md` entry point that lets the agent navigate to deeper material on demand — not as a monolith loaded into the context window in one shot.

**Artifact 1 — `package.json`-versioning refactor.** Today, every publishable `package.json` on `main` carries the placeholder `0.0.1`; the actual version is computed at publish time by `scripts/determine-version.ts` against npm dist-tags. An agent authoring a PR on a topic branch can't tell what version their change will land at — the version isn't readable from repo state. This blocks the upgrade-skill mechanism (recipes need to be keyed to a version the PR author can see) and is awkward for any other tooling that wants to reason about the current version. The refactor moves the version source-of-truth into `package.json` itself, makes advancing the minor a deliberate version-bump PR pattern, and slims `determine-version.ts` to per-event publish-version construction only. **Shipped on this branch** — see [`docs/oss/versioning.md`](../../docs/oss/versioning.md) for the canonical model and the maintainer release procedure.

**Artifact 2 — `@prisma-next/upgrade-skill` + `@prisma-next/extension-upgrade-skill` + `@prisma-next/extension-pin-check` (the upgrade mechanism).** Two published skills (user-scoped and extension-author-scoped) plus a small pin-check tool, plus an in-repo recipe-authoring skill at `.agents/skills/record-recipe/`, plus a publish-pipeline gate that refuses to ship a Prisma Next release whose `examples/` or `packages/3-extensions/` diff isn't covered by a matching upgrade recipe. The change author writes a recipe alongside the breaking change and validates it by execution against the in-repo substrate before merge. A recipe-freeze rule (CI-enforced) prevents stale topic branches from modifying recipes for transitions that have already shipped. Extensions pin every `@prisma-next/*` peer-dep to a single exact version; the pin-check tool enforces this in extension CI and powers the user-skill's pre-flight extension-compatibility check. Multi-minor upgrades iterate one minor at a time (bump → install → recipe → validate → commit per step). Depends on artifact 1's version source-of-truth refactor. Spec is complete at [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md); this project spec defers all detail there.

**Artifact 3 — `@prisma-next/agent-skill` (the usage skill).** A published skill whose body covers Prisma Next end-to-end for the application developer: how to bootstrap, how to author a contract (PSL and TS), how to run migrations, how to author queries across DSL / ORM / TypedSQL / raw, how to read error envelopes, how to reason about `prisma-next.config.ts` (including monorepo configurations with multiple contract spaces), and how to debug a capability mismatch. The skill is the *Layer 1 + Layer 2* artifact: it closes the onboarding gap to zero (an agent dropped into a fresh project can produce a working query without bouncing to docs) and eliminates the daily-operation friction tax. Internal structure (single SKILL.md vs multi-skill repo, journey-organised internal docs, description-field tuning, monorepo reasoning) is deferred to the task spec, with one constraint settled here: content must be organised for organic exploration. This artifact's spec is the next conversation; this project spec does not pin it further.

**Artifact 4 — `prisma-next init` integration.** Today, `init` emits a hand-rolled skill template into the user's project. That template is fragmenting (`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`) and going stale relative to the framework. The integration replaces it: `init` always installs `@prisma-next/agent-skill` at the project level — delegating to `npx skills add @prisma-next/agent-skill` — instead of emitting a template. User-level installation is opt-in (a flag the user passes or accepts at prompt; a marker file prevents re-prompting on subsequent `init`s in the same user account). The hand-rolled template is removed when the published skill is feature-complete enough to replace it; until then, the integration is a pure-substitution refactor of `init`. Spec is deferred to a task spec after the usage skill's shape is settled.

### Sequencing and degrees of freedom

1. **Task 1 — `package.json`-versioning refactor.** **Shipped.** Every `package.json` on the workspace now advertises the current in-flight minor (`0.7.0`), and the publish workflow reads versions from `package.json` rather than computing them from npm dist-tags. The maintainer-facing release procedure is documented at [`docs/oss/versioning.md`](../../docs/oss/versioning.md), with the publish-PR skill at [`.agents/skills/publish-npm-version/SKILL.md`](../../.agents/skills/publish-npm-version/SKILL.md).

2. **Task 2 — upgrade-skill mechanism.** Implementation-ready ([`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md)). Lands second on this branch, consuming task 1's version source-of-truth for recipe-directory keying and the freeze rule. The mechanism lands recipe-free initially; its first practical use is rebasing PR #502 onto it, which produces the first `0.6 → 0.7` recipe.

3. **Task 3 — `@prisma-next/agent-skill` (the usage skill).** Spec next. Shape is open: bucket taxonomy (the earlier proposal was 8 buckets covering bootstrap, contract authoring, schema editing, migration authoring, query authoring across lanes, runtime configuration, capability handling, error / debugging), in-repo authoring layout, description-field tuning, monorepo reasoning (the skill must read `prisma-next.config.ts` to understand which contract space it's operating in, and handle multi-extension monorepos like [`examples/multi-extension-monorepo/`](../../examples/multi-extension-monorepo/) where multiple packages each declare their own contract).

4. **Task 4 — `prisma-next init` integration.** Spec follows task 3. Until task 3 produces a usage skill rich enough to replace the hand-rolled template, task 4 is dormant. Once task 3's content covers the existing template's surface, task 4 is mostly a CLI delete + an `npx skills add` invocation.

The project's first PR is this branch ([`tml-2514`](https://linear.app/prisma-company/issue/TML-2514)) carrying tasks 1 and 2. Tasks 3 and 4 produce their own branches off `main` after tasks 1 and 2 merge.

# Requirements

## Functional Requirements

The project-level requirements describe what each task must produce. Detailed FR/NFR/AC enumerations live in the per-task specs.

### Task 1 — `package.json`-versioning refactor

- **FR1.** Task 1 has shipped. The canonical model and maintainer procedure live at [`docs/oss/versioning.md`](../../docs/oss/versioning.md); the workflow refactor lives in [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml). The transient task spec has been retired.
- **FR2.** Task 1 was a prerequisite to task 2 (recipe-directory keying and the freeze rule both consume the new source-of-truth). Task 2 can now proceed.

### Task 2 — upgrade-skill mechanism

- **FR3.** Task 2 is fully scoped by [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md). The project-level position is that task 2's spec is the contract; this document does not add or override requirements there.
- **FR4.** Task 2 lands on this branch ([`tml-2514`](https://linear.app/prisma-company/issue/TML-2514)) recipe-free, after task 1. The first recipe set lands when [PR #502](https://github.com/prisma/prisma-next/pull/502) is rebased onto the mechanism, producing the canonical `0.6 → 0.7` worked example.

### Task 3 — `@prisma-next/agent-skill` (the usage skill)

- **FR5.** A published skill installable via `npx skills add @prisma-next/agent-skill` (final package name decided in the task spec), version-locked to Prisma Next via the same `pnpm -r publish` step tasks 1 and 2 establish.
- **FR6.** The skill closes the **Layer 1 — onboarding-to-zero** gap: an agent that has the skill installed can take a fresh Prisma Next project (a checkout of `pnpm dlx prisma-next init`'s output) and produce a working first query against the dev DB without consulting external docs or asking the user for Prisma-Next-specific context. Coverage is measured by an in-repo journey test the task spec will define.
- **FR7.** The skill closes the **Layer 2 — daily-friction-to-zero** gap: schema editing, migration authoring, contract-diff handling, query authoring across all four lanes (DSL, ORM, TypedSQL, raw), capability-gated features (`includeMany`, `returning()`), error envelope reading, and runtime configuration are each delegable to the agent based on user intent — without the user pasting documentation or correcting the agent through trial-and-error.
- **FR8.** The skill is structured for **organic exploration**: a small `SKILL.md` entry point names the available sub-topics; deeper content lives in referenced files the agent loads on demand. Total skill content target: <8KB for the entry point; sub-topic files sized for selective loading. The exact taxonomy is the task spec's call; the constraint here is the navigation pattern.
- **FR9.** The skill reasons about `prisma-next.config.ts` to ground its responses in the user's project. Specifically:
  - In a single-contract project, it reads the config to determine target (postgres, mongo, future), extension packs in use, and contract emission paths.
  - In a multi-contract / monorepo project (e.g. the shape of [`examples/multi-extension-monorepo/`](../../examples/multi-extension-monorepo/) where each package declares its own contract), it understands the aggregate-contract-spaces model and orients its work to the contract space the user is editing.
- **FR10.** The skill participates in the upgrade-recipe discipline task 2 establishes: when an agent invokes both skills in the same upgrade flow, the usage skill does not duplicate or override the upgrade skill's recipes. Each skill has its own clean firing surface.

### Task 4 — `prisma-next init` integration

- **FR11.** `prisma-next init` always installs `@prisma-next/agent-skill` at the project level. The current hand-rolled template ([`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`](../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md)) is removed.
- **FR12.** The install is **always project-level** — there is no host-wide / global install path from `init`. The skill cluster's surface tracks the project's Prisma Next version, and a global install would have to pick a single version for every project on the host, which breaks the version-locking invariant `NFR2` establishes. Earlier drafts of this spec required a `--install-user-skill` flag and an XDG marker file for prompt suppression; that surface is gone. See [`specs/init-integration.spec.md`](specs/init-integration.spec.md) for the full rationale.
- **FR13.** `init` is target-aware: when scaffolding a Mongo project (current or future), it installs the same `@prisma-next/agent-skill` — the skill is responsible for target-keyed content internally, not the CLI. (This pins the design that the usage skill is one published artifact, not one per target.)

## Non-Functional Requirements

- **NFR1. Source co-location.** Every published skill is source-controlled in this monorepo and ships through the existing `publish.yml` workflow. No separate skill-source repo or out-of-band publish channel.
- **NFR2. Version-locked.** Every published skill ships at the same version as the Prisma Next release that publishes it. Consumers at PN `0.7.x` get the `0.7.x`-tagged skill set; the framework cannot ship without the skills, and the skills cannot ship without the framework.
- **NFR3. Organic-exploration shape.** Each published skill's `SKILL.md` entry point fits in well under 8KB. Deeper content lives in referenced files the agent loads on demand. This is non-negotiable across all skills the project ships.
- **NFR4. Agent-tool-agnostic in-repo authoring.** In-repo authoring skills (e.g. `.agents/skills/record-recipe/` from task 1, plus any authoring skills task 2 introduces) live under `.agents/skills/` so both Claude and Cursor read them. No `.cursor/rules/` or `.claude/skills/` mirrors.
- **NFR5. No backward-compat shims.** The current hand-rolled `agent-skill-postgres.md` template is removed by task 3, not kept as a fallback. The `pnpm-lock.yaml` / `package.json` shapes of in-flight projects continue to work without re-templating because the published skill replaces the same surface.

## Non-goals

- **Partner-specific skills (`@prisma-next/agent-skill-supabase`, etc.) are out of scope for this project.** Task 2's skill covers Prisma Next end-to-end; partner-specific integrations (and the corresponding extension packages) ship in their own projects (e.g. [`projects/extension-supabase/`](../extension-supabase/spec.md)). The usage skill *recognises* and orients itself to partner extensions present in `prisma-next.config.ts` but does not bundle partner-specific content. Partner-extension-specific skills are tracked separately.
- **Demo content (recorded videos, landing-page material, partner-pitch artifacts).** The skills make the demo content *possible*; producing the content itself is a separate effort outside this project.
- **A "skill quality" scoring framework.** Skill effectiveness is measured by acceptance criteria — does the agent complete the journey, does the upgrade recipe run green — not by a numeric quality metric.
- **Backfilling pre-0.6 recipes for the upgrade-skill mechanism.** Per [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md), the registries start at `0.6 → 0.7`. Pre-0.6 consumers are pointed at GitHub Release notes for hand-migration.
- **Cross-agent-runtime testing harness.** The skills are written for the major agent runtimes (Claude, Cursor, the agent layers Supabase / v0 / Lovable expose). Verification is by manual walkthrough plus the in-repo journey test FR4 names. A cross-runtime automated harness is out of scope; cost-benefit isn't there until the skills are shipping into multiple runtimes in production.

# Acceptance Criteria

- [x] **AC1.** Task 1 shipped. Every publishable `package.json` on the branch advertises the current in-flight minor (`0.7.0`), `publish.yml` reads from `package.json`, and the maintainer release procedure is documented at [`docs/oss/versioning.md`](../../docs/oss/versioning.md).
- [ ] **AC2.** Task 2's acceptance criteria (AC1–AC18 in [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md)) are met. The first recipe lands when PR #502 is rebased onto the mechanism; the next stable release exercises the publish gate end-to-end.
- [ ] **AC3.** `@prisma-next/agent-skill` is published to npm at the same version as the Prisma Next release that introduces it, installable via `npx skills add @prisma-next/agent-skill`. Covers FR5, NFR1, NFR2.
- [ ] **AC4.** An agent with `@prisma-next/agent-skill` installed, dropped into a freshly-scaffolded Prisma Next project (a checkout of `pnpm dlx prisma-next init`'s output, no other context), produces a working first query against the dev DB on the first attempt — measured by the journey test the task spec defines. Covers FR6 (Layer 1).
- [ ] **AC5.** An agent with the skill installed completes each Layer-2 operation (schema edit, migration authoring, contract-diff handling, query authoring across all four lanes, capability-gated features, error envelope reading) without the user pasting external docs and without trial-and-error against the type-checker. Measured by per-operation journey tests the task spec defines. Covers FR7.
- [ ] **AC6.** The skill's `SKILL.md` entry point is under 8KB and references sub-topic files by path; the agent's tool-call log for AC4 shows it loaded only the entry point plus the sub-topics relevant to the active journey. Covers FR8, NFR3.
- [ ] **AC7.** An agent with the skill installed, given a checkout of [`examples/multi-extension-monorepo/`](../../examples/multi-extension-monorepo/), reasons correctly about which package's contract a requested change belongs to and operates against the right contract space. Covers FR9.
- [ ] **AC8.** `prisma-next init` (run inside a fresh directory) installs `@prisma-next/agent-skill` at the project level alongside the rest of the scaffold. The existing hand-rolled template file is removed from the CLI sources. Covers FR11.
- [ ] **AC9.** `prisma-next init` never installs `@prisma-next/agent-skill` at the user/global level — neither by flag nor by prompt. The CLI's flag surface contains no `--install-user-skill` and no `-g` mode for this package; the `init` command, in any mode, only ever runs the project-level invocation. Covers FR12.
- [ ] **AC10.** `prisma-next init` against a Mongo target installs the same `@prisma-next/agent-skill` (no separate package per target). The skill itself handles target-keyed content internally. Covers FR13.

# Other Considerations

## Security

The published skills are agent-instruction content, not executable code on the user's behalf. They run in the agent's existing security context. The trust model is the same as any npm package: by installing one of these skills, the user (or their agent on their behalf) trusts the Prisma Next publish pipeline. All skill packages are published with npm provenance attestations (inheriting the existing `publish.yml`'s `NPM_CONFIG_PROVENANCE: "true"`), so consumers can verify each skill came from the Prisma Next GitHub release pipeline.

Detailed security treatment for the upgrade-skill recipes (recipe-script trust, the no-network constraint) lives in [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md).

## Cost

- **Distribution.** Trivial. Each skill is a few hundred KB of text per release; even the larger usage skill is rounding-error against npm storage cost.
- **Authoring cost.** The usage skill (task 2) is the largest authoring effort in the project — production-quality content covering Prisma Next end-to-end. Estimated 1–2 weeks of authoring effort plus iteration after first agent walkthroughs surface gaps.
- **CI cost.** The publish-gate check task 1 introduces runs in seconds. Journey tests for the usage skill (AC3, AC4, AC6) run as part of CI; cost is bounded by the existing `pnpm test:examples` substrate.

## Observability

- **Recipe-application telemetry.** Out of scope for v1 — same call as in [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md).
- **Skill-firing observability.** Whether a partner-hosted agent fired the skill (and which sub-topic it loaded) is observable only via the agent runtime's own telemetry, not via anything the skill itself emits. The skills do not phone home.
- **Publish-pipeline observability.** Existing GitHub Actions logs cover the new publish-gate step and the additional workspace packages picked up by `pnpm -r publish`. No new dashboards.

## Data Protection

The skills do not store or transmit user data. The upgrade-skill recipes are deterministic filesystem transformations of the user's own project (no network, no external input — see [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md) NFR7). The usage skill is read-only instructions consumed by the agent in the user's existing security context.

## Analytics

Not applicable. The skills are content artifacts; analytics about how partners or users adopt them are the consuming runtime's responsibility, not this project's.

# References

- [TML-2514](https://linear.app/prisma-company/issue/TML-2514) — parent Linear ticket for this project.
- [TML-2515](https://linear.app/prisma-company/issue/TML-2515) — placeholder ticket for the upgrade-skill / backwards-compatibility policy task 1 produces.
- [PR #502 — drop inlined fromContract/toContract from migration.json](https://github.com/prisma/prisma-next/pull/502) — the canonical worked example task 1 ships its first recipe against.
- [`docs/oss/versioning.md`](../../docs/oss/versioning.md) — canonical versioning policy and release procedure (task 1 close-out target).
- [`specs/upgrade-skill.spec.md`](specs/upgrade-skill.spec.md) — task 2's full spec, ready for implementation.
- [`references/`](references/) — downloaded reference skills (Supabase, Vercel, Convex, TanStack) studied for pattern conventions during shaping. Not authoritative; consult during task-2 spec authoring as needed.
- [`packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md`](../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill-postgres.md) — the current hand-rolled template task 3 replaces.
- [`examples/multi-extension-monorepo/`](../../examples/multi-extension-monorepo/) — the multi-contract-space substrate FR7 / AC6 anchor the skill's monorepo reasoning against.
- [`docs/architecture docs/`](../../docs/architecture%20docs/) — durable architecture context the usage skill draws from for its own content.

# Open Questions

The substantive questions for tasks 1 and 2 are resolved in their respective specs. The residual questions for tasks 3 and 4 — to be resolved when each task's spec is drafted, not in this project spec — are:

1. **Task 3 — bucket taxonomy.** The earlier shaping conversation proposed an 8-bucket structure (bootstrap; contract authoring; schema editing; migration authoring; query authoring across lanes; runtime configuration; capability handling; error / debugging). Whether the final structure is 8 buckets, more, fewer, or a different navigation entirely is a task-3-spec call. Default: start from the 8-bucket proposal; revise based on the journey tests' coverage shape.
2. **Task 3 — published package name.** `@prisma-next/agent-skill` is the working name. Alternatives: `@prisma-next/skill`, `@prisma-next/usage-skill`, or a single shorter `prisma-next` (unlikely to be available on npm; trade-off TBD). Default: `@prisma-next/agent-skill`. Resolved in the task-3 spec.
3. **Task 3 — content-rotation cost.** The usage skill ages out as Prisma Next evolves: new lanes, new capabilities, new error codes all need skill content. Task 2's upgrade-skill mechanism partly handles this (upgrade recipes update the project, including any usage-skill expectations), but the usage skill's *body* needs its own rotation discipline. Whether that's a CODEOWNERS expectation, a "skill review" PR-template item, or a separate authoring quality gate is a task-3 call.
4. **Task 4 — opt-out for `init --no-skill`.** Should `init` offer an opt-out for the project-level install, or is the install always-on with no escape hatch? The default is always-on (per NFR5: no backward-compat shims), but users running `init` in restricted environments (no npm registry access, air-gapped) may need an escape hatch. Default: always-on with a documented `--no-skill` flag for restricted environments; failure mode is a clear error, not a silent degradation. Resolved in the task-4 spec.
