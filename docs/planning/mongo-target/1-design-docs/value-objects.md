# Value Objects in the Contract

Working document capturing design decisions and open questions about representing value objects in the Prisma Next contract.

## The key insight: framework guarantees, not structural constraints

The distinction between a model and a value object is not about what fields they have — it's about what the framework promises.

**Model (entity):** The framework guarantees global unique addressability. Everything built on that guarantee — querying from a root, targeting a specific entity for mutation, `include` resolution, identity-based deduplication — depends on the promise that each model instance is uniquely identifiable across the system. The framework enforces this.

**Value object:** The framework provides type structure but makes no identity guarantees. A value object can have whatever fields you want, including something that looks like an `_id`. But the framework won't treat it as meaningful. You don't get roots, you don't get independent queries, you don't get identity-based mutation targeting. The data is structured values, nothing more.

This means putting a unique identifier on a value object is allowed — the framework won't stop you — but none of the capabilities that depend on unique addressability will function. You can't query value objects from a root. You can't target them for independent mutation. They are interchangeable instances of structured data.

This framing parallels how other contract declarations work:

| Declaration | Framework guarantee |
|---|---|
| In `roots` | "The framework provides this as a query entry point" |
| In `models` | "The framework guarantees global unique addressability" |
| `owner` on a model | "The framework guarantees addressability within the owner's scope" |
| In `valueObjects` | "The framework provides type structure but no identity guarantees" |

Each is a level of framework commitment, not a structural restriction on what fields you can declare.

### Examples

**GeoPoint** — the purest case. You don't care about the identity of a geometric point. It's a data structure with `lat` and `lng`. Two instances with the same values are completely interchangeable.

**Address** — slightly more nuanced. A User might have a "home address" and a "work address." Those addresses have identity *within the scope of the User* (distinguishable by their role — the relation name on the parent), but they don't have identity outside that context. The identity comes from the parent's relation, not from the Address itself.

**Money** — `{ amount: 100, currency: "USD" }`. Pure data. Two Money instances with the same amount and currency are the same thing.

## Open design questions

### 1. Where do value objects live in the contract?

**Option A — top-level `valueObjects` section alongside `models`:**

```json
{
  "roots": { ... },
  "models": { ... },
  "valueObjects": {
    "Address": {
      "fields": {
        "street": { "nullable": false, "codecId": "mongo/string@1" },
        "city": { "nullable": false, "codecId": "mongo/string@1" }
      }
    },
    "GeoPoint": {
      "fields": {
        "lat": { "nullable": false, "codecId": "mongo/double@1" },
        "lng": { "nullable": false, "codecId": "mongo/double@1" }
      }
    }
  }
}
```

Clear separation. A consumer can enumerate all value objects without filtering models. The `fields` shape is identical to `model.fields` — same `{ nullable, codecId }` structure.

**Option B — inside `models` with a discriminating property:**

```json
"Address": {
  "kind": "valueObject",
  "fields": { ... }
}
```

Keeps everything in one dictionary. But conflates two fundamentally different concepts — models have identity guarantees, value objects don't. Consumers that iterate `models` would need to filter by `kind`.

**Option C — a lightweight type alias section:**

```json
"types": {
  "Address": { "street": "mongo/string@1", "city": "mongo/string@1" }
}
```

Simpler shape, but loses the `{ nullable, codecId }` structure that the rest of the contract uses. Would need its own field format.

### 2. How does a model reference a value object?

Currently `model.fields` has scalar entries (`{ nullable, codecId }`) and `model.relations` has graph edges to other models. A value object is composite data — neither a scalar field nor a model relation.

**Option A — value objects as a special codecId:**

```json
"fields": {
  "address": { "nullable": false, "codecId": "valueObject/Address" }
}
```

Keeps the field shape uniform. But overloads `codecId` — codecs encode/decode scalar values; a value object is a structured composite, not a single encoded value.

