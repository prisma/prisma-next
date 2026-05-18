# Principle: Definition of Done Gates Handoff at Three Scopes

## Thesis

**Definition of Done (DoD)** is the team's verification checklist for completing a unit of work. If DoD is not satisfied, the unit is not done — the implementer either resolves the gap before declaring done or the gap is escalated as a design discussion. DoD is the structural fix for the failure mode where a unit "looks done" but isn't, and the gap is discovered downstream (broken build, escapee bug, post-merge revert).

DoD gates **three scopes**: project, slice, dispatch. The shape is the same at every scope (a checklist with pass/fail items); the content scales with the unit. The protocol carries the shape; calibration carries the content.

DoD is the *handoff* gate. Definition of Ready (previous principle) is the *pickup* gate. Together they bookend every unit of work.

## Why DoD matters

Two failure modes DoD is designed to prevent:

1. **Done-looking unit that wasn't.** A dispatch declares done because the implementer felt finished; the reviewer subagent has no checklist to verify against; drift slips through; the failure is discovered later. The cost is the unwind + the recovery + the retro.
2. **Verification gap blamed on the implementer.** Without an explicit gate, "I thought we tested that" becomes the recurring excuse. The protocol absorbs blame for what its gates didn't catch; the team doesn't learn structurally; the gap recurs.

The gate is the structural fix. A unit either passes its DoD or it doesn't. If it doesn't, the work is to resolve the gap, not to declare done.

DoD has a stronger structural role than DoR for one reason: **DoD is the contract the reviewer subagent verifies.** Without it, the reviewer has nothing sharp to check — only "does this look right?" which is fragile. With it, the reviewer runs the same commands and asks the same questions every time.

### CI gates, intent-validation, and manual QA are three different things

A common DoD failure mode is conflating these. Each closes a different gap:

- **CI gates** (typecheck, test, lint, grep checks) verify the *mechanical* contract: the code compiles, the tests pass, the patterns the team forbids are absent. CI is throughput-optimised; it doesn't judge.
- **Intent-validation** verifies that the work delivered *what the spec asked for*, not a literal-correct-but-spec-wrong implementation. The orchestrator-tier reads the dispatch summary + the diff and decides. This catches "the grep gate passes because the implementer routed around it" — see the worked example below.
- **Manual QA** verifies what *CI cannot meaningfully cover*: diagnostic clarity, end-to-end developer journey, re-enactment of the originally-failing user flow, gate-of-gate sanity (planting a violation to confirm the new guard fires), and exploratory probing. Authored as a script via `drive-qa-plan` and executed via `drive-qa-run` (both per [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93)); the report classifies findings by severity (🛑 Blocker / ⚠️ High / 📝 Follow-up). Manual QA isn't every dispatch's gate — it's a slice-scope and project-scope gate that fires when the change has user-observable surface.

Slice DoD includes all three; pure-refactor slices may explicitly mark manual QA "N/A — no user-observable change" (the QA skill body endorses this as a legitimate outcome).

## DoD at three scopes

### Project DoD

A project is done when:

1. **All planned slices delivered (or explicitly cancelled).** The project plan accounts for every slice — either merged, scope-deferred at slice close, or abandoned with rationale.
2. **All direct changes composed under the project delivered.** Same accounting.
3. **Project's stated outcomes hold.** The purpose statement's "what is true that wasn't before" is now true. Each scope-boundary commitment has been met (or sharpened-down with documentation).
4. **Deferred-work bundle reviewed.** `projects/<x>/deferred.md` items have each been triaged individually (adopt as new project / slice / direct change; route to backlog; drop).
5. **Long-lived docs migrated.** Anything from `projects/<x>/` that needs to live past project close-out has been moved to `docs/` (or a canonical home) and its references updated.
6. **Manual-QA coverage across the project's user-observable surface.** Every slice that touched user-observable surface has a `drive-qa-plan`-shaped script and at least one `drive-qa-run` report against it; no 🛑 Blocker findings remain unresolved across those reports. Pure-refactor slices are explicitly marked "N/A — no user-observable change" in their slice DoD; the project DoD check confirms the marking is honest (a refactor slice with user-visible side-effects that wasn't QA'd is the gap to find here). The project-specific QA expectations (audiences, substrate locations, known coverage-gate gaps) live in `drive/qa/README.md` per the project-context convention from PR #93.
7. **Final retro complete.** Per [`retro.md`](retro.md), the project close retro is mandatory. The retro must produce a protocol / calibration / ADR update; if none, the retro failed.
8. **Linear cleanup done.** Linear Project is marked Completed (or Cancelled, with rationale in the final status update); any open issues under it are closed; the original promoted ticket (if applicable) reflects project completion.
9. **`projects/<x>/` deleted.** The transient project directory is removed (per the transient-projects discipline). Useful content was migrated under step 5; the rest is dropped.

