# Principle: Definition of Done — the gate before handoff

## What a DoD check actually looks like

The `StorageTable` migration dispatch from [`brief-discipline.md`](brief-discipline.md) finishes. The implementer subagent reports done. The agile orchestrator runs the dispatch DoD check:

- [x] All "Done when" commands from the brief pass — `pnpm typecheck` clean; `pnpm test:packages` passing; `rg "tables: \{" -- 'packages/*/src/test/**'` empty for the 8 migrated sites; no new TODOs; per-site commit messages reference the spike artefact
- [x] Every brief edge case handled per its disposition — one site flagged as intentionally legacy-shape (skipped); one fixture file deferred per disposition; two mixed sites surfaced per "refuse and surface" (resolved by operator before dispatch ended)
- [x] No scope-out items touched — diff-reading verifies only the 8 sites + named fixture files + the spike artefact were changed
- [x] Reviewer subagent verdict: accept
- [ ] **Intent validation: FAIL.** The orchestrator-tier check reads the dispatch summary + the diff: *"two of the eight sites used a partial migration that technically satisfies the grep gate but doesn't actually move to the new shape — the `tables: {…}` literal is gone but it's replaced with a programmatic `Object.fromEntries(...)` that re-creates the same flat structure. The grep passes; the intent (move to a literal flat shape) doesn't."*
- [x] Per-slice review artefacts refreshed

Six checked, one not. Dispatch DoD is not satisfied. The implementer's work was clever — it routes around the grep gate while not delivering the spec's intent. Without intent-validation, this dispatch would have shipped; the next dispatch (Postgres-introspector tightening) would have been built on a substrate that doesn't actually match the intended shape.

Work to resolve: a follow-up S-sized dispatch converts the two programmatic-flat-shape sites to literal-flat-shape. The failure mode "grep gate routed around with programmatic equivalent" gets added to `drive/plan/README.md`'s failure-mode catalogue, so future briefs will name it as an edge case.

That's what DoD does — it catches the silent drift that passes mechanical checks.

## DoD at three scopes

DoD is the *handoff* gate — pass/fail, structural, not negotiable. Three scopes; same shape; different items.

| Scope | Gate focus | Run by |
|---|---|---|
| **Project** | All slices delivered + outcomes hold + deferred-work triaged + docs migrated + manual-QA coverage adequate + **mandatory final retro** + Linear cleanup + folder deleted. | `drive-close-project` at project closure. |
| **Slice** | Spec outcome met + all dispatches done + PR review-clean + intent-validation passes + no silent amendments (I12) + manual-QA satisfied (or honest N/A). | Slice closure ritual at PR merge. |
| **Dispatch** | All "Done when" gates pass + every edge case handled per disposition + no scope-out touched + reviewer verdict accept + intent-validation passes. | `drive-build-workflow` at dispatch post-flight. |

DoD has a stronger role than DoR for one reason: **it's the contract the reviewer verifies.** Without DoD, the reviewer has nothing sharp to check — only "does this look right?" which is fragile. With it, the reviewer runs the same commands and asks the same questions every time.

The protocol carries the shape; your team's `drive/<category>/README.md` carries the content.

## Three categories of gate

A common DoD failure is conflating these. Each closes a different gap:

| Category | What it verifies | Examples | When it fires |
|---|---|---|---|
| **CI gates** | The *mechanical* contract. Code compiles, tests pass, forbidden patterns absent. | `pnpm typecheck`, `pnpm test`, `pnpm lint`, grep checks. | Every dispatch + slice DoD. |
| **Intent validation** | The work delivered *what the spec asked for*, not a literal-correct-but-spec-wrong implementation. | Orchestrator-tier reads dispatch summary + diff and decides. | Every dispatch + slice DoD. |
| **Manual QA** | What CI cannot meaningfully cover. Diagnostic clarity, end-to-end developer journey, re-enactment of the originally-failing user flow, gate-of-gate sanity (plant a violation to confirm the new guard fires), exploratory probing. | Authored via `drive-qa-plan`; executed via `drive-qa-run`; report classifies findings by severity (🛑 Blocker / ⚠️ High / 📝 Follow-up). | Slice + project DoD whenever the unit touched user-observable surface (else explicit N/A with rationale). |

