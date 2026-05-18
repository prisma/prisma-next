# Principle: The Protocol Is the Team's Memory

## Thesis

Agent teams have no organic memory transmission between dispatches. Rituals (Definition of Ready, Definition of Done, WIP-inspection cadence, brief discipline, written failure-mode catalogues, design discussions, retros) are not supplements to memory the way they are for human teams — they ARE the memory. Every failure mode we don't write into the protocol re-happens.

## The asymmetry with human teams

Human teams learn from mistakes through several mechanisms, most of them organic:

- **Continuity of personnel.** The same developer who got burned by a pattern last sprint will hesitate when they see it again. The lesson lives in the person.
- **Shared experience as context.** "Remember when we tried that? It didn't work because…" — water-cooler context transmission, retro discussions, casual hallway corrections.
- **Apprenticeship.** Junior developers absorb patterns from senior developers without either party explicitly naming the lesson.
- **Repeated exposure to the codebase.** Just being around the code teaches you what tends to break.

Human-team rituals (standup, retro, planning, DoR, DoD) supplement these organic mechanisms. They formalise the lessons that would otherwise drift, but the bulk of the team's memory lives outside the rituals — in the heads of the people.

Agent teams have **none** of those organic mechanisms:

- **No continuity.** Each dispatch is a fresh agent that has read only what's in front of it. The agent that got burned by a pattern in dispatch N is not the agent that picks up dispatch N+1.
- **No shared experience.** Agents don't have hallway conversations. They don't talk to each other. They don't reminisce.
- **No apprenticeship.** A senior agent cannot tacitly transmit patterns to a junior agent. The transmission must be explicit and written.
- **No codebase familiarity that accumulates.** Each dispatch sees only the files it reads. It does not retain a model of the codebase across dispatches.

Every dispatch is a fresh team member onboarded from cold. The only context an agent has is what's written down where it will read it.

## Consequence: rituals carry all the memory

For agent teams, the rituals are not supplements — they are the entire memory store. Specifically:

- **Definition of Ready** is the team's accumulated wisdom about what makes a dispatch (or slice, or project) ready to start. Without it, every dispatch re-discovers the same scoping mistakes.
- **Definition of Done** is the team's accumulated wisdom about what makes a dispatch (or slice, or project) verified. Without it, every dispatch re-discovers the same verification gaps.
- **Brief discipline** (pre-naming edge cases with dispositions) is the team's accumulated wisdom about which traps lurk in this domain. Without it, every implementer re-falls into them.
- **Failure-mode catalogue** is the team's accumulated wisdom about what's gone wrong before. Without it, every recurrence feels novel.
- **Grep library** is the team's accumulated wisdom about which anti-patterns to search for. Without it, every drift detection starts from zero.
- **Design-decisions log** is the team's accumulated wisdom about which paths were considered and rejected. Without it, every design discussion re-litigates settled calls.

When a failure mode happens for the first time, the cost is unavoidable. When it happens for the second time, the cost is structural — it means the lesson from the first time didn't land in the protocol.

## The retro is the team's only learning mechanism

For human teams, retros are one of several mechanisms for learning. For agent teams, retros are **the** mechanism. If a retro doesn't produce a written protocol or calibration update, the team has not learned. The lesson exists only in the head of the human who happened to be in the loop that day, and that human is not the team — they are an external observer.

Every retro must answer: **does this require a protocol update (general), a calibration update (project-specific), or both?** If neither, the retro produced no learning.

Examples from today's reversal that produce updates:

- **General protocol update**: brief discipline must pre-name edge cases the implementer will be tempted to accommodate, with explicit dispositions.
- **Project calibration update (prisma-next)**: add "dual-shape support relocated under a new name" to the failure-mode catalogue; add `'columns' in` and `looksLike` to the grep library; add the corrected reversal as a worked example.

If we leave today's retro without those updates, the next implementer will hit the same trap and we will not have learned.

## Two homes for memory: canonical skill bodies and project-context READMEs

Drive's memory lives in two structurally separate homes. The separation is enforced by [PR #93](https://github.com/prisma/ignite/pull/93)'s project-context convention and the `drive-reconcile-skills` machinery that maintains it.

### Home 1: canonical skill bodies (portable methodology)

