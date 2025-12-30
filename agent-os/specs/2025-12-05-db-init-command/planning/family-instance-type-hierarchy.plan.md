# Family Instance Type Hierarchy — Design Plan

## Problem Statement

The control-plane type system has three disconnected interfaces for family instances, leading to awkward casts in CLI commands:

```typescript
// In every CLI command that uses familyInstance:
const familyInstance = config.family.create({ ... });
const typedFamilyInstance = familyInstance as FamilyInstance<string>; // Cast required!
```

This cast is required because:

1. `ControlFamilyDescriptor.create()` returns `TFamilyInstance`, which defaults to `ControlFamilyInstance<TFamilyId>`.
2. `ControlFamilyInstance` is a minimal marker interface with only `familyId`.
3. CLI commands need `FamilyInstance` which has the actual methods (`validateContractIR`, `verify`, `introspect`, etc.).

## Current State

Three disconnected interfaces exist:

| Interface | Location | Properties |
|-----------|----------|------------|
| `ControlFamilyInstance<TFamilyId>` | `core-control-plane/types.ts` | `familyId` only |
| `RuntimeFamilyInstance<TFamilyId>` | `execution-plane/types.ts` | `familyId` only (identical!) |
| `FamilyInstance<TFamilyId, ...>` | `core-control-plane/types.ts` | Full domain methods |

None extend each other. The minimal interfaces serve no purpose — there's no use case where a family instance would legitimately lack the domain methods.

## Proposed Design

Establish proper inheritance where `FamilyInstance` is the base:

```
FamilyInstance<TFamilyId>
│   • familyId: TFamilyId
│   • validateContractIR()
│   • verify()
│   • schemaVerify()
│   • sign()
│   • introspect()
│   • toSchemaView?()
│   • emitContract()
│
├── ControlFamilyInstance<TFamilyId> extends FamilyInstance
│       (no additional methods currently — could add control-plane-specific ones later)
│
└── RuntimeFamilyInstance<TFamilyId> extends FamilyInstance
        (no additional methods currently — could add runtime-plane-specific ones later)
```

### Option A: Merge Into Single Interface

Since `ControlFamilyInstance` and `RuntimeFamilyInstance` currently add nothing, we could:

1. **Delete** `ControlFamilyInstance` and `RuntimeFamilyInstance`.
2. **Use** `FamilyInstance` directly as the type parameter default in descriptors.
3. **Update** `ControlFamilyDescriptor` to default `TFamilyInstance` to `FamilyInstance<TFamilyId>`.

**Pros:**
- Simplest solution.
- Eliminates all casts immediately.
- No need to maintain three interfaces.

**Cons:**
- If plane-specific methods are needed later, we'd reintroduce the hierarchy.

### Option B: Establish Inheritance Hierarchy

1. **Keep** all three interfaces but establish inheritance:
   ```typescript
   export interface FamilyInstance<TFamilyId extends string> {
     readonly familyId: TFamilyId;
     validateContractIR(contractJson: unknown): unknown;
     verify(...): Promise<TVerifyResult>;
     // ... all domain methods
   }

   export interface ControlFamilyInstance<TFamilyId extends string>
     extends FamilyInstance<TFamilyId> {
     // Placeholder for future control-plane-specific methods
   }

   export interface RuntimeFamilyInstance<TFamilyId extends string>
     extends FamilyInstance<TFamilyId> {
     // Placeholder for future runtime-plane-specific methods
   }
   ```

2. **Update** `ControlFamilyDescriptor` to use `ControlFamilyInstance` as default, which now includes all `FamilyInstance` methods via inheritance.

**Pros:**
- Cleaner if plane-specific methods are added later.
- Explicit about the relationship.

**Cons:**
- More interfaces to maintain.
- The sub-interfaces add nothing currently.

### Recommendation

**Start with Option A** (merge into single interface). The plane-specific interfaces add no value today. If we need plane-specific methods in the future, we can reintroduce the hierarchy at that time — YAGNI.

## Implementation Steps

1. **Update `FamilyInstance`** to be the complete interface (it already is).
2. **Update `ControlFamilyDescriptor`** default type parameter:
   ```typescript
   export interface ControlFamilyDescriptor<
     TFamilyId extends string,
     TFamilyInstance extends FamilyInstance<TFamilyId> = FamilyInstance<TFamilyId>, // Changed!
   > { ... }
   ```
3. **Delete or deprecate `ControlFamilyInstance`** (the minimal marker).
4. **Update `RuntimeFamilyDescriptor`** similarly (if it exists and follows the same pattern).
5. **Remove casts** from CLI commands (`db-init.ts`, `contract-emit.ts`, `db-verify.ts`, etc.).
6. **Update any code** that references `ControlFamilyInstance` directly.

## Files to Modify

- `packages/1-framework/1-core/migration/control-plane/src/types.ts`
  - Update `ControlFamilyDescriptor` default type parameter.
  - Remove or mark `ControlFamilyInstance` as deprecated.
- `packages/1-framework/1-core/runtime/execution-plane/src/types.ts`
  - Same for `RuntimeFamilyDescriptor` / `RuntimeFamilyInstance`.
- `packages/1-framework/3-tooling/cli/src/commands/*.ts`
  - Remove `as FamilyInstance<string>` casts.
- Update any tests that reference these types.

## Testing

- Existing tests should continue to pass (this is a type-level refactor).
- Add type-level tests (`.test-d.ts`) verifying that `config.family.create()` returns a type assignable to `FamilyInstance<string>` without casting.

## Related

- ADR 151: Control Plane Descriptors and Instances (defines the `Control*Descriptor` / `Control*Instance` pattern).
- Task 7.3: Introduce core migration base types for CLI (related cleanup for migration types).

