## Slice 3 — PSL Parser and CLI Integration

### Objective

Implement a minimal PSL parser that reads a PSL schema, produces the Contract IR, and invokes the Slice 1 emission pipeline to output `contract.json` and `contract.d.ts`. Reuse the same CLI package.

### Inputs

- PSL schema file(s) path (CLI flag)
- Adapter/pack manifests (as in Slice 1)

### Outputs

- Emitted artifacts: `contract.json`, `contract.d.ts`

### Parser Scope (MVP)

- Minimal grammar to cover tables, columns (type + nullability), primary keys, uniques, indexes, and foreign keys.
- Namespaced extension decorations parsed into extension payloads under `extensions.<ns>` (indexes/predicates if needed), but omit codec/type decorations for columns.
- Produce the same Contract IR shape consumed by Slice 1.

### CLI Surface

- `prisma-next emit --psl <path/to/schema.psl> --out <dir> [--target postgres]`
  - Parses PSL → IR → runs Slice 1 → writes artifacts.

### TDD & Tests

- Unit:
  - Grammar coverage for columns/types/nullability and constraints.
  - Deterministic ordering and canonical references.
- Integration:
  - Given PSL input, emit artifacts, then consume via lanes with `LaneCodecTypes`; assert identical plans and types to an equivalent TS-only authored contract.

### Acceptance Criteria

- PSL → IR → artifacts matches the Slice 1 pipeline expectations.
- Query lanes produce identical outcomes to TS-only and emit-from-IR paths.

### Open Questions

1) PSL file layout: single file vs includes? For MVP assume single file.
2) Exact PSL grammar subset for MVP (confirm columns, PK/UK/IDX/FK only).


