## Slice 1 — Emission Pipeline (From Contract IR → contract.json + contract.d.ts)

### Objective

Implement the emission pipeline that takes a validated Contract IR and produces:
- Canonical, code-free `contract.json`
- Minimal, types-only `contract.d.ts`

This slice assumes the authoring source (TS builder or PSL) has already been parsed into IR. It focuses exclusively on canonicalization, hashing, validation, and types surface generation per the unified typeId model.

### Inputs

- Contract IR: models, storage (tables/columns), constraints, extensions payloads
- Adapter and extension manifests (treat adapters as packs) with:
  - `types.codecTypes.import`: package/name/alias for types-only map
  - `types.canonicalScalarMap`: scalar → typeId mapping for the chosen target

### Outputs

- `contract.json` with:
  - `schemaVersion`, `targetFamily`, `target`, `coreHash`, `profileHash?`
  - `models`, `storage` (columns: `{ type: 'ns/name@v', nullable?: boolean }`)
  - `extensions.<ns>` blocks (pack-owned data), no codec decorations/mappings
- `contract.d.ts` with:
  - `import type { CodecTypes as <Alias> }` for adapter (+ extensions)
  - `export type CodecTypes = <Alias> /* & ExtA & ExtB ... */`
  - `export type LaneCodecTypes = CodecTypes`

### Work Items

1) Canonicalization
- Normalize all column `type` values to fully qualified typeIds using `types.canonicalScalarMap` for the adapter target.
- Validate typeId format (`ns/name@version`).
- Keep extension data canonical per ADR 106.

2) Validation
- Structural: models ↔ storage refs; PK/UK/IDX/FKs.
- Types: error if a scalar cannot be canonicalized and is not an already valid typeId.
- Extensions: validate against pack schemas; deterministic ordering.

3) Hashing
- Canonicalize to stable JSON string per ADR 010; compute `coreHash` and `profileHash` (capability keys + pins).

4) Types Generation
- Build `.d.ts` importing full adapter `CodecTypes` (MVP) and exporting `LaneCodecTypes` alias.
- Do not instantiate runtime code; types-only.

### Lane and Runtime Contracts

- Lanes infer `ResultType` using `CodecTypes[column.type].output` and nullability from storage. Callers pass `LaneCodecTypes` into `schema`/`sql` to activate compile-time inference.
- Runtime resolves codecs by `registry.byId(column.type)`; plan hints/overrides optional. Validate all used ids are registered.

### TDD & Tests

- Unit:
  - Canonicalization: scalar → typeId, idempotency, error on unknown scalar.
  - Hashing stability: same IR → same hashes; order-insensitivity where applicable.
  - Types gen: correct import path and alias; `LaneCodecTypes` exported.
  - Validation errors: clear messages for unknown typeIds and reference issues.
- Integration:
  - Given IR → emit artifacts → consume in lanes with `LaneCodecTypes` → build plan → assert SQL/params/meta and `ResultType`.

### Acceptance Criteria

- `contract.json` only contains canonical typeIds for columns; no codec decorations/mappings.
- `contract.d.ts` imports full adapter `CodecTypes` (MVP) and exports `LaneCodecTypes`.
- Lanes+runtime behave per contract; tests pass.


