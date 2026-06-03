# Slice: `migration log` reads the DB ledger as a flat apply history

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to: `migration log` answers "what actually ran against this database, and when?" It reads the per-migration ledger journal (TML-2769) straight from the connected DB and prints it as one flat, chronological table — no graph, no per-space sections. It replaces today's `findPath(∅ → marker)` reconstruction from the on-disk graph, which lies whenever the DB and disk diverge. Tracking: [TML-2770](https://linear.app/prisma-company/issue/TML-2770)._

## At a glance

Human (TTY) — flat table, oldest first, local time:

```
$ prisma-next migration log
2026-06-01 10:00:00 +02:00   20260301_init        ∅ → ef9de27        5 ops
2026-06-02 10:00:00 +02:00   20260303_add_phone   ef9de27 → 73e3abe   2 ops
2026-06-03 11:00:00 +02:00   20260305_rollback    73e3abe → ef9de27   2 ops
```

`--utc` (human only) renders the same table in UTC; `--json`/pipes are always ISO-8601 UTC:

```
$ prisma-next migration log --json
[ { "space": "app", "migrationName": "20260301_init", "migrationHash": "sha256:…",
    "from": null, "to": "sha256:…", "appliedAt": "2026-06-01T08:00:00.000Z",
    "operationCount": 5 }, … ]
```

When more than one space has ledger rows, a `space` column appears:

```
2026-06-01 10:00:00 +02:00   app     20260301_init   ∅ → ef9de27   5 ops
2026-06-01 10:00:02 +02:00   audit   20260301_init   ∅ → 9a1c2f3   3 ops
```

## Chosen design

Per D8/D12/D13:

