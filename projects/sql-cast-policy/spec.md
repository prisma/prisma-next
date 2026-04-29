# Summary

Replace the hardcoded codec-ID switch in the Postgres SQL renderer (`getCodecParamCast`) with adapter-level cast policy driven by each codec's existing `nativeType` metadata. Closes Linear [TML-2310](https://linear.app/prisma-company/issue/TML-2310).

# Description

`packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts` decides whether to emit `$N::<type>` by hardcoding a switch over three codec IDs (`pg/vector@1`, `pg/json@1`, `pg/jsonb@1`). One of those (`pg/vector@1`) is owned by `@prisma-next/extension-pgvector`, inverting the dependency between core adapter and extension package.

The fix is to read codec metadata that already exists (`meta.db.sql.postgres.nativeType`) and let the adapter decide policy via an inferrable-types allow-list. Architectural rationale lives in [ADR 205](./adrs/205-sql-cast-policy.md).

# Requirements

## Functional

- The Postgres SQL renderer reads `nativeType` from the codec lookup carried on the assembled stack (`stack.codecLookup`) and emits `$N::<nativeType>` only for codecs whose `nativeType` is **not** in the adapter's inferrable set.
- The inferrable set covers the standard scalar Postgres types (numeric, boolean, string, temporal, bit). `json`, `jsonb`, and any extension-supplied or unknown type fall outside it.
- Both `PostgresControlAdapter` and `PostgresAdapterImpl` receive the codec lookup at construction time via `descriptor.create(stack)`. The shared `renderLoweredSql` is the only call site that decides cast emission.
- A bare-factory `createPostgresAdapter()` (no stack) defaults to a built-in lookup over postgres-builtin codec definitions so JSON/JSONB casts still emit in tests that don't compose a stack.
- The hardcoded switch (`getCodecParamCast`, `VECTOR_CODEC_ID`) and any now-unused `PG_JSON_CODEC_ID`/`PG_JSONB_CODEC_ID` imports in the renderer are removed.

## Non-functional

- Lowered SQL for `pg/json@1`, `pg/jsonb@1`, `pg/vector@1`, and previously-uncast builtins is byte-identical to the pre-change output.
- `pnpm lint:deps` passes with no new core-imports-extension violations.
- No new public API surface in `@prisma-next/sql-relational-core` or `@prisma-next/framework-components`.

## Non-goals

- Richer cast shapes (array, parameterised, per-context). See ADR 205 § Out of scope.
- MySQL / SQLite / Mongo adapter changes.
- Renaming `nativeType` or any other codec field.
- Driver-level OID specification.

# Acceptance Criteria

- [ ] `rg "VECTOR_CODEC_ID|getCodecParamCast" packages/3-targets/6-adapters/postgres/src/` returns no matches.
- [ ] Existing pgvector, JSON, and JSONB integration / e2e suites produce byte-identical SQL to `main`.
- [ ] A new unit test confirms a codec with `meta.db.sql.postgres.nativeType: 'foo'` (not in the inferrable set) produces `$N::foo` in lowered SQL.
- [ ] A new unit test confirms a codec with an inferrable `nativeType` (e.g. `int4`) produces `$N` with no cast.
- [ ] A new unit test confirms a custom-registered extension codec routed through `stack.codecLookup` produces the expected cast.
- [ ] `pnpm lint:deps` passes.
- [ ] ADR 205 is migrated into `docs/architecture docs/adrs/` at close-out.

# References

- Linear: [TML-2310](https://linear.app/prisma-company/issue/TML-2310)
- Dependency: [TML-2301](https://linear.app/prisma-company/issue/TML-2301) (landed)
- ADR draft: [`adrs/205-sql-cast-policy.md`](./adrs/205-sql-cast-policy.md)
- Implementation pivots:
    - `packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts`
    - `packages/3-targets/6-adapters/postgres/src/core/adapter.ts`
    - `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`
    - `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`
    - `packages/3-targets/6-adapters/postgres/src/exports/control.ts`

# Open Questions

None — design settled in ADR 205.
