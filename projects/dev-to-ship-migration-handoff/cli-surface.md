# CLI surface delta: dev-to-ship-migration-handoff

> The CLI changes implied by the settled design, in reference-doc form. Read this if you want to know **what changes about the user-facing commands** and **what the new on-disk write rules are**. Read [`design-notes.md`](./design-notes.md) for *why*; read [`scenarios.md`](./scenarios.md) for *how it feels in practice*.

## New flag: `--advance-ref <name>`

A single new flag on multiple commands. Long form `--advance-ref <name>`; possible shorthand `--advance <name>` (slice-time bikeshedding).

**Semantic:** "After this command succeeds and changes the DB state, write the named ref to the resulting contract hash and pair it with a contract snapshot."

**Applies to:**

- `prisma-next db init` — overrides the implicit default of `db`.
- `prisma-next db update` — overrides the implicit default of `db`.
- `prisma-next migrate` — opt-in only; no implicit ref write without this flag.

**Does not apply to:**

- `prisma-next migration plan` — never writes refs (planner is offline; refs are dev-state tracking).
- `prisma-next ref set <name> <hash>` — already writes a specific ref by name.
- `prisma-next ref delete <name>` — deletes specifically.

## Modified flag behaviour: `migration plan --from <ref-or-hash>`

`--from` exists today (scout report § 2). Its grammar is unchanged: accepts a ref name, full hash, hash prefix, migration directory name, `<dir>^`, or filesystem path.

What changes:

- **Default when `--from` is absent**: today, `migration plan` walks the graph for the latest tip (or `null` if empty). The new default is **the `db` ref** (or `null` if the `db` ref doesn't exist). See [`design-notes.md § migration plan: resolution and emission`](./design-notes.md#migration-plan-resolution-and-emission) for the full resolution rules.
- **Universal invariant enforcement**: if `--from <hash>` resolves to a hash that isn't a graph node (and isn't `null`), refuse at plan time. The graph-bundle lookup at `migration-plan.ts (L254-265)` already does this check today; the new behaviour extends the same check to ref-resolved values.
- **Contract source resolution**: when `--from <name>` resolves via a ref name, the planner reads the paired snapshot at `migrations/app/refs/<name>.contract.json` for the from-contract. This is new — today's planner reads only from migration-bundle `end-contract.json` files.

## Write rules: who pairs a ref with a contract snapshot

