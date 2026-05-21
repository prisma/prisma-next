# Manual QA — `migration plan` ref-aware resolution + auto-baseline emission

**Slice spec:** [`./spec.md`](./spec.md)
**Slice plan:** [`./plan.md`](./plan.md)
**Parent project:** [`../../`](../../)

## Purpose

This slice closes the **TML-2629 dev → ship transition trap** at the planner layer. The e2e suite at `test/integration/test/cli.migration-plan-ref-aware.e2e.test.ts` covers 10 scenarios programmatically; this script's value-add is exercising the J4 reproduction the way a real developer would experience it — including the moment of relief when `migrate` actually applies the auto-baseline pair successfully.

Run this script when:
- The slice's user-facing behavior changes (resolver, refuse paths, output format).
- The project ships and you want a final end-to-end smoke check before announcing closure.
- A user surfaces a bug shaped like J4 and you want to reproduce.

Time budget: ~20 min.

## Setup

```bash
cd $(mktemp -d) && pnpm dlx prisma-next init --skip-skill-install
pnpm install
# Edit prisma-next.config.ts to point db.connection at a throwaway PGlite or local Postgres URL.
git init && git add -A && git commit -m "initial"
```

You'll use `git status` and `git diff` throughout to observe what `migration plan` puts on disk.

---

## Scenario 1 — The TML-2629 J4 trap, closed

The defining workflow this project was built to make work.

```bash
# Greenfield dev iteration.
pnpm prisma-next contract emit
pnpm prisma-next db init
git status
```

**Expected after `db init`:**
- `migrations/app/refs/db.json` written (the ref pointer).
- `migrations/app/refs/db.contract.json` + `.contract.d.ts` written (the paired snapshot).
- `db.json` hash matches the initial-emitted contract hash.
- No bundle directories under `migrations/app/`. The migration graph is empty; that's the state the J4 trap was about.

Now iterate the schema:

```bash
# Edit schema.psl: add a model, e.g. `model Tag { id Int @id; name String; }`
pnpm prisma-next contract emit
pnpm prisma-next db update
git status
```

**Expected after `db update`:**
- `db.json` + `db.contract.json` + `db.contract.d.ts` all updated (paired snapshot now reflects the post-update contract).
- The DB is up-to-date with the new contract.
- Still no bundle directories — the graph is still empty.

Now the critical moment — `migration plan` (the step that used to produce an unapplyable migration):

```bash
pnpm prisma-next migration plan
git status
```

