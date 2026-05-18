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
- **End-of-dispatch gates** (before reporting done): the full conditional set + brief-specified gates. **`pnpm test:packages` is mandatory** when source or test code changed anywhere in the monorepo, even if the dispatch was scoped to a single package — cross-package regressions are common and the bulk run takes ~1 min. Per-package `pnpm test` is a development convenience, not a DoD gate.
- **End-of-round gates** (orchestrator-side, post-implementer-report): orchestrator re-runs the grep gates independently to confirm; spot-checks the diff for spec compliance.

### Pre-QA gates (always)

A manual-QA dispatch (`drive-qa-run` or any human-style QA pass) MUST be preceded by a green full test suite (`pnpm test:packages` + `pnpm typecheck` + `pnpm fixtures:check`). The QA round's job is to surface what tests cannot meaningfully assert — diagnostic clarity, end-to-end journey breaks, judgement calls. **It is not a substitute for the test suite.** Dispatching QA against an unverified tree wastes the runner's time discovering broken assertions that a 1-minute `pnpm test:packages` would have surfaced — and contaminates the report with downstream artefacts of the un-caught regression. If the test suite has known-pre-existing failures, document them explicitly in the QA brief so the runner can filter them out of their findings.

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

### 3.6 Orchestrator widens check intervals once commits look clean

**Symptom.** Orchestrator starts a dispatch with a 5-min standup cadence, observes 1-2 clean commits in the first 10 min, then drifts to 10/15/25-min check intervals because "the implementer seems on track." Drift compounds: the next missed check is later, the next is later still. The implementer can be 30+ min into unilateral scope expansion before the orchestrator looks again.

**Detection signal.**

- Orchestrator's poll/sleep cadence in the conversation transcript shows widening intervals (5 → 10 → 20 → 30 → 45 → 60 → 80 …).
- A scope expansion (e.g. substrate change beyond the brief) lands in a commit several intervals before the orchestrator notices.
- Orchestrator's rationale for widening is "git evidence looks clean" — file-system-proxy monitoring rather than diff-reading.

**Mitigation.**

- Keep `AwaitShell` `block_until_ms` at 5 min throughout the budget. The cost of an extra check is one shell call; the cost of missing drift is hours of rework.
- The 5-min check is a *standup*, not a status request. Read the most recent commit's diff. Verify it lines up with the brief's stated discipline. Verify no out-of-brief files were touched.
- Brief should pre-name the "blast zones" — packages / files the dispatch is authorised to touch and packages / files it is not. The 5-min check confirms the diff stays inside the authorised zone.
- Logging discipline: every 5-min check produces a one-line orchestrator note (`T+15: commit Y lands; matches discipline Z; on track`). If a check produces no note, the check didn't happen — even if `AwaitShell` ran.

**Reference incident.** 2026-05-17, demo-namespace lift dispatch (`5ea8bec8`). Orchestrator dropped from 5-min checks at T+10 to 10/15/25-min intervals through T+80. Scope expanded from M (demo lift) to L (demo lift + 3 substrate fixes including a 236-line SQL-stack propagation commit) between checks. The expansion turned out to be justified (real M5a/M5b gaps surfaced), but the orchestrator did not know that in real time. Could equally have been unjustified scope creep going uncaught.

### 3.7 Per-package DoD gates miss cross-package regressions

**Symptom.** Implementer brief specifies DoD gates scoped to the package(s) the dispatch is editing (e.g. `cd examples/X && pnpm test`). Implementer reports green; orchestrator accepts; downstream QA / merge / next-dispatch discovers test failures in *other* packages that consume the edited surface. The failures were always there — the gates just didn't run them.

**Detection signal.**

- Brief's DoD gate list scopes test runs to single packages (`cd path && pnpm test`, `pnpm --filter X test`).
- Diff touches IR types, validators, serialisers, or anything else exported to consuming packages.
- Implementer's report says "all tests pass" but the implicit scope is "all tests *in my package* pass."
- QA / next dispatch / `pnpm test:packages` later surfaces failures in unmodified packages.

**Mitigation.**

