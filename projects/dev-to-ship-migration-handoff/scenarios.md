# Worked scenarios: dev-to-ship-migration-handoff

> Concrete step-by-step walkthroughs of the user-facing workflows under the settled design. Read this if you want to know *how it feels* for a developer to use the system; read [`design-notes.md`](./design-notes.md) first if you want to know *why it's shaped this way*.

Every scenario tracks three pieces of state at each step:

- **Disk** — what's on disk under `migrations/app/`, `contract.json`, etc.
- **DB** — the live database marker.
- **Refs** — what `migrations/app/refs/*.json` say (and their paired snapshots).

All hashes are abbreviated (`H_A`, `H_B`, …) for readability.

## Scenario A — J4: first formalisation after dev iteration (the trap-closing case)

This is the audit reproduction from TML-2629. Under the old design it produced an unapplyable migration; under the new design it produces a clean two-bundle output.

| Step | Action | Disk | DB | Refs |
|---|---|---|---|---|
| 1 | `prisma-next db init` (contract at H_A) | `contract.json` = H_A. Graph: empty. | Marker = H_A. | `db = H_A` + snapshot. |
| 2 | Edit `schema.prisma` (add `avatarUrl: String?`); `prisma-next contract emit` produces H_B. | `contract.json` = H_B. | Unchanged. | Unchanged. |
| 3 | `prisma-next db update` | `contract.json` = H_B. Graph: empty. | Marker = H_B (live diff applied). | `db = H_B` + snapshot. |
| 4 | Edit `schema.prisma` (add `Comment` model + FKs); `prisma-next contract emit` produces H_C. | `contract.json` = H_C. | Unchanged. | Unchanged. |
| 5 | `prisma-next migration plan --name add-comment-model` | `migrations/app/<ts>_baseline/` (`from=null, to=H_B`, ops = create H_B schema from empty); `migrations/app/<ts>_add_comment_model/` (`from=H_B, to=H_C`, ops = Comment + FKs). | Unchanged. | Unchanged. |
| 6 | Inspect output before committing — two new directories in `git status`. Both are committable as one PR. | Same. | Unchanged. | Unchanged. |
| 7 | `prisma-next migrate` | Same. | Path: `H_B → H_C`. Baseline's postconditions already satisfied (idempotency); skipped. Delta applied. Marker = H_C. | Unchanged (no `--advance-ref`). |
| 8 | _(optional)_ `prisma-next db update` to refresh `db` ref | Same. | Marker = H_C (no-op). | `db = H_C` + refreshed snapshot. |

**Result.** Trap closed in one `migration plan` + one `migrate`. No recovery sequence. Step 8 is the user-discipline refresh; could be folded into step 7 by running `prisma-next migrate --advance-ref db` instead.

The auto-baseline (step 5, first bundle) makes the migration history complete: a teammate cold-cloning the repo can run `migrate` from-scratch and the path `null → H_B → H_C` walks them up to current state without ever needing to have iterated locally.

## Scenario B — iterative on a long-running project with `--from production`

The most common workflow on an established codebase. Production is at some hash `H_prod`; the user iterates locally with `db update`, then cuts a single formal migration for their PR.

| Step | Action | Disk | DB | Refs |
|---|---|---|---|---|
| 0 (initial) | Long migration history; production deployed at H_prod. | Graph reaches H_prod. `contract.json` = H_prod. | Local marker = H_prod (from a prior `migrate`). | `db = H_prod` + snapshot. `production = H_prod` + snapshot. |
| 1 | Edit `schema.prisma`; `contract emit` produces H_1. | `contract.json` = H_1. | Unchanged. | Unchanged. |
| 2 | `prisma-next db update` | Same. | Marker = H_1 (live diff). | `db = H_1` + snapshot. |
| 3 | More edits; `contract emit` produces H_2. | `contract.json` = H_2. | Unchanged. | Unchanged. |
| 4 | `prisma-next db update` | Same. | Marker = H_2. | `db = H_2` + snapshot. |
| 5 | Final edits; `contract emit` produces H_3. | `contract.json` = H_3. | Unchanged. | Unchanged. |
| 6 | `prisma-next migration plan --from production --name add-feature` | `migrations/app/<ts>_add_feature/` (`from=H_prod, to=H_3`, ops = `diff(H_prod-contract, H_3-contract)`). One bundle. No baseline (H_prod is already a graph node; long history reaches it). | Unchanged. | Unchanged. |
| 7 | Commit, push, open PR. CI applies migration to a shadow DB to verify; later production deploy applies it for real. | Same. | (Local) unchanged. (Production CI) marker advances to H_3. | Unchanged locally. |

