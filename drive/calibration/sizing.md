# Sizing — dispatch anchors + parallelisation heuristics

How big is this work, and which slices can run in parallel? This file is the team's pinned reference. When a new piece of work doesn't obviously match a reference task, pick the nearest one and ask: *is this harder, easier, or about the same?*

> **Post-pilot revisit (2026-05-28).** The current matrix is calibrated against the codebase as of the artifact-cascade-redesign discussion; running observations are it's too conservative for cheap-tier dispatches (mechanical-fanout M dispatches routinely close in well under the time-box). Slice-cap (one PR per slice) and project-cap (1–4 slices) anchors are added below; the dispatch matrix itself will be re-calibrated after the redesign pilot on the next 1–2 projects.

## Dispatch-sizing reference anchors

Estimate new dispatches relative to these references. If a new dispatch feels harder than its reference, size up; easier, size down. The slice-level analogue is "does the slice fit in one PR?" — these references are the **dispatch-level** cap. M is the dispatch ceiling; L and XL are refuse-to-dispatch.

### XS — Trivial (time-box ≤ 5 min)

| Reference | Why XS |
|---|---|
| Add an export to a barrel `index.ts` | One file, one line, no judgment |
| Rename a variable in one file (and its same-file usages) | Mechanical, scoped to one file |
| Fix a typo in a doc comment | No code change, no behaviour change |
| Add a single test case to an existing test file | One scope, one assertion |

Cheap tier (composer / Sonnet) is fine.

### S — Small (time-box ≤ 15 min)

| Reference | Why S |
|---|---|
| Add a new error subclass with structured fields + 1-2 tests | One new file, one new test file, well-bounded |
| Add a new type-level test case (`test-d.ts`) + its file | One file, requires understanding the type but no design |
| Change one type signature and update its 5-10 consumers | Mechanical fanout, single discipline |
| Add a new lint rule to `scripts/` and apply it once | Two files, mechanical |

Cheap tier with explicit DoD gates is fine.

### M — Medium (the dispatch ceiling; time-box ≤ 30 min)

| Reference | Why M |
|---|---|
| Add a new operation to the SQL DSL: type-level builder method + runtime + fixtures + positive/negative/edge tests. One operation, one target. | Spans 4-6 files, requires one design judgment, low blast radius |
| Migrate one package's test literals via codemod (with the codemod pre-written) | Many files but uniform transformation; single discipline; verifiable via grep + test gates |
| Implement an architect-flagged finding that touches 1-2 files in 1-2 packages | Single conceptual change, narrow surface |
| Add a new ADR + apply its trivial substrate change (no consumer fan-out) | Doc-heavy + small code change, single conceptual move |
| Replace one helper function with a structurally different version + update its 10-20 consumers | Mechanical fan-out with one design decision at the helper |

Tier depends on dispatch flavour — judgment-heavy M to orchestrator tier; mechanical M to cheap tier (see [`model-tier.md`](./model-tier.md)).

### L — Large (refuse-to-dispatch; decompose first)

| Reference | Why L |
|---|---|
| Add a new IR class family across all targets | Multiple design judgments, multiple packages, substrate-level blast radius |
| Implement a new ADR's substrate changes when there's fan-out | Multiple disciplines (substrate + consumers + fixtures + tests) |
| Migrate test literals across all SQL packages in one go | High surface, multiple packages, easy to miss sites |
| Restructure an existing IR class's shape (e.g. `ForeignKeyReferences` → `ForeignKeyReference`) | Substrate + every consumer + fixtures |

**Decomposition pattern.** Split along discipline boundaries: substrate change as its own M dispatch; each consumer package as its own M dispatch; fixture regen as its own S/M dispatch; verification as its own S dispatch.

### XL — Extra Large (refuse-to-dispatch; route via triage to a project)

| Reference | Why XL |
|---|---|
| Reverse the `namespaceId` optionality across the IR (the 2026-05-17 reversal) | Multiple substrate changes + every consumer + envelope shape + introspector + fixtures + test literals across the whole monorepo |
| Add a new authoring DSL surface (e.g. document storage, namespaces, …) | Multiple new abstractions + every target's interpretation + builder API + serialiser + tests |
| Build a target-extensible something (e.g. target-contributed PSL blocks) | Multiple new framework surfaces + multiple target packs + multiple new tests |

**Decomposition pattern.** Treat as a project, not a slice or dispatch. Route via `drive-triage-work` → `drive-create-project` → `drive-specify-project` → `drive-plan-project`; the plan composes slices; each slice plan is a dispatch sequence with every dispatch M-or-below.

## Slice + project sizing anchors

The dispatch matrix above is the M-cap for one dispatch. The slice and project caps work in the opposite direction — they bound the **container**, not the work item.

### Slice cap — one PR per slice

A slice must fit in one PR a human can review without losing the thread. Operational guide: ≤ 10 M-sized dispatches; if a slice plan demands more, the slice is too large — split it (per [`drive-plan-slice`](../../skills-contrib/drive-plan-slice/SKILL.md)). Slices that exceed this consistently land as PRs that humans review by skimming, which defeats the slice abstraction.

### Project cap — 1–4 slices, occasionally 5

The sweet spot is 1–4 slices. 5 is rare-but-acceptable when the slices are highly parallel; 6+ is a signal you've packed two projects into one project spec — re-spec into separate projects (per [`drive-specify-project`](../../skills-contrib/drive-specify-project/SKILL.md)). Larger projects suffer because the long-lived branch stack runs into rebasing overhead and the project spec's purpose statement loses sharpness.

## Parallelisation heuristics

- Slices that touch different operation families in `packages/1-framework-sql/**` typically parallelise well.
- Slices that touch the same adapter (e.g. `packages/3-targets-pg/**`) typically serialise — adapter-internal changes collide.
- Migration-shaped slices (feature flag → dual-write → migrate → remove old path) always serialise; if multiple migration-shaped slices are in flight in the same project, that's a sequencing red flag.
