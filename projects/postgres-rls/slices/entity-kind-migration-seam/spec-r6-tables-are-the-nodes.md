# Slice 1.5 — Round 6: the schema-IR tables ARE the diff-tree nodes

Prescriptive spec. Tests before implementation. No ambiguity.

## The model (read this until it's obvious)

The schema IR is **already a tree of nodes**: `PostgresSchemaIR` (root) → its
tables → (columns, etc.). The table-IR instances in `PostgresSchemaIR.tables`
are **already** the nodes. This PR's only real addition was the `DiffableNode`
interface (`id` / `isEqualTo` / `children`) to make that existing tree walkable.

Round 4–5 got this wrong: it **synthesized a parallel `tableNodes` list by
grouping policies**, sitting next to the real `tables`. That is the bug. There is
nothing to synthesize, collect, or group. **Make the real table the node and hang
policies on it.** Delete the parallel apparatus.

## A. A Postgres table IR that is the node

The family `SqlTableIR` can't carry Postgres RLS policies (layering). So Postgres
gets its own table type.

New `PostgresTableIR` (new file `packages/3-targets/3-targets/postgres/src/core/postgres-table-ir.ts`):
- `extends SqlTableIR implements DiffableNode`.
- Adds one field: `readonly rlsPolicies: readonly PostgresRlsPolicy[]` (the policies **on this table**).
- `get id(): string` → `this.name`.
- `isEqualTo(_other): boolean` → `true` (columns are still diffed by the legacy relational path this round; the table node exposes only policies as diffable children for now).
- `children(): readonly DiffableNode[]` → `this.rlsPolicies`.
- Constructor takes `SqlTableIRInput & { rlsPolicies?: readonly PostgresRlsPolicy[] }`; calls `super(input)`; sets `rlsPolicies` (default `[]`); `freezeNode(this)` consistent with the sibling IR classes. Follow `SqlTableIR`'s own normalization pattern.
- Export a guard `isPostgresTableIR(node): node is PostgresTableIR`.

## B. `PostgresSchemaIR` holds Postgres tables; tables are its children

- `PostgresSchemaIRInput.tables` and the field become `Record<string, PostgresTableIR | (SqlTableIRInput & { rlsPolicies?: … })>` / `Readonly<Record<string, PostgresTableIR>>`. The constructor normalizes each entry to a `PostgresTableIR` (like it already normalizes `SqlTableIR`).
- **Delete** the `tableNodes` field entirely.
- `children(): readonly DiffableNode[]` → `Object.values(this.tables)`. (Was `this.tableNodes`.)
- `id` stays `this.pgSchemaName`; `isEqualTo` stays `true`.
- `rlsPolicies` getter (kept for ownership consumers) → `Object.values(this.tables).flatMap((t) => t.rlsPolicies)`.
- Typing: `PostgresTableIR extends SqlTableIR`, so `Record<string, PostgresTableIR>` satisfies any base/family code that reads `tables` as `Record<string, SqlTableIR>` (covariant, readonly). If the base class declares `tables` and the override widens incompatibly, fix the declaration; do not cast.

## C. Projection attaches policies to their table (no collect/group)

The projections already build the tables. They just hang each policy on its table.

- `contract-to-postgres-schema-ir.ts`: after the family `contractToSchemaIR` yields the relational tables, build each `PostgresTableIR` from that table plus the policies whose `tableName` matches it. Resolve the DDL schema name **once per namespace** (not per policy), via `resolveDdlSchemaForNamespaceStorage`, and stamp it on the policies as they're attached. A policy whose table is absent from `tables` is a contract error — assert (don't silently drop).
- `control-adapter.ts` introspection (the three `new PostgresSchemaIR` sites, incl. the multi-schema merge): build `PostgresTableIR`s with their policies attached, the same way. Each per-schema IR already has its tables and its policies; attach by `tableName`. The merge concatenates tables across schemas (keys are schema-qualified or per-schema already — preserve current behaviour).
- **Delete** `collect-contract-postgres-nodes.ts`'s `collectContractRlsPolicies` and `collectContractRlsTableNodes`. Fold the per-table policy attachment + per-namespace schema resolution into the projection. `collectContractRoles` either moves to the projection too or stays as the sole remaining helper — but the file's "collect"/RLS-specific framing must go; if only roles remain, name it for projecting Postgres role nodes, or inline it.

## D. Delete the synthetic apparatus

- Delete `postgres-table-node.ts` (`PostgresTableNode`, `PostgresTableNodeInput`, `isPostgresTableNode`, `groupPoliciesIntoTableNodes`).
- Remove their exports from `exports/types.ts` / `exports/planner.ts`; add `PostgresTableIR` / `isPostgresTableIR` where a guard is needed.
- `diff-postgres-schema.ts`: unchanged in spirit — total diff + whitelist `isPostgresRlsPolicy(i.expected ?? i.actual)` (drops table + root issues) + message remap. The whitelist already keys on the policy, so table nodes being real `PostgresTableIR`s changes nothing there. `dropUnownedExtraPolicyIssues` and the caller wiring stay.
- Ownership owned-set in the callers reads `expected.rlsPolicies` (now the getter over tables) ∪ `existingSchemas` — unchanged shape.

## E. Naming fallout (the RLS-specific comments)

With this change the RLS-named projection apparatus is gone: no `PostgresTableNode`, no `collectContractRls*`, no `groupPoliciesIntoTableNodes`. The table is a generic table node carrying policies. Confirm no remaining symbol names a table node "RLS".

## Tests (write first)

- New `postgres-table-ir.test.ts`: `PostgresTableIR.id` = name; `children()` = its policies; `isEqualTo` true; carries columns from `SqlTableIR`.
- `diff-postgres-schema.test.ts`: rebuild fixtures so the actual/expected IRs hold `PostgresTableIR` tables with policies attached (no `groupPoliciesIntoTableNodes`, no `tableNodes`). The existing behaviours must hold: same-wire-name-on-two-tables no collision; initial-migration policy-missing issues with paths `[schema, table, policyWireName]`; multi-schema normalization (unbound→public) pairs; ownership at the caller; `policy "name" on "schema"."table"` message.
- `rls-diffable-nodes.test.ts`: replace `PostgresTableNode`/`groupPoliciesIntoTableNodes` coverage with `PostgresTableIR`.
- Update every fixture/test that referenced `tableNodes` / `groupPoliciesIntoTableNodes` / `PostgresTableNode` (pgvector, adapter-postgres planner tests, runner-fixtures, the cross-package integration test).
- Planner/integration: `migration plan` still emits `CREATE POLICY` + `ENABLE RLS`.

## Acceptance criteria

- AC-1 `PostgresSchemaIR.tables` are `PostgresTableIR` and ARE the diff-tree table nodes; `children()` returns `Object.values(this.tables)`. No `tableNodes` field anywhere.
- AC-2 Policies live on their `PostgresTableIR.rlsPolicies`; attached by the projection; no flat schema-level policy list except the derived `rlsPolicies` getter.
- AC-3 `postgres-table-node.ts` and `collect-contract-postgres-nodes.ts`'s collect/group functions are deleted; no `groupPoliciesIntoTableNodes` / `PostgresTableNode` references remain.
- AC-4 Per-namespace schema resolution happens once per namespace, in the projection.
- AC-5 No symbol names a table node "RLS".
- AC-6 `migration plan` emits `CREATE POLICY` + `ENABLE RLS`; all prior diff behaviours preserved.
- Gates: full set including `turbo run lint` (biome), `check:upgrade-coverage`, fixtures, all suites — green.
