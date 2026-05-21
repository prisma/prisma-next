# Drive trial — findings

> **Trial window:** 2026-05-19 → 2026-06-02. See [`drive/trial.md`](../trial.md) for the quality bar, tags, and format. Record only what meets the bar — `friction`, `gap`, `win`, `surprise`, `boundary`. One stanza per finding.

## 2026-05-21 · drive-qa-run + agent self-discipline · friction

I (running TML-2614 review/QA) reported three "pre-existing failures on `origin/main`" in the PR body and filed TML-2631 against one of them. **All three were operator-environment artefacts in my local worktree**, not real failures on `origin/main`:

- 4× `mongo.e2e.test.ts` runtime failures — stale `dist/index.mjs` in `@prisma-next/mongo-contract` (pre-namespacing schema). Cleared by `pnpm --filter @prisma-next/mongo-contract --filter @prisma-next/family-mongo build`.
- `mongo.types.test-d.ts` typecheck failure — same root cause (stale `dist/.d.mts` exports). Cleared by the same rebuild.
- `postgres/test/psl-namespace-qualifier-routing.test.ts` typecheck failure — `@prisma-next/psl-parser` had been added as a `devDependency` of `@prisma-next/postgres` but never linked into `packages/3-extensions/postgres/node_modules/@prisma-next/`. Cleared by `pnpm install`.

`AGENTS.md` already calls out the relevant hygiene ("After changing exported types in a workspace package consumed elsewhere, run that package's `pnpm build` to refresh `dist/*.d.mts`"). I didn't follow it after the rebase. The QA runner's pre-flight gate (`drive/qa/README.md § Standard pre-QA gate`) checks `pnpm typecheck && pnpm test:packages` but doesn't first force `pnpm install && pnpm build` — so it inherits whatever staleness the operator's worktree carries and reports it as if it were real product state. The failure mode is asymmetric: a stale dist is invisible (no warning that `dist/` predates the source), so the failure looks identical to a code bug.

The misdiagnosis didn't get caught by me; it got caught by an independent investigator agent who read the schema source on `origin/main` and noticed the ticket's error wording was inconsistent with the on-disk schema shape. Without that pushback, TML-2631 would have absorbed a stranger's cycles on a non-bug, and the PR body's "Reviewer notes" would have continued misleading PR reviewers.

**Suggested actions:**

1. `drive-qa-run`'s pre-QA gate should explicitly run `pnpm install && pnpm build` (or document why it doesn't — turbo cache, time budget) before running typecheck/test. Any "pre-existing failure" claim should be paired with an `origin/main`-side verification (`git stash && git checkout origin/main && <reproduce> && git checkout - && git stash pop`) before the runner is allowed to record it as such in a report or PR body.
2. `drive-pr-description`'s "Reviewer notes" section should refuse to record a claim of "pre-existing failure on `origin/main`" without a captured artefact of running the same test on `origin/main` and seeing it fail there too. If the operator skips that verification, the note should say "I did not verify this is pre-existing on `origin/main`" rather than implying verification.
3. As an agent self-discipline note: any time I'm about to say "this is broken on `origin/main`," that's a high-confidence-required claim and the verification cost is small (one git checkout + one test run). The right default is to verify.

**Upstream candidate?** Yes — high-leverage because the failure mode confidently misroutes attention to a non-bug.

## 2026-05-20 · drive-qa-plan · gap

QA scenarios that "run a short script that imports `@prisma-next/<extension>`" need the script to live **inside a pnpm workspace member directory** (e.g. `packages/<x>/scratch/`, `examples/<x>/`, or a dedicated QA fixtures package). The QA runner's natural instinct is to drop the script into `/tmp/` and `pnpm exec tsx /tmp/script.ts` — which fails because `/tmp/` is outside the workspace, so `pnpm`'s resolution can't find `@prisma-next/*` and `tsx` can't resolve the imports. The TML-2614 QA run hit this on every script-shape scenario and the runner had to rewrite the steps mid-run; the surviving `manual-qa.md` still has step wording that points at `/tmp/` paths (logged as F-1 in the run report).

