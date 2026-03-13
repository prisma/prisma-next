# Summary

Revamp on-disk migration path resolution so revisiting a prior contract hash is treated as a valid graph shape and can collapse to a no-op when start and target are equal. Drop `parentMigrationId` in favor of deterministic shortest-path selection over the contract-hash graph. Add filesystem-backed refs (`migrations/refs.json`) so teams can track environment positions (for example, `staging`, `production`) without requiring a live database marker read for every workflow.

# Description

The current on-disk migration model (ADR 169) introduced `parentMigrationId` to avoid ambiguity when contract hashes are revisited (for example, `C1 -> C2 -> C1`). This makes collaboration and graph interpretation safe, but it also forces migration ordering semantics to depend on an edge-to-edge chain rather than on contract state transitions.

This project removes `parentMigrationId` and implements a model where:

- contract hashes are the sole source of truth for structural state,
- pathfinding chooses a deterministic shortest path from current state to target state,
- all structural paths between the same two contract hashes are treated as semantically equivalent,
- returning to the same contract hash (`start == target`) is explicitly a no-op,
- and divergent branches (multiple developers planning from the same base) are a hard error requiring explicit resolution (rebase).

It also introduces filesystem refs to represent "where an environment is at" in local and CI workflows (for example, `staging`, `production`), enabling environment-aware migration operations without coupling to one global pointer.

**Scope boundary:** This project covers structural migrations only. Data migrations, invariant-aware routing, and postcondition-driven verification are documented as future exploration in `data-migrations.md` and `data-migrations-solutions.md` and are explicitly out of scope for this phase.

**Migration identity consequence:** The current `computeMigrationId` implementation includes `parentMigrationId` in the hash (it is part of `strippedMeta`). Removing `parentMigrationId` from the manifest will change the `migrationId` of every existing migration. Since there are no external users yet, this is acceptable — but the attestation module (`attestation.ts`) must be updated to reflect the new manifest shape.

## Key assumptions and design constraints

**Structural equivalence holds; semantic equivalence does not (yet).** Two paths between the same contract hashes produce the same end-state schema — the contract hash determines the target schema, regardless of path. But different paths may have different operational characteristics (data loss profiles, lock durations, intermediate states) and, once data migrations exist, different paths will produce different *data* states. A path that backfills a column is not interchangeable with one that doesn't, even if both arrive at the same contract hash.

This is a known limitation, not an oversight. The v1 pathfinder is designed with an explicit policy stage (candidate generation → policy-based selection) so that future phases can introduce invariant-aware path selection without rewriting the pathfinding core. In v1, the policy stage applies structural-only selection (shortest path with deterministic tie-break). In a future phase, it can filter or rank candidates based on required data invariants (see `data-migrations.md` and `data-migrations-solutions.md` for exploration).

**Refs are declarative targets:** A ref says "I want this environment to be at contract hash H." Refs are not mutated by migration commands — they are set by the developer or CI to declare intent, and consumed as read-only inputs by `migration apply` and `migration status`. The database marker and ledger remain the record of what actually happened. If the DB marker is already ahead of or inconsistent with the ref target, that is a standard marker-mismatch error (same as any other case where the database has drifted relative to expectations). In a future phase, refs may also declare required data invariants alongside the target hash (see `data-migrations.md` §5), but for v1 they carry only a contract hash.

**`contract.json` is only used for planning; migration edges are self-contained.** The repo contains a single `contract.json` reflecting the current schema state. This file is used in exactly two places: (1) `migration plan` reads it to diff against the previous contract and generate operations, and (2) `migration apply` without `--ref` reads its `storageHash` to determine the default target. All other operations — applying via refs, status checks, pathfinding — work entirely from the migration graph on disk.

Each migration edge directory embeds the full contract IR in `migration.json` as `fromContract` and `toContract` (per ADR 169). This makes edges self-contained: the contract state at any hash in the graph can be recovered by reading the relevant migration directory, without needing a separate contract file per environment or per ref.

This has concrete implications for multi-environment and branching workflows:

- **Multi-environment:** Staging may be at `C3` while production is at `C1`. The repo's `contract.json` reflects `C3` (the latest schema). `migration apply --ref production` targets `C1` and applies edges using their embedded operations — it never reads `contract.json`. The contract content at `C1` is preserved in the migration edge that produced it.
- **Branching:** If Alice commits edge `C1 -> C2` and Bob commits edge `C1 -> C3`, both edges embed their respective `toContract`. After merge, `contract.json` reflects whichever branch won the merge, but the other branch's contract state is preserved in its migration directory and remains routable via refs.
- **Planning constraint:** `migration plan` always diffs the *current* `contract.json` against the previous state. You cannot plan a new migration from an arbitrary historical contract hash without first checking out or emitting that contract. This is the normal git workflow — planning happens on a branch where `contract.json` reflects the desired base state.

