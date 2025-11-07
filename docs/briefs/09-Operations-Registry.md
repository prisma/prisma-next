## Slice 9 — Operations Registry for Packs/Adapters (Type‑centric ColumnBuilder methods)

### Goal

Provide a flexible operations registry so extension packs (and adapters) can register operations on value types they declare, and have these operations:
- Exposed ergonomically on the SQL lane `ColumnBuilder` (methods on typed columns)
- Type‑checked at compile time (argument/return types)
- Lowered deterministically per target family (function call, infix operator, templates)
- Capability‑gated where needed

This enables packs like pgvector without hardcoding operators in core, while remaining generic for other domains (geospatial, text search, etc.).

### Related docs

- Architecture Overview: [../Architecture Overview.md](../Architecture%20Overview.md)
- Query Lanes: [../architecture docs/subsystems/3. Query Lanes.md](../architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- ADR 011 Unified Plan Model: [../architecture docs/adrs/ADR 011 - Unified Plan Model.md](../architecture%20docs/adrs/ADR%20011%20-%20Unified%20Plan%20Model.md)
- ADR 016 Adapter SPI for Lowering: [../architecture docs/adrs/ADR 016 - Adapter SPI for Lowering.md](../architecture%20docs/adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)
- ADR 113 Function & Operator Registry: [../architecture docs/adrs/ADR 113 - Extension function & operator registry.md](../architecture%20docs/adrs/ADR%20113%20-%20Extension%20function%20%26%20operator%20registry.md)
- ADR 131 Codec typing separation: [../architecture docs/adrs/ADR 131 - Codec typing separation.md](../architecture%20docs/adrs/ADR%20131%20-%20Codec%20typing%20separation.md)

### Scope (MVP)

- Type‑centric method registration on `ColumnBuilder` for columns whose `columnMeta.type` matches a registered `typeId`.
- Operations cover:
  - Infix operators (rendered from templates) or function calls (e.g., `${self} <-> ${arg}` or `cosine_similarity(${self}, ${arg})`)
  - Predicates returning scalar types (boolean/number/text) as needed
- Registry resolves:
  - Exposed method name on `ColumnBuilder`
  - Argument types (typeIds, params, or JS literals that encode via codecs)
  - Return value typeId (or builtin scalar, e.g., `number`, `boolean`)
  - Target‑family lowering template and required capabilities

Out of scope (will follow): global namespace invocation; parameterized type constructors; complex operator overloading resolution.

### Manifests (packs and adapter)

Treat adapters as extension packs. Extend the pack manifest with an `operations` section:

```json
{
  "id": "pgvector",
  "version": "1.2.0",
  "types": {
    "codecTypes": { "import": { "package": "@prisma-next/pack-pgvector/codec-types", "named": "CodecTypes" } }
  },
  "operations": [
    {
      "for": "pgvector/vector@1",             // typeId this method is attached to on ColumnBuilder
      "method": "cosineDistance",              // ColumnBuilder method name
      "args": [{ "kind": "typeId", "type": "pgvector/vector@1" }],
      "returns": { "kind": "builtin", "type": "number" },
      "lowering": {
        "targetFamily": "sql",
        "strategy": "infix",                  // or "function"
        "template": "${self} <=> ${arg0}"
      },
      "capabilities": ["jsonAgg:lateral?" ]    // optional gating keys; example
    }
  ]
}
```

Notes
- Adapter manifests may declare operations for base types (e.g., `pg/timestamptz@1`).
- Multiple operations per type allowed; method names must be unique per type within the assembled registry.

### Registry SPI (runtime assembly)

The SQL lane assembles an `OperationRegistry` during builder creation from installed packs/adapters:

```ts
export interface OperationSignature {
  forTypeId: string;                       // attach to columns with this typeId
  method: string;                          // method on ColumnBuilder
  args: ReadonlyArray<ArgSpec>;            // typeId | param | literal encodable
  returns: ReturnSpec;                     // typeId | builtin scalar
  lowering: LoweringSpec;                  // per-family rendering
  capabilities?: ReadonlyArray<string>;    // optional gating keys
}

export interface OperationRegistry {
  register(op: OperationSignature): void;
  byType(typeId: string): ReadonlyArray<OperationSignature>;
}
```

LoweringSpec (SQL MVP)
- strategy: "infix" | "function"
- template: uses `${self}`, `${arg0}`, `${arg1}` placeholders rendered into the target SQL dialect by the adapter lowerer.

### SQL lane exposure (ColumnBuilder methods)

- When building a `ColumnBuilder` for a column with `columnMeta.type = 'ns/name@version'`, the SQL lane consults the registry for `byType(typeId)` and dynamically attaches typed methods to the ColumnBuilder instance prototype (ergonomic sugar implemented via a static map + proxy at instantiation).
- Each registered method returns a new `ColumnBuilder` (or `BinaryBuilder`/predicate) whose `columnMeta.type` reflects the declared `returns` type; this allows composition into `.where(...)`, `.orderBy(...)`, nested projections, etc.
- Capability gating: if `capabilities` are declared on the operation, the method is exposed only when the contract’s capabilities include those keys as literal `true`; otherwise, calling the method is a compile‑time error when types are literal, or a runtime PLAN.UNSUPPORTED error with a clear message.

### Typing model

- Arguments may be:
  - a `ColumnBuilder` with a `columnMeta.type` matching required `typeId` (or a union of allowed typeIds)
  - a param placeholder (encoded at runtime using the column or declared arg type’s codec)
  - a JS literal that encodes via the declared arg `typeId` codec (optional MVP; can defer to params)
- Return type is typed:
  - If `returns.kind === 'typeId'`, produce a `ColumnBuilder<..., { type: ReturnTypeId; nullable: false }, ComputeColumnJsType<...>>`
  - If builtin (e.g., number, boolean), return a `ColumnBuilder` with a virtual builtin typeId (MVP can map to known builtins in `CodecTypes` or use a fixed TS type for row typing)

### Plan & meta

- AST representation: operations render as expressions (either function call or infix) with explicit children; no need for a separate operator node in MVP — reuse `ColumnRef`/expression nodes.
- `meta.refs.columns` includes referenced columns; `projectionTypes`/`annotations.codecs` continue to derive from leaf column typeIds (operators may not need separate codec annotations if they return builtins).

### Capability gating

- Operations can declare capability keys (from adapter profile or pack capabilities). Exposure can be compile‑time gated when capabilities are literal in `contract.d.ts`; otherwise, calls throw PLAN.UNSUPPORTED at build with a precise diagnostic.

### Conflict resolution & namespacing

- Method names must be unique per `forTypeId` across assembled packs.
- Packs should namespace method names when appropriate (e.g., `distanceCosine`) to avoid clashes; a global namespace escape (e.g., `col.op(ns, name, ...args)`) can be added later — not in MVP.

### TDD plan

1) Registry and signatures
- Implement `OperationRegistry` with `register()` and `byType()`; unit tests for happy path and conflicts.

