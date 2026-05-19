# Drive — methodology and skill set

Long-lived methodology for the Drive workflow used in prisma-next: a Kanban-shaped lifecycle around Agile-style triage, sizing, brief discipline, DoR/DoD, retros, and project-context memory.

These docs migrated from the `drive-domain-model` shaping project (close-out: PR #522). The shaping artefacts (spec, plan, design-decisions log) were transient and were deleted at close-out; what survives here is the methodology itself.

## Reading guide

**Start here** if you're new to Drive:

- [`problem-statement.md`](./problem-statement.md) — what Drive is trying to solve and why (self-contained, externally shareable).
- [`model.md`](./model.md) — the pinned domain model: units (Direct change / Slice / Project / Dispatch), workflows, invariants.
- [`workflow.md`](./workflow.md) — the operational lifecycle map: which skill plugs into which phase.

**Then read** the principles that the workflow embodies:

- [`principles/protocol-as-memory.md`](./principles/protocol-as-memory.md) — why agent teams need rituals.
- [`principles/decomposition-and-cost.md`](./principles/decomposition-and-cost.md) — smaller dispatches enable cheaper tiers and tighter loops.
- [`principles/gradual-ai-adoption.md`](./principles/gradual-ai-adoption.md) — the spectrum from human-driven to fully delegated.
- [`principles/roles-and-personas.md`](./principles/roles-and-personas.md) — the human / agent / agile-orchestrator split.
- [`principles/brief-discipline.md`](./principles/brief-discipline.md) — how a dispatch brief is assembled.
- [`principles/definition-of-ready.md`](./principles/definition-of-ready.md) — DoR at project / slice / dispatch.
- [`principles/definition-of-done.md`](./principles/definition-of-done.md) — DoD at project / slice / dispatch.
- [`principles/retro.md`](./principles/retro.md) — trigger-based retros + invariant I10.
- [`principles/spikes.md`](./principles/spikes.md) — time-boxed investigations with artefact output.

**Skill conventions:**

- [`skill-conventions.md`](./skill-conventions.md) — the two-tier (workflow + atomic) skill architecture, naming rules (D28: `drive-<verb>-<noun>`), and the per-skill restructure that produced today's `skills-contrib/drive-*` set.

**Worked example (project context, not long-lived docs):**

prisma-next's own calibration — reference tasks for t-shirt sizing, DoR/DoD overlays, failure-mode catalogue, grep library, model-tier routing — lives where each skill loads it: in [`drive/<category>/README.md`](../../drive/) at the repo root. The calibration *content* is project-specific by definition; only the conventions that govern it (in `principles/`) are long-lived. See the [drive/ README](../../drive/README.md) for the category map.

**Trial period:**

- [`trial.md`](./trial.md) — the 2026-05-19 → 2026-06-02 trial that validates this methodology in real use before the canonical bodies upstream to [`prisma/ignite`](https://github.com/prisma/ignite). Synthesis ticket: [TML-2567](https://linear.app/prisma-company/issue/TML-2567/drive-trial-synthesise-findings-and-prepare-upstream-pr-to-ignite).

## The skill set

The canonical drive-* skill bodies live in [`skills-contrib/`](../../skills-contrib/) (this repo). Each `drive-*/SKILL.md` is the source of truth for its skill; they're built locally, validated through the trial, and the consolidated set will be upstreamed to ignite once the trial completes.

Project-specific overlays for each skill family live in [`drive/<category>/`](../../drive/) at the repo root, per the [project-context convention](https://github.com/prisma/ignite/pull/93). Each `drive/<category>/README.md` carries prisma-next's overrides + extensions to the canonical skill; `drive/<category>/findings.md` carries the trial-period observations.

## Status

- **Methodology:** stable; foundational docs in this directory are the canonical reference until the upstream PR to ignite supersedes them.
- **Skill set:** stable for the trial; expect skill bodies to evolve in `skills-contrib/` as the trial surfaces findings.
- **Upstream:** deferred to TML-2567 (single comprehensive PR after the trial completes).
