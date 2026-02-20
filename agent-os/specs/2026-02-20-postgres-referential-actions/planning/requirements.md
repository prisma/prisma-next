## Requirements

### Initial description

Add support for referential actions as a follow-up to configurable foreign keys and indexes.

Focus this feature on Postgres-specific referential actions only (no implementation for other database targets yet).

This feature builds on top of:

- `plans/feat-configurable-foreign-key-constraints-and-indexes.md`
- Existing contract builder foreign key support (`.foreingKeys()` as written in the plan)

### Scope and architecture focus

Primary impact areas:

- Contract builder and contract IR/types
- Migration operation layer / migration planning
- Postgres target layer (DDL emission and behavior)

### Functional expectations

- Support referential action configuration for foreign keys (at least `onDelete`, and optionally `onUpdate` if architecture allows in the same increment).
- Generate correct Postgres DDL for configured actions.
- Ensure emitted/migrated schema behavior matches configured actions at runtime.

### Testing expectations (TDD-first)

Use a strict TDD approach, with a test-first red-green-refactor loop and behavior-first tests.

Coverage must be exhaustive for supported referential actions, including:

- Unit tests in impacted packages (builder, operation/planner, postgres target)
- Integration/e2e tests that verify generated DDL text and effective DB behavior

E2E tests must include intuitive, easy-to-follow scenarios, preferably `test.each([...])` tables with clear naming for:

- Parent table role
- Child table role
- Referential action meaning
- Expected outcome

Behavioral example required:

- If a relationship uses `ON DELETE CASCADE`, deleting the linked row in table A removes related rows in table B.

### Non-goals and boundaries

- Do not emulate referential actions for unsupported targets in this feature.
- Do not add cross-target runtime emulation in this feature.

### Documentation expectations

The resulting spec must include notes about how this might work in other targets (at least SQLite and SQL Server):

- Current limitations
- Potential future approach
- Explicit note that referential-action emulation is intentionally deferred
- Mention that old Prisma previously attempted emulation and that it had bugs

### Acceptance criteria

- Postgres referential actions are configurable and correctly represented in the contract/builder layer.
- Migration operations and Postgres DDL include correct referential action clauses.
- E2E tests verify both generated DDL and actual relational behavior per action.
- Tests are exhaustive, DRY, and readable.
- Spec includes forward-looking notes for SQLite/SQL Server and deferred emulation.
