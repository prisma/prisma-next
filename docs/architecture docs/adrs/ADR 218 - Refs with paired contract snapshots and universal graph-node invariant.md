# ADR 218 — Refs with paired contract snapshots and universal graph-node invariant

## Status

Accepted. Recorded during [TML-2629](https://linear.app/prisma-company/issue/TML-2629/dev-ship-transition-broken-first-migration-plan-after-db-update) — the dev → ship transition trap where `db update` followed by `migration plan` produced an unapplyable migration when the on-disk graph was empty.

## Context

Prisma Next's migration planner is offline: it diffs two contract IRs and emits attested migration packages without connecting to a live database. That property is load-bearing — once the planner reads live state, every future feature pressure expands the read surface and the planner stops being a pure function of disk state.

Refs already exist as named pointers to contract hashes (`migrations/app/refs/<name>.json`). Environment targets (`production`, `staging`) use them today. What was missing for local dev workflows was a durable, version-controlled record of *which contract hash the dev database has been brought up to* — and a planner path that could diff against that hash even when it does not yet appear in the migration graph.

[TML-2629](https://linear.app/prisma-company/issue/TML-2629/dev-ship-transition-broken-first-migration-plan-after-db-update) surfaced the gap as a concrete failure mode (the J4 audit reproduction):

1. Developer runs `db init`, then iterates with `contract emit` + `db update` while the migration graph is still empty.
2. The live DB marker advances to the post-update contract hash, but nothing on disk records that hash as a planner-visible `from` end.
3. `migration plan` (defaulting `from` to the absent or stale `db` ref) emits a bundle whose `from` hash is not reachable from the empty graph.
4. `migrate` refuses with `MIGRATION.PATH_UNREACHABLE` — no actionable fix text, and no precise signal about whether the DB marker, on-disk graph, or local ref drifted.

Drift between three stores — live DB marker, on-disk migration graph, and named refs — had no structured diagnostics. Plan-time and apply-time checks now refuse early with recovery hints instead of emitting or attempting unapplyable work.

### J4 reproduction under the settled design

The audit reproduction from TML-2629 closes with one `migration plan` and one `migrate`:

| Step | Action | Disk after | DB after |
|---|---|---|---|
| 1 | `db init` (contract H_A) | `refs/db.json` = H_A; `refs/db.contract.json` = IR at H_A; graph empty | Marker = H_A |
| 2 | Edit contract → H_B; `contract emit` | Root `contract.json` = H_B; refs unchanged | Unchanged |
| 3 | `db update` | `refs/db.json` = H_B; paired snapshot refreshed; graph still empty | Marker = H_B |
| 4 | Edit contract → H_C; `contract emit` | Root `contract.json` = H_C | Unchanged |
| 5 | `migration plan --name add-comment-model` | Auto-baseline: two bundles — `<ts>_baseline/` (`null → H_B`) and `<ts>_add_comment_model/` (`H_B → H_C`) | Unchanged |
| 6 | `migrate` | Graph `null → H_B → H_C`; baseline skipped via idempotency; delta applied; `db` ref **not** advanced | Marker = H_C |
| 7 | `db update` (refresh `db` ref) | `refs/db.json` = H_C; snapshot refreshed | Marker = H_C (no-op diff) |

Step 6 could instead use `migrate --advance-ref db` to advance the ref in the same invocation. Step 7 is the user-discipline fallback when plain `migrate` is used.

Three architectural choices are tightly coupled; this ADR records them together rather than splitting across three smaller ADRs that would obscure the overall logic.

## Decision

### (1) Refs are stored with paired contract snapshots

Each on-disk ref `<name>` is a pointer file plus a paired contract snapshot:

```text
migrations/app/refs/
├── db.json                 # { "hash": "sha256:…", "invariants": [] }
├── db.contract.json        # full contract IR at the ref's hash
└── db.contract.d.ts        # typed import handle (mirrors migration bundle convention)
```

The pointer shape is unchanged from [ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md). The snapshot files are new: they exist because `migration plan` is a contract-diff engine. When `from` resolves to a ref whose hash is not yet the `to` end of any migration bundle, there is no `end-contract.json` on disk to read. The command that advances the ref already holds the contract IR; persisting it next to the pointer makes planner resolution a pure file read.

**Write rule:** whenever a ref is written or changed, its paired snapshot is written or refreshed. Whenever a ref is deleted, the paired snapshot is deleted in the same step. No stale ref contracts.

**Atomic paired primitives** implement the rule. [`writeRefPaired`](../../../packages/1-framework/3-tooling/migration/src/refs/snapshot.ts) writes the snapshot files first, then the pointer, rolling back snapshot files if the pointer write fails. [`deleteRefPaired`](../../../packages/1-framework/3-tooling/migration/src/refs/snapshot.ts) removes pointer and snapshot together, tolerating orphan partial states (pointer without snapshot, or snapshot without pointer).

Framework-driven writes (`db init`, `db update`, `migrate --advance-ref <name>`) pair every ref write with a snapshot write using the contract IR already in hand at command time. User-driven `ref set <name> <hash>` synthesizes the snapshot from the migration graph: the universal invariant (below) guarantees `<hash>` is a graph node, so its contract IR is available as `end-contract.json` on the bundle whose `to == <hash>`.

The read side stays simple: when the planner needs the contract at a ref's hash, it reads the paired snapshot directly via [`readRefSnapshot`](../../../packages/1-framework/3-tooling/migration/src/refs/snapshot.ts). No fallback logic, no read-side bifurcation.

This is the same snapshot-copy pattern [ADR 197 — Migration packages snapshot their own contract](ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md) applies to migration directories, extended to refs.

### (2) Universal "from must be a graph node" invariant

Any hash provided as a `from` end — explicitly via `--from`, implicitly via the default `db` ref, via ref-name resolution, or as a raw hash — must be a **node in the on-disk migration graph**, or the operation refuses with a structured diagnostic.

A hash is a graph node if it is:

- the `null` empty-graph sentinel (`sha256:empty`), or
- the `from` or `to` storage hash of any on-disk migration bundle.

A perfectly valid contract hash that does not appear in any bundle is *not* a graph node. That distinction is load-bearing.

Membership is enforced by [`isGraphNode`](../../../packages/1-framework/3-tooling/migration/src/graph-membership.ts) / [`assertHashIsGraphNode`](../../../packages/1-framework/3-tooling/migration/src/graph-membership.ts). The planner-side enforcement lives in [`plan-resolution.ts`](../../../packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts): when a non-null `from` hash is not a graph node on a non-empty graph, the command refuses with `MIGRATION.HASH_NOT_IN_GRAPH` and names reachable refs that point at graph nodes.

The invariant applies uniformly:

- `migration plan` resolving `--from <ref-or-hash>` or the default `db` ref.
- `migrate` resolving `--to <ref-or-hash>` (the target must be reachable; apply-time marker checks complement this).
- `ref set <name> <hash>` — the hash being set must be a graph node.
- Any future CLI surface that takes a contract reference.

**The one well-defined exception:** auto-baseline emission in `migration plan`. When the graph is empty and `from` resolves to a non-null hash with an available paired snapshot, the planner emits *two* bundles: a baseline `null → from-hash` that introduces `from-hash` as a graph node, plus the user's intended delta `from-hash → current_contract`. By the time downstream checks run, the hash is a node because the baseline bundle was written.

| Emission case | Condition | Output |
|---|---|---|
| Greenfield | Graph empty, `from` = `null` | One bundle: `null → current_contract` |
| Auto-baseline | Graph empty, `from` non-null, snapshot available | Two bundles: baseline + delta |
| Normal delta | Graph non-empty, `from` is a graph node | One bundle: `from → current_contract` |
| Forgot-the-flag | Graph non-empty, `from` not a graph node | Refuse: `MIGRATION.HASH_NOT_IN_GRAPH` |
| Snapshot missing | `from` non-null, no contract source | Refuse: `MIGRATION.SNAPSHOT_MISSING` |

See the [Migration System subsystem doc](../subsystems/7.%20Migration%20System.md) for resolution order and CLI flag detail.

Graph-node identity is by `storageHash` per [ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md).

### (3) Asymmetric ref-advancement

Ref advancement — writing a ref pointer and its paired snapshot — is **implicit by default only for dev-mode reconciliation commands**, and **opt-in everywhere else**.

| Command | Ref advanced? | Snapshot? |
|---|---|---|
| `db init` (default `--db` URL) | `db` (implicit) | yes (paired) |
| `db init --advance-ref <name>` | `<name>` (override) | yes |
| `db update` (default `--db` URL) | `db` (implicit) | yes |
| `db update --advance-ref <name>` | `<name>` (override) | yes |
| `db init` / `db update --db <non-default-url>` | none unless `--advance-ref` explicit | n/a unless explicit |
| `migrate` | **none** (no implicit default) | n/a |
| `migrate --advance-ref <name>` | `<name>` → post-apply marker | yes |
| `ref set <name> <hash>` | `<name>` → hash | yes (synthesised from graph bundle) |
| `ref delete <name>` | (delete ref + cascade snapshot) | n/a |

The implicit default is implemented in [`computeRefAdvancementName`](../../../packages/1-framework/3-tooling/cli/src/utils/ref-advancement.ts): when `--advance-ref` is omitted and `--db` is omitted (the project's default dev database URL), the ref name defaults to `db`. When `--db <non-default-url>` is supplied, ref advancement is suppressed unless `--advance-ref` is explicit — reconciling a different database is not the same as checkpointing this project's dev state.

**Rationale:** `db init` and `db update` are inherently about checkpointing the dev database; advancing a local marker ref *is* their meaning. `migrate` is generic — deploy, rollback test, CI apply — and must not infer dev-state intent. Production-shaped commands stay explicit; dev-mode reconciliation carries the implicit `db` default.

`db` is a default name, not a reserved or magic ref. The namespace is uniform; a user who runs `ref set db <hash>` gets exactly what they asked for, and the next dev command overwrites it on the next dev cycle if they pointed it elsewhere.

**Accepted trade-off:** after a plain `migrate`, the `db` ref may be stale (live marker advanced, ref did not). The user runs `db update` next (no-op on DB when marker already matches; refreshes ref + snapshot) or `migrate --advance-ref db`. If they run `migration plan` immediately with a stale `db` ref, the planner may emit a bundle from the stale hash; apply-time drift detection catches the discrepancy before DDL runs.

## Consequences

### Positive

- **J4 trap closed.** Auto-baseline emission lets `migration plan` produce two committable bundles (`null → H_dev`, `H_dev → H_current`) after `db update` against an empty graph — one plan call, one migrate call, no manual recovery sequence.
- **Plan-time refuse diagnostics** (`MIGRATION.HASH_NOT_IN_GRAPH`, `MIGRATION.SNAPSHOT_MISSING`) surface forgot-the-flag and missing-snapshot cases before any bundle is written. The user sees both bundles in `git status` before committing auto-baseline output — no silent file generation.
- **Apply-time refuse diagnostics** improve drift signal. `migrate` reads the live marker before DDL ([`errorMarkerMismatch`](../../../packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts) → `MIGRATION.MARKER_MISMATCH`) when the marker hash is not a graph node. `MIGRATION.PATH_UNREACHABLE` payloads now include actionable `fix` text (suggesting `migration plan --from <reachable>`).
- **Paired snapshot writes** from `db init`, `db update`, `migrate --advance-ref`, and `ref set` keep the offline planner's contract source on disk without live DB reads.
- **Discoverable recovery paths:** `migration plan --from <reachable-ref>`, `ref set db <marker-hash>`, `db update --advance-ref db` to repopulate a missing snapshot.

### Negative

- **Two-file (plus pointer) atomic writes** on every ref mutation. Cost is acceptable for the safety it provides — ref writes are infrequent compared to plan/apply, and partial states are rolled back or healed by tolerant delete primitives.
- **`db` ref staleness after plain `migrate`.** User discipline or `migrate --advance-ref db` required; apply-time drift check is the safety net when staleness causes a bad plan.
- **No recovery affordance for pre-fix broken repos** in this round. Legacy projects with already-committed bad plans need manual recovery or a future one-shot command; new plan-time refusal closes the trap going forward.

### Neutral

- **`ref list` unchanged behaviourally** — paired `*.contract.json` files are filtered out of ref enumeration; only pointer files appear as refs.
- **Planner stays offline.** No `--db` connection at plan time; the `db` ref + paired snapshot is the local source of truth for dev iteration state.
- **Extension head refs** already paired contract snapshots per [ADR 212 — Contract spaces](ADR%20212%20-%20Contract%20spaces.md); this design generalises the pairing to user-facing refs under `migrations/app/refs/`.

## Alternatives considered

### Implicit `db`-ref advancement on `migrate`

Rejected. Would make `db` magic instead of a simple default. Production-shaped apply commands must not infer dev-state intent. The asymmetry between dev reconciliation (`db update` implicit) and generic apply (`migrate` explicit) is cleaner than inconsistently-automatic behaviour.

### `migration plan` connecting to the DB to read the marker

Rejected. Breaks the offline-planner invariant. Once a connection exists at plan time, future code drift expands the read surface; "we just read one hash" does not generalise. The on-disk source-of-truth model (ref pointer + paired snapshot written by `db update`) achieves the same outcome without a connection.

### First-time-only baseline (refuse all subsequent uses of `--from` past graph tip)

Rejected. Dev-shaped workflows need `--from <ref>` to remain a common case on long-lived projects. Generalised catch-up (auto-emitting bundles whenever `from` is off-graph) would silently paper over forgot-the-flag situations. The refuse-with-hint path keeps the user in control and makes drift visible at plan time.

Other rejected alternatives from the design discussion share the same theme: compose existing primitives (refs, markers, graph) rather than introduce parallel storage or online planner reads.

| Alternative | Why rejected |
|---|---|
| `dev-state.json` parallel file | Duplicates ref semantics; uniform ref namespace is simpler |
| Reserved / protected `db` ref name | Users own refs; framework overwrites on next dev cycle |
| Per-ref directory layout (`refs/<name>/…`) | Requires migrating existing flat refs; re-evaluate if refs grow more paired artifacts |
| Generalised catch-up (auto-emit whenever `from` off-graph) | Silently papers over forgot-the-flag; refuse-with-hint keeps user in control |
| `migration plan --baseline` first-class command | Auto-baseline rule captures the affordance without a separate command users can't predict needing |
| `migration plan` refuses with live `--db` read | Same layering concern as online marker read; breaks offline planner |
| Silent fallback to graph tip when `db` ref off-graph | Violates explicit-over-implicit; refuse is louder by design |
| `db` ref as per-space (mirroring extension head refs) | Per-space ref CLI does not exist; expands scope beyond TML-2629 |

## Relation to existing ADRs

- **[ADR 197 — Migration packages snapshot their own contract](ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md)** — migration directories snapshot `end-contract.json` + `.d.ts` at scaffold time. Paired ref snapshots apply the same pattern to named pointers.
- **[ADR 198 — Runner decoupled from driver via visitor SPIs](ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md)** — apply-time marker drift check (`MIGRATION.MARKER_MISMATCH`) lives at the CLI layer before the runner is invoked, not inside the runner's graph walk.
- **[ADR 199 — Storage-only migration identity](ADR%20199%20-%20Storage-only%20migration%20identity.md)** — graph-node membership is keyed on `storageHash` bookends in migration manifests, not full contract IR equality.
- **[ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md)** — refs as version-controlled artifacts; this ADR extends the on-disk layout.
- **[ADR 123 — Drift Detection, Recovery & Reconciliation](ADR%20123%20-%20Drift%20Detection,%20Recovery%20&%20Reconciliation.md)** — plan-time and apply-time diagnostics complement the existing drift taxonomy.

See also the [Migration System subsystem doc](../subsystems/7.%20Migration%20System.md) for per-command behaviour, `--advance-ref` flag family, and recovery affordances.