# Requirements

## Functional Requirements

### FR-1: Shortest-path migration selection

The migration engine computes a deterministic shortest path (minimal hop count) from a start contract hash to a target contract hash using on-disk edges.

- If multiple shortest paths exist, tie-breaking is deterministic using the sort key tuple from ADR 039: label priority, `createdAt` ascending, `to` lexicographic, `edgeId` lexicographic.
- Pathfinding must terminate for cyclic graphs and never loop indefinitely.
- The pathfinder produces a path-decision object containing: policy ID, selected path, alternative count, and tie-break/rejection reasons. This internal structure supports future extension to invariant-aware routing without changing the user-facing API.

### FR-2: Explicit no-op semantics for same-state transitions

When start hash equals target hash, planning and apply flows return an explicit no-op result.

- No migrations are executed.
- Output explains why execution was skipped.
- Status surfaces that the environment is already at target.

No-op is defined in terms of structural contract state (contract hash equality). Data-level equivalence is out of scope for this phase.

### FR-3: Cycle-tolerant graph model without parent pointers

The system accepts migration graphs that revisit prior contract hashes (for example, rollback-like paths) without requiring parent-edge disambiguation.

- `parentMigrationId` is removed from the migration model. Ordering is determined entirely by graph topology (contract-hash nodes and edges).
- Cycles are allowed as graph structure but must not break deterministic path resolution.
- Edges with `from == to` remain invalid migration edges.

### FR-4: Branch detection and divergence resolution

When the graph contains divergent branches (multiple outgoing edges from a node leading to distinct, unapplied leaf nodes reachable from the current marker), the system treats this as a hard error.

- **Branch definition:** From the current marker hash, the set of reachable leaf nodes (nodes with no further outgoing edges on any unapplied path) contains more than one node, and no explicit target has been specified.
- **Divergence is a hard error** with actionable diagnostics: the error identifies the divergent branches, the common ancestor, and the leaf nodes.
- **Remediation:** The recommended resolution is rebase — replanning one branch's changes on top of the other's target. For example, if Alice committed `C1->C2` and Bob committed `C1->C3`, Bob replans his changes from `C2` to produce `C2->C3'`, then deletes or archives `C1->C3`.
- **Historical forks are inert:** Edges that were already applied (their `from` hash is behind the current marker) do not trigger divergence errors. Only unapplied forward paths from the current position matter.
- A `migration rebase` command is future scope. For v1, rebase is manual: delete the stale edge, replan from the new base.

Note on collaboration workflows: divergence typically surfaces when work from different branches is merged. Within a single branch, the developer has a linear history. Refs (FR-5) allow different environments to target different contract hashes, so `staging` advancing to `C2` while `production` stays at `C1` is not divergence — it is expected.

### FR-5: Filesystem refs for environment positions

Refs map a logical environment name to a contract hash, stored in `migrations/refs.json`.

- Format: `{ "head": "<hash>", "staging": "<hash>", "production": "<hash>" }`
- Ref names are bare keys (no `ref:` prefix). Names must pass strict validation: alphanumeric, hyphens, forward slashes (no `.` or `..` segments).
- The file is version-controlled alongside migration artifacts.
- Ref reads are a JSON parse. Ref writes are atomic (write-tmp + rename).

### FR-6: Ref-aware migration commands

Migration commands support selecting a target via refs.

- `migration status` can report state relative to a ref (e.g., "staging is 2 edges behind its ref target").
- `migration apply` can use a ref as the desired target hash.
- Refs are not mutated by migration commands. Refs are updated by the developer (or CI) to declare intent; migration commands consume them as read-only inputs.
- CLI diagnostics clearly show source of truth used (DB marker, explicit hash, ref).

### FR-7: Machine-readable outputs

`--json` outputs for migration commands include enough metadata for agents and CI to reason about:

- chosen path as `pathDecision.selectedPath` (each entry: `dirName`, `migrationId`, `from`, `to`),
- path-decision metadata (policy ID, alternative count, tie-break reasons),
- no-op reason when applicable,
- ref reads/writes,
- and divergence/branch diagnostics when errors occur.

## Non-Functional Requirements

- **Determinism:** Same migration files + same start/target inputs always produce the same selected path. Guaranteed by the deterministic tie-break sort key.
- **Performance:** Path selection completes in linear graph time (`O(V+E)`). With squash-first hygiene (ADR 102), practical graph sizes are in the dozens of active edges, making this trivial.
- **Reliability:** Ref writes are atomic (write-tmp + rename); interrupted writes do not produce partial/corrupt ref state. Migration apply continues to use transactional per-edge execution so the database is never left in a partially-migrated state.
- **DX:** Diagnostics use stable error categories/codes and include clear remediation guidance.
- **Auditability:** Path choice and ref mutations are visible in logs and JSON output.

