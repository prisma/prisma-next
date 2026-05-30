# Manual QA — slice-cli-list-flag

> **Be the user.** You are a developer (or a CI script author) who wants the migration-list command's data as JSON to build tooling on, without scraping formatted text.
>
> **Out of scope of this script.** Re-running the whole CLI test suite; re-running lints over the clean tree; asserting type-check passes (CI owns these).
>
> **Spec:** `brief.md` + `acceptance.md` (this case)
> **Plan:** the run's slice plan
> **PR:** _(filled at run time)_

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | -------- | -------------- | --------- | ------ |
| 1 | `--json` is machine-parseable | Piping `--json` into a JSON parser succeeds and yields the documented shape | `tmpdir` | AC-1, AC-2 |
| 2 | Default output unchanged | The human rendering is byte-for-byte what it was before the flag | `tmpdir` | AC-3 |
| 3 | Shared-source read | JSON and human paths call the same data builder | `read-only` | AC-4 |
| 4 | Error parity | A missing migrations dir errors consistently in both modes | `tmpdir` | AC-5 |
| 5 | Exploratory: malformed/edge inputs | Probe odd migration graphs (empty, single, cyclic-ish) in both modes | `tmpdir` | (no AC; charter) |

> Scenario 3 is **(judgement)** — a code read of the data flow. Scenario 1 is a journey-smoke. No negative control: this slice ships no gate.

## Pre-flight

1. Build the CLI per getting-started.
2. Prepare a scratch project with ≥2 migrations so the list is non-trivial.
3. `git status` clean.

## Scenario 1 — `--json` is machine-parseable

**What you're proving from the user's seat:** A tooling author can pipe the command's `--json` output straight into a JSON parser and get the documented shape — the whole point of the flag.

**Covers:** AC-1, AC-2

**Isolation:** `tmpdir`

**Oracle:** the documented JSON field shape in the command's types / help.

**Preconditions:** scratch project with ≥2 migrations in `$PN_QA_TMP/scenario-1`.

### Steps

1. Run the migration-list command with `--json`, piping stdout to a JSON parser (e.g. `... migration-list --json | node -e 'JSON.parse(require("fs").readFileSync(0))'`).
2. Inspect the parsed object against the documented shape.

### What you should see

- The parse succeeds (stdout is pure JSON — no styling/log noise interleaved).
- The object carries the documented migration-list fields, matching the data the human view shows.

### Failure modes

- Parse fails (styling or log lines on stdout).
- Fields missing / renamed vs. the documented shape.
- JSON shows different migrations than the human view for the same project.

### Restore

`rm -rf $PN_QA_TMP/scenario-1`; `git status` clean.

## Scenario 2 — Default output unchanged

**What you're proving from the user's seat:** Existing users who don't pass `--json` see exactly what they saw before — no regression to the default journey.

**Covers:** AC-3

**Isolation:** `tmpdir`

**Oracle:** the pre-change human rendering (captured from `main`).

**Preconditions:** same scratch project; a captured baseline of the default output from `main`.

### Steps

1. Run the migration-list command with no flag.
2. Diff its output against the captured baseline.

### What you should see

- Identical human rendering (modulo intentionally-unrelated changes).

### Failure modes

- The default output changed as a side effect of adding the flag.

### Restore

`rm -rf $PN_QA_TMP/scenario-1`; `git status` clean.

## Scenario 3 — Shared-source read

**What you're proving from the user's seat:** The JSON won't silently drift from the human view, because both are projections of one model — a maintainability property no single run of the command can prove.

**Covers:** AC-4

**Isolation:** `read-only`

**Oracle:** the diff — both code paths call the same data-building function.

**Preconditions:** none.

### Steps

1. In the diff, find the `--json` branch and the human-render branch.
2. Confirm both consume the same migration-list data builder.

### What you should see

- One shared data source feeding both renderers.

### Failure modes

- A second, independent computation of the migration list for JSON.

## Scenario 4 — Error parity

**What you're proving from the user's seat:** A scripting user gets a consistent, useful failure in `--json` mode, not a half-formatted human error or a zero exit code on failure.

**Covers:** AC-5

**Isolation:** `tmpdir`

**Oracle:** the default-mode error behaviour for the same condition.

**Preconditions:** scratch dir in `$PN_QA_TMP/scenario-4` with **no** migrations directory.

### Steps

1. Run the command with no migrations present, once without and once with `--json`.
2. Compare exit codes and error reporting.

### What you should see

- Both modes report the error and exit non-zero; `--json` mode does not print a half-JSON body then crash.

### Failure modes

- `--json` swallows the error / exits 0; or prints partial JSON.

### Restore

`rm -rf $PN_QA_TMP/scenario-4`; `git status` clean.

## Scenario 5 — Exploratory: edge migration graphs

**Charter.** Explore the command (both modes) against unusual migration graphs — zero migrations, a single migration, a wide fan-out — for 25 minutes. Discover output shapes that read poorly or JSON that omits structure the human view shows.

**Covers:** (no specific AC; surfaces unknowns)

**Time budget:** 25 minutes.

**Notes capture:** Log any graph where the two modes disagree or the JSON loses structure.

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC-6 | "Tests exist" is a CI/code-review observation; the tests run in CI. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC-1 | 1 |
| AC-2 | 1 |
| AC-3 | 2 |
| AC-4 | 3 |
| AC-5 | 4 |
| AC-6 | (CI) — see "deliberately not in this script" |
