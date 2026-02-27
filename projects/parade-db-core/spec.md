# ParadeDB Core Extension — Contract Authoring Foundation

## Summary

Add a `@prisma-next/extension-paradedb` package that extends the Prisma Next contract IR, authoring DSL, and emitter to support ParadeDB's BM25 full-text search indexes with tokenizer configuration. This enables users to declaratively author ParadeDB-aware schemas in `contract.ts` and emit a canonical `contract.json` that captures BM25 index definitions, tokenizer settings, and field-level search configuration.

## Problem

ParadeDB (`pg_search`) adds Elastic-like full-text search to Postgres via a custom `bm25` index access method. Today, Prisma Next's contract IR only supports plain indexes (`{ columns: string[], name?: string }`), which cannot express:

- Index access method (`USING bm25` vs. the default `btree`)
- A mandatory `key_field` parameter
- Per-column tokenizer configuration (e.g., `description::pdb.ngram(2,5)`)
- Tokenizer parameters (stemmer, alias, prefix_only, positions, remove_emojis, regex pattern)
- Multi-tokenizer per field via aliases
- Expression-based indexed fields (e.g., `(description || ' ' || category)::pdb.simple('alias=concat')`)
- JSON sub-field tokenizer overrides (e.g., `(metadata->>'color')::pdb.ngram(2,3)`)

Without this, users cannot declare ParadeDB search indexes in their contract and must fall back to raw SQL migration files.

## Users

- Prisma Next contract authors who use ParadeDB-enabled Postgres databases
- AI coding agents that consume the machine-readable contract IR to understand search capabilities

## Scope

**In scope (this project):**
- Contract IR extensions for BM25 indexes and tokenizer configuration
- Extension descriptor (`@prisma-next/extension-paradedb`) following the pgvector pattern
- Table builder DSL for authoring BM25 indexes in `contract.ts`
- Emitter support to serialize BM25 index definitions into `contract.json` and `contract.d.ts`
- Factory functions for test authoring

**Out of scope (future projects):**
- Query plane: `@@@` operator support in the sql-orm query builder
- Query plane: `pdb.*` query builder functions (match, term, phrase, fuzzy, etc.)
- Migration plane: `CREATE INDEX ... USING bm25` DDL generation from contract diffs
- Runtime scoring, aggregation, and highlight functions
- Token filter configuration (stemmer, lowercase, etc. — separate from tokenizer choice)

---

## Requirements

### Functional Requirements

#### FR-1: Extend Contract IR with BM25 Index Type

The `Index` type in `packages/2-sql/1-core/contract/src/types.ts` must be extended to optionally carry BM25-specific metadata:

```typescript
type IndexAccessMethod = 'btree' | 'bm25'

type Bm25FieldConfig = {
  /** Column name. Mutually exclusive with `expression`. */
  readonly column?: string
  /** Raw SQL expression (e.g., "description || ' ' || category"). Mutually exclusive with `column`. */
  readonly expression?: string
  /** Tokenizer ID, e.g., 'unicode', 'simple', 'ngram', 'icu', 'regex', 'literal', etc. */
  readonly tokenizer?: string
  /** Tokenizer parameters, e.g., { min: 2, max: 5 } for ngram, { pattern: '...' } for regex */
  readonly tokenizerParams?: Record<string, unknown>
  /** Alias for multi-tokenizer per field. Required when `expression` is used. */
  readonly alias?: string
}

type Index = {
  readonly columns: readonly string[]
  readonly name?: string
  /** Access method. Defaults to 'btree' when omitted. */
  readonly using?: IndexAccessMethod
  /** BM25-specific: unique column used as the document key. Auto-inferred from single-column PK when omitted. */
  readonly keyField?: string
  /** BM25-specific: per-field tokenizer configuration */
  readonly fieldConfigs?: readonly Bm25FieldConfig[]
}
```

This is backward-compatible: existing indexes without `using` remain plain btree indexes.

**Note on `IndexAccessMethod`:** Only `'btree' | 'bm25'` are included in this project. Other Postgres access methods (`hash`, `gist`, `gin`, `brin`, `spgist`) will be added as part of plain Postgres support in a separate effort. No string escape hatch — each new access method requires deliberate IR design for its config shape, so a closed union keeps the contract verifiable.

