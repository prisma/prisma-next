# Value Objects in the Contract

Working document capturing design decisions and open questions about representing value objects in the Prisma Next contract.

## The key insight: framework guarantees, not structural constraints

The distinction between a model and a value object is not about what fields they have — it's about what the framework promises.

**Model (entity):** The framework guarantees global unique addressability. Everything built on that guarantee — querying from a root, targeting a specific entity for mutation, `include` resolution, identity-based deduplication — depends on the promise that each model instance is uniquely identifiable across the system. The framework enforces this.

**Value object:** The framework provides type structure but no identity guarantees and no behavioural hooks. A value object can have whatever fields you want, including something that looks like an `_id`. But the framework won't treat it as meaningful. The data is structured values, nothing more.

This means putting a unique identifier on a value object is allowed — the framework won't stop you — but none of the capabilities that depend on unique addressability will function. You can't query value objects from a root. You can't target them for independent mutation. They are interchangeable instances of structured data.

### The full capability gap

The distinction goes beyond identity. Models are full framework citizens — the framework builds an entire capability surface around them. Value objects are typed data structures with none of that surface:

| Capability | Models | Value objects |
|---|---|---|
| **Global unique addressability** | Guaranteed | Not guaranteed |
| **Query entry point** (roots) | Yes | No |
| **Identity-based mutation** | Yes — target by ID | No — replaced wholesale |
| **Business logic association** | Yes — custom collection classes, domain methods | No |
| **Lifecycle hooks** | Yes — `onCreate`, `onUpdate`, `onDelete` | No |
| **Referential integrity** | Yes — cascading deletes, restrict constraints | No |
| **Include resolution** | Yes — loaded via `include` | No — inlined in parent row |

Models will have associated business logic. In OOP terms, they're class instances with methods. Even though our ORM may not instantiate classes directly, we expect users to attach domain logic to their models (custom collection methods, validation, computed properties). Lifecycle events matter too — deleting a User has application-wide consequences (cancel orders, stop emails, clean up references). The framework will provide hooks for these events.

None of this applies to value objects. Replacing a User's Address doesn't trigger lifecycle hooks. No referential integrity check fires when an Address changes. No business logic is associated with the Address type. It's data.

### Framework commitment levels

| Declaration | Framework commitment |
|---|---|
| In `roots` | "The framework provides this as a query entry point" |
| In `models` | "Full framework citizen — identity, lifecycle, business logic, integrity" |
| `owner` on a model | "Full citizen, scoped within the owner's aggregate" |
| In `valueObjects` | "Typed data structure — no identity, no lifecycle, no hooks" |

Each is a level of framework commitment, not a structural restriction on what fields you can declare.

### Examples

**GeoPoint** — the purest case. You don't care about the identity of a geometric point. It's a data structure with `lat` and `lng`. Two instances with the same values are completely interchangeable.

**Address** — slightly more nuanced. A User might have a "home address" and a "work address." Those addresses have identity *within the scope of the User* (distinguishable by their role — the relation name on the parent), but they don't have identity outside that context. The identity comes from the parent's relation, not from the Address itself.

**Money** — `{ amount: 100, currency: "USD" }`. Pure data. Two Money instances with the same amount and currency are the same thing.

## Decisions

### 1. Value objects are a top-level contract section

Value objects are described as independent data structures in a top-level `valueObjects` section alongside `models`. They use the same field shape (`{ nullable, codecId }`) as model fields:

```json
{
  "roots": { "users": "User" },
  "models": { ... },
  "valueObjects": {
    "GeoPoint": {
      "fields": {
        "lat": { "nullable": false, "codecId": "mongo/double@1" },
        "lng": { "nullable": false, "codecId": "mongo/double@1" }
      }
    },
    "Address": {
      "fields": {
        "street": { "nullable": false, "codecId": "mongo/string@1" },
        "city": { "nullable": false, "codecId": "mongo/string@1" },
        "location": { "nullable": true, "type": "GeoPoint" }
      }
    }
  }
}
```

