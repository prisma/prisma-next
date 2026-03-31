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

### 7. Value object support is capability-gated

Value objects in SQL require JSON-compatible columns (e.g., `jsonb`). Not all SQL targets support this. This makes value objects the first domain-level contract concept whose availability depends on a target capability.

The constraint is **enforced at the storage level**: if the target can't produce a JSON-compatible column, the emitter can't generate valid storage for a value object field — emission fails. There's no way to describe a column capable of storing a value object without JSON support, so the failure is natural and unavoidable.

The constraint is **surfaced at the authoring level** via a declared capability: the target declares a capability (e.g., `valueObject` or `structuredColumns`), and the authoring surface (PSL parser, TS contract builder) checks it upfront. If the capability is absent, the user gets a clear error ("your target doesn't support value objects") before they write an entire schema that can't be emitted.

For Mongo, this isn't an issue — subdocuments are always available. No capability check needed.

This follows the existing pattern: capabilities are checked early by authoring surfaces for good UX, and enforced at emission/validation as a safety net.

### 8. Polymorphic value objects use discriminator/variants/base

Value objects can be polymorphic using the same mechanism as models ([ADR 173](../../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)). A base value object declares a `discriminator` and `variants`; each variant declares its `base` and adds type-specific fields:

```json
"valueObjects": {
  "ContactInfo": {
    "discriminator": { "field": "channel" },
    "variants": {
      "EmailContact": { "value": "email" },
      "PhoneContact": { "value": "phone" }
    },
    "fields": {
      "channel": { "nullable": false, "codecId": "mongo/string@1" }
    }
  },
  "EmailContact": {
    "base": "ContactInfo",
    "fields": {
      "address": { "nullable": false, "codecId": "mongo/string@1" }
    }
  },
  "PhoneContact": {
    "base": "ContactInfo",
    "fields": {
      "number": { "nullable": false, "codecId": "mongo/string@1" }
    }
  }
}
```

TypeScript inference produces `ContactInfo = EmailContact | PhoneContact`, narrowed by the `channel` discriminator — the same narrowing pattern the ORM already uses for model polymorphism. The only difference is the framework commitment level: polymorphic value objects don't get identity, lifecycle, or integrity guarantees.

Real-world examples: `ContactInfo` (email vs phone vs push), `PaymentMethod` (card vs bank), `MediaAttachment` (image vs video), form field definitions (text vs select vs number).

### 9. Union types: `union` as a field type descriptor

A field can hold one of several types — scalars, value objects, or a mix. The `union` property handles this as a third mutually exclusive field type descriptor alongside `codecId` and `type`:

```json
"fields": {
  "email":    { "nullable": false, "codecId": "mongo/string@1" },
  "address":  { "nullable": false, "type": "Address" },
  "score":    { "nullable": false, "union": [
    { "codecId": "mongo/int32@1" },
    { "codecId": "mongo/string@1" }
  ]},
  "location": { "nullable": false, "union": [
    { "type": "Address" },
    { "type": "GeoPoint" }
  ]},
  "data":     { "nullable": false, "union": [
    { "codecId": "mongo/string@1" },
    { "type": "Address" }
  ]}
}
```

Each union member makes the same `codecId` vs `type` choice that a field does. The field type system is:

| Property | Meaning | Example |
|---|---|---|
| `codecId` | One scalar type | `"mongo/string@1"` |
| `type` | One value object | `"Address"` |
| `union` | Multiple types (any mix of scalars and value objects) | `[{ "codecId": "..." }, { "type": "..." }]` |

All three are mutually exclusive on a field. `codecId` and `type` are the degenerate single-member cases; `union` is the general form.

### Structured vs unstructured unions

Polymorphic value objects (decision 8) and union types (decision 9) are both unions, but they serve different needs:

| | Polymorphic value object | `union` field |
|---|---|---|
| **Discriminated?** | Yes — explicit discriminator field | No — runtime type inspection |
| **Shared base?** | Yes — variants share fields via `base` | No — members are independent types |
| **Type narrowing** | Discriminator value narrows the type | `typeof` / structural inspection |
| **Use case** | Structured variants with shared fields | Heterogeneous values, schema evolution, mixed types |

Both produce TypeScript union types. The polymorphic pattern is stronger (compile-time narrowing via discriminator), while `union` is more flexible (any mix of types, no shared structure required).

