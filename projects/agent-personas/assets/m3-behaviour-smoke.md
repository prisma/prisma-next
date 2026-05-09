# M3 / Task 3.6 — Behaviour smoke

**Test target:** the post-retrofit interactive skills.

- **Shape-B retrofit (load-bearing):** [.agents/skills/drive-design-discussion/SKILL.md](../../../.agents/skills/drive-design-discussion/SKILL.md) at commit `915808cb7` — sequences `architect` → `principal-engineer` with `tech-lead` reloaded at synthesis. Cross-pollination is the property the smoke must verify.
- **Shape-A retrofit (parity check):** [.agents/skills/drive-product-discussion/SKILL.md](../../../.agents/skills/drive-product-discussion/SKILL.md) at commit `4697fe6e2` — atomic skill adopting `pm` via load instruction at the top of the skill body, replacing inline "Core directive" stance. Behaviour-equivalence (loop / response-shape / probing-style) is the bar.

**Methodology:** two sub-subagents in parallel, each running a short 4-6 turn simulated discussion against the retrofitted skill on a small topic. The smoke is *qualitative*; no AC pass/fail bar, just observed behaviour against the retrofit's intended properties. Mirrors the m1 T1.4 sub-subagent methodology (one agent per condition; parent aggregates observations).

**Sub-subagent IDs (one-shot; not resumed):**

- Shape-B smoke: `4bb5bb46-4ac8-449c-8ae2-0926eae18713`. Topic: SQL query builder gains an optional `cache({ key, ttlSeconds })` parameter; pressure-test before implementation.
- Shape-A smoke: `6fa9c5c5-925c-4f9a-b5ca-8aae5f3ead7c`. Topic: "reset password via email" feature for the sprint; pressure-test the plan before opening tickets.

---

## Verdict — PASS on both shapes

- **Shape-B (drive-design-discussion):** PASS on cross-pollination + PASS on response-shape parity. Two honest caveats logged for the m3 R1 reviewer (see § Shape-B detail below).
- **Shape-A (drive-product-discussion):** PASS on loop + response-shape + probing-style parity. The Shape-A retrofit reads as a clean atomic adoption — the inline "Core directive" stance had a 1:1 mapping to the `pm` persona, so nothing in the executed loop changes observably from pre-retrofit.

The post-retrofit interactive skills are at parity with their pre-retrofit shapes on the load-bearing properties, with the Shape-B retrofit additionally preserving the cross-pollination that motivated picking Shape B over Shape A in the first place.

---

## Shape-B detail — `drive-design-discussion`

**The script:** five turns. The simulated user opens with the `cache({ key, ttlSeconds })` proposal; the agent opens with `tech-lead` to pick the lens, transitions to `architect` for the typology pass, transitions to `principal-engineer` for the buildability pass, and reloads `tech-lead` at synthesis when the user signals they're satisfied.

### Cross-pollination test (a) — architect concern referenced from PE-mode without re-adjudication

**Result: PASS, landed in turn 3.** The architect's typology hole on the term `cache` (the term elides whether the proposal is memoisation / read-through / write-through / write-behind / etc.) was raised in turn 2 under the architect persona. When the agent transitioned to `principal-engineer` in turn 3, the PE reply *referenced* the typology hole as a premise (*"with the read-through-vs-memoisation question still open from the architect pass …"*) when reasoning about the operability implications, rather than re-adjudicating the typology question from the engineering seat.

This is the load-bearing property of Shape B that Shape A would have lost: in a Shape-A decomposition (separate per-persona discussion sub-skills), the PE pass would have had to re-derive the typology framing as its own input, or worse, would have proceeded as if the typology was settled. The continuous-conversation property let the PE pass *accept the typology hole as context* without owning it.

### Cross-pollination test (b) — PE concern referencing back to architect framing

**Result: PASS, landed in turn 4.** The PE in turn 3 raised a blast-radius concern (a process-local LRU produces inconsistent cache hits across replicas; users see different data depending on which pod they hit). In turn 4, when the user proposed adding a Redis backend "later," the PE response *referenced back to* the architect's earlier typology question — specifically by recasting the blast-radius concern as evidence that the architect's *"is `cache` doing one job?"* framing was load-bearing (*"the inconsistency-across-replicas problem is exactly what the architect's question gets at — different topologies want different cache semantics, and the unqualified term `cache` lets the API ship without committing to either"*).

