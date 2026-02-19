# Prisma Schema (`.prisma`) Implementation Plan

## Goal

Enable Prisma Next to ingest `.prisma` schemas, emit correct contracts, and apply/verify schemas using Prisma Next-native database flows (no Prisma engines).

## Success Criteria

1. `config.contract.source` can be a Prisma schema file or inline PSL.
2. `prisma-next contract emit` produces `contract.json`/`contract.d.ts` from `.prisma`.
3. `prisma-next db init` applies the emitted contract to an empty database.
4. `prisma-next db schema-verify` and `prisma-next db introspect` validate and inspect the resulting live schema.
5. Unsupported contract-representation areas are explicitly tracked, tested, and documented.

## Plan

### Phase 1: Parser and Source Foundation

- [x] Add `.prisma` schema source loading from path or inline text.
- [x] Add Prisma 7 schema sanitizer for datasource URL keys.
- [x] Integrate Prisma schema WASM parser (`get_config`, `get_dmmf`) without Prisma internals.

### Phase 2: Contract Conversion

- [x] Convert DMMF models/enums/relations/indexes/defaults to Prisma Next contract IR.
- [x] Map scalar/native types and execution defaults.
- [x] Add structured missing-feature reporting under `meta.prismaPsl.missingFeatures`.
- [x] Add unit tests for conversion and missing-feature tracking.

### Phase 3: CLI Integration

- [x] Extend `contract emit` source resolution to support `.prisma`.
- [x] Add CLI helpers for Prisma schema source detection.
- [x] Validate `.prisma` flow through native `db init` + `db schema-verify` + `db introspect` commands.

### Phase 4: Parity and Validation

- [x] Add integration tests for emit/init/verify/introspect `.prisma` workflows against real Postgres.
- [x] Assert relational structure indicators (tables, FKs, indexes) after `db init`.
- [x] Assert schema verification and introspection output contains expected structures.

### Phase 5: Real-World Schema Coverage

- [x] Add complex `.prisma` fixtures from `prisma/prisma-examples` and parse tests.
- [x] Verify conversion on at least two real-world schemas.

### Phase 6: Documentation and Gap Tracking

- [x] Document architecture and command behavior.
- [x] Publish parity/gap matrix for unsupported or partial features.
- [x] Add command docs links for native `db introspect` and `db schema-verify`.

## Remaining Backlog

Items intentionally deferred to dedicated follow-up work:

- Lossless contract encoding for advanced Prisma/Postgres features currently tracked as missing.
- Migration operation support for advanced/indexed feature subsets not represented in current migration ops.
- Broader provider support beyond `postgresql`.

See `docs/reference/Prisma-Schema-Parity-and-Gaps.md`.
