# Dispatch D4 — PSL `policy_select` authoring (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 4 of 7. Implementer tier: sonnet. Builds on D1 (clean substrate). Independent of D2/D3. **Sized tight per L2** — authoring + lowering + unit/round-trip tests only; **no PGlite integration test** (that's D7). If you near your budget, commit what compiles and report what remains.

## Task

Let a developer author one `policy_select` PSL block that lowers to a `PostgresRlsPolicy`. Authoritative detail: **slice spec §6-G**.

Add a `pslBlockDescriptors.policy_select` contribution to the Postgres pack's authoring contributions (`packages/3-targets/3-targets/postgres/src/core/authoring.ts` — the pack has `entityTypes` but **no** `pslBlockDescriptors` yet). **Mirror the landed fixture** `packages/1-framework/2-authoring/psl-printer/test/fixtures/declarative-policy-select-extension.ts` (read it first — it shows the descriptor + the lowering factory end-to-end). Descriptor:
- `keyword: 'policy_select'`, `discriminator: 'postgres-rls-policy'`, `name: { required: true }`.
- parameters: `target: { kind:'ref', refKind:'model', scope:'same-namespace', required:true }`; `roles: { kind:'list', of:{ kind:'ref', refKind:'role', scope:'same-namespace' } }` (**same-namespace** — cross-space is slice 4); `using: { kind:'value', codecId:<the text codec id the fixture/Postgres pack uses — confirm>, required:true }`.

Lowering — the block produces a `PostgresRlsPolicy` with: `operation: 'select'`; `permissive: true`; `tableName` = the `target` model's table; `roles` = resolved same-namespace role names (sorted); `using` = the predicate text; `prefix` = the block's `name`; the full content-hash wire `name` computed via `computeContentHash` (`postgres/src/core/rls/canonicalize.ts`); and **`namespaceId` set to the block's enclosing namespace** (NOT the `UNBOUND_NAMESPACE_ID` default — D2 carry-forward; the block lives inside `namespace <id> { … }`, so the id is known at lowering). It lands in `entries.rlsPolicy[name]`.

Confirm descriptors are collected via `descriptor.authoring.pslBlockDescriptors` (research: `control-stack.ts:188-205`).

## Scope

**In:** the `policy_select` descriptor + its lowering to `PostgresRlsPolicy` + a parse→lower test + a serializer round-trip test. **Out:** the other operations (`policy_insert/update/delete/all`), TS authoring, `ref()` helper, diagnostics — slice 2. The contract→expected-nodes reader (spec §6-E) — deferred to D5 (where the diff consumes it). No planner/verify/PGlite here.

## Completed when

- [ ] A PSL contract with `namespace public { model profile … ; role app_user ; policy_select p_read { target = profile; roles = [app_user]; using = "owner_id = current_setting('app.uid')::int" } }` parses and lowers to a `PostgresRlsPolicy` in `entries.rlsPolicy` with: `operation:'select'`, `permissive:true`, `namespaceId:'public'`, `tableName` = profile's table, `roles:['app_user']`, the content-hash wire `name`, and `prefix:'p_read'`.
- [ ] That contract round-trips through `PostgresContractSerializer` (serialize → deserialize) preserving the policy (foundation already supports the `rlsPolicy` slot).
- [ ] Gates (run once): target-postgres package typecheck; the new parse→lower + round-trip tests; `pnpm lint:deps`.

## Standing instruction

Tests-first. Stay on goal: `policy_select` only, same-namespace roles. If the landed substrate can't lower the block to `PostgresRlsPolicy` as the fixture shows, **halt and surface** (it'd mean the substrate isn't as landed as believed).

## Halt conditions

- The PSL-block substrate can't carry the `policy_select` descriptor → `PostgresRlsPolicy` lowering per the fixture — surface.
- No suitable text codec id for `using` — surface.
- Lowering can't access the enclosing namespace id to set `namespaceId` — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push. Commit your own work; if low on budget, commit what compiles + report remaining.

## References

- **Authoritative:** slice spec §6-G; the landed fixture `declarative-policy-select-extension.ts` (the template); content-hash ADR for the wire name.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — one descriptor + lowering + two unit tests, mirroring a landed fixture.
- **Time-box:** ~45 min. Overrun → halt and surface.
