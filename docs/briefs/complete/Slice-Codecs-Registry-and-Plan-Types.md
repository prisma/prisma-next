## Codecs Registry, Plan Type Hints, and Lane Integration — MVP Slice Plan

### Objective
Establish a minimal codecs pipeline so users can pass/receive basic JS types (string, number, Date) deterministically across adapters. The runtime composes a codec registry from the adapter; lanes stamp type hints into Plans so params encode correctly and rows decode predictably. This sets the foundation for extension types (e.g., pgvector) per ADR 114.

### References
- ADR 030 — Result decoding & codecs registry
- ADR 114 — Extension codecs & branded types
- Subsystems: Query Lanes, Runtime & Plugin Framework, Adapters & Targets

### Scope (MVP)
- Minimal adapter‑provided codecs for SQL Postgres target:
  - core/string → string
  - core/number → number (int4/float8)
  - core/iso‑datetime → ISO 8601 string for timestamp/timestamptz; optional param encode from JS Date
- Runtime registry assembly from adapter (packs later), and deterministic encode/decode path
- Lanes (DSL/ORM) stamp enough type hints for params and projections to select codecs without SQL parsing
- Plan carries light metadata to enable runtime codec selection when AST is absent (e.g., raw lane later)

Out of scope (MVP):
- Decimal/bigint/interval/bytes/json codecs; branded extension types; pack integration
- EXPLAIN/timezone policies; custom project‑level codec overrides; raw lane annotations

### API & Data Model

#### Codec interfaces (minimal)
```ts
// Identifier is logical and stable; implementation identity/version does not participate in plan hashing
export interface Codec<TWire = unknown, TJs = unknown> {
  id: string;                 // namespaced id e.g. 'core/string@1', 'pg/uuid@1'
  targetTypes: string[];      // contract scalar ids satisfied, e.g. ['text'], ['timestamptz','timestamp']
  decode(wire: TWire): TJs;   // sync, pure
  encode?(value: TJs): TWire; // sync, pure
}

export interface CodecRegistry {
  // direct lookup by namespaced codec id
  byId: Map<string, Codec>;
  // contract scalar id (e.g., 'text', 'int4', 'timestamptz') → ordered candidates
  byScalar: Map<string, Codec[]>;
}
```

Namespacing and versioning
- Codec ids are `'namespace/name@version'`; namespace required to avoid collisions (ADR 030/114).
- Multiple codecs may satisfy the same scalar; ordering in `byScalar` reflects default preference (adapter first, then packs, then app overrides).

#### Adapter SPI (addition)
```ts
interface AdapterProfile {
  id: string; target: string; capabilities: Record<string, unknown>;
  codecs(): CodecRegistry; // new — adapter default codecs (byId + byScalar candidates)
}
```

#### Runtime options (addition)
```ts
createRuntime({
  contract, adapter, driver,
  plugins: [],
  codecs?: {
    // per-alias or fully-qualified column override → namespaced codec id
    overrides?: Record<string /* alias | table.column */, string /* 'ns/name@v' */>
  }
})
```

#### Plan metadata (light hints)
```ts
plan.meta.projectionTypes?: Record<string /* alias */, string /* contract scalar id */>
plan.meta.paramDescriptors?: Array<{ name: string; type?: string; nullable?: boolean; refs?: { table: string; column: string } }>
// Optional explicit codec hints by namespaced id for fine-grained control per projection alias/param
plan.meta.annotations?.codecs?: Record<string /* alias | param name */, string /* 'ns/name@v' */>
```
- Lanes fill `paramDescriptors[].type` from contract column type; `projectionTypes` is optional when AST+refs allow runtime to recover types deterministically.
- Lanes may attach optional `annotations.codecs` per alias/param to select a specific codec implementation.

#### Resolution rules (per ADR 030 precedence, extended)
For each projection alias and parameter:
1) Plan hint: `annotations.codecs[alias|param] = 'ns/name@v'` → select by id; if missing, error `PLAN.UNSUPPORTED` or fallback per policy.
2) Contract-declared codec (future) → select by id.
3) Runtime overrides: `codecs.overrides['table.column' | alias]` → select by id.
4) Registry by scalar: pick first candidate from `byScalar.get(scalar)`.
5) Driver/native value as last resort (decode no-op), with advisory log.

### Behavior
- Param encoding (before execute):
  - Resolve a codec per `paramDescriptor.type` (when provided) from the registry; if codec has `encode`, apply it; else pass value through.
  - Null short‑circuit: null/undefined pass as null without encode.
  - If value is a JS Date and type is `timestamp|timestamptz`, apply `core/iso-datetime@1`. (Policy: default to ISO string.)
