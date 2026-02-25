# @prisma-next/migration-tools

On-disk migration persistence, attestation, and DAG reconstruction for Prisma Next.

## Responsibilities

- **Types**: Define the on-disk migration format (`MigrationManifest`, `MigrationOps`, `MigrationPackage`, `MigrationGraph`)
- **I/O**: Read and write migration packages to/from disk (`migration.json` + `ops.json`)
- **Attestation**: Compute and verify content-addressed edge IDs for tamper detection
- **DAG**: Reconstruct and navigate the migration graph (path finding, leaf detection, cycle/orphan detection)

## Architecture

```mermaid
graph TD
    CLI["CLI commands<br/>(migration plan, verify, new)"] --> IO["io.ts<br/>File I/O"]
    CLI --> ATT["attestation.ts<br/>Edge attestation"]
    CLI --> DAG["dag.ts<br/>DAG operations"]
    IO --> TYPES["types.ts<br/>MigrationManifest, etc."]
    ATT --> IO
    ATT --> CAN["canonicalize-json.ts"]
    ATT --> CP["@prisma-next/core-control-plane<br/>canonicalizeContract"]
    DAG --> TYPES
    DAG --> ABS["@prisma-next/core-control-plane<br/>EMPTY_CONTRACT_HASH"]
```

## Dependencies

| Package | Why |
|---|---|
| `@prisma-next/contract` | `ContractIR` type for embedded contracts in manifests |
| `@prisma-next/core-control-plane` | `AbstractOp` types, `EMPTY_CONTRACT_HASH`, `canonicalizeContract` |
| `@prisma-next/utils` | Shared utilities |
| `pathe` | Cross-platform path manipulation |

### Dependents

- `@prisma-next/cli` (M3) — CLI commands consume these functions

## Export Subpaths

| Subpath | Contents |
|---|---|
| `./types` | `MigrationManifest`, `MigrationOps`, `MigrationPackage`, `MigrationGraph`, `MigrationGraphEdge`, `MigrationHints` |
| `./io` | `writeMigrationPackage`, `readMigrationPackage`, `readMigrationsDir`, `formatMigrationDirName` |
| `./attestation` | `computeEdgeId`, `attestMigration`, `verifyMigration` |
| `./dag` | `reconstructGraph`, `findLeaf`, `findPath`, `detectCycles`, `detectOrphans` |

## On-Disk Format

Each migration is a directory containing two files:

```
migrations/
  20260225T1430_add_users/
    migration.json    # MigrationManifest
    ops.json          # AbstractOp[]
```

See [ADR 028](../../../docs/architecture%20docs/adrs/ADR%20028%20-%20Migration%20Structure%20%26%20Operations.md) and [ADR 001](../../../docs/architecture%20docs/adrs/ADR%20001%20-%20Migrations%20as%20Edges.md) for design rationale.

## Commands

```bash
pnpm build       # Build with tsdown
pnpm test        # Run tests
pnpm typecheck   # Type-check
```