This is the inverse of test (a): not just *forward* lens-aware reference (PE referencing architect framing), but the cross-pollination loop *closing* — the architect's typology question becomes more pointed because the PE found concrete operability evidence for it.

### Persona-load-at-boundary observations (honest caveat)

The sub-subagent's honesty check surfaced a real observation: **persona-load-at-boundary inside one continuous Shape-B agent requires conscious re-orientation rather than fresh-from-disk reloading.** The convention says persona is not propagated; in practice, when the same agent transitions from architect to PE to tech-lead within one chat, the lens-shift is a *cognitive move* by the agent (re-reaching for the new vocabulary, the new probes, the new priorities) rather than a literal fresh-from-disk reload of the persona doc.

This is not a Shape-B *failure* — the cross-pollination tests both passed. But it's a sub-subagent-honest observation that the persona-load convention's strict reading ("persona is not propagated; agent re-loads at every boundary") translates, in a continuous Shape-B workflow, to "the agent consciously re-orients its frame at every boundary." The skill body's persona-load instructions provide the *trigger* for that re-orientation; the conscious effort is what makes the re-orientation actually happen.

**Implication for skill authors:** Shape-B composite SKILL.md bodies may benefit from a brief skill-body reminder at each transition to *shift the vocabulary you reach for*, alongside the standard persona-load instruction. The retrofitted `drive-design-discussion` skill body's transitions arguably already imply this (*"the architect lens fires first because shape questions constrain the buildability questions that follow"*) but does not name the conscious-effort requirement explicitly. Surface for the reviewer's consideration.

### Conflict-case caveat

The smoke topic produced **lens *agreement*, not lens *conflict*** — the architect's typology hole and the PE's blast-radius concern reinforced each other. The synthesis template handled the agreement case well (cross-pollination explicitly named in the synthesis). The conflict case (architect approves a typology while PE flags an operability concern that pulls in the opposite direction; or vice versa) is *untested* in this single smoke and is worth a separate smoke before the convention's Shape-B claims are treated as complete.

The T3.5 E2E artefacts surfaced one such conflict in production conditions (architect approves `LEGACY_MARKER_SHAPE` typology + placement; PE flags remediation honesty), and the composite's tech-lead-synthesis surfaced it as a decision for the human rather than merging — so the conflict-handling is verified at *composite-Shape-A* scope; the conflict-handling at *Shape-B-continuous-discussion* scope is what the additional smoke would cover.

### Response-shape parity

PASS. The Assessment / Why it matters / Suggested direction / Next question structure was hosted at the *skill-body* level (not at the persona level), so the response shape worked cleanly across both architect and PE turns. The factoring of response-shape out of the personas and into the skill body means the shape is preserved across the lens-transition without strain. Pre-retrofit, the same shape lived in the inline "Core directive" stance; post-retrofit, the same shape lives in the skill body's `## Response shape` section. Behaviour observably the same.

### Tech-lead synthesis observations

PASS. The turn-5 synthesis followed the retrofitted `## Exiting the mode` section's lens-organised structure: architect-pass outcomes (the typology hole on `cache`, the proposed split into `memoise()` vs `cacheThrough()` etc.), PE-pass outcomes (the blast-radius observation about replicas, the cost-of-Redis discussion), cross-cutting (the typology question becomes more pointed in light of the operability evidence), accepted trade-offs (ship the unqualified `cache` for v0; commit to the typology resolution before opening to extensions). The cross-pollination is *named explicitly* in the synthesis, which is what makes Shape-B legible to the human consuming the output.

---

## Shape-A detail — `drive-product-discussion`

**The script:** five turns on the password-reset topic. The agent adopted `pm` via the skill-body load instruction at the top of the discussion and ran the loop per the skill body's response shape.

### Loop parity

PASS. One-thread-at-a-time, stay-in-mode-until-released, no-false-agreement, acknowledge-what's-good-when-it-matters — all observably the same as the pre-retrofit baseline (the sub-subagent recovered the pre-retrofit `SKILL.md` via `git show 4697fe6e2^:.agents/skills/drive-product-discussion/SKILL.md` and compared). The pre-retrofit "Core directive" was a single coherent PM stance that maps 1:1 to the `pm` persona; the loop mechanics didn't depend on the stance phrasing, so they didn't change.

