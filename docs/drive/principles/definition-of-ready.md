# Principle: Definition of Ready — the gate before pickup

## What a DoR check actually looks like

A slice with this outcome: *"Migrate consumers of a legacy data shape to its replacement."* The implementer has drafted a slice spec, a slice plan (three dispatches: authoring-layer migration, builder-layer migration, fixture regeneration), and is about to start the first dispatch.

The agile orchestrator runs the slice DoR check first:

- [x] Slice spec exists — `projects/storage-shape-flatten/slices/round-2/spec.md`
- [x] Slice plan exists — `projects/storage-shape-flatten/slices/round-2/plan.md`
- [x] Every dispatch sized ≤ M — all three are M
- [x] Outcome fits in one PR — three dispatches × M ≈ 50 files; borderline but reviewable
- [ ] **Calibration entries linked — missing.** `drive/plan/README.md` has an entry for "Dual-shape support relocated under a new name" + grep patterns (`'columns' in`, `looksLike`) that exactly match this slice's shape. They're not linked from the slice plan.
- [x] Spike dependencies resolved — the test-sites spike artefact exists
- [x] Design calls settled
- [x] Slice serves the parent project's purpose

One box unchecked. Slice DoR is not satisfied. The next action is **resolve the gap, not start the dispatch.** Link the calibration entries into the slice plan so each dispatch's brief assembly will include them in the edge-case table.

If we'd waved the gate through ("close enough; the grep patterns are universal"), the dispatch loop would have run, the implementer would have silently regenerated test fixtures that intentionally exercise the legacy shape (the dual-shape anti-pattern), the migration would have broken the rejection tests, the reviewer subagent (which also didn't have the calibration entries in its context) would have missed it, and the operator would have discovered it three slices later. Recovery cost: three slices unwound + a retro to add the missing calibration link to slice DoR. The 30-second DoR check is much cheaper.

## DoR at three scopes

DoR is the *pickup* gate — pass/fail, structural, not negotiable. Three scopes; same shape; different items.

| Scope | Gate focus | Run by |
|---|---|---|
| **Project** (light) | Purpose + scope boundary + project-DoD exist; triage verdict is "project." | `drive-create-project` at project initiation. |
| **Slice** (heaviest) | Slice spec + slice plan exist; every dispatch sized ≤ M; outcome fits one PR; calibration entries linked; spike dependencies resolved; design calls settled. | `drive-specify-slice` / `drive-plan-slice` at slice initiation. |
| **Dispatch** (overlay-bound) | Brief assembled per [`brief-discipline.md`](brief-discipline.md); sized ≤ M; model tier declared; inputs loadable; gates runnable; overlay matches in edge-case table. | `drive-build-workflow` at dispatch pre-flight. |

The protocol (canonical skill bodies) carries the *shape*. Your team's `drive/<category>/README.md` carries the *content* — the team-specific items the overlay adds.

DoR is the pickup gate. [`definition-of-done.md`](definition-of-done.md) is the handoff gate. Together they bookend every unit of work.

## Items at each scope

### Project DoR (light)

A project is ready to start when:

1. **Purpose statement exists.** What this project makes true that isn't true today, in one paragraph. (Per invariant I7, this becomes immutable once the first dispatch starts.)
2. **Scope boundary exists.** What's in vs out at project level. (May sharpen later per I2; never expands outside the purpose.)
3. **Project-DoD exists.** What "this project is done" means. May be light at initiation and sharpen as slices deliver; cannot be empty.
4. **Triage verdict is "project"** — not slice / direct change / promote / demote. Initiating a project triage didn't endorse is the project-shape gravity failure mode.

Project DoR is intentionally light. Most heavy lifting happens at slice DoR. A project that satisfies project DoR but has no slices yet is fine.

### Slice DoR (the heavy one)

A slice is ready to start when:

