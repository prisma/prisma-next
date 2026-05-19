# Principle: The protocol is the team's memory

## Where memory lives in a repo

Two places. One you share with everyone else using Drive; one is just for your team.

```
your-repo/
├── drive/                                ← your team's notes (this repo only)
│   ├── spec/README.md                    ← read by drive-specify-slice
│   ├── plan/README.md                    ← read by drive-plan-slice + drive-build-workflow
│   ├── qa/README.md                      ← read by drive-qa-plan + drive-qa-run
│   ├── code-review/README.md             ← read by drive-review-code
│   ├── pr/README.md                      ← read by drive-pr-description + drive-pr-walkthrough
│   ├── project/README.md                 ← read by drive-create-project + drive-close-project
│   ├── deployment/README.md              ← read by drive-create-deployment-plan
│   ├── post-update/README.md             ← read by drive-post-update
│   ├── triage/README.md                  ← read by drive-triage-work     (added by this project)
│   ├── retro/README.md                   ← read by drive-run-retro       (added by this project)
│   └── health/README.md                  ← read by drive-check-health    (added by this project)
└── .agents/skills/                       ← local copy of the shared playbook
    ├── drive-create-project/SKILL.md
    ├── drive-specify-slice/SKILL.md
    ├── drive-build-workflow/SKILL.md
    ├── drive-reconcile-skills/SKILL.md   ← the two meta-skills that keep
    ├── drive-update-skills/SKILL.md         the local copy in sync with canonical
    └── ...
```

The **shared playbook** lives upstream in [`prisma/ignite`](https://github.com/prisma/ignite). When you install skills (via the `skills` CLI), copies land in `your-repo/.agents/skills/`. The skill bodies describe *how* each ritual works — what a Definition of Ready is, what a brief looks like, what counts as Done. You don't edit these in your repo; you run `drive-update-skills` to pull updates.

**Your team's notes** live in `your-repo/drive/`. The first thing every drive-* skill does when it runs is read its matching `drive/<category>/README.md`. Inside that README, two kinds of content coexist: operational conventions (how this team integrates the skill with its tracker, branch naming, etc.) and calibration content (failure-mode entries, DoR / DoD overlays, grep patterns, sizing anchors). The layout is the team's choice — some teams keep both kinds of content inline per category; others centralise calibration under `drive/calibration/` and have each category README link out, so a cross-cutting failure mode lives in one place instead of being duplicated across category READMEs.

Both surfaces are **human-readable and human-runnable**, not just agent context loaders. A team member who hasn't invoked a single drive-* skill can read the team's project context directly to consult the failure-mode catalogue; they can read a canonical skill body to learn what shape a brief is supposed to have. This is what makes the gradual-AI-adoption spectrum walkable (see [`gradual-ai-adoption.md`](gradual-ai-adoption.md)) — humans participate in the protocol at any level, from "running everything by hand using the docs" to "letting `drive-build-workflow` pilot the loop."

## What goes where

**In the shared skill body** (which means: not edited in your repo, but proposed upstream to `prisma/ignite`):

- The shape of DoR, DoD, brief, retro, WIP inspection, design discussion.
- The invariants every team should honour (no L/XL dispatch, ≤ 5-min WIP cadence, intent-validation before slice close, no silent agent-side spec amendments).
- The workflows themselves (triage decision tree, slice execution loop, etc.).

**In your team's project context** (`drive/`, where your team's accumulated lessons live):

- Failure modes you've hit before. ("Dual-shape support relocated under a new name" — recurring trap in our IR.)
- Greps to watch for. (`rg "Object\.fromEntries\(" packages/2-sql/src` — programmatic equivalents of legacy shapes.)
- Reference tasks your team uses to anchor t-shirt sizes. ("An S is roughly a one-package fixture regen, like the per-codec column rename in TML-2103.")
- DoR / DoD items specific to your team. ("PR title must carry a Linear ticket prefix.")
- Manual-QA conventions. ("For any slice touching the demo, run `pnpm demo` and check the version banner.")
- Model-tier routing rules your team has worked out. ("Codemods over `**/test/**` → composer cheap-tier. API-design dispatches → Opus.")

