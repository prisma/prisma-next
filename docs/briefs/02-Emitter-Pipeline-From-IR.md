## Slice 1 — Emission Pipeline (From Contract IR → contract.json + contract.d.ts)

### Objective

Implement the emission pipeline that takes a validated Contract IR and produces:
- Canonical, code-free `contract.json`
- Minimal, types-only `contract.d.ts`

This slice assumes the authoring source (TS builder or PSL) has already been parsed into IR. It focuses exclusively on canonicalization, hashing, validation, and types surface generation per the unified typeId model.

### Inputs

- Contract IR: models, storage (tables/columns), constraints, extensions payloads
- Extension manifests (adapter + all extensions, treated identically) with:
  - `types.codecTypes.import`: package/name/alias for types-only map
- **Note**: All column `type` values in the IR must already be fully qualified type IDs (`ns/name@version`). Canonicalization happens at authoring time (PSL parser or TS builder), not during emission.

### Outputs

- `contract.json` with:
  - `schemaVersion`, `targetFamily`, `target`, `coreHash`, `profileHash?`
  - `models`, `storage` (columns: `{ type: 'ns/name@v', nullable?: boolean }`)
  - `extensions.<ns>` blocks (adapter appears first, e.g., `extensions.postgres`, followed by other extension packs)
- `contract.d.ts` with:
  - `import type { CodecTypes as <Alias> }` for adapter (+ extensions)
  - `export type CodecTypes = <Alias> /* & ExtA & ExtB ... */`
  - `export type LaneCodecTypes = CodecTypes`

### Work Items

1) Validation
- Structural: models ↔ storage refs; PK/UK/IDX/FKs.
- Types: validate all column `type` values are valid type IDs (`ns/name@version`) that come from extensions referenced in `contract.extensions`.
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

**TDD Requirement**: Each component must be implemented using TDD. Write failing tests first, then implement until green.

- Unit:
  - Type validation: ensure all type IDs come from referenced extensions; error on unknown type IDs.
  - Hashing stability: same IR → same hashes; order-insensitivity where applicable.
  - Types gen: correct import path and alias; `LaneCodecTypes` exported.
  - Validation errors: clear messages for unknown typeIds and reference issues.
- Integration:
  - Given IR → emit artifacts → consume in lanes with `LaneCodecTypes` → build plan → assert SQL/params/meta and `ResultType`.
  - **Round-Trip Test**: IR → JSON (emit) → IR (parse JSON) → compare with original IR → JSON (emit again) → compare with first emit. Both JSON outputs must be byte-identical, proving canonicalization and determinism.

### Emitter I/O Decoupling

- The emitter is decoupled from file I/O. The `emit()` function returns `EmitResult` containing:
  - `contractJson`: canonical JSON string (caller writes to file)
  - `contractDts`: TypeScript definitions string (caller writes to file)
  - `coreHash`: computed core hash
  - `profileHash`: computed profile hash (optional)
- The caller (CLI or other tooling) is responsible for all file I/O operations (reading IR, writing JSON/DTS files).

### Acceptance Criteria

- `contract.json` only contains fully qualified typeIds for columns; no codec decorations/mappings.
- Adapter appears in `extensions.<namespace>` as the first extension (identified by `contract.target`).
- `contract.d.ts` imports full adapter `CodecTypes` (MVP) and exports `LaneCodecTypes`.
- Emitter returns strings; caller handles all file I/O.
- Round-trip test passes: IR → JSON → IR → JSON (both JSON outputs identical).
- Lanes+runtime behave per contract; tests pass.

### Design Decisions

**No Canonicalization in validateContract**:
- `validateContract()` does not perform canonicalization. It expects all types to already be fully qualified type IDs (`pg/int4@1`, not `int4`).
- Contracts must always have fully qualified type IDs - there is no fallback canonicalization.
- Type canonicalization happens at authoring time (PSL parser or TS builder), not during validation.
- This enforces the design principle that canonicalization happens at authoring time, keeping validation focused on structural and logical validation only.

**No Target-Specific Branches**:
- Core packages must not branch on `target` (e.g., `if (target === 'postgres')`).
- Target-specific logic belongs in adapters or extension packs.
- This aligns with ADR 005 - Thin Core, Fat Targets.
- See `.cursor/rules/no-target-branches.mdc` for detailed guidance.