The exact key name (`valueObjects` vs something else) is cosmetic and can be decided later. The important point: value objects are not models. They belong in a separate section because they carry a fundamentally different level of framework commitment.

**Why not inside `models`?** Conflates two concepts with different framework guarantees. Consumers iterating `models` would need to filter by kind. The `models` section carries an implicit promise: everything here is a full framework citizen with identity, lifecycle, and integrity guarantees. Value objects don't get that promise.

**Why not a lightweight type alias?** Loses the `{ nullable, codecId }` structure. Value objects need the same field descriptors as models — nullability and type information are just as important for type inference and validation.

### 2. Fields are either scalar or composite — mutually exclusive

A field that holds a scalar value has `codecId`. A field that holds a value object has `type`. Never both:

```json
"User": {
  "fields": {
    "email":   { "nullable": false, "codecId": "mongo/string@1" },
    "address": { "nullable": false, "type": "Address" },
    "addresses": { "nullable": false, "type": "Address", "many": true }
  }
}
```

`codecId` identifies a scalar type (encoded/decoded by a codec). `type` references a value object definition. A value object is a structured composite, not a single encoded value — it doesn't have a codec.

This applies uniformly: value object fields can appear on models *and* on other value objects. An Address can reference a GeoPoint. A NavItem can reference itself:

```json
"NavItem": {
  "fields": {
    "label": { "nullable": false, "codecId": "mongo/string@1" },
    "url": { "nullable": false, "codecId": "mongo/string@1" },
    "children": { "nullable": false, "type": "NavItem", "many": true }
  }
}
```

### 3. Cardinality: `many` on value objects, `cardinality` on relations

Two orthogonal dimensions apply to value object references: **nullability** (`nullable`) and **cardinality** (`many`):

```json
"address":   { "type": "Address", "nullable": false }
"address":   { "type": "Address", "nullable": true }
"addresses": { "type": "Address", "nullable": false, "many": true }
"addresses": { "type": "Address", "nullable": true, "many": true }
```

`nullable` means "can this value be null/absent" — applies to both singular values and lists. A nullable list (`nullable: true, many: true`) means the list itself can be null, which is semantically different from an empty list.

Relations keep `cardinality: "1:N" | "N:1" | "1:1"` because they encode bidirectional semantics — "I have one manager" (`N:1`) is different from "I have one passport" (`1:1`) even though both are "one from my side." Value object references have no "other side," so `many: true/false` is sufficient.

Relations also gain `nullable` (a new property, resolving the open question from [ADR 174](../../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)). A User's manager relation is `N:1` but may be null (no manager assigned).

### 4. Fixed-length lists don't need contract representation

If the positions have semantic meaning — and they almost always do — use named fields:

```json
"BoundingBox": {
  "fields": {
    "topLeft": { "type": "GeoPoint", "nullable": false },
    "bottomRight": { "type": "GeoPoint", "nullable": false }
  }
}
```

This is more expressive than a fixed-length list. You say `boundingBox.topLeft`, not `boundingBox[0]`. The domain meaning is in the contract, not inferred from position. Length constraints on homogeneous lists (rare in domain modeling) are a validation concern, not a structural one.

## Complete example

Putting it all together — a Mongo contract with value objects:

