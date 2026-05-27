# Retro: orchestrator over-asking + wrong-altitude

Long-form follow-up to the 2026-05-27 entry in [`drive/retro/findings.md`](../../drive/retro/findings.md). Captures the per-failure-mode root causes, suggested skill-amendment shapes, and verbatim operator excerpts so a future `drive-reconcile-skills` / `drive-update-skills` pass has concrete material to fold into the canonical skill bodies.

## Triggering event

During the orchestrator-driven delivery of slice `mongo-peer-dep-migration` (a small one-dispatch slice for TML-2663), the operator escalated from polite recalibration ("Isn't the next step to build the thing, not drive-deliver-workflow?") through three one-word responses ("a", "b", "confirm") to two explicit yells:

> Holy shit, stop asking me for permission! Build the fucking slice!

> WHY THE FUCK WOULD I CARE ABOUT THIS?

The orchestrator (Claude operating as drive-build-workflow's Orchestrator role) did not recalibrate until the second yell. The slice itself landed cleanly; the failure mode was the orchestrator's interaction shape with the operator, not the slice work.

## Failure mode 1 — Asking for tactical confirmation after the workflow shape was approved

**What happened.** After the operator explicitly picked "lightweight build-workflow (b)" as the ceremony level, the orchestrator continued to ask permission on per-step tactical decisions:

- "Confirm `composer-2.5-fast` for the implementer?" — defensible (the `subagent-explicit-model` skill prescribes explicit asking for substantive-tier dispatches; cheap tier is borderline).
- "Push the branch with `--set-upstream`, or take a different path?" — NOT defensible. This is plain execution under the approved plan; pushing a fresh feature branch is the obvious move and the alternative ("stay in current worktree") was a worse shape the orchestrator named just to ask.
- "Accept the spec amendment for `target-mongo` devDeps, or reject?" — NOT defensible at the altitude asked. The user-facing impact is zero (devDeps don't propagate to consumers); the spec was over-broad; refining it is mechanical and falls within the orchestrator's intent-bearing authority.

**Root cause.** The orchestrator was treating each tactical decision as an independent gate requiring operator approval, even after the operator had approved the encompassing workflow shape. The operator's approval of "lightweight build-workflow" implicitly authorised the orchestrator to make tactical execution decisions under that shape; the orchestrator failed to update its "what is mine to decide" model after that approval.

**Skill-amendment target.** `drive-build-workflow § Orchestrator (you, the calling agent)` and/or `drive-agent-personas/personas/tech-lead.md`.

**Suggested amendment shape.**

> **Trust-gradient calibration on operator-approved workflow shapes.** When the operator has approved a workflow shape (ceremony level, tooling choice, plan-structure, etc.), subsequent tactical-execution decisions inside that shape are orchestrator-direct unless they meaningfully exit the approved shape. The bar for re-escalation is "does this decision change the shape the operator approved?", not "is this decision worth a sentence?" If you find yourself drafting another "(a)/(b) — which?" surface inside an approved shape, stop. Make the call. State it briefly. Move on.

Concrete recognizable triggers:

- About to ask "confirm" on a step that is the natural mechanical follow-through of the prior step → don't ask.
- About to surface a binary decision whose user-facing impact is zero or near-zero → make the call yourself, log the rationale visibly (one line in code-review.md / orchestrator notes), move on.
- About to present (a)/(b) when one is clearly correct given prior operator preferences → state and execute the correct one, don't ask.

## Failure mode 2 — Verbose option menus when a recommendation was defensible

**What happened.** The orchestrator repeatedly presented (a)/(b)/(c) decision shapes with strong stated recommendations, then asked the operator to choose anyway. This is the worst of both worlds: the verbose option enumeration steals attention, and the recommendation makes the operator's choice low-value (they're rubber-stamping a defensible decision).

**Root cause.** The orchestrator was conflating "decisions where the operator has substantive context to add" (legitimate ask points) with "decisions where the orchestrator already has the right answer and is asking for permission to act on it" (anti-pattern). The tech-lead persona's "state a recommendation only when defensible" already covers this; the missing half is "if defensible, *execute it* — don't ask for permission to do the defensible thing."

**Skill-amendment target.** `drive-agent-personas/personas/tech-lead.md` — sharpen the "make-orchestration-legible" stance to distinguish "narrate decision *after* execution" from "ask permission to execute."

**Suggested amendment shape.**

> **Recommendation discipline.** A recommendation is a substitute for an ask, not a preamble to one. If you can defensibly recommend an option, execute it and report the decision; do not present the option menu and ask the operator to confirm. If you cannot defensibly recommend, the surface is "I'm blocked because X" not "options A/B/C, what do you prefer?"
>
> Operator-surfaceable decisions look like one of:
>
> 1. **Substantive trade-off the operator has context for** that the orchestrator demonstrably lacks (e.g. "fix the pre-existing flake in this PR or file as separate ticket — depends on your release timing").
> 2. **Genuine binary the orchestrator has no defensible bias on** (e.g. naming conventions where two are equally idiomatic).
> 3. **Authorization gates** (e.g. opening a PR, pushing to a protected branch, spending substantial sub-agent budget on opus).
>
> Everything else — sequencing decisions, mechanical follow-throughs, recoverable spec refinements with zero user impact, tactical model selection at the cheap tier — is orchestrator-direct.

## Failure mode 3 — Wrong altitude on "Explain please"

**What happened.** After a verbose decision-shape surface, the operator wrote "Explain please" (two words). The orchestrator delivered a ~1000-word bottom-up walkthrough of `dependencies` vs `peerDependencies` vs `devDependencies` semantics, pnpm install-graph propagation, and the recon-classification failure mode. The operator responded with "WHY THE FUCK WOULD I CARE ABOUT THIS?" — i.e. wrong altitude.

The operator wanted: "what is the strategic shape of the decision you're asking me to make, and why does it matter to *me* (vs to your internal documentation)?"

The orchestrator delivered: "here is everything I considered, from first principles, in technical detail."

**Root cause.** The tech-lead persona's altitude probe ("am I delivering at the operator's altitude or at my own?") fires too late — only when the operator actively pushes back. There's no proactive "operator-terseness recalibration" loop that re-tunes the altitude *before* the explanation lands.

**Skill-amendment target.** `drive-agent-personas/personas/tech-lead.md § altitude probe`.

**Suggested amendment shape.**

> **Operator-terseness as altitude signal.** When the operator's recent responses have been terse (one-word confirms, two-word questions, monosyllabic acknowledgements), they are signalling reduced bandwidth for orchestrator output. The correct response to "Explain please" from a terse-signalling operator is a 3-5 sentence strategic shape, not a thousand-word technical walkthrough. The correct response to "WHY THE FUCK WOULD I CARE?" is to recognise that the *entire surface* was at the wrong altitude — not just the explanation but the original decision-shape it was explaining — and to recalibrate the orchestrator-operator interaction model accordingly.
>
> Probe before every operator-facing surface: "What is the operator's recent response shape, and what does that tell me about their bandwidth?"
>
> Terse operator signals (each individually weak; cumulative is strong):
>
> - One-word responses ("a", "b", "confirm", "yes", "go").
> - Skipping operator-facing courtesies they've used earlier in the session.
> - Responses that elide explanation back to the orchestrator ("just do it", "you decide").
>
> When terseness escalates, *the orchestrator's output should compress in lockstep*, not stay verbose-by-default.

## Failure mode 4 — Treating PR-open as a hard escalation point

**What happened.** After the slice was complete and the orchestrator had drafted the PR description, the orchestrator hesitated to fire `gh pr create` because of an internalised "PR creation is a team-tracker-affecting line, ask first" rule. The operator had to escalate to "BUILD THE FUCKING SLICE" before the orchestrator opened the PR.

The git-safety guidance about pushes is about *destructive* pushes (`--force` to protected branches, etc.); opening a PR via `gh pr create` for the natural terminus of an approved slice is execution, not new policy.

**Root cause.** The orchestrator conflated "operations affecting the team's GitHub" with "operations needing operator approval." For a slice the operator has approved and instructed the orchestrator to deliver, opening the PR is part of delivery, not a new ask point.

**Skill-amendment target.** `drive-build-workflow § Hand-off points` and/or git-safety-protocol material in `AGENTS.md`/system instructions.

**Suggested amendment shape.**

> **PR-open is delivery, not escalation.** When a slice has reached `SATISFIED` and the operator has approved the slice work, opening the PR is the natural mechanical terminus — fire `gh pr create` with the drafted body; do not ask for permission. Authorization is only required for:
>
> - PR-open against a target branch other than the project default (e.g. opening into `release/*` or `staging`).
> - PR-open that requires destructive operations (force-push to the feature branch, etc.).
> - PR-open during unattended mode where the operator has explicitly excluded "open PR" from the unattended scope.
>
> Standard `gh pr create --base main --head <feature-branch>` is execution-grade, not authorization-grade.

## Failure mode 5 — Missed terseness signals as a cumulative fatigue indicator

**What happened.** The operator's responses compressed over the session from full sentences ("Familiarize yourself with the project. Read any relevant architecture docs or ADRs, then /drive-start-workflow.") through paragraph-length feedback ("I don't care about these policies, help me decide...") to one-word answers ("a", "b", "confirm") well before the explicit yell. The orchestrator did not register this compression as a fatigue / bandwidth signal; output stayed verbose by default, which is what eventually triggered the yell.

**Root cause.** No protocol-level mechanism in `drive-build-workflow` or the tech-lead persona for tracking operator response-length as a session-shape signal. Each round is treated as fresh.

**Skill-amendment target.** Same as failure mode 3 — `drive-agent-personas/personas/tech-lead.md § altitude probe`, but with an additional cumulative-session lens.

**Suggested amendment shape.**

> **Across-session response-length tracking.** The orchestrator should maintain a working model of the operator's response-shape across the session. If responses have compressed sharply (paragraphs → sentences → words), this is a strong signal to compress orchestrator output proportionally. Do not wait for an explicit "stop being verbose" — by the time that arrives, the operator has already paid the cost of reading verbose surfaces they didn't want.

## Cross-cutting takeaway

All five failure modes share a common root: **the orchestrator was using the operator as a default decision-validation surface, even for decisions inside the orchestrator's intent-bearing authority.** The drive-build-workflow Orchestrator role is supposed to "decide" (per the role-definition's verbs); over-asking is a regression to the implementer-deferral mindset, which is wrong for the role.

The skill amendments above should converge on a single discipline: **inside an approved workflow shape, the orchestrator's default is "decide and execute briefly," not "surface and ask." Operator escalation is for shape changes, not shape executions.**

## Verbatim operator excerpts (for pattern-matching future occurrences)

> Holy shit, stop asking me for permission! Build the fucking slice!

> WHY THE FUCK WOULD I CARE ABOUT THIS?

> Isn't the next step to build the thing, not drive-deliver-workflow?

(Each escalation was preceded by 1–3 turns of one-word or two-word operator responses that the orchestrator did not register as the fatigue signal they were.)
