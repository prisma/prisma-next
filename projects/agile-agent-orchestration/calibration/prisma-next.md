# Prisma-Next Calibration

Project-specific calibration for the prisma-next codebase. This is the **example calibration** that informs the general protocol — eventually this content lives in `prisma-next`'s own `docs/` rather than in this methodology project.

Per the [general spec](../spec.md), the calibration covers four things:

1. Reference tasks for t-shirt-size anchoring
2. Definition of Done verification gates
3. Failure-mode catalogue
4. Grep library of anti-pattern patterns

All four are living documents — updated when we discover new failure modes or recalibrate.

---

## 1. Reference tasks for t-shirt anchors

Estimate new tasks relative to these references. If a new task feels harder than its reference, size up. If easier, size down.

### XS — Trivial

| Reference | Why XS |
|---|---|
| Add an export to a barrel `index.ts` | One file, one line, no judgment |
| Rename a variable in one file (and its same-file usages) | Mechanical, scoped to one file |
| Fix a typo in a doc comment | No code change, no behaviour change |
| Add a single test case to an existing test file | One scope, one assertion |

**Time-box: ≤ 5 min.** Routine dispatch to cheap tier (composer / Sonnet) is fine.

### S — Small

| Reference | Why S |
|---|---|
| Add a new error subclass with structured fields + 1-2 tests | One new file, one new test file, well-bounded |
| Add a new type-level test case (test-d.ts) + its file | One file, requires understanding the type but no design |
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

**Decomposition pattern.** Split along discipline boundaries: substrate change as its own M; each consumer package as its own M; fixture regen as its own S/M; verification as its own S.

### XL — Extra Large (refuse-to-dispatch; decompose into stories)

