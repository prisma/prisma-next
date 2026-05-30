## Dispatch plan

_Slice: `storage-namespaces-wrapper-drop` (S2 GAP 1, TML-2747). Two dispatches: a surgical substrate change carrying the one design decision, then a mechanical artifact regeneration. Kept apart deliberately — bundling design judgment with mechanical fan-out is a recognised mis-sizing._

### Dispatch 1: Drop the wrapper across the IR substrate

- **Outcome:** The storage plane is emitted in ADR 221's canonical shape — namespace IDs are direct keys under `storage`, `storageHash` is a reserved sibling key, and the literal `namespaces` segment is gone from the IR types, serializer/deserializer, namespace-walk validators, canonicalization, the emitter, and the `elementCoordinates` walk. The in-memory reserved-key typing decision (Open Question 1) is settled and applied without `any`/wide casts. Source typechecks; a focused emit/serialize test confirms a contract round-trips through the wrapper-less shape; the changed packages' own unit tests pass.
- **Builds on:** The slice's chosen design (ADR 221 § grounding example).
- **Hands to:** A wrapper-less IR end to end in source — `pnpm typecheck` green, changed-package unit tests green, the emitter producing `storage.<ns>`. **Committed on-disk fixtures are now stale by design** (their `storageHash` changed); the fixture-diff suites (`fixtures:check`, integration/e2e that load committed contracts) are expected red until Dispatch 2. The reserved-key typing approach is documented in the PR for the reviewer.
- **Focus:** The shape change only. Do **not** touch the `domain` plane, the Postgres default-namespace policy, or runtime qualification. Honour the spec's refusal trigger: if flattening the in-memory type forces a structural rewrite beyond this slice (e.g. a query-builder type rewrite), stop and report rather than expanding scope. Run only the gates relevant to the changed packages at this stage — leave the full-repo fixture/integration sweep to Dispatch 2.

### Dispatch 2: Regenerate all on-disk artifacts and turn every gate green

- **Outcome:** Every committed `contract.json` / `contract.d.ts` (examples, package fixtures, extension contract spaces) and every `storageHash`-pinned migration ref (`migrations/refs/head.json` + per-migration `to`/`from`) is regenerated to the wrapper-less shape. `pnpm fixtures:check` is clean; `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, and `pnpm lint:deps` are green. The slice-DoD grep gate returns zero `storage.namespaces` wrapper paths in both artifacts and source.
- **Builds on:** Dispatch 1's wrapper-less emitter + settled typing.
- **Hands to:** Slice-DoD met — PR ready for review.
- **Focus:** Mechanical regeneration + fallout repair. Prefer `pnpm fixtures:emit` / `pnpm fixtures:check`; the per-extension migration regen is known not to chain automatically (TML-2698), so regenerate extension migration metadata explicitly where `fixtures:check` surfaces drift. Any non-mechanical fallout (a test asserting the old shape that needs its *intent* re-expressed, not just its bytes) is in scope only insofar as it's the wrapper drop; a deeper behavioural surprise is a refusal-and-report.
