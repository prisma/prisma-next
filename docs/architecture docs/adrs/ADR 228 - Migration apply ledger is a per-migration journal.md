# ADR 228 — Migration apply ledger is a per-migration journal

## Status

Accepted. Builds on [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) and [ADR 021 — Contract marker storage](./ADR%20021%20-%20Contract%20Marker%20Storage.md).

## Decision

Every `migrate` run appends one row to the ledger per applied migration edge. The row carries:

```ts
// packages/1-framework/0-foundation/contract/src/types.ts
export interface LedgerEntryRecord {
  readonly space: string;
  readonly migrationName: string;   // directory name of the migration package
  readonly migrationHash: string;
  readonly from: string | null;     // null for the baseline (empty-DB) edge
  readonly to: string;
  readonly appliedAt: Date;
  readonly operationCount: number;
}
```

The ledger is append-only. Rows are written per-edge, in walk order, inside the per-space transaction. The `operationCount` is derived from the migration's operation list at write time so the journal is self-contained.

Two commands read the ledger via `ControlFamilyInstance.readLedger`:

```ts
// packages/1-framework/3-tooling/cli/src/control-api/types.ts
readLedger(space?: string): Promise<readonly LedgerEntryRecord[]>
```

- `migration status` — calls `readLedger` per space to determine which migrations are applied. A migration is **applied** when any ledger row carries its `migrationHash`. A migration is **pending** when it is on the shortest path from the DB's current contract hash to the live contract and is not applied.
- `migration log` — calls `readLedger()` with no space argument to read the whole table across all spaces, then renders in apply order.

### `migration log` rendering

`migration log` renders the ledger as a flat table. Rows are sorted by `appliedAt` ascending, with `space` + `migrationName` as secondary sort keys for ties. The `Space` column is omitted when only one space contributes rows.

The same migration edge may appear multiple times (apply → rollback → re-apply produces multiple rows). `log` renders them as repeated rows without classifying the direction — the `from → to` transition and repetition tell the story.

`--json` emits ISO-8601 UTC timestamps (`2026-06-02T14:37:31.000Z`) regardless of locale. Human/TTY output renders in the local timezone with offset (`2026-06-02 16:37:31 +02:00`); `--utc` switches to UTC in human output (`2026-06-02 16:37:31Z`). Non-TTY output auto-switches to `--json`, so a piped `migration log` is always UTC.

The ledger's `migrationName` is used directly — there is no on-disk lookup. Packages deleted after apply still appear in `log` under their original name.

### Cross-target parity

All adapters (Postgres, SQLite) implement the same `readLedger(space?: string)` signature and return rows in the same shape. When `space` is omitted, adapters return the full table without filtering.

This is a prototype-era ledger. There is no migration of existing rows from older schemas. Older targets (those that wrote a single collapsed row per space-apply rather than one row per edge) are not back-compatible with this shape.

## Context

Each adapter already wrote an append-only ledger on `migrate`, but no command read it. The pre-existing ledger stored one collapsed row per space-apply (covering the entire walked path from origin to destination), and the three adapter schemas had diverged (Postgres/SQLite lacked a `space` column; MongoDB lacked `operations`).

`migration status` needed to know which individual migrations had been applied — a collapsed row cannot answer that. `migration log` needed to show the real apply history in walk order — a collapsed row cannot distinguish which edges within a space-apply ran in sequence.

Restructuring to one row per edge makes both consumers straightforward: `status` matches on `migrationHash`; `log` renders rows directly.

## Design

### Ledger writes

Writes happen inside the per-space migration transaction. The runner threads the list of applied `migrationEdges` through `PerSpacePlan` to the write site. One row is appended per edge in the order the edges were walked.

### Applied vs pending in `status`

The applied/pending classification is intentionally simple:

- **Applied** means a ledger row exists with this `migrationHash`. A migration that was rolled back and re-applied counts as applied — the full timeline is visible in `log`.
- **Pending** means the migration is on the shortest path from the current DB hash to the live contract, and it is not applied.

Migrations neither applied nor on the pending path render plain (present on disk, irrelevant to the current trajectory).

### Flat table for `log`

`log` is the one read command that does not draw the tree. The ledger is flat in storage — each row carries its `space` — and the same edge can recur. A tree cannot represent repetition, so `log` renders a table.

`log` has no `--space` flag and no per-space headings. It reads the full ledger and shows a `Space` column only when more than one space contributes rows.

## Consequences

- `readLedger` is a read-only primitive on `ControlFamilyInstance`, beside `readMarker` and `readAllMarkers`. It carries no write side-effects.
- The `migration log` command is online-only (the DB is the source). It does not reconstruct history from on-disk state.
- The prototype ledger has no back-compat migration. Existing databases with the old collapsed-row schema are not supported; a fresh `migrate` rewrites in the new shape.
- `operationCount` is denormalized onto the ledger row to make the journal self-contained. If storage is a concern, this field (and any future non-essential fields) can be made opt-in without breaking `status`/`log`, which need only `migrationName`/`migrationHash`/`from`/`to`/`appliedAt`.

## Alternatives considered

- **Reconstruct apply history from on-disk state** (`findPath(∅ → marker)`). Rejected. The reconstruction picks the wrong branch in branching histories and misidentifies creation time as apply time. The ledger is the only authoritative source.
- **One collapsed row per space-apply** (the pre-existing shape). Rejected. It cannot answer per-migration applied/pending queries and cannot represent multi-edge walk order within a single apply.
- **Per-space `readLedger(space)` only, no unscoped call.** The original API was per-space; `log`'s need to read across all spaces motivated making the `space` argument optional. The unscoped call is a backwards-compatible extension.

## References

- [ADR 039 — Migration graph path resolution & integrity](./ADR%20039%20-%20Migration%20graph%20path%20resolution%20%26%20integrity.md) — graph walk that produces the edge sequence written to the ledger.
- [ADR 021 — Contract marker storage](./ADR%20021%20-%20Contract%20Marker%20Storage.md) — the DB marker that provides `status`'s origin hash.
- [ADR 227 — Migration read commands share one graphical renderer with command-specific annotations](./ADR%20227%20-%20Migration%20read%20commands%20share%20one%20graphical%20renderer%20with%20command-specific%20annotations.md) — how the ledger-derived annotations are fed into the shared renderer.
- Tickets: TML-2769 (ledger foundation), TML-2770 (`migration log`), TML-2748 (`migration status` applied/pending overlay).