```json
{
  "roots": {
    "users": "User"
  },
  "models": {
    "User": {
      "fields": {
        "_id": { "nullable": false, "codecId": "mongo/objectId@1" },
        "email": { "nullable": false, "codecId": "mongo/string@1" },
        "homeAddress": { "nullable": true, "type": "Address" },
        "previousAddresses": { "nullable": false, "type": "Address", "many": true }
      },
      "relations": { ... },
      "storage": { "collection": "users" }
    }
  },
  "valueObjects": {
    "Address": {
      "fields": {
        "street": { "nullable": false, "codecId": "mongo/string@1" },
        "city": { "nullable": false, "codecId": "mongo/string@1" },
        "location": { "nullable": true, "type": "GeoPoint" }
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

The resulting TypeScript row type:

```typescript
type UserRow = {
  _id: ObjectId;
  email: string;
  homeAddress: { street: string; city: string; location: { lat: number; lng: number } | null } | null;
  previousAddresses: { street: string; city: string; location: { lat: number; lng: number } | null }[];
}
```

### 5. Value objects need no special storage mapping

Value object fields use `storage.fields` like any other field. The storage layer doesn't know or care that a field contains structured data — it just maps domain field names to physical locations:

**Mongo:**

```json
"storage": {
  "collection": "users",
  "fields": {
    "email": { "field": "email" },
    "homeAddress": { "field": "home_address" }
  }
}
```

**SQL:**

```json
"storage": {
  "table": "users",
  "fields": {
    "email": { "column": "email" },
    "homeAddress": { "column": "home_address" }
  }
}
```

The composite *structure* of what's inside the field comes from the value object definition in the domain section. The storage mapping just says where the data lives. The ORM combines both: "this field is an Address (so I know the shape) and it lives in this column (so I know where to read/write it)."

This is the domain/storage separation doing what it was designed for. No new storage sections, no new mapping concepts.

### 6. Validation cross-references domain and storage

For SQL, the column backing a value object field must be JSON-compatible (e.g., `jsonb`). The top-level `storage` section already describes every column's native type:

```json
"storage": {
  "tables": {
    "users": {
      "columns": {
        "home_address": { "nativeType": "jsonb", "nullable": true }
      }
    }
  }
}
```

Contract validation (`validateSqlStorage()`) cross-references the domain field type with the storage column's native type — if a value object field maps to an `integer` column, that's a validation error.

For Mongo, there's nothing to validate — any document field can hold a subdocument.

The full chain:

| Layer | Responsibility |
|---|---|
| **Emitter** | Generates the correct column type (JSONB) when it sees a value object field |
| **Contract validation** | Cross-references domain field type with column native type — rejects mismatches |
| **Migration system** | Creates/alters the column to be JSONB |
| **Database** | Enforces the column type at write time |

## Open design questions

### 2. Querying through value objects

Dot-notation filtering through value object fields:

```typescript
db.users.where(u => u.homeAddress.city.eq("NYC"))
```

- Mongo: `{ "homeAddress.city": "NYC" }`
- SQL JSONB: `address_data->>'city' = 'NYC'`
- SQL flattened: `address_city = 'NYC'`

The query builder needs the value object's field structure to offer type-safe dot-notation access.

### 3. Mutation semantics

Value objects are replaced, not patched by identity:

```typescript
db.users.where({ id }).update({
  homeAddress: { street: "456 Oak Ave", city: "LA", location: null }
})
```

This replaces the entire address. There's no "update the address where `_id` = X" because the framework doesn't track value object identity. In Mongo, this compiles to `$set: { homeAddress: { street: "456 Oak Ave", city: "LA", location: null } }`.

Whether partial updates of value object fields are supported (`update({ homeAddress: { city: "LA" } })` meaning "change only the city") is a UX question — it's technically possible (`$set: { "homeAddress.city": "LA" }`) but may violate the "value objects are replaced wholesale" semantics.

### 4. Can value objects be polymorphic?

A `ContactInfo` that's either `{ type: "email", address: "..." }` or `{ type: "phone", number: "..." }`. This intersects with Q16 (union field types) and ADR 173 (discriminators). Probably out of scope for the initial design.

### 5. Contract key naming

The exact key name for the value objects section (`valueObjects`, `types`, `composites`, etc.) is a cosmetic decision that should be made before the contract shape stabilises. `valueObjects` is the working name.

## Related

- [ADR 177 — Ownership replaces relation strategy](../../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — owned models vs value objects
- [ADR 174 — Aggregate roots and relation strategies](../../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — nullable relations open question
- [design-questions.md § Q16](design-questions.md#16-union-field-types-mixed-type-fields) — union field types
- [design-questions.md § Q19](design-questions.md#19-self-referential-models) — self-referential models (parallel concept for value objects)
- [Glossary — Value Object](../../../glossary.md#value-object) — current definition
- [cross-cutting-learnings.md § learning #5](../cross-cutting-learnings.md) — models are entities, not just data descriptions
