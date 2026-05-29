# Deferred from contract-ir-planes

Work that was in the project's original scope but explicitly deferred. Tracked here per PDoD1; Linear tickets are created **when each item is picked up** (not before — keeps the board to what's actually in flight).

## Background

The original S1.D ("reap subsumed surfaces") assumed all eight asymmetry-driven helpers were clean deletes. A 2026-05-29 inventory of the merged S1.A–S1.C substrate falsified that: three of the eight are not deletions but structural changes, each with its own risk profile and review focus. They are deferred so the **clean deletes ship now** (S1.D-1/-2/-3) without waiting on structural work. PDoD5 and PDoD10 were amended to scope these out (see [`spec.md`](./spec.md)).

## Deferred items

### 1. `SqlModelStorage` namespaced coordinate → delete `findSqlTable` + `assertUniqueSqlTableNames`

- **Why deferred:** `findSqlTable` looks tables up by bare name; deleting it requires `SqlModelStorage.table` to become a `{ namespaceId, table }` coordinate so callers can address a table unambiguously. That changes the on-disk `contract.json` shape → `storageHash` / `profileHash` regeneration across every in-tree contract and migration bookend (S1.C-scale fixture churn).
- **Blocks deletion of:** `findSqlTable`, `assertUniqueSqlTableNames`.
- **Shape of the work:** promote the coordinate; migrate every `findSqlTable` caller to address by coordinate; regenerate fixtures via `pnpm fixtures:emit`; serialization round-trip test on the new shape.
- **Was:** part of the symbol list in the original PDoD5.

### 2. `kind`-agnostic hashing → delete `stripNamespaceKinds`

- **Why deferred:** `stripNamespaceKinds` exists to paper over a hash-computation asymmetry — the descriptor self-consistency hash includes injected `kind` fields on one side but not the other. Removing it requires `assertDescriptorSelfConsistency`'s hash computation to be `kind`-agnostic. That is a hashing change, not a deletion, and carries its own regression surface (hash stability across the descriptor surface).
- **Blocks deletion of:** `stripNamespaceKinds`.
- **Shape of the work:** make the hash computation ignore injected `kind`; prove hash stability with a before/after fixture; then delete the shim.

### 3. Namespace-aware query-builder selection → delete query-builder `UnboundTables`

- **Why deferred:** the `query-builder` carries an `__unbound__`-only `UnboundTables` copy wired through ~4 files; it predates namespaces and assumes a single unbound namespace. Deleting it requires namespace-aware selection types in the query-builder — a type-system rewrite, not a deletion. (The separate `sql-builder` `UnboundTables` is already correct and **stays**.)
- **Blocks deletion of:** query-builder `UnboundTables<C>`. Closes [TML-2582](https://linear.app/prisma-company/issue/TML-2582) when done.
- **Shape of the work:** introduce namespace-aware selection types; rewire the ~4 query-builder files; remove the `__unbound__`-only copy. Likely lands with / after the S3 DSL work.

## What ships now (not deferred)

S1.D-1/-2/-3 deliver the clean deletes: `extractStorageElementNames`, `SqlNamespacePayload` / `MongoNamespacePayload`, `DEFAULT_NAMESPACES` (×2), `normaliseNamespaceEntry` (×2), and the framework canonicalizer's SQL-specific preserve-empty paths (→ family hook). See [`plan.md`](./plan.md) § Composition.
