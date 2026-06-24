# Dispatch D5 — RLS op-factory calls (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 5 of 8. Implementer tier: sonnet. Builds on D1 (clean substrate). **Sized small per L2** — the two op-factory calls + factories + unit tests only. **No planner wiring / no diff** (that's D6). Commit your own work; if low on budget, commit what compiles + report remaining.

> Note: spec §6-F covers both the ops (this dispatch) and the planner wiring (D6). This dispatch is **only the ops**.

## Task

Add two Postgres RLS migration ops, mirroring the existing FK op pattern. Read the patterns first: `operations/constraints.ts` (`addForeignKey`, ~109-138) and `op-factory-call.ts` (`AddForeignKeyCall`, ~603-627; the `PostgresOpFactoryCall` union, ~1106).

1. **New file `packages/3-targets/3-targets/postgres/src/core/migrations/operations/rls.ts`** — two pure factories returning `Op` (mirror `addForeignKey`'s precheck/execute/postcheck shape using `step()` + `targetDetails()` from `operations/shared.ts`):
   - `createRlsPolicy(schemaName: string, tableName: string, policy: PostgresRlsPolicy): Op` — `execute: [ step('create policy <name>', <CREATE POLICY DDL>) ]`; render the DDL from the policy: `CREATE POLICY "<wire name>" ON "<schema>"."<table>" AS {PERMISSIVE|RESTRICTIVE} FOR {SELECT|…} TO <roles> USING (<using>) [WITH CHECK (<withCheck>)]`. precheck: policy-absent check (`SELECT 1 FROM pg_policies WHERE schemaname=$1 AND tablename=$2 AND policyname=$3`, expect none); postcheck: policy-present check. `operationClass: 'additive'`.
   - `enableRowLevelSecurity(schemaName: string, tableName: string): Op` — `execute: [ step('enable RLS on <table>', 'ALTER TABLE "<schema>"."<table>" ENABLE ROW LEVEL SECURITY') ]`. precheck/postcheck: read `pg_class.relrowsecurity` for the table (precheck tolerant — enabling an already-enabled table is a no-op; confirm the existing ops' check style). `operationClass: 'additive'`.
2. **Two `*Call` classes in `op-factory-call.ts`** (mirror `AddForeignKeyCall`): `CreatePostgresRlsPolicyCall` (`factoryName: 'createRlsPolicy'`, holds schema/table/policy, `toOp()` → `createRlsPolicy(...)`, `renderTypeScript()`) and `EnableRowLevelSecurityCall` (`factoryName: 'enableRowLevelSecurity'`). Both `extends PostgresOpFactoryCallNode`, `operationClass: 'additive'`, `freeze()` in constructor. Add both to the `PostgresOpFactoryCall` union (~1106).

## Scope

**In:** `operations/rls.ts` + the two `*Call` classes + union registration + unit tests for the two `toOp()` outputs (assert the DDL strings + precheck/postcheck). **Out:** the planner diff step, the contract→expected-nodes reader, any call to `diffNodes`, the snapshot/integration test — all D6. SQLite untouched.

## Completed when

- [ ] `operations/rls.ts` exports the two factories; the two `*Call` classes exist + are in the `PostgresOpFactoryCall` union; `toOp()` returns the correct DDL + prechecks/postchecks; `renderTypeScript()` round-trips the call.
- [ ] Unit tests assert each `toOp()` (DDL execute string + precheck/postcheck) for a representative policy (permissive select, one role, a `using` predicate) and for enable-RLS.
- [ ] Gates (run once): target-postgres typecheck (`pnpm build` first if dist needed); the new unit test; `pnpm lint:deps`.

## Standing instruction

Tests-first. Mirror the FK op pattern exactly; don't invent a new op shape. RLS DDL string-rendering: render the policy faithfully (operation→`FOR <CMD>`, permissive→`AS PERMISSIVE/RESTRICTIVE`, roles→`TO r1, r2`, using/withCheck clauses). Quote identifiers like the existing ops do.

## Halt conditions

- The `Op` / `step` / `targetDetails` shape differs from what `addForeignKey` shows — surface.
- `PostgresRlsPolicy` doesn't carry a field the DDL needs (it has name/prefix/tableName/operation/roles/using?/withCheck?/permissive/namespaceId) — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push. Commit your own work.

## References

- **Authoritative:** slice spec §6-F (the ops half). Patterns: `operations/constraints.ts:addForeignKey` + `op-factory-call.ts:AddForeignKeyCall`.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — two ops mirroring an existing pattern + unit tests. Bounded.
- **Time-box:** ~45 min. Overrun → halt and surface.
