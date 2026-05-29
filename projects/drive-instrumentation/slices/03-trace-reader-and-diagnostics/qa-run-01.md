# QA run 01 — slice 03 (trace reader + diagnostics)

Executed [`manual-qa.md`](./manual-qa.md) from repo root on the slice-3 branch (`tml-2717-drive-instrumentation-s3-trace-reader`). **Verdict: PASS — no Blocker findings.**

## Pre-flight gate

| Gate | Result |
|---|---|
| `pnpm test:scripts` | PASS — 407 tests, 407 pass, 0 fail (incl. the 5 `skills-contrib/drive-diagnostics/test/*.test.ts` suites: load, metrics, invariants, cascade-brief, report, posthoc). |
| `tsc --noEmit --strict` over the dir | PASS — exit 0. |
| `biome check skills-contrib/drive-diagnostics` | PASS — no fixes, 0 errors, 0 `no-bare-cast` diagnostics. |

## Per-check results

| Check | Result | Observation |
|---|---|---|
| **C1** native run on own trace | PASS | exit 0; dashboard with `**Origin:** native`, `**Events:** 59`, full Metrics + Assertions blocks. |
| **C2** malformed trace | PASS | exit 0; banner `⚠ 2 unparseable lines, 0 unknown-type events`; no crash. |
| **C3** empty trace | PASS | exit 0; `**Events:** 0`; metrics render as `n/a (no signal)`. |
| **C4** post-hoc transcript | PASS | exit 0; `**Origin:** post-hoc`; `operator turn count = 4`; no fabricated native metrics. |
| **C5** assertion families + gaps | PASS | 33 assertion rows: I1–I12, Cascade-1…8, BD-* present; Pass 7 / Fail 0 / Not-checkable 24, each not-checkable row carrying a one-line rationale. |
| **C6** directory boundary (merge-base) | PASS | empty out-of-scope diff; slice confined to `skills-contrib/drive-diagnostics/**`, `package.json`, `projects/drive-instrumentation/**`, `drive/retro/findings.md`. |
| **C7** self-grade report committed | PASS | `self-grade-report.md` present (the framework grading this project's own ProjectRun). |

## Self-grade read-out (what the framework says about this project's own run)

From `self-grade-report.md` over the live trace (59 events, all native, run id `drive-instrumentation`):

- **Rework: clean.** `rounds_per_dispatch.mean = 1.00`, `first_pass_acceptance_rate = 100%`, `backtrack_ratio = 0` — every dispatch landed in one round, no reissued briefs, all `brief_disposition = initial`.
- **Planning: stable.** `spec_amendments = 0`, `plan_amendments = 0`, `i12_halts = 0` falsified assumptions, no re-triage.
- **Assertions: 7 pass / 0 fail / 24 not-checkable.** The not-checkable set is the honest coverage-gap list (scope/purpose immutability, sizing-by-INVEST, brief content sections, reviewer/skill-body facts) — invariants the current trace vocabulary cannot observe.

## Honest caveat (recorded in the landed finding)

The clean metrics above are partly an artefact of **how this trace was produced**: the build-loop + planning events were hand-emitted by the orchestrator during slice development (dogfooding the emission protocol), with idealised `round-end.verdict = "satisfied"` values. So the self-grade validates that the **reader** computes the right things over a conformant trace — it does **not** yet validate the methodology on a real unattended run where the skills emit their own events. That is the next step (a skill-emitted ProjectRun + Project 2's judge). This caveat is the slice's landed lesson — see `drive/retro/findings.md`.

## Findings

None at Blocker or Major severity. One Minor (recorded, not blocking): post-hoc-reconstructed events (which lack timestamps) surface via the origin banner + operator-turn count but do not feed the metric computations — a known limitation noted in the D6 commit and acceptable under the spec's best-effort framing.