`drive-qa-plan`'s skill body doesn't surface the constraint. It tells authors to write "scenarios that probe behaviour CI doesn't cover" and gives examples of "run a script" steps, but doesn't say "the script must live inside a workspace member — pick `packages/<package>/scratch/qa-<scenario>.ts` or `examples/<existing-example>/scripts/qa-<scenario>.ts`, never `/tmp/`." This is the kind of constraint that only bites at run time, so script authors who haven't run a QA pass before will reproduce the trap.

**Suggested action:** `drive-qa-plan` skill body should grow an "Authoring constraints for runnable scripts" subsection covering: (a) workspace-member location requirement; (b) the recommended pattern is `packages/<package>/scratch/qa-<scenario>.ts` (gitignored locally during the run, cleaned up at QA close) or a dedicated `qa-fixtures/<project>/` package created once per project; (c) invocation form is `pnpm --filter <package> exec tsx scratch/qa-<scenario>.ts` so workspace deps resolve. `drive-qa-run`'s "Standard pre-QA gate" should also explicitly check the script's `tsx` invocation works from the location written into the steps before declaring the run started — a fast-fail at gate time avoids the mid-run rewrite.

**Upstream candidate?** Yes — affects any consumer running drive-qa-* against a pnpm workspace.

## 2026-05-20 · drive-build-workflow + drive-deliver-workflow · gap

The workflow-orchestrator skills do not enumerate the QA gate. Verified by grep: `skills-contrib/drive-build-workflow/SKILL.md` and `skills-contrib/drive-deliver-workflow/SKILL.md` produce **zero matches** for `qa`, `drive-qa`, `manual qa`, `Manual QA`, `QA gate`, or `quality assur*`. The build orchestrator's described loop is "pre-flight DoR → brief assembly → delegate dispatch → WIP inspection → post-flight DoD → reviewer subagent verdict → loop / close." The deliver orchestrator's described loop is "init → slice-by-slice → health checks → retros on triggers → mandatory final retro → project close" and explicitly enumerates the sub-skills it calls (`drive-create-project, drive-specify-project, drive-plan-project, drive-build-workflow, drive-check-health, drive-run-retro, drive-close-project`) — `drive-qa-plan` and `drive-qa-run` are absent from that list. An agent procedurally following the workflow-orchestrator skills step-by-step never reaches a QA step. QA's existence is documented in `docs/drive/principles/definition-of-done.md` and surfaced in `drive/qa/README.md` + the two atomic skills' descriptions, but reaching those requires the agent to *go looking* for them — which the workflow orchestrators don't direct. This is the structural cause of the QA-skip on TML-2614 (alongside the agent-side failure of not voluntarily reaching for the QA skills despite them being in the available-skills list with explicit triggers).

**Suggested action:** `drive-build-workflow` should enumerate "QA gate (slice DoD)" as an explicit step after dispatch close, with a `Calls: drive-qa-plan, drive-qa-run` line. `drive-deliver-workflow` should enumerate "QA gate (project DoD)" before final retro / project close, and add `drive-qa-plan` + `drive-qa-run` to its explicit sub-skill list. The DoD step in both orchestrators should be unpacked into its components (validation gates, manual QA, retro) rather than left as a single abstract checkpoint — abstract checkpoints route through agent memory and fail silently when memory misses them. The fix is closing the "principles say X is a gate" / "workflow orchestrator doesn't list X as a step" indirection that lets manual gates fall through the loop.

**Upstream candidate?** Yes — this is the highest-leverage upstream finding from the trial so far. Any consumer using `drive-build-workflow` / `drive-deliver-workflow` as their orchestrator-skill mental model inherits the same blind spot for QA (and likely any other gate that lives in principles but not in the orchestrator step list). Queue for the synthesis ticket as a P0 structural fix.

## 2026-05-20 · drive-plan-project · boundary