The `drive-qa-plan` / `drive-qa-run` skills ship in [PR #93](https://github.com/prisma/ignite/pull/93). The QA skill body explicitly endorses "N/A — no user-observable change" as a legitimate slice DoD outcome for pure refactors.

The intent-validation step caught the `StorageTable` failure above — CI's grep gate passed, but the intent didn't. That's the gap intent-validation exists to close.

## Items at each scope

### Project DoD

A project is done when:

1. **All planned slices delivered** (or explicitly cancelled with rationale).
2. **All direct changes composed under the project delivered.**
3. **Stated outcomes hold.** The purpose statement's "what is true that wasn't before" is now true. Scope-boundary commitments met (or sharpened-down with documentation).
4. **Deferred-work bundle reviewed.** `projects/<x>/deferred.md` items each triaged individually (adopt as new project / slice / direct change; route to backlog; drop).
5. **Long-lived docs migrated.** Anything from `projects/<x>/` that needs to live past close-out has been moved to `docs/` (or canonical home) and references updated.
6. **Manual-QA coverage adequate across user-observable surface.** Every slice that touched it has a script + at least one run report; no unresolved 🛑 Blocker findings; refactor slices honestly marked N/A; project-specific QA expectations sourced from `drive/qa/README.md`.
7. **Final retro complete.** Per [`retro.md`](retro.md), the project close retro is mandatory and must produce a protocol / overlay / ADR update. If none, the retro failed.
8. **Linear cleanup done.** Linear Project marked Completed (or Cancelled, with rationale); open issues under it closed; original promoted ticket (if applicable) reflects completion.
9. **`projects/<x>/` deleted.** Transient project directory removed.

Project DoD is the most consequential gate — it's the only one that fires the mandatory retro. Skipping it loses institutional memory.

### Slice DoD

A slice is done when:

1. **Slice spec's outcome met.** PR delivers what the spec declared.
2. **All dispatches in the slice plan are done** (each satisfied dispatch DoD).
3. **PR is review-clean.** Reviewer (distinct from implementer) accepted; findings addressed or explicitly accepted.
4. **Intent-validation passes.** Orchestrator-tier confirms the PR delivers the spec's intent, not just the literal acceptance criteria.
5. **No silent spec/plan amendments survived** (per invariant I12 — every amendment was design-discussion output or operator-authorised).
6. **Manual QA satisfied** — *if* the slice touched user-observable surface. A `drive-qa-plan` script exists; at least one `drive-qa-run` report exists; no unresolved 🛑 Blocker findings; ⚠️ High findings addressed or accepted; 📝 Follow-ups captured. *If* the slice did not touch user-observable surface, record "Manual QA: N/A — no user-observable change" with a one-line rationale. Team-specific QA conventions come from `drive/qa/README.md`.
7. **Slice-DoD team overlay items pass.**
8. **Slice closure rituals complete.** Scope-deferred candidates surfaced and recorded; retro triggered if a learning surfaced (not mandatory unless project DoD); next slice (if stacked) is unblocked.

### Dispatch DoD

A dispatch is done when:

1. **All gates from the brief's "Done when" section pass.**
2. **Every brief edge case** either didn't occur, was handled per disposition, or was escalated per "refuse and surface" — the implementer's dispatch summary names which.
3. **No scope-out items touched.** WIP-inspection's diff-reading verifies the commits stay within scope-in.
4. **Reviewer subagent verdict is accept.** Reviewer ran the gates independently.
5. **Intent validation passes.** Dispatch produced what the brief described, not a literal-correct-but-brief-wrong implementation.
6. **Per-slice review artefacts refreshed.** `code-review.md`, `system-design-review.md`, `walkthrough.md` reflect what the dispatch landed.
7. **(Spike-flavoured)** Artefact exists at named path with named shape, per [`spikes.md`](spikes.md).

Dispatch DoD is the gate `drive-build-workflow` runs at post-flight. Every dispatch passes through it.

## Templates

The protocol-layer starter templates. Your `drive/<category>/README.md` overlays the team-specific items.

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
       project-specific expectations sourced from drive/qa/README.md)
