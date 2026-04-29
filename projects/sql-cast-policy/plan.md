# Plan — SQL cast policy

**Spec:** [`spec.md`](./spec.md) · **ADR:** [`adrs/205-sql-cast-policy.md`](./adrs/205-sql-cast-policy.md)

## Milestones

### M1 — Adapter receives codec lookup

- [ ] Add `codecLookup: CodecLookup` to `PostgresAdapterOptions` and to `PostgresControlAdapter`'s constructor; default to a postgres-builtins-only lookup when omitted.
- [ ] Thread `stack.codecLookup` into both runtime and control descriptors' `create(stack)` paths.
- [ ] Update `renderLoweredSql` signature to accept a `codecLookup` and thread it through internal helpers.
- [ ] Existing tests pass with the new threading; no behavioural change yet.

### M2 — Inferrable-types vocabulary + cast policy

- [ ] Add `POSTGRES_INFERRABLE_NATIVE_TYPES` set in `sql-renderer.ts`.
- [ ] Replace `getCodecParamCast` switch: lookup codec → read `nativeType` → cast iff outside the set.
- [ ] Delete `VECTOR_CODEC_ID`, `getCodecParamCast`, and now-unused `PG_JSON_CODEC_ID` / `PG_JSONB_CODEC_ID` imports from the renderer.
- [ ] Add unit tests covering:
    - Codec with `nativeType: 'foo'` (not in set) → `$1::foo`.
    - Codec with `nativeType: 'int4'` (in set) → `$1`.
    - Codec with no `nativeType` → `$1`.
    - Extension codec routed via `stack.codecLookup` → cast applied.
- [ ] Run pgvector + JSON + JSONB integration / e2e suites; confirm byte-identical SQL.
- [ ] `pnpm lint:deps`.

## Close-out (required)

- [ ] Verify all acceptance criteria in `spec.md`.
- [ ] Move ADR draft into `docs/architecture docs/adrs/ADR 205 — SQL cast emission is adapter policy.md`.
- [ ] Strip repo-wide references to `projects/sql-cast-policy/**` (replace with the canonical ADR link or remove).
- [ ] Delete `projects/sql-cast-policy/`.