Planned `db-close-teardown` as two slices (substrate facade changes; teaching skill updates) under one Linear ticket (TML-2614), co-shipped as one PR. Violates **1 slice = 1 PR**. The correct shape was **one slice with four dispatches** (postgres / sqlite / mongo / skills) — which is what executed at the dispatch level; we just labelled the wrong layer "slice." The drift mechanism: noticed "substrate and teaching have different shapes / audiences / validation gates" (true) and let that inference run to "different slices" (wrong) instead of "different dispatches inside one slice" (right). The load-bearing falsifier that should have halted the plan was the phrase `co-ship` (or equivalent) appearing in `plan.md` — that phrase is the operator confessing in their own words that the boundary they just drew doesn't separate two ship-units. Whenever it appears, collapse to one slice. (Two slices sharing a Linear ticket is a *weaker* signal; one user-problem normally maps to one slice but the edge case where it doesn't is legitimate, so ticket-sharing alone shouldn't hard-halt.) The deeper lesson under the rule's surface statement: **1 slice = 1 PR isn't an identity claim; it's a deliberate coupling that borrows PR-review pressure as the planning-unit sizing instrument.** Agents lack the embodied "this is too big to review" sense humans build by repetition; the PR boundary is the explicit substitute for that missing sense. Decoupling slice from PR (a position we initially steelmanned and discarded) loses that sizing pressure and replaces it with no equivalent — the slice DoD is a quality property, not a size one, and quality properties don't push back at the right time.

**Suggested action:** `drive-plan-project` and `drive-plan-slice` (and their READMEs) need a pre-flight gate at slice-drawing time — for each proposed slice, name the PR it ships in and the Linear ticket it closes; if either is shared with a sibling slice, the boundary is wrong and the move is to collapse to one slice with multiple dispatches. Promote `co-ship` (and synonyms — "lands together," "atomic with sibling," "must merge alongside") as the primary load-bearing falsifier; demote ticket-sharing to a secondary signal that prompts inspection rather than hard-halts. In `drive/calibration/sizing.md`: name the dispatch-vs-slice distinction explicitly — "too big for one slice" is usually "right-sized for one slice with multiple dispatches"; size pressure binds at the slice (PR-cap), variety pressure binds at the dispatch (shape / audience / validation-gate differences are normal *within* a slice). In `docs/drive/principles/decomposition-and-cost.md`: state the rule with the reason — slice = PR because PR carries the sizing-feedback loop that the planning layer otherwise lacks. The meta-lesson belongs there too: when proposing to relax a Drive rule, first ask what work the rule is doing beneath its surface statement; some rules are simple identities, others are deliberate couplings whose load-bearing work is invisible until you try to decouple.

**Upstream candidate?** Yes — the `co-ship` falsifier, the dispatch-vs-slice vocabulary, the "rules can be deliberate couplings" meta-lesson, and the rationale for binding slice to PR via review pressure are all upstream-worthy. Queue for the synthesis ticket.

## 2026-05-20 · drive-run-retro · surprise

Read-only reconnaissance (file `Read`, `Grep`, `Glob` on source) by the Orchestrator counts as drift even though intuition says reads are free. Symptom: orchestrator's broad-routing context fills with implementation detail; subsequent dispatch decisions degrade because the orchestrator reasons over fragments instead of structure. The DO-NOT enumeration in `drive/roles/README.md` lists read operations explicitly for this reason — counter-intuitive but correct.

**Suggested action:** landed in canonical `drive/roles/README.md § DO-NOT enumeration`. Watch for re-emergence in projects where the orchestrator's "I'll just check…" voice surfaces.

**Upstream candidate?** Yes — applies to any agent operating as an orchestrator regardless of harness.

## 2026-05-20 · drive-run-retro · win

AGENTS.md update mid-project (adding the canonical "Where skills and rules live" section + post-install wiring bullet) closed a foot-gun: a sub-agent halted because it assumed `.claude/skills/` was a canonical home rather than a symlink to `skills-contrib/`. The update prevents the same halt for future agents, especially for harnesses where the symlink presentation differs.

**Suggested action:** none. The update propagates via repo onboarding; future agents read AGENTS.md on entry.

**Upstream candidate?** Yes for the *pattern* (document the canonical-vs-presentation distinction in AGENTS.md / agent-onboarding docs) — the *content* is repo-specific.

