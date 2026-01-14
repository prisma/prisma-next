# ADR 155 - Enum Persistence Strategy

## Status

Accepted

## Context

Enums are fixed sets of string values used as column types. Different databases implement enums differently:

- **PostgreSQL**: Native `CREATE TYPE ... AS ENUM` syntax
- **MySQL**: `ENUM(...)` column modifier
- **SQLite**: No native enum support; requires CHECK constraints

We needed to decide how enums are represented in the contract and how they integrate with the existing type system.

## Decision

### Enums as Parameterized Types

Enums are stored as **parameterized type instances** in `storage.types`, not as a separate `storage.enums` abstraction. This unifies enums with the existing type system.

```typescript
// storage.types entry for an enum
{
  "Role": {
    "codecId": "pg/enum@1",
    "nativeType": "Role",
    "typeParams": {
      "values": ["USER", "ADMIN", "MODERATOR"]
    }
  }
}
```

### Codec Ownership

The codec (e.g., `pg/enum@1`) determines:

1. **Persistence behavior**: How the enum is stored in the database
2. **TypeScript type inference**: Via `parameterizedOutput` in codec types
3. **DDL generation**: The codec's `nativeType` determines SQL type syntax

### Contract Builder API

The `.enum()` convenience method on `SqlContractBuilder` creates `storage.types` entries:

```typescript
defineContract()
  .target(postgresPack)
  .enum('Role', ['USER', 'ADMIN', 'MODERATOR'] as const)
  // Internally creates storage.types['Role'] with pg/enum@1 codec
```

### Extraction Logic

`extractEnumsFromContract()` finds enums from two sources:

1. Named types in `storage.types` with `typeParams.values`
2. Inline column definitions with `typeParams.values`

Named types take precedence over inline definitions.

## Consequences

### Positive

- **Unified type system**: Enums use the same `storage.types` mechanism as other parameterized types
- **Codec-driven behavior**: Each target can implement enum persistence differently via codecs
- **Future extensibility**: Number-backed enums can be added via `typeParams.valueType`

### Negative

- Slightly more verbose contract structure compared to a dedicated `storage.enums`

## Future Considerations

### Number-Backed Enums

For future number-backed enum support, extend `typeParams`:

```typescript
typeParams: {
  values: ["USER", "ADMIN"],
  valueType: "number",  // or "string" (default)
  // For number-backed: values: [{ name: "USER", value: 0 }, { name: "ADMIN", value: 1 }]
}
```

### CHECK Constraints for Non-Native Support

For databases without native enum support (e.g., SQLite), the target's migration planner should implement CHECK constraint-based enum enforcement instead of native enum types.

## References

- `packages/2-sql/1-core/contract/src/types.ts` - `StorageTypeInstance` documentation
- `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts` - `.enum()` method
- `packages/2-sql/3-tooling/family/src/core/schema-verify/enum-helpers.ts` - Extraction logic
