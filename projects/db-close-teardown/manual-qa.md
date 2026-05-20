# Manual QA — TML-2614 (db.close() + [Symbol.asyncDispose])

> **Be the user.** Run scripts, observe real process exit behaviour, and judge what unit tests can't: diagnostic clarity, end-to-end process lifecycle, and skill-content coherence.
>
> **Out of scope of this script.** Do not re-run `pnpm test`; do not re-run CI lints against the clean tree; do not verify fixture shapes — CI already owns those gates. This script covers what CI cannot.
>
> **Spec:** `projects/db-close-teardown/spec.md`
> **Plan:** `projects/db-close-teardown/plan.md`
> **PR:** https://github.com/prisma/prisma-next/pull/548

## What this script is testing

**The bug / motivation.** Users following the Prisma Next quickstart shape — `tsx my-script.ts` that connects, runs queries, then exits — encounter two failure modes on 100% of first-touch runs. On Postgres, the `pg.Pool` lazily constructed by the facade keeps Node's event loop alive after all queries complete; the script never exits. When agents try to help, they confabulate `db.end()` (the `node-postgres` pool API) since the facade historically had no teardown surface; the call throws `TypeError: db.end is not a function` after the data round-trip already succeeded. Both failures are worst-possible last impressions on an onboarding journey.

**The fix / what changed.** The PR adds:

- `db.close(): Promise<void>` and `db[Symbol.asyncDispose](): Promise<void>` to `PostgresClient`, `SqliteClient`, and `MongoClient`.
- Ownership rule: `close()` releases only what the facade itself constructed (`pg.Pool` from `{ url }`, `MongoClient` from `{ url }` / `{ uri, dbName }`, SQLite handle from `{ path }`). Caller-supplied pools/clients/bindings are never touched.
- A terminal closed state: after `close()`, `db.runtime()`, `db.connect()`, ORM terminals, `db.transaction()`, and `db.prepare()` reject with `Error('<target> client is closed')`.
- A silent fix to Mongo: the previous `close()` unconditionally called the driver close even for caller-supplied `mongoClient`; the corrected version honours the ownership rule.
- Updated skills (`prisma-next-runtime`, `prisma-next-queries`, `prisma-next-debug`) teaching the teardown pattern and routing the `db.end()` confabulation diagnostic.

**Why manual QA matters here.** Unit tests verify mock-pool mechanics: idempotence, terminal state, ownership rule, `[Symbol.asyncDispose]` aliasing, in-flight connect handling. They do not verify:

1. That a real `tsx my-script.ts` against a real driver actually exits within ~1s of calling `await db.close()` (the original ticket symptom).
2. That TS 5.2+ `await using` at script-module top level invokes `[Symbol.asyncDispose]` correctly and the script exits.
3. That the post-close error (`Error('Postgres client is closed')`) surfaces cleanly through the ORM layer, not buried under extra wrapping.
4. That the skill content correctly routes the hang symptom and clearly flags the per-request `await using` anti-pattern.

## Table of contents

| # | Scenario | What it proves | Covers |
| - | -------- | -------------- | ------ |
| 1 | Postgres real-script hang→exit | A real `tsx` script against a real `pg.Pool` exits within 2s after `await db.close()` | AC-Quickstart-exit |
| 2 | SQLite real-script hang→exit | A real `tsx` script against a real SQLite file-backed driver exits within 2s after `await db.close()` | AC-Quickstart-exit |
| 3 | `await using` top-level script module exit | `await using db = sqlite(...)` at script-module top level correctly calls `[Symbol.asyncDispose]` and the script exits | AC-Quickstart-exit |
| 4 | Post-close ORM error surface — Postgres | After `db.close()`, calling an ORM terminal surfaces `'Postgres client is closed'` cleanly, not buried | AC-Terminal |
| 5 | Post-close ORM error surface — SQLite | After `db.close()`, calling an ORM terminal surfaces `'SQLite client is closed'` cleanly | AC-Terminal |
| 6 | Mongo ownership rule — `{ url }` vs `{ mongoClient }` (judgement) | The ownership-rule behaviour change from Mongo's previous `close()` is correct and the release note communicates it | AC-Ownership, AC-Mongo-behaviour |
| 7 | Skill replay — hang-script routing **(judgement)** | `prisma-next-debug` routes "script won't exit" to `prisma-next-runtime` § *Running as a script (teardown)*; content is clear and sufficient | AC-Skills |
| 8 | Skill replay — per-request `await using` anti-pattern **(judgement)** | The DON'T block in `prisma-next-runtime` is clearly marked and discourages the per-request close pattern | AC-Skills |
| 9 | Exploratory: close surface edge-case probing | Probe unanticipated state combinations across all three facades | (no specific AC; charter) |

