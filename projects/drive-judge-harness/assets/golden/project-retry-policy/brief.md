# Brief — configurable retry policy for the adapter runtime

Transient failures (a dropped connection, a momentary timeout) currently surface straight to the caller. We want the adapter runtime to support a **configurable retry policy** so an adapter can opt into retrying transient, idempotent operations with backoff.

Desired end state:

- A **retry-policy contract**: a small, target-agnostic description of retry behaviour (max attempts, backoff schedule, and a predicate for "is this error retryable?"). It must default to **no retries** (opt-in only).
- The **runtime honours the policy**: when a policy is configured, retryable failures are retried per the policy; non-retryable failures and exhausted retries propagate unchanged. Retries must never apply to non-idempotent operations.
- **An adapter opts in**: one adapter wires a sensible default policy for its transient error classes, demonstrating the contract end-to-end.

Non-goals: a global/cross-request circuit breaker; per-statement retry overrides; changing the default behaviour of adapters that don't opt in.

This is bigger than one PR — it has a contract, a runtime change, and a consumer migration that each want their own review. Shape it as a project with sequenced slices.
