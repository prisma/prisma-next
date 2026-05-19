# drive/plan — project-context for plan authoring

Loaded by `drive-plan-project`, `drive-plan-slice`, and `drive-build-workflow`. Holds prisma-next's dispatch-sizing anchors, DoR/DoD overlays, failure-mode catalogue, grep library, and model-tier routing.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`docs/drive/trial.md`](../../docs/drive/trial.md).

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

Tier depends on dispatch flavour — judgment-heavy M to orchestrator tier; mechanical M to cheap tier (see model-tier routing below).

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

## Slice-DoR overlay (plan-side items)

In addition to the canonical slice DoR:

- [ ] Slice plan references the relevant failure-mode entries below that apply to this slice's shape (so dispatch briefs can thread them in).
- [ ] Slice plan references the relevant grep-library entries below that apply to this slice's shape.

## Dispatch-DoR overlay

In addition to the canonical dispatch DoR:

- [ ] Brief's "Inputs" section references the applicable failure-mode entries with their dispositions in the edge-case table.
- [ ] Brief's "Inputs" section references the applicable grep-library entries this dispatch should run.
- [ ] Brief's tier is one of the three the team uses (orchestrator / mid / cheap — see model-tier routing).
- [ ] Brief specifies a slice plan path under `projects/<x>/slices/<s>/` (or "orphan" if no parent project).
- [ ] Brief's edge-case table includes "destructive git operations forbidden without orchestrator approval" disposition (non-negotiable for all subagent dispatches; see failure-mode entry below).
- [ ] Affected packages identified (so `pnpm build` of dependent packages can fire as a "done when" gate).
- [ ] Fixture regeneration in-or-out-of-scope decided (`pnpm fixtures:check` either passes or is part of the dispatch).
- [ ] If touching `packages/0-shared` or `packages/1-framework-core`, downstream package builds named as "done when" gates.
- [ ] If the dispatch adds a new public type, the dependent packages' typecheck is named.

## Dispatch-DoD: validation gates

### Always-run

```bash
pnpm typecheck    # catches the bulk of consumer-site issues
```

### Conditional

```bash
pnpm lint:deps              # when imports/exports/architectural structure changes
pnpm test:packages          # when source or test code changes (almost always)
pnpm test:integration       # when changes affect PGlite / PG / mongo paths
pnpm test:e2e               # when changes affect emit / migrate / run cycle
pnpm fixtures:check         # when IR / emitter / serialiser changes
```

### Brief-specified

A brief may add gates specific to the work:

- Specific test files that must pass (e.g. a known regression after a substrate change).
- Specific PGlite tests (e.g. cross-namespace-fk, unbound-namespace integration tests).
- Grep gates from the library below.
- Diff-stat sanity checks ("no demo migration snapshot should change unless intentional").

### Cadence

- **Per-commit** (during the dispatch): typecheck and any grep gates the brief specifies.
- **End-of-dispatch**: full conditional set + brief-specified gates.
- **Orchestrator-side post-dispatch**: re-run the grep gates independently; spot-check the diff for spec compliance; run intent-validation.

### Additional dispatch-DoD calibration items

- [ ] Brief's referenced failure-mode entries were checked during execution and noted as "avoided" in the dispatch summary.
- [ ] No new TODOs left behind by this dispatch.
- [ ] Per-commit messages reference the source spike artefact / slice spec where appropriate.
- [ ] If the dispatch touched test fixtures: `fixtures:check` passes; drift in unrelated fixture files is investigated, not committed.

## Failure-mode catalogue

Recorded failure modes with their detection signals and mitigations. **Append** a new entry every time a failure mode is observed; if a recurrence happens, the entry was inadequate — update it. Never delete (entries become historical context).

### F1. Dual-shape support relocated under a new name

**Symptom.** An implementer is told to delete dual-shape support / a discriminator probe / an accommodation function. They appear to comply by removing the original surface, but introduce a new function (often with a benign-sounding name) that does the same work in a different location.

**Detection signal.**

- A new function appears in the diff whose docstring admits accepting "the legacy shape" and converting.
- Grep for the original anti-pattern still returns hits in the new function's body.
- The implementer's brief said "delete X" but the diff has "deleted X, added Y" where Y serves X's role.

**Mitigation.**

- Brief must pre-name: "if you find yourself writing a function that does [the original anti-pattern's behaviour], stop and surface — that's the same failure mode under a new name."
- WIP-inspection cadence must read the diff of newly-introduced functions, especially those near the deleted surface.
- Grep library must include patterns that catch the anti-pattern regardless of which function it lives in.