**Result.** Single committable bundle. The `db` ref participated in `db update` (steps 2 and 4) but was bypassed by the explicit `--from production` at plan time. The local dev DB is at H_2 (last `db update`) while the migration's `from` is H_prod; these don't need to match because the migration is for production's consumption, not the developer's local DB.

After the PR merges and production deploys, the developer typically runs `git pull` + `prisma-next migrate` to bring their local DB to H_3. Whether `db` ref advances during that step depends on whether they pass `--advance-ref db` (or run `db update` afterwards). The drift diagnostics catch any case where stale state causes confusion.

## Scenario C — forgot-the-flag (post-formalisation `db update`, then plan without `--from`)

A developer continues to use `db update` after formalisation, then accidentally runs `migration plan` without `--from production`. The new design catches this at plan time with a precise diagnostic.

| Step | Action | Disk | DB | Refs |
|---|---|---|---|---|
| 0 (initial) | After Scenario B's PR merged. | Graph reaches H_3 via H_prod → H_3. `contract.json` = H_3. | Marker = H_3 (after `git pull` + `migrate`). | `db = H_3` + snapshot (refreshed by `db update` or `migrate --advance-ref db`). `production = H_3` (advanced post-deploy by CI or manual `ref set`). |
| 1 | Edit `schema.prisma`; `contract emit` produces H_4. | `contract.json` = H_4. | Unchanged. | Unchanged. |
| 2 | `prisma-next db update` | Same. | Marker = H_4 (live diff). | `db = H_4` + snapshot. **H_4 is not yet a graph node.** |
| 3 | More edits; `contract emit` produces H_5. | `contract.json` = H_5. | Unchanged. | Unchanged. |
| 4 | `prisma-next migration plan --name add-thing` (no `--from`) | **Refuses.** Default `from = db ref = H_4`. Graph contains nodes `{null, H_B, H_C, …, H_prod, H_3}` (none of them H_4). Plan-time refuse-with-diagnostic. | Unchanged. | Unchanged. |

Diagnostic body (slice-time wording):

```
PN-MIG-2xxx: Cannot plan migration — `from` hash is not in the migration graph.

  Resolved `from` (from ref `db`): sha256:H_4
  This hash does not appear in any on-disk migration bundle.

Did you mean one of these?
  --from production  (sha256:H_3)
  --from staging     (sha256:H_3)

Available refs pointing at graph nodes:
  production, staging

If you really want to start a new migration from H_4, run `prisma-next migration plan --from production` first to bring the graph up to H_3, then iterate.
```

(Wording slice-time; shape is settled.)

**Result.** The user gets a precise, actionable diagnostic instead of an unapplyable bundle. They re-run with `--from production`, which produces a clean `H_prod → H_5` bundle (or `H_3 → H_5` if production has already advanced).

## Scenario D — cold clone with stale local DB (apply-time drift)

A teammate clones the repo after the PR from Scenario B merged. Their local DB happens to already exist (from an earlier branch they were on) at some hash `H_X` that doesn't match the migration graph's expectations.

