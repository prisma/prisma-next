# Manual QA — project-retry-policy

> **Be the user.** You are an adapter author deciding whether to opt into retries, and a caller who must not be surprised by retry behaviour you didn't ask for.
>
> **Out of scope of this script.** Re-running each slice's full test suite; re-running lints over the clean tree; asserting type-check (CI owns these per slice).
>
> **Spec:** `brief.md` + `acceptance.md` (this case)
> **Plan:** the run's project plan + per-slice plans
> **PR(s):** _(filled at run time — one per slice)_

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | -------- | -------------- | --------- | ------ |
| 1 | Opt-out default is unchanged | An adapter that doesn't opt in behaves exactly as before | `tmpdir` | AC-2 |
| 2 | Retryable transient succeeds on retry | A configured policy recovers a transient failure | `tmpdir` | AC-3 |
| 3 | Non-idempotent never retried (negative control) | The runtime refuses to retry a non-idempotent op even under a policy | `workspace` | AC-4 |
| 4 | Exhaustion propagates | After max attempts, the original failure surfaces unchanged | `tmpdir` | AC-3 |
| 5 | Project shape read | The work landed as sequenced, individually-reviewable slices | `read-only` | AC-7 |
| 6 | Exploratory: backoff + error-class edges | Probe odd backoff schedules and ambiguous error classes | `tmpdir` | (no AC; charter) |

> Scenario 3 is **(negative control)** — it plants a non-idempotent operation under an active policy and proves the runtime does **not** retry it. Scenario 5 is **(judgement)** — a read of the delivered PR sequence.

## Pre-flight

1. Build the affected packages.
2. Identify the opted-in adapter (AC-5) and a non-opted-in adapter (for scenario 1).
3. `git status` clean.

## Scenario 1 — Opt-out default is unchanged

**What you're proving from the user's seat:** A caller using an adapter that didn't opt in sees zero behavioural change — no retries, same error timing.

**Covers:** AC-2

**Isolation:** `tmpdir`

**Oracle:** pre-change behaviour of a non-opted-in adapter on a transient failure.

**Preconditions:** a way to inject a transient failure (a stub/mock transport) in `$PN_QA_TMP/scenario-1`.

### Steps

1. Drive an operation through a non-opted-in adapter with an injected transient failure.
2. Observe attempt count and the surfaced error.

### What you should see

- Exactly one attempt; the failure surfaces immediately, as before.

### Failure modes

- The non-opted-in adapter retries (default leaked).

### Restore

`rm -rf $PN_QA_TMP/scenario-1`; `git status` clean.

## Scenario 2 — Retryable transient succeeds on retry

**What you're proving from the user's seat:** With a policy configured, a blip that would have failed the caller now transparently recovers.

**Covers:** AC-3

**Isolation:** `tmpdir`

**Oracle:** the policy's max-attempts + the injected failure schedule.

**Preconditions:** opted-in adapter + an injected transport that fails N-1 times then succeeds, in `$PN_QA_TMP/scenario-2`.

### Steps

1. Configure a policy with max attempts > N.
2. Drive an idempotent operation; observe it succeed after retries.

### What you should see

- The operation succeeds; attempt count matches the failure schedule + 1.

### Failure modes

- Gives up before max attempts; or retries forever; or backoff ignored.

### Restore

`rm -rf $PN_QA_TMP/scenario-2`; `git status` clean.

## Scenario 3 — Non-idempotent never retried (negative control)

**What you're proving from the user's seat:** The runtime will not silently re-run a non-idempotent operation (double-write hazard) even when a retry policy is active. **Coverage boundary:** this proves the runtime refuses retry for operations flagged non-idempotent; it does not prove every adapter correctly classifies every operation's idempotency.

**Covers:** AC-4

**Isolation:** `workspace`

**Oracle:** AC-4 — non-idempotent operations are never retried.

**Preconditions:** the opted-in adapter; a non-idempotent operation marker.

### Steps

1. In a worktree, configure an active retry policy.
2. Drive a non-idempotent operation against an injected transient failure.

### What you should see

- Exactly one attempt; no retry; the failure surfaces. (The runtime distinguishes idempotent from non-idempotent before retrying.)

### Failure modes

- The non-idempotent operation is retried.

### Restore

Discard the worktree; `git status` clean in the main tree.

## Scenario 4 — Exhaustion propagates

**What you're proving from the user's seat:** When retries genuinely can't recover, the caller gets the real, original error — not a wrapped/obscured one.

**Covers:** AC-3

**Isolation:** `tmpdir`

**Oracle:** the original injected error.

**Preconditions:** opted-in adapter + a transport that always fails, in `$PN_QA_TMP/scenario-4`.

### Steps

1. Configure max attempts = K.
2. Drive an idempotent op against the always-failing transport.

### What you should see

- After K attempts, the original error surfaces unchanged (not masked).

### Failure modes

- Retries beyond K; or the surfaced error is a generic wrapper losing the cause.

### Restore

`rm -rf $PN_QA_TMP/scenario-4`; `git status` clean.

## Scenario 5 — Project shape read

**What you're proving from the user's seat:** The work was deliverable in reviewable pieces — a maintainer can review the contract, the runtime change, and the adapter opt-in independently.

**Covers:** AC-7

**Isolation:** `read-only`

**Oracle:** the project plan + the delivered PR sequence.

**Preconditions:** none.

### Steps

1. Read the project plan and the slice PRs.

### What you should see

- Sequenced slices (contract → runtime → adapter opt-in) with explicit hand-offs; each is one reviewable PR.

### Failure modes

- One monolithic PR; or slices with circular/implicit hand-offs.

## Scenario 6 — Exploratory: backoff + error-class edges

**Charter.** Explore the policy with unusual backoff schedules (zero delay, very long delay) and ambiguous error classes (an error that's borderline retryable) for 30 minutes. Discover where the retryable-predicate or backoff behaves surprisingly.

**Covers:** (no specific AC; surfaces unknowns)

**Time budget:** 30 minutes.

**Notes capture:** Log any error class whose retryability is ambiguous or any backoff edge that behaves unexpectedly.

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC-1 | "A contract type exists" is a type/code-review observation; CI compiles it. |
| AC-5 | "An adapter opted in" is verified structurally by its tests in CI. |
| AC-6 | Non-goals are absence-of-feature; code review confirms nothing extra shipped. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC-1 | (CI / code review) |
| AC-2 | 1 |
| AC-3 | 2, 4 |
| AC-4 | 3 |
| AC-5 | (CI / code review) |
| AC-6 | (code review) |
| AC-7 | 5 |
