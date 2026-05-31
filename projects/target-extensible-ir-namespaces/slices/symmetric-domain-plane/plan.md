# Slice plan: symmetric domain plane

**Spec:** [`spec.md`](./spec.md)

## Dispatches

### Dispatch 1 — Domain plane substrate

**Outcome.** `Contract` IR, builders, serializer/deserializer, and canonicalization emit and round-trip `domain.namespaces.<ns>.{ models, valueObjects }`. Flat root `models` / `valueObjects` removed from the canonical contract shape. Framework domain type has no `types`. Storage types and emission paths untouched.

**Focus.** Discover foundation/core authoring + IR modules; land types first, then hydration/emission. Selective gates as you touch packages; full `pnpm test:packages` once before handoff.

**Refusal.** Any diff that removes `storage.namespaces` or introduces storage reserved-key lists.

### Dispatch 2 — Consumer migration + fixtures

**Outcome.** All in-repo consumers read domain through `domain.namespaces` (or shared walk helpers). On-disk fixtures regenerated; `pnpm fixtures:check` and integration/e2e green. Upgrade instructions if downstream example/extension *source* changes.

**Builds on.** Dispatch 1 merged in branch (or same branch sequential commits).

**Focus.** Mechanical migration + regeneration scripts; avoid drive-by refactors.

## Review

Opus 4.8-high reviewer; CI owns validation gates. Confirm no storage flatten and no framework `domain.types`.
