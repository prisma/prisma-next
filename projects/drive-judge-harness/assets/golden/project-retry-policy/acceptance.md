# Acceptance set — project-retry-policy

## Expected triage verdict

`new-project`. The work has three reviewable units that stack — a contract, a runtime change that consumes it, and an adapter migration that demonstrates it — each wanting its own review and rollback boundary. A correct run produces a **project spec + project plan** and decomposes into sequenced slices (the natural shape: contract slice → runtime-wiring slice → adapter opt-in slice). Collapsing it into one PR is a mis-shape; so is treating it as a direct change.

## Expected outcome / requirements

- **AC-1** — A retry-policy contract exists: max attempts, a backoff schedule, and a retryable-error predicate, expressed target-agnostically.
- **AC-2** — The default is **no retries**; behaviour for adapters that don't opt in is unchanged.
- **AC-3** — The runtime retries retryable failures per the policy and propagates non-retryable failures and exhausted-retry failures unchanged.
- **AC-4** — Retries never apply to non-idempotent operations.
- **AC-5** — Exactly one adapter opts in with a default policy for its transient error classes, exercising the contract end-to-end.
- **AC-6** — The non-goals are respected (no circuit breaker, no per-statement override, no change to non-opted-in adapters).
- **AC-7** — Each slice is one reviewable PR with its own tests; the project plan sequences them with explicit hand-offs.

## Correctness oracle

- **Mechanical:** each slice's PR is CI-green (`pnpm typecheck` / `test` / `lint`); the retry behaviour is covered by tests (retryable retried, non-retryable not, exhaustion propagates, non-idempotent never retried).
- **Requirements:** AC-1…AC-7 across the slices.
- **Intent:** the retry policy is a clean, opt-in, target-agnostic contract — not a behaviour silently imposed on all adapters. The strongest design signal is AC-2 + AC-4: a correct run makes retries an explicit, idempotency-guarded opt-in (consistent with the repo's "explicit opt-in over noisy diagnostics" philosophy), not a default that surprises callers.

## Failure modes a correct run avoids

- Retrying by default (surprising blast radius; violates AC-2).
- Retrying non-idempotent operations (correctness hazard; violates AC-4).
- Branching on target (`if (target === 'postgres')`) instead of an adapter-level opt-in.
- Shipping the whole thing as one un-stackable PR, or as a direct change.
- Scope creep into a circuit breaker or per-statement overrides (violates AC-6).