## Non-goals

- Building a visual migration graph UI.
- Weighted path optimization beyond shortest-hop semantics (e.g., least-risk, data-migration-aware).
- Replacing database marker verification as an execution safety control.
- Automatic conflict auto-merge for divergent migration histories (manual rebase for v1).
- Redesigning migration operation vocabulary (`ops.json`) in this project.
- Data migrations, invariant-aware routing, or postcondition-driven verification (see `data-migrations.md` for future exploration).
- Backward compatibility with `parentMigrationId`-based migration directories (no external users exist yet).

# Scenarios

These scenarios document expected behavior under the decisions made in this spec. Scenarios that expose limitations of the structural-only model are included deliberately — they motivate the invariant-aware routing design in future phases.

## S-1: Linear happy path

Graph: `C1 -> C2 -> C3`. Production ref targets `C3`. DB marker at `C1`.

**Behavior:** Pathfinder selects `C1 -> C2 -> C3` (only path). Apply executes both edges in order. No ambiguity.

## S-2: Staging rollback cycle, then different changes to production

Timeline:
1. Start at `C1`. Deploy to staging: `C1 -> C2`. Staging marker at `C2`.
2. Realize `C2` is wrong. Roll back staging: `C2 -> C1`. Staging marker back at `C1`.
3. Make different changes: `C1 -> C3`. Deploy to staging and then production.

Graph: `C1 -> C2`, `C2 -> C1`, `C1 -> C3`.

**Behavior (structural):** Production at `C1` targeting `C3`. Pathfinder sees two paths:
- `C1 -> C3` (1 hop)
- `C1 -> C2 -> C1 -> C3` (3 hops)

Shortest path selects `C1 -> C3`. The staging detour is never traversed by production. Correct for structural state.

**Limitation (data):** If `C1 -> C2` included a data backfill and `C2 -> C1` included a data revert, production never runs either. If `C3` assumes some data state established by the backfill, production is structurally correct but data-incorrect. This is exactly the case where invariant-aware routing would select the path that satisfies the required data invariants — and the reason the pathfinder has a policy stage that can be extended to handle this in a future phase.

## S-3: Converging paths with different data consequences

Graph: `C1 -> C2 -> C3` and `C1 -> C3`.
- `C1 -> C2` adds column `phone` (nullable).
- `C2 -> C3` adds column `email` (nullable) and backfills `phone` from an external source.
- `C1 -> C3` adds both columns in one step (no backfill).

**Behavior (structural):** Production at `C1` targeting `C3`. Shortest path selects `C1 -> C3` (1 hop), skipping the backfill. Structurally equivalent — both paths arrive at a schema with `phone` and `email` columns.

**Limitation (data):** The `phone` column is empty via the short path. If a data invariant requires "all phone numbers populated," the short path violates it. In a future phase, the policy stage would reject `C1 -> C3` and select `C1 -> C2 -> C3` because only that path provides an invariant-satisfying data migration.

## S-4: Same-base divergence (two developers)

Alice commits `C1 -> C2`. Bob commits `C1 -> C3`. Both merged to main.

Graph: `C1 -> C2`, `C1 -> C3`.

**Behavior:** DB marker at `C1`, no explicit target specified. Pathfinder detects two unapplied paths to distinct leaves (`C2` and `C3`). This is a hard error with actionable diagnostics: the error identifies `C1` as the divergence point, lists each branch with its leaf hash (`C2`, `C3`), and suggests resolution via `migration ref set` or `--from` to specify the intended target explicitly.

If an explicit target is specified (e.g., `--ref production` pointing to `C3`), the pathfinder selects `C1 -> C3`. The `C1 -> C2` edge is not on any path to `C3` and is inert.

## S-5: Staging ahead of production (normal environment lag)

Staging ref targets `C3`. Production ref targets `C2`. Graph: `C1 -> C2 -> C3`.

**Behavior:** This is not divergence — it is expected environment lag. `migration apply --ref production` targets `C2`. `migration apply --ref staging` targets `C3`. Each environment routes independently from its DB marker to its ref target. No conflict.

## S-6: DB marker ahead of ref target

