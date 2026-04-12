# PSL Index Authoring Surface for MongoDB

## Grounding example

Today, a user can declare basic indexes in PSL:

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique
  bio   String

  @@index([email, bio])
  @@index([bio], type: "text", weights: "{\"bio\": 10}")
}
```

But MongoDB supports several index features that users **cannot yet express** in PSL:

- **Wildcard indexes** — index all subpaths of a nested document (e.g. a schemaless `metadata` field) without naming each path upfront
- **Collation** — control how string comparison works (locale, case-sensitivity, accent-sensitivity) so that queries can match `"café"` and `"Café"` correctly
- **Partial indexes** — index only documents matching a filter (e.g. only `status: "active"` documents), saving storage and write overhead
- **Wildcard projections** — when using a wildcard index, limit coverage to specific subtrees (include) or exclude certain paths

These features are already supported in the contract types and migration pipeline. This doc defines how users author them via PSL.

This design depends on the PSL value model extensions described in [PSL Language Specification](psl-language-spec.md) (object literals, function calls as first-class values) and the binding model described in [PSL Binding Model](psl-binding-model.md) (scoped function definitions, attribute argument validation).

## Decision summary

**Four key decisions:**

1. **`wildcard()` function in field lists.** MongoDB's wildcard key is `$**`, but `$` and `*` would break the PSL grammar. Instead, users write `wildcard()` (optionally scoped: `wildcard(metadata)`). This maps to `$**` / `metadata.$**` in the contract. `wildcard` is a function scoped to the `@@index` attribute definition.

2. **`@@textIndex` as a dedicated attribute.** Text indexes have a fundamentally different option set (`weights`, `language`, `languageOverride`) and different query semantics (queried via `$text`, not standard comparison). A separate `@@textIndex` attribute makes each form self-documenting, avoiding a complex compatibility matrix.

3. **Object literals for structured options.** `filter`, `collation`, and `weights` use PSL object literals — `{ status: "active" }`, `{ locale: "fr", strength: 2 }`, `{ title: 10, body: 5 }` — instead of escaped JSON strings. This is enabled by the typed value model extension to the PSL parser.

4. **`include`/`exclude` field lists for wildcard projections.** Rather than MongoDB's `0`/`1` projection document, users specify field lists: `include: [metadata, tags]`. The binding layer resolves these as field references in the enclosing entity's scope.

## Syntax by example

### Regular indexes — `@@index`

The common case. Fields are ordered, direction defaults to ascending.

```prisma
model Events {
  id        ObjectId @id @map("_id")
  status    String
  tenantId  String
  expiresAt DateTime

  @@index([status])                  // ascending on one field
  @@index([status, tenantId])        // compound ascending
}
```

#### TTL and sparse

A TTL index automatically deletes documents after a duration. `sparse` skips documents where the indexed field is missing.

```prisma
  @@index([expiresAt], sparse: true, expireAfterSeconds: 3600)
```

#### Partial indexes with `filter`

A *partial index* only covers documents matching a MongoDB query filter. This reduces index size and write cost when queries always target a subset.

```prisma
  @@index([status], filter: { status: "active" })
  @@index([email], filter: { email: { $exists: true } })
```

The value is a PSL object literal. MongoDB restricts partial filter expressions to a small set of operators: `$eq` (implicit), `$exists`, `$gt`, `$gte`, `$lt`, `$lte`, `$type`, `$and`, `$or`.

Note: `$`-prefixed keys like `$exists` require the tokenizer to support `$` in identifier positions within object literal keys, or for these keys to be quoted strings. This is an open tokenizer question (see [PSL Language Specification](psl-language-spec.md)).

#### Collation

Collation controls locale-aware string comparison for the index. A query can only *use* a collated index if it specifies the same collation, so this is a deliberate user choice.

```prisma
  @@index([status], collation: { locale: "fr", strength: 2 })
