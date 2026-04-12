# PSL Index Authoring Surface for MongoDB

## Summary

Define the PSL syntax for authoring the full MongoDB index vocabulary — including wildcard indexes, collation, partial filter expressions, and text indexes — through `@@index`, `@@unique`, `@unique`, and `@@textIndex`.

## Context

M2 extended the contract types (`MongoStorageIndex`) and the migration pipeline to support the full MongoDB index vocabulary: all key directions (ascending, descending, hashed, text, 2dsphere, 2d), wildcard keys (`$**`), collation, partial filter expressions, wildcard projections, text weights, TTL, and sparse flags.

The PSL interpreter currently supports a subset of this vocabulary:

- `@@index([fields])` — ascending, descending, hashed, 2dsphere
- `@@unique([fields])` / `@unique` — unique indexes
- `@@index([fields], type: "text", weights: "...", default_language: "...", language_override: "...")` — text indexes
- `@@index([fields], sparse: true, expireAfterSeconds: N)` — TTL and sparse

The following are supported at the contract/migration level but **not yet** expressible via PSL:

- **Wildcard indexes** — `{ "$**": 1 }` or `{ "path.$**": 1 }`
- **Collation** — locale-aware string comparison and ordering
- **Partial filter expressions** — indexes that only cover documents matching a filter
- **Wildcard projections** — include/exclude field lists for wildcard indexes

## Design

### Two axes of configuration

Index configuration has two orthogonal axes:

1. **Key fields** — an ordered list of `(path, direction)` entries that determine _what_ is indexed
2. **Options** — configuration that applies to the index as a whole, determining _how_ it is indexed

### Key fields

Each key field is a dot-path targeting a document field, with a direction (ascending, descending, or a special type like hashed/2dsphere).

Wildcard fields use a `wildcard()` function in the field list to denote recursive coverage of all subpaths. The `wildcard()` function accepts an optional path argument scoping it to a subtree.

**Constraints on key fields:**

- At most **one** `wildcard()` entry per index
- `wildcard()` can appear in any position in the field list (first, middle, or last)
- All other fields must be concrete dot-paths (no globs)
- Compound wildcard indexes (regular fields + one wildcard, MongoDB 7.0+) are valid

### Index types

There are distinct index types with different storage and query semantics:

| Type | Direction value | Key restrictions |
|------|----------------|------------------|
| **Regular** (ascending) | `1` (default) | None |
| **Regular** (descending) | `-1` | None |
| **Text** | `"text"` | Cannot combine with wildcard or unique |
| **Hashed** | `"hashed"` | Exactly one field, cannot combine with wildcard or unique |
| **2dsphere** | `"2dsphere"` | Cannot combine with wildcard |
| **2d** | `"2d"` | Cannot combine with wildcard |

Text indexes are sufficiently different in semantics and option surface to warrant a dedicated `@@textIndex` attribute (see below).

### Option compatibility

| Option | Regular | Text | Hashed | Geo | With wildcard |
|--------|:---:|:---:|:---:|:---:|:---:|
| `unique` | yes | no | no | no | no |
| `sparse` | yes | yes | yes | yes | yes |
| `expireAfterSeconds` | yes (single date field) | no | no | no | no |
| `filter` | yes | yes | yes | yes | yes |
| `collation` | yes | yes | no | no | yes |
| `include`/`exclude` | n/a | n/a | n/a | n/a | yes (required context) |
| `weights` | n/a | yes | n/a | n/a | n/a |

### PSL syntax

#### `@@index` — regular, hashed, and geo indexes

```prisma
model Events {
  id        ObjectId @id @map("_id")
  status    String
  tenantId  String
  location  Json
  metadata  Json
  expiresAt DateTime

  // Simple ascending
  @@index([status])

  // Compound ascending
  @@index([status, tenantId])

  // Hashed (for shard keys)
  @@index([tenantId], type: "hashed")

  // 2dsphere (geospatial)
  @@index([location], type: "2dsphere")

  // TTL with sparse
  @@index([expiresAt], sparse: true, expireAfterSeconds: 3600)

  // Partial filter (only index active documents)
  @@index([status], filter: "{\"status\": \"active\"}")

  // With collation (case-insensitive French locale)
  @@index([status], collationLocale: "fr", collationStrength: 2)

  // Wildcard — all fields
  @@index([wildcard()])

  // Wildcard scoped to a subtree
  @@index([wildcard(metadata)])

  // Wildcard with include projection (multiple subtrees)
  @@index([wildcard()], include: "[metadata, tags]")

  // Wildcard with exclude projection
  @@index([wildcard()], exclude: "[_class, internalLog]")

  // Compound wildcard (MongoDB 7.0+)
  @@index([tenantId, wildcard(metadata)])

  // Compound wildcard with projection
  @@index([tenantId, wildcard()], include: "[metadata]")
}
```

#### `@@unique` / `@unique` — unique indexes

