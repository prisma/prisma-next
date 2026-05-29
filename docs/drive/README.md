# Drive — methodology and skill set

Long-lived methodology for the Drive workflow used in prisma-next: a Kanban-shaped lifecycle around Agile-style triage, sizing, brief discipline, DoR/DoD, retros, and project-context memory.

## Reading guide

**Start here** if you're new to Drive:

- [`model.md`](./model.md) — the pinned domain model: units (Direct change / Slice / Project / Dispatch), workflows, invariants, the two-tier skill architecture.
- [`workflow.md`](./workflow.md) — the operational lifecycle map: which skill plugs into which phase.
- [`measurement-model.md`](./measurement-model.md) — how a Drive run is measured: the correctness gate, speed targets, and diagnostic families the `drive-record-traces` + `drive-diagnose-run` skills implement.

**Then read** the principles that the workflow embodies:

- [`principles/protocol-as-memory.md`](./principles/protocol-as-memory.md) — why agent teams need rituals.
- [`principles/sizing.md`](./principles/sizing.md) — size by logical coherence, not logistical footprint; INVEST at three altitudes.
- [`principles/decomposition-and-cost.md`](./principles/decomposition-and-cost.md) — smaller dispatches enable cheaper tiers and tighter loops.
- [`principles/gradual-ai-adoption.md`](./principles/gradual-ai-adoption.md) — the spectrum from human-driven to fully delegated.
- [`principles/roles-and-personas.md`](./principles/roles-and-personas.md) — the human / agent / agile-orchestrator split.
- [`principles/brief-discipline.md`](./principles/brief-discipline.md) — how a dispatch brief is assembled.
- [`principles/definition-of-ready.md`](./principles/definition-of-ready.md) — DoR at project / slice / dispatch.
- [`principles/definition-of-done.md`](./principles/definition-of-done.md) — DoD at project / slice / dispatch.
- [`principles/retro.md`](./principles/retro.md) — trigger-based retros + invariant I10.
- [`principles/spikes.md`](./principles/spikes.md) — time-boxed investigations with artefact output.

**Worked example (project context, not long-lived docs):**

prisma-next's own calibration — the per-altitude INVEST rubric, DoR/DoD overlays, failure-mode catalogue, grep library, model-tier routing, accreted patterns — lives in one centralised home: [`drive/calibration/`](../../drive/calibration/README.md) at the repo root. Each [`drive/<category>/README.md`](../../drive/) links out to the relevant calibration files; calibration is loaded by the matching skill at workflow step 1. The calibration *content* is project-specific by definition; only the conventions that govern it (in `principles/`) are long-lived.

**Trial period (project context, not long-lived):**

The current 2026-05-19 → 2026-06-02 trial is documented in [`drive/trial.md`](../../drive/trial.md) — it's the team's specific validation window before upstreaming to [`prisma/ignite`](https://github.com/prisma/ignite), so it lives alongside the project-context overlays rather than as enduring methodology. Synthesis ticket: [TML-2567](https://linear.app/prisma-company/issue/TML-2567/drive-trial-synthesise-findings-and-prepare-upstream-pr-to-ignite).

## The skill set

The canonical drive-* skill bodies live in [`skills-contrib/`](../../skills-contrib/). Each `drive-*/SKILL.md` is the source of truth for its skill body.

Project-specific overlays for each skill family live in [`drive/<category>/`](../../drive/) at the repo root, per the [project-context convention](https://github.com/prisma/ignite/pull/93). Each `drive/<category>/README.md` carries the team's overrides + extensions to the canonical skill.