#### FR-2: ParadeDB Extension Descriptor

Create `packages/3-extensions/paradedb/` following the pgvector pattern:

```
packages/3-extensions/paradedb/
├── src/
│   ├── core/
│   │   ├── constants.ts          # PARADEDB_EXTENSION_ID, tokenizer IDs
│   │   └── descriptor-meta.ts    # Extension metadata, capabilities
│   ├── exports/
│   │   ├── control.ts            # Extension descriptor for control plane
│   │   ├── index-types.ts        # BM25 index builder types and helpers
│   │   └── pack.ts               # Extension pack exports
│   └── types/
│       └── index-types.ts        # TypeScript types for BM25 index config
├── package.json
├── tsconfig.json
├── tsconfig.prod.json
└── tsdown.config.ts
```

The extension descriptor must declare:
- `kind: 'extension'`
- `id: 'paradedb'`
- `familyId: 'sql'`
- `targetId: 'postgres'`
- Capabilities: `{ postgres: { 'paradedb/bm25': true } }`

#### FR-3: Tokenizer Catalog

Define a tokenizer catalog covering all ParadeDB built-in tokenizers:

| Tokenizer ID           | Parameters                                           | Description                              |
|------------------------|------------------------------------------------------|------------------------------------------|
| `unicode`              | `remove_emojis?: boolean`                            | Default. Unicode word boundaries.        |
| `simple`               | `stemmer?: string`, `alias?: string`                 | Splits on non-alphanumeric.              |
| `ngram`                | `min: number`, `max: number`, `prefix_only?: boolean`, `positions?: boolean` | Character n-grams.    |
| `icu`                  | —                                                    | ICU Unicode standard.                    |
| `regex_pattern`        | `pattern: string`                                    | Regex-based tokenization.                |
| `source_code`          | —                                                    | camelCase / snake_case splitting.        |
| `literal`              | —                                                    | No splitting. Exact match / sort / agg.  |
| `literal_normalized`   | —                                                    | Literal + lowercase + token filters.     |
| `whitespace`           | —                                                    | Whitespace splitting + lowercase.        |
| `chinese_compatible`   | —                                                    | CJK-aware word segmentation.             |
| `jieba`                | —                                                    | Chinese segmentation via Jieba.          |
| `lindera`              | —                                                    | Japanese/Korean/Chinese via Lindera.     |

Each tokenizer must be representable in the contract IR's `Bm25FieldConfig.tokenizer` + `tokenizerParams`.

#### FR-4: Authoring DSL for BM25 Indexes

Extend the `TableBuilder` to support a `bm25Index()` method:

```typescript
const items = table('mock_items')
  .column('id', { type: pg.integer(), nullable: false })
  .column('description', { type: pg.text(), nullable: false })
  .column('category', { type: pg.text(), nullable: false })
  .column('rating', { type: pg.integer(), nullable: false })
  .column('metadata', { type: pg.jsonb(), nullable: false })
  .primaryKey(['id'])
  .bm25Index({
    // keyField omitted — auto-inferred from single-column PK ('id')
    fields: [
      bm25.text('description'),
      bm25.text('category', { tokenizer: 'simple', stemmer: 'english' }),
      bm25.numeric('rating'),
      bm25.json('metadata', { tokenizer: 'ngram', min: 2, max: 3 }),
    ],
    name: 'search_idx',
  })

// With explicit keyField override:
  .bm25Index({
    keyField: 'uuid',  // use a non-PK unique column
    fields: [bm25.text('body')],
  })

// With expression-based field:
  .bm25Index({
    fields: [
      bm25.text('description'),
      bm25.expression("description || ' ' || category", { tokenizer: 'simple', alias: 'concat' }),
      bm25.expression("(metadata->>'color')", { tokenizer: 'ngram', min: 2, max: 3, alias: 'meta_color' }),
    ],
  })
```

**`keyField` auto-inference:** When `keyField` is omitted, the builder infers it from the table's single-column primary key. If the table has a composite PK or no PK, an explicit `keyField` is required (builder throws at build time).

