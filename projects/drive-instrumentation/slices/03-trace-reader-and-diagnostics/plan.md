# Slice plan: 03-trace-reader-and-diagnostics

Seven dispatches, strictly sequential. Each M-sized; none L/XL. Slice spec: [`spec.md`](./spec.md).

All code lands under `skills-contrib/drive-diagnostics/`; tests use `node --test` + `node:assert` (the `scripts/` precedent, not vitest). `arktype` is an existing catalog dep. The internal contract is `schema.ts` (the `TraceEvent` union + loader output) — every later module consumes a validated `TraceEvent[]`.

## Status

- **D1:** SATISFIED — `fe4ace2ec`. `schema.ts` (17 arktype event schemas, `TraceEvent` union, `KNOWN_EVENT_TYPES`) + `load.ts` (`loadTrace`/`loadTraceFromString` → `{events, unknown, errors}`, never throws). 7/7 `node --test`; real trace = 32 events, 0 errors. Orchestrator fixups: `as const` on the arktype envelope (`.infer` was collapsing to `never`), `events: TraceEvent[]` kept schema-faithful so origin lives on the load source — cast-free under the ratchet. `.ts` import extensions confirmed correct for `scripts/`.
- **D2:** SATISFIED — `a438aed91`. `metrics.ts` `computeMetrics(TraceEvent[])` covers the full project-DoD metric set (rework, planning-quality, artefact-churn, lifecycle/cadence, operator-raw); null-with-note on absent signal; never throws on partial traces. 79 `node --test` cases (86 total in the dir); tsc 0, biome 0 casts. Real trace: rounds/dispatch mean 1.0, spec-amended 0, falsified-assumption 0. NOTE for D5: wire `test:scripts` with explicit file paths or a `*.test.ts` glob — a bare `test/` dir path trips Node's directory runner.
- **D3:** SATISFIED — `a8d9b50e2`. `assertions/invariants.ts` (one checker per I1–I12) + `assertions/types.ts` (shared `AssertionResult`). Observable: I1/I4/I6/I8/I10 (real checks + evidence). Not-checkable with rationale: I2/I3/I5/I7/I9/I11/I12. 77 `node --test`; tsc 0, 0 casts. Also hardened D2's real-trace metric tests (magic-count pins → internally-consistent assertions) so the suite survives continued trace growth.
- **D4:** SATISFIED — `304ba6d03`. `assertions/cascade.ts` (8 rules) + `brief.ts` (anti-patterns) + `index.ts` `runAssertions` (31 results on the real trace: 7 pass, 0 fail, 24 not-checkable). Cascade-3 + BD-8 (heuristic) observable; rest honestly not-checkable with rationale. 94 `node --test` (246 dir total); tsc 0, 0 casts.
- **D5:** SATISFIED — `e0e4be74e`. `report.ts` (deterministic markdown dashboard: header + origin/parse-health banners, metrics tables, assertion sections w/ evidence) + `cli.ts` (`drive:diagnose`, import-guarded) + root `package.json` (script + 5 suites in `test:scripts`). `pnpm test:scripts` green (374). Real-trace dashboard renders clean; wall-clock means rounded. `--posthoc` left as a stub for D6.
- **D6:** SATISFIED — `6660ff6be`. `posthoc.ts` reconstructs dispatch-start / spec-authored / plan-authored + operator-turn count from a Cursor transcript (origin:post-hoc + confidence; no invented timestamps; no-signal note). `cli.ts --posthoc` (origin native/post-hoc/mixed; operator count threaded). 23 posthoc cases + fixture; `pnpm test:scripts` green (397); tsc 0, 0 casts. Limitation: timestamp-less reconstructed events surface via origin + operator count but don't feed metrics.
- **D7:** SATISFIED — orchestrator-direct. Ran `cli.ts` on the project's own trace → `self-grade-report.md` (59 events, 7 assertions pass / 0 fail, clean rework/planning metrics). `manual-qa.md` (7 checks + pre-flight gate) + `qa-run-01.md` (PASS, no Blockers). Lesson landed in `drive/retro/findings.md` (SDoD9): a self-grade over a hand-emitted trace validates the *reader*, not the *methodology* — plus the live-artefact-test-coupling and arktype-`as const` gotchas. **Slice 3 SATISFIED at close.**

## Failure modes threaded into briefs

From [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md):

