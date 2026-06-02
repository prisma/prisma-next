# Plan: ledger foundation (TML-2769)

One branch / one PR (`tml-2769-make-the-migration-ledger-readable`). Three
dispatches, sequenced; each leaves the workspace green.

## Dispatch 1 — SQL write restructure + apply-layer threading

**Outcome:** Postgres + SQLite ledgers record **one row per applied migration
edge** (space + name + hash + per-edge from/to + that edge's ops), written inside
the per-space transaction in walk order. Mongo unchanged (still green).

- `apply.ts`: add `migrationEdges: r.entry.migrationEdges` to each
  `perSpaceOptions` entry.
- `2-sql/9-family/.../migrations/types.ts`: add optional `migrationEdges` to
  `SqlMigrationRunnerExecuteOptions`. Also add it (optional) to the **Mongo**
  runner execute-options type so `apply.ts` typechecks (Mongo consumes it in
  dispatch 2).
- PG + SQLite `statement-builders.ts`: `ensureLedgerTableStatement` gains
  `space`, `migration_name`, `migration_hash`; `buildLedgerInsertStatement`
  takes the per-edge input (`space`, `migrationName`, `migrationHash`, `from`,
  `to`, `operations`, `contractJsonBefore/After`).
- PG + SQLite `runner.ts`: replace the single `recordLedgerEntry` with a per-edge
  loop — for each `migrationEdges` entry, slice `plan.operations` by
  `operationCount` (walk order) and insert a row. `contract_json` endpoints only
  (single-edge: before=prior marker contract, after=destinationContract;
  multi-edge interiors null). `synth` plans (no `migrationEdges`) keep a single
  synthesised row keyed by plan destination.
- Tests (PG + SQLite adapter): single-edge, multi-edge (N rows, ops attributed
  per edge, order), synth (one row), row carries space/name/hash.

**Builds on:** nothing. **Hands to:** dispatch 2 (Mongo parity), dispatch 3 (reads).

## Dispatch 2 — Mongo write parity

**Outcome:** Mongo ledger docs match the per-edge journal shape.

- `marker-ledger.ts` `writeLedgerEntry`: accept per-edge input; add
  `migrationName`, `migrationHash`, `operations` to the doc (already has
  `space`/`from`/`to`/`appliedAt`).
- Mongo runner: consume `migrationEdges` from execute options; per-edge loop
  inside its write path, walk order. Synth → single doc.
- Tests (mongo adapter): single-edge, multi-edge, synth.

**Builds on:** dispatch 1's apply-layer threading + execute-options field.

## Dispatch 3 — `readLedger` SPI + reads + client plumbing

**Outcome:** `readLedger({ driver, space })` returns a space's entries in apply
order with cross-target parity, reachable from the CLI.

- `LedgerEntryRecord` in `@prisma-next/contract/types`.
- `readLedger` on `ControlFamilyInstance` (beside `readMarker`/`readAllMarkers`).
- PG/SQLite read statement (`… WHERE space = ? ORDER BY id`); Mongo aggregate
  (`$match { type:'ledger', space }`, insertion order); per-family wiring.
- Control client (`cli/src/control-api/client.ts` + `types.ts`) + a
  descriptor-free control-api operation, mirroring `readMarker`/`db-verify`.
- Tests: read round-trip per target + cross-target parity on `LedgerEntryRecord`.

**Builds on:** dispatches 1–2 (rows exist to read).