```

`strength` controls what differences matter:
- **1**: base characters only (a = A = á)
- **2**: base + accents (a = A, but a ≠ á)
- **3**: base + accents + case (default)

The full set of collation fields:

| Key | Type | Description |
|-----|------|-------------|
| `locale` | String | ICU locale (required) |
| `strength` | Number (1–5) | Comparison sensitivity level |
| `caseLevel` | Boolean | Enable case-level comparisons |
| `caseFirst` | String (`"upper"`, `"lower"`, `"off"`) | Sort order of case differences |
| `numericOrdering` | Boolean | Numeric string comparison (`"10"` after `"9"`) |
| `alternate` | String (`"non-ignorable"`, `"shifted"`) | Whitespace/punctuation handling |
| `maxVariable` | String (`"punct"`, `"space"`) | Characters affected by `alternate: "shifted"` |
| `backwards` | Boolean | Reverse secondary differences (French dictionary order) |
| `normalization` | Boolean | Unicode normalization |

#### Hashed and geospatial indexes

These are rare, specialized index types. Hashed indexes are used for shard keys. Geospatial indexes (`2dsphere`, `2d`) support location queries. They stay under `@@index` with a `type` discriminator:

```prisma
  @@index([tenantId], type: hashed)        // shard key
  @@index([location], type: "2dsphere")    // geospatial
```

Hashed indexes must have exactly one field. Neither hashed nor geo indexes support wildcard fields or uniqueness.

#### Wildcard indexes

A wildcard index covers all subpaths of a document (or a subtree) without naming them upfront. This is useful for schemaless nested data — e.g. a `metadata` field with arbitrary user-defined keys.

In MongoDB, the wildcard key is `$**`, meaning "every field path, recursively." In PSL, we represent this with the `wildcard()` function in the field list. `wildcard` is a function scoped to the `@@index` attribute — it is only available within `@@index`'s field list argument.

```prisma
model Events {
  id       ObjectId @id @map("_id")
  tenantId String
  metadata Json
  tags     Json

  // All fields in the document
  @@index([wildcard()])

  // Scoped to a subtree — all paths under metadata
  @@index([wildcard(metadata)])

  // Compound wildcard (MongoDB 7.0+) — fixed field + wildcard
  @@index([tenantId, wildcard(metadata)])
}
```

`wildcard()` maps to `$**` in the contract. `wildcard(metadata)` maps to `metadata.$**`. The `$**` is always a terminal — it means "recurse from this point down." The argument to `wildcard()` is a field reference resolved in the enclosing entity's scope.

**Projections with `include`/`exclude`.** When using `wildcard()` without a scope argument, you can narrow coverage to specific subtrees with `include`, or index everything except certain paths with `exclude`:

```prisma
  // Only index metadata and tags subtrees
  @@index([wildcard()], include: [metadata, tags])

  // Index everything except _class and internalLog
  @@index([wildcard()], exclude: [_class, internalLog])
```

`include` and `exclude` are mutually exclusive. Both are field-reference lists resolved in the enclosing entity's scope. The interpreter converts them to the contract's `wildcardProjection`:
- `include: [a, b]` → `{ "a": 1, "b": 1 }`
- `exclude: [a, b]` → `{ "a": 0, "b": 0 }`

**Constraints on wildcard fields:**
- At most **one** `wildcard()` per index
- Cannot be combined with `@@unique` / `@unique` — MongoDB does not support unique wildcard indexes
- Cannot be combined with `expireAfterSeconds` — TTL requires a single concrete date field
- Cannot be combined with `type: hashed`, `"2dsphere"`, or `"2d"`

### Unique indexes — `@@unique` / `@unique`

Shorthand for a regular index with `unique: true`. Supports `filter`, `collation`, `sparse`, and `expireAfterSeconds`, but **not** wildcard fields.

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique                          // field-level

  @@unique([email, tenantId])                      // compound

  @@unique([email], collation: { locale: "en", strength: 2 })   // case-insensitive unique

  @@unique([email], filter: { active: true })      // partial unique
}
```

### Text indexes — `@@textIndex`

Text indexes power MongoDB's full-text search (`$text` queries). They have a fundamentally different option surface from regular indexes, which is why they get their own attribute.

```prisma
model Article {
  id    ObjectId @id @map("_id")
  title String
  body  String

  @@textIndex([title, body])

  @@textIndex([title, body], weights: { title: 10, body: 5 }, language: "english", languageOverride: "idioma")
}
```

Only **one** `@@textIndex` is permitted per collection (MongoDB limitation).

## Validation rules

The binding layer and interpreter validate these constraints at authoring time and produce clear diagnostics:

1. **At most one `wildcard()` per index** — "An index can contain at most one wildcard() field"
2. **No wildcard in unique indexes** — "Unique indexes cannot use wildcard() fields"
3. **`include`/`exclude` mutual exclusivity** — "Cannot specify both include and exclude on the same index"
4. **`include`/`exclude` requires wildcard** — "include/exclude options are only valid when the index contains a wildcard() field"
5. **No TTL with wildcard** — "expireAfterSeconds cannot be combined with wildcard() fields"
6. **No wildcard with hashed/geo/text** — "wildcard() fields cannot be combined with type: hashed/2dsphere/2d or @@textIndex"
7. **One text index per collection** — "Only one @@textIndex is allowed per collection"
8. **Hashed single-field** — "Hashed indexes must have exactly one field"
9. **Collation locale required** — "`locale` is required in the collation object"