- **F5 (destructive git ops by subagents)** — non-negotiable, every brief.
- **F4 (feature-sized dispatch, no inspection cadence)** — D3/D4 (assertion fan-out) and D6 (fuzzy parser) are most at risk; WIP-inspection at the midpoint + "halt and surface if the diff escapes `skills-contrib/drive-diagnostics/`".
- **F3 (discovery via test suite vs grep)** — every dispatch writes tests first (the repo rule: tests before implementation) and verifies via `node --test`, not by eyeballing.

Scope trap most likely here: "while I'm here, add a native `operator-turn` event / fix a skill emit-site / add a metric not on the list." All out — this slice only *reads*. The grep gate below enforces the directory boundary.

## Grep gate

After each code dispatch: `git diff --stat origin/main..HEAD` lists only files under `skills-contrib/drive-diagnostics/`, root `package.json`, and `projects/drive-instrumentation/slices/03-…/`. Nothing under `packages/`, `skills-contrib/`, or `docs/drive/` (except the single D7 canonical lesson).

## Dispatches

### Dispatch 1: Schema module + JSONL loader

**Intent.** Transcribe the 17 arktype event schemas from `skills-contrib/drive-record-traces/events.md` into `skills-contrib/drive-diagnostics/schema.ts` verbatim (envelope spread, `dispatchSizeDistribution` helper, the `Slice1TraceEvent` union — re-export it as `TraceEvent`). Write `load.ts`: `loadTrace(path): { events: ValidatedEvent[], errors: LoadError[] }` — read the file, split lines, `JSON.parse` each, validate against the union, collect failures (line number + arktype problem string + raw line) instead of throwing. Unknown `event_type` → kept as an `unknown-type` record. `ValidatedEvent` carries `origin: "native"` (post-hoc set in D6).

**Files in play.** `skills-contrib/drive-diagnostics/schema.ts`, `skills-contrib/drive-diagnostics/load.ts`, `skills-contrib/drive-diagnostics/test/load.test.ts`.

**"Done when":**
- [ ] All 17 event types present in `schema.ts`; `TraceEvent` union exported; arktype imports resolve; `pnpm typecheck` clean on the file (or `tsc --noEmit` on it).
- [ ] `loadTrace` returns `{events, errors}`; never throws on malformed input.
- [ ] Tests cover: the real `projects/drive-instrumentation/trace.jsonl` fixture parses with 0 errors and the expected event count; a malformed line is captured in `errors` with its line number; an unknown `event_type` is retained as `unknown-type`; an empty file returns `{events:[], errors:[]}`.
- [ ] `node --test skills-contrib/drive-diagnostics/test/load.test.ts` green.
- [ ] Diff confined to the three files.

**Size.** M. Schemas are copy-from-doc; the loader + error handling is the real work.

**DoR:** ✓ — schemas exist ready-to-copy in `events.md`; real fixture exists.

---

### Dispatch 2: Diagnostic-metrics module

**Intent.** `skills-contrib/drive-diagnostics/metrics.ts`: `computeMetrics(events: TraceEvent[]): Metrics`. Implement the project-DoD metric list as pure functions, each degrading to `null`/`0` with a note when the needed event type is absent: rework rate (`rounds_per_dispatch` = round-starts per dispatch), brief stability (`brief-issued.brief_disposition` distribution), spec stability (`spec-amended` count + reason distribution), plan accuracy (`plan-amended` count + dispatch-size distribution from `plan-authored`), I12 halt rate (`falsified-assumption` count), triage stability (`triage-verdict` count per `input_ref`), write amplification (authored+amended counts per artefact), time-to-stability (first-author `ts` → last-amend `ts` per artefact), per-dispatch + per-round wall-clock (from `*_ms` fields), first-pass acceptance (round-1 `round-end.verdict === "satisfied"` rate), backtrack ratio (another-round-needed vs satisfied), tier mix (`dispatch-start.model` distribution), project/slice wall-clock (bookend `ts` deltas), operator-turn count (native = null; post-hoc only, per spec OQ3).

**Files in play.** `skills-contrib/drive-diagnostics/metrics.ts`, `skills-contrib/drive-diagnostics/test/metrics.test.ts`.

**"Done when":**
- [ ] Each metric on the project-DoD list implemented or explicitly `null`-with-note.
- [ ] Each metric has ≥1 `node --test` case with a hand-checked expected value (use a small inline fixture + the real trace).
- [ ] No metric throws on a partial trace (dispatch-start without dispatch-end; missing event types).
- [ ] `node --test skills-contrib/drive-diagnostics/test/metrics.test.ts` green; diff confined to the two files.

**Size.** M. ~14 small pure functions + tests.

**DoR:** ✓ — metric definitions named in spec + project plan; D1 gives the typed event array.