**Expected after `migration plan`:**
- **TWO** migration bundles under `migrations/app/`:
  - A baseline bundle (slug `baseline`): `metadata.from === null`, `metadata.to === <db-ref-hash>`. Contains the schema needed to go from "empty database" to the `db` ref's snapshotted contract.
  - A delta bundle (slug `migration` by default, or `--name`'s value): `metadata.from === <db-ref-hash>`, `metadata.to === <current-contract-hash>`. Contains only the operations from the iteration.
- The baseline directory name sorts before the delta directory name (a one-minute offset between their timestamps ensures this).
- Each bundle has its own `migration.ts`, `ops.json`, `migration.json`, `end-contract.{json,d.ts}`, plus (for the delta only) `start-contract.{json,d.ts}`. Baseline gets no `start-contract.*` (it starts from null).
- Command output reads `Planned baseline + N operation(s)` with `Baseline → migrations/app/<baseline-dir>` and `App space → migrations/app/<delta-dir>` lines.

**The acceptance step:**

```bash
pnpm prisma-next migrate
```

**Expected:**
- Apply succeeds.
- Both bundles are applied; the runner skips the baseline's `CREATE TABLE` operations (via the idempotency-class `postcheck_pre_satisfied` path) because the tables already exist on the live DB.
- The DB marker advances to the current contract hash.
- Exit code 0.

**This is the J4 closure.** Pre-Slice-3, this sequence produced a single `null → currentHash` bundle that `migrate` rejected because the DB marker had already advanced past `null`. Post-Slice-3, the auto-baseline gives the runner a coherent path from null through the snapshot to the current contract.

---

## Scenario 2 — Default workflow on a non-empty graph (regression)

After Scenario 1, the graph isn't empty anymore. Continue:

```bash
# Edit schema.psl: add another model
pnpm prisma-next contract emit
pnpm prisma-next db update
pnpm prisma-next migration plan
git status
```

**Expected:**
- ONE new migration bundle (no auto-baseline; the graph isn't empty).
- Bundle has `from === <previous-delta-to>`, `to === <new-contract-hash>`.
- Command output reads `Planned N operation(s)` (no `baseline +` prefix; no `Baseline → ...` line).

The resolver took the `kind: 'snapshot'` path via the `db` ref's paired snapshot.

---

## Scenario 3 — Explicit `--from <ref>` against `production`

Long-running project where you want to plan a migration from `production` (a ref you manage manually) to your current dev state:

```bash
# From the state at end of Scenario 2:
pnpm prisma-next ref set production sha256:<some-earlier-hash>
# ... contract edits ...
pnpm prisma-next contract emit
pnpm prisma-next migration plan --from production
```

**Expected:**
- Single bundle: `from === <production-hash>`, `to === <current-contract-hash>`.
- The bundle's `start-contract.{json,d.ts}` is sourced from `production`'s paired snapshot files (NOT from a migration bundle's `end-contract.*`).
- Command output reads `Planned N operation(s)`.

Note: this requires `production` to have a paired snapshot. If it doesn't (legacy `ref set` without snapshot), Slice 4 / Parallel A will surface the right diagnostic. For this slice's manual QA, set `production` via `ref set` after the slice 1+2 wiring is in place so the paired snapshot exists.

---

## Scenario 4 — The forgot-the-flag refuse

Construct a state where the `db` ref has advanced past the migration graph. Mid-project, run `db update` repeatedly without committing the resulting migration:

```bash
# From a project with a committed migration history:
# Edit schema.psl: a structural change
pnpm prisma-next contract emit
pnpm prisma-next db update        # advances db ref past the graph tip
# Edit schema.psl: ANOTHER structural change
pnpm prisma-next contract emit
pnpm prisma-next db update        # advances db ref again
# Don't commit any migration yet.
pnpm prisma-next migration plan   # should refuse
```

**Expected:**
- Command refuses with exit code non-zero.
- Output (or `--json` `meta.code`): `MIGRATION.HASH_NOT_IN_GRAPH`.
- The `fix` text enumerates which refs are reachable (graph-node hashes) and suggests `--from <graph-tip>` or `--from <reachable-ref>`.
- No bundles are written.

The user can recover by running `migration plan --from <graph-tip>` to formalize the cumulative changes as a single new bundle.

---

## Scenario 5 — The snapshot-missing refuse (legacy state)

Simulate a project that has a `db` ref pointer from before Slice 1+2 wiring (so no paired snapshot):

```bash
# In a non-empty-graph project:
# Manually create db.json without the paired snapshot.
HASH="sha256:0000000000000000000000000000000000000000000000000000000000000000"
cat > migrations/app/refs/db.json <<EOF
{ "hash": "$HASH", "invariants": [] }
EOF
# (where $HASH is something NOT in the graph)
pnpm prisma-next migration plan
```

**Expected:**
- Refuses with exit code non-zero.
- Output / `--json` `meta.code`: `MIGRATION.SNAPSHOT_MISSING`.
- The `fix` text suggests `db update --advance-ref db` (to repopulate the snapshot) OR `ref delete db` (to clear the orphan pointer).
- No bundles are written.

Variant: if you point `db.json` at a hash that IS a graph node, the resolver falls through to the bundle-as-contract-source path (legacy compat per spec OQ5). No refuse; single bundle written.

---

## Scenario 6 — JSON output

Every scenario above should also work with `--json`:

```bash
pnpm prisma-next migration plan --json | jq '{ok, dir, baselineDir, from, to, summary}'
```

**Expected (for the J4 reproduction):**
- `ok: true`.
- `dir`: the delta directory path.
- `baselineDir`: the baseline directory path.
- `from`: the `db` ref hash.
- `to`: the current contract hash.
- `summary`: `Planned baseline + N operation(s)`.

For non-auto-baseline scenarios, `baselineDir` is `undefined` / absent.

For refuse scenarios:
- `ok: false`.
- `meta.code`: `MIGRATION.HASH_NOT_IN_GRAPH` or `MIGRATION.SNAPSHOT_MISSING`.
- The `fix` and `why` text are present and actionable.

---

## Scenario 7 — `--from db` is identical to the implicit default

```bash
# Both invocations should produce identical output:
pnpm prisma-next migration plan
pnpm prisma-next migration plan --from db
```

**Expected:**
- Same exit code, same bundle directory layout, same JSON envelope (modulo the timestamp embedded in `metadata.createdAt`).
- The `--from db` syntactic sugar is the resolver's `kind: 'snapshot'` path, identical to the implicit `db`-ref default.

---

## Acceptance

This script passes when every scenario's "Expected" block matches reality. Surface any deviation as a `🛑 Blocker` finding in a run report (`drive-qa-run`); minor wording or formatting nits are `🟡 Observation`. The slice's manual-QA is **authored** here; **execution** is left to project close-out or any time the slice's surface changes.

The TML-2629 trap is closed when Scenario 1's `migrate` step succeeds. If that step ever fails on a fresh run, the runner-side idempotency assumption (project spec § Risks A4) has regressed and needs investigation before announcing project closure.