This also resolves [design-questions.md § Q16](design-questions.md#16-union-field-types-mixed-type-fields) — union field types are handled by the `union` property, which subsumes all three options previously considered.

### 10. Querying through value objects: string accessor with type-checked dot-paths

Scalar fields on a model are accessed as direct properties on the expression proxy (`u.email`, `u.age`), returning an `Expression` with trait-gated operators. Value object fields use a **string accessor** — the proxy is callable with a dot-path string that navigates into nested value objects:

```typescript
// Scalar field — direct property access (existing pattern)
u.email.eq("alice@example.com")
u.age.gte(18)

// Value object field — string accessor, returns typed Expression
u("homeAddress.city").eq("NYC")
u("homeAddress.location.lat").gte(40.0)

// Extension operations work through value objects too
u("specs.featureVector").cosineDistance([1, 0, 0]).lt(0.5)

// Nullable value object — whole-object null check
u("workAddress").isNull()

// Combining scalar and value object conditions
fns.and(
  u.age.gte(18),
  u("homeAddress.city").eq("NYC"),
)
```

The returned `Expression` carries the same trait-gated operators and extension methods as any scalar expression. A text field reached via `u("homeAddress.city")` has `eq`, `gt`, `like` — the same methods as `u.email`. A vector field reached via `u("specs.featureVector")` has `cosineDistance` — the same methods as a direct vector column.

**Why a string accessor, not property chaining (`u.homeAddress.city`)?**

Property chaining creates a **namespace collision problem**: intermediate proxy objects for value objects would need both field accessors (the value object's fields) and operator methods (`eq`, `gt`, etc.) on the same object. If a value object has a field named `eq`, `gt`, or any operator name, the API breaks. This is the same collision problem that Prisma ORM encountered with its proxy-based approach.

The string accessor eliminates collision entirely:
- Scalar fields and operator methods never share a namespace
- Scalar fields are properties on the model proxy (`u.email`)
- Operators are methods on the returned `Expression` (`...eq("NYC")`)
- Value object traversal uses the call signature (`u("path")`)

**Type safety and autocomplete via recursive template literal types:**

The dot-path string is type-checked at compile time using TypeScript template literal inference. The same technique enables IDE autocomplete — ArkType demonstrates this pattern at scale with arbitrary-depth recursive grammars.

The key insight: autocomplete doesn't require eagerly enumerating all possible paths. At any cursor position in a dot-path, the set of valid next tokens is finite — it's just the field names of whichever value object you've navigated into. Recursive conditional types compute these completions lazily:

```typescript
// Validation: resolves the type at the end of a dot-path
type ResolvePath<T, Path extends string> =
  Path extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
      ? ResolvePath<T[Head], Rest>
      : never
    : Path extends keyof T
      ? T[Path]
      : never;

// Autocomplete: computes valid completions at the cursor position
// After typing "homeAddress.", suggests "city", "street", "zip", "location"
// After typing "homeAddress.location.", suggests "lat", "lng"
// Self-referential types (NavItem.children.) just re-suggest NavItem's fields
type PathCompletions<Fields, Prefix extends string = ""> =
  | { [K in keyof Fields & string]:
      | `${Prefix}${K}`
      | (Fields[K] extends ValueObjectRef<infer VO>
          ? PathCompletions<VO["fields"], `${Prefix}${K}.`>
          : never)
    }[keyof Fields & string];
```

This handles self-referential value objects safely — `NavItem.children.` re-suggests `label`, `url`, `children` without infinite expansion, because TypeScript evaluates recursive conditional types lazily (only the depth the user has typed so far).

Typing `u("` shows top-level value object fields. Typing `u("homeAddress.` shows Address fields. Each `.` narrows to the next level, exactly like property chaining — but without the namespace collision risk.

**Backend translation:**

| Target | `u("homeAddress.city").eq("NYC")` |
|---|---|
| **Mongo** | `{ "homeAddress.city": "NYC" }` — native dot-notation |
| **SQL JSONB** | `home_address->>'city' = 'NYC'` — JSON path extraction |
| **SQL flattened** | `home_address_city = 'NYC'` — if stored as separate column |

## Open design questions

### 3. Mutation semantics

Value objects are replaced, not patched by identity:

```typescript
db.users.where({ id }).update({
  homeAddress: { street: "456 Oak Ave", city: "LA", location: null }
})
```

This replaces the entire address. There's no "update the address where `_id` = X" because the framework doesn't track value object identity. In Mongo, this compiles to `$set: { homeAddress: { street: "456 Oak Ave", city: "LA", location: null } }`.

Whether partial updates of value object fields are supported (`update({ homeAddress: { city: "LA" } })` meaning "change only the city") is a UX question — it's technically possible (`$set: { "homeAddress.city": "LA" }`) but may violate the "value objects are replaced wholesale" semantics.

### 4. Contract key naming

The exact key name for the value objects section (`valueObjects`, `types`, `composites`, etc.) is a cosmetic decision that should be made before the contract shape stabilises. `valueObjects` is the working name.

## Related

- [ADR 177 — Ownership replaces relation strategy](../../../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — owned models vs value objects
- [ADR 174 — Aggregate roots and relation strategies](../../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md) — nullable relations open question
- [design-questions.md § Q16](design-questions.md#16-union-field-types-mixed-type-fields) — union field types
- [design-questions.md § Q19](design-questions.md#19-self-referential-models) — self-referential models (parallel concept for value objects)
- [Glossary — Value Object](../../../glossary.md#value-object) — current definition
- [cross-cutting-learnings.md § learning #5](../cross-cutting-learnings.md) — models are entities, not just data descriptions