The `bm25` helper namespace provides typed field builders:
- `bm25.text(column, opts?)` — text field with optional tokenizer config
- `bm25.numeric(column)` — numeric field (filterable, sortable in BM25)
- `bm25.boolean(column)` — boolean field
- `bm25.json(column, opts?)` — JSON/JSONB field with optional tokenizer
- `bm25.datetime(column)` — timestamp/date field
- `bm25.range(column)` — range field
- `bm25.expression(sql, opts)` — raw SQL expression field. `alias` is required.

#### FR-5: Emitter Support

The SQL emitter (`packages/2-sql/3-tooling/emitter/`) must:

1. Serialize `Index` objects with `using: 'bm25'` into the `contract.json` including `keyField` and `fieldConfigs`
2. Generate corresponding TypeScript types in `contract.d.ts` that capture the BM25 index structure at the type level
3. Validate that `keyField` references a column with a unique constraint or primary key
4. For expression-based fields (`Bm25FieldConfig.expression`), serialize the raw SQL string as-is and validate that `alias` is present

#### FR-6: Factory Functions for Testing

Add factory helpers in `packages/2-sql/1-core/contract/src/factories.ts`:

```typescript
function bm25Index(opts: {
  keyField: string
  fields: readonly Bm25FieldConfig[]
  name?: string
}): Index

function bm25Field(column: string, opts?: {
  tokenizer?: string
  tokenizerParams?: Record<string, unknown>
  alias?: string
}): Bm25FieldConfig

function bm25ExprField(expression: string, opts: {
  tokenizer?: string
  tokenizerParams?: Record<string, unknown>
  alias: string  // required for expression fields
}): Bm25FieldConfig
```

### Non-Functional Requirements

- **NFR-1: Backward compatibility.** Existing contracts without BM25 indexes must remain valid. The `using` field defaults to `'btree'` when absent.
- **NFR-2: Extension isolation.** ParadeDB-specific authoring helpers live in the extension package, not in framework or SQL core. The core IR extensions are minimal and generic (supporting any index access method).
- **NFR-3: Machine-readability.** The BM25 index IR in `contract.json` must be self-describing so that agents can enumerate search-enabled fields, tokenizer configs, and capabilities without external documentation.
- **NFR-4: Test coverage.** Unit tests for: IR serialization round-trip, authoring DSL, emitter output, factory functions.

### Non-Goals

- DDL SQL generation (`CREATE INDEX ... USING bm25`) — belongs to the migration plane
- Runtime query support (`@@@` operator, `pdb.*` functions) — belongs to the query plane
- Token filter pipeline configuration (stemmer chains, stop words) — deferred to a follow-up
- Custom tokenizer registration — deferred
- ParadeDB aggregation functions (terms, range, histogram, facets, stats)

---

## Acceptance Criteria

- [ ] `packages/3-extensions/paradedb/` exists and follows the pgvector package structure
- [ ] Extension descriptor declares `id: 'paradedb'`, `familyId: 'sql'`, `targetId: 'postgres'`
- [ ] Contract IR `Index` type supports `using?: IndexAccessMethod` and BM25-specific fields
- [ ] `IndexAccessMethod` is exactly `'btree' | 'bm25'` (other access methods added separately)
- [ ] `Bm25FieldConfig` captures column (or expression), tokenizer, tokenizerParams, and alias
- [ ] All 12 ParadeDB tokenizers are representable via the tokenizer catalog
- [ ] `TableBuilder.bm25Index()` method produces correct `Index` IR with `using: 'bm25'`
- [ ] `bm25.*` helper functions produce correct `Bm25FieldConfig` objects
- [ ] Emitter serializes BM25 indexes into `contract.json` with full field config
- [ ] Emitter generates typed BM25 index definitions in `contract.d.ts`
- [ ] `bm25.expression()` helper produces `Bm25FieldConfig` with `expression` and required `alias`
- [ ] `keyField` auto-inferred from single-column PK when omitted; error on composite/missing PK
- [ ] Factory functions `bm25Index()`, `bm25Field()`, and `bm25ExprField()` are available for tests
- [ ] `pnpm lint:deps` passes (no architectural boundary violations)
- [ ] `pnpm typecheck` passes
- [ ] Unit tests cover IR round-trip, DSL authoring, and emitter output