> Scenarios 6, 7, 8 are **(judgement)** — they require human evaluation that no test can assert. Scenario 9 is **(exploratory)** — a time-boxed charter.

## Pre-flight

1. Confirm the branch: `git branch --show-current` → should be `tml-2614-provide-dbclose-for-script-teardown-scripts-hang-at-end-and`.
2. Confirm the tree is clean: `git status --short` → should show no uncommitted changes to source files (QA artefact files are expected).
3. Confirm packages are built: `ls packages/3-extensions/postgres/dist/runtime.mjs` → file should exist.
4. Confirm `tsx` is available: `pnpm exec tsx --version` → should print a version.
5. Run per-package close tests to establish baseline: `pnpm --filter @prisma-next/sqlite test 2>&1 | tail -5` → should show 7 tests pass.
6. Acknowledge pre-existing upstream failures: `@prisma-next/postgres` has one test file fail (`psl-namespace-qualifier-routing.test.ts`) due to a missing `@prisma-next/psl-parser` build; `@prisma-next/mongo` has 4 e2e tests fail due to `storage.collections` contract validation drift. Neither failure was introduced by this branch (confirmed by `git diff origin/main..HEAD -- packages/3-extensions/postgres/test/psl-namespace-qualifier-routing.test.ts packages/3-extensions/mongo/test/mongo.e2e.test.ts` being empty). Record these as pre-existing gaps; do not block QA on them.
7. Create working directory for temp scripts: `mkdir -p /tmp/prisma-next-qa-2614`.

## Scenario 1 — Postgres real-script hang→exit

**What you're proving from the user's seat:** This re-enacts the original ticket's hang symptom against a real `pg.Pool`. Unit tests mock the pool; this scenario drives a real `new Pool(...)` (which creates internal timers that keep Node's event loop alive) and verifies that `db.close()` → `pool.end()` → clean exit completes within a 5-second timeout. Without the fix, `timeout 5 tsx script.ts` would exit with code 124 (timeout); with the fix it exits with code 0.

**Covers:** AC-Quickstart-exit

**Oracle:** Script process exits with code 0 and the phrase `"db.close() called"` printed before exit; total wall time under 5s.

**Preconditions:**
- Packages built (pre-flight step 3).
- `tsx` available (pre-flight step 4).
- `pg` package available in `packages/3-extensions/postgres/node_modules/pg`.
- Working directory `/tmp/prisma-next-qa-2614` exists (pre-flight step 7).

### Steps

```bash
# 1. Write the script
cat > /tmp/prisma-next-qa-2614/pg-hang-exit.mts << 'SCRIPT'
import { Pool } from 'pg';

// Simulate exactly what postgres({ url }) does inside connectDriver():
// toRuntimeBinding creates a new Pool(...) which registers internal timers.
// The fix is: pool.end() releases those timers, letting the event loop drain.
const pool = new Pool({
  connectionString: 'postgres://localhost:5999/nonexistent',
  connectionTimeoutMillis: 500,
  idleTimeoutMillis: 500,
});

console.log('Pool created — event loop is now kept alive by pg.Pool timers.');
console.log('Calling pool.end() (what db.close() does under the hood)...');
await pool.end();
console.log('pool.end() resolved — event loop should drain now.');
SCRIPT

# 2. Run with a 5-second timeout
time timeout 5 node --import tsx/esm /tmp/prisma-next-qa-2614/pg-hang-exit.mts
echo "Exit code: $?"
```

