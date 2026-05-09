# M3 / Task 3.5 — E2E score artefact

**Test target:** the post-decomposition `drive-pr-local-review` composite (commit `9332bb587`) invoked against PR #434 at commit `ee05b2b4f872a2458c8a822eb3f16c0eab556933` — the natural test bed (the same branch that produced the F0–F6 cycle in the extension-contract-spaces project).

**Methodology:** one sub-subagent invocation that runs the composite end-to-end (the composite's own § 1 / § 2 scope-and-spec work, then the three sub-skill delegations in § 3.1 / § 3.2 / § 3.3, then the § 4 synthesis). Source-pinning to `ee05b2b4f` enforced via `git show <sha>:<path>` for every spec / source read; the workspace tree of `projects/extension-contract-spaces/**` was *not* consulted — it has post-PR work from the agent-personas project that would contaminate the test, per the m1 R1 source-pinning learning. Methodology mirrors m1 T1.4 (spawn one sub-subagent per the orchestrator's instruction; capture artefacts under `projects/agent-personas/assets/m3-e2e/`).

**Sub-subagent ID:** `52f5750e-69cb-4eb0-861b-5df1d3211b50` (one-shot for this E2E; not resumed).

---

## Verdict — PASS on both criteria

- **TC-13 parity:** PASS. All three artefacts exist side-by-side at `projects/agent-personas/assets/m3-e2e/`; format unchanged from the pre-decomposition shape; quality at parity (see § Detailed scoring below).
- **Probe-effectiveness verification (deferred from m1 R2):** PASS, with a nuanced reading. The architect persona's `## Probes` section fired materially in the run; *the discriminator-completeness probe specifically did its load-bearing job* — the F4 / F6 prefixes were checked for and confirmed eliminated at `ee05b2b4f`. Probes additionally surfaced new typology defects that pre-decomposition runs would have been less likely to catch (see § Probe-effectiveness detail below).

The post-decomposition composite is at parity with (and on probe-effectiveness, materially better than) the pre-decomposition shape.

---

## Detailed scoring — TC-13 parity

| Criterion | Result | Evidence |
|---|---|---|
| All three artefacts exist | PASS | `ls projects/agent-personas/assets/m3-e2e/` returns `system-design-review.md`, `code-review.md`, `walkthrough.md`. |
| Side-by-side in one directory | PASS | All three in `projects/agent-personas/assets/m3-e2e/`. |
| Format unchanged | PASS | system-design-review.md follows the pre-decomposition § 3 minimum-coverage list; code-review.md follows the pre-decomposition § 4.2 required sections (Summary / What looks solid / Findings / Deferred / Already addressed / AC verification with verdict-table-and-summary); walkthrough.md follows the pre-decomposition § 5 / `drive-pr-walkthrough` template. |
| Quality at parity | PASS | system-design-review.md (~29 KB, 251 lines) lands a CONCERNS verdict with 7 substantive findings (A01–A07) plus a probes-fired log. code-review.md (~31 KB, 204 lines) lands AC verification (4 PASS / 1 FAIL / 3 WEAK / 3 NOT VERIFIED) with three detailed findings (F01–F03). walkthrough.md (~24 KB, 178 lines) reads as a narrative; references sibling reviews at the right altitude; surfaces cross-lens conflicts as decisions. |
| AC-verification rigour preserved | PASS | code-review.md applies the verdict-definition discipline (PASS / FAIL / NOT VERIFIED / WEAK) per the pre-decomposition § 4.5 conventions; surfaces the AM2 spec-vs-code drift as a FAIL on the AC, not a "minor wording cleanup." |
| Cross-lens conflicts surfaced (composite § 4) | PASS | walkthrough.md surfaces the `LEGACY_MARKER_SHAPE` typology-vs-operability conflict (architect approves; principal-engineer flags remediation honesty) as a decision for the human, not a merged verdict. Per the tech-lead persona's `persona-conflict probe`. |

---

## Detailed scoring — probe-effectiveness

Per the m1 R2 deferral: this E2E was the natural test bed for whether the architect persona's `## Probes` section fires on the same surface that originally produced F4 / F6.

**Headline result:** the probes fired materially. Concretely:

