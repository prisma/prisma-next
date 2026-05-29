# Slice: 03-trace-reader-and-diagnostics

_(Parent project [`projects/drive-instrumentation/`](../../spec.md); this slice is the project's **close-out slice** — it satisfies the slice-3 outcomes in [`plan.md`](../../plan.md): the deterministic measurement layer that reads the `trace.jsonl` slices 1–2 emit and turns it into assertions, metrics, and a report.)_

Linear: [TML-2717](https://linear.app/prisma-company/issue/TML-2717).

## At a glance

Slices 1–2 made the drive-* skills **emit** a `trace.jsonl`. Nothing yet **reads** it — the arktype schemas in `skills-contrib/drive-record-traces/events.md` are markdown, not executable, and every metric in the project plan is still computed by hand. This slice ships the reader:

```bash
$ node scripts/drive-diagnostics/cli.ts projects/drive-instrumentation/trace.jsonl
# → markdown dashboard: metrics table + assertion pass/fail with evidence pointers
```

The deliverable is a small TypeScript tool under **`scripts/drive-diagnostics/`** that:

1. **Validates** each trace line against the real arktype schemas (transcribed from the vocabulary doc).
2. **Computes** the diagnostic metrics the project plan names (rework rate, spec/plan stability, I12 halt rate, triage stability, rounds-per-dispatch, write amplification, time-to-stability, brief stability, …).
3. **Asserts** the Drive invariants (I1–I12) + the 8 cascade-redesign rules + brief-discipline anti-patterns against the trace, each with an evidence pointer to the firing event.
4. **Renders** a per-run markdown report.
5. **Reconstructs** a best-effort trace from a Cursor agent transcript (for runs that predate instrumentation), flagging post-hoc origin + per-event confidence.

It closes by **grading itself**: running the framework on this project's own `trace.jsonl` (the live dogfood trace accreted across slices 1–3) and landing ≥1 lesson in a canonical surface.

## Chosen design

### Code home — `scripts/drive-diagnostics/` (not a `packages/` package)

This tool is meta-tooling about the **development methodology**, not the prisma-next data-layer product. The `packages/` layering taxonomy (`architecture.config.json`) has only product domains (framework / sql / mongo / targets / extensions); a diagnostics package would have no home there, would be swept into `pnpm-workspace.yaml`'s `packages/**` glob as a publishable `@prisma-next/*` package, and would need a fabricated domain. `scripts/` is the established home for non-product TypeScript (`bump-minor.ts`, `determine-version.ts`), runs under Node's native TS stripping, and is tested via `node --test` in the root `test:scripts` script. So:

```
scripts/drive-diagnostics/
  schema.ts        # arktype event schemas (transcribed from events.md) + TraceEvent union
  load.ts          # JSONL loader: parse + validate each line, collect errors with line numbers
  metrics.ts       # diagnostic-metrics computation over a validated event array
  assertions/
    invariants.ts  # I1–I12
    cascade.ts     # the 8 cascade-redesign rules
    brief.ts       # brief-discipline anti-patterns
    index.ts       # runAssertions(events) → AssertionResult[]
  report.ts        # markdown dashboard renderer
  posthoc.ts       # best-effort transcript → trace reconstruction
  cli.ts           # entry: node scripts/drive-diagnostics/cli.ts <trace.jsonl> [--posthoc <transcript>]
  test/*.test.ts   # node --test suites
```

Root `package.json` gains a `drive:diagnose` script and the `test/*.test.ts` files are added to `test:scripts`.

### The schema is the source of truth

`schema.ts` transcribes the 17 arktype schemas verbatim from `events.md` (they are already in ready-to-copy arktype syntax — `envelopeFields` spread, `dispatchSizeDistribution` helper, the `Slice1TraceEvent` union). `load.ts` validates every line against the union and **never throws on a bad line** — it returns `{ events, errors }` where each error carries the line number + the arktype problem string. This keeps a single malformed event from blinding the whole report.

### Metrics read only the trace

Every metric is a pure function of the validated event array — no transcript reads at metric time (the project's cross-cutting requirement). Metrics that need an event type that may be absent degrade to `null` with a "not enough signal" note rather than crashing.

### Assertions cite evidence and name their gaps

Each assertion returns `{ id, title, status: "pass" | "fail" | "not-checkable", evidence: TraceRef[], note }`. Many Drive invariants are only **partially** observable from the current trace (e.g. I2 "scope bounded by spec" has no direct event). The honest move, mandated by the project spec ("coverage gaps explicitly named with rationale"), is to mark those `not-checkable` with a one-line reason rather than fake a green check. An assertion that *can* fire (e.g. I1 "one PR per slice/direct-change" → detect a slice with >1 `slice-completed`, or I6 "spec+plan before implementation" → a `dispatch-start` with no preceding `spec-authored`/`plan-authored` in the run) reports `pass`/`fail` with the firing event(s) as evidence.

### Post-hoc parser is explicitly best-effort

`posthoc.ts` reconstructs trace events from a Cursor transcript (`{role, message:{content:[{type,...}]}}` JSONL — only `text` + `tool_use` items). It maps observable signals (a `Task` tool_use → a `dispatch-start`; a spec/plan `Write` → `spec-authored`/`plan-authored`) to events, stamping each with `confidence: "high" | "medium" | "low"` and `origin: "post-hoc"`. The report flags any post-hoc-origin run. Reconstructing every native event is a non-goal; the spec asks for best-effort over ≥3 trial-corpus runs.

### Close-out: the framework grades itself

The final dispatch runs the tool on `projects/drive-instrumentation/trace.jsonl` (this project's own accreted ProjectRun), commits the rendered report, and lands ≥1 lesson surfaced by the run into a canonical surface (a drive principle/skill, `drive/<category>/README.md`, or an ADR). This is the project-DoD self-grading demo (invariant: "the framework grades itself").

## Coherence rationale

One PR, because it is one idea — "make the emitted trace readable" — across one new isolated directory (`scripts/drive-diagnostics/`) with a single internal contract (`schema.ts` → everything else reads `TraceEvent[]`). Splitting parser / metrics / assertions / report into separate PRs would fragment one tightly-coupled module behind four review cycles of the same files, against the project plan's explicit "slice 3 = the close-out slice" framing. The slice touches no product code and no skill bodies (slices 1–2 own those), so its blast radius is contained to a new directory + two root-`package.json` script lines.

## Scope

**In:**

- `scripts/drive-diagnostics/**` — the tool (schema, loader, metrics, assertions, report, post-hoc parser, CLI, tests).
- `package.json` (root) — a `drive:diagnose` script + the new test files added to `test:scripts`.
- `projects/drive-instrumentation/slices/03-…/` — spec, plan, manual-qa, qa-run, and the committed self-grade report.
- ≥1 canonical/project-context/ADR update surfaced by the self-grading retro.

**Out:**

- Any **LLM** call — correctness rubric, F-mode classifier, operator-turn *classification* (raw count only). Project 2 (TML-2705).
- The SDK-spawned controlled-experiment harness; cross-run aggregation dashboard. Project 2.
- Re-instrumenting or changing any `drive-*` skill body or the `drive-record-traces` docs (slices 1–2 own the emit side; this slice only reads). A schema bug found here is fixed by amending `events.md` **and** `schema.ts` together — but no new event types.
- Producing a *graded* trial corpus as a primary deliverable — best-effort reconstruction over ≥3 runs is in; the grade is not.
- The full project close-out ceremony (migrate docs to `docs/`, delete `projects/<slug>/`) — that is `drive-close-project`, run after this slice's PR merges, not part of this slice.

## Approach

Seven strictly-sequential M-sized dispatches (detailed in [`plan.md`](./plan.md)):

1. **Schema + loader** — transcribe the 17 arktype schemas; validating JSONL loader; tests against the real `trace.jsonl` fixture.
2. **Diagnostic metrics** — the metric functions over `TraceEvent[]`; tests with hand-checked expected values.
3. **Assertions A — invariants I1–I12** — `pass`/`fail`/`not-checkable` with evidence + named gaps.
4. **Assertions B — 8 cascade rules + brief-discipline anti-patterns** — same shape.
5. **Report generator + CLI + package.json wiring** — markdown dashboard; `node … cli.ts <trace>`.
6. **Post-hoc transcript parser** — best-effort reconstruction + confidence; tests over a transcript fixture.
7. **Self-grade + QA** — run on this project's own trace; commit the report; land ≥1 lesson; manual-qa + run.

Test tool: `node --test` with `node:assert` (the `scripts/` precedent — not vitest). arktype is a catalog dep. No new third-party deps without surfacing.

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| Malformed / non-JSON trace line | Loader collects it in `errors` with line number; does not throw; report shows an "N unparseable lines" banner. |
| Event valid JSON but fails arktype | Same — `errors` carries the arktype problem string; the event is excluded from metrics. |
| Unknown `event_type` (forward-compat: a slice-4 event) | Loader keeps it as an `unknown-type` record (honouring `schema_version`); metrics ignore it; report notes the count. |
| `dispatch-start` with no matching `dispatch-end` (partial trace) | Recognised diagnostic signal (per emission.md) — not an error; metrics treat the dispatch as open; an assertion may flag it. |
| Metric needs an absent event type (e.g. no `falsified-assumption` in run) | Metric returns `0` or `null` with a "no signal" note — never crashes. |
| Invariant not observable from the trace (e.g. I2 scope-bounded) | Assertion returns `not-checkable` with a one-line reason; counts toward named coverage gaps, not toward pass/fail. |
| Direct-change trace (`project_run_id` = `direct-<ts>`, no project bookends) | Report renders in "direct-change" mode — dispatch/round metrics only; project/slice metrics marked N/A. |
| Post-hoc transcript with no detectable Drive structure | Parser returns an empty event list + a "no Drive signal detected" note; does not fabricate events. |
| Mixed-origin trace (native + post-hoc events) | Each event carries `origin`; report flags the run as mixed and lists post-hoc event ids. |
| Empty trace file | Report renders a "no events" stub; exit code 0 (empty is not an error). |

## Slice Definition of Done

- [x] **SDoD1.** All "Done when" gates from the slice plan pass. (D1–D7 all SATISFIED in `plan.md`.)
- [x] **SDoD2.** Every pre-named edge case handled per disposition; no new edge cases required an I12 amendment.
- [x] **SDoD3.** Reviewer verdict `SATISFIED` on each dispatch (D1–D6 reviewed at dispatch close; D7 orchestrator-direct).
- [x] **SDoD4.** `cli.ts … trace.jsonl` runs clean + emits the dashboard; `pnpm test:scripts` green (397) incl. the new suites; `tsc`/`biome` clean (0 `no-bare-cast`). Captured in `qa-run-01.md`.
- [x] **SDoD5.** Slice diff (merge-base..HEAD) confined to `scripts/drive-diagnostics/**`, root `package.json`, `projects/drive-instrumentation/**`, and the one lesson surface (`drive/retro/findings.md`). Verified by QA C6.
- [x] **SDoD6.** Assertion library covers I1–I12 + 8 cascade rules + brief-discipline; every `not-checkable` carries a one-line rationale (24 named coverage gaps in the self-grade report).
- [x] **SDoD7.** Diagnostic metrics compute or degrade to `null`/`0` with a note; each has ≥1 test with a hand-checked expected value (inline fixtures).
- [x] **SDoD8.** Post-hoc parser reconstructs from the `sample-transcript.jsonl` fixture with per-event confidence; report flags `origin: post-hoc`. Broader ≥3-run corpus deferred to Project 2's live-experiment harness (recorded as the self-grade caveat).
- [x] **SDoD9.** The framework graded this project's own `trace.jsonl` → `self-grade-report.md` (committed); the lesson landed in `drive/retro/findings.md`.

## Open Questions

1. **Assertion coverage realism.** Several invariants (I2, I7 scope/purpose immutability; I11 sizing-by-INVEST) have no direct trace signal. Working position: implement the subset that *is* observable; mark the rest `not-checkable` with rationale. The honest gap list is itself a project-DoD deliverable, not a failure.
2. **Post-hoc corpus availability.** The project-DoD asks for ≥3 trial-corpus runs. Working position: ship the parser + ≥1 readable fixture (this project's own transcript is one); if 3 aren't readily available, record the shortfall as a close-out follow-up rather than blocking the slice.
3. **`operator-turn count` source.** No native `operator-turn` event exists in the vocabulary (it's a transcript signal). Working position: compute it in the **post-hoc** path only (count `user`-role turns), mark it post-hoc-origin in the report; native emission would be a vocabulary addition, out of scope here.
4. **Where the self-grade lesson lands.** Decided at D7 from what the run actually surfaces — likely a `drive/calibration/` note or a principle tweak; an ADR only if a design decision emerges.

## References

- Parent project spec / plan / design-notes: [`../../spec.md`](../../spec.md), [`../../plan.md`](../../plan.md), [`../../design-notes.md`](../../design-notes.md).
- Trace contract (the schema source): the `drive-record-traces` skill — `events.md` (arktype schemas), `emission.md` (path resolution, partial-trace semantics).
- Invariants I1–I12: [`docs/drive/model.md`](../../../../docs/drive/model.md) § Layer 5.
- Cascade-redesign rules: [`docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md`](../../../../docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md).
- Brief-discipline anti-patterns: [`docs/drive/principles/brief-discipline.md`](../../../../docs/drive/principles/brief-discipline.md).
- Live dogfood trace (the self-grade target): [`projects/drive-instrumentation/trace.jsonl`](../../trace.jsonl).
- `scripts/` TS precedent: `scripts/bump-minor.ts`, `scripts/determine-version-utils.ts` (run via `node`, tested via `node --test`).