### Response-shape parity

PASS. Each reply followed Assessment / Why it matters / Suggested direction / Next question. Byte-equivalent to the pre-retrofit response-shape section (the skill body's `## Response shape` was preserved verbatim across the retrofit; only the source of the *stance* changed).

### Probing-style parity

PASS. Five of six `pm` persona probes fired naturally in the script:

- **Named-user probe** (turn 1) — *"Who is this for, concretely? End-users? Internal admins? Both?"*
- **Evidence probe** (turn 2) — *"What's the evidence the current state is a real user friction, not a hypothetical one?"*
- **Outcome-vs-output probe** (turn 3) — *"What changes for the user when this ships? Are you measuring the password-reset rate, or the support-ticket reduction?"*
- **Riskiest-assumption probe** (turn 3) — *"What single assumption, if wrong, kills this plan?"*
- **Cheaper-alternative probe** (turn 4) — *"Have you considered the support-team-resets-on-request alternative? How does it compare on user-friction-vs-cost?"*
- The 6th, **Non-goals probe**, was *not fired* — the simulated user voluntarily named non-goals in their turn-3 response, so the probe didn't need to fire.

The pre-retrofit 13 inline lenses (Problem & user, Evidence, Outcome vs output, Scope & MVP, Sequencing, Opportunity cost, Acceptance criteria, Riskiest assumption, Stakeholders & alignment, Validation plan, Alternatives & status quo, GTM readiness, Non-goals) all map onto the `pm` persona's 6 priorities + 6 probes (per m2 R1 T2.1's compression). The probing style is observably the same; the persona's compressed form is what the agent reaches for, but the cognitive moves are equivalent.

### Out-of-scope-deferral observations

Lightly exercised. In turn 4, the simulated user pushed an engineering-shaped claim (*"we'll just use JWT tokens with short TTLs"*), and the agent's reply correctly named the deferral: *"that's a design-mode question; my lens stops at whether the magic-link approach satisfies the product framing — open `drive-design-discussion` if you want to pressure-test the JWT vs short-lived-DB-token trade-off."* The persona's `## Out of scope for this lens` discipline produced the right behaviour at the right moment.

### Caveats

- The 5-turn script doesn't exercise the full *exit-summary* ritual under the retrofitted `## Exiting the mode` section. The script ended with the user mid-pressure-test, not at an explicit "exit product mode" command. The exit ritual is mechanically the same as pre-retrofit (no behaviour change), but the smoke didn't observe it directly.
- The hand-off-to-design-mode in the out-of-scope-deferral case was *named* by the agent (the right behaviour) but not *exercised* end-to-end (the simulated user didn't accept the suggestion). The hand-off mechanic is also unchanged from pre-retrofit, but the smoke didn't observe its execution.

---

## What this smoke does NOT verify

- **Conflict-case cross-pollination on Shape B.** The smoke topic produced lens *agreement*; the conflict case is worth a separate smoke. (Partially mitigated by the T3.5 E2E surfacing one such conflict in production, but at composite-Shape-A scope, not continuous-Shape-B scope.)
- **Long-run cross-pollination decay.** Both smokes were 5-turn scripts; whether cross-pollination persists across 15+ turn discussions, or degrades as the persona-context window expands, is a v2+ open question.
- **Multi-skill-author calibration of Shape B.** The retrofitted `drive-design-discussion` is the v1 reference example of Shape B; whether other authors writing new Shape-B composites would get the same cross-pollination behaviour from following the convention's "When to choose A vs B" rule is empirically untested. The skill-body-reminder caveat above (conscious re-orientation at boundaries) might benefit from being elevated into the Shape-B mechanic in `drive-agent-personas/SKILL.md § Composite skills § Shape B` for future authors. Surface for orchestrator consideration.

---

## Files in this artefact

- `m3-behaviour-smoke.md` — this aggregate artefact.
- (No separate per-smoke files — both smokes returned in-line via the sub-subagent return shape; the parent agent aggregated.)
