# Spec Requirements: db init Command

## Initial Description

Implement `prisma-next db init` command as documented in [docs/Db-Init-Command.md](docs/Db-Init-Command.md). This is a well-documented feature with clear architecture and implementation slices already defined.

The user wants to implement the `db init` command which is the bootstrap entrypoint for bringing a database under contract control. The design document already exists and provides comprehensive details about the command's behavior, architecture, and implementation approach.

## Requirements Discussion

### Context Questions

**Q1:** The design doc proposes a specific slice order (Planner → Runner → CLI → Extensions). However, given that some early slices may not have enough complexity to justify real Postgres testing, would you prefer to adjust the implementation order to prioritize getting to testable meat faster?

**Answer:** Yes, adjust the order. Implement in this sequence:
- Slice 1: Operations & Migration IR
- Slice 2: Runner (execute operations, delegate transactions to adapter)
- Slice 3: Planner (empty DB → full schema only)
- Slice 4: CLI Integration

Start testing with real Postgres as soon as possible. For example, begin with adapter work and teach it about transactions first.

**Q2:** The design doc mentions the runner will handle transactions and advisory locks. Should the runner be aware of implementation details (like Postgres-specific advisory lock IDs), or should it delegate transaction and lock management entirely to the adapter?

**Answer:** Runner should be ignorant of transaction implementation details:
- Runner delegates to adapter for start/end transaction
- Adapter handles locks
- Marker table write happens in same transaction as operations
- Runner orchestrates but doesn't know the details

**Q3:** For the planner's initial scope, should we focus first on Case 1 (empty database → full schema) to get the core flow working, then expand to Cases 2-4 (subset/superset/conflicts), or implement all cases from the start?

**Answer:** Focus on Case 1 only initially (empty database → full schema). This gets the core flow working and testable. Cases 2-4 can be added in follow-up work.

**Q4:** The design doc describes TypeScript primitives that the CLI will compose. Should these primitives be:
- New modules in existing packages (e.g., add to `@prisma-next/family-sql/control`)
- New in-process TypeScript functions that CLI imports directly
- Something else?

**Answer:** Create new in-process TypeScript primitives that CLI composes directly. Place them in appropriate existing packages following the monorepo structure.

**Q5:** The runner needs to verify the database schema before and after applying operations. Should we:
- Run `db schema-verify` as a subprocess call
- Import and call the schema verification logic directly as a TypeScript function
- Build schema verification into the runner itself?

**Answer:** Import and call schema verification logic directly as TypeScript function:
- Runner receives migration as input
- Runs `db schema-verify` on remote DB to ensure it satisfies `from` contract BEFORE applying
- Iterates over operations
- Runs `db schema-verify` AFTER operations to ensure DB satisfies `to` contract

**Q6:** For extension handling (pgvector), the design doc mentions extension packs providing migration operations. Should we:
- Implement core planner/runner first without any extension support
- Include basic extension support from the start
- Focus specifically on pgvector as the reference implementation?

**Answer:** Include basic extension support from the start, using pgvector as the reference implementation. This ensures the architecture is extensible from day one.

**Q7:** The design mentions an in-memory `MigrationPlan` IR distinct from the serialized on-disk format. Should we design both IRs upfront, or focus on the in-memory IR first and add serialization later?

**Answer:** Focus on in-memory IR first. Serialization can be added later when we need to persist migration edges to disk.

**Q8:** Are there any features explicitly out of scope for this initial implementation that we should document to avoid scope creep?

**Answer:** Out of scope (as documented in design doc):
- Destructive operations (drops, type narrowing)
- Check constraints, computed columns, partial indexes, views, triggers
- Non-SQL families
- Full drift tolerance policies
- Cases 2-4 database states (subset/superset/conflicts)

### Existing Code to Reference

**Similar Features Identified:**

- **Marker helper**: Located in postgres adapter (`packages/targets/postgres-adapter`)
  - Provides marker table read/write functionality
  - Should be reused for marker updates during `db init`

- **Runner patterns**: Don't exist yet, but runner should follow this pattern:
  - Receive migration as input
  - Run `db schema-verify` on remote DB to ensure it satisfies `from` contract BEFORE applying
  - Iterate over operations
  - Run `db schema-verify` AFTER operations to ensure DB satisfies `to` contract
  - Delegate transaction management to adapter

