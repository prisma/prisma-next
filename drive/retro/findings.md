# Drive trial — findings

> **Trial window:** 2026-05-19 → 2026-06-02. See [`drive/trial.md`](../trial.md) for the quality bar, tags, and format. Record only what meets the bar — `friction`, `gap`, `win`, `surprise`, `boundary`. One stanza per finding.

## 2026-05-20 · drive-plan-project · boundary

Planned `db-close-teardown` as two slices (substrate facade changes; teaching skill updates) under one Linear ticket (TML-2614), co-shipped as one PR. Violates **1 slice = 1 PR**. The correct shape was **one slice with four dispatches** (postgres / sqlite / mongo / skills) — which is what executed at the dispatch level; we just labelled the wrong layer "slice." The drift mechanism: noticed "substrate and teaching have different shapes / audiences / validation gates" (true) and let that inference run to "different slices" (wrong) instead of "different dispatches inside one slice" (right). The load-bearing falsifier that should have halted the plan was the phrase `co-ship` (or equivalent) appearing in `plan.md` — that phrase is the operator confessing in their own words that the boundary they just drew doesn't separate two ship-units. Whenever it appears, collapse to one slice. (Two slices sharing a Linear ticket is a *weaker* signal; one user-problem normally maps to one slice but the edge case where it doesn't is legitimate, so ticket-sharing alone shouldn't hard-halt.) The deeper lesson under the rule's surface statement: **1 slice = 1 PR isn't an identity claim; it's a deliberate coupling that borrows PR-review pressure as the planning-unit sizing instrument.** Agents lack the embodied "this is too big to review" sense humans build by repetition; the PR boundary is the explicit substitute for that missing sense. Decoupling slice from PR (a position we initially steelmanned and discarded) loses that sizing pressure and replaces it with no equivalent — the slice DoD is a quality property, not a size one, and quality properties don't push back at the right time.

**Suggested action:** `drive-plan-project` and `drive-plan-slice` (and their READMEs) need a pre-flight gate at slice-drawing time — for each proposed slice, name the PR it ships in and the Linear ticket it closes; if either is shared with a sibling slice, the boundary is wrong and the move is to collapse to one slice with multiple dispatches. Promote `co-ship` (and synonyms — "lands together," "atomic with sibling," "must merge alongside") as the primary load-bearing falsifier; demote ticket-sharing to a secondary signal that prompts inspection rather than hard-halts. In `drive/calibration/sizing.md`: name the dispatch-vs-slice distinction explicitly — "too big for one slice" is usually "right-sized for one slice with multiple dispatches"; size pressure binds at the slice (PR-cap), variety pressure binds at the dispatch (shape / audience / validation-gate differences are normal *within* a slice). In `docs/drive/principles/decomposition-and-cost.md`: state the rule with the reason — slice = PR because PR carries the sizing-feedback loop that the planning layer otherwise lacks. The meta-lesson belongs there too: when proposing to relax a Drive rule, first ask what work the rule is doing beneath its surface statement; some rules are simple identities, others are deliberate couplings whose load-bearing work is invisible until you try to decouple.

**Upstream candidate?** Yes — the `co-ship` falsifier, the dispatch-vs-slice vocabulary, the "rules can be deliberate couplings" meta-lesson, and the rationale for binding slice to PR via review pressure are all upstream-worthy. Queue for the synthesis ticket.

> **Trial window:** 2026-05-19 → 2026-06-02. See [`drive/trial.md`](../trial.md) for the quality bar, tags, and format. Record only what meets the bar — `friction`, `gap`, `win`, `surprise`, `boundary`. One stanza per finding.

## 2026-05-20 · drive-run-retro · surprise

Read-only reconnaissance (file `Read`, `Grep`, `Glob` on source) by the Orchestrator counts as drift even though intuition says reads are free. Symptom: orchestrator's broad-routing context fills with implementation detail; subsequent dispatch decisions degrade because the orchestrator reasons over fragments instead of structure. The DO-NOT enumeration in `drive/roles/README.md` lists read operations explicitly for this reason — counter-intuitive but correct.

**Suggested action:** landed in canonical `drive/roles/README.md § DO-NOT enumeration`. Watch for re-emergence in projects where the orchestrator's "I'll just check…" voice surfaces.

**Upstream candidate?** Yes — applies to any agent operating as an orchestrator regardless of harness.

## 2026-05-20 · drive-run-retro · win

AGENTS.md update mid-project (adding the canonical "Where skills and rules live" section + post-install wiring bullet) closed a foot-gun: a sub-agent halted because it assumed `.claude/skills/` was a canonical home rather than a symlink to `skills-contrib/`. The update prevents the same halt for future agents, especially for harnesses where the symlink presentation differs.

**Suggested action:** none. The update propagates via repo onboarding; future agents read AGENTS.md on entry.

**Upstream candidate?** Yes for the *pattern* (document the canonical-vs-presentation distinction in AGENTS.md / agent-onboarding docs) — the *content* is repo-specific.

## 2026-05-20 · drive-run-retro · boundary

Cross-document tier vocabulary divergence surfaced during reviewer iteration: `docs/drive/principles/decomposition-and-cost.md` declares canonical tier labels as `fast / mid / thorough`; `docs/drive/principles/brief-discipline.md` declares them as `cheap / mid / orchestrator`. Each document is internally consistent post-fix; the framework uses two parallel taxonomies for the same concept. Worth a separate harmonization effort once the divergence causes confusion in practice; not filed as a Linear ticket pending operator decision.

**Suggested action:** follow-up Linear ticket exists. Until harmonised, new drive-* docs should adopt one taxonomy and cross-reference (not redefine) — pick whichever the team prefers and align everything else.

**Upstream candidate?** Yes — harmonization choice and the convention "one taxonomy across `docs/drive/principles/*`" propagates upstream.

## 2026-05-20 · drive-plan-project · win

Applied the `co-ship` falsifier mid-flight to `projects/contract-ir-planes/plan.md` before locking the slice composition into Linear tickets. A previous draft proposed six slices; the prose around "Slice 1" included *"no behavioural change yet because nothing consumes the new shape"* — exactly the falsifier wording from the earlier `boundary` finding above. Operator flagged the conflict by attaching the prior finding mid-discussion ("read this learning from another agent"). Collapsed Slices 1+2 into a single substrate slice with two dispatches (framework primitives → descriptor wiring), and Slices 3+5 / 4+5 into two migration slices each absorbing their own fixture regen as a dispatch. Final: 4 slices instead of 6; ticket count drops accordingly; dispatch count stays the same. PR-review pressure stays bound to the right unit.

The reason the catch was clean: the load-bearing falsifier was named, the operator surfaced the prior finding at the right moment, and the agent re-read its own plan against the rule rather than defending the original framing. The cost of catching at planning time was ~15 minutes of plan rewrite vs. the alternative cost (catching at PR-review time = one extra round-trip per affected slice = ~hours of cascading rework).

**Suggested action:** none for the framework — the falsifier is already named in the prior finding's suggested action ("Promote `co-ship`...as the primary load-bearing falsifier"). This entry just confirms the falsifier works as intended when the operator surfaces prior findings at slice-drawing time.

**Upstream candidate?** Yes — the *mechanism* (operator attaches prior finding mid-discussion → agent applies falsifier → plan revises before Linear mutation) is itself a reusable pattern. Worth documenting in `drive-plan-project` (or upstream equivalent) as "if a co-ship signal appears in your own plan prose, stop and collapse before proceeding to ticket creation."
