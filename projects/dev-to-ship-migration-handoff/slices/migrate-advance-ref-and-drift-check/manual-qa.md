# Manual QA — `migrate` `--advance-ref` flag + apply-time drift check

**Slice spec:** [`./spec.md`](./spec.md)
**Slice plan:** [`./plan.md`](./plan.md)
**Parent project:** [`../../`](../../)

## Purpose

This slice closes the **TML-2629 dev → ship transition trap** at the **runner layer** (Slice 3 closed it at the planner layer). The e2e suite at `test/integration/test/cli.migrate-drift-check.e2e.test.ts` covers 6 scenarios programmatically, plus 13 ref-advancement cases at `test/integration/test/cli.migrate-ref-advancement.e2e.test.ts` and the extended J4 reproduction at `test/integration/test/cli.migration-plan-ref-aware.e2e.test.ts`. This script's value-add is exercising the slice's user-facing surface — the `--advance-ref` opt-in flag and the new `MIGRATION.MARKER_MISMATCH` / `MIGRATION.PATH_UNREACHABLE` diagnostics — the way a real developer would experience them, including the precise moment the project's J4 trap finally closes end-to-end.

Run this script when:
- The slice's user-facing behaviour changes (`--advance-ref` wiring, drift-check ordering, diagnostic wording).
- The project ships and you want the final end-to-end smoke check before announcing closure.
- A user surfaces a cold-clone-drift bug shaped like Scenario 2 below and you want to reproduce.

Time budget: **~25 min** (includes the full J4 trap-closure walkthrough).

## Setup

```bash
cd $(mktemp -d) && pnpm dlx prisma-next init --skip-skill-install
pnpm install
# Edit prisma-next.config.ts to point db.connection at a throwaway PGlite or local Postgres URL.
git init && git add -A && git commit -m "initial"
```

Verify `git status` / `git diff` work so you can spot ref-file and bundle changes (NFR3, NFR4).

---

## Scenario 1 — The TML-2629 J4 trap, closed END-TO-END

The full audit run-013 reproduction. Sister-walkthrough to slice 3's manual-qa.md § Scenario 1, with the final `migrate` step extended to advance the `db` ref.

```bash
# Greenfield dev iteration.
pnpm prisma-next contract emit
pnpm prisma-next db init
git status
```

**Expected after `db init`:** as documented in slice 2's manual-qa.md § Scenario 1 — `db.json`, `db.contract.json`, `db.contract.d.ts` written; no bundle directories; exit 0.

Iterate the schema:

```bash
# Edit schema.psl: add a model, e.g. `model Tag { id Int @id; name String; }`
pnpm prisma-next contract emit
pnpm prisma-next db update
git status
```

**Expected after `db update`:** `db.*` files updated; still no bundle directories; DB up to date.

Plan the migration (slice 3 territory — auto-baseline pair):

```bash
pnpm prisma-next migration plan
git status
```

**Expected:** two bundles on disk per slice 3's manual-qa.md § Scenario 1.

**The acceptance step — slice 4's new contribution:**

```bash
pnpm prisma-next migrate --advance-ref db
git status
```

**Expected:**
- Apply succeeds (both bundles applied; baseline's `CREATE TABLE`s skip via the runner's `postcheck_pre_satisfied` idempotency path).
- Command output's **final line**: `Advanced ref "db" → sha256:<hash>` (mirrors `db init` / `db update` wording).
- `git status` shows `db.json`, `db.contract.json`, `db.contract.d.ts` modified — the `db` ref + paired snapshot now point at the post-apply marker (= the current contract hash).
- DB marker matches the current contract hash.
- Exit code 0.

**This is the project's PDoD4 acceptance evidence.** Pre-project, this sequence produced an unapplyable migration. Post-project, it produces both bundles AND advances the dev-mode marker in one command.

---

## Scenario 2 — Cold-clone drift refuse (PDoD5)

The slice's defining refuse path. Simulate cloning a repo where the migration graph doesn't include the live DB marker:

```bash
# From the end of Scenario 1 (a healthy project with one bundle pair + db ref):
# Stage a "different" repo state with mismatched migrations.
rm -rf migrations/app/*/   # delete bundle directories (keep refs/)
# Edit schema.psl: a structural change
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name replacement
# A new bundle pair is on disk, but the DB marker is from Scenario 1 — NOT in this new graph.
pnpm prisma-next migrate
```