Alternatively, use the full postgres facade (requires a contract):

```bash
# Write a script using the actual postgres() facade with a minimal contract
REPO="$(git rev-parse --show-toplevel)"
cat > /tmp/prisma-next-qa-2614/pg-facade-hang-exit.mts << 'SCRIPT'
import { createContract } from '@prisma-next/contract/testing';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import postgres from '@prisma-next/postgres/runtime';

const contract = createContract<SqlStorage>();
const db = postgres({ contract, url: 'postgres://localhost:5999/nonexistent' });

// Trigger pool creation (this is what db.runtime() does under the hood)
db.runtime();
// Let the microtask queue flush so Pool constructor runs
await new Promise(resolve => setTimeout(resolve, 10));

console.log('Postgres facade created pool. Calling db.close()...');
await db.close();
console.log('db.close() resolved.');
SCRIPT

NODE_PATH="$REPO/node_modules" \
  time timeout 5 node \
    --import tsx/esm \
    --experimental-vm-modules \
    /tmp/prisma-next-qa-2614/pg-facade-hang-exit.mts 2>&1
echo "Exit code: $?"
```

### What you should see

- The script prints the log lines and exits.
- `time` output shows wall time under 1.5s (pool.end() is near-instant with no connections).
- Exit code 0.
- **Critically**: without the `pool.end()` call, this script would hang indefinitely because `pg.Pool`'s internal idle-connection timers keep Node's event loop alive even when no connections are established. If the fix were absent, `timeout 5` would fire with exit code 124.

### Failure modes (anything matching these = a finding the runner will classify)

- Script exits with code 124 (timeout): `pool.end()` is not being called or is not resolving; the hang fix is not working.
- Script exits non-zero with an unexpected error (not a connection error — connection errors on the nonexistent server are expected and swallowed).
- Wall time exceeds 3s: `pool.end()` is blocking longer than expected.

### Restore

```bash
rm /tmp/prisma-next-qa-2614/pg-hang-exit.mts /tmp/prisma-next-qa-2614/pg-facade-hang-exit.mts 2>/dev/null || true
git status --short
```

---

## Scenario 2 — SQLite real-script hang→exit

**What you're proving from the user's seat:** A real `tsx` script that creates a `sqlite({ path })` client — the facade-owned, file-backed driver shape — calls `db.close()`, and the process exits cleanly. The SQLite driver's close method is exercised for real; the process doesn't hang.

**Covers:** AC-Quickstart-exit

**Oracle:** Script exits with code 0 and prints a completion message; wall time under 3s.

**Preconditions:**
- `tsx` available.
- Working dir `/tmp/prisma-next-qa-2614` exists.

### Steps

```bash
REPO="$(git rev-parse --show-toplevel)"

cat > /tmp/prisma-next-qa-2614/sqlite-hang-exit.mts << 'SCRIPT'
import { createContract } from '@prisma-next/contract/testing';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import sqlite from '@prisma-next/sqlite/runtime';

const contract = createContract<SqlStorage>();
const db = sqlite({ contract, path: '/tmp/prisma-next-qa-2614/test.db' });

// Trigger the driver build and file open
db.runtime();
await new Promise(resolve => setTimeout(resolve, 50));

console.log('SQLite driver opened. Calling db.close()...');
await db.close();
console.log('db.close() resolved. Script should exit now.');
SCRIPT

NODE_PATH="$REPO/node_modules" \
  time timeout 5 node --import tsx/esm \
    /tmp/prisma-next-qa-2614/sqlite-hang-exit.mts 2>&1
echo "Exit code: $?"
```

### What you should see

- Script prints both log lines and exits.
- Exit code 0.
- Wall time under 2s.
- File `/tmp/prisma-next-qa-2614/test.db` may be created; subsequent close should remove open handles.

### Failure modes

- Exit code 124: SQLite driver's `close()` is not being called or is blocking.
- Non-zero exit with unexpected error.

### Restore

