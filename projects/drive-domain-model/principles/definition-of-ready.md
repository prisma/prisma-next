# Principle: Definition of Ready Gates Pickup at Three Scopes

## Thesis

**Definition of Ready (DoR)** is the team's pre-condition checklist for picking up a unit of work. If DoR is not satisfied, the unit is not pickable — the agile orchestrator either resolves the gap before delegating or surfaces the gap (often as a design discussion). DoR is the structural fix for the failure mode where a unit looks pickable but isn't, and the implementer discovers the gap mid-dispatch (drift) or quietly accommodates around it (silent expansion).

DoR gates **three scopes**: project, slice, dispatch. The shape is the same at every scope (a checklist with pass/fail items); the content scales with the unit. The protocol carries the shape; calibration carries the content.

DoR is the *pickup* gate. Definition of Done (next principle) is the *handoff* gate. Together they bookend every unit of work.

## Why DoR matters

Two failure modes DoR is designed to prevent:

1. **Pickable-looking unit that wasn't.** A slice that "seemed ready" turns out to require a design call mid-dispatch (assumption-falsification); a dispatch's brief is missing the calibration entries that would have flagged the edge case the implementer just silently accommodated. The cost is the dispatch's wasted run + the recovery work + (often) a retro to add what DoR should have caught.
2. **Silent waiver of pickup pre-conditions.** Without an explicit gate, "we'll figure it out as we go" becomes the default. The pre-conditions go unchecked; the failures are blamed on the implementer; the protocol doesn't learn.

The gate is the structural fix. A unit either passes its DoR or it doesn't. If it doesn't, the work is to resolve the gap, not to start the dispatch.

## DoR at three scopes

### Project DoR (light)

A project is ready to initiate when:

1. **Purpose statement exists.** What this project makes true that isn't true today, in one paragraph. (Per invariant I7, this becomes immutable once the first dispatch starts.)
2. **Scope boundary exists.** What's in vs out at project level. (May sharpen later per I2; never expands outside the purpose.)
3. **Project-DoD exists.** What "this project is done" means. May be light at initiation and sharpen as slices deliver, but cannot be empty.
4. **Triage verdict is "project" (not "slice" / "direct change" / "promote" / "demote").** Initiating a project that triage didn't endorse is the project-shape gravity failure mode.

Project DoR is intentionally light. Most heavy lifting happens at the slice DoR. A project that satisfies its DoR but has no slices yet is fine — slices come in slice initiation, gated by slice DoR.

### Slice DoR (the heavy one)

A slice is ready to initiate when:

1. **Slice spec exists** (inline in PR description for orphan; under `projects/<x>/slices/<s>/spec.md` for in-project). Has a clear outcome, scope (in / out within the parent project's purpose), and slice-DoD.
2. **Slice plan exists.** Decomposes the slice into a dispatch sequence. Every dispatch in the plan is sized ≤ M; declared DoR + DoD per dispatch; declared model tier per dispatch. Plan refuses to finalize with L/XL.
3. **Outcome fits in one PR.** The PR-cap test (per invariant I1). If the slice plan reveals the work won't fit, the slice splits *now*, not after the dispatch loop starts.
4. **Calibration entries referenced.** Any failure-mode catalogue entries / grep library patterns / reference tasks that apply to this slice's shape are linked from the slice plan (so dispatch briefs can thread them in).
5. **Spike dependencies resolved.** If the slice plan depends on spike artefacts, those artefacts exist and are linked. No "we'll figure it out by spiking during the dispatch."
6. **Design discussion settled where required.** Any design call the slice's outcome turns on has been resolved (recorded in `design-decisions.md` if relevant). No "we'll decide during implementation."
7. **Parent project's purpose includes this slice** (in-project slices only). The scope-in test against the project spec, per invariant I2.

Slice DoR is the most consequential gate. Most failures we'd attribute to "the implementer drifted" are upstream — the slice was picked up without satisfying its DoR.

### Dispatch DoR (calibration-bound)

A dispatch is ready to delegate when:

1. **Brief is assembled** (per [`brief-discipline.md`](brief-discipline.md)). All eight required sections present.
2. **Brief is sized ≤ M.** Defense in depth on top of slice-plan's sizing. Any dispatch whose brief is L/XL is refused at dispatch time.
3. **Model tier is declared.** Per [`decomposition-and-cost.md`](decomposition-and-cost.md). Defaults-to-parent is not a valid declaration.
4. **Inputs are loadable.** Every linked input (slice spec, spike artefact, calibration entry) is at the linked path and is readable. A broken link means the brief is not ready.
5. **Edge cases include calibration matches.** Every failure-mode catalogue entry whose shape matches this dispatch's work is in the brief's edge-case table with a disposition.
6. **Validation gates are runnable.** Each command in the DoD section can be run from the repo root. A check that depends on an environment variable nobody set or a tool nobody installed is not ready.
7. **Implementer + reviewer are named.** The brief identifies who; the implementer subagent (or operator) has the context to execute; the reviewer subagent is configured to verify.

Dispatch DoR is the gate the agile orchestrator runs at the pre-flight step of `drive-orchestrate-plan`. Every dispatch passes through it; no exceptions.

## DoR templates (starter)

These are the protocol-layer starter templates. Calibration overlays project-specific items.

### Project DoR template

```markdown
## Project DoR

- [ ] Purpose statement exists (one paragraph; declared immutable per I7)
- [ ] Scope boundary exists (what's in vs out at project level)
- [ ] Project-DoD exists (what "done" means at project level)
- [ ] Triage verdict is "project" (not slice / direct change / promote / demote)

# Calibration overlays
- [ ] <team-specific item — e.g. "Linear Project created with promotion
       pattern applied if started from a ticket">
- [ ] <…>
```

### Slice DoR template

```markdown
## Slice DoR

- [ ] Slice spec exists (path: <…>); outcome + scope + slice-DoD declared
- [ ] Slice plan exists (path: <…>); decomposes into dispatch sequence
- [ ] Every dispatch in plan is sized ≤ M; declares DoR + DoD + model tier
- [ ] Outcome fits in one PR (PR-cap test passed)
- [ ] Calibration entries linked (failure-mode catalogue / grep library /
       reference tasks that apply to this slice's shape)
- [ ] Spike dependencies resolved (spike artefacts exist and are linked)
- [ ] Design calls settled (recorded in design-decisions.md if relevant)
- [ ] (In-project) Slice serves the parent project's purpose per I2

# Calibration overlays
- [ ] <team-specific item — e.g. "Linear issue created and linked from
       slice spec">
- [ ] <…>
```

### Dispatch DoR template

```markdown
## Dispatch DoR

- [ ] Brief assembled (all eight required sections per brief-discipline.md)
- [ ] Brief is sized ≤ M (defense in depth on top of slice-plan sizing)
- [ ] Model tier is declared (defaults-to-parent is not valid)
- [ ] All linked inputs are loadable (slice spec / spike artefact /
       calibration entries)
- [ ] Edge-case table includes every applicable calibration failure-mode
       catalogue entry with a disposition
- [ ] Validation gates are runnable (commands work from repo root)
- [ ] Implementer + reviewer are named with context to execute / verify

# Calibration overlays
- [ ] <team-specific item — e.g. "Brief's outcome aligns with Linear
       issue's acceptance criteria">
- [ ] <…>
```

## What DoR is and isn't

DoR is **a pickup gate.** Not a planning artefact. Not a wishlist of things "nice to have." Not negotiable.

What DoR is *not*:

- A perfectionism filter. DoR is the *minimum* — the things that, if missing, would cause silent drift. It's not "everything I could imagine."
- A way to block work. If DoR is unmet, the work is to resolve the gap, not to defer the unit.
- A guarantee of success. DoR catches predictable pickup-time failures; it cannot predict in-flight surprises (those are design-discussion triggers + retro material).
- A waivable courtesy. The whole point is the structural protection — waiving DoR re-introduces the failure modes the gate exists to prevent.

What DoR *is*:

- A pass/fail checklist. Every item is checkable, not interpretive.
- The team's accumulated pickup wisdom (the calibration overlay grows; the protocol layer stays small).
- Run by the agile orchestrator at pickup time — pre-initiation for project + slice; pre-delegation for dispatch.

## Anti-patterns this principle calls out

1. **"Soft" DoR (suggested, not enforced).** Implementations skip the gate when it's inconvenient; failures recur; team blames the implementer. The gate must be enforced — by `drive-orchestrate-plan` refusing to dispatch with unmet DoR, by the agile orchestrator refusing to start a slice plan whose dispatches don't pass dispatch DoR, by triage refusing to admit a slice that won't fit.

2. **Wishlist DoR.** Items like "code is well-organised" or "the design is right." Uncheckable. Doesn't gate anything. Symptom: every retro discovers the gate didn't catch what it was supposed to.

3. **DoR that re-validates DoD.** "All tests passing" is a DoD item, not a DoR item. DoR is for pre-conditions of *starting*, not pre-conditions of *succeeding*.

4. **Identical DoR at every scope.** Each scope has different concerns: project DoR is about scope-and-purpose; slice DoR is about decomposition-and-fit; dispatch DoR is about brief-readiness. A single shared DoR misses the per-scope concerns or imposes irrelevant ones.

5. **Calibration items in the protocol layer.** Team-specific gates ("every Linear ticket linked"; "screenshot in every UI PR") that get baked into the shared protocol bloat it and force unaffected teams to skip the gate or waive it for irrelevance — which trains everyone to waive. Calibration items live in the calibration layer.

6. **DoR check skipped because "we know what we're doing."** The skip is the silent waiver failure mode. If the gate doesn't fire when the team is confident, the gate is decorative. The gate fires *especially* when the team is confident — that's when assumption-failure is most likely to slip past.

7. **Slice DoR satisfied by "the plan will figure it out."** The plan IS part of slice DoR. A slice without a dispatch sequence sized ≤ M is not ready. The temptation to mark slice DoR ✅ "the plan author will sort it" is the same as not having a plan — moves the work later, where it's more expensive.

## Worked example: a slice that almost satisfied DoR but didn't

A slice's stated outcome: "Migrate `StorageTable` consumers to flat shape." Slice spec drafted; outcome + scope clear. Slice plan drafted; three dispatches: PSL-interpreter migration, TS-builder migration, fixture regeneration.

Slice DoR check:

- [x] Slice spec exists
- [x] Slice plan exists
- [x] Every dispatch sized ≤ M (all three are M)
- [x] Outcome fits in one PR (PR-cap eyeball: three dispatches × M ≈ 50 files; borderline but PR-reviewable)
- [ ] Calibration entries linked — **MISSING**. The `prisma-next.md` calibration has an entry for "Dual-shape support relocated under a new name" + grep patterns (`'columns' in`, `looksLike`) that exactly match this dispatch's shape. They're not in the slice plan.
- [x] Spike dependencies resolved (the test-sites spike artefact exists)
- [x] Design calls settled
- [x] Slice serves parent project's purpose

One unchecked box. Slice DoR not satisfied. Work to resolve: thread the calibration entries into the slice plan, so each dispatch's brief assembly will include them in the edge-case table.

If we'd skipped the gate ("close enough; the grep patterns are universal"), the dispatch loop would have run; the implementer would have silently regenerated test fixtures that intentionally exercise the legacy shape (the "dual-shape" anti-pattern); the migration would have broken the rejection tests; the reviewer subagent (which didn't have the calibration entries in its context either) would have missed it; the operator would have discovered it three slices later. Recovery cost: the migration's three slices unwind + a retro to add the missing calibration link to slice DoR. The 30-second DoR check is much cheaper than the recovery.