| Step | Action | Disk | DB | Refs |
|---|---|---|---|---|
| 0 (initial) | Teammate's machine: had a local DB from a different branch at hash H_X (unrelated to current migration graph). | (After `git pull`) Graph reaches H_3. `contract.json` = H_3. | Marker = H_X. | (After `git pull`) `db = H_3` (from prior `git pull` if the team commits refs) — depends on team's git practice. |
| 1 | `prisma-next migrate` | Same. | Apply-time drift check: live marker (H_X) ≠ planned `from` (depending on the path computed). **Refuses pre-DDL.** | Unchanged. |

Diagnostic body (slice-time wording):

```
PN-RUN-3000: Cannot apply migration — live database marker does not match the
expected starting hash.

  Live DB marker: sha256:H_X
  Planned from:   sha256:H_3 (the latest graph tip for default `migrate`)

Your database is in a state that doesn't connect to the migration graph.

Likely fixes:
  1. If your DB is meant to be at the contract's current state, run:
       prisma-next db sign --db <url>
     to record the marker as matching, then re-run `migrate`.

  2. If your DB is at a stale state and you want to advance it:
       prisma-next db update --db <url>
     will bring it to the current contract via live introspection.

  3. If you have a known-correct hash you want to record, run:
       prisma-next ref set db <hash>
     then re-run `migrate --advance-ref db`.
```

**Result.** Drift surfaces *before* any DDL runs. Different teammates can have different local DB states, and the framework doesn't pretend everything is fine — it names the discrepancy and offers concrete recovery paths.

## Scenario E — CI deploy via `migrate --to production --advance-ref staging`

A CI flow that deploys to staging using the production-targeted migration and advances the staging ref to match.

| Step | Action | Disk | DB (staging) | Refs |
|---|---|---|---|---|
| 0 (initial) | Repo has migration graph through H_prod. Staging DB last deployed at H_old. | Graph reaches H_prod. | Marker = H_old. | `production = H_prod` + snapshot. `staging = H_old` + snapshot. `db = …` (developer's local; unused in CI). |
| 1 | CI: `prisma-next migrate --db <staging-url> --to production --advance-ref staging` | Same. | Path: `H_old → … → H_prod`. Apply intermediate migrations as needed. Marker = H_prod. | `staging = H_prod` + refreshed snapshot. |
| 2 | (Future deploy) `prisma-next migrate --db <prod-url> --to production --advance-ref production` | Same. | Production DB advances from previous prod hash to H_prod. Marker = H_prod. | `production = H_prod` (no-op, already there) + refreshed snapshot. |

**Result.** Explicit `--advance-ref staging` records the deployment in the `staging` ref. No implicit dev-state assumptions (the `db` ref is untouched). The CI pipeline's intent is encoded in the flags.

## Scenario F — `ref set` on a non-graph-node hash (rejected)

A user tries to set a ref to a hash that isn't yet in the migration graph.

| Step | Action | Result |
|---|---|---|
| 1 | `prisma-next ref set production sha256:H_made_up` | **Refused.** H_made_up isn't a graph node. |

Diagnostic body (slice-time wording):

```
PN-MIG-2xxx: Cannot set ref `production` — hash is not in the migration graph.

  Hash: sha256:H_made_up

This hash does not appear as the `from` or `to` of any on-disk migration bundle,
and it is not the `null` empty-graph sentinel.

If the hash is the result of a `migration plan` that you haven't committed yet,
add the migration bundle first; the hash becomes a graph node automatically.

If you intended to set the ref to an existing graph node, list available nodes:
  prisma-next migration list --hashes
```

**Result.** Universal invariant enforced consistently: any time *any* command resolves to a hash that isn't a graph node, the command refuses (with a context-appropriate diagnostic).

## What's *not* covered

These scenarios cover the in-scope flows. Out of scope for this project:

- Multi-target migration packages (the `db` ref is app-space-only for this scope; per-space dev-state refs deferred).
- Recovery from already-broken legacy state (committed bad bundles from pre-fix `migration plan` invocations) — open question in [`design-notes.md`](./design-notes.md#open-questions--accepted-trade-offs).
- Squash / baseline interactions (separate subsystem; this design intentionally doesn't touch the squash-first advisor path).
