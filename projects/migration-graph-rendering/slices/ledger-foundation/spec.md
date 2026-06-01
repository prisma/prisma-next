# Slice: ledger foundation — a readable per-migration journal

Linear: [TML-2769](https://linear.app/prisma-company/issue/TML-2769). Blocks
`status` ([TML-2748](https://linear.app/prisma-company/issue/TML-2748)) and `log`
([TML-2770](https://linear.app/prisma-company/issue/TML-2770)). Design context:
[`../../decisions.md`](../../decisions.md) (D7).

## The decision

Restructure the on-apply ledger into a **per-migration journal** — one row per
applied migration edge — and add a `readLedger` read API. Today the ledger is
write-only, its three target schemas have diverged, and it records **one
collapsed row per space-apply** (origin→destination spanning the whole walked
path). That shape can't answer the two questions `status` and `log` ask:

- `status`: "is *this migration* applied?" → a ledger row exists whose
  `migration_hash` matches the edge. Needs one row **per edge**.
- `log`: "what ran, in what order?" → one row **per apply event**, with the
  migration's name, `from→to`, and timestamp.

So the journal is per-edge, and every row records the **space id** of the
applied migration.

## Target row shape (all targets, normalised)

One row per applied migration edge:

| Field | Source | Notes |
|---|---|---|
| `space` | apply space id | **new** — SQL ledgers have no space column today |
| `migration_name` | `edge.dirName` | **new** |
| `migration_hash` | `edge.migrationHash` | **new** — the exact-match key `status` uses |
| `from` (origin core hash) | `edge.from` | null only for the ∅ origin |
| `to` (destination core hash) | `edge.to` | |
| `operations` | slice of `plan.operations` by `edge.operationCount` (walk order) | the edge's authored ops |
| `contract_json_before` / `_after` | apply endpoints only (see below) | retained, nullable |
| `applied_at` / `created_at` | now() | append order = apply order |

**`contract_json_before/after`:** kept (per the call to keep it until it's a
problem), but only the apply's **endpoints** are materialised — a single-edge
apply gets `before` = prior marker contract, `after` = `destinationContract`.
Multi-edge applies have no materialised intermediate snapshots, so interior
edges store `null`. No current consumer reads these columns; synthesising
intermediate contracts is out of scope.

## Schema convergence (away from today's divergence)

- **Postgres / SQLite** (identical today: `{id, created_at, origin/destination
  core+profile hash, contract_json_before/after, operations}`): add `space`,
  `migration_name`, `migration_hash`. `origin_core_hash`/`destination_core_hash`
  become the per-edge `from`/`to`.
- **Mongo** (today `{type:'ledger', space, edgeId, from, to, appliedAt}`): add
  `migrationName`, `migrationHash`, `operations`. Already has `space`/`from`/`to`/
  `appliedAt`.

This is a prototype — no back-compat / migration of existing ledger rows.

## Write path: one row per edge, inside the transaction

`migrate`/`db update`/`db init` walk a path of edges per space and collapse them
into one `plan` before handing off to the runner (`apply.ts` →
`runner.execute`). The per-edge breakdown (`PerSpacePlan.migrationEdges`:
`{migrationHash, dirName, from, to, operationCount}`) is **not** currently passed
to the runner. Thread it to the runner's per-space execute options, and replace
the single `recordLedgerEntry` call with a loop that inserts **one ledger row per
edge** — attributing ops by slicing `plan.operations` with each edge's
`operationCount` in walk order. The writes stay inside the per-space transaction
(atomic with marker advancement), and apply in walk order so append order is
apply order.

`synth`-produced plans (`db init`/`db update` greenfield) have no authored edges
(`migrationEdges` absent). They keep writing a single synthesised row keyed by
the plan's destination (name/hash derived from the plan; `from`=null) — the
journal still records that the space was initialised.

## Read API: `readLedger`

Add to `ControlFamilyInstance` (alongside `readMarker`/`readAllMarkers`):

```ts
readLedger(options: {
  readonly driver: ControlDriverInstance<TFamilyId, string>;
  readonly space: string;
}): Promise<readonly LedgerEntryRecord[]>; // append (apply) order
```

`LedgerEntryRecord` (new, beside `ContractMarkerRecord` in `@prisma-next/contract/types`):
`{ space, migrationName, migrationHash, from: string | null, to, appliedAt: Date, operationCount }`.
Implemented per target (PG/SQLite `SELECT … WHERE space = ? ORDER BY id`; Mongo
`$match: { type:'ledger', space }` sorted by insertion). Plumb through the
control client + a descriptor-free control-api operation, mirroring how
`readMarker`/`db-verify` reach the CLI.

## Done when

- Ledger rows carry `space` + `migration_name` + `migration_hash` on Postgres,
  SQLite, and Mongo, written **one per applied edge** inside the per-space
  transaction, in apply order.
- `readLedger({ driver, space })` returns that space's entries in apply order,
  with cross-target parity (same `LedgerEntryRecord` shape from all three).
- The control client exposes it; a control-api operation wraps it for the CLI.
- Tests: per-target write (single-edge, multi-edge, synth) + read round-trip,
  and cross-target parity on the read shape.

## Out of scope

- `status` / `log` command behaviour and rendering (TML-2748 / TML-2770).
- Synthesising intermediate contract snapshots for multi-edge `contract_json`.
- Pruning / compaction of ledger rows; back-compat migration of old rows.

## Reviewability

One reviewer holds this in one sitting: it's a single coherent change — "the
ledger becomes a readable per-migration journal." Likely decomposes into a
write/restructure dispatch (schema convergence + per-edge write across the three
targets + apply-layer threading) and a read dispatch (`readLedger` SPI + per-
target reads + client plumbing).

## References

- Parent project: [`../../README.md`](../../README.md), [`../../decisions.md`](../../decisions.md).
- Write seam: `cli/src/control-api/operations/apply.ts`, the SQL family runner
  (`packages/2-sql/9-family/.../migrations/runner` + `statement-builders.ts` for
  PG/SQLite), the Mongo runner + `marker-ledger.ts`.
- Read seam mirror: `ControlFamilyInstance.readMarker`/`readAllMarkers`
  (`framework-components/src/control/control-instances.ts`), CLI control client
  (`cli/src/control-api/client.ts` + `types.ts`).
- Per-edge breakdown: `migration-tools` `AggregateMigrationEdgeRef` /
  `PerSpacePlan` (`aggregate/planner-types.ts`).