| Reference | Why XL |
|---|---|
| Reverse the namespaceId optionality across the IR (today's reversal) | Multiple substrate changes + every consumer + envelope shape + introspector + fixtures + test literals across the whole monorepo |
| Add a new authoring DSL surface (e.g. document storage, namespaces, …) | Multiple new abstractions + every target's interpretation + builder API + serialiser + tests |
| Build a target-extensible something (e.g. target-contributed PSL blocks) | Multiple new framework surfaces + multiple target packs + multiple new tests |
| Land a project-sized feature in one dispatch (e.g. a whole milestone) | Definitionally too big |

**Decomposition pattern.** Treat as a project, not a dispatch. Write a spec; write a plan; the plan decomposes into stories; each story is an M; each M may be further decomposed at dispatch time if needed.

---

## 2. Definition of Done verification gates

For prisma-next, the standard verification gates are:

### Always-run gates

```bash
pnpm typecheck    # always; catches the bulk of consumer-site issues
```

### Conditional gates

```bash
pnpm lint:deps              # when imports/exports/architectural structure changes
pnpm test:packages          # when source or test code changes (almost always)
pnpm test:integration       # when changes affect PGlite / PG / mongo paths
pnpm test:e2e               # when changes affect emit / migrate / run cycle
pnpm fixtures:check         # when IR / emitter / serialiser changes
```

### Brief-specified gates

A dispatch's brief may add gates specific to the work:

- **Specific test files** that must pass (e.g. F01 regression after the namespace reversal)
- **Specific PGlite tests** (e.g. AC4 cross-namespace-fk, AC6 unbound-namespace integration tests)
- **Grep gates** from the library below (see § 4)
- **Diff-stat sanity checks** ("no demo migration snapshot should change unless intentional")

### Verification cadence

- **Per-commit gates** (during the dispatch): typecheck and any grep gates the brief specifies.
- **End-of-dispatch gates** (before reporting done): the full conditional set + brief-specified gates.
- **End-of-round gates** (orchestrator-side, post-implementer-report): orchestrator re-runs the grep gates independently to confirm; spot-checks the diff for spec compliance.

---

## 3. Failure-mode catalogue

Recorded failure modes with their detection signals and mitigations. Add a new entry every time a failure mode is observed; if a recurrence happens, the entry was inadequate — update it.

### 3.1 Dual-shape support relocated under a new name

**Symptom.** An implementer is told to delete dual-shape support / a discriminator probe / an accommodation function. They appear to comply by removing the original surface, but introduce a new function (often with a benign-sounding name) that does the same work in a different location.

**Detection signal.**

- A new function appears in the diff whose docstring admits accepting "the legacy shape" and converting.
- Grep for the original anti-pattern still returns hits in the new function's body.
- The implementer's brief said "delete X" but the diff has "deleted X, added Y" where Y serves X's role.

**Mitigation.**

- Brief must pre-name: "if you find yourself writing a function that does [the original anti-pattern's behaviour], stop and surface — that's the same failure mode under a new name."
- 5-min standup check must read the diff of newly-introduced functions, especially those near the deleted surface.
- Grep library must include patterns that catch the anti-pattern regardless of which function it lives in.

**Reference incident.** 2026-05-17 reversal. Implementer deleted `validateStorage`'s dual-shape support, then added `normalizeStorageForHydration` that reintroduced the discriminator probe (`'columns' in entry`) in the serializer's hydration path. Corrected via commit `7240f5980`. Captured in `wip/unattended-decisions.md` § 11 and design-decisions.md § 1.

### 3.2 Constructor magic for optional fields

**Symptom.** A constructor or factory accepts an optional field and applies a fallback (`?? defaultValue`) inside. Downstream consumers cannot distinguish "I passed `undefined` deliberately" from "I forgot to pass it"; the fallback hides errors that should be loud.

**Detection signal.**

- `rg '\?\?\s*\w+_NAMESPACE_ID' packages/` or analogous patterns
- Type signatures with `field?:` on substrate IR classes
- Constructor bodies with `input.field ?? <fallback>`

**Mitigation.**

- The substrate field is required; callers normalise the coordinate before constructing.
- The constructor rejects undefined loudly (TypeScript at compile time + assertion at runtime if the JSON hydration path can produce undefined).
- Grep library catches `?? UNBOUND_NAMESPACE_ID`-style fallbacks.

**Reference incident.** M5a R7 byte-stability accommodation made `StorageTable.namespaceId` and `ForeignKeyReference.namespaceId` optional, with constructor `?? UNBOUND_NAMESPACE_ID` magic. Caused F01-F05 + A1-A4 in the independent review. Reversed via decision #10 (in `wip/unattended-decisions.md`).

### 3.3 Discovery via test suite instead of grep

**Symptom.** Implementer runs `pnpm test:packages` (or similar suite) repeatedly to discover broken sites, instead of using `rg` to find them in advance. Each test-suite run is 5-30 min; each grep is < 5 s. The dispatch wall-clock balloons.

**Detection signal.**

- Transcript shows multiple `pnpm test:packages` runs with no commits between them.
- File modification rate is low (the suite is running, not writing).
- Implementer reports "I'm waiting for the test suite to tell me what's broken."

**Mitigation.**

- Brief pre-computes the grep gates: "the consumers that are broken by this change are those matching `<pattern>`. Find them all with rg before running the test suite. Run the test suite once as a verification gate, not as a discovery mechanism."
- 5-min standup check spot-checks tool-call pattern in transcript; nudge to use grep if discovery loops appear.
- Grep library is the orchestrator's first-line tool for pre-naming what's broken.

**Reference incident.** 2026-05-17 reversal. Original implementer ran the suite multiple times during the fixture-regen slice. Required orchestrator interrupt ("kick in the pants, use grep ffs") to redirect.

### 3.4 Feature-sized dispatch with no inspection cadence

**Symptom.** The umbrella failure mode behind today's reversal. A dispatch is sized L/XL (multiple commits, many files, multiple disciplines), the orchestrator monitors via file-system proxies (commit cadence, file mod rate) rather than reading diffs, validation gates pass throughout, drift compounds across multiple commits, and the violation is invisible until someone reads a specific diff for an unrelated reason.

**Detection signal.**

- Dispatch brief lists "4-6 commits" or "~50-100 files" or "multiple disciplines."
- Orchestrator's monitoring strategy is "check commit cadence" rather than "read diffs."
- Implementer is allowed to run unattended for >> 5 min without commit-level inspection.

**Mitigation.**

- DoR refuses to dispatch L/XL.
- All M-or-below dispatches are subject to ≤5-min orchestrator check, including diff reads.
- Brief pre-names the disciplines so the orchestrator can verify each commit lands the correct discipline.

**Reference incident.** 2026-05-17 reversal. Entire root cause of the dispatch that produced § 3.1 and required the corrective round. Will not recur if DoR and 5-min check are enforced.

### 3.5 Destructive git operations executed by subagents without orchestrator approval

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

## 4. Grep library

Patterns that catch known anti-patterns. Run as part of DoD for any dispatch whose work is in the affected surface area.

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

### Test-literal hygiene (post-canonical-shape-enforcement)

```bash
# Flat-shape literals in test fixtures (after canonical shape is the only allowed shape):
rg 'tables:\s*\{\s*[a-z][A-Za-z_]+\s*:' packages/ -g '*.test.ts' -g '*.test-d.ts' -g 'fixtures/*.ts' | rg -v '__unbound__|public|auth|tenant'
```

### Generic project anti-patterns (cross-cutting)

```bash
# Transient project artefact references in long-lived docs:
rg 'Project [12]|\bD[1-9]\b|\(FR[0-9]+\)|\(T[0-9]+\)|AC-[A-Z][A-Z0-9-]*|\bR[0-9]+B?\b|\bF[1-7]\b|\bM[12]\b|per spec|the spec\b|spec calls|spec wording|spec promises|sub-spec|milestone' -- ':!projects/' ':!*.generated.*'

# File-extension imports in TS (which we don't allow):
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/

# `any` type usage (which we don't allow):
rg ': any\b|\bany\[\]' packages/ -g '*.ts' -g '*.tsx'

# @ts-expect-error outside negative type tests:
rg '@ts-expect-error' packages/ -g '*.ts' -g '!*.test-d.ts'

# @ts-nocheck (forbidden):
rg '@ts-nocheck' packages/
```

### Architecture hygiene (substitute for `pnpm lint:deps` when faster signal is needed)

```bash
# Cross-domain imports that should go through exports/ barrels:
# (Project-specific; replace with the actual concerning import patterns when they arise.)
```

### When to extend the library

Add a new pattern when:

- A failure mode in § 3 is detected by a pattern not already in the library.
- An anti-pattern slips past `pnpm lint:deps` or the type system but is caught by ad-hoc grep.
- A corrective round introduces a new "must-not-return" pattern (like `foreignKeyNamespacesMatch`).

---

## 5. Model-tier routing (project-specific)

Per [`decomposition-and-cost.md`](../principles/decomposition-and-cost.md), dispatches route to model tiers based on dispatch shape. For prisma-next:

| Dispatch shape | Recommended tier |
|---|---|
| Substrate change / design judgment / spec interpretation | Opus (orchestrator tier) |
| Codemod / mechanical migration / batch fix | Sonnet or composer-2 |
| Test-literal rewrites / fixture regen | composer-2 or composer-2-fast |
| Spike (read, count, structure findings) | Sonnet or composer-2 |
| Architect-class finding remediation (single discipline, narrow surface) | Sonnet |
| Long-running validation gate runs (typecheck, test:packages) | Whichever tier the parent dispatch chose (no model dispatch — just bash) |

This is a starting calibration. Update as we learn which tier successfully completes which dispatch shape.

---

## 6. Maintenance

All sections of this calibration are updated **trigger-based, not periodically**. The triggers are:

- **Significant post-mortem.** Any incident where a dispatch produced a failure the protocol didn't catch (today's reversal is the reference example). Every such post-mortem produces updates to one or more sections; if it produces no updates, the post-mortem failed to extract a lesson.
- **New verification tooling lands.** A new lint script, a new test harness, a new check command — extends § 2 (DoD gates) and possibly § 4 (grep library).
- **Repeated dispatch outcomes contradict § 5 routing.** If a tier choice consistently fails on a dispatch shape, the routing entry is wrong; update.
- **Project nature shifts.** If the project moves from greenfield to maintenance, from one dominant subsystem to another, or otherwise changes shape, the reference tasks in § 1 may no longer represent useful anchors; recalibrate.

