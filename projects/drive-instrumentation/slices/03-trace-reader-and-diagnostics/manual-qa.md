# Manual QA — slice 03 (trace reader + diagnostics)

Re-runnable script exercising the `skills-contrib/drive-diagnostics/` tool end-to-end against real + synthetic inputs. Run from the repo root. Each check states its command and the PASS condition. A run report lives in [`qa-run-01.md`](./qa-run-01.md).

## Pre-flight gate

```bash
pnpm test:scripts
```
**PASS:** exits 0; the five `skills-contrib/drive-diagnostics/test/*.test.ts` suites are listed and all tests pass.

```bash
./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --target es2022 --skipLibCheck skills-contrib/drive-diagnostics/*.ts skills-contrib/drive-diagnostics/assertions/*.ts skills-contrib/drive-diagnostics/test/*.ts
```
**PASS:** exits 0 (no type errors).

```bash
./node_modules/.bin/biome check --config-path biome.jsonc skills-contrib/drive-diagnostics
```
**PASS:** "No fixes applied", 0 errors, 0 `no-bare-cast` diagnostics.

## C1 — native run on the project's own trace

```bash
pnpm drive:diagnose projects/drive-instrumentation/trace.jsonl
```
**PASS:** exit 0; markdown dashboard with header (`**Origin:** native`), a `## Metrics` block (Rework / Planning Quality / Artefact Churn / Lifecycle / Operator) and a `## Assertions` block grouped Pass / Fail / Not-checkable. No stack trace.

## C2 — malformed trace is reported, not fatal

```bash
printf '%s\n' '{"event_type":"dispatch-start"' '{"not":"an event"}' > /tmp/drive-bad-trace.jsonl
pnpm drive:diagnose /tmp/drive-bad-trace.jsonl
```
**PASS:** exit 0; report shows a parse-health banner naming the unparseable line(s) / unknown-type events; no crash.

## C3 — empty trace

```bash
: > /tmp/drive-empty-trace.jsonl
pnpm drive:diagnose /tmp/drive-empty-trace.jsonl
```
**PASS:** exit 0; report renders with `**Events:** 0` and metrics shown as `n/a (no signal)`; no crash.

## C4 — post-hoc transcript reconstruction

```bash
pnpm drive:diagnose --posthoc skills-contrib/drive-diagnostics/test/fixtures/sample-transcript.jsonl
```
**PASS:** exit 0; report header shows `**Origin:** post-hoc`; the Operator section shows a non-zero `operator turn count`. No fabricated native metrics.

## C5 — assertion families present + honest gaps

```bash
pnpm drive:diagnose projects/drive-instrumentation/trace.jsonl | rg '^\| (I[0-9]+|Cascade-[0-9]+|BD-[0-9]+) '
```
**PASS:** the assertion tables list invariants I1–I12, Cascade-1…8, and the brief-discipline (BD-*) checks; each row in the Not-checkable table carries a one-line rationale in its Rationale column.

## C6 — directory boundary (grep gate)

```bash
git diff --name-only "$(git merge-base origin/main HEAD)"..HEAD -- ':!skills-contrib/drive-diagnostics' ':!package.json' ':!projects/drive-instrumentation' ':!drive/retro/findings.md'
```
**PASS:** empty output — the slice touched only `skills-contrib/drive-diagnostics/**`, root `package.json`, `projects/drive-instrumentation/**`, and the single self-grade lesson in `drive/retro/findings.md`. (Diff against the **merge-base**, not `origin/main` directly, so an out-of-date branch doesn't show upstream churn as false positives.)

## C7 — self-grade report committed

```bash
test -f projects/drive-instrumentation/slices/03-trace-reader-and-diagnostics/self-grade-report.md && echo OK
```
**PASS:** prints `OK`; the report is the framework grading this project's own ProjectRun (SDoD9).
