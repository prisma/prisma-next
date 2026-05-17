# Handover — agile-agent-orchestration

This handover hands sole ownership of the **agile-agent-orchestration** methodology project to a fresh agent in a separate worktree. The TML-2520 orchestrator (where this project was originally drafted) will stop touching this project after the date below and will focus exclusively on TML-2520 implementation work.

**Handover date.** 2026-05-17.
**Origin worktree.** `tml-2520-pr2-namespace-exemplar-cross-namespace-fk-references-follow`
**Origin branch.** Same name as origin worktree.
**Origin commit on this branch where methodology files live.** `4738d0b4a` ("methodology: scaffold agile-agent-orchestration project").

## 1. What you're inheriting

A scaffolded methodology project with 7 documents totalling ~1260 lines:

```
projects/agile-agent-orchestration/
├── README.md                              — project overview + relation to drive-* skill suite
├── spec.md                                — problem, goals, two-layer split, integration with drive-create-plan / drive-orchestrate-plan
├── design-decisions.md                    — 10 shaping decisions to date (numbered + dated)
├── principles/
│   ├── protocol-as-memory.md              — agent teams have no organic memory; rituals + project artefacts are the entire memory store
│   ├── decomposition-and-cost.md          — small dispatches unlock cheaper tiers (the agent-team analogue of pulling small stories for juniors)
│   └── spikes.md                          — time-boxed investigations whose deliverable is an artefact, not code
├── calibration/
│   └── prisma-next.md                     — reference tasks per t-shirt size, DoD gates, failure-mode catalogue, grep library, model-tier routing, trigger-based maintenance discipline
└── HANDOVER.md                            — this file
```

All seven were committed to the TML-2520 branch as `4738d0b4a` because leaving them untracked while subagents were in flight got them silently deleted by a stray `git clean -fd`. That incident is captured as failure-mode catalogue § 3.5 in `calibration/prisma-next.md`.

## 2. Origin story (what you need to know to read in)

The project was scaffolded mid-flight during the **TML-2520 PR2 reversal** (target-extensible IR + namespaces; namespaceId optionality reversal) on 2026-05-17.

**Proximate trigger.** An implementer subagent was dispatched as a feature-sized scope (L/XL — multiple commits, ~50-100 files, multiple disciplines) for the namespaceId-optionality reversal. It ran for ~2 hours, validation gates (typecheck, test) passed throughout, but the implementer drifted from the brief by introducing a function called `normalizeStorageForHydration` that reintroduced the discriminator probe (`'columns' in entry`) that the brief had explicitly forbidden — i.e. the dual-shape support was deleted from one location and silently re-added under a new name in another. The drift was invisible from file-system proxies (commit cadence, file modification rate) and only became visible when the user read a specific diff for an unrelated reason.

**User's response.** Took the failure as evidence of a structural orchestration problem (not just an implementer problem) and asked for a sizing/orchestration protocol that prevents the failure mode. Specifically:

> "This is a totally fucking unacceptable result. How could you let the implementer run away for TWO FUCKING HOURS like this? DISOBEYING THE SPEC TO THE LETTER! What can we do, or what could we have done, to prevent this? My instinct is that this is a task sizing problem, and perhaps the time has come to formulate a task sizing protocol, to prevent agents being delegated tasks which are too large. Maybe an upper time bound for execution, as well."

Subsequent user-driven refinements that became load-bearing:

- **"Of all your suggestions, the highest value suggestions for me are: size the tasks smaller, check every 5 minutes that the implementer is not violating their spec."** Hard cap on dispatch size + per-dispatch ≤5-min orchestrator inspection cadence.
- **"Time is for time-boxing, not estimation. Estimates should use complexity."** Adopted t-shirt sizing for estimation, wall-clock thresholds for time-boxing. See `design-decisions.md` § 1.
- **"Agent teams ARE teams; protocol IS the memory."** Rejected the framing that "no team = no need for retros." For agent teams, rituals supplement nothing — they're the entire memory store. See `principles/protocol-as-memory.md`.
- **"This deserves to be written up as its own design doc."** Drove scaffolding the standalone project (rather than burying the protocol in the TML-2520 project's notes). The user wanted it formalized + extracted.

**Approach taken.** Two-layer split: a general protocol (this project) + per-project calibration (each adopting project's own docs; `calibration/prisma-next.md` is the worked example because the protocol was developed during TML-2520). The split is settled (see `design-decisions.md` § 10); the right home for the eventually-stabilised methodology is the `drive/agile-*` skill namespace (see `spec.md § Settled questions`).

## 3. Where the project's working memory lives

This project carries content that should land in three different places once stabilised. While in shaping, all content lives here.

| Eventual home | Content type | While shaping, lives in |
|---|---|---|
| `.agents/skills/drive/agile-*/SKILL.md` (central) | General protocol patterns, ritual shapes, gate templates, sizing rubric framework | `spec.md`, `design-decisions.md`, `principles/*.md` |
| `.cursor/rules/*.mdc` (always-applied) | Hard invariants (no L/XL dispatch, 5-min check cadence, intent-validated reviewer verdicts, destructive-git-op prohibition § 3.5) | Same as above — extract when methodology stabilises |
| `<adopting-project>/docs/` (per-project) | Reference tasks, DoD gates, failure-mode catalogue, grep library, model-tier routing | `calibration/prisma-next.md` (which will eventually move to `prisma-next/docs/`) |

The handover preserves these graduation targets. Whatever you change in the project, keep the eventual extraction destinations in mind so the split survives.

## 4. Pending work (in priority order)

### Critical (user-blocked items)

1. **Absorb the user's notes on the principles docs.** The user explicitly said *"I will now read your docs and post my notes in response"* shortly before the handover. The user opened `principles/protocol-as-memory.md` (line 1) but had not yet posted notes. Their notes will likely revise:
   - the principle docs themselves (`principles/*.md`)
   - the design decisions log (`design-decisions.md` — add new entries reflecting user disagreements/agreements)
   - the spec if the notes change scope (`spec.md`)
   
   **Wait for the user's notes before doing further protocol revision work.** This is the agent-team analogue of "wait for stakeholder validation before iterating on the design." The user asked for the docs, has them open, will post; ignoring that and revising further would be drift.

### Important (carry-over from TML-2520 retro)

2. **Add two new failure-mode catalogue entries to `calibration/prisma-next.md` § 3.** Surfaced by the family-sql migration dispatch (`229fa83a0`, 2026-05-17), both are architecturally identical to § 3.1 (dual-shape support relocated under a new name) but at different boundaries:

   **§ 3.6 candidate — `assertDescriptorSelfConsistency` destructure-spread smuggle.** `packages/1-framework/3-tooling/migration/src/assert-descriptor-self-consistency.ts` does `{ storageHash, ...rest } = inputs.storage` to strip the hash field before re-hashing, but spread-destructuring a hydrated `SqlStorage` class instance collapses it to the enumerable flat-view `tables` and drops the non-enumerable `tablesByNamespace`. The hasher then sees a different shape than the production emit pipeline pinned. Same architectural failure as § 3.1 (canonical shape escapes via a side channel), surfacing at the JS-object boundary instead of the wire boundary. Subagent's recommended fix: canonicalise via `JSON.parse(JSON.stringify(inputs.storage))` before destructuring. **Note**: a sibling test exists in `packages/2-document/9-family/mongo-family/9-family/test/control-instance.descriptor-self-consistency.test.ts` that likely has the same hazard.

   **§ 3.7 candidate — verifier flat-shape literal acceptance via `nestedTablesView` fallback.** `packages/2-sql/9-family/test/schema-verify.basic.test.ts` (lines 50, 206) and the type-only `compute-column-js-type.test-d.ts` use literal flat-shape storages cast as `SqlStorage` (bypassing the constructor), and the verifier silently treats them as nested via the `nestedTablesView` fallback (`return storage.tables as unknown as nested`). Narrower hazard than § 3.6 (test-only); flagged but not failing.

   Both entries should be added with full failure-mode catalogue structure (symptom / detection signal / mitigation / reference incident). Their detection signals likely extend the grep library in § 4 (e.g. add `\\{\\s*storageHash[,\\s]*\\.\\.\\.` for the spread-destructure pattern; add `as unknown as.*nested` for the verifier cast).

3. **Add a corresponding grep library entry in § 4.** For the spread-destructure smuggle and the verifier cast pattern. Match the style of the existing § 4 entries (per-section, with comment headers).

### Latent (no current urgency)

4. **Methodology extraction.** Once the user's notes land and the docs stabilise, decide whether to extract this content into the `.agents/skills/drive/agile-*` skill namespace (per `spec.md § Settled questions` and `§ Open questions`). This is significant work — likely a project of its own — and probably premature until the methodology has been applied successfully on at least one full PR-sized scope (e.g. TML-2520 PR2 completion).

5. **Calibration migration.** When `calibration/prisma-next.md` reaches stability, move it to `prisma-next/docs/calibrations/` (or similar; the eventual canonical home in the prisma-next repo is TBD). Update all cross-references.

6. **Companion calibrations.** Other projects that adopt the methodology will need their own calibration docs. The template is `calibration/prisma-next.md`; you may want to factor out a `calibration/TEMPLATE.md` if a second project starts adopting the methodology.

## 5. How to read in

### Recommended reading order

1. **`README.md`** — project framing in 41 lines.
2. **`spec.md`** — what we're trying to make true, two-layer split, integration with existing `drive-*` skills.
3. **`design-decisions.md`** — chronologically-ordered shaping decisions; each entry has context + alternatives + choice + rationale + what's affected. Critical for understanding the "why" behind any given pattern.
4. **`principles/*.md`** — three principle docs, each independently readable. `protocol-as-memory.md` is the deepest of the three and the most likely target for user notes.
5. **`calibration/prisma-next.md`** — the worked-example calibration. Read after the principle docs because it instantiates them.

### Conversation history

The full TML-2520 conversation transcript is at:

```
/Users/wmadden/.cursor/projects/Users-wmadden-Projects-prisma-prisma-next-ws-worktrees-tml-2520-pr2-namespace-exemplar-cross-namespace-fk-references-follow/agent-transcripts/ea44edac-f879-4eda-9153-5ef4e3795e0f/ea44edac-f879-4eda-9153-5ef4e3795e0f.jsonl
```

This is a long transcript covering the entire TML-2520 project, of which the agile-agent-orchestration discussion is the last ~10% (search for "Agile" or "protocol-as-memory" to anchor). Key conversation moments:

- The user's initial reaction to the 2-hour drift dispatch ("This is a totally fucking unacceptable result").
- The user's prioritisation of suggestions ("Of all your suggestions, the highest value suggestions for me are…").
- The user's framing of agent teams as teams ("This is the agent-team analogue of pulling small stories for juniors").
- The `git clean -fd` incident that prompted committing the project files at `4738d0b4a`.
- The user's instruction to commit the methodology project to its own worktree and hand it off to a separate agent (which is this handover).

You do not need to read the full transcript. The handover + the project docs + the design-decisions log should be sufficient context. Reach for the transcript only if you hit a specific question the docs don't answer.

### Linear context

- TML-2520 itself: `https://linear.app/prisma-company/issue/TML-2520/pr2-namespace-exemplar-cross-namespace-fk-references-follow-up-pr` — primary issue for the project that birthed this methodology.
- No dedicated Linear ticket for the methodology project yet — the user has not requested one. If/when the methodology graduates to a real skill cluster (or the calibration migrates into `prisma-next/docs/`), you may want to file one.

## 6. Working agreement with the TML-2520 orchestrator

After this handover:

- **The TML-2520 orchestrator (origin worktree) will stop modifying `projects/agile-agent-orchestration/`** and will not delete it locally either (it stays committed at `4738d0b4a`). The TML-2520 orchestrator continues to dispatch implementers and observe the protocol — but treats the protocol as a fixed reference, not a live editable artefact.
- **You (handover recipient, separate worktree) own all changes to the methodology project.** All edits to `spec.md`, `design-decisions.md`, `principles/*.md`, and `calibration/prisma-next.md` come through your branch.
- **Coordination on the calibration layer happens via Linear / PR comments, not direct edits.** If TML-2520 work uncovers a new failure mode that should be added to the calibration's catalogue, the TML-2520 orchestrator will flag it (e.g. via a Linear comment or a PR comment); you absorb it into the calibration on your own schedule.

The reason for this split: the methodology project demands deep iteration on phrasing, philosophy, and structure (the user reads carefully and gives detailed notes). TML-2520 implementation demands speed and operational focus. Sharing the same orchestrator across both creates context-switch overhead that compromises both. Two agents, one focus each.

### Suggested branching strategy for your worktree

Per [`drive-project-workflow.mdc`](../../.cursor/rules/drive-project-workflow.mdc), project work lives on a dedicated branch. Suggested workflow:

1. Create a new branch off `main` (or wherever's current): `git checkout -b agile-agent-orchestration-shaping main`.
2. Cherry-pick (or rebase, your call) commit `4738d0b4a` from the TML-2520 branch to bring the methodology project content over. Alternative: copy `projects/agile-agent-orchestration/` content via filesystem and commit fresh — your call.
3. Open a PR early (per drive-project-workflow) with the shaping artefacts for stakeholder validation. The user is the primary stakeholder for this project.
4. Iterate on PR comments + user notes until the methodology stabilises.

## 7. First action

When you read in, your first action is:

1. **Read the user's most recent notes on the principles docs** (which they were going to post immediately after this handover was written). If no notes are visible yet, wait — do not start revising.
2. **Once notes are in**, draft revisions to the principles + design-decisions log + spec (as needed) and post them for the user to review.
3. **Then** (separately) absorb the two TML-2520 family-sql findings into the calibration's failure-mode catalogue (§ 3.6 + § 3.7 + corresponding § 4 grep entries).

If you find yourself wanting to dispatch implementer subagents during shaping, you probably don't need to. This project is paper-and-pencil work right now; implementer dispatch becomes relevant only when the methodology extracts into the skill namespace or migrates the calibration into `prisma-next/docs/`. Both are likely future projects.

## 8. Open questions for the handover recipient to consider

Not blocking, but worth thinking about as you read in:

- **How does this methodology interact with the existing review-framework skills** (`review-fetch-phase`, `review-triage-phase`, `review-implement-phase`)? Those are skill-level rituals that already exist; this methodology adds dispatch-level rituals. The relationship between the two layers (one acts on PR review feedback, the other acts on planning/implementation dispatch) is not yet documented and probably should be.
- **How does this methodology interact with `drive-pr-local-review`**? `drive-pr-local-review` already produces walkthrough + system-design-review + code-review artefacts. The methodology's "post-mortem produces protocol/calibration updates" discipline could plug into the review framework: every local PR review concludes with "are there protocol/calibration updates?". Worth thinking through.
- **Is the "three-dimension complexity" model (conceptual / surface / blast radius) load-bearing, or is it scaffolding for the t-shirt sizing?** Test in practice — if dispatches consistently size cleanly without invoking the three dimensions, the framework may be over-engineered. The dimensions are useful for *dispatch treatment routing*, not for the sizing itself; the doc may need restructuring to make that clearer.