Per-section update discipline:

- **Reference tasks (§ 1).** Recalibrate when the post-mortem reveals that an estimated M was actually L (the dispatch failed in ways the M-tier treatment couldn't catch). Add a worked example showing the miscalibration and the corrected anchor.
- **DoD gates (§ 2).** Extend when a new verification tool lands or when a post-mortem reveals a gap the existing gates didn't cover.
- **Failure-mode catalogue (§ 3).** **Append on every post-mortem.** Never remove (entries become historical context; the team that hits the failure mode for the second time consults the existing entry rather than re-discovering it). If an entry's mitigation proves inadequate (the same failure mode recurs despite the mitigation), update the mitigation rather than removing the entry — and note the recurrence as a sub-incident under the same entry.
- **Grep library (§ 4).** Extend on every post-mortem that surfaces a new anti-pattern. Mark entries as historical (don't delete) when the underlying anti-pattern is structurally impossible (e.g. removed at the type level, eliminated by a substrate change).
- **Model-tier routing (§ 5).** Adjust as we accumulate dispatch outcomes per tier. Trigger: three consecutive failed dispatches at a tier the table recommends, OR a post-mortem that names the tier choice as a contributing factor.

This document is intended to live in `prisma-next`'s `docs/` once the methodology stabilises. While we're still iterating, it lives here in the methodology project. When it migrates, the file path changes and references are updated; the maintenance discipline does not.