**Reference incident.** 2026-05-17 reversal. Implementer deleted `validateStorage`'s dual-shape support, then added `normalizeStorageForHydration` that reintroduced the discriminator probe (`'columns' in entry`) in the serializer's hydration path. Corrected via commit `7240f5980`.

### F2. Constructor magic for optional fields

**Symptom.** A constructor or factory accepts an optional field and applies a fallback (`?? defaultValue`) inside. Downstream consumers cannot distinguish "I passed `undefined` deliberately" from "I forgot to pass it"; the fallback hides errors that should be loud.

**Detection signal.**

- `rg '\?\?\s*\w+_NAMESPACE_ID' packages/` or analogous patterns
- Type signatures with `field?:` on substrate IR classes
- Constructor bodies with `input.field ?? <fallback>`

**Mitigation.**

- The substrate field is required; callers normalise the coordinate before constructing.
- The constructor rejects undefined loudly (TypeScript at compile time + assertion at runtime if the JSON hydration path can produce undefined).
- Grep library catches `?? UNBOUND_NAMESPACE_ID`-style fallbacks.

**Reference incident.** Byte-stability accommodation made `StorageTable.namespaceId` and `ForeignKeyReference.namespaceId` optional, with constructor `?? UNBOUND_NAMESPACE_ID` magic. Caused F01-F05 + A1-A4 in the independent review. Reversed.

### F3. Discovery via test suite instead of grep

**Symptom.** Implementer runs `pnpm test:packages` (or similar suite) repeatedly to discover broken sites, instead of using `rg` to find them in advance. Each test-suite run is 5-30 min; each grep is < 5 s. The dispatch wall-clock balloons.

**Detection signal.**

- Transcript shows multiple `pnpm test:packages` runs with no commits between them.
- File modification rate is low (the suite is running, not writing).
- Implementer reports "I'm waiting for the test suite to tell me what's broken."

**Mitigation.**

- Brief pre-computes the grep gates: "the consumers that are broken by this change are those matching `<pattern>`. Find them all with rg before running the test suite. Run the test suite once as a verification gate, not as a discovery mechanism."
- WIP-inspection cadence spot-checks tool-call pattern in transcript; nudge to use grep if discovery loops appear.
- Grep library is the orchestrator's first-line tool for pre-naming what's broken.

**Reference incident.** 2026-05-17 reversal. Original implementer ran the suite multiple times during the fixture-regen slice. Required orchestrator interrupt to redirect.

### F4. Feature-sized dispatch with no inspection cadence

**Symptom.** The umbrella failure mode behind the 2026-05-17 reversal. A dispatch is sized L/XL (multiple commits, many files, multiple disciplines), the orchestrator monitors via file-system proxies (commit cadence, file mod rate) rather than reading diffs, validation gates pass throughout, drift compounds across multiple commits, and the violation is invisible until someone reads a specific diff for an unrelated reason.

**Detection signal.**

- Dispatch brief lists "4-6 commits" or "~50-100 files" or "multiple disciplines."
- Orchestrator's monitoring strategy is "check commit cadence" rather than "read diffs."
- Implementer is allowed to run unattended for >> 5 min without commit-level inspection.

**Mitigation.**

- Dispatch DoR refuses to dispatch L/XL.
- All M-or-below dispatches are subject to WIP-inspection cadence (≤ 5 min), including diff reads.
- Brief pre-names the disciplines so the orchestrator can verify each commit lands the correct discipline.

### F5. Destructive git operations executed by subagents without orchestrator approval

**Symptom.** A subagent runs `git clean -fd`, `git reset --hard`, `git stash drop`, or similar destructive operations as part of its setup or cleanup ritual, silently deleting untracked files or work that the orchestrator has on disk (in-progress docs, scratch files, methodology project artefacts, partial spike outputs).

**Detection signal.**

- Files the orchestrator wrote to disk in the current session disappear without an explicit user / orchestrator delete.
- `git reflog` shows recent `reset` operations the orchestrator did not initiate.
- `wip/` survives but untracked files outside `wip/` do not — consistent with `git clean -fd` (without `-x`, which would also touch `wip/`).

**Mitigation.**

- Brief must explicitly forbid destructive git operations without orchestrator approval. Standard list: `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `git rm -r --force`, `rm -rf` against the worktree.
- Orchestrator commits work-in-progress artefacts to a tracking branch (or stages them) before dispatching any subagent that might run cleanup. Untracked = unsafe.
- Critical artefacts (project docs being written in real time) should not live untracked while subagents are in flight.

**Reference incident.** 2026-05-17, a family-sql M-sized migration dispatch apparently ran a setup cleanup (likely `git clean -fd`) that deleted an in-flight methodology project directory (~1500 lines of untracked docs). Survived only because the orchestrator had the content in conversation context and could re-write it.

## Grep library

Patterns that catch known anti-patterns. Run as part of dispatch DoD for any dispatch whose work is in the affected surface area.

### IR substrate hygiene

```bash
# Optional fields on substrate IR classes that should be required:
rg 'namespaceId\?:' packages/

