## Slice 3 — PSL Parser and CLI Integration

### Objective

Implement a minimal PSL parser that reads a PSL schema, produces the Contract IR, and invokes the Slice 1 emission pipeline to output `contract.json` and `contract.d.ts`. Reuse the same CLI package.

### Inputs

- PSL schema file(s) path (CLI flag)
- Extension manifests (adapter + all extensions) for canonicalization and types import info
- **Note**: The PSL parser is responsible for canonicalizing shorthand types (e.g., `Int`, `String`) to fully qualified type IDs using extension manifests. The emitter only validates that all type IDs come from referenced extensions.

### Outputs

- Emitted artifacts: `contract.json`, `contract.d.ts`

### Parser Scope (MVP)

- Minimal grammar to cover tables, columns (type + nullability), primary keys, uniques, indexes, and foreign keys.
- Canonicalize all column types to fully qualified type IDs (`ns/name@version`) using extension manifests:
  - PSL scalars (e.g., `Int`, `String`) map to adapter type IDs (e.g., `pg/int4@1`, `pg/text@1`)
  - Extension-provided types map to their namespace (e.g., `pgvector/vector@1`)
  - Already qualified types pass through unchanged
- Namespaced extension decorations parsed into extension payloads under `extensions.<ns>` (indexes/predicates if needed), but omit codec/type decorations for columns.
- Adapter appears as first extension in `extensions.<adapter-namespace>` (e.g., `extensions.postgres`).
- Produce the same Contract IR shape consumed by Slice 1 (with all types already canonicalized).

### CLI Surface

- `prisma-next emit --psl <path/to/schema.psl> --out <dir> [--target postgres]`
  - Parses PSL → IR → runs Slice 1 emission pipeline (emitter returns strings) → CLI writes artifacts to files.
  - **CLI handles all file I/O**: Read PSL schema file, call emitter (which returns strings), write emitted `contract.json` and `contract.d.ts` to files.

### TDD & Tests

**TDD Requirement**: Each component must be implemented using TDD. Write failing tests first, then implement until green.

- Unit:
  - Grammar coverage for columns/types/nullability and constraints.
  - Type canonicalization: PSL scalars → adapter type IDs; extension types → extension type IDs; already qualified types pass through.
  - Deterministic ordering and canonical references.
- Integration:
  - Given PSL input, emit artifacts, then consume via lanes with `LaneCodecTypes`; assert identical plans and types to an equivalent TS-only authored contract.
  - **Round-Trip Test**: PSL → IR → JSON → IR (parse) → compare with original IR → JSON (emit again) → compare with first emit. Both JSON outputs must be byte-identical.

### Acceptance Criteria

- PSL → IR → artifacts matches the Slice 1 pipeline expectations.
- CLI handles all file I/O (reads PSL schema, writes emitted artifacts); emitter returns strings.
- Round-trip test passes: PSL → IR → JSON → IR → JSON (both JSON outputs identical).
- Query lanes produce identical outcomes to TS-only and emit-from-IR paths.

### Open Questions

1) PSL file layout: single file vs includes? For MVP assume single file.
2) Exact PSL grammar subset for MVP (confirm columns, PK/UK/IDX/FK only).


