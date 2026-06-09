# Slice `rls-walking-skeleton` — dispatch plan

Parent: [`spec.md`](spec.md) · project [`plan.md`](../../plan.md) · design [`../../specs/design-generic-schema-differ.md`](../../specs/design-generic-schema-differ.md). Linear [TML-2868](https://linear.app/prisma-company/issue/TML-2868).

Seven dispatches. The spec (§6 A–I) is the authoritative detail; each dispatch below points at its spec component(s). Implementer tier **sonnet**; reviewer **opus**. Every dispatch ends on the always-run gates (`pnpm typecheck` post-build + scoped `pnpm lint`) plus the dispatch-specific gates named. **Checkpoint with the operator after D1** before D2 builds on the cleaned substrate.

Sequence (single implementer, no-resume harness → sequential): **D1 → D2 → D3 → D4 → D5 → D6 → D7.** D4 is independent of D2/D3 (authoring only) but is sequenced here for simplicity.

### D1 — Un-leak (spec §6-A) · **checkpoint after**
- **Outcome:** every leak from the prior foundation removed/relocated per spec §6-A's file:line manifest — framework `SchemaIssue` RLS members + exports, SQL-family classify cases, SQLite/Postgres planner narrowing guards, `StorageTable.rls`/`RlsMode` + re-exports + `StorageTableSchema.rls`; Postgres entity validators relocated from SQL-core `validators.ts` into the Postgres target's `entityTypes` fragment channel. Foundation IR classes + serializer + content-hash kept.
- **Gates:** workspace `pnpm typecheck` post-build; `pnpm lint:deps`; `grep` for `rls`/`RlsMode`/`rls_policy_` over `packages/1-framework` + `packages/2-sql` returns nothing; kept foundation tests still pass; SQLite + Mongo suites green.
- **Builds on:** nothing. **Hands to:** a clean substrate for D2.

### D2 — Generic differ + `DiffableNode` (spec §6-B, §6-C)
- **Outcome:** framework `SchemaDiffIssue` + `DiffableNode` + `diffNodes()` (RLS-agnostic, exported from the control entrypoint, unit-tested missing/extra/mismatch/clean); `PostgresRlsPolicy`/`PostgresRole` implement `DiffableNode` (`identity()` → `EntityCoordinate`, `isEqualTo()` → wire-name/name equality), unit-tested.
- **Gates:** new framework unit test + Postgres node unit test; package typecheck; `pnpm lint:deps`.
- **Builds on:** D1. **Hands to:** the differ + diffable nodes that D3/D5/D6 consume.

### D3 — RLS introspection (spec §6-D)
- **Outcome:** `PostgresControlAdapter.introspect` reads `pg_policies`/`pg_roles`/`pg_class.relrowsecurity` into `PostgresRlsPolicy`/`PostgresRole` (wire names **recomputed** via `computeContentHash`) + a per-table RLS-enabled map, stashed under `annotations.pg` (no slots added to family `SqlSchemaIR`).
- **Gates:** PGlite introspection test (manually `CREATE POLICY`, then introspect, assert the recomputed node); package test; `pnpm lint:deps`.
- **Builds on:** D2. **Hands to:** the "actual" RLS nodes for D5/D6.

### D4 — PSL `policy_select` authoring (spec §6-G, §6-E)
- **Outcome:** Postgres pack contributes a `pslBlockDescriptor` `policy_select` (mirror the landed `declarative-policy-select-extension` fixture; same-namespace roles) lowering to `PostgresRlsPolicy` (`operation:'select'`, `permissive:true`, content-hash wire name); a small contract→expected-nodes reader (E). Round-trips through the serializer.
- **Gates:** parse→lower test (block → `PostgresRlsPolicy` in `entries.rlsPolicy`); serializer round-trip; package test; `pnpm lint:deps`.
- **Builds on:** D1. **Hands to:** the authored contract for D7.

### D5 — Per-node planner ops + wiring (spec §6-F)
- **Outcome:** `operations/rls.ts` (`createRlsPolicy`, `enableRowLevelSecurity`, mirror `addForeignKey`); `CreatePostgresRlsPolicyCall` + `EnableRowLevelSecurityCall` (mirror `AddForeignKeyCall`, registered in the `PostgresOpFactoryCall` union); an RLS diff step in the Postgres planner that runs `diffNodes` (expected vs introspected) and maps `missing` policy → `CreatePostgresRlsPolicyCall` (+ `EnableRowLevelSecurityCall` when the table's RLS is off), placed after `CREATE TABLE` via the coarse buckets. Not via `mapIssueToCall`.
- **Gates:** op/DDL snapshot test (contract+policy vs empty schema → `CREATE TABLE` + `ENABLE RLS` + `CREATE POLICY`); package test; `pnpm lint:deps`.
- **Builds on:** D2, D3. **Hands to:** the emit half for D7.

### D6 — Verify extension channel (spec §6-H)
- **Outcome:** generic `extensionIssues: readonly SchemaDiffIssue[]` channel on the verify result; a generic target hook by which the Postgres verifier contributes RLS diff issues (expected vs introspected via `diffNodes`) into it — framework/SQL-family stay RLS-agnostic.
- **Gates:** PGlite verify test (declared+applied → empty; declared-not-applied → one `missing`); package test; `pnpm lint:deps`.
- **Builds on:** D2, D3. **Hands to:** the verify half for D7.

### D7 — Walking-skeleton integration test (spec §6-I)
- **Outcome:** the end-to-end PGlite test (mirror `cross-namespace-fk.integration.test.ts`, `execArgv ['--no-memory-protection-keys']`): author via PSL → plan (`CREATE TABLE` + `ENABLE RLS` + `CREATE POLICY`) → apply → pre-created role + `SET ROLE` + `set_config` → **only the owner's row returns** → re-verify clean.
- **Gates:** the integration test passes in CI; `pnpm fixtures:check` clean; SQLite + Mongo green.
- **Builds on:** D4, D5, D6, D3. **Hands to:** slice DoD (AC6, the spine).

## Carry-forward / risks
- **Halt cruxes** (spec §8): the generic verify hook must not force RLS into family/framework; `annotations.pg` must be a viable carrier; coarse buckets must order policies after tables. Any of these failing → surface, don't improvise.
- **Trace note:** `trace.jsonl` already carries the prior foundation slice's 4 dispatches; at slice close run `verify.ts` with `--expect-dispatches` set to the cumulative count (4 + 7 = 11) or filter — resolve at close, not mid-loop.