The shared methodology lives in canonical `drive-*` skill bodies in [`prisma/ignite`](https://github.com/prisma/ignite). Every team that runs Drive installs these skills via the `skills` CLI; every team gets the same body. The canonical body defines:

- The **shape** of each ritual (what DoR is, what DoD is, what brief discipline means, what the WIP-inspection cadence asks, what a design discussion produces, what a retro produces).
- The **invariants** every team must honour (no L/XL dispatch, WIP-inspection cadence ≤ 5 min, intent-validated reviewer verdicts, no silent agent-side amendments, etc.).
- The **gate patterns** that compose into project-specific gates.

Canonical bodies must stay free of any one team's specifics. A team-specific check baked into canonical pollutes every other team's installation; this is the failure mode the convention exists to prevent.

### Home 2: project-context category READMEs (team-specific protocol)

Per PR #93's convention, every consumer repo carries a `drive/` directory with one `README.md` per skill family. Drive-* skills read `drive/<category>/README.md` as **workflow step 1** — before doing any of the canonical methodology work. That makes the file a **strong memory surface**: every invocation of every drive-* skill in the consumer repo loads its category README, in time to apply the lesson.

The eight categories PR #93 ships (plus the ones the restructure adds):

| Category | Skills served | Typical content |
| --- | --- | --- |
| `spec` | `drive-project-specify`, `drive-slice-specify`, `drive-reverse-spec` | Spec template variations; required sections beyond canonical; project-specific stakeholders. |
| `project` | `drive-create-project`, `drive-close-project` | Project-tracking conventions (Linear board, project-file layout, archive location). |
| `plan` | `drive-project-plan`, `drive-slice-plan`, `drive-orchestrate-plan` | Plan-shape conventions; test-design table variations; parallelism rules; **brief discipline calibration (failure-mode catalogue, grep library, reference tasks, model-tier routing)** since brief assembly is part of slice-plan work. |
| `qa` | `drive-qa-plan`, `drive-qa-run` | Consumer audiences; substrate locations; known coverage-gate gaps; fixture catalogues. |
| `code-review` | `drive-review-code` | Project-specific anti-patterns; review focus areas; ownership map. |
| `pr` | `drive-pr-description`, `drive-pr-walkthrough` | PR template variations; label conventions; CI gate context. |
| `deployment` | `drive-create-deployment-plan` | Deploy targets; rollback procedures; feature-flag conventions. |
| `post-update` | `drive-post-update` | Update destinations (Linear, Slack); expected cadence and tone. |
| `triage` (added by this project's restructure) | `drive-triage-work` | Triage verdict heuristics; project-shape-gravity counter-patterns the team has learned; Linear promotion-pattern operator. |
| `retro` (added) | `drive-retro-run` | Trigger refinements; this team's retro-template variants; ADR-author lookup. |
| `health` (added) | `drive-health-check` | Per-project drift-alarm thresholds (the N in "after N consecutive dispatches without slice progress"); rollup recipients. |

The split is structural: **if you find yourself wanting to add a check, pattern, or gate to the centralized methodology that is specific to one team's work, stop — that belongs in `drive/<category>/README.md` in the consumer repo.** The exception is when the same pattern surfaces across multiple teams' READMEs (observed via canonical-side review of upstream-worthy items surfaced by `drive-reconcile-skills`); then it can graduate to the methodology.

Worked examples of where things land:

- A team requires every PR to link a Linear ticket → `drive/pr/README.md` (extends `drive-pr-description`'s expectations).
- A team requires a screenshot in every UI-changing PR → `drive/qa/README.md` (manual-QA script asks for it) OR `drive/pr/README.md` (PR description carries it).
- A team has discovered a recurring anti-pattern ("dual-shape support relocated under a new name") → `drive/plan/README.md`'s failure-mode catalogue + grep library section.
- A team's brief-discipline overlay wants the WIP-inspection cadence to ask an extra question ("are we still on the right model tier?") → `drive/plan/README.md` (since brief assembly + dispatch loop run under slice-plan).
- A team's QA needs to verify two consumer audiences → `drive/qa/README.md`.

### Memory-strength of the two homes

Both homes are loaded by the skill that needs them, in time to apply the lesson. They differ in update mechanism:

- **Canonical body update.** Upstream PR to `prisma/ignite`. Lands for every team on next `drive-update-skills` run. Subject to canonical review (cross-team applicability check).
- **Category README update.** Commit in the consumer repo. Lands for that team immediately. No cross-team review needed — it's their team-specific protocol.

The category README is the team's load-bearing memory surface. A team that runs Drive without writing its category READMEs has half a protocol — the canonical methodology without the project-specific anti-patterns the team has learned to avoid. The team re-falls into traps the READMEs would have caught.

## The reconciliation loop

The two homes are kept in sync by two PR #93 meta-skills:

- **`drive-reconcile-skills`** — one-shot migration for repos whose in-repo skill copies have drifted from canonical. For each installed drive-* skill it diffs in-repo vs canonical, auto-classifies each delta as either *project-specific* (extracts to the right `drive/<category>/README.md`) or *upstream-worthy* (writes to `wip/drive-upstream-improvements.md` for operator triage), then replaces the in-repo skill body with the canonical version. Idempotent.
- **`drive-update-skills`** — routine refresh; pulls canonical updates without the reconciliation classification (used when no drift is suspected).

The loop in operation:

1. A team running Drive picks up a lesson during a retro (or notices a drift during a dispatch).
2. The agile orchestrator classifies the lesson: protocol (cross-team) or project-context (team-specific)?
3. **Project-context lessons** land as a commit in the consumer repo's `drive/<category>/README.md`. Immediate effect — the next drive-* skill invocation reads the new content.
4. **Protocol lessons** land as an upstream PR to `prisma/ignite`. After merge, every team's next `drive-update-skills` run picks them up.
5. **Ambiguous lessons** the team patches in-repo (editing the local skill copy as a quick fix). The next time `drive-reconcile-skills` runs, the patch is auto-classified and routed to one of the two homes — the local edit doesn't survive, but the lesson does.

This loop is what makes the protocol-as-memory principle operational rather than aspirational. Without the reconciliation skills, in-repo drift compounds, lessons get trapped in stale local copies, and the canonical body slowly diverges from what teams actually use.

## Documents that are not memory

Documents agents do not read on dispatch are not memory. They are archaeology.

Concretely:

- Documents buried in places the orchestrator agent does not load on every dispatch (e.g. a buried `wip/` file, an old PR description, a Slack thread) are not memory.
- Documents that are too long for the orchestrator agent to absorb in its context window are partially-not-memory — only the portions actually loaded function as memory.
- Documents that contradict each other are anti-memory: the agent's "memory" becomes inconsistent.

For agent teams, **the home of a document determines whether it functions as memory**:

- `.cursor/rules/` (always loaded) → strongest memory
- Project / workspace `AGENTS.md` (always loaded) → strong memory
- `drive/<category>/README.md` (loaded by the matching drive-* skill as workflow step 1, on every invocation) → strong memory at the moment the skill needs it
- `.agents/skills/*/SKILL.md` (loaded on relevance) → conditional memory
- Canonical `drive-*` skill bodies in `prisma/ignite` (loaded when the skill runs) → conditional memory shared across teams
- `docs/` (loaded on reference) → weak memory (must be linked from a stronger surface)
- `projects/<x>/` (loaded only during that project's lifetime, by skills working inside that project) → transient memory
- `wip/` (not generally loaded) → no memory

`drive/<category>/README.md` is a deliberately strong surface because PR #93's convention guarantees it's loaded by the skill that needs it, every time. That's stronger than `docs/` (which is only weak memory unless something links to it) and weaker only than the always-loaded surfaces (`.cursor/rules/`, `AGENTS.md`). A lesson that belongs to a particular skill family should land in that family's README — it will function as memory exactly when needed.

The strongest place to land a lesson is the surface the agent reads first, every time. The weakest is a document the agent will only see if someone explicitly links to it from a place the agent already reads.

## Practical implications

1. **Every post-mortem produces an update in one of two homes.** Either a canonical body update (upstream PR to `prisma/ignite`) or a project-context update (commit to the consumer repo's `drive/<category>/README.md`). If neither updates, the post-mortem failed.
2. **Updates land in surfaces agents actually read.** Cross-team lessons graduate to the canonical skill body or to always-loaded rules (`.cursor/rules/`, `AGENTS.md`). Team-specific lessons land in the matching `drive/<category>/README.md` — the surface the relevant drive-* skill reads as workflow step 1.
3. **The canonical body stays small enough to be memorable.** A 10,000-word skill body is not memory because the orchestrator agent cannot hold it. The body must be designed for working-memory consumption: short principles + delegation to `drive/<category>/README.md` for team-specific detail.
4. **Category READMEs grow by accretion, not editing.** Failure-mode entries, grep patterns, and overlay items are appended as they happen; existing entries become historical context (the team that hits the failure mode for the second time consults the existing entry rather than re-discovering it). Edit existing entries only to refine an inadequate mitigation, never to "clean up" the catalogue.
5. **The orchestrator's job includes home selection.** Not just dispatching and inspecting — also routing each lesson to canonical vs project-context. A retro without a written update lands in *some* home is not a complete retro.
6. **Reconciliation is part of the team's hygiene.** When the team has been editing in-repo skill copies (the old pattern), `drive-reconcile-skills` runs auto-migrate the project-specific drift to `drive/<category>/README.md` and surface upstream-worthy improvements for operator triage. Reconciliation should run periodically and after any drift-prone change (a new team member, a major upstream skill rewrite).

## Failure mode this principle directly prevents

The recurring failure where a team-of-amnesiacs re-falls into the same trap each time because no agent remembers the trap and no document on the agent's path describes it. The fix is structural: write the lesson into a surface the agent reads, every dispatch, in time to apply it.

## Related principles

- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — why the protocol's "small dispatches" rule also enables cheaper agents.
- **[`spikes.md`](spikes.md)** — the only ritual that produces an output artefact instead of working code; the artefact IS memory for the dispatches that depend on it.
- [`brief-discipline.md`](brief-discipline.md) — Example Mapping in every dispatch brief; the brief itself is the running specification, drawing from the team's `drive/plan/README.md` failure-mode catalogue + grep library.
- [`retro.md`](retro.md) — the trigger-based learning ritual; the place where home selection (canonical vs `drive/<category>/README.md`) is operationalised; without it, the team has no learning mechanism.
- **`drive-reconcile-skills` + `drive-update-skills`** ([PR #93](https://github.com/prisma/ignite/pull/93)) — the meta-skills that maintain the loop between the two homes. Read their bodies if you want the per-delta classification rule for auto-routing project-specific facts to category READMEs.