---

### Dispatch 3: Assertions A — invariants I1–I12

**Intent.** `skills-contrib/drive-diagnostics/assertions/invariants.ts`: one checker per invariant from `docs/drive/model.md` § Layer 5, each returning `{ id, title, status: "pass"|"fail"|"not-checkable", evidence: TraceRef[], note }`. Implement the observable subset (e.g. I1 one PR per slice → >1 `slice-completed` for a slug = fail; I6 spec+plan before impl → `dispatch-start` with no preceding `spec-authored`/`plan-authored` in the run; I8 DoR/DoD per dispatch → best-effort from brief presence; I12 → silent amendment detection is `not-checkable`, but `falsified-assumption` presence is evidence). Mark genuinely unobservable invariants (I2, I7, I11) `not-checkable` with a one-line reason.

**Files in play.** `skills-contrib/drive-diagnostics/assertions/invariants.ts`, `skills-contrib/drive-diagnostics/assertions/types.ts` (shared `AssertionResult`/`TraceRef`), `skills-contrib/drive-diagnostics/test/invariants.test.ts`.

**"Done when":**
- [ ] All 12 invariants represented; each returns a result; `not-checkable` ones carry a rationale string.
- [ ] Observable invariants have a test proving both a passing and a failing trace where feasible.
- [ ] Evidence pointers reference real `event_id`s from the trace.
- [ ] `node --test` green; diff confined to the named files.

**Size.** M. 12 small checkers; the shared types file is tiny.

**DoR:** ✓ — invariant list quoted in spec references; `AssertionResult` shape defined here for D4 to reuse.

---

### Dispatch 4: Assertions B — cascade rules + brief-discipline

**Intent.** `skills-contrib/drive-diagnostics/assertions/cascade.ts` (the 8 rules from `docs/drive/design-decisions/2026-05-28-artifact-cascade-redesign.md`) and `skills-contrib/drive-diagnostics/assertions/brief.ts` (the brief-discipline anti-patterns from `docs/drive/principles/brief-discipline.md`), reusing the D3 `AssertionResult` shape. Observable examples: brief anti-pattern "brief restates the slice spec" → `brief-issued.brief_byte_length` above a threshold relative to spec size (`not-checkable` if spec size absent; flag as heuristic); cascade Rule 4 "discussion is signal-triggered" → `falsified-assumption`/discussion events present without a triage churn = informational. Mark unobservable rules `not-checkable` with rationale. `assertions/index.ts`: `runAssertions(events) → AssertionResult[]` aggregating invariants + cascade + brief.

**Files in play.** `skills-contrib/drive-diagnostics/assertions/cascade.ts`, `skills-contrib/drive-diagnostics/assertions/brief.ts`, `skills-contrib/drive-diagnostics/assertions/index.ts`, `skills-contrib/drive-diagnostics/test/cascade-brief.test.ts`.

**"Done when":**
- [ ] All 8 cascade rules + the brief-discipline anti-patterns represented; `not-checkable` ones carry rationale.
- [ ] `runAssertions` aggregates all three families; tested over the real trace.
- [ ] Heuristic checks documented as heuristic in their `note`.
- [ ] `node --test` green; diff confined to the named files.

**Size.** M. Mirrors D3's pattern.

**DoR:** ✓ — rule lists quoted in spec references; D3 supplies the result shape.

---

### Dispatch 5: Report generator + CLI + package.json wiring

**Intent.** `skills-contrib/drive-diagnostics/report.ts`: `renderReport({metrics, assertions, loadErrors, runMeta}): string` → a markdown dashboard (run header incl. `project_run_id` + `detection_method` + native/post-hoc/mixed origin banner; metrics table; assertion pass/fail/not-checkable sections with evidence pointers; an "N unparseable lines" banner if any). `skills-contrib/drive-diagnostics/cli.ts`: parse argv (`<trace.jsonl> [--posthoc <transcript>] [--out <path>]`), load → compute → assert → render → print (or write). Wire root `package.json`: add `"drive:diagnose": "node skills-contrib/drive-diagnostics/cli.ts"` and append the new test files to `test:scripts`.

**Files in play.** `skills-contrib/drive-diagnostics/report.ts`, `skills-contrib/drive-diagnostics/cli.ts`, `skills-contrib/drive-diagnostics/test/report.test.ts`, `package.json` (root).