```bash
rm -f /tmp/prisma-next-qa-2614/sqlite-hang-exit.mts /tmp/prisma-next-qa-2614/test.db
git status --short
```

---

## Scenario 3 — `await using` top-level script module exit

**What you're proving from the user's seat:** TS 5.2+ `await using` at script-module top level correctly invokes `[Symbol.asyncDispose]` when the module exits, and the process exits cleanly. This is the idiomatic shape the updated `prisma-next-runtime` skill teaches. Unit tests exercise it inside a test-function async scope; this scenario exercises it in an actual module-top-level script.

**Covers:** AC-Quickstart-exit

**Oracle:** Script prints a log line from inside the body and a second from outside (confirming exit ran), and exits with code 0.

**Preconditions:**
- `tsx` available.
- Packages built.

### Steps

```bash
REPO="$(git rev-parse --show-toplevel)"

cat > /tmp/prisma-next-qa-2614/await-using-top-level.mts << 'SCRIPT'
import { createContract } from '@prisma-next/contract/testing';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import sqlite from '@prisma-next/sqlite/runtime';

const contract = createContract<SqlStorage>();

// await using at top level of the script module — the shape the skill teaches.
// [Symbol.asyncDispose] fires when the module body completes.
await using db = sqlite({ contract, path: '/tmp/prisma-next-qa-2614/await-using-test.db' });

db.runtime();
await new Promise(resolve => setTimeout(resolve, 50));

console.log('Inside script body: db is open and usable.');
// After this line the module body ends; [Symbol.asyncDispose] fires.
SCRIPT

echo "Running await-using top-level script..."
NODE_PATH="$REPO/node_modules" \
  time timeout 5 node --import tsx/esm \
    /tmp/prisma-next-qa-2614/await-using-top-level.mts 2>&1
echo "Exit code: $?"
```

### What you should see

- Script prints `"Inside script body: db is open and usable."` and exits.
- Exit code 0.
- No `TypeError: db[Symbol.asyncDispose] is not a function` or similar.
- Wall time under 2s.

### Failure modes

- `TypeError: db[Symbol.asyncDispose] is not a function`: `[Symbol.asyncDispose]` is not declared on the facade.
- Script exits with code 124: `[Symbol.asyncDispose]` was invoked but is blocking.
- Script emits a `SyntaxError` about `await using`: tsx or Node version doesn't support TS 5.2+ syntax.

### Restore

```bash
rm -f /tmp/prisma-next-qa-2614/await-using-top-level.mts /tmp/prisma-next-qa-2614/await-using-test.db
git status --short
```

---

## Scenario 4 — Post-close ORM error surface — Postgres

**What you're proving from the user's seat:** After `db.close()`, a user who tries to call an ORM method (`db.orm.someTable.all()` etc.) gets a clean, usable error that names the cause. Unit tests verify the error at `db.runtime()` level; this scenario tests that the error propagates cleanly through the ORM routing layer without being buried under extra wrapping that would confuse the user.

**Covers:** AC-Terminal

**Oracle:** Error message is exactly `'Postgres client is closed'` (or contains it without extra wrapping like `OperationError: ...`). Stack trace starts at user-callable surface.

**Preconditions:**
- Packages built.
- `tsx` available.

### Steps

```bash
REPO="$(git rev-parse --show-toplevel)"

cat > /tmp/prisma-next-qa-2614/pg-post-close-error.mts << 'SCRIPT'
import { createContract } from '@prisma-next/contract/testing';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import postgres from '@prisma-next/postgres/runtime';

const contract = createContract<SqlStorage>();
const db = postgres({ contract, url: 'postgres://localhost:5999/test' });

await db.close();

// Attempt to use runtime after close — this is what a user would do inadvertently
try {
  db.runtime();
  console.log('ERROR: expected an error but did not get one');
  process.exit(1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log('Caught error message:', JSON.stringify(message));
  if (message === 'Postgres client is closed') {
    console.log('PASS: error message is exactly "Postgres client is closed"');
  } else {
    console.log('FAIL: unexpected error message — expected "Postgres client is closed"');
    process.exit(1);
  }
}
SCRIPT

NODE_PATH="$REPO/node_modules" \
  node --import tsx/esm \
    /tmp/prisma-next-qa-2614/pg-post-close-error.mts 2>&1
echo "Exit code: $?"
```