- **Introspection**: Needs exploration to understand current implementation
  - Required to obtain live schema IR from database
  - Should be available in SQL family/target packages

- **Extension pack structure**: Reference `packages/extensions/pgvector`
  - Shows how extension packs provide capabilities
  - Model for how pgvector migration operations should be structured

### Follow-up Questions

None - all requirements clarified through initial discussion.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - this is a CLI command implementation without visual UI components.

## Requirements Summary

### Functional Requirements

**Core Command Behavior:**
- Implement `prisma-next db init` CLI command
- Bootstrap a database to match the current contract
- Write contract marker to track database state
- Support `--plan` mode for dry-run preview
- Support `--json` mode for machine-readable output
- Support `--db <url>` for database connection string

**Conservative Operation Model:**
- Never perform destructive operations (no drops, no type narrowing)
- Only perform additive/widening operations
- Safe for empty databases (Case 1 - initial focus)
- Future: Support databases with subset/superset/conflicts (Cases 2-4)

**Contract-Driven Workflow:**
1. Load config from `prisma-next.config.ts`
2. Load contract from `contract.json` / `contract.d.ts`
3. Introspect live database schema
4. Check for existing contract marker
5. Plan migration from empty contract to desired contract
6. Execute migration (or show plan in `--plan` mode)
7. Write contract marker atomically with schema changes

**Operation Classes:**
- Focus on additive operations:
  - Create tables (with columns, primary keys)
  - Add columns (nullable or with non-null defaults)
  - Add primary keys, unique constraints, foreign keys
  - Add simple indexes (non-partial, non-functional)
  - Enable extensions (e.g., pgvector)
  - Add extension-owned objects (e.g., pgvector indexes)

**Schema Verification:**
- Run `db schema-verify` BEFORE applying operations to ensure database satisfies `from` contract
- Run `db schema-verify` AFTER applying operations to ensure database satisfies `to` contract

**Transaction Handling:**
- Runner delegates transaction start/end to adapter
- Adapter handles implementation details (advisory locks, transaction boundaries)
- Marker table write happens in same transaction as operations
- Runner orchestrates but remains ignorant of implementation specifics

**Marker Management:**
- Reuse existing marker helper from postgres adapter
- Write marker with `core_hash` and `profile_hash` from desired contract
- Marker write is atomic with schema operations
- Append ledger entry representing edge from empty contract (`H∅`) to desired contract

**Extension Support:**
- Support extension constraints in contract (e.g., `extensions.pgvector.enabled = true`)
- Extension packs provide migration operations
- Planner emits extension operations when required
- Runner applies extension operations using pack-provided implementations

### Architecture Components

**In-Memory Migration IR:**
- Family-scoped migration plan representation
- Linear sequence of operations (no explicit dependency graph)
- Distinct from serialized on-disk format
- Contains operation metadata and debugging info
- Input to runner for execution

**Migration Operations:**
- Drawn from ADR 028 vocabulary
- Each operation has:
  - Precondition check (idempotency verification)
  - SQL statement to execute
  - Postcondition check (verification)
- Operations classified by type (additive, widening, destructive)
- Extensions provide additional operations via packs

**Empty Contract Origin:**
- `db init` models transition from empty contract node (`H∅`) to desired contract
- `fromCoreHash = hash(emptyContract)`
- `toCoreHash = hash(desiredContract)`
- Consistent with migration system DAG model

**Migration Policy:**
- Governs allowed operation classes
- For `db init`: `allowedOperationClasses = ['additive', 'widening']`
- Mode discriminator: `mode: 'init'` vs `mode: 'update'`
- Extension operations included when policy allows

**Family-Scoped Primitives:**
- `planMigration(input)`: Generate migration plan from contracts and live schema
- `executeMigration(plan, connection)`: Apply migration plan to database
- Both exposed on SQL family instance created by CLI

### Reusability Opportunities

**Existing Infrastructure:**
- Contract loading/validation pipeline (reuse from framework)
- CLI command architecture (`performAction`, `handleResult`, `setCommandDescriptions`)
- Marker helper from postgres adapter (for marker read/write)
- Schema verification logic (import as TypeScript function)
- Introspection capabilities (from SQL family/target)
- Error taxonomy and structured errors (framework domain)