**Expected:**
- Command refuses with exit code non-zero — **BEFORE any DDL runs**.
- Output / `--json` `meta.code`: `MIGRATION.MARKER_MISMATCH`.
- `why` text names both the live marker hash and the on-disk graph's reachable hashes.
- `fix` text enumerates three actionable affordances:
  - `Run \`prisma-next migration plan --from sha256:<graph-tip>\`` if the live marker is canonical and the on-disk graph needs catching up.
  - `Run \`prisma-next ref set db sha256:<marker-hash>\`` if the on-disk graph is canonical and the local `db` ref drifted.
  - `Investigate whether the database was migrated by an out-of-band process.`
- DB state is **unchanged** — no DDL was run.

This is the cold-clone drift trap: a developer pulls a teammate's branch with a different migration history, runs `migrate` against their own DB, and gets a precise refuse instead of the cryptic `pathUnreachable` failure that previously surfaced mid-DDL or as an empty-`fix` envelope.

---

## Scenario 3 — Drift check fires regardless of `--to` (independence)

`--to` controls the END point of the migration; the drift check is about the START point (live marker). They're independent:

```bash
# From Scenario 2's drifted state:
pnpm prisma-next migrate --to <any-graph-node-hash>
```

**Expected:** same refuse as Scenario 2 — `MIGRATION.MARKER_MISMATCH`. The `--to` flag doesn't bypass the drift check; resolving a different destination doesn't fix a START-point mismatch.

---

## Scenario 4 — Improved `pathUnreachable` diagnostic (NFR6 § fix-text quality)