### What you should see

- Output: `Caught error message: "Postgres client is closed"` followed by `PASS:` line.
- Exit code 0.
- Error message is clean, not wrapped.

### Failure modes

- Error message is wrapped (e.g. `OperationError: Postgres client is closed` or `RuntimeError: ...`): the ORM layer is not passing through the close error cleanly.
- No error is thrown: the closed guard is not in place.
- Unexpected error (e.g. connection error) before the close guard fires.

### Restore

```bash
rm -f /tmp/prisma-next-qa-2614/pg-post-close-error.mts
git status --short
```

---

## Scenario 5 — Post-close ORM error surface — SQLite

**What you're proving from the user's seat:** Same as Scenario 4, but for the SQLite facade. Verifies `'SQLite client is closed'` is the error message from `db.runtime()` after close, propagated cleanly.

**Covers:** AC-Terminal

**Oracle:** Error message is exactly `'SQLite client is closed'`.

**Preconditions:**
- Packages built.
- `tsx` available.

### Steps

```bash
REPO="$(git rev-parse --show-toplevel)"

cat > /tmp/prisma-next-qa-2614/sqlite-post-close-error.mts << 'SCRIPT'
import { createContract } from '@prisma-next/contract/testing';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import sqlite from '@prisma-next/sqlite/runtime';

const contract = createContract<SqlStorage>();
const db = sqlite({ contract, path: '/tmp/prisma-next-qa-2614/post-close-test.db' });

await db.close();

try {
  db.runtime();
  console.log('ERROR: expected an error but did not get one');
  process.exit(1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log('Caught error message:', JSON.stringify(message));
  if (message === 'SQLite client is closed') {
    console.log('PASS: error message is exactly "SQLite client is closed"');
  } else {
    console.log('FAIL: unexpected error message — expected "SQLite client is closed"');
    process.exit(1);
  }
}
SCRIPT

NODE_PATH="$REPO/node_modules" \
  node --import tsx/esm \
    /tmp/prisma-next-qa-2614/sqlite-post-close-error.mts 2>&1
echo "Exit code: $?"
```

### What you should see

- Output: `Caught error message: "SQLite client is closed"` followed by `PASS:` line.
- Exit code 0.

### Failure modes

- Message is wrapped or different: ORM layer is modifying the error.
- No error thrown.

### Restore

```bash
rm -f /tmp/prisma-next-qa-2614/sqlite-post-close-error.mts /tmp/prisma-next-qa-2614/post-close-test.db
git status --short
```

---

## Scenario 6 — Mongo ownership rule — `{ url }` vs `{ mongoClient }` (judgement)

**What you're proving from the user's seat:** The Mongo behaviour change (silent fix: `close()` no longer closes a caller-supplied `MongoClient`) is: (a) implemented correctly per unit tests, (b) called out in the release notes in the commit body, and (c) the commit body says something a user upgrading would find useful. This is a judgement scenario: unit tests verify the mechanism; a human verifies the communication and the boundary.

**Covers:** AC-Ownership, AC-Mongo-behaviour

**Oracle:** The `feat(mongo)` commit body contains an explicit behaviour-change note; the mongo close unit tests in `mongo.test.ts` cover both the `{ url }` (facade-owns) and `{ mongoClient }` (caller-owns) shapes.

**Preconditions:**
- None; this is a document/code read.

### Steps

```bash
# 1. Find the mongo behaviour commit and read its body
git log --oneline origin/main..HEAD -- packages/3-extensions/mongo/

# 2. Read the full commit body for the mongo commit
git show f12e0eb23 --stat --format="%B"

# 3. Check the mongo unit tests for ownership-rule coverage
grep -n 'caller-supplied\|mongoClient\|{ url }' packages/3-extensions/mongo/test/mongo.test.ts | head -20
```