- [ ] Final retro complete with protocol / overlay / ADR update
- [ ] Linear cleanup done (project Completed/Cancelled; issues closed;
       promoted ticket reflects completion if applicable)
- [ ] projects/<x>/ deleted

# Team overlays (from drive/project/README.md + drive/qa/README.md)
- [ ] <team-specific item — e.g. "Customer success notified of feature
       availability with agreed messaging">
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

# Team overlays (from drive/plan/README.md + drive/qa/README.md
#  + drive/pr/README.md + drive/code-review/README.md)
- [ ] <team-specific item — e.g. "Linear issue moved to 'Ready to be
       merged' (the team's terminal-before-merge state)">
- [ ] <…>
```

### Dispatch DoD template

```markdown
## Dispatch DoD

- [ ] "Done when" commands from the brief all pass
- [ ] Every brief edge case either didn't occur, was handled per disposition,
       or was escalated per "refuse and surface" — named in dispatch summary
- [ ] No scope-out items touched (WIP-inspection diff-reading verified)
- [ ] Reviewer subagent verdict is accept (with findings addressed/accepted)
- [ ] Intent validation passes (dispatch produced what brief described)
- [ ] Per-slice review artefacts refreshed
       (code-review.md / system-design-review.md / walkthrough.md)
- [ ] (Spike-flavoured) Artefact exists at named path with named shape

# Team overlays (from drive/plan/README.md)
- [ ] <team-specific item — e.g. "Brief's referenced failure-mode entries
       were checked during execution and noted as 'avoided' in the
       dispatch summary">
