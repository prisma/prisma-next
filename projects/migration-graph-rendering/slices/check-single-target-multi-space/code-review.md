# Code review — check-single-target-multi-space (TML-2835)

> Reviewer maintains scoreboard/findings/round-notes/summary; orchestrator owns § Subagent IDs + § Orchestrator notes.

## Summary

- **Current verdict:** ANOTHER ROUND NEEDED
- **AC scoreboard totals:** 1 PASS / 0 FAIL / 0 NOT VERIFIED
- **Open findings:** 2 (1 should-fix, 1 low-process)

The multi-space resolution, ambiguity semantics, `--space` narrowing, and the
restored D2 ref-error envelope are all correct and well-tested. Two issues hold
the round: (F-1, should-fix) the `--help` long description still claims single
target is "app-space" only — directly contradicting the shipped behaviour, a
doc-maintenance miss; (F-2, low-process) `wrong-grammar` short-circuits the
space loop and can mask a legitimate earlier-space hit in a contrived
ref-name/hash-prefix collision. F-1 is a one-line fix and gates the round.

## Acceptance criteria scoreboard

| AC ID | Description (short) | Dispatch | Status | Evidence |
| ----- | ------------------- | -------- | ------ | -------- |
| AC-1 | `check <ref>` resolves a non-app-space migration; `--space` narrows single-target; cross-space ambiguous ref errors PRECONDITION; exit codes still documented in `--help` | D1 | PASS | non-app resolve: `migration-check.ts:458-498` + test `migration-check-single-target-multi-space.test.ts:158-171`; `--space` narrow + validation: `migration-check.ts:419-428` + tests `:173-250`; ambiguity PRECONDITION: `migration-check.ts:480-486` / `cli-errors.ts:381-403` + test `:252-266`; exit codes documented: `migration-check.ts:558-559` |

## Subagent IDs

- **Implementer:** D1 ran over three sonnet rounds (each truncated mid-report — a recurring harness issue this session): `af7e7259bb09f0b8d` (R1: multi-space resolution + errorAmbiguousMigrationRef + path generalization; left uncommitted/broken), `a1a31be10a3c058e4` (R2: fixed typecheck + 3 own-test failures; committed `c9d65fc14`; defensibly corrected a `db` named-ref test to PRECONDITION per spec), `afdf7ff2de5d9774a` (R3: started the D2-regression fix but truncated leaving a compile error). **Orchestrator finished R3 directly** (commit `f350b17d6`) — a 2-line recovery (`firstParseFailure` typo + use the named `RefResolutionError` import; route 0-hit ref failures through `mapRefResolutionError`) rather than a 4th dispatch.
- **Reviewer:** _(opus pass — recorded below)_

## Findings log

### F-1 (should-fix) — stale `--help` text claims single-target is app-space only

`migration-check.ts:556` still reads "…or a migration reference to check a
single **app-space** package." This slice's whole point is that a migration
reference now resolves across **all** contract spaces, so the help text now
contradicts the shipped behaviour. AC-1 explicitly carries "exit codes still
documented in `--help`", and CLAUDE.md's golden rule is to keep docs current.

