# Dispatch D3 — RLS introspection (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 3 of 7. Implementer tier: sonnet. Builds on D2 (`f8643dc84` — diffable nodes).

## Task

Make `PostgresControlAdapter.introspect` read the live database's RLS state into the canonical Postgres IR nodes. Authoritative detail: **slice spec §6-D**.

In `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`, extend `introspectSchema` (~660; confirm by grep) with three catalog reads, mirroring the existing `information_schema`/`pg_catalog` query pattern (`driver.query<RowShape>(sql, params)`):
- **`pg_policies`** (schemaname, tablename, policyname, cmd, roles, qual, with_check, permissive) → build `PostgresRlsPolicy` instances. **Recompute the wire name**: normalize `qual`/`with_check` via `normalizePredicate` + `computeContentHash` (`postgres/src/core/rls/canonicalize.ts`), map `cmd` → `operation`, `roles` → sorted role names, `permissive` → boolean. **Set the policy's `namespaceId` from `pg_policies.schemaname`** (the real namespace — NOT the `UNBOUND_NAMESPACE_ID` default; see § Carry-forward). Set `tableName` from `pg_policies.tablename`. For `prefix`, derive from the catalog `policyname` per the content-hash ADR (the prefix is the policyname minus its `_<8hex>` suffix) — confirm the ADR's convention.
- **`pg_roles`** (rolname) → `PostgresRole` instances; filter out system roles (e.g. exclude `pg_*` and the bootstrap superuser — pick a sane filter and note it).
- **`pg_class.relrowsecurity`** joined to the schema's tables → a per-table `boolean` RLS-enabled map.

**Stash** these on the introspection output under `annotations.pg` (mirror how `storageTypes` is stashed, ~1103-1112): `annotations.pg.rlsPolicies`, `annotations.pg.roles`, `annotations.pg.rlsEnabledByTable`. **Do NOT** add policy/role slots to the family-shared `SqlSchemaIR`.

## Scope

**In:** the three catalog reads + building the nodes + stashing under `annotations.pg`. **Out:** the diff (D5/D6 call `diffNodes`), the planner (D5), verify wiring (D6), PSL (D4). Do not call `diffNodes` here.

## Completed when

- [ ] `introspect()` against a PGlite DB with a manually-created policy returns that policy as a `PostgresRlsPolicy` under `annotations.pg.rlsPolicies`, with a **recomputed wire name** equal to what the contract would produce for the same body, and `namespaceId` set to the policy's schema (not the default).
- [ ] Roles + per-table RLS-enabled map present under `annotations.pg`. Family `SqlSchemaIR` shape unchanged (no new slots).
- [ ] Gates (run once): package typecheck for the postgres adapter; a PGlite introspection test (manually `CREATE POLICY` + `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, then introspect, assert the node + recomputed name + the enabled map); `pnpm lint:deps`.

## Carry-forward from D2 review (must honor)

`PostgresRlsPolicy.identity()` keys on `namespaceId`. The constructor defaults it to `UNBOUND_NAMESPACE_ID` — **introspection must override it with the policy's real namespace** (`pg_policies.schemaname`), or multi-namespace diffs would alias same-wire-name policies across schemas.

## Standing instruction

Tests-first (write the PGlite introspection assertion first). Stay on goal: introspection only. If `annotations.pg` is typed closed / can't carry these, **halt and surface** (do not add slots to `SqlSchemaIR`).

## Halt conditions

- `annotations.pg` cannot carry the RLS data (typed closed) — surface.
- Recomputing the wire name from the introspected body needs something `canonicalize.ts` doesn't provide — surface.
- The prefix can't be derived from the catalog `policyname` per the ADR — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push.

## References

- **Authoritative:** slice spec §6-D; content-hash ADR `../../../specs/adr-content-addressed-policy-names.md` (prefix/suffix convention).
- Pattern to mirror: `control-adapter.ts:introspectSchema` (existing catalog reads) + the `storageTypes` stash.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — bounded: three catalog reads mirroring existing queries + node construction + a PGlite test.
- **Time-box:** ~60 min. Overrun → halt and surface.