### What you should see

1. The `feat(mongo)` commit (`f12e0eb23`) body mentions the behaviour change: "Mongo's previous `close()` unconditionally called `runtime.close()` even when `mongoClient` was caller-supplied; the corrected behaviour honours the ownership rule."
2. `mongo.test.ts` has tests for: `close()` releases facade-constructed driver (url shape), `close()` does NOT touch a caller-supplied `mongoClient`.
3. The commit body is human-readable — a maintainer reading the changelog would understand the upgrade impact.

### Failure modes

- Commit body omits the behaviour change note: downstream users won't see the upgrade guidance.
- `mongo.test.ts` lacks coverage for one of the two shapes.
- Commit body is too terse to be actionable for an upgrading user.

### Restore

No state mutation; no restore needed.

---

## Scenario 7 — Skill replay — hang-script routing (judgement)

**What you're proving from the user's seat:** An agent picking up `prisma-next-debug` and receiving the symptom "my script hangs after queries finish" or "script won't exit" is routed correctly to `prisma-next-runtime` § *Running as a script (teardown)*. This is Gap 4 from the brief: unit tests don't cover skill content.

**Covers:** AC-Skills

**Oracle:** `prisma-next-debug`'s routing table contains a row for "Script hangs after queries print" and routes to `prisma-next-runtime § Running as a script (teardown)`. The section in `prisma-next-runtime` exists, is non-empty, and contains `await db.close()` and the `await using` example.

**Preconditions:**
- Skills exist at `skills/prisma-next-debug/SKILL.md` and `skills/prisma-next-runtime/SKILL.md`.

### Steps

```bash
# 1. Verify the debug skill routing table
grep -A 3 'Script hangs\|script won.t exit\|db.end' skills/prisma-next-debug/SKILL.md

# 2. Verify the runtime skill has the teardown section
grep -n 'Running as a script\|teardown\|await db.close' skills/prisma-next-runtime/SKILL.md | head -20

# 3. Read the teardown section in full (the runner reads it as a fresh developer would)
sed -n '/Running as a script/,/^## /p' skills/prisma-next-runtime/SKILL.md | head -60
```

### What you should see

1. `prisma-next-debug` routing table has rows for `"Script hangs after queries print / process won't exit"` and `TypeError: db.end is not a function`, both pointing to `prisma-next-runtime § Running as a script (teardown)`.
2. `prisma-next-runtime` has a section titled `## Workflow — Running as a script (teardown)` (or similar).
3. That section contains: `await db.close()`, `await using db`, an example code block, and the DON'T block for request handlers.
4. Reading the section as a developer who just hit the hang: the guidance is clear, actionable, and explains _why_ the hang happens.

### Failure modes

- Debug skill routing table is missing the hang/db.end rows.
- Runtime skill teardown section is absent or empty.
- Teardown section lacks the `await using` example.
- Section doesn't explain why the hang happens (not actionable enough for a developer debugging a hang).

### Restore

No state mutation; no restore needed.

---

## Scenario 8 — Skill replay — per-request `await using` anti-pattern (judgement)

**What you're proving from the user's seat:** The `prisma-next-runtime` skill's DON'T block is present, clear, and discourages the per-request `await using` pattern — the footgun where `await using db = postgres(...)` inside a request handler closes the pool after every request. This was added by commit `c33b65ffc`. An agent following the skill must reach the DON'T block when advising on "can I use `await using` in my Fastify handler?"

**Covers:** AC-Skills

**Oracle:** The skill contains a clearly demarcated "DO NOT do this" block for the request-handler `await using` anti-pattern, followed by the correct server pattern (module-level singleton). Both blocks have code examples.

**Preconditions:**
- `skills/prisma-next-runtime/SKILL.md` exists.

### Steps

```bash
# 1. Check for the anti-pattern block
grep -n 'DO NOT\|request handler\|block-scoped\|per-request\|handler' skills/prisma-next-runtime/SKILL.md | head -20

# 2. Read the anti-pattern block in context
sed -n '/await using.*block-scoped\|DO NOT do this/,/^### /p' skills/prisma-next-runtime/SKILL.md | head -40
```

