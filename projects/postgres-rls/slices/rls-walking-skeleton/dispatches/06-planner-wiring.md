# Dispatch D6 — planner diff-wiring (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 6 of 8. Implementer tier: sonnet. Builds on D2 (differ + diffable nodes), D3 (introspection), D5 (the RLS ops). Proves **AC5**. Commit your own work; if low on budget, commit what compiles + report remaining.

> This is the planner half of spec §6-F, plus the contract→expected-nodes reader (spec §6-E).

## Task

Wire the RLS diff into the Postgres planner so a declared-but-absent policy produces the create ops — driven by the generic differ, **not** `mapIssueToCall`, running alongside the untouched legacy relational planner.

1. **Contract → expected RLS nodes (spec §6-E).** A small Postgres-side helper that reads the contract's `entries.rlsPolicy` and `entries.role` for the planned namespace(s) and returns the `PostgresRlsPolicy[]` / `PostgresRole[]` (mirror how the serializer reads `entries`, `postgres-contract-serializer.ts:121-146`). These are the **expected** nodes.
2. **Actual RLS nodes** come from the introspected schema's `annotations.pg.rlsPolicies` / `.roles` / `.rlsEnabledByTable` (D3).
3. **RLS diff step in the Postgres planner** (`packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` or the `plan()` assembly — confirm where ops are assembled): call the framework `diffNodes(expected, actual)` over policies (and roles, for completeness). For each policy `SchemaDiffIssue` with `outcome:'missing'`, emit a `CreatePostgresRlsPolicyCall`; and for that policy's table, if `annotations.pg.rlsEnabledByTable[table]` is not true, emit one `EnableRowLevelSecurityCall` (dedupe enable per table). **This slice handles `outcome:'missing'` only** — ignore `extra`/`mismatch` (those are slice 3 `verify-plan-breadth`; leave a clear TODO-free no-op, or surface if the differ can't be limited to missing cleanly).
4. **Ordering:** place the RLS calls **after** `CREATE TABLE` using the existing coarse-bucket mechanism (`classifyCall` / the bucket order). Add bucket(s)/priority so `EnableRowLevelSecurity` + `CreatePolicy` land after the table is created. Do **not** build dependency-graph machinery (that's follow-on B).
5. **Side-by-side:** the legacy relational planning (`CREATE TABLE` etc.) runs unchanged; the RLS calls are **added** to the same plan. The RLS path must **not** go through `mapIssueToCall` or produce a framework `SchemaIssue`.

## Scope

**In:** the expected-nodes reader + the RLS diff step + ordering + an op/DDL snapshot test. **Out:** the verify-result channel (D7), the PGlite end-to-end test (D8), `extra`/`mismatch`/rename/tamper (slice 3). SQLite untouched.

## Completed when (proves AC5)

- [ ] An op/DDL snapshot test: given a contract with one table + one `policy_select` (build it via the D4 PSL path or synthetically from the IR) and an **empty** introspected schema, `plan()` (via `createPlanner(controlAdapter).plan({ contract, schema: emptySchema, policy: INIT_ADDITIVE_POLICY, fromContract: null, frameworkComponents, spaceId })` — mirror `cross-namespace-fk.integration.test.ts:113-121`) produces, in order: `CREATE TABLE` (legacy), `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY` (new). Assert the op sequence/labels.
- [ ] The RLS ops come from `diffNodes`-driven dispatch, not `mapIssueToCall` (confirm by code path).
- [ ] Gates (run once): target-postgres typecheck (`pnpm build` first if dist needed); the snapshot test; `pnpm lint:deps`; SQLite planner tests still green (no regression to the legacy path).

## Standing instruction

Tests-first (the snapshot assertion first). Stay on goal: `missing`→create only, coarse ordering, side-by-side. If wiring the RLS diff into the planner forces RLS knowledge into a framework/SQL-family file, **halt and surface** (the differ is generic; the RLS-specific glue lives in the Postgres planner).

## Halt conditions

- The plan-assembly seam can't take an added RLS step without threading RLS through a shared layer — surface.
- Coarse buckets genuinely can't order policies after `CREATE TABLE` without dependency machinery — surface (don't build follow-on B here).
- The differ can't be scoped to `missing`-only cleanly for this slice — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push. Commit your own work.

## References

- **Authoritative:** slice spec §6-F (planner half) + §6-E (reader). Patterns: `cross-namespace-fk.integration.test.ts` (plan call), `issue-planner.ts` `classifyCall`/bucket ordering, the D5 ops (`operations/rls.ts`, the two `*Call` classes).
- Carry-forward: set/keep the policy's real `namespaceId` (D2 note) when building expected nodes from `entries`.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — reader + one planner step + ordering + a snapshot test.
- **Time-box:** ~75 min. Overrun → halt and surface.
