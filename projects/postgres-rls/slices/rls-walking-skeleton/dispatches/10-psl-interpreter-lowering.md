# Dispatch D10 — generic PSL extension-block lowering in the interpreter

Slice `rls-walking-skeleton` (TML-2868), dispatch 10. Implementer tier: sonnet. Operator chose option (a): make PSL→IR lowering real in production. **This closes AC3's lowering half.** Builds on D4 (the `policy_select` descriptor + parse). Commit your own work; **if low on budget, commit what compiles + report remaining** (this spans 2 packages — pace yourself).

## The gap

`interpretPslDocumentToSqlContract` (`packages/2-sql/2-authoring/contract-psl`) parses `policy_select` blocks but does **not** lower them into `contract.entries.rlsPolicy` — it handles models/enums/named-types/relations/value-objects only. Production never turns a parsed extension block into an IR entity; D4/D9 hand-built the policy in-test. Fix it **generically** (any target-contributed extension block, via its registered factory) with **zero RLS knowledge in the interpreter**.

## Task

**Part 1 — generic extension-block lowering pass in the interpreter (no RLS knowledge).** Mirror the enum precedent (`build-contract.ts` ~712-725: `processEnumDeclarations` → `namespaceTypes` → `createNamespace(nsInput, enumTypes)`). Add a generic pass that, per namespace: collects the parsed extension blocks (`namespacePslExtensionBlocks`), and for each block looks up `authoringContributions.entityTypes[block.discriminator]` (the registry is already an interpreter input) and calls its `output.factory(block)` to build the entity, then places it under `entries[descriptor.entrySlotName][name]`. This is **by-discriminator, generic** — the interpreter must not mention `policy`/`rls`/`PostgresRlsPolicy`. Confirm the factory accepts the uniform `PslExtensionBlock` (the landed fixture `declarative-policy-select-extension.ts` shows a factory that does exactly this).

**Part 2 — `createNamespace` / `SqlNamespaceTablesInput` widening (generic).** `SqlNamespaceTablesInput` (`sql-storage.ts` ~21-27) carries `table` + `valueSet`. Widen it generically to carry extension-block-derived entities by entry slot (mirror how `enumTypes` flow as `createNamespace`'s second arg) so the lowered entities reach `entries[kind]`. Family-shared type → **stays generic** (no RLS). Ensure the Postgres `createNamespace` factory places them into `entries.rlsPolicy` the same way the serializer already does (`postgres-contract-serializer.ts` ~218-233) — the interpreter path and serializer path must agree.

**Part 3 — ensure the Postgres `rlsPolicy` factory lowers from a `PslExtensionBlock`.** The block→`PostgresRlsPolicy` mapping (read `parameters` target/roles/using, `operation:'select'`, `permissive:true`, compute the content-hash wire `name`, set `namespaceId` from the enclosing namespace) must live in the Postgres pack's `entityTypes.rlsPolicy.output.factory` (`authoring.ts`) — **move the logic that the D9 test helper `lowerExtensionBlocksToRlsPolicies` currently does into the production factory.** If the factory already does this, just confirm. This is Postgres-side (correct layer).

## Scope

**In:** the generic interpreter pass (Part 1) + the generic namespace-input widening (Part 2) + the Postgres factory lowering (Part 3) + a `contract-psl` (or postgres) **unit test** proving `interpretPslDocumentToSqlContract` lowers a `policy_select` PSL doc into `entries.rlsPolicy` with the correct `PostgresRlsPolicy` (no test-side hand-lowering). **Out:** the e2e re-point (D11); role *authoring* (the policy's `roles` are plain name strings via cross-space pass-through — no `entries.role` needed here; roles-as-entities are slice 4). SQLite/Mongo untouched.

## Completed when (AC3 lowering half, for real)

- [ ] `interpretPslDocumentToSqlContract` on a doc with a `policy_select` block yields `entries.rlsPolicy[name]` = a `PostgresRlsPolicy` with the right fields + content-hash wire name — **produced by the interpreter+factory, not a test helper**. Unit test asserts it.
- [ ] The interpreter pass is generic (grep: no `rls`/`policy`/`PostgresRls` symbol in `packages/2-sql/2-authoring/contract-psl` or in the widened family type).
- [ ] Gates (run once): contract-psl + target-postgres typecheck (`pnpm build` if dist needed); the new unit test; existing contract-psl + postgres tests still green; `pnpm lint:deps`.

## Halt conditions (surface)

- Generic lowering would require RLS/policy knowledge in the interpreter or the family type (it must be by-discriminator-factory, generic) — surface.
- The factory can't accept a `PslExtensionBlock` / the block→entity mapping can't be done via the registered factory generically — surface.
- The `createNamespace` widening can't stay generic (would need a per-kind field) — surface a design question rather than hardcoding `rlsPolicy`.

## Constraints

Explicit-staging, `tml-2868:` prefix, no amend, **no push**. No `any`/bare casts in production (test files exempt). Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt` (foreground build/test).

## References

- **Precedent:** the enum interpreter pass (`build-contract.ts` ~712-725). The factory shape: `declarative-policy-select-extension.ts` (a factory mapping `PslExtensionBlock`→IR). The lowering logic to move into production: the D9 test helper `lowerExtensionBlocksToRlsPolicies` in `rls-walking-skeleton-psl.integration.test.ts`. The serializer's `entries.rlsPolicy` placement: `postgres-contract-serializer.ts` ~218-233.
- Design: `../../specs/design-generic-schema-differ.md`; spec §6-G.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — generic interpreter pass + family-type widening + Postgres factory + unit test. Spans 2 packages; commit-partial if needed.
- **Time-box:** ~75 min. Overrun → commit-partial + report.
