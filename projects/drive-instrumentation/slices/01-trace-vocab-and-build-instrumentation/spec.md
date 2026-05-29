# Slice: 01-trace-vocab-and-build-instrumentation

_(Parent project [`projects/drive-instrumentation/`](../../spec.md); this slice satisfies the slice-1 outcomes named in [`plan.md`](../../plan.md) — trace event vocabulary, shared emission-protocol doc, instrumentation of the build loop AND the planning chain, end-to-end demo of the emission loop on both surfaces.)_

Linear: [TML-2704](https://linear.app/prisma-company/issue/TML-2704/drive-instrumentation-s1-trace-event-vocabulary-drive-build-workflow).

> **Re-specified 2026-05-28 (expansion)** — the slice's original scope was build-loop-only instrumentation (`drive-build-workflow` plus the five-event spine). That ships measurable rework signal but cannot assess **planning effectiveness**, which is the load-bearing quality surface for the operator's workflow (delegate-from-planning-onwards: operator participates in design discussion, then the agent authors specs + plans + executes; operator does not read specs or plans). Slice 1 expanded to also instrument the planning chain so the foundational ship surfaces both rework AND planning-quality signal in a single PR. New skills instrumented: `drive-specify-project`, `drive-specify-slice`, `drive-plan-project`, `drive-plan-slice`, `drive-triage-work`, `drive-discussion`. New event types added to the vocabulary: `spec-authored`, `spec-amended`, `plan-authored`, `plan-amended`, `triage-verdict`, `falsified-assumption`. Earlier re-spec (canonical-anchor reconciliation) preamble preserved below for audit-trail continuity.

> **Re-specified 2026-05-28 (canonical anchors)** — original spec was authored against a stale `.agents/skills/` copy that pre-dated the factoring of brief-assembly + implementer-delegation into the sibling skill `drive-dispatch`. Section anchors and the instrumented file path were updated; vocabulary + emission protocol (D1) survived intact. `skills-contrib/` is canonical; `.agents/skills/` is regenerated from it at `pnpm install` time.

## At a glance

Ships the trace-event contract (vocabulary + emission protocol) plus the first two instrumented skill *families*: the build loop (`drive-build-workflow`) and the planning chain (`drive-specify-*`, `drive-plan-*`, `drive-triage-work`, `drive-discussion`). After this slice ships, a Drive run produces a `trace.jsonl` from which the following quality signals are hand-computable end-to-end:

- **Rework** (`rounds_per_dispatch` from `round-end` events grouped by `dispatch_id`).
- **Brief stability** (`brief-issued.brief_disposition` distribution per dispatch).
- **Spec stability** (count of `spec-amended` events per project; reason-code distribution).
- **Plan accuracy** (count of `plan-amended` events per slice plan; `dispatch_size_distribution` deltas; resize / add / remove counts).
- **I12 halt rate** (count of `falsified-assumption` events per project; trigger-code distribution).
- **Triage stability** (count of `triage-verdict` events per Linear ticket; > 1 = re-triages; promote / demote signature).

## Scope

### In scope

- **`skills-contrib/drive-record-traces/events.md`** — versioned event-vocabulary spec. Defines the common envelope, the eleven slice-1 event types (five build-loop events from D1 + six planning-chain events added in D4), payload schemas, ordering and timestamp rules, the vocabulary-version field. Cited from every instrumented skill. D1 shipped the build-loop spine (`5bdc19013`); D4 extends the doc with the six planning-chain event types.
- **`skills-contrib/drive-record-traces/emission.md`** — shared emission-protocol doc. Defines trace-file path resolution (in-project / orphan-slice / direct-change), append-only JSONL conventions, canonical "Emit" snippet, file-write tool. Cited from every instrumented skill. D1 shipped; D4 adds a short addendum on the existence-check pattern that distinguishes `*-authored` vs `*-amended` events.
- **`skills-contrib/drive-build-workflow/SKILL.md`** — five Emit blockquotes at the canonical per-dispatch-loop anchors (D2 shipped `42feffeb4`).
- **`skills-contrib/drive-specify-project/SKILL.md`** — one Emit blockquote at the spec-write step, gated on existence-check (`spec-authored` if first write, `spec-amended` otherwise). Added in D5a.
- **`skills-contrib/drive-specify-slice/SKILL.md`** — same shape for slice specs. Added in D5a.
- **`skills-contrib/drive-plan-project/SKILL.md`** — one Emit blockquote at the plan-write step, gated on existence-check (`plan-authored` / `plan-amended`). Added in D5a.
- **`skills-contrib/drive-plan-slice/SKILL.md`** — same shape for slice plans. Added in D5a.
- **`skills-contrib/drive-triage-work/SKILL.md`** — one Emit blockquote at the verdict-output step (`triage-verdict`). Added in D5b.
- **`skills-contrib/drive-discussion/SKILL.md`** — one Emit blockquote at the on-entry step, conditional on trigger = mid-flight I12 falsified-assumption (`falsified-assumption`). Added in D5b.
- **`projects/drive-instrumentation/slices/01-…/manual-qa.md`** — manual-QA script. D3 shipped a seven-check version for the build-loop events; D6 extends with additional checks covering the six planning-chain events.
- **`projects/drive-instrumentation/slices/01-…/qa-run-01.md`** + **`qa-trace-01.jsonl`** — D3 ship covering build-loop events.
- **`projects/drive-instrumentation/slices/01-…/qa-run-02.md`** + **`qa-trace-02.jsonl`** — D6 ship covering all eleven event types (synthetic walkthrough including an I12 halt + replan + re-triage path).

### Out of scope (this slice)

- **Lifecycle / cadence events** — `project-start/end`, `slice-start/end`, health-check events, retro firings, project-close events. Slice 2.
- **Direct-change brief tracking** — `drive-dispatch`'s emission, including `brief-issued` for briefs that bypass `drive-build-workflow` via `drive-start-workflow → drive-dispatch`. Slice 2.
- **Lifecycle skill instrumentation** — `drive-deliver-workflow`, `drive-start-workflow` (the setup-chain side; triage-verdict is in this slice via `drive-triage-work`), `drive-create-project`, `drive-check-health`, `drive-run-retro`, `drive-close-project`. Slice 2.
- **QA-side skills** — `drive-pr-description`, `drive-pr-walkthrough`, `drive-qa-plan`, `drive-qa-run`, `drive-code-review`. Deliberately excluded from instrumentation at all; revisit at close-out if signal demands.
- **Assertion library / diagnostic-metrics module / report generator / post-hoc parser** — slice 3.
- **LLM judge, controlled-experiment harness, golden-case library, A/B harness** — Project 2.
- **Sub-agent-side emission** — slice-1 emitters remain orchestrator-side only. Sub-agent-internal events (heartbeats, intra-round artefact writes) are a slice-2 question.

## Approach

### Vocabulary shape

Eleven event types total in slice 1. The five build-loop events were shipped by D1 against the slice-plan-sense "dispatch" (one M-sized unit in `plan.md`, may span multiple implementer/reviewer rounds). The six planning-chain events shipped by D4 capture spec / plan / triage / I12 lifecycle:

| Event | Cadence | Emitted by |
|---|---|---|
| `dispatch-start` | once per dispatch-unit (round 1 only) | `drive-build-workflow` § 1 |
| `dispatch-end` | once per dispatch-unit (terminating branches) | `drive-build-workflow` § 6 |
| `round-start` | once per round | `drive-build-workflow` § 1 (end) |
| `round-end` | once per round (all triage branches) | `drive-build-workflow` § 6 |
| `brief-issued` | once per round | `drive-build-workflow` § 2 |
| `spec-authored` | once per spec, on first write | `drive-specify-project`, `drive-specify-slice` |
| `spec-amended` | once per spec, on subsequent write | `drive-specify-project`, `drive-specify-slice` |
| `plan-authored` | once per plan, on first write | `drive-plan-project`, `drive-plan-slice` |
| `plan-amended` | once per plan, on subsequent write | `drive-plan-project`, `drive-plan-slice` |
| `triage-verdict` | once per triage call | `drive-triage-work` |
| `falsified-assumption` | once per drive-discussion entry, conditional on I12-trigger | `drive-discussion` |

For payload schemas, common envelope, JSONL examples, and arktype types, see [`skills-contrib/drive-record-traces/events.md`](/skills-contrib/drive-record-traces/events.md).

#### Planning-chain payload sketches (precise schemas authored in D4)

- **`spec-authored`** / **`spec-amended`** — `spec_path`, `spec_kind` (`"project"` | `"slice"`), `byte_length` (for `spec-amended`, also `bytes_delta` signed int), `edge_cases_count` (slice specs; null for project), `open_questions_count`, `dod_items_count`. `spec-amended` additionally carries `reason` (enum: `"falsified-assumption"` / `"new-edge-case"` / `"scope-shift"` / `"operator-correction"` / `"replan-from-discussion"`) and `sections_changed` (list).
- **`plan-authored`** / **`plan-amended`** — `plan_path`, `plan_kind`, `byte_length`, `dispatch_count` (slice plans; null for project), `slice_count` (project plans; null for slice), `dispatch_size_distribution` (slice plans; `{"S": n, "M": n, "L": n, "XL": n}`), `open_items_count`. `plan-amended` additionally: `bytes_delta`, `reason` (enum, superset of spec-amended's reasons plus `"dispatch-resize"` / `"dispatch-added"` / `"dispatch-removed"`), `dispatches_added` / `dispatches_removed` / `dispatches_resized` (slice plans only).
- **`triage-verdict`** — `verdict` (enum: `"direct-change"` / `"orphan-slice"` / `"in-project-slice"` / `"new-project"` / `"promote"` / `"demote"` / `"spike-first"` / `"defer"`), `input_shape` (enum: `"linear-ticket"` / `"chat-ask"` / `"customer-ask"` / `"bug-report"` / `"mid-flight-scope-signal"` / `"i-should-do-x-thought"`), `input_ref` (Linear ticket ID if available, else null).
- **`falsified-assumption`** — `artifact_path` (which spec/plan got the discrepancy), `triggered_by` (enum: `"implementer-pushback"` / `"wip-inspection"` / `"dispatch-blocked"` / `"health-check-drift"` / `"orchestrator-self-detected"` / `"operator-flagged"`), `assumption_summary` (one-sentence; nullable).

### Emission protocol

Unchanged from D1 — see [`skills-contrib/drive-record-traces/emission.md`](/skills-contrib/drive-record-traces/emission.md) for path resolution, append-only JSONL conventions, the canonical Emit snippet, the Shell `>>` file-write mechanic. D4 adds a short subsection documenting the **existence-check pattern** for the `*-authored` vs `*-amended` decision: the emitting skill checks for the target file's existence before write; if absent → emit `*-authored`, else → emit `*-amended`. (The check is part of the emit-site instructions, not a separate event.)

### `drive-build-workflow` instrumentation

D2 shipped the five emit-sites at the canonical anchors in `## The per-dispatch loop`:

| Event | Anchor | Cadence |
|---|---|---|
| `dispatch-start` | Top of § 1 (Pre-flight DoR), gated on first round | Once per dispatch-unit |
| `round-start` | End of § 1, after DoR passes | Once per round |
| `brief-issued` | End of § 2 (Dispatch the implementer via drive-dispatch), before drive-dispatch call | Once per round |
| `round-end` | End of § 6 (Reviewer verdict + intent-validation + triage), after triage | Once per round |
| `dispatch-end` | In § 6, on dispatch-terminating branches | Once per dispatch-unit |

See commit `42feffeb4`.

### Planning-chain instrumentation (D5a + D5b)

Six skill bodies gain emit-sites. Each emit-site is the same shape as build-workflow's: a 1–3-line "Emit" blockquote citing both `skills-contrib/drive-record-traces/events.md` (payload schema) and `skills-contrib/drive-record-traces/emission.md` (file-append mechanics). Anchor-discovery is the implementer's first task in D5a / D5b; the natural anchors are listed below as guidance, not verbatim section names (the canonical skill bodies have their own structure that the implementer reads on the dispatch).

**D5a — spec + plan lifecycle (4 skills):**

| Skill | Emit event(s) | Anchor (guidance) |
|---|---|---|
| `drive-specify-project` | `spec-authored` OR `spec-amended` (gated on existence-check) | At the "write the spec" step — i.e. the point where the orchestrator commits the spec file to disk |
| `drive-specify-slice` | `spec-authored` OR `spec-amended` | Same shape for slice specs |
| `drive-plan-project` | `plan-authored` OR `plan-amended` | At the "write the plan" step |
| `drive-plan-slice` | `plan-authored` OR `plan-amended` | Same shape for slice plans |

**D5b — triage + I12 (2 skills):**

| Skill | Emit event(s) | Anchor (guidance) |
|---|---|---|
| `drive-triage-work` | `triage-verdict` | At the verdict-output step — i.e. the point the skill returns the verdict to its caller (drive-start-workflow or direct invocation) |
| `drive-discussion` | `falsified-assumption` (conditional on I12 trigger) | At the on-entry step, gated on trigger being mid-flight I12 (other discussion-entry triggers — pre-spec design, mid-spec fork, operator-requested — do NOT emit) |

The instrumentation is **additive only** per skill body — no existing prose rewritten. Each skill grows by ~5–12 lines depending on whether one or two events fire from it.

### Demo + manual QA

D3 shipped seven QA checks against the build-loop events. D6 extends to cover all eleven event types via a richer synthetic walkthrough — a hypothetical project run that includes spec authoring, plan authoring, triage, a mid-flight I12 halt + replan + re-triage path, and the build-loop dispatch sequence. The walkthrough produces `qa-trace-02.jsonl` (more events than `qa-trace-01.jsonl`) and the metric hand-computations cover all six new quality signals.

Implementation note: emission behaviour is identical regardless of which copy of the skill body the orchestrator reads (`skills-contrib/` is canonical; `.agents/skills/` regenerates from it via `pnpm install`). All edits target `skills-contrib/`.

## Edge cases (Example-Mapping)

Pre-D3 edge cases (still in scope; satisfied by D1–D3):

| Edge case | Disposition | Notes |
|---|---|---|
| Two dispatches running concurrently (parallel subagents) | **Explicitly out** | Vocabulary handles via unique `dispatch_id` but slice 1 doesn't verify it. |
| Resumed persistent implementer across slices | **Handle** | `dispatch-start.parent_dispatch_id` carries cross-slice continuity. |
| Stop-condition fires mid-dispatch | **Handle** | `round-end.verdict = "stop-condition"`; `dispatch-end.result = "aborted"`. |
| Brief identical to a prior round (reissue) | **Handle** | `brief-issued.brief_disposition = "reissue"`; detected by content hash. |
| Brief amended between rounds | **Handle** | `brief-issued.brief_disposition = "amended"`. |
| Run-in-background subagent completing async | **Handle** | `wall_clock_ms` is orchestrator-observed; subagent-internal delta is slice 2. |
| Crash mid-emit | **Explicitly out** | Best-effort; partial trace files acceptable. |
| Trace file does not exist at first emit | **Handle** | First emit creates file + parent dir. |
| `wip/drive-trace/` missing for orphan/direct-change | **Handle** | First emit creates dir. |
| Trace lives under `projects/<slug>/trace.jsonl` and project is closed | **Explicitly out** | Close-out deletes; durable methodology surfaces migrate to `docs/`. |
| Event payload has undocumented extra field | **Explicitly out** | v1 ships exact-schema-only. |
| Schema validation failure at emit time | **Handle** | Slice 1 validates at read time (slice 3); emit time is best-effort. |
| Operator marker mid-run | **Defer** | Project-run detector is slice 3. |
| Operator amends `drive-build-workflow` mid-slice | **Explicitly out** | Major restructure → re-spec via drive-discussion. |
| Canonical-vs-presentation drift (`skills-contrib/` vs `.agents/skills/`) | **Handle environmentally** | `.agents/skills/` regenerates at install; verified before each dispatch. |
| Run-time skill body diverges from `skills-contrib/` | **Handle out-of-band** | QA in D6 confirms runtime behaviour. |
| `drive-dispatch` becomes primary `brief-issued` emitter | **Defer (slice 2)** | Direct-change brief tracking. |

New edge cases introduced by the planning-chain expansion (D4–D6):

| Edge case | Disposition | Notes |
|---|---|---|
| Spec re-authored verbatim (no semantic change) | **Handle** | `spec-amended.bytes_delta = 0`; `reason = "operator-correction"` (or whatever the trigger was) — the event still fires; downstream metrics filter on bytes_delta if they want. |
| Plan amendment that adds dispatches mid-flight (build-workflow's loop discovers an extra dispatch is needed) | **Handle** | `plan-amended` fires from drive-build-workflow's plan-amendment site OR from drive-plan-slice on re-invocation; `reason = "dispatch-added"`; `dispatches_added > 0`. Treat as a drive-plan-slice re-fire (the build-workflow doesn't fire `plan-amended` itself — slice 1 keeps emit-sites in the skill that owns the artefact). |
| Triage re-runs mid-flight (promote ceremony: orphan-slice → in-project-slice) | **Handle** | Second `triage-verdict` event fires with the new verdict; same `input_ref` (Linear ticket); `input_shape = "mid-flight-scope-signal"`. |
| `drive-discussion` entered for a non-I12 reason (pre-spec design fork) | **Handle (no emit)** | The `falsified-assumption` event only fires conditional on I12 trigger. Other discussion triggers are silent in slice 1; non-I12 discussion-entered tracking is deferred (slice 2 or 3). |
| `drive-discussion` entered for I12 but no spec/plan amendment results (decision deferred to operator) | **Handle** | `falsified-assumption` still fires (the assumption *was* falsified — the response just hasn't landed); the downstream `spec-amended` / `plan-amended` may or may not follow. Spec-amendment-rate metric must not assume 1:1 with falsified-assumption count. |
| Spec / plan file created by direct operator edit outside drive-specify-* / drive-plan-* | **Explicitly out** | Slice 1 assumes specs and plans are authored through the named skills; bypass-paths are an out-of-band concern. The QA exercises in-skill emission only. |
| `spec-amended` triggered by `drive-discussion` (the discussion led to a replan that resulted in a spec amendment) | **Handle** | Event fires from drive-specify-* on the amendment write, with `reason = "replan-from-discussion"`. drive-discussion does NOT also fire a `spec-amended` — single-emit-site discipline. |
| Same skill emits both `spec-authored` and `spec-amended` in the same orchestrator session (rare: same-session re-author of a spec just written) | **Handle** | The existence-check sees the file present on the second write; second event is `spec-amended`. |
| `drive-triage-work` returns a verdict the caller (drive-start-workflow) overrides | **Defer (slice 2)** | drive-start-workflow's override of a triage verdict needs its own event (verdict-overridden or similar); out of scope for slice 1. The slice-1 trace records the original verdict; any override happens silently at the caller. |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass. D1 PASS (`5bdc19013`); D2 PASS (`42feffeb4`); D3 PASS (`849f10598`); D4 / D5a / D5b / D6 pending.
- [ ] **SDoD2.** Every pre-named edge case handled per disposition; new edge cases discovered amend the spec via drive-discussion (I12).
- [ ] **SDoD3.** Reviewer verdict `SATISFIED` on `reviews/code-review.md` at slice close.
- [ ] **SDoD4.** Manual-QA covers all eleven event types. `manual-qa.md` (D3 + D6) re-runnable; ≥ 2 QA runs committed (`qa-run-01.md` from D3; `qa-run-02.md` from D6); no unresolved 🛑 Blocker findings.
- [ ] **SDoD5.** Slice doesn't touch surfaces listed as out-of-scope (no instrumentation of lifecycle skills, `drive-dispatch`, or QA-side skills; no assertion / metric code; no judge / harness code; no edits to `.agents/skills/` — only `skills-contrib/` and `docs/drive/`).
- [ ] **SDoD6.** `skills-contrib/drive-record-traces/events.md` and `skills-contrib/drive-record-traces/emission.md` exist, are versioned (`schema_version: "1"`), and are linked from every instrumented skill body's emit-sites.
- [ ] **SDoD7.** Every instrumented skill verified non-regressing against an uninstrumented baseline (behaviour-preservation read-through covers all seven instrumented skill bodies — verified per-skill in their respective dispatch's done-when checks).
- [ ] **SDoD8.** Trace.jsonl evidence committed: `qa-trace-01.jsonl` (D3 — five-event-spine coverage) + `qa-trace-02.jsonl` (D6 — all-eleven-event coverage).

## Open Questions

1. **Synthetic-vs-real demo** — D3 and D6 both ship walkthroughs, not full real-agent runs. Working position: walkthroughs are sufficient for slice-1 QA per spec § Approach § Demo + manual QA. A real-agent run is implicit once any subsequent project uses the instrumented skills (this very project's slice 2 onwards will produce real traces).
2. **`orchestrator_agent_id` extraction.** Working position: emit `null` for slice 1. If Cursor's SDK / IDE / env exposes the agent UUID via a standard read, populate; else defer to Project 2.
3. **`brief-issued` for reviewer brief.** Working position: slice 1 only fires `brief-issued` for the implementer brief; reviewer-brief tracking added in slice 2 if signal demands.
4. **Vocab-doc location.** Settled at `skills-contrib/drive-record-traces/events.md` + `skills-contrib/drive-record-traces/emission.md`.
5. **ADR for the trace-emission protocol.** Working position: commit to writing an ADR at project close-out.
6. **Direct-change brief tracking.** Deferred to slice 2 — `drive-start-workflow → drive-dispatch` path emits no `brief-issued` under slice 1.
7. **(New)** **Pre-spec design discussion tracking.** `drive-discussion` is entered for many reasons (pre-spec design, mid-spec fork, mid-flight I12, unplanned obstacle, operator-requested). Slice 1's `falsified-assumption` event fires only on I12 entries. Tracking of other discussion-entry reasons is deferred — if the operator's iteration loop needs to attribute time spent in pre-spec discussion mode, that's a slice-2 event type (`discussion-entered` with a richer trigger enum).
8. **(New)** **Cross-skill `spec-amended` attribution.** When `drive-discussion` triggers a spec amendment that lands via `drive-specify-*`, the trace records `spec-amended.reason = "replan-from-discussion"` and a separate `falsified-assumption` (from drive-discussion). The two events are correlatable by timestamp + artifact_path, not by an explicit ID. Working position: the timestamp+path correlation is sufficient for slice 1; explicit causation IDs are a slice-3 metric-module concern.
9. **(New)** **Project-DoD's "all `drive-*` skills instrumented" mapping.** Updated in project spec § DoD to split skills between slices 1 and 2; QA-side skills explicitly excluded. No further open question, recorded here for trace.

## References

- Parent project spec: [`projects/drive-instrumentation/spec.md`](../../spec.md).
- Parent project plan: [`projects/drive-instrumentation/plan.md`](../../plan.md).
- Parent project design notes: [`projects/drive-instrumentation/design-notes.md`](../../design-notes.md).
- Linear issue: [TML-2704](https://linear.app/prisma-company/issue/TML-2704).
- Originating ticket: [TML-2703](https://linear.app/prisma-company/issue/TML-2703).
- Drive principle docs: [`docs/drive/principles/sizing.md`](/docs/drive/principles/sizing.md), [`docs/drive/principles/brief-discipline.md`](/docs/drive/principles/brief-discipline.md).
- Drive skills instrumented: [`skills-contrib/drive-build-workflow/SKILL.md`](/skills-contrib/drive-build-workflow/SKILL.md), [`skills-contrib/drive-specify-project/SKILL.md`](/skills-contrib/drive-specify-project/SKILL.md), [`skills-contrib/drive-specify-slice/SKILL.md`](/skills-contrib/drive-specify-slice/SKILL.md), [`skills-contrib/drive-plan-project/SKILL.md`](/skills-contrib/drive-plan-project/SKILL.md), [`skills-contrib/drive-plan-slice/SKILL.md`](/skills-contrib/drive-plan-slice/SKILL.md), [`skills-contrib/drive-triage-work/SKILL.md`](/skills-contrib/drive-triage-work/SKILL.md), [`skills-contrib/drive-discussion/SKILL.md`](/skills-contrib/drive-discussion/SKILL.md).
- Prior commits: D1 `5bdc19013`; canonical-anchor re-spec `f900f3923`; D2 `42feffeb4`; D3 `849f10598`.
