# Plan — SQL cast policy

**Spec:** [`spec.md`](./spec.md) · **ADR:** [`adrs/205-sql-cast-policy.md`](./adrs/205-sql-cast-policy.md)

## Milestones

### M1 — Adapter receives codec lookup

- [ ] Add `codecLookup: CodecLookup` to `PostgresAdapterOptions` and to `PostgresControlAdapter`'s constructor; default to a postgres-builtins-only lookup when omitted.
- [ ] Thread `stack.codecLookup` into both runtime and control descriptors' `create(stack)` paths.
- [ ] Update `renderLoweredSql` signature to accept a `codecLookup` and thread it through internal helpers.
- [ ] Existing tests pass with the new threading; no behavioural change yet.

### M2 — Inferrable-types vocabulary + cast policy

- [ ] **Pre-flip wiring fix (added during M1 R1 review).** Ensure the runtime-plane codec lookup actually contains `pg/vector@1`. M1 derives the runtime lookup from the SQL component descriptors, but `pgvectorRuntimeDescriptor` (in `packages/3-extensions/pgvector/src/exports/runtime.ts`) currently exposes `pg/vector@1` only via its `codecs()` `CodecRegistry`, not via `types.codecTypes.codecInstances`, so `extractCodecLookup` doesn't see it. Fix one of:
    - extend `pgvectorRuntimeDescriptor` with `types: { codecTypes: { codecInstances: Object.values(codecDefinitions).map(d => d.codec) } }` (mirroring `pgvectorPackMeta`); or
    - have the runtime descriptor in `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts` build the lookup by iterating each extension descriptor's `codecs()` registry instead of using `extractCodecLookup`.
    Pick the option with smaller blast radius; the adapter must remain unaware of the pgvector package by name.
- [ ] Add `POSTGRES_INFERRABLE_NATIVE_TYPES` set in `sql-renderer.ts`. **Use the codec metadata's actual `nativeType` spellings** — i.e. the values present in `meta.db.sql.postgres.nativeType` on disk (`'integer'`, `'boolean'`, `'timestamp with time zone'`, `'time'`, `'timestamp'`, `'timestamp without time zone'`, `'real'`, `'double precision'`, `'smallint'`, `'bigint'`, `'numeric'`, `'text'`, `'character'`, `'character varying'`, `'bit'`, `'bit varying'`, `'interval'`). The ADR's example set uses `udt_name`-style abbreviations (`int4`, `bool`, `timestamptz`, …) for readability; the implementation must match the **runtime values** so the lookup-based policy actually fires.
- [ ] Replace `getCodecParamCast` switch: lookup codec → read `meta.db.sql.postgres.nativeType` → cast iff outside the set.
- [ ] Delete `VECTOR_CODEC_ID`, `getCodecParamCast`, and now-unused `PG_JSON_CODEC_ID` / `PG_JSONB_CODEC_ID` imports from the renderer.
- [ ] Drop the `_codecLookup` underscore in `renderTypedParam` (the parameter is now used).
- [ ] Add unit tests covering:
    - Codec with `nativeType: 'foo'` (not in set) → `$1::foo`.
    - Codec with `nativeType: 'integer'` (in set) → `$1`.
    - Codec with no `nativeType` → `$1`.
    - Extension codec routed via stack-derived lookup → cast applied (covers the wiring fix above).
- [ ] Run pgvector + JSON + JSONB integration / e2e suites; confirm byte-identical SQL.
- [ ] `pnpm lint:deps`.

## Close-out (required)

- [ ] Verify all acceptance criteria in `spec.md`.
- [ ] Move ADR draft into `docs/architecture docs/adrs/ADR 205 — SQL cast emission is adapter policy.md`.
- [ ] Strip repo-wide references to `projects/sql-cast-policy/**` (replace with the canonical ADR link or remove).
- [ ] Delete `projects/sql-cast-policy/`.