**Package Structure:**
- Place planner and IR in `packages/sql/tooling/migrations` (or similar)
- Expose via `@prisma-next/family-sql/control` entrypoint
- Runner logic can share primitives with future `db update` command
- Operation definitions reusable across migration commands

**Testing Utilities:**
- Dev database utilities from `@prisma-next/test-utils`
- Existing integration test patterns
- Contract emission for test scenarios

### Scope Boundaries

**In Scope:**

**v1 - Initial Implementation:**
- Empty database support (Case 1) only
- SQL family with Postgres target/adapter/driver
- Additive operations: create tables, add columns, add constraints, add indexes
- Extension support via pgvector as reference implementation
- In-memory migration IR and planner
- Runner with transaction delegation to adapter
- CLI command with `--plan` and `--json` modes
- Marker write and ledger entry
- Schema verification before and after operations
- Integration tests with real Postgres
- E2E tests via CLI

**Future Phases (Out of Current Scope):**
- Database subset support (Case 2): Existing schema with missing structures
- Database superset support (Case 3): Existing schema with extra structures
- Conflict detection and handling (Case 4): Incompatible schemas
- Destructive operations (drops, type narrowing, data rewrites)
- Check constraints, computed columns, partial/functional indexes
- Views, materialized views, triggers, partitioning
- Non-SQL families (MongoDB, etc.)
- Full drift tolerance policies
- Serialization of migration IR to disk
- `db update` command (contract-to-contract updates)

**Out of Scope:**
- Advanced SQL features not needed for basic schema bootstrap
- Multi-dialect support beyond Postgres in v1
- Hand-written migration script support
- Migration rollback mechanisms
- Schema diffing between arbitrary database states

### Technical Considerations

**Package Architecture:**
- Follow monorepo structure with clear domain separation
- Framework domain: target-agnostic CLI, config, contracts
- SQL family domain: SQL-specific logic, operations, planning
- Target packages: Postgres-specific adapter, driver
- Extension packages: pgvector and future extension packs

**TypeScript & ESM:**
- Full TypeScript 5.9+ with strict mode
- ESM modules with explicit `.js` extensions
- Type-safe operation definitions with full inference
- Avoid any runtime codegen; use TypeScript compiler

**Database Interaction:**
- Use pg (node-postgres) driver via adapter abstraction
- All DDL operations go through adapter
- Transaction boundaries controlled by adapter
- Advisory locks managed by adapter (Postgres-specific)

**Contract Hashing:**
- SHA-256 for `coreHash` and `profileHash`
- Verify hashes before and after operations
- Store hashes in marker table

**Error Handling:**
- Use structured error taxonomy (PLAN/RUNTIME/ADAPTER/MIGRATION/CONTRACT)
- Provide actionable error messages
- Fail fast on incompatible schemas
- Machine-readable errors in JSON mode

**Testing Strategy:**
- Start with adapter transaction work to get real Postgres testing ASAP
- Unit tests for planner logic (schema IR → migration plan)
- Integration tests for runner with real database
- E2E tests for full CLI workflow
- Use `@prisma-next/test-utils` for database setup
- Follow existing test patterns and object matchers

**CLI Conventions:**
- Follow framework CLI style guide
- Use `performAction` for core logic with error capture
- Use `handleResult` for output formatting
- Support `--json` for structured output
- Human-readable output for interactive use
- Process exit codes follow CLI standards

**Alignment with Product Mission:**
- Contract-first architecture: All operations driven by contract
- Machine-readable artifacts: JSON output for AI agents
- Verifiable data contracts: Marker with cryptographic hashes
- Runtime verification: Schema checks before and after
- Agent-first design: Clear, structured errors and plans
- Modular extensibility: Extension packs for capabilities

**Alignment with Roadmap:**
- Phase 1 deliverable: Migration v1 with `db init`
- Supports zero-migrations workflow foundation
- Enables contract-driven database bootstrap
- Testing story: Spin up fresh DBs from contract
- Extensibility: pgvector as first extension showcase

## Implementation Approach

### Inverted Slice Order

The implementation will follow this order (different from design doc):