- **Source = the DB ledger, read unscoped.** The ledger is one flat table in storage (every row carries `space`). This slice makes the read API's space argument **optional** end-to-end (SPI `readLedger({ driver, space? })`, client `readLedger()`, both adapters), so `readLedger()` with no space returns the **whole table**; the adapters drop the `WHERE space = ?` (SQL) / space `$match` (Mongo) when it's omitted. `log` calls `readLedger()` and sorts by `appliedAt` **ascending** (apply order). No on-disk graph, no `findPath` (replaces today's reconstruction), no per-space enumeration. (`status` keeps the *scoped* `readLedger(space)` form, unchanged.)
- **One flat table, not space-sectioned (D12).** No `--space` flag, no per-space headings. A `space` column is shown **only when >1 space** contributes rows (single-space — the common case — omits it as noise).
- **Uniform rows (D12 / KISS).** Every row is the same shape: `appliedAt · [space] · migrationName · from → to · N ops`. `log` does **not** classify apply vs rollback vs re-apply (that needs graph analysis a DB-sourced command shouldn't do). The same migration recurring (apply → rollback → re-apply) is just repeated rows; the `from → to` direction and repetition reveal the timeline. `from` of `null` renders `∅`.
- **Timestamps (D13).** Human/TTY → **local timezone** with offset for unambiguity (`2026-06-01 10:00:00 +02:00`). `--utc` → human output in UTC (`2026-06-01 08:00:00Z`). `--json` and any non-TTY/machine output → ISO-8601 UTC (`2026-06-01T08:00:00.000Z`) **regardless of `--utc`** (machine output is timezone-stable by contract). Non-TTY already auto-switches to JSON, so a piped `log` is UTC by construction.
- **`--json`** = the merged `LedgerEntryRecord[]`, sorted by `appliedAt` ascending, `appliedAt` serialized as the ISO-8601 UTC string. No wrapping object (it's a list).
- **Online only.** `log` reports DB truth, so it requires a connected DB; no offline/on-disk fallback (unlike `status`'s `--from`). Connection failure is the usual structured connect error.

## Scope

**In:**

- Make the ledger read API's space argument **optional** (SPI `control-instances.ts`, client `readLedger()`, SQL adapter, Mongo adapter): unscoped read returns the whole table. Adapter unit/integration tests for the unscoped path (all spaces, deterministic order).
- `migration log` reads the unscoped ledger (`readLedger()`), sorted by `appliedAt` asc.
- Flat aligned table; `space` column only when >1 space; `from null → ∅`; `N ops`.
- `--utc` flag (human-only); local-tz default for human; ISO-UTC for JSON/non-TTY.
- `--json` = merged `LedgerEntryRecord[]` (ISO-UTC `appliedAt`), sorted asc.
- Empty-ledger message.
- Tests: single-space table; multi-space (space column); rollback/re-apply repetition; `--utc`; `--json` shape + UTC; empty ledger; DB-required error.

**Out:**

- Graph rendering of any kind (`log` is a table — D8).
- Per-space sectioning / `--space` (explicitly dropped — D12).
- Semantic apply/rollback/re-apply classification (D12).
- The ledger *write* path and `LedgerEntryRecord` shape (TML-2769, merged) — unchanged; this slice only widens the *read* to be unscoped.
- `status`'s use of the scoped `readLedger(space)` — unchanged.

## Pre-decided edge cases

| Edge case | Disposition |
|---|---|
| Empty ledger (no rows in any space) | Print `No migrations have been applied to this database.`; `--json` → `[]`. |
| Single space | `space` column omitted; table is `appliedAt · name · from→to · ops`. |
| Multiple spaces | `space` column shown; rows still globally sorted by `appliedAt` (interleaved across spaces). |
| Same migration applied → rolled back → re-applied | Three separate rows in apply order; no special glyph, the `from → to` directions tell the story. |
| `from` is `null` (initial / empty-origin) | Renders `∅` in the table; JSON keeps `null`. |
| Ties on `appliedAt` (same timestamp, e.g. coarse clock) | Stable secondary sort by `(space, migrationName)` so output is deterministic. |
| No DB connection | Structured connect error (DB required); no fallback. |
| A space with ledger rows but no marker | Still appears — the unscoped read returns rows regardless of markers (this is exactly why unscoped beats marker-enumeration). |

## Dispatch plan

1. **Unscope the ledger read.** Make `space` optional through the stack: SPI `readLedger({ driver, space? })` (`control-instances.ts`), client `readLedger()` (drop the `APP_SPACE_ID` default; pass `space: undefined`), SQL adapter (`control-adapter.ts`/`control-instance.ts` — conditional `WHERE space`), Mongo adapter (`mongo-control-adapter.ts`/`marker-ledger.ts` — conditional space `$match`). Adapter + client tests for the unscoped path (multiple spaces, deterministic order). *Hands to 3. Update the existing no-arg client test (`client.test.ts:888`) to the all-spaces expectation.*
2. **Table renderer.** Render `LedgerEntryRecord[]` → aligned flat table: optional `space` column (present iff >1 distinct space), `∅` for null `from`, `N ops`, and a timestamp formatter with three modes (local+offset / UTC-`Z` / ISO). Sort by `appliedAt` asc with `(space, migrationName)` tie-break. Unit tests (single vs multi-space columns; local vs `--utc`; empty; ties). *Hands to 3. Independent of 1.*
3. **Command rewrite.** Rewrite `migration-log.ts`: drop the `findPath` reconstruction; call `readLedger()` (1), render via (2) for human, emit the sorted list for `--json` (ISO-UTC). Add the `--utc` flag (human-only). Empty-ledger message. DB-required. Command tests. *Builds on 1+2.*

## Slice-specific done conditions

- `readLedger()` (unscoped) returns the whole ledger table across both adapters; `migration log` prints it as one flat chronological table (`space` column only when >1 space), oldest first; rollback/re-apply appear as repeated uniform rows; human time is local (`--utc` switches to UTC); `--json` is the `LedgerEntryRecord[]` in ISO-UTC sorted ascending; empty ledger prints the message / `[]`; no DB → structured error; no `findPath`/on-disk reconstruction remains in `migration-log.ts`; CI green.

## Sequencing

Parallel with `list`→tree (TML-2768) and `status` (TML-2748). Fully independent of the renderer overlay work (D11) — `log` does not use the tree at all, so it shares no code surface with the other two slices.

## References

- Project decisions: `projects/migration-graph-rendering/decisions.md` (D8, D12, D13).
- Linear: [TML-2770](https://linear.app/prisma-company/issue/TML-2770); lineage [TML-2697](https://linear.app/prisma-company/issue/TML-2697).
- Ledger read (to unscope): `ControlClient.readLedger` (`cli/src/control-api/client.ts`), SPI `control-instances.ts`, SQL `control-adapter.ts`/`control-instance.ts`, Mongo `mongo-control-adapter.ts`/`marker-ledger.ts`; `LedgerEntryRecord` (`framework/0-foundation/contract/src/types.ts`).
- Current log (to replace): `cli/src/commands/migration-log.ts` (`findPath`-based).