Construct a marker-is-in-graph-but-no-path-exists scenario. This is the runner-side failure mode (vs Scenario 2's CLI-side drift check):

```bash
# Set up a graph with a fork: two disconnected chains.
# (Easiest reproduction: hand-craft two bundles with non-matching from/to hashes
#  via the on-disk layout, OR construct via successive migration plan --from
#  invocations that target hashes the runner can't path-walk between.)
pnpm prisma-next migrate --to <unreachable-end-hash>
```

**Expected:**
- Refuse with exit code non-zero — runner-side.
- Output / `--json` `meta.code`: `MIGRATION.PATH_UNREACHABLE` (CLI mapping over runner's `MIGRATION_PATH_NOT_FOUND`).
- `why` text names origin + destination hashes (e.g., `Cannot reach target "sha256:..." from current marker "sha256:..."`).
- `fix` text enumerates three actionable affordances:
  - `Run \`prisma-next migration list\` to see the on-disk graph.`
  - `Run \`prisma-next migration plan --from sha256:<marker> --to sha256:<dest>\` to introduce the missing path.`
  - `Run \`prisma-next migration show <bundle>\` for any bundle in the path you expected.`
- Pre-slice-4, the `fix` field was empty. Now it's three lines of actionable guidance.

**Variant (the `neverPlanned` kind):** if the runner returns `kind: 'neverPlanned'` instead (no `fromHash` in the failure meta — e.g., extension-pack-with-empty-graph scenarios), the `fix` line omits the `--from` clause: `Run \`prisma-next migration plan --to sha256:<dest>\` to introduce the missing path.` Verify that `<unknown>` never leaks into the `fix` text in any failure shape (this was F6 in the slice's code review).

---

## Scenario 5 — `migrate --advance-ref` matrix (mirrors slice 2's pattern)

The opt-in advancement flag on `migrate` is **asymmetric** vs `db init` / `db update`: there's **no implicit default**. Only explicit `--advance-ref <name>` writes a ref.

### 5a. `migrate` no `--advance-ref`, default DB (regression)

```bash
pnpm prisma-next migrate
git status
```

**Expected:** no ref files modified. `migrate` advances the DB marker on disk (post-apply); it doesn't touch `migrations/app/refs/` because no flag was passed. Mirrors the design-discussion outcome: "`db` isn't magic, just a simple default."

### 5b. `migrate --advance-ref staging`

```bash
pnpm prisma-next migrate --advance-ref staging
git status
```

**Expected:**
- `migrations/app/refs/staging.json` + `staging.contract.json` + `staging.contract.d.ts` written.
- `staging.json` hash matches the post-apply marker (= current contract hash for a `--to`-less invocation).
- Command output's final line: `Advanced ref "staging" → sha256:<hash>`.
- The `db` ref is **unchanged** (this slice's `migrate --advance-ref` advances exactly the named ref, no implicit cascade).

### 5c. `migrate --advance-ref staging --db <other-url>`

```bash
pnpm prisma-next migrate --advance-ref staging --db postgresql://other:password@host/otherdb
git status
```

**Expected:** same as 5b — explicit flag fires regardless of `--db`. The `--db` flag controls the DB the migration runs against; `--advance-ref` controls the ref-write surface. No implicit-default leak from the `db` ref pattern (slice 2's asymmetry rule).

### 5d. `migrate --to <ref-name> --advance-ref staging`

```bash
# Where 'production' is a ref pointing at some bundle-tip hash:
pnpm prisma-next migrate --to production --advance-ref staging
git status
```

**Expected:**
- DB advances to `production`'s hash.
- `staging` ref + paired snapshot written.
- The snapshot source is the matching bundle's `end-contract.{json,d.ts}` (NOT the current contract). Verify by inspection: `staging.contract.json`'s `storage.storageHash` matches the bundle's `metadata.to`.

### 5e. Invalid ref name

```bash
pnpm prisma-next migrate --advance-ref "bad/name"
```

**Expected:** apply still runs and succeeds (the flag is validated post-apply by `writeRefPaired` → `validateRefName`); the apply commits, then the ref-write fails with `MIGRATION.INVALID_REF_NAME`. Re-running with a valid name after fixing the invocation succeeds.

### 5f. Apply fails — ref is NOT written

Construct a state where apply fails (e.g., contract has been edited to a state the runner can't reach from the current marker without an intermediate bundle):

```bash
pnpm prisma-next migrate --advance-ref staging
```

**Expected:** refuse path fires (either Scenario 2's drift check or Scenario 4's `pathUnreachable`). The `staging` ref is **NOT** written. Re-running with `--advance-ref staging` after fixing the cause writes the ref cleanly (idempotent rewrite).

### 5g. `--quiet` suppresses the human-readable advancement line

```bash
pnpm prisma-next migrate --advance-ref staging --quiet
git status
```

**Expected:** no `Advanced ref ...` line in stdout. `staging` ref + paired snapshot are still written.

```bash
pnpm prisma-next migrate --advance-ref staging --quiet --json | jq '.advancedRef'
```

**Expected:** JSON envelope's `advancedRef` field is `{ name: "staging", hash: "sha256:..." }` (always-present-null when `--advance-ref` is absent; populated when present).

---

## Scenario 6 — JSON output for refuse paths

Every refuse scenario above should also work with `--json`:

```bash
# In Scenario 2's drifted state:
pnpm prisma-next migrate --json | jq '{ok, summary, why, fix, meta}'
```

**Expected:**
- `ok: false`.
- `meta.code: "MIGRATION.MARKER_MISMATCH"`.
- `meta.markerHash`, `meta.reachableHashes` (array), `meta.graphTip` (string or absent for empty-graph case).
- `why` and `fix` text are present and actionable (matching Scenario 2's expectations).

For Scenario 4 (`pathUnreachable`):

```bash
pnpm prisma-next migrate --to <unreachable-hash> --json | jq '{ok, summary, why, fix, meta}'
```

**Expected:**
- `ok: false`.
- `meta.code: "MIGRATION.PATH_UNREACHABLE"`.
- `meta.fromHash`, `meta.targetHash` (or `meta.target` for `neverPlanned`).
- `fix` text has no `<unknown>` substrings regardless of which runner kind fired.

---

## Scenario 7 — Greenfield apply with `--advance-ref` (no drift check trigger)

```bash
# Fresh project, fresh DB:
cd $(mktemp -d) && pnpm dlx prisma-next init --skip-skill-install
pnpm install
pnpm prisma-next contract emit
pnpm prisma-next migration plan --name initial
pnpm prisma-next migrate --advance-ref db
```

**Expected:** apply succeeds (greenfield — marker absent — drift check short-circuits); `db` ref + paired snapshot written. This is the bootstrap workflow for projects that skip `db init` / `db update` and go straight to `migration plan` + `migrate` (the formal workflow).

---

## Acceptance

This script passes when every scenario's "Expected" block matches reality. Surface any deviation as a `🛑 Blocker` finding in a run report (`drive-qa-run`); minor wording or formatting nits are `🟡 Observation`. The slice's manual-QA is **authored** here; **execution** is left to project close-out or any time the slice's surface changes.

**Project acceptance gate:** if Scenario 1 (`migrate --advance-ref db` from a greenfield → `db init` → `db update` → `migration plan` → `migrate --advance-ref db` sequence) fails on a fresh run, the TML-2629 trap closure has regressed and needs investigation before announcing project closure. This scenario + slice 3's manual-qa.md § Scenario 1 are the project's joint PDoD4 evidence.

**Cold-clone gate (PDoD5):** if Scenario 2 doesn't refuse cleanly with `MIGRATION.MARKER_MISMATCH` and both hashes named in the diagnostic, the slice's defining refuse path has regressed.
