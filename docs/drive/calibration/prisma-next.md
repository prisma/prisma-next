# Prisma-Next calibration

Project-specific calibration for the `prisma-next` codebase. This is the **worked-example calibration** that informs the general protocol — eventually each section migrates to the matching `prisma-next/drive/<category>/README.md` per the [PR #93](https://github.com/prisma/ignite/pull/93) project-context convention.

Per the [methodology overview](../README.md) and the principles under [`../principles/`](../principles/), the calibration covers:

| Section | Content | Eventual home in `prisma-next/` |
|---|---|---|
| § 1 | Reference tasks for t-shirt-size anchoring | `drive/plan/README.md` (read by `drive-plan-slice`, `drive-build-workflow`) |
| § 2 | Definition of Ready overlays at three scopes | Split: `drive/project/README.md` (project DoR), `drive/spec/README.md` + `drive/plan/README.md` (slice DoR), `drive/plan/README.md` (dispatch DoR) |
| § 3 | Definition of Done overlays at three scopes | Split: `drive/project/README.md` + `drive/qa/README.md` (project DoD), `drive/plan/README.md` + `drive/qa/README.md` + `drive/pr/README.md` (slice DoD), `drive/plan/README.md` (dispatch DoD) |
| § 4 | Failure-mode catalogue | `drive/plan/README.md` (drawn from by brief assembly per [`brief-discipline.md`](../principles/brief-discipline.md)) |
| § 5 | Grep library of anti-pattern patterns | `drive/plan/README.md` (same — brief assembly threads the relevant patterns) |
| § 6 | Model-tier routing | `drive/plan/README.md` (`drive-plan-slice` declares model tier per dispatch) |
| § 7 | Linear ceremony | Split: `drive/project/README.md` (project conventions) + `drive/pr/README.md` (PR conventions) + `drive/post-update/README.md` (status updates) |
| § 8 | Maintenance discipline | Applies to every category; lives in this doc and travels to whichever READMEs the maintenance discipline mentions |
| § 9 | Manual-QA context | `drive/qa/README.md` (already authored as the source for this file) |

The mapping is mechanical: every category has at most one consumer skill family per PR #93's table, and the calibration section's content flows to that family's README. Sections that span multiple categories (DoR / DoD overlays) split when they migrate.

All sections are living documents — updated **trigger-based** when retros surface a learning (per [`principles/retro.md`](../principles/retro.md)), not on a calendar.

---

## 1. Reference tasks for t-shirt anchors

Estimate new dispatches relative to these references. If a new dispatch feels harder than its reference, size up. If easier, size down. The slice-level analogue is "does the slice fit in one PR?" — sizing dispatches against these references is the dispatch-level cap.

### XS — Trivial

| Reference | Why XS |
|---|---|
| Add an export to a barrel `index.ts` | One file, one line, no judgment |
| Rename a variable in one file (and its same-file usages) | Mechanical, scoped to one file |
| Fix a typo in a doc comment | No code change, no behaviour change |
| Add a single test case to an existing test file | One scope, one assertion |

**Time-box: ≤ 5 min.** Cheap tier (composer / Sonnet) is fine.

### S — Small

| Reference | Why S |
|---|---|
| Add a new error subclass with structured fields + 1-2 tests | One new file, one new test file, well-bounded |
| Add a new type-level test case (`test-d.ts`) + its file | One file, requires understanding the type but no design |
| Change one type signature and update its 5-10 consumers | Mechanical fanout, single discipline |
| Add a new lint rule to `scripts/` and apply it once | Two files, mechanical |

**Time-box: ≤ 15 min.** Cheap tier with explicit DoD gates is fine.

### M — Medium (the dispatch ceiling)

| Reference | Why M |
|---|---|
| Add a new operation to the SQL DSL: type-level builder method + runtime + fixtures + positive/negative/edge tests. One operation, one target. | Spans 4-6 files, requires one design judgment (operation semantics), low blast radius (new code) |
| Migrate one package's test literals via codemod (with the codemod pre-written) | Many files but uniform transformation, single discipline, verifiable via grep + test gates |
| Implement an architect-flagged finding that touches 1-2 files in 1-2 packages | Single conceptual change, single discipline, narrow surface |
| Add a new ADR + apply its trivial substrate change (no consumer fan-out) | Doc-heavy + small code change, single conceptual move |
| Replace one helper function with a structurally different version + update its 10-20 consumers | Mechanical fan-out with one design decision at the helper |

**Time-box: ≤ 30 min.** Tier depends on dispatch flavour — judgment-heavy M to orchestrator tier, mechanical M to cheap tier.

### L — Large (refuse-to-dispatch; decompose first)

| Reference | Why L |
|---|---|
| Add a new IR class family across all targets | Multiple design judgments, multiple packages, substrate-level blast radius |
| Implement a new ADR's substrate changes when there's fan-out | Multiple disciplines (substrate + consumers + fixtures + tests) |
| Migrate test literals across all SQL packages in one go | High surface, multiple packages, easy to miss sites |
| Restructure an existing IR class's shape (e.g. `ForeignKeyReferences` → `ForeignKeyReference`) | Substrate + every consumer + fixtures |

**Decomposition pattern.** Split along discipline boundaries: substrate change as its own M dispatch; each consumer package as its own M dispatch; fixture regen as its own S/M dispatch; verification as its own S dispatch.

### XL — Extra Large (refuse-to-dispatch; route via triage)

| Reference | Why XL |
|---|---|
| Reverse the namespaceId optionality across the IR (the 2026-05-17 reversal) | Multiple substrate changes + every consumer + envelope shape + introspector + fixtures + test literals across the whole monorepo |
| Add a new authoring DSL surface (e.g. document storage, namespaces, …) | Multiple new abstractions + every target's interpretation + builder API + serialiser + tests |
| Build a target-extensible something (e.g. target-contributed PSL blocks) | Multiple new framework surfaces + multiple target packs + multiple new tests |
| Land a project-sized feature in one dispatch (e.g. a whole slice or a whole project) | Definitionally too big |

**Decomposition pattern.** Treat as a project, not a slice or dispatch. Triage routes to `drive-create-project` → `drive-specify-project` → `drive-plan-project`; the plan composes slices; each slice has a slice plan; each slice plan is a dispatch sequence with every dispatch M-or-below.

---

## 2. Definition of Ready overlays

Calibration items that overlay the protocol's DoR templates (per [`principles/definition-of-ready.md`](../principles/definition-of-ready.md)). Each item adds to the protocol-layer checklist at the named scope; the protocol items are not repeated here.

### 2.1 Project DoR — `prisma-next` overlay

```markdown
# Calibration overlays (prisma-next, project DoR)

- [ ] Linear Project exists (created via save_project MCP tool)
- [ ] If started from a ticket: promotion pattern applied (ticket moved
       into Linear Project, marked Done, renamed "Plan: <project name>"
       or commented per model.md § Linear sync — Promotion pattern)
- [ ] Project working branch exists, named with Linear Project ID
       (e.g. tml-2549-<descriptive-slug>)
- [ ] projects/<project>/ folder scaffolded with spec.md + plan.md
       placeholders; README.md present
```

### 2.2 Slice DoR — `prisma-next` overlay

```markdown
# Calibration overlays (prisma-next, slice DoR)

- [ ] Linear issue created and linked from slice spec
       (issue description carries a link back to projects/<x>/slices/<s>/)
- [ ] Slice's PR-to-be will carry a Refs: <issue-id> line
- [ ] Slice's parent branch is the project's working branch
       (or main for orphan slices)
- [ ] Slice plan references the relevant § 4 failure-mode entries that
       apply to this slice's shape (so dispatch briefs can thread them in)
- [ ] Slice plan references the relevant § 5 grep library entries that
       apply to this slice's shape
```

### 2.3 Dispatch DoR — `prisma-next` overlay

```markdown
# Calibration overlays (prisma-next, dispatch DoR)

- [ ] Brief's "Inputs" section references the applicable § 4 failure-mode
       entries with their dispositions in the edge-case table
- [ ] Brief's "Inputs" section references the applicable § 5 grep library
       entries that this dispatch should run
- [ ] Brief's tier is one of the three the team uses
       (orchestrator tier / mid tier / cheap tier — per § 6)
- [ ] Brief specifies a slice plan path under
       projects/<x>/slices/<s>/ (or "orphan" if no parent project)
- [ ] Brief's edge-case table includes "destructive git operations
       forbidden without orchestrator approval" disposition
       (per § 4.5; non-negotiable for all subagent dispatches)
```

---

## 3. Definition of Done overlays

Calibration items that overlay the protocol's DoD templates (per [`principles/definition-of-done.md`](../principles/definition-of-done.md)).

### 3.1 Project DoD — `prisma-next` overlay

```markdown
# Calibration overlays (prisma-next, project DoD)

- [ ] Long-lived docs migrated to docs/ (per the doc-maintenance rule)
- [ ] Any new architecture docs are linked from docs/architecture docs/
- [ ] Linear Project marked Completed (or Cancelled with rationale in
       final status update)
- [ ] Original promoted ticket (if applicable) reflects project completion
       (comment or status update)
- [ ] Final status update on Linear Project links the close-out retro
- [ ] Manual-QA coverage rolled up: every slice that touched
       user-observable surface has a drive-qa-plan script + ≥1
       drive-qa-run report; no unresolved 🛑 Blocker findings;
       drive/qa/README.md updated if the project surfaced new
       audiences or coverage-gate gaps
- [ ] projects/<project>/ deleted from the repo
- [ ] References to projects/<project>/** removed from the codebase
       (per the doc-maintenance rule)
```

### 3.2 Slice DoD — `prisma-next` overlay

```markdown
# Calibration overlays (prisma-next, slice DoD)

- [ ] Linear issue moved to "Ready to be merged" (the team's
       terminal-before-merge state)
- [ ] PR title carries Linear ticket prefix (e.g. tml-XXXX:)
- [ ] PR description follows drive-pr-description shape
       (decision-led, narrative)
- [ ] PR linked to its Linear issue via GitHub integration
       (auto-close on merge works)
- [ ] No projects/ references in long-lived files added by the slice
       (per the doc-maintenance rule; grep gate in § 5)
- [ ] Manual QA: drive-qa-plan script exists + ≥1 drive-qa-run
       report exists; no unresolved 🛑 Blocker findings;
       script names both prisma-next QA audiences (extension authors
       via packages/3-extensions/, end users via examples/) where
       relevant — OR explicit "N/A — no user-observable change" with
       a one-line rationale (project-specific shape per § 9 / drive/qa/README.md)
```

### 3.3 Dispatch DoD — `prisma-next` overlay

The protocol-layer dispatch DoD items (per `principles/definition-of-done.md`) apply universally. Below are the verification gates specific to `prisma-next`.

#### Always-run gates

```bash
pnpm typecheck    # always; catches the bulk of consumer-site issues
```

#### Conditional gates

```bash
pnpm lint:deps              # when imports/exports/architectural structure changes
pnpm test:packages          # when source or test code changes (almost always)
pnpm test:integration       # when changes affect PGlite / PG / mongo paths
pnpm test:e2e               # when changes affect emit / migrate / run cycle
pnpm fixtures:check         # when IR / emitter / serialiser changes
```

#### Brief-specified gates

A dispatch's brief may add gates specific to the work:

- **Specific test files** that must pass (e.g. F01 regression after the namespace reversal)
- **Specific PGlite tests** (e.g. cross-namespace-fk, unbound-namespace integration tests)
- **Grep gates** from the library below (§ 5)
- **Diff-stat sanity checks** ("no demo migration snapshot should change unless intentional")

#### Verification cadence

- **Per-commit gates** (during the dispatch): typecheck and any grep gates the brief specifies.
- **End-of-dispatch gates** (before reporting done): the full conditional set + brief-specified gates.
- **End-of-dispatch orchestrator-side gates** (post-implementer-report): orchestrator re-runs the grep gates independently to confirm; spot-checks the diff for spec compliance; runs intent-validation.

#### Additional calibration items

```markdown
- [ ] Brief's referenced § 4 failure-mode entries were checked during
       execution and noted as "avoided" in the dispatch summary
- [ ] No new TODOs left behind by this dispatch
- [ ] Per-commit messages reference the source spike artefact / slice
       spec where appropriate
- [ ] If the dispatch touched test fixtures: fixtures:check passes;
       drift in unrelated fixture files is investigated, not committed
```

---

## 4. Failure-mode catalogue

Recorded failure modes with their detection signals and mitigations. Add a new entry every time a failure mode is observed; if a recurrence happens, the entry was inadequate — update it.

### 4.1 Dual-shape support relocated under a new name

**Symptom.** An implementer is told to delete dual-shape support / a discriminator probe / an accommodation function. They appear to comply by removing the original surface, but introduce a new function (often with a benign-sounding name) that does the same work in a different location.

**Detection signal.**

- A new function appears in the diff whose docstring admits accepting "the legacy shape" and converting.
- Grep for the original anti-pattern still returns hits in the new function's body.
- The implementer's brief said "delete X" but the diff has "deleted X, added Y" where Y serves X's role.

**Mitigation.**

- Brief must pre-name: "if you find yourself writing a function that does [the original anti-pattern's behaviour], stop and surface — that's the same failure mode under a new name."
- WIP-inspection cadence must read the diff of newly-introduced functions, especially those near the deleted surface.
- Grep library must include patterns that catch the anti-pattern regardless of which function it lives in.

**Reference incident.** 2026-05-17 reversal. Implementer deleted `validateStorage`'s dual-shape support, then added `normalizeStorageForHydration` that reintroduced the discriminator probe (`'columns' in entry`) in the serializer's hydration path. Corrected via commit `7240f5980`. Captured in `wip/unattended-decisions.md` § 11 and design-decisions.md § 1.

### 4.2 Constructor magic for optional fields

**Symptom.** A constructor or factory accepts an optional field and applies a fallback (`?? defaultValue`) inside. Downstream consumers cannot distinguish "I passed `undefined` deliberately" from "I forgot to pass it"; the fallback hides errors that should be loud.

**Detection signal.**

- `rg '\?\?\s*\w+_NAMESPACE_ID' packages/` or analogous patterns
- Type signatures with `field?:` on substrate IR classes
- Constructor bodies with `input.field ?? <fallback>`

**Mitigation.**

- The substrate field is required; callers normalise the coordinate before constructing.
- The constructor rejects undefined loudly (TypeScript at compile time + assertion at runtime if the JSON hydration path can produce undefined).
- Grep library catches `?? UNBOUND_NAMESPACE_ID`-style fallbacks.

**Reference incident.** Byte-stability accommodation made `StorageTable.namespaceId` and `ForeignKeyReference.namespaceId` optional, with constructor `?? UNBOUND_NAMESPACE_ID` magic. Caused F01-F05 + A1-A4 in the independent review. Reversed via decision recorded in `wip/unattended-decisions.md`.

### 4.3 Discovery via test suite instead of grep

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

### 4.4 Feature-sized dispatch with no inspection cadence

**Symptom.** The umbrella failure mode behind the 2026-05-17 reversal. A dispatch is sized L/XL (multiple commits, many files, multiple disciplines), the orchestrator monitors via file-system proxies (commit cadence, file mod rate) rather than reading diffs, validation gates pass throughout, drift compounds across multiple commits, and the violation is invisible until someone reads a specific diff for an unrelated reason.

**Detection signal.**

- Dispatch brief lists "4-6 commits" or "~50-100 files" or "multiple disciplines."
- Orchestrator's monitoring strategy is "check commit cadence" rather than "read diffs."
- Implementer is allowed to run unattended for >> 5 min without commit-level inspection.

**Mitigation.**

- Dispatch DoR refuses to dispatch L/XL.
- All M-or-below dispatches are subject to WIP-inspection cadence (≤ 5 min), including diff reads.
- Brief pre-names the disciplines so the orchestrator can verify each commit lands the correct discipline.

**Reference incident.** 2026-05-17 reversal. Entire root cause of the dispatch that produced § 4.1 and required the corrective round. Will not recur if dispatch DoR and WIP-inspection are enforced.

### 4.5 Destructive git operations executed by subagents without orchestrator approval

**Symptom.** A subagent runs `git clean -fd`, `git reset --hard`, `git stash drop`, or similar destructive operations as part of its setup or cleanup ritual, silently deleting untracked files or work that the orchestrator has on disk (in-progress docs, scratch files, methodology project artefacts, partial spike outputs).

**Detection signal.**

- Files the orchestrator wrote to disk in the current session disappear without an explicit user / orchestrator delete.
- `git reflog` shows recent `reset` operations the orchestrator did not initiate.
- `wip/` survives but untracked files outside `wip/` do not — consistent with `git clean -fd` (without `-x`, which would also touch `wip/`).

**Mitigation.**

- Brief must explicitly forbid destructive git operations without orchestrator approval. Standard list: `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `git rm -r --force`, `rm -rf` against the worktree.
- Orchestrator commits work-in-progress methodology artefacts to a tracking branch (or stages them) before dispatching any subagent that might run cleanup. Untracked = unsafe.
- Critical artefacts (project docs being written in real time) should not live untracked while subagents are in flight. Either commit, or accept the risk and have a recovery path (read from conversation history).

**Reference incident.** 2026-05-17, dispatch `de1c1c20` (family-sql M-sized migration). The subagent apparently ran a setup cleanup (likely `git clean -fd`) that deleted `projects/agile-agent-orchestration/` (untracked at the time, ~1500 lines of methodology docs in flight). The protocol files survived only because the orchestrator had the full content in conversation context and could re-write them. Without that, the work would have been lost.

---

## 5. Grep library

Patterns that catch known anti-patterns. Run as part of dispatch DoD for any dispatch whose work is in the affected surface area.

### 5.1 IR substrate hygiene

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

### 5.2 Test-literal hygiene (post-canonical-shape-enforcement)

```bash
# Flat-shape literals in test fixtures (after canonical shape is the only allowed shape):
rg 'tables:\s*\{\s*[a-z][A-Za-z_]+\s*:' packages/ -g '*.test.ts' -g '*.test-d.ts' -g 'fixtures/*.ts' | rg -v '__unbound__|public|auth|tenant'
```

### 5.3 Generic project anti-patterns (cross-cutting)

```bash
# Transient project artefact references in long-lived docs:
# (See AGENTS.md / .cursor/rules/doc-maintenance.mdc for the canonical pattern.)
rg 'Project [12]|\bD[1-9]\b|\(FR[0-9]+\)|\(T[0-9]+\)|AC-[A-Z][A-Z0-9-]*|\bR[0-9]+B?\b|\bF[1-7]\b|\bM[12]\b|per spec|the spec\b|spec calls|spec wording|spec promises|sub-spec|milestone' -- ':!projects/' ':!*.generated.*'

# File-extension imports in TS (which we don't allow):
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/

# any type usage (which we don't allow):
rg ': any\b|\bany\[\]' packages/ -g '*.ts' -g '*.tsx'

# @ts-expect-error outside negative type tests:
rg '@ts-expect-error' packages/ -g '*.ts' -g '!*.test-d.ts'

# @ts-nocheck (forbidden):
rg '@ts-nocheck' packages/
```

### 5.4 Architecture hygiene (substitute for `pnpm lint:deps` when faster signal is needed)

```bash
# Cross-domain imports that should go through exports/ barrels:
# (Add the actual concerning import patterns when they arise.)
```

### When to extend the library

Add a new pattern when:

- A failure mode in § 4 is detected by a pattern not already in the library.
- An anti-pattern slips past `pnpm lint:deps` or the type system but is caught by ad-hoc grep.
- A corrective round introduces a new "must-not-return" pattern (like `foreignKeyNamespacesMatch`).

---

## 6. Model-tier routing

Per [`principles/decomposition-and-cost.md`](../principles/decomposition-and-cost.md), dispatches route to model tiers based on dispatch shape. For `prisma-next`:

| Dispatch shape | Recommended tier |
|---|---|
| Substrate change / design judgment / spec interpretation | Opus (orchestrator tier) |
| Codemod / mechanical migration / batch fix | Sonnet or composer-2 (mid tier) |
| Test-literal rewrites / fixture regen | composer-2 or composer-2-fast (cheap tier) |
| Spike (read, count, structure findings) | Sonnet or composer-2 |
| Architect-class finding remediation (single discipline, narrow surface) | Sonnet |
| Long-running validation gate runs (typecheck, test:packages) | Whichever tier the parent dispatch chose (no model dispatch — just bash) |

This is a starting calibration. Update as we learn which tier successfully completes which dispatch shape.

---

## 7. Linear ceremony (prisma-next conventions)

Linear-specific conventions used in `prisma-next`. Live here because they're team-specific overlays on the protocol-layer Linear sync (per `model.md` § Linear sync).

### 7.1 Project conventions

- Linear Projects are created via `save_project` (MCP).
- Project working branch is named with the Linear Project ID: `<tml-id>-<descriptive-slug>` (lowercased; hyphens).
- Initial status update on the project links the project's spec.

### 7.2 Slice / issue conventions

- Each slice maps to a Linear Issue (the Drive slice ↔ Linear issue mapping per `model.md`).
- Issue description links back to `projects/<project>/slices/<slice>/` (in-project) or to the orphan-slice PR description path (orphan).
- PR title prefix: `<tml-id>:` (the Linear ticket prefix). E.g. `tml-2549: drive-domain-model consolidation`.
- PR description references the Linear issue (`Refs: TML-XXXX` line or in the title; either is enough for auto-close).

### 7.3 State conventions

- The team's terminal-before-merge state is `Ready to be merged` (not `Done`). Auto-close on merge transitions to the team's completed state via the GitHub integration.
- Do not manually transition issues to a completed state; the integration handles it. Manual transitions before merge are fine (e.g. moving to `In review` when the PR opens).

### 7.4 Promotion / demotion

Follow the patterns specified in `model.md` § Linear sync:

- **Promotion** (case-b: ticket → project): move ticket into new Linear Project; mark Done; rename to `Plan: <project name>` OR add a "Converted to project: <url>" comment. Project is the durable handle going forward.
- **Demotion** (project → slice / direct change): move surviving ticket OUT of the Linear Project; close other issues with "merged into <surviving-ticket>" comments; mark Linear Project Cancelled (rationale) or Completed (if part shipped); delete `projects/<project>/`.

---

## 8. Maintenance

All sections of this calibration are updated **trigger-based, not periodically** — per the retro principle ([`principles/retro.md`](../principles/retro.md)). The triggers are:

- **Retro that lands a calibration update.** Every retro asks "does this lesson land in protocol or calibration?" — when the answer is calibration, the entry lands here.
- **New verification tooling.** A new lint script, a new test harness, a new check command — extends § 3 (DoD gates) and possibly § 5 (grep library).
- **Repeated dispatch outcomes contradict § 6 routing.** If a tier choice consistently fails on a dispatch shape, the routing entry is wrong; update.
- **Project nature shifts.** If the project moves from greenfield to maintenance, from one dominant subsystem to another, or otherwise changes shape, the reference tasks in § 1 may no longer represent useful anchors; recalibrate.
- **Linear convention changes.** Team-side workflow state changes, naming convention changes, integration changes — extend § 7.

### Per-section update discipline

- **Reference tasks (§ 1).** Recalibrate when a retro reveals that an estimated M was actually L (the dispatch failed in ways the M-tier treatment couldn't catch). Add a worked example showing the miscalibration and the corrected anchor.
- **DoR overlays (§ 2).** Extend when a retro reveals a pickup-time gap the existing overlays didn't cover.
- **DoD overlays (§ 3).** Extend when a retro reveals a handoff-time gap or when new verification tooling lands.
- **Failure-mode catalogue (§ 4).** **Append on every retro that surfaces a failure mode.** Never remove (entries become historical context; the team that hits the failure mode for the second time consults the existing entry rather than re-discovering it). If an entry's mitigation proves inadequate (the same failure mode recurs despite the mitigation), update the mitigation rather than removing the entry — and note the recurrence as a sub-incident under the same entry.
- **Grep library (§ 5).** Extend on every retro that surfaces a new anti-pattern. Mark entries as historical (don't delete) when the underlying anti-pattern is structurally impossible (e.g. removed at the type level, eliminated by a substrate change).
- **Model-tier routing (§ 6).** Adjust as we accumulate dispatch outcomes per tier. Trigger: three consecutive failed dispatches at a tier the table recommends, OR a retro that names the tier choice as a contributing factor.
- **Linear ceremony (§ 7).** Update when the team's Linear workflow state convention changes or when the GitHub-Linear integration behaviour changes.

This document is intended to live in `prisma-next`'s `docs/` once the methodology stabilises. While we're still iterating, it lives here in the methodology project. When it migrates, the file path changes and references are updated; the maintenance discipline does not.

---

## 9. Manual-QA context (source for `drive/qa/README.md`)

`drive-qa-plan` and `drive-qa-run` (per [PR #93](https://github.com/prisma/ignite/pull/93)) read project-specific context from `drive/qa/README.md`. The content below is the `prisma-next`-side source for that file; when the calibration migrates into `prisma-next/docs/`, this section's contents move to `prisma-next/drive/qa/README.md` and a one-line stub stays here pointing to it.

### 9.1 Consumer audiences to QA against

Manual-QA scripts for `prisma-next` slices that touch user-observable surface should name and exercise both consumer audiences:

- **Extension authors.** Audience that authors `@prisma-next/extension-*` packages and consumes the framework's authoring substrate, IR, and ADR-defined extension points. Substrate location: `packages/3-extensions/` (worked examples of real extensions) + the framework export surface in `packages/0-framework/` and `packages/1-sql/` / `packages/1-document/`. Common probes: "does the upgrade-skills coverage gate fire on a planted regression?", "does the ADR's new extension point work end-to-end for at least one example extension?", "do the extension's tests still pass after a framework substrate change?"
- **End users.** Audience that uses `prisma-next` via the demo or example apps. Substrate location: `examples/` (the demo + the example apps under `examples/*`). Common probes: "does `pnpm demo` still run cleanly?", "does the example app's `pnpm dev` produce the expected first-run output?", "does a deliberately-malformed schema produce the documented error envelope?"

Scripts that touch only one audience must say so explicitly in the "What this script is testing" block — that's a coverage statement, not a gap.

### 9.2 Substrate locations the QA runner needs

| Surface | Where to find it |
|---|---|
| Demo (the end-user-facing happy path) | `pnpm demo` from repo root |
| Example apps | `examples/<app>/` — each has its own `README.md` describing what it demonstrates |
| Extension worked-examples | `packages/3-extensions/<extension>/` — each has its own tests describing the extension's contract |
| Upgrade-skills coverage gate | `pnpm check:upgrade-coverage` (relevant for any framework-breaking change) |
| Fixture suite | `pnpm fixtures:check` (relevant for any IR / emitter / serialiser change) |
| The standard test gates | `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` (these are CI gates, not manual QA — listed here so scripts don't redundantly re-author them) |

### 9.3 Known coverage-gate gaps

Areas where CI is structurally weak and manual QA is the only honest oracle:

- **Error envelope copy.** `pnpm test:packages` asserts shape, not legibility. A script that says "the user pastes their broken schema; does the error message tell them what to fix?" is the only way to catch error-copy regressions.
- **CLI diagnostic flow.** `pnpm test:e2e` runs end-to-end but doesn't read the output the way a human would. Scripts that re-run a known-broken CLI flow and judge the diagnostic clarity catch what e2e tests cannot.
- **Generated artefact shape (the `contract.d.ts` consumers actually edit against).** Fixtures check that the emitted shape matches the golden; manual QA should sometimes open the generated `.d.ts` and read it as a downstream type-author would. Hard to encode as a fixture assertion.
- **Migration applicability across the demo's history.** Migrations apply forward in test fixtures, but a manual run that walks the demo through its migration history and confirms each step produces a usable database is uniquely valuable when a migration-system slice ships.

### 9.4 Script + report locations

- **In-project slices** (project under `projects/<x>/`): `projects/<x>/manual-qa.md` (script) + `projects/<x>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md` (one per run).
- **Orphan slices**: inline in the PR description (script under "Manual QA" heading; findings as a review comment thread).

### 9.5 When to mark "N/A"

A slice may legitimately mark "Manual QA: N/A" when:

- The change is internal-refactor with no user-observable surface (no new envelope copy, no new CLI surface, no new error path, no new extension contract).
- The change is doc-only (a README rewrite, an ADR addition).
- The change is purely infrastructural (a CI workflow tweak, a build-config change) that has no consumer-visible behaviour.

The slice's DoD records the N/A with a one-line rationale; the project DoD's QA coverage check confirms the rationale is honest (an "internal refactor" that turns out to have changed a user-visible error message is the failure mode this check exists to catch).