# Constructor / consumer normalisation magic:
rg '\.namespaceId\s*\?\?' packages/

# Dual-shape support function names (any future ones — add as discovered):
rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/

# Discriminator probes for the IR storage shape:
rg "'columns' in" packages/

# Deleted helpers that should not return:
rg 'foreignKeyNamespacesMatch' packages/
```

### Test-literal hygiene

```bash
# Flat-shape literals in test fixtures (after canonical shape is the only allowed shape):
rg 'tables:\s*\{\s*[a-z][A-Za-z_]+\s*:' packages/ -g '*.test.ts' -g '*.test-d.ts' -g 'fixtures/*.ts' | rg -v '__unbound__|public|auth|tenant'
```

### Cross-cutting anti-patterns

```bash
# Transient project artefact references in long-lived docs:
# (See AGENTS.md / .cursor/rules/doc-maintenance.mdc for the canonical pattern.)
rg 'Project [12]|\bD[1-9]\b|\(FR[0-9]+\)|\(T[0-9]+\)|AC-[A-Z][A-Z0-9-]*|\bR[0-9]+B?\b|\bF[1-7]\b|\bM[12]\b|per spec|the spec\b|spec calls|spec wording|spec promises|sub-spec|milestone' -- ':!projects/' ':!*.generated.*'

# File-extension imports in TS (forbidden):
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/

# any type usage (forbidden):
rg ': any\b|\bany\[\]' packages/ -g '*.ts' -g '*.tsx'

# @ts-expect-error outside negative type tests:
rg '@ts-expect-error' packages/ -g '*.ts' -g '!*.test-d.ts'

# @ts-nocheck (forbidden):
rg '@ts-nocheck' packages/
```

### When to extend the library

- A failure mode is detected by a pattern not already here.
- An anti-pattern slips past `pnpm lint:deps` or the type system but is caught by ad-hoc grep.
- A corrective round introduces a new "must-not-return" pattern.

Mark entries as historical (don't delete) when the underlying anti-pattern is structurally impossible (e.g. removed at the type level by a substrate change).

## Model-tier routing

Per `docs/drive/principles/decomposition-and-cost.md`, dispatches route to model tiers based on shape:

| Dispatch shape | Recommended tier |
|---|---|
| Substrate change / design judgment / spec interpretation | Opus (orchestrator tier) |
| Codemod / mechanical migration / batch fix | Sonnet or composer-2 (mid tier) |
| Test-literal rewrites / fixture regen | composer-2 or composer-2-fast (cheap tier) |
| Spike (read, count, structure findings) | Sonnet or composer-2 |
| Architect-class finding remediation (single discipline, narrow surface) | Sonnet |
| Long-running validation gate runs (typecheck, test:packages) | Whichever tier the parent dispatch chose (no model dispatch — just bash) |

Update as we accumulate dispatch outcomes per tier. Trigger: three consecutive failed dispatches at a tier this table recommends, OR a retro that names the tier choice as a contributing factor.

## Parallelisation heuristics

- Slices that touch different operation families in `packages/1-framework-sql/**` typically parallelise well.
- Slices that touch the same adapter (e.g. `packages/3-targets-pg/**`) typically serialise — adapter-internal changes collide.
- Migration-shaped slices (feature flag → dual-write → migrate → remove old path) always serialise; if multiple migration-shaped slices are in flight in the same project, that's a sequencing red flag.

## Stop-conditions for `drive-build-workflow`

Per-repo stop conditions beyond the canonical ones:

- Any dispatch that would touch `packages/0-shared/contract/types/**` halts for operator review before merge (contract surface is downstream-visible).
- Any dispatch that would change the public surface of `packages/0-shared/exports/**` halts for `drive-discussion` (downstream extensions consume this surface).

## Maintenance discipline

All sections above are updated **trigger-based, not periodically** — per `docs/drive/principles/retro.md`:

- **Reference anchors.** Recalibrate when a retro reveals an estimated M was actually L. Add a worked example showing the miscalibration and the corrected anchor.
- **DoR / DoD overlays.** Extend when a retro reveals a pickup-time or handoff-time gap.
- **Failure-mode catalogue.** Append on every retro that surfaces a failure mode. Never remove. If a mitigation proves inadequate (the failure mode recurs), update the mitigation and note the recurrence as a sub-incident under the same entry.
- **Grep library.** Extend on every retro that surfaces a new anti-pattern.
- **Model-tier routing.** Adjust as we accumulate dispatch outcomes per tier.