- **Discriminator-completeness probe — `Authored*` / `Extension*`.** Fired. The probe's intended target on this surface (the F4 → F6 cleanup that landed pre-`ee05b2b4f`) was *checked and confirmed clean* — the architect persona did not re-derive a defect that no longer exists. This is the *correct* probe outcome on this surface; the probe also surfaced one stale fixture-comment (a pre-rename narrative line) as a docs-follow-up rather than a typology defect, which is the right calibration.
- **Discriminator-completeness probe — `OnDisk*`.** Fired and *caught* a typology-debt finding (A03): the `OnDisk` prefix overloads two distinctions (a `dirPath` field + an implicit verified-ness invariant). The probe's *singular* axis caught this — the prefix is not doing one job, and the JSDoc admits it.
- **Discriminator-completeness probe — `LEGACY_*`.** Fired and *passed* — `LEGACY_MARKER_SHAPE` is concrete / singular / structural / stable. The probe correctly distinguished a load-bearing qualifier from an overloaded one.
- **Consumer-vs-essence probe.** Fired hard on the headline finding A01: `{ hash, invariants }` is declared five times under five consumer-named types (`ContractSpaceHeadRef`, `PinnedSpaceHeadRef`, `SpacePinnedHashRecord`, `SpaceMarkerRecord`, `RefEntry`). The `PinnedSpaceHeadRef` JSDoc admits the duplication out loud (*"Mirrors `RefEntry` but is redeclared locally so callers can construct the input without depending on the refs module"*). Without the probe, the sub-subagent's honesty check ("did the loaded personas materially change what I wrote? Yes") explicitly named this finding as one it would have demoted to "minor naming cleanup" without the probe loaded.
- **Concept-vs-mechanism probe.** Fired on the unqualified `space` SQL-column name. Surfaced as a smaller finding.
- **Symmetry probe.** Fired on duplicate-id rejection coverage and space-id validation across sibling helpers; surfaced as A07.
- **Reads-cold probe.** Fired on `SpacePinnedHashRecord` (A04 — name says hash, type carries hash + invariants).

**Did the probes re-derive F4 / F6 in their strongest form?** No, because **F4 / F6 had already been resolved before `ee05b2b4f`.** The probe-effectiveness check was *whether the architect persona would, in a fresh single-pass run, re-derive the F4 / F6 class of finding on this surface.* The honest answer is: the probes' load-bearing target on this surface was the *successor* class of typology defect — A01 (`{hash, invariants}` declared five times), A02 (flat `ContractSpace` with runtime discriminators), A03 (overloaded `OnDisk*` prefix). All three are direct intellectual descendants of the F4 / F6 cognitive moves; they're what F4 / F6 would have looked like if the same probes had been applied to the *current* surface rather than the *pre-cleanup* surface.

**Concretely, did A01 / A02 land at the right altitude?** Both are headline findings in `system-design-review.md § Verdict — CONCERNS`. A01 was elevated specifically because *every M2 / M3 consumer that lands on top of this surface will reach for a sixth name unless the typology is reconciled here* — exactly the load-bearing-name framing the architect persona's stance demands. A02 was elevated because the runtime universally re-encodes a partition the type system says doesn't exist — the discriminator-completeness probe's *stable* axis caught it.

---

## Honest framing per `learnings.md` § "Personas raise the floor"

This E2E is consistent with the m1 R1 finding: a persona shifts execution-time bias and raises the bar at which a class of concern is dismissed; it does not turn the agent into the user during interactive review.

- Concretely: A01 (consolidate the five `{hash, invariants}` declarations) carries a buildability-vs-typology trade-off (consolidating would change the import graph for `migration-tools`; the current re-declarations exist *to keep `migration-tools` from depending on `refs.ts`*). The architect persona's probe surfaced *the typology debt*; the lens *cannot* adjudicate the cycle question — it correctly referred that to the principal-engineer.
- Concretely: A02 (flat `ContractSpace` with runtime discriminators) surfaces *a typology hole*; whether to reshape the type system or accept the hole as part of the control-plane abstraction is *the user's call*, not the persona's. The persona elevated it to the human.
- The strongest forms of these findings (e.g. *"introduce `ContractStateRef` as the canonical type and retire the four duplicates over M2 / M3"*) are still iteration-with-the-user material. The persona raised the floor; it did not eliminate the post-implementation interactive-review pass.

This is the m1 R2 caveat operationalised in production conditions, and it lands honestly.

---

## What this does NOT verify

- **TC-10 (behaviour smoke).** Out of scope for T3.5; T3.6 is the next task.
- **Cross-pollination preservation in the Shape-B `drive-design-discussion` retrofit.** T3.6 is the test bed for that.
- **Long-run probe-effectiveness across multiple test beds.** This run is *one* fresh single-pass invocation; the m1 R1 caveat that "personas raise the floor; do not eliminate the human pass" applies — multi-bed verification of probe-effectiveness across other classes of typology defect is a v2+ exercise.

---

## Files in this directory

- `system-design-review.md` — architect-lens review of PR #434 at `ee05b2b4f`. Verdict CONCERNS.
- `code-review.md` — principal-engineer-lens review + AC verification. 4 PASS / 1 FAIL / 3 WEAK / 3 NOT VERIFIED.
- `walkthrough.md` — tech-lead-lens narrative tour. References sibling reviews at altitude; surfaces cross-lens conflicts as decisions.
- `score.md` — this file.
