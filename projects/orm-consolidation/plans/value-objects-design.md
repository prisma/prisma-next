# Value Objects & Embedded Documents — Design Discussion

**Linear:** [TML-2206](https://linear.app/prisma-company/issue/TML-2206)
**Spec:** [embedded-documents-and-value-objects.spec.md](../specs/embedded-documents-and-value-objects.spec.md)
**ADRs:** [178 (value objects)](../../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md), [179 (union fields)](../../../docs/architecture%20docs/adrs/ADR%20179%20-%20Union%20field%20types.md), [177 (ownership)](../../../docs/architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md), [180 (dot-path)](../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)

## Dependencies

- **TML-2194** (Phase 1.5 write operations) — **Done** (merged via [PR #295](https://github.com/prisma/prisma-next/pull/295))
- **TML-2204** (Phase 1.75a typed JSON simplification) — **not blocking**. Value object types in `contract.d.ts` are derived from contract field descriptors (recursive structural expansion of `type` references), not from codec-dispatched `renderType`. The two mechanisms are independent: codec `renderType` is for opaque typed JSON columns (`jsonb(schema)`); value object type generation is structural expansion from the contract's `valueObjects` section.

## Current state

`ContractField` is `{ nullable: boolean; codecId: string }`. There are no `type`, `many`, `dict`, or `union` modifiers. The `Contract` type has no `valueObjects` section. No authoring path, emission, validation, or ORM code handles value objects.

## Design decisions

### 1. Field descriptor shape — discriminated union

**Decision:** `ContractField` becomes a discriminated union of three variants, structurally discriminated by the presence of `codecId`, `type`, or `union`. This makes invalid combinations (e.g. `codecId` + `type` on the same field) unrepresentable at the type level.

**Current:**

```ts
type ContractField = {
  readonly nullable: boolean;
  readonly codecId: string;
};
```

**Proposed:**

```ts
type ContractFieldBase = {
  readonly nullable: boolean;
  readonly many?: boolean;
  readonly dict?: boolean;
};

type ScalarContractField = ContractFieldBase & {
  readonly codecId: string;
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

**Rationale:**
- Three type specifiers (`codecId`, `type`, `union`) are mutually exclusive per ADR 178/179. The union type makes this structurally unrepresentable rather than relying on runtime validation.
- `many` and `dict` are orthogonal modifiers shared across all variants.
- No explicit `kind` discriminant — the JSON contract doesn't carry one, and TypeScript can narrow structurally via `'codecId' in field`.
- Constraint: `dict` and `many` cannot coexist on the same field (spec). This is validated at runtime, not at the type level, to keep the type simple.

**JSON contract examples (from ADR 178):**

```json
{
  "email": { "nullable": false, "codecId": "mongo/string@1" },
  "homeAddress": { "nullable": true, "type": "Address" },
  "previousAddresses": { "nullable": false, "type": "Address", "many": true },
  "tags": { "nullable": false, "codecId": "mongo/string@1", "many": true },
  "metadata": { "nullable": true, "codecId": "mongo/string@1", "dict": true }
}
```

**Open question:** Should `ContractFieldBase` be an `interface` so variants can be intersected cleanly, or should each variant be a standalone type? The intersection approach is shown above; an alternative is three independent interfaces. The intersection is more DRY; standalone types are more explicit. Leaning toward the intersection approach since `nullable`, `many`, `dict` genuinely apply uniformly.

### 2. `valueObjects` on the Contract type

**Decision:** `valueObjects` is a top-level key on `Contract`, sibling of `models`. It is a fixed framework-owned section (like `roots`), not a third generic parameter. Use `satisfies` where needed for constraint checking.

**Proposed change to `Contract`:**

```ts
export interface Contract<
  TStorage extends StorageBase = StorageBase,
  TModels extends Record<string, ContractModel> = Record<string, ContractModel>,
> {
  readonly target: string;
  readonly targetFamily: string;
  readonly roots: Record<string, string>;
  readonly models: TModels;
  readonly valueObjects?: Record<string, ContractValueObject>;  // ← new
  readonly storage: TStorage;
  // ... rest unchanged
}
```

Where `ContractValueObject` is:

```ts
type ContractValueObject = {
  readonly fields: Record<string, ContractField>;
};
```

**Rationale:**
- Value objects are a domain-level, family-agnostic concept (no storage bridge, no relations, no lifecycle). They belong in the framework, not parameterized per-family.
- A third generic parameter would add noise to every `Contract<...>` usage. `valueObjects` is structurally fixed — it's the same shape regardless of SQL vs Mongo. Making it a plain property is simpler.
- `satisfies` at construction sites gives the same type-safety guarantees as a generic parameter without the ergonomic cost.
- Optional (`?`) because existing contracts don't have value objects and shouldn't break.

**Naming:** `valueObjects` (consistent with ADR 178). The alternatives (`types`, `composites`) were considered in ADR 178 and rejected — `types` is too generic (conflicts with TypeScript's own vocabulary), `composites` is less semantically clear about the framework commitment distinction.

### 3. PSL syntax for value objects

**Decision:** `type Address { ... }` — consistent with [Prisma ORM's existing composite type syntax](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/composite-types).

```prisma
type Address {
  street String
  city   String
  zip    String
}

type GeoPoint {
  lat Float
  lng Float
}

model User {
  id              String    @id @default(auto()) @map("_id") @db.ObjectId
  email           String
  homeAddress     Address?
  previousAddresses Address[]
}
```

**Rationale:**
- Users familiar with Prisma ORM already know `type` for composite types. Prisma Next should use the same keyword.
- `type` vs `model` mirrors the framework commitment distinction: `model` = full framework citizen (identity, lifecycle, hooks); `type` = structured data without framework guarantees.
- `Address[]` naturally maps to `{ type: "Address", many: true }`.
- `Address?` maps to `{ type: "Address", nullable: true }`.

### 4. Storage mapping is an authoring concern

**Decision:** The authoring layer (PSL interpreter, TS builders) decides how a value object field maps to storage. The emitter serializes the contract it's given — it does not make storage decisions.

For SQL: the authoring layer emits a JSONB column for value object fields. For Mongo: no special mapping needed — subdocuments are native.

This means:
- The PSL interpreter, when it sees a `type`-referenced field on a model, generates the appropriate storage mapping (SQL: a JSONB column; Mongo: no action).
- Contract validation cross-references domain field types with storage column types (SQL: value object field → column must be JSON-compatible).
- The emitter's job is serialization, not decision-making.

### 5. Value objects vs embedded entities

Two separate contract concepts that share ORM infrastructure:

| | Value objects (`valueObjects` section) | Embedded entities (`owner` on model) |
|---|---|---|
| **Contract location** | `contract.valueObjects.Address` | `contract.models.Address` with `owner: "User"` |
| **Identity** | None — interchangeable instances | Yes — full model with lifecycle |
| **Relations** | None | Can have relations (embed or reference) |
| **Storage** | Transparent — part of parent's storage | Explicit — `model.storage` bridge |
| **Framework commitment** | Typed data structure only | Full framework citizen, scoped to aggregate |
| **ORM surface** | Inlined in parent row | Loaded via `include` (embed relation) |

Both produce nested TypeScript types in the parent's row. Both support nested create/update inputs. Both support dot-path filtering. The implementation shares this infrastructure, but the contract semantics are distinct.

The spec says "implement together" — this remains the plan since the ORM plumbing (inlined results, nested input types, dot-path filtering) is the same. The distinction is at the contract level (where the definition lives, what framework guarantees apply).

## Implementation sequencing

Since all dependencies have landed, the implementation can proceed end-to-end. Proposed order:

### Step 1: Contract field type system

Extend `ContractField` to the discriminated union shape. Add `ContractValueObject` type. Add `valueObjects` to `Contract`. Update canonicalization to include `valueObjects` in serialization order. This is the foundation everything else builds on.

**Packages:** `@prisma-next/contract`

### Step 2: Contract validation

Extend `validateContractDomain` to validate value object references: every `type` reference in a field must resolve to a name in `valueObjects`. Detect circular references (allowed but must not stack-overflow). Validate `dict` + `many` exclusivity. For SQL: storage validator checks that value object fields map to JSON-compatible columns.

**Packages:** `@prisma-next/contract`, `@prisma-next/sql-contract`

### Step 3: Contract authoring (PSL + TS)

PSL interpreter: support `type` declarations and `type`-referenced fields. TS authoring: helpers to define value objects and reference them from model fields. Both families' interpreters produce contracts with `valueObjects` populated.

**Packages:** `@prisma-next/sql-contract-psl`, `@prisma-next/mongo-contract-psl`, `@prisma-next/sql-contract-ts`

### Step 4: Contract emission

Emitter serializes `valueObjects` in `contract.json`. Type generation produces recursive TypeScript types for value object fields (including `many` → array, `dict` → `Record<string, T>`, `nullable` → `| null`).

**Packages:** `@prisma-next/emitter`

### Step 5: ORM reads (both families)

Value object fields appear in model row types. Dot-path filtering compiles to target-specific queries (Mongo: native dot notation; SQL: JSONB path operators). `.select()` supports value object fields as wholes.

**Packages:** `@prisma-next/mongo-orm`, `@prisma-next/sql-orm-client`

### Step 6: ORM writes (both families)

Nested create inputs accept value object structure inline. Update accepts wholesale replacement. Input types derived from value object field descriptors.

**Packages:** `@prisma-next/mongo-orm`, `@prisma-next/sql-orm-client`

### Step 7: Integration tests

Both families tested against real databases with value-object contracts produced by the authoring/emission pipeline (not hand-crafted fixtures).

## Open questions

1. **`ContractFieldBase` shape.** Should `many` and `dict` be optional booleans (`many?: boolean`) or only present when true (`many?: true`)? The `many?: true` form means absence = false, which is common in JSON. But `nullable` is already an explicit boolean — should modifiers be consistent? Leaning toward `many?: true` (present-when-true) since the JSON contract benefits from omitting defaults, and `nullable` has historical reasons for being explicit.

2. **Self-referencing value objects.** `NavItem` can reference itself via `{ type: "NavItem", many: true }`. This is allowed per ADR 178. Type generation must handle this without infinite recursion — likely via generating a named TypeScript type and referencing it. Contract validation must detect and allow valid self-references while catching truly circular structures that can't be instantiated.

3. **`dict` modifier.** The spec frames `dict` as a modifier (like `many`). This means `{ codecId: "...", dict: true }` produces `Record<string, string>`. The alternative — a type constructor form `{ dict: { codecId: "..." } }` — was considered and deferred. Should we validate this decision now, or proceed with the modifier form and see if nesting requirements emerge?