The settled rule (from [`design-notes.md`](./design-notes.md#ref-advancement-write-rules-across-commands)):

| Invocation | Default ref advanced? | Snapshot written? |
|---|---|---|
| `db init` (default DB) | `db` | yes |
| `db init --advance-ref <name>` | `<name>` | yes |
| `db init --db <non-default-url>` | none (unless `--advance-ref`) | only if `--advance-ref` |
| `db update` (default DB) | `db` | yes |
| `db update --advance-ref <name>` | `<name>` | yes |
| `db update --db <non-default-url>` | none (unless `--advance-ref`) | only if `--advance-ref` |
| `migrate` (no `--to`, default DB) | **none** | n/a |
| `migrate --to <X>` (default DB) | **none** | n/a |
| `migrate --advance-ref <name>` (no `--to`) | `<name>` → current contract hash | yes |
| `migrate --to <X> --advance-ref <name>` | `<name>` → X (resolved) | yes |
| `migrate --db <non-default-url>` (any combo) | none (unless `--advance-ref`) | only if `--advance-ref` |
| `ref set <name> <hash>` | `<name>` → hash | yes (synthesised from graph bundle whose `to == hash`) |
| `ref delete <name>` | (delete) | (cascade — snapshot file also deleted) |

**Two principles encoded in the table:**

1. **`db` is a default, not magic.** The dev-command family (`db init`, `db update`) defaults to advancing `db` because dev-state tracking is their purpose; the same `--advance-ref` flag overrides cleanly.
2. **`migrate` is explicit-only.** No implicit ref writes. The user opts in with `--advance-ref` for any ref advancement.

## On-disk layout

Refs and their paired snapshots:

```
migrations/
  app/
    refs/
      db.json                  # ref pointer (hash + invariants)
      db.contract.json         # paired contract snapshot (full IR)
      db.contract.d.ts         # paired typed handle (matches migration-bundle convention)
      production.json
      production.contract.json
      production.contract.d.ts
      staging.json
      staging.contract.json
      staging.contract.d.ts
      ...
```

**Sibling-file layout** (decided over per-ref directory; see [`design-notes.md § Alternatives considered`](./design-notes.md#alternatives-considered)). Existing flat `<name>.json` refs from projects that already use refs are forward-compatible: the framework just writes the `.contract.json` and `.contract.d.ts` siblings on the next ref-write.

## `migration plan` output shape

Existing today:

- `migration plan --name <slug>` writes one bundle: `migrations/app/<ts>_<slug>/` with `migration.json`, `ops.json`, `migration.ts`, `start-contract.json`, `start-contract.d.ts`, `end-contract.json`, `end-contract.d.ts`.

New under this design:

- **Auto-baseline case**: when the graph is empty and `from` resolves to a non-null hash with an available contract source, `migration plan` writes **two** bundles in the same invocation:
  - `migrations/app/<ts>_baseline/` — `from=null, to=from-hash`, ops = full schema creation from empty.
  - `migrations/app/<ts>_<slug>/` — `from=from-hash, to=current-contract`, ops = `diff(from-contract, current-contract)`.
  
  Both are reported in the command's output so the user knows what landed.

The single-bundle and refusal cases are unchanged in output shape (just-one-bundle and no-bundle respectively).

## Apply-time drift check in `migrate`

New behaviour, additive to today's path:

1. `migrate` resolves the apply path through the graph as today.
2. **New step**: before running any DDL, read the live DB marker (the runner already establishes the connection).
3. **New step**: compare the live marker against the planned `from` hash of the next-to-apply migration.
4. **Mismatch**: refuse with `PN-RUN-3000` carrying improved fix text (current text has no actionable hints; scout report § 5). Diagnostic names live marker, planned `from`, and concrete mitigations.
5. **Match**: proceed with apply as today.

The existing post-mismatch path (`PN-RUN-3000 pathUnreachable`) still fires for cases where the marker is at a hash that isn't reachable in the graph at all. The new check is the pre-DDL refusal; the existing check is the post-graph-walk refusal. Both produce `PN-RUN-3000` but with different `meta.kind` discriminants (slice-time: define the discriminant for the new case, e.g. `meta.kind: 'markerMismatch'` vs the existing `'pathUnreachable'`).

## Affected commands at a glance

| Command | Today's behaviour | New behaviour |
|---|---|---|
| `db init` | Applies schema; writes marker. Nothing on disk under `migrations/`. | Same, plus: writes `db` ref + paired snapshot (default) or `<name>` ref + snapshot (with `--advance-ref`). |
| `db update` | Live-introspects; applies diff; writes marker. Nothing on disk under `migrations/`. | Same, plus: writes `db` ref + paired snapshot (default) or `<name>` ref + snapshot. |
| `migration plan` | Reads graph tip (or null) as `from`; emits one bundle. | Defaults `from` to `db` ref; emits one or two bundles per [resolution and emission rules](./design-notes.md#migration-plan-resolution-and-emission); reads from-contract from paired snapshot or graph bundle. |
| `migrate` | Resolves path; applies. Writes marker. Nothing under `migrations/`. | Same, plus: optional `--advance-ref <name>` writes ref + paired snapshot. New pre-DDL drift check (improved `PN-RUN-3000` payload). |
| `ref set` | Writes ref pointer. | Same, plus: synthesises and writes paired contract snapshot. Refuses if hash isn't a graph node (universal invariant). |
| `ref delete` | Deletes ref pointer. | Same, plus: cascades to delete paired snapshot. |
| `ref list` | Lists refs. | Unchanged. |

## Skill text touchpoints

Two skills cover the workflows this design changes. Updates lie in the slice that ships the diagnostic wording (see [`design-notes.md § Open questions`](./design-notes.md#open-questions--accepted-trade-offs)).

### `skills-contrib/prisma-next-migrations/SKILL.md`

Needs additions:

- A "dev → ship transition" section explaining the `db` ref's role; what `db init` / `db update` write; how `migration plan` defaults `from`; what the auto-baseline two-bundle output means and why the user sees both directories.
- An update to the "common pitfalls" section describing the forgot-the-flag case (post-formalisation `db update` without `--from production`).

### `skills-contrib/prisma-next-migration-review/SKILL.md`

Needs additions:

- A row for the new pre-DDL drift error (with `meta.kind` discriminant) distinct from the existing `pathUnreachable`.
- An update to the `MIGRATION.MARKER_NOT_IN_HISTORY` row noting that this status diagnostic is now complemented by a runtime-error variant from `migrate` itself with better fix text.

## Subsystem doc touchpoints

`docs/architecture docs/subsystems/7. Migration System.md`:

- § Refs (environment targets) — update to mention paired contract snapshots and the `db` ref as a framework-default name.
- § `db init` — update to mention ref + snapshot writes.
- § `db update` (live reconciliation) — update to mention ref + snapshot writes.
- § Helpful commands — update flag listings (`--advance-ref` on `db init`, `db update`, `migrate`).
- Possibly: a new subsection on the universal "from must be a graph node" invariant if it isn't already implicit in § Edges, Node Tasks, and Marker.

## Possible ADR

The refs-with-paired-snapshots pattern and the universal "from must be a graph node" invariant may warrant a dedicated ADR (one or two) when the slices land. Decide at slice time; the design-notes here are the source for whoever writes the ADR.