- [ ] <…>
```

## How team overlays work

Each `drive/<category>/README.md` adds team-specific DoD items the matching skill enforces:

| Skill | Reads | Adds overlays for |
|---|---|---|
| `drive-close-project` | `drive/project/README.md` + `drive/qa/README.md` | Project-DoD items + project-scope QA coverage check |
| `drive-build-workflow` (at slice closure) | `drive/plan/README.md` | Most slice-DoD items |
| `drive-pr-description` / `drive-pr-walkthrough` | `drive/pr/README.md` | PR-shape items in slice DoD |
| `drive-review-code` | `drive/code-review/README.md` | Reviewer-verdict items in slice DoD |
| `drive-qa-plan` / `drive-qa-run` | `drive/qa/README.md` | Manual-QA items in slice + project DoD |
| `drive-build-workflow` (at dispatch closure) | `drive/plan/README.md` | Dispatch-DoD items |

Worked example for `prisma-next`:

- **Project DoD overlay** (`prisma-next/drive/project/README.md` + `drive/qa/README.md`): Linkable summary of project outcomes added to the team's docs index; new architecture docs linked from `docs/architecture docs/`; Linear status update with final retro link; `drive/qa/README.md` updated if the project surfaced new audiences or coverage-gate gaps.
- **Slice DoD overlay** (`prisma-next/drive/plan/README.md` + `drive/qa/README.md` + `drive/pr/README.md`): Linear issue moved to "Ready to be merged" (team's terminal-before-merge state); PR title carries Linear ticket prefix; PR description follows `drive-pr-description` shape; manual-QA script (when applicable) names the two audiences `prisma-next` typically QAs against — extension authors via `packages/3-extensions/`, end users via `examples/`.
- **Dispatch DoD overlay** (`prisma-next/drive/plan/README.md`): Brief's referenced failure-mode entries were checked and noted as "avoided" in the dispatch summary; `pnpm test:packages` in the DoD section; `pnpm lint:deps` in the DoD section for any dispatch touching package imports.

Overlay items grow by retro accretion.

## What DoD is and isn't

DoD **is**:

- A pass/fail checklist. Every item checkable, not interpretive.
- The team's accumulated handoff wisdom (overlays grow; protocol stays small).
- Run by the agile orchestrator at handoff time — post-dispatch; post-slice (with reviewer's verdict); at project closure.

DoD is **not**:

- A perfectionism filter. DoD is the *contractual minimum* — the things that, if missing, mean "not done." Aspirational quality goes elsewhere.
- A re-statement of DoR. DoR is "ready to start"; DoD is "complete." Different concerns.
- A code review. Code review is a richer human / agent activity; DoD is the structural gate that bookends every unit. (For slices, the reviewer's verdict *is* a DoD item; the rest of DoD doesn't replace the review.)
- A snapshot of CI gates only. DoD includes intent-validation and — for slices that touched user-observable surface — manual QA. Skipping any of the three leaves a class of gap uncovered.

## Anti-patterns

1. **"Soft" DoD.** Items skipped under deadline pressure. Drift slips through. The gate must be enforced — `drive-build-workflow` refuses to close a dispatch with unmet DoD; slice closure refuses to merge with unmet slice DoD; `drive-close-project` refuses to delete `projects/<x>/` with unmet project DoD.
2. **DoD = CI gates only.** Skips intent-validation and manual QA. Symptom: typecheck/test/lint all pass, but the dispatch silently solved the wrong problem (the `StorageTable` example above) or shipped a feature whose CLI diagnostic is incomprehensible because CI doesn't read English. Intent-validation is non-optional in dispatch + slice DoD; manual QA is non-optional in slice DoD whenever the change touches user-observable surface.
3. **DoD authored by the implementer post-hoc.** The brief's "Done when" is the contract; the implementer cannot edit the gate they're being evaluated against. (Operator-authorised mid-flight edits via design discussion are fine; silent implementer-side edits violate I12.)
4. **Wishlist DoD.** Items like "the code is elegant" or "the abstractions are right." Uncheckable; doesn't gate handoff. Aspirational quality belongs in code-review feedback.
5. **Project DoD without the mandatory retro.** The retro is the team's only learning mechanism. Skipping it means lessons don't accrete; the next project re-discovers the same failures.
6. **Slice DoD where the implementer is the reviewer.** Violates the role separation in [`roles-and-personas.md`](roles-and-personas.md). The reviewer must be a different actor; otherwise the adversarial reading doesn't form, and DoD passes that should have failed.
7. **DoD items that depend on environment nobody set up.** A check that runs only on a particular operator's laptop is not a DoD item — it's a private gate. DoD items run reliably in the team's standard execution context.
8. **DoD waived when "the work is obviously fine."** Same failure mode as DoR waiver. The gate fires *especially* when the work seems fine — subtle drift is most likely to pass without scrutiny then.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — DoD overlays live in `drive/<category>/README.md` and accrete by retro.
- **[`brief-discipline.md`](brief-discipline.md)** — dispatch DoD is the brief's "Done when" section operationalised at handoff.
- **[`definition-of-ready.md`](definition-of-ready.md)** — the pickup gate that bookends every unit; together with DoD they form the unit's contract.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator runs DoD at every scope; reviewer is a separate role for the adversarial verdict.
- **[`spikes.md`](spikes.md)** — spike DoD is "the artefact is actionable," not "code is committed."
- **[`retro.md`](retro.md)** — when DoD catches a gap, the gate worked; when something gets past DoD and is discovered later, the retro updates the overlay.
- **`drive-qa-plan` + `drive-qa-run`** ([PR #93](https://github.com/prisma/ignite/pull/93)) — the canonical manual-QA discipline slice and project DoD reference. Team-specific QA context lives in `drive/qa/README.md`.
