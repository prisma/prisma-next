# Spec Initialization: db init Command

## Raw Idea

Implement `prisma-next db init` command as documented in [docs/Db-Init-Command.md](docs/Db-Init-Command.md). This is a well-documented feature with clear architecture and implementation slices already defined.

## Context

The user wants to implement the `db init` command which is the bootstrap entrypoint for bringing a database under contract control. The design document already exists and provides comprehensive details about the command's behavior, architecture, and implementation approach.

## Key Requirements from Design Doc

1. **Command Purpose**: Bootstrap a database to match the current contract and write the contract marker
2. **Conservative Approach**: Never performs destructive operations (no drops, no type narrowing)
3. **Safe Targets**: Empty databases, databases with subset of required structures, databases with superset (extra tables/columns)
4. **Failure Case**: Databases with incompatible existing schema requiring destructive changes
5. **Implementation Slices**:
   - Slice 1: Additive migration planner
   - Slice 2: Runner integration & marker updates
   - Slice 3: CLI command
   - Slice 4: Extension integration (pgvector)

## Questions to Clarify

The design doc is comprehensive, but we need to understand:
- Implementation priorities and which slices to tackle first
- Any deviations or adjustments to the design doc approach
- Testing approach preferences
- Timeline/milestone expectations
- Specific edge cases or scenarios to prioritize