## 2026-05-20 · drive-build-workflow · win

Trialled `composer-2.5-fast` as the implementer tier on two adjacent dispatches in the `db-close-teardown` project: (1c) a Mongo facade refactor applying a settled ownership rule plus `[Symbol.asyncDispose]`, and (2) a three-file doc update teaching the new surface across `prisma-next-{runtime,queries,debug}` skills. Both succeeded first-try, brief-accurate, voice-matched, with no clarifying questions. The composer tier handled brief-precise, narrow-surface, established-pattern work as well as Sonnet did on sibling dispatches (1a, 1b), at materially lower latency and cost. One miss in the second report: composer claimed "uncommitted work from slice 1 remains" when slice 1 was fully committed — deliverable was correct, the meta-state claim was not. Recommendation calibration updated in `drive/calibration/model-tier.md` to broaden composer-2.5's recommended applicability and to note the meta-reporting gotcha.

**Suggested action:** landed in `drive/calibration/model-tier.md` (new row for voice-aware doc edits; Architect-class narrow-surface row now permits composer-2.5 when brief is precise and pattern established; Confidence notes section added). Continue the trial — bump confidence further only after more dispatches accumulate. Validate composer's git-state assertions against `git status` directly when reading its reports.

**Upstream candidate?** Yes — once the trial accumulates enough evidence (handful more dispatches), the model-tier routing and the "validate state assertions" caveat are both upstream-worthy.

## 2026-05-20 · drive-run-retro · boundary

Cross-document tier vocabulary divergence surfaced during reviewer iteration: `docs/drive/principles/decomposition-and-cost.md` declares canonical tier labels as `fast / mid / thorough`; `docs/drive/principles/brief-discipline.md` declares them as `cheap / mid / orchestrator`. Each document is internally consistent post-fix; the framework uses two parallel taxonomies for the same concept. Worth a separate harmonization effort once the divergence causes confusion in practice; not filed as a Linear ticket pending operator decision.

**Suggested action:** no follow-up Linear ticket filed yet (pending operator decision). Until harmonised, new drive-* docs should adopt one taxonomy and cross-reference (not redefine) — pick whichever the team prefers and align everything else.

**Upstream candidate?** Yes — harmonization choice and the convention "one taxonomy across `docs/drive/principles/*`" propagates upstream.

## 2026-05-20 · drive-plan-project · win

Applied the `co-ship` falsifier mid-flight to `projects/contract-ir-planes/plan.md` before locking the slice composition into Linear tickets. A previous draft proposed six slices; the prose around "Slice 1" included *"no behavioural change yet because nothing consumes the new shape"* — exactly the falsifier wording from the earlier `boundary` finding above. Operator flagged the conflict by attaching the prior finding mid-discussion ("read this learning from another agent"). Collapsed Slices 1+2 into a single substrate slice with two dispatches (framework primitives → descriptor wiring), and Slices 3+5 / 4+5 into two migration slices each absorbing their own fixture regen as a dispatch. Final: 4 slices instead of 6; ticket count drops accordingly; dispatch count stays the same. PR-review pressure stays bound to the right unit.

The reason the catch was clean: the load-bearing falsifier was named, the operator surfaced the prior finding at the right moment, and the agent re-read its own plan against the rule rather than defending the original framing. The cost of catching at planning time was ~15 minutes of plan rewrite vs. the alternative cost (catching at PR-review time = one extra round-trip per affected slice = ~hours of cascading rework).

**Suggested action:** none for the framework — the falsifier is already named in the prior finding's suggested action ("Promote `co-ship`...as the primary load-bearing falsifier"). This entry just confirms the falsifier works as intended when the operator surfaces prior findings at slice-drawing time.

**Upstream candidate?** Yes — the *mechanism* (operator attaches prior finding mid-discussion → agent applies falsifier → plan revises before Linear mutation) is itself a reusable pattern. Worth documenting in `drive-plan-project` (or upstream equivalent) as "if a co-ship signal appears in your own plan prose, stop and collapse before proceeding to ticket creation."