---

## Design Decisions

### DD-1: Closed `IndexAccessMethod` Union — `'btree' | 'bm25'` Only

**Decision:** Start with `IndexAccessMethod = 'btree' | 'bm25'`. No string escape hatch. Other Postgres access methods (`hash`, `gist`, `gin`, `brin`, `spgist`) will be added in a separate plain-Postgres-support effort.

**Rationale:** Each access method may need its own config shape (like BM25 needs `keyField` + `fieldConfigs`). A closed union keeps the contract verifiable — you can't have a `using: 'foo'` that nothing understands. Adding a new access method to the union is trivial; designing its config is the real work, and that deserves its own project.

### DD-2: Tokenizer as String ID + Params Object

**Decision:** Represent tokenizers as `{ tokenizer: string, tokenizerParams?: Record<string, unknown> }` rather than a discriminated union per tokenizer.

**Rationale:** ParadeDB may add tokenizers in the future. An open `string` ID with a params bag is extensible without contract IR changes. Type safety for specific tokenizers is enforced at the authoring DSL level via the `bm25.*` helpers, not at the IR level.

### DD-3: `fieldConfigs` as Parallel Structure to `columns`

**Decision:** BM25 indexes carry both `columns: string[]` (for backward-compat and simple field listing) and `fieldConfigs: Bm25FieldConfig[]` (for detailed per-field config).

**Rationale:** The `columns` array maintains compatibility with existing index consumers (emitter validation, dependency-cruiser, etc.). `fieldConfigs` provides the rich metadata needed for BM25. When `using: 'bm25'`, `columns` is derived from `fieldConfigs[*].column` (expression-based fields contribute their alias to `columns`).

### DD-4: `keyField` Auto-Inference from Single-Column PK

**Decision:** When `keyField` is omitted in the authoring DSL, auto-infer it from the table's single-column primary key. If the table has a composite PK or no PK, require explicit `keyField` (throw at build time). Allow explicit override for non-PK unique columns.

**Rationale:** ParadeDB's `key_field` is the PK ~99% of the time. Auto-inference removes boilerplate in the common case. The explicit override path covers edge cases (e.g., a `uuid` column that isn't the PK). In the serialized contract IR, `keyField` is always present (the builder resolves the inference before emitting).

### DD-5: Expression-Based Fields as Raw SQL Strings

**Decision:** Represent expression-based BM25 fields via `Bm25FieldConfig.expression?: string` (mutually exclusive with `column`). The authoring DSL exposes `bm25.expression(sql, opts)` where `sql` is a plain string. `alias` is required for expression fields.

**Rationale:** Expression-based indexed fields are a DDL concept — no parameterized values, just a raw SQL fragment in `CREATE INDEX`. A plain string is honest about what this is. No `sql` template literal is needed at the authoring layer (unlike the query plane's `root.raw`, there are no parameters to interpolate). A dedicated `sql` tagged template could be added later for editor syntax highlighting, but it would be pure ergonomic sugar with no runtime behavior.

---

## References

- [ParadeDB CREATE INDEX docs](https://docs.paradedb.com/documentation/indexing/create-index)
- [ParadeDB Tokenizers overview](https://docs.paradedb.com/documentation/tokenizers/overview)
- [ParadeDB Architecture](https://docs.paradedb.com/welcome/architecture)
- [pg_search source (GitHub)](https://github.com/paradedb/paradedb/tree/main/pg_search)
- [Prisma Next pgvector extension](../packages/3-extensions/pgvector/) — reference implementation
- [Contract IR types](../packages/2-sql/1-core/contract/src/types.ts)
- [Table builder](../packages/1-framework/2-authoring/contract/src/table-builder.ts)
- [SQL emitter](../packages/2-sql/3-tooling/emitter/src/index.ts)

## Open Questions

_All previously open questions have been resolved — see DD-1, DD-4, DD-5._