These are shorthand for `@@index` with `unique: true`. Wildcard fields are not valid in unique indexes.

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique

  @@unique([email, tenantId])

  // With collation
  @@unique([email], collationLocale: "en", collationStrength: 2)

  // With partial filter
  @@unique([email], filter: "{\"active\": true}")
}
```

#### `@@textIndex` — text search indexes

Text indexes have a fundamentally different option surface (`weights`, `default_language`, `language_override`) and different query semantics (queried via `$text`, not standard comparison). A dedicated attribute simplifies the compatibility model.

```prisma
model Article {
  id    ObjectId @id @map("_id")
  title String
  body  String

  // Basic text index
  @@textIndex([title, body])

  // With weights and language
  @@textIndex([title, body], weights: "{\"title\": 10, \"body\": 5}", language: "english", languageOverride: "idioma")
}
```

Note: Only one text index is permitted per collection (MongoDB limitation). The interpreter should validate this.

### Collation as named scalar arguments

Rather than encoding collation as a JSON string, we surface its fields as individual named PSL arguments with a `collation` prefix. Collation has a fixed, well-known schema:

| PSL argument | Type | Maps to |
|-------------|------|---------|
| `collationLocale` | string | `collation.locale` (required if any collation arg present) |
| `collationStrength` | 1–5 | `collation.strength` |
| `collationCaseLevel` | boolean | `collation.caseLevel` |
| `collationCaseFirst` | `"upper"` \| `"lower"` \| `"off"` | `collation.caseFirst` |
| `collationNumericOrdering` | boolean | `collation.numericOrdering` |
| `collationAlternate` | `"non-ignorable"` \| `"shifted"` | `collation.alternate` |
| `collationMaxVariable` | `"punct"` \| `"space"` | `collation.maxVariable` |
| `collationBackwards` | boolean | `collation.backwards` |
| `collationNormalization` | boolean | `collation.normalization` |

`collationLocale` is required when any other `collation*` argument is present.

### `filter` for partial filter expressions

The `filter` option accepts a JSON string containing a MongoDB query filter document. This determines which documents are included in the index.

```prisma
@@index([status], filter: "{\"status\": {\"$exists\": true}}")
```

The JSON string is currently necessary because partial filter expressions are arbitrary MongoDB query documents — they cannot be decomposed into a fixed set of scalar arguments. This is the same `parseJsonArg` pattern used for `weights`.

### `include` and `exclude` for wildcard projections

These options refine which field paths a wildcard key covers:

- **`include`**: only index the listed subtrees. PSL value is a field list: `"[metadata, tags]"`.
- **`exclude`**: index everything except the listed subtrees. PSL value is a field list: `"[_class, internalLog]"`.
- `include` and `exclude` are **mutually exclusive**.
- Only valid when the key list contains a `wildcard()` entry.

The interpreter converts these to the contract-level `wildcardProjection`:
- `include: "[a, b]"` → `{ "a": 1, "b": 1 }`
- `exclude: "[a, b]"` → `{ "a": 0, "b": 0 }`

### `wildcard()` function semantics

The `wildcard()` function appears in the field list of `@@index`. It represents the MongoDB `$**` key.

| PSL form | Contract key |
|----------|-------------|
| `wildcard()` | `{ field: "$**", direction: 1 }` |
| `wildcard(metadata)` | `{ field: "metadata.$**", direction: 1 }` |
| `wildcard(foo.bar)` | `{ field: "foo.bar.$**", direction: 1 }` |

The interpreter should validate:
- At most one `wildcard()` in the key list
- `wildcard()` is not used with `@@unique` or `@unique`
- `include`/`exclude` options are only present when `wildcard()` is in the key list
- `expireAfterSeconds` is not combined with `wildcard()`

## Interpreter validation rules

The PSL interpreter should validate the following at authoring time and produce clear diagnostics:

1. **At most one `wildcard()` per index** — "An index can contain at most one wildcard() field"
2. **No wildcard in unique indexes** — "Unique indexes cannot use wildcard() fields"
3. **include/exclude mutual exclusivity** — "Cannot specify both include and exclude on the same index"
4. **include/exclude requires wildcard** — "include/exclude options are only valid when the index contains a wildcard() field"
5. **No TTL with wildcard** — "expireAfterSeconds cannot be combined with wildcard() fields"
6. **No wildcard with hashed/geo/text** — "wildcard() fields cannot be combined with type: hashed/2dsphere/2d/text"
7. **One text index per collection** — "Only one @@textIndex is allowed per collection"
8. **Hashed single-field** — "Hashed indexes must have exactly one field"
9. **collationLocale required** — "collationLocale is required when using collation options"

## Contract mapping

The PSL surface maps directly to the existing `MongoStorageIndex` contract type without changes:

```typescript
interface MongoStorageIndex {
  readonly keys: ReadonlyArray<MongoIndexKey>;  // from field list + wildcard()
  readonly unique?: boolean;                     // from @@unique or @unique
  readonly sparse?: boolean;                     // from sparse: arg
  readonly expireAfterSeconds?: number;           // from expireAfterSeconds: arg
  readonly partialFilterExpression?: Record<string, unknown>;  // from filter: JSON arg
  readonly wildcardProjection?: Record<string, 0 | 1>;         // from include/exclude args
  readonly collation?: Record<string, unknown>;                // from collation* args
  readonly weights?: Record<string, number>;                   // from weights: JSON arg
  readonly default_language?: string;                          // from language: arg
  readonly language_override?: string;                         // from languageOverride: arg
}
```

No changes to the contract types are required.

## Scope

This design covers the PSL authoring surface only. The TS authoring surface (`contract-ts`) is out of scope for now.

## Open questions

None — all design questions have been resolved through discussion.