## Contract mapping

The PSL surface maps directly to the existing `MongoStorageIndex` contract type. No contract type changes are required.

```typescript
interface MongoStorageIndex {
  readonly keys: ReadonlyArray<MongoIndexKey>;               // from field list + wildcard()
  readonly unique?: boolean;                                  // from @@unique or @unique
  readonly sparse?: boolean;                                  // from sparse: arg
  readonly expireAfterSeconds?: number;                       // from expireAfterSeconds: arg
  readonly partialFilterExpression?: Record<string, unknown>; // from filter: object literal
  readonly wildcardProjection?: Record<string, 0 | 1>;        // from include/exclude field lists
  readonly collation?: Record<string, unknown>;               // from collation: object literal
  readonly weights?: Record<string, number>;                  // from weights: object literal (@@textIndex)
  readonly default_language?: string;                         // from language: arg (@@textIndex)
  readonly language_override?: string;                        // from languageOverride: arg (@@textIndex)
}
```

`wildcard()` maps to the contract's key representation:

| PSL form | Contract key |
|----------|-------------|
| `wildcard()` | `{ field: "$**", direction: 1 }` |
| `wildcard(metadata)` | `{ field: "metadata.$**", direction: 1 }` |
| `wildcard(foo.bar)` | `{ field: "foo.bar.$**", direction: 1 }` |

## Scope

This design covers the PSL authoring surface only. The TS authoring surface (`contract-ts`) is out of scope for now.

## Alternatives considered

### `$**` as a literal in the field list

The most direct mapping would be `@@index([$**])`, mirroring MongoDB syntax exactly. We rejected this because `$` and `*` are `Invalid` tokens in the PSL tokenizer — they'd require grammar changes or escaping, adding complexity for a rare feature. The `wildcard()` function syntax uses the existing PSL function-call value type and is scoped to the `@@index` attribute via the binding model.

### Escaped JSON strings for structured values

The initial design used JSON strings for `filter`, `weights`, and `collation`: `filter: "{\"status\": \"active\"}"`. This works without parser changes but produces unreadable PSL and is error-prone (escaping, no validation). The typed value model extension adds object literal support to the parser, making `filter: { status: "active" }` possible. Since we need the value model extension anyway (for general PSL improvement), there's no reason to keep the JSON-string workaround.

### Collation as decomposed named scalar arguments

We considered surfacing collation fields as individual PSL arguments: `collationLocale: "fr", collationStrength: 2`. This avoids JSON strings but pollutes the `@@index` argument namespace with 9 prefixed arguments. With object literal support, `collation: { locale: "fr", strength: 2 }` is cleaner — the structured value groups naturally, and the binding layer can validate the object's shape.

### Single `@@index` for everything (no `@@textIndex`)

We considered keeping all index types under `@@index` with a `type` discriminator. This works for hashed and geo (rare, simple option sets), but text indexes have a completely different option surface (`weights`, `language`, `languageOverride`) and none of the regular options (`unique`, `expireAfterSeconds`). Overloading `@@index` for text would require a large compatibility matrix and produce confusing validation errors. A dedicated `@@textIndex` makes each attribute's valid options obvious.

### Splitting all index types into separate attributes

We considered `@@hashedIndex`, `@@geoIndex`, `@@wildcardIndex`, etc. We rejected this because:
- Hashed and geo are rare — dedicated attributes add surface area without much benefit
- Wildcard is a field-level concern, not a type — a wildcard index is just a regular index with a glob field
- Three attributes (`@@index`, `@@unique`, `@@textIndex`) cover the space well. The `type` discriminator handles the remaining rare cases.

### Wildcard projections as a JSON-style projection document

MongoDB represents wildcard projections as `{ "metadata": 1, "tags": 1 }` (include) or `{ "_class": 0 }` (exclude). We considered mirroring this as an object literal: `projection: { metadata: 1, tags: 1 }`. We chose `include`/`exclude` field lists instead because:
- They make the intent explicit (no `0`/`1` syntax to learn)
- They are mutually exclusive by design, preventing invalid mixed projections
- The field names are resolved as references in the enclosing entity's scope, enabling validation
