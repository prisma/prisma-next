## Slice 10 — Parameterized Types (MVP: decimal(precision, scale))

### Goal

Introduce structured, parameterized types in the contract and types pipeline. Start with `decimal(precision, scale)` as the MVP to prove the shape and validation. Keep lane typing simple: JS/output type derives from `CodecTypes[typeId].output` and is independent of params; params affect validation and lowering only.

### Relevant docs

- Architecture Overview: [../Architecture Overview.md](../Architecture%20Overview.md)
- Data Contract (structure, determinism): [../architecture docs/subsystems/1. Data Contract.md](../architecture%20docs/subsystems/1.%20Data%20Contract.md)
- Contract Emitter & Types: [../architecture docs/subsystems/2. Contract Emitter & Types.md](../architecture%20docs/subsystems/2.%20Contract%20Emitter%20%26%20Types.md)
- Query Lanes (typing rules): [../architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- ADR 010 Canonicalization Rules: [../architecture docs/adrs/ADR 010 - Canonicalization Rules.md](../architecture%20docs/adrs/ADR%20010%20-%20Canonicalization%20Rules.md)
- ADR 011 Unified Plan Model: [../architecture docs/adrs/ADR 011 - Unified Plan Model.md](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- ADR 131 Codec typing separation: [../architecture docs/adrs/ADR 131 - Codec typing separation.md](../architecture%20docs/adrs/ADR%20131%20-%20Codec%20typing%20separation.md)

### Scope (MVP)

- Replace string type IDs in contract with a structured type object for all columns.
- MVP param type: `pg/decimal@1` with `{ precision: number; scale: number }`.
- Validation driven by adapter/pack manifest param schemas. Hashing includes params.
- `.d.ts` mirrors structured type object; lane/runtimes use `CodecTypes[typeId].output` for JS typing (params do not alter TS type).

### Contract & IR shape (structured)

- Paramless:
```json
{ "type": { "id": "pg/int4@1" }, "nullable": false }
```
- Parameterized (MVP):
```json
{ "type": { "id": "pg/decimal@1", "params": { "precision": 10, "scale": 2 } }, "nullable": false }
```

Rules
- Authoring surfaces (PSL/TS builder) must emit structured types only (no string shorthand).
- Emitter validates `type.id` is a known typeId and `type.params` matches the manifest schema for that typeId.
- Canonicalization: params are serialized deterministically and included in `coreHash`.

### Manifest additions (adapter/packs)

Extend the manifest with a param schema for types:
```json
{
  "id": "postgres",
  "types": {
    "codecTypes": { "import": { "package": "@prisma-next/adapter-postgres/codec-types", "named": "CodecTypes" } },
    "paramSchemas": {
      "pg/decimal@1": {
        "type": "object",
        "properties": {
          "precision": { "type": "integer", "minimum": 1, "maximum": 1000 },
          "scale": { "type": "integer", "minimum": 0, "maximum": 1000 }
        },
        "required": ["precision", "scale"],
        "additionalProperties": false
      }
    }
  }
}
```
Notes
- Param schemas are per `typeId`. Future packs (pgvector, postgis) add their own schemas (e.g., vector: { dim }; geometry: { srid, type }).

### .d.ts generation

- The emitted `.d.ts` mirrors the structured shape (types-only):
```ts
export type Contract = SqlContract<{
  readonly tables: {
    readonly invoice: {
      readonly columns: {
        readonly total: { readonly type: { id: 'pg/decimal@1'; params: { precision: 10; scale: 2 } }; readonly nullable: false }
      }
    }
  }
}>;
```
- `CodecTypes['pg/decimal@1'].output` remains uniform across params (e.g., string or Decimal); params do not change TS type.

### SQL lane & runtime impact

- ColumnBuilder typing continues to use `ComputeColumnJsType` via `CodecTypes[typeId].output`.
- Lowering/DDL (outside this slice) can incorporate params for column definitions (when schema/DDL is later in scope).
- Runtime encoding/decoding: unaffected; codecs keyed by typeId.

### Validation (emitter & contract.validate)

- Structured type object required; string type IDs are rejected.
- Check:
  - `type.id` is a valid typeId for the adapter/pack set.
  - If a param schema exists for `type.id`, validate `type.params` against it (fail with precise messages).
  - If no param schema exists for `type.id`, `params` must be absent/undefined.
- Canonicalize ordered keys and parameter values in JSON.

### TDD plan

1) Schema changes & validation
- Update Arktype schemas for `StorageColumn` to require `type: { id: string; params?: object }`.
- Unit tests: accept paramless; accept valid decimal params; reject missing/extra/invalid params; reject string type shorthand.

2) Manifest paramSchemas
- Implement param schema loading and validation in emitter (`extension-pack.ts`).
- Unit tests: load manifest; validate decimal params; error diagnostics on mismatch.

3) .d.ts emission
- Ensure emitted types mirror the structured object with literal param values.
- Unit tests: `.d.ts` contains literal `{ precision: 10; scale: 2 }`.

4) Lane typing unchanged
- Type tests: `ComputeColumnJsType` returns the same JS type regardless of params for `pg/decimal@1`.

5) Integration (end-to-end)
- Build a contract with a decimal column; run validate/emit; use SQL lane to select the column; ensure plan builds; `ResultType` matches `CodecTypes['pg/decimal@1'].output`.

### Acceptance criteria

- Contract requires structured `type` objects for columns; string shorthand is not accepted.
- Emitter validates type params using manifest-provided schemas; canonicalization includes params.
- `.d.ts` mirrors the structured type and param literals; lane typing uses `CodecTypes[typeId].output` (params do not affect TS type).
- Tests pass: unit (validate/emitter), types (lane inference unchanged), integration (plan builds with decimal).

### Future work

- Additional parameterized types: varchar(n), numeric ranges, date/time with precision.
- Extension packs can adopt parameterized types incrementally:
  - PGVector: Phase 1 ships without Slice 10 by storing `dim` as a deterministic extension annotation used by DDL and runtime validation; Phase 2 migrates to `{ id: 'pgvector/vector@1', params: { dim } }` with a manifest param schema.
  - PostGIS: parameters like `srid` and `geometry type` follow the same mechanism once available.
- Optional branded generics in `.d.ts` (e.g., `Decimal<10,2>`) as an advanced feature without changing JSON shape.





