# Prisma Schema (`.prisma`) Implementation Plan

## Goal

Enable Prisma Next to ingest `.prisma` schemas, emit correct contracts, push schema structure to databases with Prisma 7 parity, and introspect databases back into formatted `.prisma` output.

## Success Criteria

1. `config.contract.source` can be a Prisma schema file or inline PSL.
2. `prisma-next contract emit` produces `contract.json`/`contract.d.ts` from `.prisma`.
3. `prisma-next db push` creates the same database structure Prisma 7 `prisma db push` would create.
4. `prisma-next db pull` prints Prisma-formatted schema output equivalent in behavior to Prisma 7 `prisma db pull --print`.
5. Unsupported contract-representation areas are explicitly tracked, tested, and documented.

## Plan

### Phase 1: Parser and Source Foundation

- [x] Add `.prisma` schema source loading from path or inline text.
- [x] Add Prisma 7 schema sanitizer for datasource URL keys.
- [x] Integrate Prisma 7 internals parser (`getConfig`, `getDMMF`).

### Phase 2: Contract Conversion

- [x] Convert DMMF models/enums/relations/indexes/defaults to Prisma Next contract IR.
- [x] Map scalar/native types and execution defaults.
- [x] Add structured missing-feature reporting under `meta.prismaPsl.missingFeatures`.
- [x] Add unit tests for conversion and missing-feature tracking.

### Phase 3: CLI Integration

- [x] Extend `contract emit` source resolution to support `.prisma`.
- [x] Add CLI helpers for Prisma schema source detection.
- [x] Add `db push` command backed by Prisma CLI.
- [x] Add `db pull` command backed by Prisma CLI.

### Phase 4: Parity and Validation

- [x] Add integration tests for emit/push/pull `.prisma` workflows against real Postgres.
- [x] Assert relational parity indicators (tables, FK actions, index ordering) after push.
- [x] Assert pull output includes expected formatted schema blocks.

### Phase 5: Real-World Schema Coverage

- [x] Add complex `.prisma` fixtures from `prisma/prisma-examples` and parse tests.
- [x] Verify conversion on at least two real-world schemas.

### Phase 6: Documentation and Gap Tracking

- [x] Document architecture and command behavior.
- [x] Publish parity/gap matrix for unsupported or partial features.
- [x] Add command docs links for `db push` and `db pull`.

## Remaining Backlog

Items intentionally deferred to dedicated follow-up work:

- Lossless contract encoding for advanced Prisma/Postgres features currently tracked as missing.
- Migration operation support for advanced/indexed feature subsets not represented in current migration ops.
- Broader provider support beyond `postgresql`.

See `docs/reference/Prisma-Schema-Parity-and-Gaps.md`.