- Row decoding (onRow):
  - Determine codec per alias using precedence above; if only a scalar is known, select first candidate from `byScalar`.
  - Apply `decode`; null short‑circuit.
- Determinism: decoding is sync/pure; errors surface `RUNTIME.DECODE_FAILED` with stable envelope (ADR 027).

### Type inference and plan-encoded result types (TS)
- Plan generic: `Plan<Row>` where `Row` is the decoded result row shape.
- Runtime signature: `execute<Row>(plan: Plan<Row>): AsyncIterable<Row>` so callers get typed rows from the plan.
- Utility type: `type ResultType<P> = P extends Plan<infer R> ? R : never` for extracting the row type from a built plan.
- DSL typing rules:
  - Each column builder carries a JS type derived from the contract scalar via a static mapping used at compile time (MVP: text→string, int/float→number, timestamptz→string ISO).
  - `select({ alias: column })` composes a projection object type from selected columns’ JS types.
  - The Plan’s `Row` generic is inferred from the projection type; e.g., `{ id: number; createdAt: string }` for timestamptz.
- Future: Packs generate branded types in `contract.d.ts` (ADR 114); lanes will pick branded TS types for projections automatically. Typed codec hints (e.g., `.hintCodec<T>()`) are out of scope for this slice.

Example (compile-time types):
```ts
const plan = sql({ contract, adapter })
  .from(t.user)
  .select({ id: t.user.id, createdAt: t.user.createdAt })
  .build();

type Row = ResultType<typeof plan>; // { id: number; createdAt: string }

for await (const row of runtime.execute(plan)) {
  // row is typed as { id: number; createdAt: string }
}
```

### Lane Integration (DSL/ORM)
- At build():
  - For each projected alias, compute contract scalar id from selected column and optionally stamp to `projectionTypes[alias]`.
  - For each param placeholder, populate `paramDescriptors[]` including `type` and `nullable` from the referenced column.
- No SQL parsing; all type info comes from contract and the lane’s own AST.

### Defaults & Policy
- Timestamps: default decode to ISO 8601 string for determinism (ADR 030). Param helpers accept JS Date; encoded to ISO string.
- Numbers: int/float map to JS number by default; bigint/decimal are out of MVP.
- Strings: pass through; adapter may still accept buffers on wire.

### Acceptance Criteria
- Adapter exposes a minimal `CodecRegistry` with three codecs: core/string, core/number, core/iso‑datetime, populated in both `byId` and `byScalar`.
- DSL lane stamps `paramDescriptors.type` for columns used in predicates and `projectionTypes` for selected aliases (or runtime infers from refs).
- Runtime encodes params using the registry and decodes rows per alias with null short‑circuit.
- Integration test: passing JS Date in where clause encodes as ISO; selecting timestamptz decodes to ISO string; numbers/strings round‑trip.
- Decode failures return `RUNTIME.DECODE_FAILED` with redacted details; missing codec falls back to driver value without mutation in MVP (warn via log).
- Per-alias override via `plan.meta.annotations.codecs[alias]` selects a namespaced codec id when available; test verifies override beats defaults.
— Type-level:
- `Plan<Row>` generic exists; `ResultType<typeof plan>` yields the decoded row shape.
- DSL column builders map contract scalars to JS types for MVP set (string, number, ISO datetime) and infer the `Row` type for projections.

### Test Plan
- Unit: registry resolution by scalar id; encode/decode round‑trip for Date/number/string; null passthrough.
- Lane unit: paramDescriptors type stamping; projectionTypes mapping for aliases.
- Integration (Postgres): create/read rows with text, int4, timestamptz; assert encoded params and decoded rows match policy (ISO string for timestamps).

### Milestones
- M1: Define Codec/Registry types; add adapter `codecs()`; runtime composition and param encoding (1d)
- M2: Row decoding in runtime; error envelopes; null policy; logging (1d)
- M3: DSL lane type stamping for params and projection; minimal tests (1d)
- M4: End‑to‑end integration test with Postgres adapter (0.5–1d)

### Risks & Mitigations
- Timezone/string vs Date mismatch: default to ISO string; document opt‑in Date decoding later.
- Missing types (decimal/bigint/json): explicitly out of scope; add in later slice.
- Performance: codecs are sync/pure; decode per row; keep projection small in tests.

### Open Questions
- For timestamps, confirm default decode: ISO string vs JS Date for MVP. (ADR 030 prefers ISO.)
- Do we want `projectionTypes` always, or rely on `refs+contract` when AST present and only stamp hints for raw lane?
- Do we allow partial ids (e.g., 'core/iso-datetime') without version for convenience, resolving to the highest compatible version? (Default: require version in MVP.)