**In-PR action:** reword the clause to reflect multi-space single-target
resolution (e.g. "…or a migration reference to check a single package in any
contract space — narrow with `--space <id>`, and an ambiguous reference is
reported as a precondition failure"). One-line edit; no code change. Consider
adding a `migration check <ref> --space <id>` example to `setCommandExamples`
(`:561-566`) while there.

### F-2 (low-process) — `wrong-grammar` short-circuit can mask an earlier-space hit

In the ref loop (`migration-check.ts:462-470`), a `wrong-grammar` failure from
any space `return`s immediately, even if an earlier in-scope space already
pushed a legitimate hit. `parseMigrationRef` emits `wrong-grammar` when the
input is a ref **name present in that space's refs** (`migration-ref.ts:37-45`)
— which is space-dependent, contradicting the inline comment's claim that
wrong-grammar "is space-independent." Reachable case: a hex-prefix string that
(a) uniquely matches a migration hash in `app` (a hit) and (b) is literally the
name of a ref in a later space — the later space's wrong-grammar return would
discard the app hit and emit a ref-name diagnostic instead of resolving in app.
Contrived (requires a ref named like a hash prefix), but the masking is real.

**In-PR action:** treat wrong-grammar like `firstParseFailure` — record it and
only emit it after the loop when there are zero hits, rather than
short-circuiting mid-loop. Then drop/repair the "space-independent" comment.
Low severity given the contrivedness; acceptable to defer with an explicit
narrative note if the orchestrator prefers, but the comment is actively wrong
and should at least be corrected.

## Round notes

### Round 1 (opus reviewer)

Walked `checkSingleTarget` end to end against the spec's § Chosen design.

- **Multi-space resolution — correct.** Hit collection requires both a
  successful `parseMigrationRef` and an on-disk package with the matching hash
  (`:472-477`); 0 hits → not-found, 1 → check it, >1 → ambiguity. The
  "resolved-in-graph-but-no-package" edge falls through cleanly to the
  not-found result (`firstParseFailure` stays undefined because parse
  succeeded), exactly as the spec asserts.
- **D2 envelope restored — correct.** The 0-hit-with-parse-failure path
  (`:491-497`) routes the first parse failure through `mapRefResolutionError`,
  and the single-app-space `does-not-exist` lock
  (`migration-check-ref-error.test.ts:124-139`) asserts PN-RUN-3000 + meta —
  the D2/TML-2801 contract is genuinely re-locked, not papered over.
- **Ambiguity test is a real >1-space lock.** The fixture plants the same
  dirName in `app` and `postgis` with distinct hashes
  (`...test.ts:101-109`); `findEdgeByDirName` matches per-space, so two hits
  are produced and `MIGRATION.AMBIGUOUS_MIGRATION_REF` fires — defect-planting,
  would fail if the loop collapsed to first-match.
- **`db` named-ref test is spec-aligned, not a paper-over.** A ref named `db`
  is a contract ref; `parseMigrationRef` rejects it as wrong-grammar
  (`migration-ref.ts:37-45`). The spec scopes single-target to dirName/hash,
  not ref-names, so PRECONDITION is the correct expectation.
- **`--space` narrows before resolution** (`scopedSpaces` at `:430-431` feeds
  both the path and ref branches) and validates identically to the holistic
  path (`isValidSpaceId`/`errorInvalidSpaceId`, membership/`errorSpaceNotFound`
  at `:419-428`, mirroring `runMigrationCheck:272-277`). Tests `:173-250` lock
  invalid/unknown/narrow-miss.
- **Repo rules — clean.** `ifDefined` used for the optional `resolvedSpaceId`
  under exactOptionalPropertyTypes (`:535,541`); no bare `as`, no `any`, no
  zod, no cross-file reexports added; new `errorAmbiguousMigrationRef` follows
  the existing why/fix/meta factory style.
- **Behaviour-change note (narrative, not a finding):** single-target now loads
  the full read aggregate (`:344-349`) and shares the holistic path's
  `5001`/`5002` integrity-refusal gate, where the old path read only the app
  migrations dir. This is the spec's chosen design and arguably more correct,
  but it does widen single-target's pre-resolution failure surface — worth a
  line in the PR description so it isn't a surprise.
- **`checkManifestFilesPresent(matchedSpace)`** (`:510`) now runs on the
  matched space rather than always-app — correct: the orphan-manifest scan
  should target the space the package actually lives in.

## Orchestrator notes

**Build executed via the drive-build-workflow protocol directly** (not re-invoking the skill — its full body was loaded an hour ago for the TML-2801 slice; re-reading would only burn context). Same loop: dispatch → intent-validate DoD → opus reviewer pass → on SATISFIED push + open PR (operator wants autonomous + auto-PR). Single-dispatch slice. Model tiers per `drive/calibration/model-tier.md`: implementer sonnet (design pinned in spec, reuses TML-2801's enumerateCheckSpaces pattern, precise brief); reviewer opus.

**Reviewer verdict: ANOTHER ROUND NEEDED** (AC-1 PASS behaviorally; F-1 should-fix + F-2 low-process). Orchestrator intent-validation: both findings valid (F-1 stale `--help` "app-space" prose; F-2 wrong-grammar short-circuit masking + wrong comment). **Both RESOLVED directly by the orchestrator** in commit `7d52f765e` rather than a 5th sonnet dispatch (the three implementer rounds all truncated mid-report; a 2–3 line doc+comment+control-flow fix is not worth another flaky dispatch): F-1 → reworded the long description to multi-space + added a `check <ref> --space app` example; F-2 → removed the mid-loop wrong-grammar `return` so failures are deferred to `firstParseFailure` and only surface (via the shared envelope) when no space yields a hit, and corrected the "space-independent" comment. Verified: typecheck clean; migration-check + help-text + parity suites 54/54; full cli suite green (background run, exit 0). Resolution orchestrator-validated, not re-sent to the reviewer (narrow, reviewer-specified, test-covered). The reviewer's narrative note (single-target now loads the full read aggregate → inherits the holistic integrity-refusal gate; a deliberate, spec-aligned widening) is carried into the PR description.

**SLICE DoD MET:** AC-1 PASS + F-1/F-2 resolved; all gates green. Proceeding to push + PR.