The test: **would another team using these same skills want this rule?**

- Yes → propose it upstream to `prisma/ignite`.
- No → it's yours; put it in project context.

When in doubt, start in your project context. Promoting later (when you notice multiple teams writing the same thing) is cheap; pulling back a half-baked canonical change is not.

## "I just learned X — where do I put it?"

Where calibration content lands depends on the team's layout. The two common shapes:

- **Centralised calibration.** Calibration lives under `drive/calibration/` (one file per topic: `sizing.md`, `dor.md`, `dod.md`, `failure-modes.md`, `grep-library.md`, `model-tier.md`, `patterns.md`). Category READMEs hold operational conventions and link out to the relevant calibration files. Recommended when calibration grows enough that the same item informs multiple categories.
- **Per-category calibration.** Calibration lives inline in each `drive/<category>/README.md` alongside that category's operational conventions. Simpler for small or new teams.

The destinations table below assumes the centralised layout; for per-category layouts, substitute the matching `drive/<category>/README.md`.

| The lesson is about... | Where it lands (centralised layout) |
|---|---|
| A new edge case briefs of a particular shape should pre-name | `drive/calibration/failure-modes.md` |
| A grep gate to add to slice DoD | `drive/calibration/grep-library.md` |
| A new failure-mode catalogue entry | `drive/calibration/failure-modes.md` |
| A new reference task for sizing | `drive/calibration/sizing.md` |
| A model-tier routing rule | `drive/calibration/model-tier.md` |
| A new DoR / DoD item at any scope | `drive/calibration/dor.md` / `drive/calibration/dod.md` |
| A QA scenario your team keeps forgetting | `drive/calibration/patterns.md` (consumer audiences) or `drive/qa/README.md` (operational) |
| A PR-description convention | `drive/pr/README.md` (operational) |
| A code-review focus area | `drive/code-review/README.md` |
| A spec-template variation | `drive/spec/README.md` |
| A triage heuristic the team trusts | `drive/triage/README.md` |
| A general rule any Drive team should follow | Upstream PR to `prisma/ignite` |
| An architectural choice with consequences past this project | An ADR under `docs/architecture docs/adrs/` |

## Two skills keep the local copy in sync

You'll sometimes edit `.agents/skills/drive-*/SKILL.md` in your repo to patch behaviour quickly — that's normal. Two meta-skills clean up after that.

| Skill | What it does | When to run it |
|---|---|---|
| **`drive-reconcile-skills`** | Walks every `drive-*` skill in your `.agents/skills/`, diffs each against canonical. For each delta: if it looks team-specific, moves it into the matching `drive/<category>/README.md`; if it looks generally useful, writes it to an operator-scratch upstream-improvements file (untracked) for you to triage. Then replaces the local skill body with the canonical version. Idempotent. | When the local copy has drifted: new team member arrives, you've been patching, after a big upstream rewrite. |
| **`drive-update-skills`** | Pulls canonical updates without the reconciliation step. Safe when you trust there's no drift. | Most days. |