1. **Slice spec exists** (inline in PR description for orphan; under `projects/<x>/slices/<s>/spec.md` for in-project). Has a clear outcome, scope (in / out within the parent project's purpose), and slice-DoD.
2. **Slice plan exists.** Decomposes the slice into a dispatch sequence. Every dispatch sized ≤ M; declared DoR + DoD per dispatch; declared model tier per dispatch. Plan refuses to finalise with L or XL.
3. **Outcome fits in one PR** (the PR-cap test, per invariant I1). If the plan reveals the work won't fit, the slice splits *now*, not after the dispatch loop starts.
4. **Calibration entries referenced.** Any failure-mode catalogue entries / grep library patterns / reference tasks in `drive/plan/README.md` that apply to this slice's shape are linked from the slice plan, so dispatch briefs can thread them in.
5. **Spike dependencies resolved.** If the slice plan depends on spike artefacts, those artefacts exist and are linked. No "we'll spike during the dispatch."
6. **Design calls settled.** Any design call the slice's outcome turns on has been resolved (recorded in `design-decisions.md` if relevant). No "we'll decide during implementation."
7. **(In-project) Slice serves the parent project's purpose** — the scope-in test against the project spec, per invariant I2.

Most failures we'd attribute to "the implementer drifted" are upstream — the slice was picked up without satisfying slice DoR.

### Dispatch DoR (overlay-bound)

A dispatch is ready to delegate when:

1. **Brief is assembled** per [`brief-discipline.md`](brief-discipline.md). All eight required sections present.
2. **Brief is sized ≤ M.** Defence in depth on top of slice-plan sizing. Any dispatch whose brief is L/XL is refused at dispatch time.
3. **Model tier is declared** per [`decomposition-and-cost.md`](decomposition-and-cost.md). Defaulting to the parent's tier is not a valid declaration.
4. **Inputs are loadable.** Every linked input (slice spec, spike artefact, calibration entry) is at the linked path and is readable. A broken link means the brief is not ready.
5. **Edge-case table includes overlay matches.** Every failure-mode entry in `drive/plan/README.md` whose shape matches this dispatch's work is in the brief's edge-case table with a disposition.
6. **Gates are runnable.** Each command in the "Done when" section runs from the repo root. A check that depends on an env var nobody set or a tool nobody installed is not ready.
7. **Implementer + reviewer are named.** The brief identifies who; the implementer (subagent or operator) has the context to execute; the reviewer is configured to verify.

Dispatch DoR is the gate `drive-build-workflow` runs at pre-flight. Every dispatch passes through it; no exceptions.

## Templates

The protocol-layer starter templates. Your `drive/<category>/README.md` overlays the team-specific items.

### Project DoR template

```markdown
## Project DoR

- [ ] Purpose statement exists (one paragraph; declared immutable per I7)
- [ ] Scope boundary exists (what's in vs out at project level)
- [ ] Project-DoD exists (what "done" means at project level)
- [ ] Triage verdict is "project" (not slice / direct change / promote / demote)

# Team overlays (from drive/project/README.md)
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
       reference tasks in drive/plan/README.md that apply)
- [ ] Spike dependencies resolved (spike artefacts exist and are linked)
- [ ] Design calls settled (recorded in design-decisions.md if relevant)
- [ ] (In-project) Slice serves the parent project's purpose per I2

# Team overlays (from drive/spec/README.md + drive/plan/README.md)
- [ ] <team-specific item — e.g. "Linear issue created and linked from
       slice spec">
- [ ] <…>
```

### Dispatch DoR template

```markdown
## Dispatch DoR

- [ ] Brief assembled (all eight required sections per brief-discipline.md)
- [ ] Brief is sized ≤ M (defence in depth on top of slice-plan sizing)
- [ ] Model tier is declared (defaulting to parent tier is not valid)
- [ ] All linked inputs are loadable (slice spec / spike artefact /
       calibration entries)
- [ ] Edge-case table includes every applicable failure-mode entry from
       drive/plan/README.md with a disposition
- [ ] "Done when" commands are runnable (work from repo root)
- [ ] Implementer + reviewer are named with context to execute / verify

# Team overlays (from drive/plan/README.md)
- [ ] <team-specific item — e.g. "Brief's outcome aligns with Linear
       issue's acceptance criteria">
- [ ] <…>
```

## How team overlays work

Each `drive/<category>/README.md` adds team-specific DoR items the matching skill enforces:

| Skill | Reads | Adds overlays for |
|---|---|---|
| `drive-create-project` | `drive/project/README.md` | Project-DoR items (Linear setup, branch naming, etc.) |
| `drive-specify-slice` | `drive/spec/README.md` | Slice-DoR items related to spec content |
| `drive-plan-slice` | `drive/plan/README.md` | Slice-DoR items related to plan structure |
| `drive-build-workflow` | `drive/plan/README.md` | Dispatch-DoR items (brief assembly conventions, model-tier routing rules) |

Each team's own overlays live in their `drive/<category>/README.md` files — concrete DoR items shaped around their tracker, branch conventions, failure-mode catalogue, and model-tier choices. Browse [`drive/`](../../../drive/) at the repo root for prisma-next's current set.

Overlay items grow by retro accretion. The protocol layer (canonical skill body) stays small; the team's overlays grow.

## What DoR is and isn't

DoR **is**:

- A pass/fail checklist. Every item is checkable, not interpretive.
- The team's accumulated pickup wisdom (overlays grow; protocol stays small).
- Run by the agile orchestrator at pickup time — pre-initiation for project + slice; pre-delegation for dispatch.

DoR is **not**:

- A perfectionism filter. DoR is the *minimum* — the things that, if missing, would cause silent drift. Not "everything I could imagine."
- A way to block work. If DoR is unmet, the work is to fix the gap, not to defer the unit.
- A guarantee of success. DoR catches predictable pickup-time failures; it can't predict in-flight surprises (those are design-discussion triggers + retro material).
- A waivable courtesy. The whole point is the structural protection — waiving DoR re-introduces the failure modes the gate exists to prevent.

## Anti-patterns

1. **"Soft" DoR (suggested, not enforced).** Implementations skip the gate when it's inconvenient; failures recur; the team blames the implementer. The gate must be enforced — by `drive-build-workflow` refusing to dispatch with unmet DoR, by the orchestrator refusing to start a slice plan whose dispatches don't pass dispatch DoR, by triage refusing to admit a slice that won't fit.
2. **Wishlist DoR.** Items like "code is well-organised" or "the design is right." Uncheckable; doesn't gate anything. Symptom: every retro discovers the gate didn't catch what it was supposed to.
3. **DoR that re-validates DoD.** "All tests passing" is a DoD item, not a DoR item. DoR is for pre-conditions of *starting*, not pre-conditions of *succeeding*.
4. **Identical DoR at every scope.** Each scope has different concerns: project DoR is scope-and-purpose; slice DoR is decomposition-and-fit; dispatch DoR is brief-readiness. A single shared DoR misses per-scope concerns or imposes irrelevant ones.
5. **Team overlay items in the shared skill body.** Team-specific gates baked into the canonical body force unaffected teams to skip or waive — which trains everyone to waive. Team-specific items live in `drive/<category>/README.md`.
6. **DoR check skipped because "we know what we're doing."** The gate fires *especially* when the team is confident — that's when assumption-failure is most likely to slip past. A gate that doesn't fire on confident days is decorative.
7. **Slice DoR satisfied by "the plan will figure it out."** The plan IS part of slice DoR. A slice without a dispatch sequence sized ≤ M is not ready. Marking it ✅ "the plan author will sort it" moves the work later, where it's more expensive.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — DoR overlays live in `drive/<category>/README.md` and accrete via retros.
- **[`brief-discipline.md`](brief-discipline.md)** — dispatch DoR substantially asks "is the brief assembled per brief discipline?"
- **[`decomposition-and-cost.md`](decomposition-and-cost.md)** — the M-cap at dispatch DoR is what cost optimisation depends on.
- **[`roles-and-personas.md`](roles-and-personas.md)** — the agile orchestrator runs DoR at every scope.
- **[`definition-of-done.md`](definition-of-done.md)** — the handoff gate that bookends every unit; together with DoR they form the unit's contract.
- **[`retro.md`](retro.md)** — when DoR catches a gap, the gate worked; when it doesn't, the retro updates the overlay.