Production ref targets `C2`. DB marker is at `C3` (someone applied `C2 -> C3` out of band or the ref wasn't updated).

**Behavior:** Standard marker-mismatch error. The system cannot route from `C3` to `C2` unless a `C3 -> C2` edge exists. If it does, it would be applied (it's a valid edge). If it doesn't, the error tells the user the DB is ahead of the ref and the ref should be updated.

## S-7: Transitioning from `db update` to migrations (baseline)

A developer has been iterating on their schema using `db update`, which pushes schema changes directly to the database without creating migration edges. The database is now at contract hash `C1`. The developer wants to switch to migrations for deployment safety.

**Workflow:**
1. Database is at `C1` (applied via `db update`). No migration history exists on disk.
2. Developer creates a baseline migration: `kind: 'baseline'`, `from: EMPTY`, `to: C1`. This edge carries no operations — it declares "the database is already at `C1`."
3. Developer makes schema changes, emits `C2`, and runs `migration plan` to create edge `C1 -> C2`.
4. In CI/production, `migration apply` sees the baseline edge and the incremental edge. The baseline is a no-op (the DB is already at `C1`), and the incremental edge `C1 -> C2` applies normally.

**Behavior:** The baseline migration bridges the gap between an existing database state (managed by `db update`) and the migration graph. The pathfinder treats the baseline like any other edge — it contributes a node (`C1`) to the graph. From that point forward, the developer uses `migration plan` and `migration apply` exclusively.

**Key constraint:** The baseline must accurately reflect the current database state. If the database is actually at a schema that doesn't match `C1`, the incremental migration `C1 -> C2` will produce incorrect or failing operations. There is no automatic verification that the baseline matches reality — this is the developer's responsibility.

## S-8: Mixed `db update` and migrations during development

A developer uses `db update` for rapid local iteration but migrations for staging and production.

**Workflow:**
1. Local dev database is managed with `db update` — schema changes are applied immediately, no migration edges created.
2. When ready to deploy, the developer runs `migration plan` to create an edge from the last known migration state to the current contract.
3. Staging and production use `migration apply` to apply the planned edge.

**Behavior:** This is the expected development workflow. `db update` and migrations operate on the same contract hash space — `db update` writes the contract hash to the marker table, and `migration apply` reads the marker to determine the starting point. The two mechanisms are interoperable as long as the developer plans migrations before deploying.

**Ledger gap on the dev database:** On the developer's local database, `migration apply` sees that the marker is already at C2 (advanced by `db update`) and reports "Already up to date" — no DDL runs and no ledger entry is written. The `add-phone` migration appears as "applied" in `migration status` (the marker is at its `to` hash), but the ledger has no record of it because it was never executed against this database. On fresh databases (staging, production, teammate machines), `migration apply` executes the migration normally and the ledger is complete. This gap is only on databases where `db update` was used as a shortcut, and only visible in the raw ledger table — no CLI command surfaces the discrepancy. It would matter if a future feature relies on the ledger as a complete audit trail; today the marker is the sole source of truth for pathfinding and status.

**Limitation:** If the developer runs `db update` on a shared database (e.g., a shared staging instance) and also applies migrations to it, the marker may advance past the migration graph's expectation. This produces a standard marker-mismatch error and requires the developer to plan a migration that accounts for the current state.

## S-9: Adopting migrations on an existing production database

A production database has been running with `db update` for months. The team decides to adopt migrations.

**Workflow:**
1. Current production schema corresponds to contract hash `C5`.
2. Developer creates a baseline migration: `from: EMPTY`, `to: C5`, `kind: 'baseline'`. This records "production is at `C5`" without replaying the schema history.
3. All subsequent changes go through `migration plan` → `migration apply`.
4. On production, `migration apply` sees the baseline. The marker is already at `C5` (from prior `db update` usage), so the baseline is a no-op. Future edges apply normally.

**Behavior:** The baseline does not need to contain the full DDL history — it only establishes a starting node in the migration graph. The production marker (written by prior `db update` runs) already reflects `C5`, so the pathfinder routes from `C5` to whatever the target is.

**Prerequisite:** The production marker must match the baseline's `to` hash. If the marker was not set (e.g., the database was managed outside of Prisma Next entirely), the team must first run `db update` or manually set the marker to establish the starting point.

## Scenario Playbook (prisma-next-demo)

All scenarios run against the `examples/prisma-next-demo` package with a local Postgres database. `reset-db.sh --full` resets DB state (tables, types, extensions, marker schema) and on-disk artifacts (migrations directory, emitted contract, refs.json). All commands run from the `examples/prisma-next-demo` directory.

### P-1: Linear happy path (S-1)

Demonstrates the basic workflow: emit → plan → apply → edit → emit → plan → apply → status.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit contract C1
pnpm prisma-next contract emit

# 3. Plan migration EMPTY -> C1
pnpm prisma-next migration plan --name init

# 4. Apply migration — DB moves to C1
pnpm prisma-next migration apply

# 5. Edit contract: add a `name` column to `user` table in prisma/contract.ts
# (manual edit — add .column('name', { type: textColumn, nullable: true }))

# 6. Re-emit contract C2
pnpm prisma-next contract emit

# 7. Plan migration C1 -> C2
pnpm prisma-next migration plan --name add-user-name

# 8. Apply migration — DB moves to C2
pnpm prisma-next migration apply

# 9. Verify status shows everything applied
pnpm prisma-next migration status
```

**Expected:** All commands succeed. Two migration edge directories on disk (`init`, `add-user-name`). Status shows both applied and DB at C2.

### P-2: Staging rollback cycle (S-2)

Demonstrates rollback: staging advances then rolls back, production takes the direct route.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit contract C1 and plan+apply EMPTY -> C1
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name init
pnpm prisma-next migration apply

# 3. Edit contract: add `phone` column to `user` → C2
# (manual edit)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-phone
pnpm prisma-next migration apply
# DB now at C2

# 4. Rollback: revert contract to remove `phone` column → C1 again
# (manual edit — remove `phone` column)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name rollback-phone
pnpm prisma-next migration apply
# DB now at C1

# 5. Different change: add `bio` column instead → C3
# (manual edit — add `bio` column)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-bio
pnpm prisma-next migration apply

# 6. Verify status
pnpm prisma-next migration status
```

**Expected:** Four edges on disk. Graph: `EMPTY->C1`, `C1->C2`, `C2->C1`, `C1->C3`. Status shows all applied and DB at C3. The rollback cycle (C1→C2→C1→C3) is valid because pathfinding tolerates cycles.

**Result (post-fix):** PASS. After the rollback (C2→C1), `migration plan` without `--from` now produces a clear `MIGRATION.NO_RESOLVABLE_LEAF` error: "The migration graph contains cycles and no node has zero outgoing edges. Use `--from <hash>` to specify the planning origin explicitly." Using `--from <C1_HASH>`, the planner correctly produces the incremental 1-op plan (add column bio). Apply succeeds, and status shows the graph routed via shortest path `EMPTY→C1→C3` with 2 migrations applied. The add-phone and rollback-phone edges exist on disk but are not on the selected path.

**Previous result (GAP, now fixed):** `findLeaf` returned `EMPTY_CONTRACT_HASH` for cycle-without-exit graphs, causing `migration plan` to silently produce a full greenfield migration. Fixed by throwing `MIGRATION.NO_RESOLVABLE_LEAF` and by skipping `findLatestMigration` when `--from` is provided.

### P-3: Converging paths (S-3)

Demonstrates shortest-path selection when multiple paths exist to the same target.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit C1, plan+apply EMPTY -> C1
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name init
pnpm prisma-next migration apply
# DB at C1

# 3. Add `phone` column → C2
# (manual edit)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-phone
# Do NOT apply yet

# 4. Also add `email_verified` column → C3 from C2
# (manual edit — add email_verified on top of phone)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-email-verified
# Now have C1->C2->C3

# 5. Create a direct edge C1->C3 by planning from C1 with --from
pnpm prisma-next migration plan --name direct-to-c3 --from <C1_HASH>
# Now have both C1->C2->C3 and C1->C3

# 6. Apply — should pick C1->C3 (shortest, 1 hop vs 2 hops)
pnpm prisma-next migration apply

# 7. Verify status
pnpm prisma-next migration status
```

**Expected:** Pathfinder selects the 1-hop `C1->C3` edge. Status shows that edge applied. The 2-hop path exists but is not used.

**Result:** PASS. Apply selected `direct-to-c3` (1 hop, 2 ops) over the 2-hop path `add-phone` + `add-email-verified`. Status shows `init` and `direct-to-c3` as the applied path.

### P-4: Same-base divergence (S-4)

Demonstrates the hard error when two migrations fork from the same base with no explicit target.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit C1, plan+apply EMPTY -> C1
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name init
pnpm prisma-next migration apply
# DB at C1

# 3. Add `phone` column → C2
# (manual edit)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-phone
# Do NOT apply — edge C1->C2 on disk

# 4. Revert contract back to C1 state, then add `bio` instead → C3
# (manual edit — remove phone, add bio)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-bio --from <C1_HASH>
# Now have C1->C2 and C1->C3 — divergent

# 5. Attempt apply without specifying target — should error
pnpm prisma-next migration apply
# EXPECTED: hard error — divergent branches from C1

# 6. Apply with explicit target (use contract hash or ref)
pnpm prisma-next migration ref set production <C3_HASH>
pnpm prisma-next migration apply --ref production
# EXPECTED: succeeds, applies C1->C3

# 7. Verify status
pnpm prisma-next migration status
```

**Expected:** Step 5 applies C1→C3 via contract.json's implicit target (contract.json hash = C3). `migration status` without `--ref` errors with `AMBIGUOUS_LEAF` on the divergent graph. `migration status --ref production` succeeds, showing the correct chain EMPTY→C1→C3.

**Result (post-fix):** PASS. Step 5 correctly applies C1→C3 — `migration apply` uses contract.json's storageHash (C3) as the implicit target, which is by design (the contract.json hash acts as "I want this state"). `migration status` without `--ref` correctly errors with `AMBIGUOUS_LEAF`, identifying C1 as the divergence point and listing both branches with their leaf hashes (C2 and C3). After setting `production` ref to C3, `migration status --ref production` works on the divergent graph without error, showing EMPTY→C1→C3 with both migrations applied.

**Design note:** `migration apply` always resolves its target from `contract.json` (or `--ref`), so divergence detection via `AMBIGUOUS_LEAF` is surfaced through `migration status` (without `--ref`) and `migration plan` (without `--from`), not through `migration apply`. This is intentional — the contract.json hash is the user's declaration of the desired state.

**Previous result (GAP, now fixed):** `migration status --ref` on a divergent graph threw `AMBIGUOUS_LEAF` because `findLeaf` was called unconditionally before ref-based routing. Fixed by skipping `findLeaf` when `--ref` provides an explicit target.

### P-5: Staging ahead of production via refs (S-5)

Demonstrates independent environment routing using refs.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit C1, plan+apply EMPTY -> C1
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name init
pnpm prisma-next migration apply
# DB at C1

# 3. Add `phone` column → C2, plan
# (manual edit)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-phone

# 4. Set refs: production=C1, staging=C2
pnpm prisma-next migration ref set production <C1_HASH>
pnpm prisma-next migration ref set staging <C2_HASH>

# 5. Status for each ref
pnpm prisma-next migration status --ref production
# EXPECTED: shows DB at C1, target C1, no-op — already at target
pnpm prisma-next migration status --ref staging
# EXPECTED: shows DB at C1, target C2, 1 pending edge

# 6. Apply for staging
pnpm prisma-next migration apply --ref staging
# EXPECTED: applies C1->C2

# 7. Status again
pnpm prisma-next migration status --ref production
pnpm prisma-next migration status --ref staging
```

**Expected:** Production reports no-op (already at C1). Staging applies the pending edge. After apply, staging status shows fully applied.

**Result:** PASS. Status for production showed "At ref production target" (DB=C1, ref=C1). Status for staging showed "1 edge(s) behind ref staging" (DB=C1, ref=C2). After `migration apply --ref staging`, staging status showed "At ref staging target" and production showed "1 edge(s) ahead of ref production" (DB now at C2 from staging apply, ref still at C1). Ref routing works correctly — environments route independently.

### P-6: DB marker ahead of ref target (S-6)

Demonstrates the error when the database has advanced past the ref target.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit C1, plan+apply EMPTY -> C1
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name init
pnpm prisma-next migration apply

# 3. Add column → C2, plan+apply
# (manual edit)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-phone
pnpm prisma-next migration apply
# DB at C2

# 4. Set ref to C1 (behind DB)
pnpm prisma-next migration ref set production <C1_HASH>

# 5. Attempt apply with --ref production
pnpm prisma-next migration apply --ref production
# EXPECTED: error — DB at C2, ref targets C1, no C2->C1 edge exists

# 6. Status with --ref production
pnpm prisma-next migration status --ref production
```

**Expected:** Apply fails because no backward edge exists. Status should report the mismatch clearly.

**Result:** PASS. `migration apply --ref production` failed with `PN-RTM-3000: No migration path from current state to target` (DB at C2, ref at C1, no C2→C1 edge). `migration status --ref production` reported "1 edge(s) ahead of ref production".

### P-7: Transition from `db update` to migrations (S-7)

Demonstrates bridging from `db update` to the migration workflow.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit contract and use db update to push schema (no migrations)
pnpm prisma-next contract emit
pnpm prisma-next db update
# DB at C1, no migration edges on disk

# 3. Plan first migration from EMPTY -> C1
# This creates a baseline-like edge that represents the current state
pnpm prisma-next migration plan --name init

# 4. Edit contract (add column) → C2, emit
# (manual edit)
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name add-phone

# 5. Apply migrations — init edge should be no-op (DB already at C1), add-phone applies
pnpm prisma-next migration apply

# 6. Verify
pnpm prisma-next migration status
```

**Expected:** `migration apply` sees the DB marker is already at C1, so the init edge is skipped. The add-phone edge applies normally. Status shows everything up to date.

**Result:** PASS. `db update` wrote the marker at C1. `migration apply` found path C1→C2 (skipping the EMPTY→C1 init edge since the DB was already at C1). Only `add-phone` (1 op) was applied. Status confirmed both migrations applied and DB up to date.

### P-8: Mixed `db update` and migrations (S-8)

Demonstrates using `db update` for local iteration and migrations for deployment.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Emit C1, plan+apply EMPTY -> C1 via migrations
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name init
pnpm prisma-next migration apply
# DB at C1 via migrations

# 3. Use db update to iterate locally: add `phone` column → C2
# (manual edit)
pnpm prisma-next contract emit
pnpm prisma-next db update
# DB at C2 via db update — marker updated

# 4. Plan migration C1 -> C2 for deployment
pnpm prisma-next migration plan --name add-phone

# 5. Apply — DB already at C2 so this edge is a no-op
pnpm prisma-next migration apply

# 6. Verify
pnpm prisma-next migration status
```

**Expected:** After `db update`, the DB marker is at C2. `migration plan` creates the C1->C2 edge for deployment purposes. `migration apply` sees the DB is already at C2 and reports a no-op. This validates the interoperability between `db update` and migrations.

**Result:** PASS. `db update` advanced the marker to C2. `migration plan` produced the C1→C2 edge (1 op: add column phone). `migration apply` reported "Already up to date" since the DB marker already matched the target. Status showed both migrations applied.

### P-9: Adopting migrations on existing production database (S-9)

Same as P-7 but emphasizes the "existing production" framing. Uses `db update` to simulate a database that was managed without migrations.

```bash
# 1. Full reset
../../reset-db.sh --full

# 2. Simulate production DB managed via db update for a while
pnpm prisma-next contract emit   # C1
pnpm prisma-next db update       # DB at C1

# 3. Add column, emit, db update again — simulates history
# (manual edit)
pnpm prisma-next contract emit   # C2
pnpm prisma-next db update       # DB at C2

# 4. Decision: adopt migrations. Plan from EMPTY -> C2 (current contract)
pnpm prisma-next migration plan --name baseline

# 5. Apply — DB already at C2, so baseline is no-op
pnpm prisma-next migration apply

# 6. Going forward: add another column → C3, plan+apply via migrations
# (manual edit)
pnpm prisma-next contract emit   # C3
pnpm prisma-next migration plan --name add-bio
pnpm prisma-next migration apply

# 7. Verify
pnpm prisma-next migration status
```

**Expected:** The baseline edge EMPTY->C2 is a no-op since the DB is already at C2. The subsequent migration C2->C3 applies normally. This proves you can adopt migrations at any point in a database's lifetime.

**Result:** PASS. Simulated months of `db update` usage (C1 then C2). Created baseline EMPTY→C2 — `migration apply` reported "Already up to date" (DB marker matched C2). Planned and applied incremental C2→C3 (1 op: add column bio). Status confirmed both migrations applied and DB up to date.

# Acceptance Criteria

- [ ] AC-1: For graphs with cycles, path resolution returns a deterministic shortest path and never loops.
- [ ] AC-2: For `start == target`, `migration plan` and `migration apply` both return explicit no-op results with clear messaging and JSON flags.
- [ ] AC-3: Revisited-hash scenarios (for example, `C1 -> C2 -> C1 -> C3`) execute correctly using graph topology alone, without `parentMigrationId`.
- [ ] AC-4: Divergent branches from the current marker (multiple unapplied paths to distinct leaves) produce a hard error with diagnostics identifying the branches, common ancestor, and remediation steps.
- [ ] AC-5: `migrations/refs.json` supports create, read, update, and delete of named refs pointing to contract hashes, with input validation and atomic writes.
- [ ] AC-6: `migration status` and `migration apply` can consume refs and produce consistent human/JSON output including ref provenance.
- [ ] AC-7: Deterministic tie-break strategy (label priority → `createdAt` → `to` → `edgeId`) is documented and covered by tests.
- [ ] AC-8: CI-oriented JSON output includes path-decision metadata (selected path, alternative count, tie-break reasons), no-op/skipped details, and ref read/write events.

# Other Considerations

## Security

Refs are local filesystem state and must be treated as untrusted input when read. Ref names require strict validation (path traversal prevention, reserved-name handling), and ref values must be valid contract hashes. `refs.json` stores only non-secret identifiers (hashes), not credentials.

## Cost

Operating cost impact is low. Main cost is engineering time for model transition and test fixtures for collaboration/cycle scenarios.

## Observability

Emit structured events for:

- path computation inputs and chosen path,
- tie-break decisions (including alternative count),
- no-op outcomes,
- ref read/write operations,
- and divergence/branch error details.

## Data Protection

No direct personal-data model change is expected. Ensure logs/events do not capture sensitive connection strings when ref-aware commands include DB context.

## Analytics

Track adoption and friction:

- count of no-op applies,
- count of multi-path tie-breaks,
- count of divergence/branch errors,
- and ref usage by command (status/plan/apply).

# Offline planning: contractToSchemaIR and declarative dependencies

During implementation, incremental migrations were incorrectly re-emitting operations for database extensions (`CREATE EXTENSION vector`), storage types (`CREATE TYPE user_type`), and FK-backing indexes that already existed in the previous contract. The planner itself was correct — it faithfully diffed the "from" and "to" states it was given. The bug was in `contractToSchemaIR`: it only received `SqlStorage` (tables), not the full contract, so the "from" schema IR it produced was incomplete — missing extensions, types, and FK-backed indexes. The planner correctly concluded these were new additions because they were absent from the "from" state.

## Design decision

`contractToSchemaIR` now accepts the full `SqlContract` (not just `SqlStorage`) and an options object:

```typescript
contractToSchemaIR(
  contract: SqlContract<SqlStorage> | null,
  options?: { expandNativeType?: NativeTypeExpander; frameworkComponents?: readonly unknown[] }
): SqlSchemaIR
```

The function derives schema IR fields from three sources:

1. **Tables** — from `contract.storage.tables`, same as before. Codec metadata (`codecId`, `typeRef`) is dropped; the planner only needs structural information. FK-backing indexes (from `foreignKeys` with `index: true`) are now derived into `SqlSchemaIR.indexes`.
2. **Dependencies** — from `frameworkComponents`. Each component that declares `databaseDependencies.init[]` contributes its dependency ID (e.g., `'postgres.extension.vector'`) to `SqlSchemaIR.dependencies`. This follows ADR 154: dependencies are component-owned declarations, not inferred from `contract.extensionPacks`.
3. **Type annotations** — from `contract.storage.types`. Storage types (e.g., enums) are placed into `SqlSchemaIR.annotations.pg.storageTypes` so the planner can diff them against the "to" contract and skip operations for types that already exist.

## Generic DependencyIR model

`SqlSchemaIR` uses a target-agnostic `dependencies: readonly DependencyIR[]` field instead of the earlier Postgres-specific `extensions: readonly string[]`. Each `DependencyIR` carries only an `id: string` — the same ID declared on `ComponentDatabaseDependency`:

```typescript
interface ComponentDatabaseDependency<TTargetDetails> {
  readonly id: string;
  readonly label: string;
  readonly install: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}
```

The planner checks `schemaIR.dependencies` for each component dependency's `id` — if present, the dependency is already installed and install ops are skipped. Verification uses the same structural ID check, replacing the earlier per-component `verifyDatabaseDependencyInstalled` callback.

Introspection maps database objects to dependency IDs. For Postgres, `pg_extension` rows use the convention `postgres.extension.<extname>` (e.g., `{ id: 'postgres.extension.vector' }`). The adapter owns this convention; extension components must follow it.

See `projects/on-disk-migrations-v2/specs/declarative-database-dependencies.spec.md` for the full design rationale and solutions considered.

## Typing at the interface boundary

`TargetMigrationsCapability.contractToSchema` accepts `ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>`, not `readonly unknown[]`. This type is already available in the core control-plane layer and is the same type the planner and runner use. The inner `ContractToSchemaIROptions.frameworkComponents` in the family layer uses `readonly unknown[]` and narrows structurally via `DatabaseDependencyProvider` — this is an implementation detail behind the typed public interface.

## References

- ADR 154 — Component-owned database dependencies
- ADR 005 — Thin Core, Fat Targets
- Migration System subsystem doc (§ Offline planning via contract-to-schemaIR)

# References

- `projects/on-disk-migrations-v2/discussion-synthesis.md`
- `projects/on-disk-migrations-v2/data-migrations.md` (future exploration, not v1 scope)
- `projects/on-disk-migrations-v2/data-migrations-solutions.md` (future exploration, not v1 scope)
- `docs/architecture docs/subsystems/7. Migration System.md`
- `docs/architecture docs/adrs/ADR 001 - Migrations as Edges.md`
- `docs/architecture docs/adrs/ADR 039 - DAG path resolution & integrity.md`
- `docs/architecture docs/adrs/ADR 169 - On-disk migration persistence.md`

# Open Questions

No blocking open questions remain. The following are deferred to future scope:

- **Rebase tooling:** Manual rebase (delete stale edge, replan from new base) is sufficient for v1. A `migration rebase` command may be added in a future project.
- **Graph traversal primitives:** The DAG module (`migration-tools/dag.ts`) has ~8 exported functions that each implement their own traversal from scratch (BFS for path finding, DFS for cycle detection, ad-hoc ancestor walks for divergence analysis). These should be refactored into two generic fold primitives — `foldBfs` and `foldDfs` — with the domain logic expressed as step/accumulator functions. `foldBfs` handles shortest path, reachability, and leaf detection. `foldDfs` with enter/leave callbacks handles cycle detection, divergence point computation, and topological ordering. Current functions become thin wrappers. This would make adding new graph queries cheaper and eliminate the ad-hoc traversal implementations (e.g., `findDivergencePoint`).