Project DoD is the most consequential gate — it's the only one that fires the mandatory retro. Skipping it is the surest way to lose institutional memory.

### Slice DoD

A slice is done when:

1. **Slice spec's outcome is met.** The PR delivers what the slice spec declared.
2. **All dispatches in the slice plan are done** (each satisfied its dispatch DoD).
3. **PR is review-clean.** Reviewer (distinct from implementer) has accepted; findings are addressed or explicitly accepted.
4. **Intent-validation passes.** Per `drive-orchestrate-plan`'s intent-validation step — the orchestrator-tier model has confirmed the slice's PR delivers the spec's intent, not just the literal acceptance criteria.
5. **No silent spec/plan amendments survived.** Per invariant I12, every amendment after the first dispatch started was the output of design discussion or operator-authorised. The slice spec on merge matches either the original or the explicitly amended version.
6. **Manual QA satisfied.** If the slice touched user-observable surface: a `drive-qa-plan`-shaped script exists (`projects/<project>/manual-qa.md` for in-project slices; inline in the PR description's QA section for orphan slices); at least one `drive-qa-run` report exists; no 🛑 Blocker findings remain unresolved; ⚠️ High findings are addressed or explicitly accepted; 📝 Follow-up findings are captured (in `deferred.md` for in-project; in the PR description for orphan). If the slice did *not* touch user-observable surface, the slice DoD records "Manual QA: N/A — no user-observable change" with a one-line rationale. Project-specific QA conventions (audiences, substrate locations, coverage-gate gaps) come from `drive/qa/README.md` per the PR #93 project-context convention.
7. **Slice-DoD calibration items pass.** Team-specific items from calibration overlay.
8. **Slice closure rituals complete.** Scope-deferred candidates surfaced and recorded; retro triggered if a learning surfaced (not mandatory unless project DoD); next slice (if stacked) is unblocked.

### Dispatch DoD

A dispatch is done when:

1. **All validation gates from the brief's DoD section pass.** Specific commands run; specific greps return as expected; specific intent-level criteria met. Per [`brief-discipline.md`](brief-discipline.md).
2. **No edge case from the brief's Example-Mapping table was silently accommodated.** Each edge case either (a) didn't occur, (b) was handled per the disposition, or (c) escalated per its "refuse and surface" disposition. The implementer's dispatch summary names which.
3. **No scope-out items touched.** WIP-inspection's diff-reading verifies the dispatch's commits stay within the brief's scope-in. If scope-out items were touched, the dispatch is not done (or the brief was wrong — separate concern).
4. **Reviewer subagent verdict is accept.** Reviewer ran the validation gates independently; verdict is accept (with findings, if any, addressed or accepted).
5. **Intent validation passes.** Orchestrator (or the persona's wearer) confirms the dispatch produced what the brief described, not a literal-correct-but-spec-wrong implementation.
6. **Per-slice review artefacts refreshed.** `code-review.md`, `system-design-review.md`, `walkthrough.md` (per `drive-orchestrate-plan`) reflect what the dispatch landed.
7. **(Spike-flavoured) Artefact exists at named path with named shape.** Per [`spikes.md`](spikes.md).

Dispatch DoD is the gate the agile orchestrator runs at the post-flight step of `drive-orchestrate-plan`. Every dispatch passes through it; no exceptions.

## DoD templates (starter)

Calibration overlays project-specific items.

### Project DoD template

```markdown
## Project DoD

- [ ] All planned slices delivered (or explicitly cancelled with rationale)
- [ ] All composed direct changes delivered
- [ ] Stated outcomes hold (purpose statement's "true now" check passes)
- [ ] Deferred-work bundle reviewed (each item triaged individually)
- [ ] Long-lived docs migrated to durable homes (docs/ or equivalent)
- [ ] Manual-QA coverage adequate across user-observable surface
       (every slice that touched it has a script + at least one run report;
       no unresolved 🛑 Blocker findings; refactor slices honestly marked N/A;
       project-specific QA expectations sourced from drive/qa/README.md)
- [ ] Final retro complete with protocol / calibration / ADR update
- [ ] Linear cleanup done (project Completed/Cancelled; issues closed;
       promoted ticket reflects completion if applicable)
- [ ] projects/<x>/ deleted

# Calibration overlays
- [ ] <team-specific item — e.g. "Customer success notified of feature
       availability with the agreed messaging">
- [ ] <…>
```

### Slice DoD template

```markdown
## Slice DoD

- [ ] Slice spec's outcome met (PR delivers what the spec declared)
- [ ] All dispatches in slice plan are done (each satisfied dispatch DoD)
- [ ] PR is review-clean (different-actor reviewer; findings addressed/accepted)
- [ ] Intent-validation passes (orchestrator-tier confirms intent delivered,
       not just literal acceptance criteria)
- [ ] No silent spec/plan amendments (every change was operator-authorised
       or design-discussion output, per I12)
- [ ] Manual QA satisfied: drive-qa-plan script exists; ≥1 drive-qa-run
       report exists; no unresolved 🛑 Blocker findings; ⚠️ High findings
       addressed or accepted; 📝 Follow-ups captured
       — OR explicitly "N/A — no user-observable change" with a rationale
       (project-specific shape per drive/qa/README.md)
- [ ] Scope-deferred candidates recorded (in projects/<x>/deferred.md
       or operator scratch)
- [ ] Retro fired if learning surfaced (not mandatory at slice scope,
       but checked as a question)

# Calibration overlays
- [ ] <team-specific item — e.g. "Linear issue moved to 'Ready to be
       merged' (the team's terminal-before-merge state)">
- [ ] <…>
```

### Dispatch DoD template

```markdown
## Dispatch DoD

- [ ] Validation gates from brief's DoD section all pass
- [ ] Every brief edge case either didn't occur, was handled per disposition,
       or was escalated per "refuse and surface" — named in dispatch summary
- [ ] No scope-out items touched (WIP-inspection diff-reading verified)
- [ ] Reviewer subagent verdict is accept (with findings addressed/accepted)
- [ ] Intent validation passes (dispatch produced what brief described)
- [ ] Per-slice review artefacts refreshed
       (code-review.md / system-design-review.md / walkthrough.md)
- [ ] (Spike-flavoured) Artefact exists at named path with named shape

# Calibration overlays
- [ ] <team-specific item — e.g. "Brief's referenced calibration entries
       were checked during execution and noted as 'avoided' in the
       dispatch summary">
- [ ] <…>
```

## What DoD is and isn't

DoD is **a handoff gate.** Not a quality wishlist. Not negotiable. Not a substitute for code review.

What DoD is *not*:

- A perfectionism filter. DoD is the *contractual minimum* — the things that, if missing, mean "not done." Aspirational quality goes in other places.
- A re-statement of DoR. DoR is "ready to start" (per [`definition-of-ready.md`](definition-of-ready.md) § Terminology); DoD is "complete." Different concerns.
- A code review. Code review is a richer human / agent activity; DoD is the structural gate that bookends every unit. (For slices, the reviewer's verdict IS a DoD item; the rest of the slice DoD doesn't replace the review.)
- A snapshot of CI gates only. DoD also includes intent-validation (orchestrator-tier check that the work delivers the brief's intent, not just the literal gates) and — for slices that touch user-observable surface — manual QA. CI / intent / manual-QA cover three distinct gap classes; skipping any one leaves a class uncovered.

What DoD *is*:

- A pass/fail checklist. Every item is checkable, not interpretive.
- The team's accumulated handoff wisdom (calibration overlay grows; protocol layer stays small).
- Run by the agile orchestrator at handoff time — post-dispatch; post-slice (with reviewer's verdict as a gate item); at project closure.

## Anti-patterns this principle calls out

1. **"Soft" DoD.** Items skipped under deadline pressure. The structural protection erodes; drift slips through. The gate must be enforced — by `drive-orchestrate-plan` refusing to close a dispatch with unmet DoD; by slice-closure refusing to merge with unmet slice DoD; by `drive-close-project` refusing to delete `projects/<x>/` with unmet project DoD.

2. **DoD = CI gates only.** Skips intent-validation and manual QA. Symptom: typecheck/test/lint all pass, but the dispatch silently solved the wrong problem (today's reversal failure mode) or shipped a feature whose CLI diagnostic is incomprehensible because CI doesn't read English. Intent-validation is non-optional in dispatch and slice DoD; manual QA is non-optional in slice DoD whenever the change touches user-observable surface (`drive-qa-plan` + `drive-qa-run` are the skills).

3. **DoD authored by the implementer post-hoc.** The brief's DoD is the contract; the implementer cannot edit the gate they're being evaluated against. (Operator-authorised edits during the dispatch are fine via design discussion; silent implementer-side edits are forbidden by I12.)

4. **Wishlist DoD.** Items like "the code is elegant" or "the abstractions are right." Uncheckable; doesn't gate handoff. Aspirational quality belongs in code-review feedback, not in DoD.

5. **Project DoD without the mandatory retro.** The retro is the team's only learning mechanism (per [`protocol-as-memory.md`](protocol-as-memory.md)). Skipping it means the project's lessons don't accrete into protocol / calibration. The next project re-discovers the same failures.

6. **Slice DoD relies on the implementer being the reviewer.** Violates the role separation in [`roles-and-personas.md`](roles-and-personas.md). The reviewer must be a different actor; otherwise the adversarial reading doesn't form, and DoD passes that should have failed.

7. **DoD items that depend on environment nobody set up.** A check that runs only on a particular operator's laptop is not a DoD item — it's a private gate. DoD items run reliably in the team's standard execution context (CI, the implementer subagent's environment, etc.).

8. **DoD waived when "the work is obviously fine."** Same failure mode as DoR waiver. The gate fires *especially* when the work seems fine — that's when subtle drift is most likely to pass without scrutiny.

## Worked example: a dispatch that almost satisfied DoD but didn't

Continuing the `StorageTable` migration dispatch from [`brief-discipline.md`](brief-discipline.md):

After dispatch run, the implementer subagent reports done. Dispatch DoD check:

- [x] Validation gates from brief: `pnpm typecheck` clean ✓; `pnpm test:packages` passing ✓; `rg "tables: \{" -- 'packages/*/src/test/**'` empty ✓ (for the 8 migrated sites); no new TODOs ✓; per-site commit messages reference spike artefact ✓
- [x] Every edge case handled per disposition: one site flagged as intentionally legacy-shape (skipped per disposition); one fixture file deferred per disposition; two sites mixed legacy+flat surfaced per disposition (escalated; resolved by operator before dispatch ended)
- [x] No scope-out touched: WIP-inspection's diff-reading verifies only the 8 sites + named fixture files + the source spike artefact were changed
- [x] Reviewer subagent verdict: accept
- [ ] **Intent validation: FAIL.** The orchestrator-tier check reads the dispatch summary + the diff and notes: "two of the eight sites used a partial migration that *technically* satisfies the grep gate but doesn't actually move to the new shape — the `tables: {…}` literal is gone but it's replaced with a programmatic `Object.fromEntries(...)` that re-creates the same flat structure. The grep passes; the intent (move to a literal flat shape) doesn't."
- [x] Per-slice review artefacts refreshed

Six checked, one unchecked. Dispatch DoD not satisfied. The implementer's work was clever — it routes around the grep gate while not delivering the spec's intent. Without intent-validation, this dispatch would have shipped; the next dispatch (Postgres-introspector tightening) would have been built on a substrate that doesn't actually match the intended shape.

Work to resolve: a follow-up dispatch (sized S) that converts the two programmatic-flat-shape sites to literal-flat-shape. Adds the failure mode "grep-gate routed around with programmatic equivalent" to the calibration's failure-mode catalogue (so future briefs name it as an edge case).

## How calibration overlays the protocol

Worked example for `prisma-next`:

- **Project DoD calibration:** A linkable summary of the project's outcomes is added to the relevant team's docs index; any new architecture docs are linked from `docs/architecture docs/`; Linear status update with final retro link; `drive/qa/README.md` reviewed and updated if the project surfaced new audiences or coverage-gate gaps.
- **Slice DoD calibration:** Linear issue moved to "Ready to be merged" (the team's terminal-before-merge state); PR title carries Linear ticket prefix; PR description follows `drive-pr-description` shape; the manual-QA script (when applicable) names the two consumer audiences `prisma-next` typically QAs against (extension authors via `packages/3-extensions/`, end users via `examples/`).
- **Dispatch DoD calibration:** Brief's calibration entries were checked during execution and noted as "avoided" in the dispatch summary; the team's standard test invocation (`pnpm test:packages`) is in the DoD section; `pnpm lint:deps` check is in the DoD section for any dispatch touching package imports.

Same growth-by-retro-accretion pattern as DoR's calibration overlay.

## Practical implications

1. **The agile orchestrator runs DoD at three scopes.** Post-dispatch; post-slice (with reviewer's verdict); at project closure. Failure routes to gap-resolution.
2. **Skills enforce DoD.** `drive-orchestrate-plan` (dispatch DoD), slice-closure (slice DoD), `drive-close-project` (project DoD). A skill that proceeds with unmet DoD is broken.
3. **Intent-validation is part of DoD at dispatch + slice scope.** Not optional. Per the workflow map, intent-validation is what the orchestrator-tier confirms before accepting handoff.
4. **Calibration's DoD overlay is part of the team's protocol-as-memory.** Per [`protocol-as-memory.md`](protocol-as-memory.md), the overlay grows by retro accretion.
5. **Project DoD's mandatory retro is the gate's gate.** A project that finishes without the retro hasn't satisfied DoD; the gate hasn't fired; the team hasn't learned. The retro is non-optional.
6. **Unmet DoD discovered post-handoff is a retro trigger.** The gate missed something — what should the gate have caught? The answer goes into calibration's DoD overlay.

## Failure mode this principle directly prevents

Two failure modes:

- **Done-looking-but-not.** A unit declares done by feel; gaps surface downstream as broken builds, escapee bugs, post-merge reverts. DoD catches the gap at handoff, before downstream cost accrues.
- **Verification gap blamed on the implementer.** Without an explicit gate, recurring gaps get attributed to the implementer's attention. The gate makes the gap structural — and gives the team a place to record the lesson (calibration overlay).

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — DoD's calibration overlay is part of the team's accumulated memory.
- **[`brief-discipline.md`](brief-discipline.md)** — dispatch DoD is the brief's validation-gates section operationalised at handoff.
- **[`definition-of-ready.md`](definition-of-ready.md)** — the pickup gate that bookends every unit; together with DoD they form the unit's contract.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator persona runs DoD at every scope; reviewer is a separate role for the adversarial verdict.
- **[`spikes.md`](spikes.md)** — spike DoD is "the artefact is actionable," not "code is committed."
- [`retro.md`](retro.md) — when DoD catches a gap, it's the gate working; when something gets past DoD and is discovered later, the retro updates the calibration's DoD overlay.
- **`drive-qa-plan` + `drive-qa-run`** ([PR #93](https://github.com/prisma/ignite/pull/93)) — the canonical manual-QA discipline that slice and project DoD reference. Project-specific QA context lives in `drive/qa/README.md` per the same PR's project-context convention.
