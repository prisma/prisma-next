# Operation Structure Decisions

## Context

These decisions were made during requirements gathering on 2025-12-05 to clarify the generic operation structure that will be used in the SQL core for the db init command implementation.

## Architecture Documentation Review

The user requested review of:
- `/docs/architecture docs/subsystems/7. Migration System.md`
- Associated ADRs for migration system

Key findings from these documents:
- ADR 028: Defines migration structure and operations vocabulary
- ADR 044: Defines pre/post check vocabulary v1
- ADR 038: Defines operation idempotency classification and enforcement
- Subsystem 7: Describes the overall migration system architecture

## Generic Operation Structure

The following structure will be used for operations in SQL core:

```typescript
type Operation = {
  precheck: Check;   // Must be true before execution (abort if false)
  postcheck: Check;  // Must be true after execution (abort if false)
  statement: SQLStatement;
}
```

### Idempotency Logic

Operations follow these rules for idempotent execution:

1. **Before execution**: If `postcheck` is true → skip operation (already done)
2. **Validation**: If `precheck` is false → abort (precondition not met)
3. **After execution**: If `postcheck` is false → abort (operation failed)

This enables:
- Safe retries of failed migrations
- Idempotent apply when operations are already partially complete
- Clear validation of assumptions before and after each operation

### SQL Lowering

- **Where**: SQL generation happens in the adapter layer (not in core)
- **Future**: Will eventually have a higher-level IR for change plans
- **For now**: Focus on the operation structure; ignore the higher-level IR for this implementation

This separation allows:
- Different SQL dialects to generate appropriate statements
- Core logic to remain database-agnostic
- Extension of the system to new database targets

## Migration Structure

Migrations are represented as edges in a directed acyclic graph (DAG):

```typescript
type Migration = {
  fromContract: Contract;
  toContract: Contract;
  operations: Operation[];
}
```

### Key Properties

- **fromContract**: The starting contract state (hash: fromCoreHash)
- **toContract**: The target contract state (hash: toCoreHash)
- **operations**: Ordered sequence of operations to transition between states

### For `db init` Specifically

- `fromContract`: The empty contract (H∅)
- `toContract`: The desired application contract
- `operations`: Additive-only operations to create required structures

## Relationship to Existing Architecture

### Alignment with ADR 028

The operation structure aligns with ADR 028's migration model:
- Operations have explicit pre/post checks
- Operations are content-addressed and deterministic
- Operations support idempotency classification

### Alignment with ADR 044

Pre/post checks use the vocabulary defined in ADR 044:
- `tableExists`, `columnExists`, `columnTypeIs`, etc.
- Checks are evaluated deterministically
- Checks integrate with idempotency logic

### Alignment with ADR 038

Idempotency logic follows ADR 038's classification:
- Strictly idempotent operations (create if not exists)
- Effect-idempotent operations (verify equivalence)
- Operations declare their idempotency class
- Runner handles already-applied vs conflict scenarios

## Implementation Notes

1. **Operation ordering**: Planner will determine correct operation order based on dependencies
2. **Check evaluation**: Runner evaluates checks in deterministic order
3. **Error handling**: Failures result in structured errors with stable codes
4. **Atomicity**: Operations execute within appropriate transactional boundaries per ADR 037

## Next Steps

With this structure clarified, the implementation will:
1. Implement the planner to generate operations with pre/post checks
2. Implement the runner to execute operations following the idempotency rules
3. Ensure adapter-level SQL lowering produces correct DDL for the target database
