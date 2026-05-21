# Manual QA — `db init` / `db update` ref-write integration

**Slice spec:** [`./spec.md`](./spec.md)
**Slice plan:** [`./plan.md`](./plan.md)
**Parent project:** [`../../`](../../)

## Purpose

Exercise the user-facing surface of this slice — the `--advance-ref` flag and the implicit-`db`-default rule — through workflows a real developer would run. The e2e suite at `test/integration/test/cli.db-ref-advancement.e2e.test.ts` already covers the four matrix cases per command plus the dry-run / JSON / invalid-name shape variants; this script's value-add is exercising surfaces that e2e infrastructure doesn't reach cleanly — chiefly `db update --to <ref>` interactions (no pre-existing e2e harness for `--to`) and direct shell-out feel checks.

Execute this script when you change anything in the slice's surface (helper, formatter, command wiring), or as part of any project-level close-out roll-up. Time budget: ~15 min.

## Setup

```bash
cd $(mktemp -d) && pnpm dlx prisma-next init --skip-skill-install
pnpm install
# Edit prisma-next.config.ts to point db.connection at a throwaway PGlite or local Postgres URL.
```

Verify `git init` so you can spot ref-file changes via `git status` (NFR3).

---

## Scenario 1 — Default DB, implicit `db` ref (the happy path)

The dev-mode workflow this project was built to support.

```bash
pnpm prisma-next db init
git status
```

**Expected:**
- Command output includes a line: `Advanced ref "db" → sha256:<hash>`.
- `git status` shows three new files under `migrations/app/refs/`:
  - `db.json`
  - `db.contract.json`
  - `db.contract.d.ts`
- The hash in `db.json` matches the post-init contract hash.
- `db.contract.json` contains the full contract IR (same structure as a bundle's `end-contract.json`).
- Exit code is 0.

Then iterate:

```bash
# Edit schema.psl: add a new model, e.g. `model Tag { id Int @id; name String; }`
pnpm prisma-next contract emit
pnpm prisma-next db update
git status
```

**Expected:**
- Output: `Advanced ref "db" → sha256:<new-hash>`.
- The three `db.*` files are **modified** (not new) — same idempotent file paths, updated content.
- Hash in `db.json` reflects the post-update contract.

---

## Scenario 2 — Default DB, explicit `--advance-ref staging`

User declares "this command updates the `staging` checkpoint, not my dev pointer."

```bash
# From the state at the end of Scenario 1:
# Edit schema.psl again
pnpm prisma-next contract emit
pnpm prisma-next db update --advance-ref staging
git status
```

**Expected:**
- Output: `Advanced ref "staging" → sha256:<hash>`.
- Three new files: `staging.json`, `staging.contract.json`, `staging.contract.d.ts`.
- `db.*` files are **unchanged** (per `git diff` — the implicit-default doesn't fire when `--advance-ref` is explicit).

---

## Scenario 3 — Non-default DB (`--db <url>`), no advancement

User runs a one-off against a different database; they shouldn't accidentally clobber `db` ref's view of the project's dev DB.

```bash
# Set up a SECOND throwaway DB at $OTHER_URL
pnpm prisma-next db update --db "$OTHER_URL"
git status
```

**Expected:**
- Apply succeeds; the contract is applied to `$OTHER_URL`.
- Command output does **not** include any "Advanced ref ..." line (in human or JSON mode).
- `git status` shows **no new or modified files** under `migrations/app/refs/`.
- Exit code is 0.

---

## Scenario 4 — Non-default DB + explicit `--advance-ref`

```bash
pnpm prisma-next db update --db "$OTHER_URL" --advance-ref staging
git status
```

**Expected:**
- Output: `Advanced ref "staging" → sha256:<hash>`.
- The hash recorded matches what was applied to `$OTHER_URL` (not necessarily what's in the default DB).
- `staging.{json,contract.json,contract.d.ts}` updated.

---

## Scenario 5 — Dry-run mode

```bash
# Edit schema.psl
pnpm prisma-next contract emit
pnpm prisma-next db update --dry-run
git status
```

**Expected:**
- Output includes a line: `Would advance ref "db" → sha256:<hash>`.
- No files are written under `migrations/app/refs/` (per `git diff`).
- Exit code is 0.

Repeat with `--dry-run --json`:

```bash
pnpm prisma-next db update --dry-run --json | jq '.plannedAdvanceRef'
```

**Expected:** `{ "name": "db", "hash": "sha256:..." }`.

---

## Scenario 6 — `db update --to <ref>` with implicit `db` advancement

The slice spec § Edge cases row that has no e2e coverage. When the user replays a historical migration, the `db` ref should track what was *actually* applied (the bundle's hash), not the current contract.

Pre-flight: set up a project with at least two committed migrations so `--to` has something to point at.

```bash
# From a project with migrations m1, m2 already applied:
pnpm prisma-next db update --to <m1-hash-or-name>
git status
```

**Expected:**
- Apply rolls the DB back to m1's contract.
- Output: `Advanced ref "db" → sha256:<m1-hash>` (note: NOT the current contract hash — the m1 hash).
- `db.contract.json` contains m1's contract IR (loaded from the bundle's `end-contract.json`).

---

## Scenario 7 — `db update --to <ref>` with `--advance-ref staging`

```bash
pnpm prisma-next db update --to <m1-hash-or-name> --advance-ref staging
git status
```

**Expected:**
- Output: `Advanced ref "staging" → sha256:<m1-hash>`.
- `staging.contract.json` contains m1's contract IR.
- `db.*` files unchanged.

---

## Scenario 8 — `db update --to <ref>` against non-default DB

```bash
pnpm prisma-next db update --db "$OTHER_URL" --to <m1-hash-or-name>
git status
```

**Expected:**
- Apply happens against `$OTHER_URL`.
- No ref files touched.
- Output does **not** mention any ref advancement.

---

## Scenario 9 — Failure surfaces

### 9a. Invalid ref name

```bash
pnpm prisma-next db update --advance-ref "has spaces"
```

**Expected:**
- Exit code non-zero.
- Output (or `--json` `meta.code`): `MIGRATION.INVALID_REF_NAME`.
- The error is structured (`CliStructuredError`), not a Node stack trace.
- The DB **may or may not** be updated — failure happens after apply if the ref-write fails; current spec accepts that drift (NFR4 + § Approach atomicity discussion).

### 9b. Ref-write failure mid-flight (manual injection — optional)

```bash
# Set up: revoke write permission on migrations/app/refs/ before running:
chmod -w migrations/app/refs/
pnpm prisma-next db update
```

**Expected:**
- Apply succeeds (DDL ran).
- Ref-write fails with a `MIGRATION.*` error code in the output / JSON meta.
- The DB marker is advanced; the `db` ref is **not** advanced.
- Exit code non-zero.
- The user can recover by running `chmod +w migrations/app/refs/ && pnpm prisma-next db update` — the next successful update advances the ref (idempotent rewrite per NFR4).

(Skip 9b in environments where `chmod` doesn't apply.)

---

## Acceptance

This script passes when every scenario's "Expected" block matches reality. Surface any deviation as a `🛑 Blocker` finding in a run report (`drive-qa-run`); minor wording or formatting nits are `🟡 Observation`. The slice's manual-QA is **authored** here; **execution** is left to project-level close-out roll-up or any time the surface changes.