## How calibration overlays the protocol

The protocol's DoR templates carry the universal items — the ones every team needs because every team can hit the failure modes they prevent. The calibration overlays the team-specific items.

Worked example for `prisma-next`:

- **Project DoR calibration:** A Linear Project exists; the original ticket has been promoted-pattern-applied (per `model.md` § "Linear sync — Promotion pattern") if the project started from a ticket; the project's working branch is named with the Linear Project ID.
- **Slice DoR calibration:** A Linear issue is created and linked from the slice spec; the slice's PR-to-be will have a `Refs: <issue-id>` line; the slice's parent branch is the project's working branch (or main for orphan slices).
- **Dispatch DoR calibration:** The brief's "Inputs" section references the relevant `prisma-next` failure-mode entries (e.g. "Dual-shape support relocated under a new name") and grep library patterns (`'columns' in`, `looksLike`); the brief's tier is one of the three the team uses (Opus / Sonnet / composer); the brief specifies a slice plan path under `projects/<x>/slices/<s>/`.

Calibration items grow as failures happen — every retro that surfaces "we should have caught this at pickup" adds an item to the calibration's DoR overlay. The protocol layer stays small; the calibration grows.

## Practical implications

1. **The agile orchestrator runs DoR at three scopes.** Pre-project-initiation; pre-slice-initiation; pre-dispatch-delegation. The check is structural; failure routes to gap-resolution (often via design discussion).
2. **Skills enforce DoR.** `drive-create-project`, `drive-slice-specify`, `drive-orchestrate-plan` all check DoR at their entry points. A skill that proceeds with unmet DoR is broken.
3. **Calibration's DoR overlay is part of the team's protocol-as-memory.** Per [`protocol-as-memory.md`](protocol-as-memory.md), the overlay grows by retro accretion and is read on every pickup.
4. **Unmet DoR is not a retro failure.** Unmet DoR caught at pickup is the gate working. Unmet DoR *uncaught* at pickup — and discovered later — is the retro trigger (add the gap-detector to the calibration).
5. **The dispatch DoR runs by default in unattended mode.** Orchestrator agent runs the check; refuses to dispatch on a fail; logs the gap for the operator. Same structural protection as in interactive mode.

## Failure mode this principle directly prevents

Two failure modes:

- **Pickable-looking-but-not.** A unit looks ready, the team starts the work, the work drifts because a pre-condition was missing. DoR catches the missing pre-condition at pickup, before drift accumulates.
- **Silent waiver.** Without an explicit gate, "we'll figure it out as we go" becomes the default and pre-conditions go unchecked. The gate forces the check.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — DoR's calibration overlay is part of the team's accumulated memory.
- **[`brief-discipline.md`](brief-discipline.md)** — dispatch DoR substantially asks "is the brief assembled per brief discipline?"
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — the M-cap at dispatch DoR is the size invariant cost optimization depends on.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator persona runs DoR at every scope.
- (Upcoming) **`definition-of-done.md`** — the handoff gate that bookends every unit; together with DoR they form the unit's contract.
- (Upcoming) **`retro.md`** — when DoR catches a gap, it's the gate working; when it doesn't, the retro updates the calibration's DoR overlay.
