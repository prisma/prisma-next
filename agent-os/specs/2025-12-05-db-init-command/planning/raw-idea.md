# Raw Idea: db init Command

## Feature Description

Implement `prisma-next db init` - a contract-driven database bootstrap command that establishes the initial contract state for a database with no contract marker.

## Key Points from docs/Db-Init-Command.md

- **Command**: `prisma-next db init --db <url> [--plan] [--json]`
- **Purpose**: Bootstrap a database to match the current contract and write the contract marker
- **Conservative approach**: Only additive/widening changes, never destructive operations
- **Safe to run against**:
  - Empty databases
  - Databases with subset of structures
  - Databases with superset of structures
- **Fails when**: Existing schema conflicts with contract (requires destructive changes)
- **When marker exists**: Becomes idempotent verify-only operation
- **Architecture**: Uses family-owned planner + runner primitives from migration system

## Scope (v1)

### SQL Family with Postgres Target

- **Schema changes**:
  - Create tables
  - Add columns (nullable/with defaults)
  - Add PK/UK/FK
  - Add simple indexes
- **Extension handling**: pgvector extension support
- **Contract marker**: Write/update marker row
- **Planner**: In-memory MigrationPlan IR with additive-only policy
- **Runner**: Execute plan with pre/post checks, marker updates, ledger entries
- **CLI**: Supports --plan and --json modes