- Every dispatch whose diff touches source or test code includes `pnpm test:packages` as a mandatory final gate (per § 2's pre-QA discipline). It takes ~1 min and catches cross-package fan-out.
- Brief explicitly says "the full monorepo test suite is the gate; per-package runs are for your iteration loop." Per-package `pnpm test` is a development convenience that is NOT sufficient evidence the dispatch is done.
- Orchestrator's end-of-round check re-runs `pnpm test:packages` independently rather than trusting the implementer's report.

**Reference incident.** 2026-05-17, demo-namespace lift dispatch (`5ea8bec8`). Brief specified `cd examples/prisma-next-demo && pnpm test` as gate #2. Implementer reported green. The downstream QA round (`52750a6c`) discovered 20/21 failing tests in `packages/2-sql/2-authoring/contract-ts/test/contract.parameterized-types.test.ts` — pre-existing flat-shape fixture failures from the earlier reversal sweep that the demo-scoped gate never ran. The failures had been latent since the reversal commits landed and would have been caught by `pnpm test:packages` at any dispatch's end-of-round check. (Same failure class as the earlier "264 test failures" the session diagnosed as PGlite flakiness — bulk-test signal undervalued.)

### 3.8 "If-available" preconditions degrade to "skip" exits

**Symptom.** Brief specifies "if X is available, do Y; otherwise mark Not Run." Runner / implementer treats the absence of X as a terminal condition and skips Y entirely, rather than provisioning X. The coverage gap goes uncollected when the orchestrator could have specified a provisioning fallback.

**Detection signal.**

- Brief contains phrases like "if no PG is available, skip this step" / "if `.env` is configured, …" / "(optional, if real DB)".
- Runner's report marks scenarios as "Not Run" with the reason being precondition absence rather than substantive blocker.
- The precondition is trivially provisionable (docker run, prisma dev, local binary already installed) — the runner just wasn't told to provision.

**Mitigation.**

- Brief must specify the provisioning fallback for every precondition the runner can satisfy themselves. For Postgres: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17` then `DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`. For Mongo: equivalent docker invocation. For prisma dev: `pnpm prisma dev`.
- Briefs use the form "ensure X is available (provision via Y if needed)" rather than "if X is available, …".
- A scenario / DoD gate can only legitimately be marked Not Run when the precondition is genuinely unprovisionable (e.g. external SaaS account, hardware, license).

**Reference incident.** 2026-05-17, drive-qa-run dispatch (`52750a6c`). Brief said "if no PG, mark scenario 4 as Not Run." Runner correctly marked it Not Run. Cost: AC6 (the late-binding multi-tenancy scenario) was not exercised this QA round — the headline user-facing capability that scenario 4 was specifically designed to demonstrate. The brief should have said "if no PG, start one via `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17` or `prisma dev`, then proceed."

### 3.10 Sonnet-low under-reasons through strict anti-pattern guards

**Symptom.** A dispatch with explicit anti-pattern guards (e.g. "no `wrapInUnbound` helper", "no `'columns' in` probe", "canonical shape only") on `claude-4.6-sonnet-low-thinking` exhibits one or both of:
- **Recon paralysis.** Implementer spends 10+ min reading files / running test suites without making any edits, falling into the § 3.3 pattern of using the test suite as a discovery mechanism instead of grep.
- **Soft adherence to guards.** Implementer technically avoids the named anti-pattern but reintroduces functionally-equivalent behaviour under a different name (§ 3.1).

**Detection signal.**

- 5-min standup at T+10 shows `git status -s` returns zero modifications despite a 25-min M dispatch.
- Implementer's first action after a brief that explicitly says "use grep" is to run `pnpm test:packages`.
- Diff includes a small helper with a docstring like "for compatibility with X-shape inputs" — the alibi for the relocated dual-shape support.

**Mitigation.**

- Route per § 5: `composer-2` (or `claude-4.6-opus-high-thinking` for judgment-heavy) for any dispatch with strict anti-pattern guards. Reserve `claude-4.6-sonnet-low-thinking` for XS dispatches with no rule to enforce.
- If you must use Sonnet-low, the brief's anti-pattern section must be even more explicit (concrete forbidden function names, concrete grep patterns to run first) and the standup interval must drop from 5 min to 3 min.
- Orchestrator kick at T+10 (not T+15) if `git status -s` shows zero modifications.

**Reference incident.** 2026-05-17, sql-orm-client migration dispatch on `claude-4.6-sonnet-low-thinking`. Implementer spent 15+ min in recon (running tests, reading files) with zero file modifications. After an orchestrator kick at T+15 with explicit `grep` + `find` commands, implementer executed correctly in <5 min and even diagnosed the real `structuredClone`-strips-non-enumerable root cause. Same model tier had been used for three earlier dispatches that committed cleanly — the difference was the sql-orm-client surface required identifying shared helpers, which Sonnet-low couldn't plan upfront without prompting.

### 3.11 Recon grep undercounts consumer surface when IR type changes shape

**Symptom.** A substrate refactor changes the type of a widely-consumed field (e.g. `SqlStorage.tables` from flat `Record<string, StorageTable>` to nested `Record<string, Record<string, StorageTable>>`). The dispatch brief's recon greps for the about-to-be-deleted symbols (`tablesByNamespace`, `nestedTablesView`, etc.) and for flat subscript access (`storage.tables[someName]`). Both greps return a manageable hit list. The implementer proceeds, commits the substrate change, and discovers at typecheck time that the real consumer surface is 3-5x larger: source code and test fixtures in downstream packages that typed `storage.tables` as flat, constructed `SqlStorage` with flat fixture shapes, or accessed `.tables[name]` via a variable not caught by the literal-string grep.

**Detection signal.**

- Recon grep returns ~5-10 hits; full `pnpm typecheck` after the substrate commit surfaces 50-100 errors across 10+ files.
- Errors are in packages the recon grep didn't scan (e.g. `family-sql`, `extensions`, `adapters`) or in fixture-construction sites where the flat shape was inlined rather than subscripted.
- The substrate change is clean and correct; the gap is in consumer migration volume, not substrate design.

**Mitigation.**

- After the substrate commit, run `pnpm typecheck` immediately (before committing consumer migrations) to discover the true consumer surface. The typecheck is a 5-second operation and reveals every site the type system can see.
- If typecheck reveals >20 additional sites, STOP and re-estimate: the dispatch is probably L, not M. Commit what's done, report PARTIAL, and sequence the consumer migration as its own M dispatch.
- Phase-1 fixture migration ("migrate ALL fixtures to canonical-nested") must be verified by typecheck against the new type, not by grep alone. Grep catches string-literal patterns; typecheck catches structural incompatibility.

**Reference incident.** 2026-05-17, "kill dual-shape storage" dispatch. Recon grep for `tablesByNamespace|nestedTablesView|freezeFlatTablesView` found ~6 consumer files. After the substrate commit, `pnpm typecheck` revealed 50+ errors across `family-sql` source (`contract-to-schema-ir.ts`, `field-event-planner.ts`, `verify-sql-schema.ts`), `family-sql` test fixtures (`contract-to-schema-ir.test.ts`, `schema-verify.basic.test.ts`), and extension/target test files. The substrate change was correct; Phase 1 had not migrated all fixture-construction sites to the nested shape. The dispatch was correctly stopped at PARTIAL and the remaining consumer migration sequenced as follow-up.

### 3.13 Orchestrator scopes a bridge as "contained" when the underlying mismatch is a framework-level type invariant

**Symptom.** A substrate refactor changes the type of a widely-consumed field. The orchestrator surveys the failure surface, sees that one package (the DSL — `sql-builder` in the reference incident) has type-machinery that depends on the old shape, and proposes a "contained bridge in that one package" to keep the substrate shipping while deferring the broader migration. The bridge ships. Typecheck cascade then reveals the same root cause in N other packages that were previously hidden behind the first package's cascading failure — packages the orchestrator never surveyed because the cascade had short-circuited their reporting.

**Why this is structurally different from § 3.7 (per-package gates miss cross-package regressions).** § 3.7 is about DoD gate scoping after a dispatch lands. § 3.13 is about *brief scoping before dispatch* — the orchestrator made a containment claim that wasn't true and structured the dispatch around it. The implementer correctly executed the brief; the brief was wrong.

**Detection signal.**

- Orchestrator's containment claim takes a form like "the bridge in package X handles all the consumers; emitter/substrate/<framework-level shape> stays unchanged." The claim is testable: it requires zero new typecheck failures in any package outside X after the bridge lands.
- The substrate change touches a type that's parameterised through the framework (`Contract<TStorage>`, `Storage`, `SchemaNode<…>`, etc.) rather than a target-specific or DSL-specific type. Framework-level types propagate through every consumer; "containing" them in one package is structurally impossible.
- Pre-bridge typecheck shows N packages failing with cascade-truncated errors (only the first failure per dependency chain is reported). The orchestrator surveys the visible failures (1 package) without recognising that the cascade hides siblings.

**Mitigation.**

- **Before claiming containment**, run `pnpm typecheck --filter <each-package-individually>` (or equivalently disable Turbo's failure short-circuit) to see the FULL failure surface, not the cascade-truncated view. Cost: ~30s extra; reveals whether containment is structurally possible.
- **Cleavage test for the bridge claim:** if the bridged type is *parameterised through the framework* (e.g. `Contract<TStorage>.storage.tables` — the type is reachable from any consumer that imports `Contract`), the bridge cannot contain it. The bridge can only contain types that are *exposed by the DSL only* (e.g. `Db<C>.<tableName>` — only sql-builder's `Db` exposes this surface).
- **Brief honesty rule:** if the orchestrator cannot demonstrate containment with the pre-dispatch typecheck survey, the brief must NOT make the containment claim. Either the dispatch scope expands to cover the full propagation surface, or the substrate change is deferred until the propagation can be planned.
- **Recovery when caught post-bridge:** acknowledge the scoping mistake explicitly to the human, present the corrected scope (typically: extend the dispatch to cover the propagation surface — emitter, all generated fixtures, framework type updates), and document the calibration debt. Do NOT push through with hand-edited per-package fixtures (brittle, self-reverting under `fixtures:check`) or with type-level dual-shape support (the exact anti-pattern that was just deleted).

**Reference incident.** 2026-05-18, TML-2520 M5c Phase 3 — orchestrator (this calibration's author) proposed a `FlatTablesOf<C>` bridge inside `sql-builder` to defer the emitter migration to TML-2550, claiming the bridge would contain the substrate change. Composer-2's bridge dispatch (`c2903c314`) executed the brief correctly and cleared `@prisma-next/sqlite` typecheck (the original visible failure). The cascade then unmasked 7 sibling packages failing with the same root cause — `@prisma-next/postgres`, `@prisma-next/sql-orm-client`, plus 4 demo apps and `paradedb-demo` — each one a consumer passing a generated flat-shape `Contract` to a function expecting `Contract<SqlStorage>` (nested). The bridge couldn't shield those consumers because `Contract<TStorage>.storage.tables` is a framework-parameterised type, not a DSL-local one. Correction: emitter migration brought into PR2 scope as Phase 3; bridge in `sql-builder` retained for DSL ergonomics only; full DSL redesign deferred to TML-2550 (which is the genuinely separable part — the bridge's `Db<C>` flatten could have been scoped to "contained" honestly because `Db<C>` is exposed by sql-builder only).

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

# Deleted dual-shape storage helpers (killed in "kill dual-shape storage" dispatch):
rg 'tablesByNamespace|typesByNamespace|nestedTablesView|nestedTypesView|freezeFlatTablesView|freezeFlatTypesView|installAmbiguousFlatGetter' packages/
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

Per [`decomposition-and-cost.md`](../principles/decomposition-and-cost.md), dispatches route to model tiers based on dispatch shape. **Models routed are Claude-family + composer-2 only** (the prisma-next worktree avoids GPT). For prisma-next:

| Dispatch shape | Recommended tier |
|---|---|
| Substrate change / design judgment / spec interpretation / refactor with cross-package fanout | `claude-4.6-opus-high-thinking` (or `claude-opus-4-7-thinking-xhigh` for the heaviest refactors) |
| Codemod / mechanical migration / batch fix WITH strict canonical-shape rules | `composer-2` (NOT Sonnet-low — see § 3.10) |
| Test-literal rewrites / fixture regen — small surface, no interpretation needed | `composer-2-fast` |
| Spike (read, count, structure findings) | `composer-2` |
| Architect-class finding remediation (single discipline, narrow surface) | `composer-2` if mechanical, `claude-4.6-opus-high-thinking` if judgment-heavy |
| Long-running validation gate runs (typecheck, test:packages) | No model dispatch — just bash |

**Anti-routing.** `claude-4.6-sonnet-low-thinking` is too low-reasoning for dispatches with strict anti-pattern guards (see § 3.10). Reserve for trivial XS dispatches (one-file mechanical edits with no rule to enforce). Default to `composer-2` for anything larger.

This is a calibration based on observed outcomes; update as we learn which tier successfully completes which dispatch shape.

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