**Slice 1: Operations & Migration IR**
- Define operation structure with precheck/postcheck/statement
- Build in-memory `MigrationPlan` IR
- Classify operations by type (additive/widening/destructive)
- Implement operation idempotency rules
- No database interaction yet

**Slice 2: Runner**
- Implement `executeMigration(plan, connection)`
- Delegate transaction start/end to adapter
- Call schema-verify before operations (verify `from` contract)
- Execute operations in sequence
- Call schema-verify after operations (verify `to` contract)
- Write marker atomically in same transaction
- Append ledger entry
- Test with real Postgres

**Slice 3: Planner**
- Implement `planMigration(fromContract, toContract, liveSchema, policy)`
- Focus on Case 1: empty database → full schema
- Generate operations for tables, columns, constraints, indexes
- Honor migration policy (additive-only for init mode)
- Include extension operations (pgvector)
- No database writes, pure planning logic

**Slice 4: CLI Integration**
- Implement `createDbInitCommand()`
- Wire config loading and contract loading
- Call introspection for live schema
- Call planner to generate migration plan
- Implement `--plan` mode (show plan, no apply)
- Implement apply mode (call runner)
- Implement `--json` output
- Full E2E tests

### Key Architectural Decisions

**Decision 1: Runner Transaction Ignorance**
- Runner does not know about advisory locks, transaction IDs, or database-specific locking
- Runner calls adapter methods: `startTransaction()`, `endTransaction()`
- Adapter handles all implementation details
- Marker write happens inside the transaction managed by adapter

**Decision 2: Schema Verification Integration**
- Runner calls schema verification as TypeScript function (not subprocess)
- Verification runs before operations to ensure starting state is valid
- Verification runs after operations to ensure ending state matches contract
- Verification failures cause runner to abort and roll back transaction

**Decision 3: Case 1 Focus**
- Initial implementation only handles empty database
- Simplifies planner logic significantly
- Gets core flow working and testable quickly
- Cases 2-4 (subset/superset/conflicts) deferred to future work

**Decision 4: In-Process Primitives**
- CLI directly imports and calls TypeScript functions
- No subprocess spawning between CLI and planner/runner
- All logic runs in same Node.js process
- Faster execution, easier debugging, simpler error handling

**Decision 5: Extension Support from Start**
- pgvector included in v1 as reference implementation
- Validates that extension architecture is sound
- Shows how extension packs provide operations
- Ensures core is not accidentally tied to base SQL only

### Migration Structure

**Operation Definition:**
```typescript
interface Operation {
  type: 'createTable' | 'addColumn' | 'addIndex' | 'createExtension' | ...
  precheck: (db: Connection) => Promise<boolean>  // Idempotency check
  statement: string | ((db: Connection) => Promise<string>)  // SQL to execute
  postcheck: (db: Connection) => Promise<boolean>  // Verify success
  metadata: {
    classification: 'additive' | 'widening' | 'destructive'
    description: string
  }
}
```

**Migration Plan:**
```typescript
interface MigrationPlan {
  fromCoreHash: string
  toCoreHash: string
  fromProfileHash: string
  toProfileHash: string
  operations: Operation[]
  metadata: {
    mode: 'init' | 'update'
    policy: MigrationPolicy
  }
}
```

**Migration Policy:**
```typescript
interface MigrationPolicy {
  mode: 'init' | 'update'
  allowedOperationClasses: ('additive' | 'widening' | 'destructive')[]
}
```

### Runner Responsibilities

**Core Flow:**
1. Receive `MigrationPlan` and database connection
2. Validate current marker state (should be absent for `db init`)
3. Delegate transaction start to adapter: `adapter.startTransaction()`
4. Call schema verification: `schemaVerify(db, plan.fromContract)` - ensures DB satisfies `from` state
5. For each operation in plan:
   - Run precheck (idempotency verification)
   - If precheck passes, skip operation
   - If precheck fails, execute statement
   - Run postcheck (verify success)
   - If postcheck fails, abort transaction
6. Call schema verification: `schemaVerify(db, plan.toContract)` - ensures DB satisfies `to` state
7. Write marker via marker helper: `writeMarker(db, plan.toCoreHash, plan.toProfileHash, contractJson)`
8. Append ledger entry: `appendLedgerEntry(db, plan.fromCoreHash, plan.toCoreHash, operations)`
9. Delegate transaction end to adapter: `adapter.endTransaction()`
10. Return success result