**Option B — a dedicated section on the model:**

```json
"User": {
  "fields": { ... },
  "relations": { ... },
  "embeds": {
    "address": { "type": "Address", "cardinality": "1:1" },
    "previousAddresses": { "type": "Address", "cardinality": "1:N" }
  }
}
```

Clear separation. But the model now has three different kinds of properties (fields, relations, embeds) that all contribute to the ORM's row type.

**Option C — value objects as relation targets:**

```json
"relations": {
  "address": { "to": "Address", "cardinality": "1:1" }
}
```

Where `Address` is defined in `valueObjects`, not `models`. Reuses existing relation machinery. But blurs the model/value-object boundary — the ORM would need to check whether the relation target is a model or a value object to determine behavior.

### 3. How do value objects map to storage?

The physical representation is family-specific:

- **Mongo**: Embedded subdocument. Identity mapping (domain fields = document fields). Natural fit.
- **SQL JSONB**: Serialized into a single JSON column.
- **SQL flattened columns**: Each value object field maps to a separate column with a prefix convention (`address_street`, `address_city`).

The storage mapping probably lives on the parent model's `storage` section, parallel to `storage.fields` and `storage.relations`:

**Mongo:**

```json
"storage": {
  "collection": "users",
  "embeds": {
    "address": { "field": "address" }
  }
}
```

**SQL (JSONB):**

```json
"storage": {
  "table": "users",
  "embeds": {
    "address": { "column": "address_data" }
  }
}
```

**SQL (flattened):** Open question — how to represent column-per-field mapping for a value object.

### 4. How do value objects affect the ORM row type?

A User with an Address and a list of previous Addresses should produce:

```typescript
type UserRow = {
  id: string;
  email: string;
  address: { street: string; city: string };
  previousAddresses: { street: string; city: string }[];
}
```

Value object fields are always inlined into the parent row — there's no `include` step, because the data is always co-located. This is different from owned models, which may require explicit include resolution.

### 5. Can value objects contain other value objects?

An Address might contain a GeoPoint. A DateRange might contain two Date scalars. If value objects can nest, the type inference and storage mapping need to handle recursion — similar to the self-referential embedding question (Q19), but without the identity complication.

### 6. Querying through value objects

Dot-notation filtering through value object fields:

```typescript
db.users.where(u => u.address.city.eq("NYC"))
```

- Mongo: `{ "address.city": "NYC" }`
- SQL JSONB: `address_data->>'city' = 'NYC'`
- SQL flattened: `address_city = 'NYC'`

The query builder needs the value object's field structure to offer type-safe dot-notation access.

### 7. Mutation semantics

Value objects are replaced, not patched by identity:

```typescript
db.users.where({ id }).update({
  address: { street: "456 Oak Ave", city: "LA" }
})
```

This replaces the entire address. There's no "update the address where `_id` = X" because the framework doesn't track value object identity. In Mongo, this compiles to `$set: { address: { street: "456 Oak Ave", city: "LA" } }` (whole-document replacement, not field-level merge).

Whether partial updates of value object fields are supported (`update({ address: { city: "LA" } })` meaning "change only the city") is a UX question — it's technically possible (`$set: { "address.city": "LA" }`) but may violate the "value objects are replaced wholesale" semantics.

### 8. Can value objects be polymorphic?

A `ContactInfo` that's either `{ type: "email", address: "..." }` or `{ type: "phone", number: "..." }`. This intersects with Q16 (union field types) and ADR 173 (discriminators). Probably out of scope for the initial design.

## Related

- [ADR 177 — Ownership replaces relation strategy](../../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — owned models vs value objects
- [design-questions.md § Q16](design-questions.md#16-union-field-types-mixed-type-fields) — union field types
- [Glossary — Value Object](../../../glossary.md#value-object) — current definition
- [cross-cutting-learnings.md § learning #5](../cross-cutting-learnings.md) — models are entities, not just data descriptions