**"Done when":**
- [ ] `node skills-contrib/drive-diagnostics/cli.ts projects/drive-instrumentation/trace.jsonl` prints a well-formed markdown dashboard, exit 0.
- [ ] `report.ts` renders metrics + all three assertion families + origin/error banners; tested with a fixture producing deterministic markdown.
- [ ] Root `package.json` has `drive:diagnose`; `test:scripts` includes the new suites; `pnpm test:scripts` green.
- [ ] Diff confined to the three tool files + `package.json`.

**Size.** M. Renderer + CLI glue + wiring.

**DoR:** ✓ — D1–D4 supply loader/metrics/assertions; report shape sketched in spec At-a-glance.

---

### Dispatch 6: Best-effort post-hoc transcript parser

**Intent.** `skills-contrib/drive-diagnostics/posthoc.ts`: `parseTranscript(path): { events: ValidatedEvent[], notes: string[] }`. Read the Cursor transcript JSONL (`{role, message:{content:[{type,...}]}}`, only `text`+`tool_use`). Map observable signals → trace events with `origin:"post-hoc"` + `confidence`: a `Task` tool_use → `dispatch-start` (+ `dispatch-end` if a later turn shows return); a spec/plan `Write`/`StrReplace` to a `spec.md`/`plan.md` path → `spec-authored`/`plan-authored`; `user`-role turns → operator-turn count (spec OQ3). No detectable structure → empty list + "no Drive signal" note; never fabricate. Wire `--posthoc` in the CLI to merge post-hoc events and set the report's mixed/post-hoc origin flag.

**Files in play.** `skills-contrib/drive-diagnostics/posthoc.ts`, `skills-contrib/drive-diagnostics/cli.ts` (wire `--posthoc`), `skills-contrib/drive-diagnostics/test/posthoc.test.ts`, a small committed transcript fixture under `skills-contrib/drive-diagnostics/test/fixtures/`.

**"Done when":**
- [ ] `parseTranscript` reconstructs ≥ the dispatch + spec/plan + operator-turn signals from a transcript fixture, each event stamped `origin:"post-hoc"` + `confidence`.
- [ ] Empty/structureless transcript → empty list + note; no fabricated events.
- [ ] `--posthoc` path renders a report flagged post-hoc/mixed origin.
- [ ] `node --test` green; diff confined to the named files (+ fixture).

**Size.** M. Best-effort mapping — intentionally narrow signal set.

**DoR:** ✓ — transcript format confirmed (text+tool_use only); confidence model in spec.

---

### Dispatch 7: Self-grade run + manual-QA; slice close

**Intent.** Run the finished tool on this project's own `projects/drive-instrumentation/trace.jsonl`; commit the rendered report at `projects/drive-instrumentation/slices/03-…/self-grade-report.md`. Author `manual-qa.md` (re-runnable: run the CLI on the real trace + a malformed fixture + the post-hoc fixture; assert the banners, the metric table, the assertion families, the grep gate). Run it → `qa-run-01.md`. From what the self-grade surfaces, land ≥1 lesson in a canonical/project-context/ADR surface (the single permitted out-of-`scripts/` edit).

**Files in play.** `projects/drive-instrumentation/slices/03-…/{self-grade-report.md, manual-qa.md, qa-run-01.md}`, the one canonical lesson surface.

**"Done when":**
- [ ] `node … cli.ts projects/drive-instrumentation/trace.jsonl` runs clean; report committed.
- [ ] `manual-qa.md` re-runnable; `qa-run-01.md` records a PASS run with no Blockers.
- [ ] ≥1 lesson landed in a canonical/project-context/ADR surface (SDoD9).
- [ ] `pnpm test:scripts` + `pnpm typecheck` + `biome` clean across the slice.

**Size.** M. Run + QA doc + one lesson.

**DoR:** ✓ — tool complete after D1–D6; the trace fixture is this project's own run.

## Sanity checks

- ✓ Each dispatch M (none L/XL).
- ✓ Each "done when" binary + verifiable (a passing `node --test` / CLI invocation / diff-stat).
- ✓ Every slice-spec edge case maps to a dispatch's tests or is explicitly out.
- ✓ Slice-DoD's nine items reachable from the sequence.
- ✓ Acyclic: D1 schema/loader → D2 metrics + D3/D4 assertions → D5 report/CLI → D6 post-hoc → D7 self-grade.

## Hand-off

Hand off to [`drive-build-workflow`](../../../../skills-contrib/drive-build-workflow/SKILL.md). Next dispatch: D1 (schema + loader). After the slice PR merges, `drive-close-project` runs the project close-out (migrate long-lived docs, delete `projects/drive-instrumentation/`) — out of this slice's scope.
