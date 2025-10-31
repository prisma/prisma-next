## Contract Package Refactor — Add Document Family (Target-Agnostic) — Design Brief

### Objective
Refactor the contract package to support both SQL and Document target families without leaking target‑specific details into core. Define two JSON Schemas (SQL vs Document) that share a common header and neutral “sources” surface, enabling adapters (e.g., Postgres, Mongo, Firestore) to map neutral constructs to their native representations.

### Non‑Goals (MVP)
- Building a PSL/TS emitter for the document family.
- Advanced target features in core (e.g., Mongo TTL, Firestore collection‑group specifics).
- Changing core hashing/canonicalization rules.

### Approach
- Split schemas by family with a shared header ($defs):
  - `packages/contract/schemas/data-contract-sql-v1.json`
  - `packages/contract/schemas/data-contract-document-v1.json`
  - Shared header/components via `$defs` (schemaVersion, targetFamily, target, coreHash, profileHash, capabilities, extensions, meta, sources, field types).
- Keep target‑agnostic “document” family:
  - Neutral collections, fields, indexes; no Mongo/Firestore‑specific fields in core.
  - Target‑specific behavior expressed via capabilities and extensions.
- Preserve family‑neutral “sources” for lanes and runtime; no SQL parsing.
- TS types in `packages/contract/src/types.ts` expose:
  - `ContractHeader`, `Source`, `FieldType` (shared)
  - `SqlContract` (storage.tables)
  - `DocumentContract` (storage.document.collections)

### Shared Header & Sources (neutral)
```ts
interface ContractHeader {
  schemaVersion: '1';
  targetFamily: 'sql' | 'document';
  target: string;               // e.g., 'postgres', 'mongo', 'firestore'
  coreHash: string;
  profileHash: string;
  capabilities?: Record<string, Record<string, boolean>>;
  sources?: Record<string, Source>;
  extensions?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

interface Source {
  readOnly: boolean;
  projection: Record<string, FieldType>; // neutral typing
  origin?: Record<string, unknown>;      // provenance link (view/collection)
  capabilities?: Record<string, boolean>;
}

interface FieldType {
  type: string;               // e.g., int4, text, bool, object, array, date, bytes, id
  nullable: boolean;
  items?: FieldType;          // arrays
  properties?: Record<string, FieldType>; // objects
}
```

### SQL Family (unchanged semantics)
```ts
interface SqlContract extends ContractHeader {
  targetFamily: 'sql';
  storage: { tables: Record<string, SqlTable> };
}

interface SqlTable {
  columns: Record<string, { type: string; nullable: boolean; default?: unknown }>;
  primaryKey?: { columns: string[]; name?: string };
  uniques?: Array<{ columns: string[]; name?: string }>;
  indexes?: Array<{ columns: string[]; name?: string; method?: string; predicate?: string }>;
  foreignKeys?: Array<{ columns: string[]; references: { table: string; columns: string[] }; name?: string; onDelete?: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default' }>;
}
```

### Document Family (target‑agnostic)
```ts
interface DocumentContract extends ContractHeader {
  targetFamily: 'document';
  storage: { document: { collections: Record<string, DocCollection> } };
}

interface DocCollection {
  name: string;                        // logical name
  id?: { strategy: 'auto' | 'client' | 'uuid' | 'cuid' | 'objectId' };
  fields: Record<string, FieldType>;   // nested via properties/items
  indexes?: Array<DocIndex>;           // neutral index definition
  readOnly?: boolean;                  // mirrors views concept
}

interface DocIndex {
  name: string;
  keys: Record<string, 'asc' | 'desc'>;   // abstract sort order
  unique?: boolean;
  where?: Expr;                            // small, portable predicate AST (eq/exists)
}

type Expr =
  | { kind: 'eq'; path: string[]; value: unknown }
  | { kind: 'exists'; path: string[] };
```

Notes:
- No TTL, partial filter, shard keys, or collection‑group in core; expose via capabilities `mongo.*` / `firestore.*` or extensions.
- Adapters verify capabilities, lower neutral indexes/expressions, and provide guidance if unsupported.

### JSON Schemas
- SQL: lift current `data-contract-v1.json` to `data-contract-sql-v1.json` with minimal renames if needed; keep structure and validation rules.
- Document: add `data-contract-document-v1.json` with:
  - Header `$ref` to shared definitions.
  - `storage.document.collections` map with `DocCollection` shape.
  - Neutral `FieldType`, `DocIndex`, `Expr` in `$defs`.

### Hashing & Canonicalization
- Unchanged: canonicalize JSON (key ordering, normalized scalars); `coreHash` over canonical JSON.
- `profileHash` derives solely from declared capabilities and adapter/profile pins; runtime never recomputes (per ADR 004 / ADR 021).

### Capabilities & Extensions
- Keep target behavior out of core by declaring features under namespaces:
  - Capabilities: `{ mongo: { partialIndex: true }, firestore: { collectionGroup: true } }`.
  - Extensions: adapter/provider‑specific knobs under `extensions.<namespace>`; participate in `profileHash` per policy.

### Consumer Impact
- Lanes & Runtime: consume `sources` and `FieldType` neutrally; avoid target‑specific parsing.
- Adapters: own lowering and capability checks for each family.
- Compat layers: can map logical models to sources per family.

### Migration Strategy (package)
1) Add new schemas alongside existing `data-contract-v1.json`.
2) Introduce TS types for header + families; mark old monolithic types as deprecated.
3) Update validators to branch on `targetFamily` and validate against the appropriate schema.
4) Keep existing SQL users working; document the new locations and types.

### Acceptance Criteria
- New JSON Schemas exist: `data-contract-sql-v1.json` and `data-contract-document-v1.json` with a shared header `$defs`.
- TS types added for `ContractHeader`, `Source`, `FieldType`, `SqlContract`, `DocumentContract`.
- Validator function loads the correct schema by `targetFamily` and returns precise errors.
- Example document contract (Mongo/Firestore‑agnostic) validates and exposes sources for a collection with nested fields and a neutral index.
- Hash/profile semantics unchanged; conformance tests updated.

### Milestones & Timeline
- M1 (0.5–1d): Author shared header `$defs` and split SQL schema; keep parity with existing behavior.
- M2 (1–1.5d): Author document schema (collections/fields/indexes/expr); add example and validation tests.
- M3 (0.5d): TS types and validator branching; deprecate old monolithic types.
- M4 (0.5d): Docs updates in `1. Data Contract.md` to reflect document family and neutral constructs.

### Risks & Mitigations
- Drift between schemas: centralize header `$defs`; unit tests for shared guarantees (hashing, fields, sources).
- Over‑generalization: keep document v1 minimal (collections/fields/indexes) and push specifics to capabilities/extensions.
- Adapter gaps: document required capability flags; provide actionable errors.

### Open Questions
- Do we want to accept embedded JSON Schema under collection `validation` in v1, or defer entirely to extensions?
- Should we include a minimal `id` strategy in core for documents, or rely entirely on `FieldType` with `type: 'id'`?