Both ship in [PR #93](https://github.com/prisma/ignite/pull/93). Together they're how lessons flow between your repo and canonical without anyone editing the local skill copy and forgetting.

## Why all this matters: agents don't remember anything

Human teams remember in five ways:

- **People stick around.** The dev who got burned by a pattern last sprint hesitates when they see it again.
- **People talk.** Hallway corrections, water-cooler context, "remember when we tried that?"
- **Apprenticeship.** Juniors absorb patterns from seniors without either party naming the lesson.
- **Familiarity accumulates.** Just being around the code teaches you where it breaks.
- **Rituals fill the gaps.** Standups, retros, planning — formalise the lessons that would otherwise drift.

Agents have **none of the first four**. Every dispatch is a fresh agent that has read only what's in front of it.

- No continuity — the agent that got burned by a pattern in dispatch N is not the agent that picks up dispatch N+1.
- No hallway conversations — agents don't reminisce.
- No apprenticeship — a senior agent can't tacitly transmit anything to a junior one.
- No codebase familiarity that builds up — each dispatch sees only the files it reads.

Rituals don't *supplement* an agent team's memory the way they do for a human team. **They are the entire memory.** Anything you don't write into a place the next agent will read does not exist for the next agent.

## What "a place the next agent will read" means

Surfaces, strongest to weakest:

| Surface | When the agent reads it | Strength |
|---|---|---|
| `.cursor/rules/` | Every interaction in this repo | Strongest — always loaded |
| `AGENTS.md` (root or workspace) | Every interaction in this repo | Strong — always loaded |
| `drive/<category>/README.md` | Every time the matching drive-* skill runs (workflow step 1) | Strong — loaded exactly when needed |
| `.agents/skills/<skill>/SKILL.md` | When that skill is relevant | Conditional |
| Canonical `drive-*` skill bodies in `prisma/ignite` | When that skill runs | Conditional, shared across teams |
| `docs/` | Only when something else links to it | Weak |
| `projects/<x>/` | Only during that project's lifetime, only by skills working inside it | Transient |
| Operator scratch (untracked working notes, draft files outside the tracked tree) | Not loaded by anything | None — this is scratch, not memory |

`drive/<category>/README.md` is the strongest landing surface for a lesson specific to one skill family. It's only weaker than the always-loaded surfaces, and stronger than `docs/` because something has to actively link to a doc for an agent to find it.

## Retros are the only thing that actually lands lessons

For human teams, retros are one of several learning mechanisms. For agent teams, retros are **the** mechanism — there isn't anything else.

A retro that doesn't end with one of these commits is a retro that didn't happen:

- A commit to your repo's `drive/<category>/README.md` (project-context update).
- A PR to `prisma/ignite` (canonical update).
- An ADR in `docs/architecture docs/adrs/` (architectural call).

If none of those land, the lesson lives only in the head of whoever was around at the time — that's an external observer's memory, not the team's. Next time the failure recurs, the lesson isn't there to prevent it.

The mechanics of retros (when they fire, what triggers count, the template) live in [`retro.md`](retro.md).

## Anti-patterns

1. **Editing the local skill copy and not running `drive-reconcile-skills`.** Patches accumulate; the team's lessons get trapped in stale local copies; canonical slowly diverges from what teams actually use. Reconcile periodically.
2. **Writing lessons into operator scratch or into a one-off PR description.** Nothing reads untracked scratch files; nothing re-reads old PR descriptions. The lesson exists in commit history but not in any surface that fires on the next dispatch. By the time someone hits the same failure, no agent on the path has any way to know.
3. **A long skill body crammed with every team's specifics.** A 10,000-word skill body is past what the orchestrator agent can usefully hold. Canonical bodies stay small; team-specific detail goes in `drive/<category>/README.md` and gets pulled in only when relevant.
4. **Editing entries in `drive/<category>/README.md` you previously wrote.** Add new entries as new entries — accretion, not editing. The team that hits the failure for the second time consults the existing entry rather than rediscovering it. Edit existing entries only to refine an inadequate mitigation, never to "clean up" the catalogue.
5. **Retros where someone says "we should add a check for that" and nobody adds it.** The lesson exists in the operator's head; the team doesn't have it. The retro isn't complete until the commit lands.
6. **Putting team-specific gates into the shared skill body.** Pollutes every other team's installation. Shared playbook stays generic; team-specific stuff goes in `drive/<category>/README.md`.

## Related principles

- **[`retro.md`](retro.md)** — the ritual that lands the lessons. Triggers and template.
- **[`gradual-ai-adoption.md`](gradual-ai-adoption.md)** — the memory surfaces are designed for both humans and agents; this is what makes the spectrum from "zero AI" to "full delegation" walkable.
- **[`brief-discipline.md`](brief-discipline.md)** — the brief draws from the team's failure-mode catalogue and grep library every time it's assembled.
- **[`definition-of-ready.md`](definition-of-ready.md)** + **[`definition-of-done.md`](definition-of-done.md)** — the templates carry the gate's shape; `drive/<category>/README.md` overlays carry the team-specific gate items.
- **`drive-reconcile-skills` + `drive-update-skills`** ([PR #93](https://github.com/prisma/ignite/pull/93)) — the meta-skills that keep canonical and your local copy in sync.
