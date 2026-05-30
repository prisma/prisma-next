# Manual QA — direct-change-diagnostic-wording

> **Be the user.** You are a developer who referenced a PSL namespace that isn't enabled, hit the diagnostic, and want it to tell you what to do.
>
> **Out of scope of this script.** Re-running the full package test suite; re-running CI lints over the clean tree; asserting type-check exit codes (CI owns those).
>
> **Spec:** `brief.md` + `acceptance.md` (this case)
> **Plan:** n/a (direct change)
> **PR:** _(filled at run time)_

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | -------- | -------------- | --------- | ------ |
| 1 | Re-enact the reported flow | A user who hits the diagnostic gets actionable, namespace-named guidance | `tmpdir` | AC-2, AC-3, AC-4 |
| 2 | Wording oracle read | The message conforms to the `namespace-diagnostic-wording` rule | `read-only` | AC-3, AC-4 |
| 3 | Exploratory: adjacent diagnostics | Probe sibling namespace diagnostics for the same anti-pattern | `read-only` | (no AC; charter) |

> Scenario 1 is **(judgement)** — the runner evaluates whether the copy reads as actionable. No negative-control scenario: this change ships no new gate.

## Pre-flight

1. Build the CLI / interpreter per the repo's getting-started doc.
2. `git status` is clean before starting.
3. Have a minimal PSL file that references a namespaced attribute whose pack is **not** in `extensionPacks`.

## Scenario 1 — Re-enact the reported flow

**What you're proving from the user's seat:** A developer who triggers the diagnostic reads a message that names the namespace they used and tells them the exact config key to edit. This is the originally-reported confusion; CI never saw the user's confusion, only the assertion.

**Covers:** AC-2, AC-3, AC-4

**Isolation:** `tmpdir`

**Oracle:** `acceptance.md` AC-2/AC-3/AC-4 + the `namespace-diagnostic-wording` rule.

**Preconditions:**
- A scratch project in `$PN_QA_TMP/scenario-1` with a PSL file referencing an unavailable namespace.

### Steps

1. In the scratch dir, run the interpreter / CLI command that processes the PSL file (the command the demo uses to validate a schema).
2. Read the emitted diagnostic.

### What you should see

- The message names the specific namespace referenced (not a generic "a namespace").
- The message says to add the pack to `extensionPacks` in `prisma-next.config.ts`.
- The phrase "namespace not composed" does **not** appear.

### Failure modes (a finding the runner classifies)

- Message still says "namespace not composed", or is otherwise generic.
- Message names the wrong namespace or omits the config-key guidance.
- The diagnostic no longer fires, or now fires on an unrelated condition.

### Restore

`rm -rf $PN_QA_TMP/scenario-1`; `git status` clean.

## Scenario 2 — Wording oracle read

**What you're proving from the user's seat:** The shipped copy matches the team's documented wording guidance — a durable-doc/rule coherence read CI cannot judge.

**Covers:** AC-3, AC-4

**Isolation:** `read-only`

**Oracle:** `.cursor/rules/namespace-diagnostic-wording.mdc`.

**Preconditions:** none.

### Steps

1. Open the changed diagnostic string in the diff.
2. Open the `namespace-diagnostic-wording` rule.

### What you should see

- The message follows the rule's preferred guidance (names the namespace; points at `extensionPacks`; avoids "not composed").

### Failure modes

- Message technically passes tests but violates the rule's spirit (e.g. names the namespace but gives no fix path).

## Scenario 3 — Exploratory: adjacent diagnostics

**Charter.** Explore sibling namespace/extension-pack diagnostics in the same module for 15 minutes; discover whether any *other* user-facing message still uses "not composed" or omits a fix path, which would be a candidate follow-up (not part of this change).

**Covers:** (no specific AC; surfaces unknowns)

**Time budget:** 15 minutes.

**Notes capture:** Log any sibling diagnostic with the same anti-pattern as a candidate follow-up ticket.

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC-1 | "Located the right string + updated its test" is a code-review/CI observation, not a user-facing one. |
| AC-5 | "No behaviour change beyond text" is asserted by the unchanged firing-condition test; CI owns it. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC-1 | (CI / code review) — see "deliberately not in this script" |
| AC-2 | 1 |
| AC-3 | 1, 2 |
| AC-4 | 1, 2 |
| AC-5 | (CI) — see "deliberately not in this script" |