2) ColumnBuilder method exposure
- Extend ColumnBuilder factory to attach registered methods for a typeId; unit tests: methods appear only for matching typeIds; wrong type arguments rejected at compile time.

3) Lowering templates
- Stub adapter lowerer recognizes expressions produced by registered operations; unit tests validate rendered AST fragments for infix/function strategies.

4) Capability gating
- When capabilities are missing, attempting to call a gated operation produces a compile‑time error (if literal) or PLAN.UNSUPPORTED at build time; tests cover both paths.

5) Integration (SQL lane)
- End‑to‑end test: define a fake pack operation; register; use as `t.col.registeredMethod(param('x'))`; assert AST and meta shape; ensure plan builds and types are correct.

### Acceptance criteria

- Packs/adapters declare operations against typeIds; registry assembles them deterministically.
- SQL lane exposes registered methods on `ColumnBuilder` for matching typeIds; typing enforces arg/return types.
- Lowerer renders operations via templates; plans build successfully; refs/meta consistent.
- Capability gating works; clear diagnostics on unsupported usage.

### Future work

- Parameterized type support (e.g., `pgvector/vector(dim)`), with constructor validation and operator overloads per parameter.
- Global `op(ns, name, ...) / func(ns, name, ...)` escape hatch for ad‑hoc use without ColumnBuilder attachment.
- Emitter integration: emit `.d.ts` helper types for pack‑registered operations to enhance lane typing.


### Note re nesting includes

- API: The ORM brief’s include.<relation>(...) is designed to be chainable; nothing in the API forbids multiple includes or nested includes (include children that themselves include their children).
- Lowering:
  - Postgres: nested LATERAL subqueries with nested json_build_object/json_agg are feasible; complexity and performance need care.
  - MySQL/MariaDB: nested correlated JSON_ARRAYAGG/JSON_OBJECT is possible but can get heavy; still feasible for 1–2 levels.
  - SQL Server/Oracle: nested APPLY + FOR JSON/JSON_ARRAYAGG also feasible, with careful aliasing.
  - SQLite/D1: single-statement nested includes aren’t feasible; rely on stitch/flat fallbacks.

- Recommendation for MVP:
  - Support multiple sibling includes at the same level (e.g., user.include.posts(...).include.comments(...)).
  - Defer multi-level nested includes (child includes its own children) to a follow-up slice; keep the API shape but gate deeper nesting behind a feature flag or emit a clear PLAN.UNSUPPORTED if attempted.
  - Document that fallback policies (stitch/flat) will materialize nested arrays at runtime to match types even where single-statement lowering isn’t possible.

If you want, I can add a note to the ORM brief clarifying: “multiple sibling includes supported; nested includes beyond one level are planned; behavior depends on adapter lowering and policy (single-statement vs stitch).”