**Error Handling:**
- Any failure in steps 4-8 triggers transaction rollback via adapter
- Schema verification failures produce structured errors with details
- Operation failures include which operation failed and why
- All errors follow framework error taxonomy

**Adapter Contract:**
- Adapter must provide: `startTransaction()`, `endTransaction()`, `rollback()`
- Adapter manages advisory locks internally during transaction
- Adapter ensures marker write happens atomically with schema changes

### Planner Scope

**Case 1 Only - Empty Database:**
- Input: `fromContract = emptyContract`, `toContract = desiredContract`, `liveSchema = emptySchemaIR`
- Output: Full set of operations to create all required structures
- Logic:
  - Iterate over all models in `toContract`
  - Generate `createTable` operations with columns and primary key
  - Generate `addIndex` operations for all indexes
  - Generate `addForeignKey` operations for all relations
  - Generate `createExtension` operations for required extensions
  - Generate extension-specific operations (e.g., pgvector indexes)
- No need to diff against live schema since we know it's empty
- Simplifies implementation significantly

**Future Cases (Out of Scope for v1):**
- Case 2 (subset): Diff live schema, generate only missing operations
- Case 3 (superset): Tolerate extra structures, generate minimal operations
- Case 4 (conflicts): Detect incompatibilities, fail with structured error

### Testing Strategy

**Phase 1: Operations & IR (No Database)**
- Unit tests for operation structure validation
- Tests for migration plan construction
- Tests for operation classification
- Tests for policy enforcement logic
- No database interaction, fast tests

**Phase 2: Runner with Real Postgres**
- Integration tests using `@prisma-next/test-utils`
- Set up real Postgres database for each test
- Test transaction delegation to adapter
- Test schema verification before/after
- Test marker write atomicity
- Test ledger entry creation
- Test rollback on failures
- Verify idempotency (precheck prevents duplicate operations)

**Phase 3: Planner (No Database Yet)**
- Unit tests with mock schema IR
- Empty contract → full contract plans
- Verify operation ordering
- Verify extension operations included
- Policy enforcement tests
- No database needed, can use mock data

**Phase 4: Full E2E with CLI**
- E2E tests using CLI command
- Real Postgres database
- Test `--plan` mode output
- Test apply mode with marker verification
- Test idempotent re-run (marker exists, no-op)
- Test JSON output format
- Test error scenarios and messages
- Integration with pgvector extension

### References to Standards

**Global Standards:**
- Follow `@agent-os/standards/global/coding-style.md` for code formatting
- Follow `@agent-os/standards/global/conventions.md` for naming and structure
- Follow `@agent-os/standards/global/error-handling.md` for structured errors
- Follow `@agent-os/standards/global/tech-stack.md` for TypeScript/ESM usage

**Backend Standards:**
- Follow `@agent-os/standards/backend/migrations.md` for migration patterns
- Follow `@agent-os/standards/backend/queries.md` for database query patterns

**TypeScript Standards:**
- Follow `@agent-os/standards/typescript/typescript-best-practices.md`
- Follow `@agent-os/standards/typescript/naming-conventions.md`
- Follow `@agent-os/standards/typescript/error-handling.md`

**Testing Standards:**
- Follow `@agent-os/standards/testing/test-writing.md` for test structure
- Follow `@agent-os/standards/typescript/testing.md` for TypeScript-specific testing

**Infrastructure:**
- Follow `@agent-os/standards/infrastructure/github-actions.md` for CI/CD integration

## Summary

This specification defines the implementation of `prisma-next db init`, a conservative database bootstrap command that brings databases under contract control through additive-only operations. The implementation follows an inverted slice order (Operations → Runner → Planner → CLI) to enable real Postgres testing as early as possible. The architecture emphasizes transaction delegation to adapters, schema verification before and after operations, and atomic marker writes. Initial scope focuses on Case 1 (empty database) with extension support via pgvector, providing a solid foundation for future migration capabilities while maintaining alignment with Prisma Next's contract-first, agent-friendly design principles.