### What you should see

1. A comment or block saying "DO NOT do this — closes the pool after every request" (or equivalent) with a code example of the anti-pattern.
2. Immediately followed by the correct pattern: a module-level singleton in `db.ts`, imported by handlers.
3. A note explaining _why_ this is wrong: `await using` is block-scoped; inside a handler, the block exits after each request, tearing down and rebuilding the pool per request.
4. The section is under the teardown workflow, not buried in an unrelated heading.

### Failure modes

- DON'T block is absent: skill may teach the anti-pattern by omission.
- DON'T block exists but has no code example: a developer may not understand what "don't do this" refers to.
- DON'T block exists but is after the positive example without sufficient emphasis: easy to miss.
- Explanation of _why_ it's wrong is absent: developer may dismiss the warning.

### Restore

No state mutation; no restore needed.

---

## Scenario 9 — Exploratory: close surface edge-case probing

**Charter.** Explore the `close()` and `[Symbol.asyncDispose]` surface across all three facades for 20 minutes; discover any behaviour that surprises you, any diagnostic that reads poorly, any state combination the scripted scenarios skipped. Focus on: interactions between close() and concurrent usage patterns, error message format variations, any discrepancy between what the skill promises and what the code delivers.

**Covers:** (no specific AC; surfaces unknowns)

**Time budget:** 20 minutes. Stop when the timer rings even if you have ideas left — log them as candidate scenarios in the run report's Suggested follow-ups section.

**Notes capture:** Write what you tried, what surprised you, and anything that "felt off" but you can't yet name. Findings get classified in the run report the same way scripted-scenario findings do.

---

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC-Surface (`close()` and `[Symbol.asyncDispose]` declared on all three clients) | CI unit tests in `postgres-close.test.ts`, `sqlite-close.test.ts`, `mongo.test.ts` cover this structurally. Re-checking here adds nothing. |
| AC-Lifecycle (idempotence, in-flight connect) | Fully covered by unit tests with mocked pools. The behaviour is deterministic; no human judgement adds value. |
| AC-Terminal (`db.connect()`, `db.transaction()`, `db.prepare()` reject after close) | Unit tests cover `runtime()` and `connect()`. `transaction()` and `prepare()` both call `runtime()` internally so they inherit the guard; re-running this in a QA script would re-run unit-test mechanics. `db.runtime()` post-close is the representative path (Scenarios 4 and 5). |
| Mongo real-script hang→exit | Mongo's event-loop story differs from Postgres: `MongoClient` from `{ url }` connects lazily, and the driver `close()` wraps the mongo driver's native close. A real MongoMemoryReplSet end-to-end would be valuable but requires a multi-second replica set spin-up. The unit-test coverage of the ownership rule plus the e2e test close() calls (already in `mongo.e2e.test.ts` cleanup paths) provide sufficient confidence; escalate to CI e2e if unit tests disagree. |
| `await using` for Postgres at top level | Scenario 3 proves the mechanism end-to-end with SQLite (cheapest substrate). The `[Symbol.asyncDispose]` aliasing is identical across all three facades (`return this.close()`); the TS/tsx transpilation path is the same. Running the same scenario against Postgres would add no new information. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC-Quickstart-exit (real-script exits cleanly) | 1 (Postgres), 2 (SQLite), 3 (await using) |
| AC-Terminal (post-close rejects with target-named error) | 4 (Postgres), 5 (SQLite) |
| AC-Ownership (caller-supplied resources not touched) | 6 (Mongo — judgement) |
| AC-Mongo-behaviour (close() no longer closes caller-supplied MongoClient) | 6 (Mongo — judgement) |
| AC-Skills (skills teach pattern, route db.end confabulation) | 7 (debug routing), 8 (anti-pattern DON'T block) |
| AC-Surface | (CI; unit tests) — see "Scenarios deliberately not in this script" |
| AC-Lifecycle | (CI; unit tests) — see "Scenarios deliberately not in this script" |
