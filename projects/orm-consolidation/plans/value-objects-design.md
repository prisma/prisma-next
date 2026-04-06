# Value Objects & Embedded Documents — Design

**Linear:** [TML-2206](https://linear.app/prisma-company/issue/TML-2206) · **Spec:** [embedded-documents-and-value-objects.spec.md](../specs/embedded-documents-and-value-objects.spec.md)

## Grounding example

A user writes this PSL schema — a `User` with a structured `Address` and a list of tags:

```prisma
type Address {
  street String
  city   String
  zip    String
}

model User {
  id              String    @id @default(auto()) @map("_id") @db.ObjectId
  email           String
  homeAddress     Address?
  previousAddresses Address[]
  tags            String[]
}
```

The `type` keyword declares a **value object** — structured data without identity. An Address with the same street and city as another Address is interchangeable. No lifecycle hooks fire when it changes. No referential integrity check runs when it's replaced. It's just data.

The `model` keyword declares a full framework citizen — identity, lifecycle, hooks, referential integrity. The `type` vs `model` distinction mirrors [Prisma ORM's existing `type` keyword for composite types](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/composite-types).

The authoring layer emits this contract:

```json
{
  "roots": { "users": "User" },
  "models": {
    "User": {
      "fields": {
        "_id":    { "nullable": false, "codecId": "mongo/objectId@1" },
        "email":  { "nullable": false, "codecId": "mongo/string@1" },
        "homeAddress":       { "nullable": true,  "type": "Address" },
        "previousAddresses": { "nullable": false, "type": "Address", "many": true },
        "tags":              { "nullable": false, "codecId": "mongo/string@1", "many": true }
      }
    }
  },
  "valueObjects": {
    "Address": {
      "fields": {
        "street": { "nullable": false, "codecId": "mongo/string@1" },
        "city":   { "nullable": false, "codecId": "mongo/string@1" },
        "zip":    { "nullable": false, "codecId": "mongo/string@1" }
      }
    }
  }
}
```

Three things to notice:

1. **Fields express their type through one of three mutually exclusive properties.** `"codecId": "mongo/string@1"` means a scalar type with a codec. `"type": "Address"` means a reference to a value object definition. (The third option, `"union": [...]`, handles fields that can be more than one type — see [ADR 179](../../../docs/architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md).)

2. **`many: true` works on both scalars and value objects.** `tags` is a scalar array (`string[]`). `previousAddresses` is a value object array (`Address[]`). The modifier is orthogonal to the type specifier.

3. **Value objects live in `valueObjects`, not `models`.** This is the framework commitment distinction ([ADR 178](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md)): models get identity, lifecycle, hooks, and referential integrity. Value objects get typed structure and nothing else. Consumers iterating `models` don't need to filter out value objects.

The emitter generates these TypeScript types:

```ts
type UserRow = {
  _id: ObjectId;
  email: string;
  homeAddress: { street: string; city: string; zip: string } | null;
  previousAddresses: { street: string; city: string; zip: string }[];
  tags: string[];
};
```

And the ORM surfaces them naturally:

```ts
// Value object fields are always inlined — no .include() needed
const user = await db.users.where(u => u.email.eq("alice@example.com")).first();
user.homeAddress?.city; // string

// Dot-path filtering reaches into value object structure
const nycUsers = await db.users
  .where(u => u("homeAddress.city").eq("NYC"))
  .all();

// Nested create — value objects are provided inline
await db.users.create({
  email: "bob@example.com",
  homeAddress: { street: "123 Main", city: "NYC", zip: "10001" },
  previousAddresses: [],
  tags: ["new"],
});
```

For Mongo, `u("homeAddress.city").eq("NYC")` compiles to `{ "homeAddress.city": "NYC" }` — native dot notation. For SQL, value objects are stored as JSONB columns, and the same query compiles to JSONB path operators (`home_address->>'city' = 'NYC'`).

## Dependencies

- **TML-2194** (write operations) — **Done**
- **TML-2204** (typed JSON simplification) — **not blocking**. Value object types in `contract.d.ts` are structural expansion of field descriptors (recursively resolving `type` references). Codec-dispatched `renderType` is for opaque typed JSON columns (`jsonb(schema)`) — a separate mechanism.

## Current state

None of this exists in code yet. `ContractField` is `{ nullable: boolean; codecId: string }` — no `type`, `many`, `dict`, or `union`. The `Contract` type has no `valueObjects` section. No authoring, emission, validation, or ORM code handles value objects.

## Design decisions

### 1. Field descriptor — discriminated union that prevents invalid states

Today every field is a scalar with a codec:

```ts
type ContractField = {
  readonly nullable: boolean;
  readonly codecId: string;
};
```

Value objects introduce two new ways a field can express its type: a reference to a value object definition (`type`), or a union of types (`union`). These three specifiers — `codecId`, `type`, `union` — are mutually exclusive. A field with `codecId: "pg/text@1"` and `type: "Address"` is nonsensical.

The TypeScript type should make this structurally impossible, not rely on runtime validation to catch it. A discriminated union where each variant carries exactly one specifier achieves this:

```ts
type ContractFieldBase = {
  readonly nullable: boolean;
  readonly many?: true;
  readonly dict?: true;
};

type ScalarContractField = ContractFieldBase & {
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown>;
};

type ValueObjectRefField = ContractFieldBase & {
  readonly type: string;
};

type UnionMember = { readonly codecId: string } | { readonly type: string };

type UnionContractField = ContractFieldBase & {
  readonly union: ReadonlyArray<UnionMember>;
};

type ContractField = ScalarContractField | ValueObjectRefField | UnionContractField;
```

Key choices:

- **No explicit `kind` discriminant.** The JSON contract doesn't carry one. TypeScript narrows structurally via `'codecId' in field`. Adding `kind` would mean maintaining a discriminant in the contract JSON that exists only for TypeScript's benefit.

- **`typeParams` lives on `ScalarContractField` only.** Codec parameters (like a JSON Schema for `pg/jsonb@1`) apply to scalar fields with a codec. Value object references and unions don't have codec parameters. (Note: TML-2215 restores `typeParams` to model fields — it belongs on the scalar variant.)

- **`many` and `dict` are shared modifiers on the base.** They're orthogonal to the type specifier: `many: true` makes any field type into an array; `dict: true` makes it a `Record<string, T>`. They compose with `nullable`. They don't compose with each other — `dict` + `many` on the same field is a validation error, not a type error, to keep the types simple.

- **`many` and `dict` are present-when-true.** `many?: true` rather than `many?: boolean`. Absence means "not many." This keeps the contract JSON clean — no `"many": false` noise on every scalar field. (This is different from `nullable`, which is always explicit for historical reasons.)

### 2. `valueObjects` as a top-level contract key

Value objects are a domain-level concept — they describe the shape of data regardless of whether it's stored in a Mongo subdocument or a SQL JSONB column. They belong in the framework-owned part of the contract, alongside `roots` and `models`.

```ts
export interface Contract<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModel> = Record<string, ContractModel>,
> {
  readonly target: string;
  readonly targetFamily: string;
  readonly roots: Record<string, string>;
  readonly models: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;
  readonly storage: TStorage;
  // ... rest unchanged
}

type ContractValueObject = {
  readonly fields: Record<string, ContractField>;
};
```

Key choices:

- **Not a third generic parameter.** `valueObjects` has the same shape in every family — it's structurally fixed. A generic parameter would add noise to every `Contract<...>` usage for no benefit. Use `satisfies` at construction sites where type-checking is needed.

- **Optional.** Existing contracts don't have value objects. Adding `?` means they don't break.

- **Named `valueObjects`.** ADR 178 considered `types` (too generic — collides with TypeScript vocabulary) and `composites` (less clear about the framework commitment distinction). `valueObjects` says what they are: structured data defined by value equality, not identity.

### 3. Storage mapping is an authoring-layer concern

When the PSL interpreter sees `homeAddress Address?` on a model, it decides how that maps to storage:

- **Mongo:** No special action. Subdocuments are native to MongoDB — the field is stored as an embedded document.
- **SQL:** The interpreter emits a JSONB column. Value objects in SQL are always stored as JSON-compatible columns.

The emitter doesn't make this decision. It serializes whatever contract the authoring layer produces. Contract validation cross-references the result — if a value object field maps to an `integer` column in SQL, that's a validation error.

### 4. Value objects vs embedded entities

The contract has two concepts for nested data. They share ORM infrastructure but serve different purposes:

**Value objects** (`valueObjects` section) are structured data without identity. An Address, a GeoPoint, a Money value. Two Addresses with the same fields are interchangeable. They live in `valueObjects`, have no relations, no storage bridge, no lifecycle. In the ORM, they're always inlined in the parent row — no `.include()` needed.

**Embedded entities** (`owner` on a model) are full models scoped to a parent's aggregate. An owned model declares `owner: "User"` — it has identity, can have its own relations, and gets full framework capabilities, but its data lives within the owner's storage ([ADR 177](../../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)). In the ORM, they're loaded via embed relations and `.include()`.

| | Value objects | Embedded entities |
|---|---|---|
| **Contract location** | `contract.valueObjects.Address` | `contract.models.Address` with `owner: "User"` |
| **Identity** | None | Yes |
| **Relations** | None | Can have relations |
| **ORM loading** | Always inlined | Via `.include()` |
| **Framework commitment** | Typed data only | Full model, scoped to aggregate |

Both produce nested TypeScript types. Both support nested create/update inputs. Both support dot-path filtering ([ADR 180](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)). The implementation shares this infrastructure. They're implemented together because the ORM plumbing is the same — the distinction is at the contract level.

## Implementation sequence

### Step 1: Contract field type system

Extend `ContractField` to the discriminated union. Add `ContractValueObject`. Add `valueObjects` to `Contract`. Update canonicalization to include `valueObjects` in serialization order.

**Package:** `@prisma-next/contract`

### Step 2: Contract validation

Extend `validateContractDomain`: every `type` reference in a field must resolve to a name in `valueObjects`. Self-referencing value objects are allowed (a `NavItem` can have `children: NavItem[]`). Validate `dict` + `many` exclusivity. For SQL: storage validator checks that value object fields map to JSON-compatible columns.

**Packages:** `@prisma-next/contract`, `@prisma-next/sql-contract`

### Step 3: Contract authoring (PSL + TS)

PSL interpreter: support `type` declarations and fields referencing value objects. TS authoring: helpers to define value objects and reference them from model fields.

**Packages:** `@prisma-next/sql-contract-psl`, `@prisma-next/mongo-contract-psl`, `@prisma-next/sql-contract-ts`

### Step 4: Contract emission

Emitter serializes `valueObjects` in `contract.json`. Type generation recursively expands value object references into TypeScript types (`many` → array, `dict` → `Record<string, T>`, `nullable` → `| null`).

**Package:** `@prisma-next/emitter`

### Step 5: ORM reads

Value object fields appear in row types. Dot-path filtering compiles to Mongo native dot notation or SQL JSONB path operators. `.select()` supports value object fields as wholes.

**Packages:** `@prisma-next/mongo-orm`, `@prisma-next/sql-orm-client`

### Step 6: ORM writes

Nested create inputs accept value object structure inline. Update accepts wholesale replacement. Input types derived from value object field descriptors.

**Packages:** `@prisma-next/mongo-orm`, `@prisma-next/sql-orm-client`

### Step 7: Integration tests

Both families tested against real databases with value-object contracts produced by the authoring/emission pipeline.

## Open questions

1. **Self-referencing value objects and type generation.** A `NavItem` with `{ type: "NavItem", many: true }` is valid per ADR 178. Type generation must emit a named TypeScript type and reference it by name — inlining would recurse infinitely. Contract validation must allow self-references while detecting genuinely uninstantiable cycles (e.g. a required non-array self-reference with no base case).

2. **`dict` as modifier vs type constructor.** The spec uses the modifier form: `{ codecId: "...", dict: true }` → `Record<string, string>`. The alternative — `{ dict: { codecId: "..." } }` — composes better with nesting (dict of dict, dict of many). Starting with the modifier form; revisit if nesting requirements emerge.

## References

- [ADR 178 — Value objects in the contract](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) — the contract representation
- [ADR 179 — Union field types](../../../docs/architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md) — `union` as a third field type specifier
- [ADR 177 — Ownership replaces relation strategy](../../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) — embedded entities with `owner`
- [ADR 180 — Dot-path field accessor](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md) — querying nested value object fields
- [ADR 172 — Contract domain-storage separation](../../../docs/architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md) — the three-level contract structure
- [Prisma ORM composite types](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/composite-types) — prior art for `type` keyword
