# Manual QA — TML-2994 (BetterAuth extension: managed space, adapter, example)

> **Be the user.** This script drives the shipped BetterAuth extension the way its two consumer audiences would (see `drive/calibration/patterns.md § Consumer audiences`):
>
> - **(a) An app developer (end user)** who opens `examples/better-auth/README.md` and follows it verbatim — three-step schema flow, run the server, sign up with curl, make an authenticated request — including the mistakes a real user makes (wrong password, no cookie, copy-paste of every command exactly as printed).
> - **(b) An extension author** who reads `packages/3-extensions/better-auth/README.md` and the amended ADR 212 (managed table-DDL spaces) as the *precedent* for their own extension — docs-fidelity QA: do the docs actually teach what the code does (two-views architecture, three-step flow, error postures)? _(ADR 231 was removed from the PR by operator decision, 2026-07-13; adapter-contract claims are now checked against the package README only.)_
>
> **Out of scope of this script.** Do not re-run `pnpm test:packages` / `pnpm test:integration` / `pnpm typecheck` / `pnpm lint:deps` / the BetterAuth conformance suite — CI owns those (see "Scenarios deliberately not in this script"). Do not modify any tracked file; do not commit; do not run destructive git commands.
>
> **Spec:** `projects/extension-better-auth/spec.md`
> **Plan:** `projects/extension-better-auth/plan.md`
> **PR:** branch `tml-2994-better-auth-extension` (single-PR slice, TML-2994)

## Acceptance criteria under test

The spec's Project DoD, numbered for the coverage map (team-DoD floor items excluded — CI territory):

- **AC-1** — `@prisma-next/extension-better-auth` exists at `packages/3-extensions/better-auth/` with `/pack`, `/contract`, `/adapter` subpaths; `pnpm build` and `pnpm lint:deps` clean.
- **AC-2** — BetterAuth's official adapter conformance suite (incl. join coverage) passes over PGlite in `pnpm test:integration`.
- **AC-3** — An integration test drives `betterAuth()` itself (sign-up → session) through the adapter against PGlite.
- **AC-4** — On a fresh database, `contract emit` + `db init` create the four tables from the space's shipped migration, and `db update` is a no-op at head (managed extension-space path proven).
- **AC-5** — `examples/better-auth` runs end-to-end (emit → db init → sign-up → authenticated request) with a README documenting the flow; a cross-space FK from an app model onto the `better-auth` `User` is demonstrated.
- **AC-6** — Extension-authoring docs/skill references name this package as the managed-space (DDL-shipping) precedent.

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | -------- | -------------- | --------- | ------ |
| 1 | Stand up the schema with the README's three-step flow | A user following the README verbatim reaches a fully-migrated database; re-running committed steps is the documented no-op | workspace | AC-4, AC-5 |
| 2 | Run the server, sign up, make the authenticated request | The README's "Run it" section works copy-paste to an authenticated `/api/me` response | workspace | AC-5 |
| 3 | Probe the failure postures a real user hits **(judgement)** | Wrong password, no cookie, duplicate sign-up produce legible, honest errors over the live HTTP surface | workspace | AC-5 |
| 4 | Prove the managed space is quiescent at head | `db update` is a no-op on an initialized database; re-running emit/plan leaves the tree clean | workspace | AC-4 |
| 5 | Read the extension-author docs against the code **(judgement)** | Package README, amended ADR 212, and subsystem doc 6 teach what the code actually does | read-only | AC-6, AC-5 |
| 6 | Construct the aggregate client without the runtime descriptor **(negative control)** | The documented "Contract requires extension pack 'better-auth'" rejection fires with the promised copy | tmpdir | AC-5, AC-6 |
| 7 | Configure `additionalFields` like BetterAuth's own docs suggest **(negative control, judgement)** | The adapter's `UNKNOWN_FIELD` fail-fast posture is what a real consumer actually experiences | workspace | AC-5 |
| 8 | Exploratory: probe the example's HTTP + CLI surface beyond the script **(exploratory)** | Surfaces unknown unknowns in the consumer journey | workspace | (no AC; charter) |

> Scenarios marked **(negative control)** plant a violation, observe the gate fire, then restore. Scenarios marked **(judgement)** require runner evaluation against an explicit oracle no test can easily assert. Scenario 8 is a time-boxed charter with no scripted steps.
>
> The **Isolation** column tells the runner how to schedule scenarios in parallel — but see the pre-flight note below: `workspace` scenarios in *this* script run in the live checkout, not a fresh worktree.

## Pre-flight

> **Isolation-tag deviation (deliberate, script-author decision).** The repo is a pnpm workspace whose CLI (`prisma-next`), extension dist, and example `node_modules` exist only after `pnpm install && pnpm build` (~tens of minutes in a bare worktree). Allocating a fresh `git worktree` per `workspace` scenario is therefore not viable. Instead, `workspace`-tagged scenarios run **in the live checkout from `examples/better-auth/`**, under these compensating controls:
>
> 1. Every command a scenario runs against the tree is one the README documents as a no-op on committed files, **or** writes only to `$PN_QA_TMP` / an ephemeral dev database.
> 2. The runner captures `git status --short` (scoped to `examples/` and `packages/`) **before and after every workspace scenario**. Any delta on tracked files = a finding, and the runner restores only the paths the scenario itself dirtied.
> 3. All databases are disposable `@prisma/dev` instances (the same substrate the example's own integration test uses in place of the user's Postgres); no state outlives the run.

1. Confirm baseline: from the repo root run `git --no-optional-locks status --short -- examples/ packages/` — expect empty output — and record `git rev-parse HEAD` and `git branch --show-current` (expect `tml-2994-better-auth-extension`).
2. Confirm toolchain: `node -v` satisfies the root `package.json` `engines.node` (>= 24); `pnpm -v` succeeds.
3. Confirm the workspace is built (a user of this branch has run `pnpm install && pnpm build`): `ls packages/3-extensions/better-auth/dist/pack.mjs` and `cd examples/better-auth && pnpm exec prisma-next --help` both succeed.
4. Create the scratch area: `export PN_QA_TMP="$(mktemp -d /tmp/pn-qa-better-auth.XXXXXX)"`.
5. Start dev database **db1** (used by scenarios 1–4 and 7). From `examples/better-auth/`:

   ```bash
   nohup node --input-type=module -e "
   const { createDevDatabase } = await import('@prisma-next/test-utils');
   const { writeFileSync } = await import('node:fs');
   const db = await createDevDatabase();
   writeFileSync(process.env.PN_QA_TMP + '/db1.url', db.connectionString);
   console.log('dev db up:', db.connectionString);
   await new Promise(() => {});
   " > "$PN_QA_TMP/db1.log" 2>&1 &
   echo $! > "$PN_QA_TMP/db1.pid"
   # wait for $PN_QA_TMP/db1.url to appear, then:
   cat "$PN_QA_TMP/db1.url"
   ```

6. Confirm ports: nothing listens on `:3000` (`lsof -nP -iTCP:3000 -sTCP:LISTEN` prints nothing).
7. End-of-run teardown (after all scenarios): kill the server and db processes (`kill $(cat "$PN_QA_TMP"/*.pid)`), `rm -rf "$PN_QA_TMP"`, and re-run the step-1 `git status` to confirm the tree is byte-identical.

## Scenario 1 — Stand up the schema with the README's three-step flow

**What you're proving from the user's seat:** An app developer clones the repo, opens `examples/better-auth/README.md`, and runs the "Schema flow (three steps)" commands *exactly as printed*. This is the end-to-end developer-journey smoke (litmus answer 4) plus copy-paste fidelity of every command (answer 5): CI's integration test drives the same machinery through `execFile`, but nobody in CI has ever pasted the README's actual command lines into a shell, watched the CLI's human-facing output, or checked that "re-running them is a no-op" holds for the tree a user sits in.

**Covers:** AC-4, AC-5

**Isolation:** `workspace` (live checkout; see pre-flight deviation note)

**Oracle:** The README's own claims: "The committed artifacts are the outputs of these steps — re-running them is a no-op"; the spec's AC-4 ("on a fresh database, `contract emit` + `db init` create the four tables from the space's shipped migration"); the committed artifacts under `examples/better-auth/migrations/` and `src/prisma/contract.{json,d.ts}` as byte-level comparison standard (via `git status`).

**Preconditions:**

- Pre-flight complete; `$PN_QA_TMP/db1.url` exists; db1 is a *fresh* database (no prior scenario ran DDL against it).
- Working directory `examples/better-auth/`.

### Steps

1. `git --no-optional-locks status --short -- .` (from `examples/better-auth/`) — record (expect empty).
2. README step 1, verbatim: `pnpm exec prisma-next contract emit`
3. README step 2, verbatim: `pnpm exec prisma-next migration plan --name init`
4. README step 3, verbatim modulo the URL placeholder: `DATABASE_URL="$(cat "$PN_QA_TMP/db1.url")" pnpm exec prisma-next db init`
5. Inspect the database — from `examples/better-auth/`:

   ```bash
   DATABASE_URL="$(cat "$PN_QA_TMP/db1.url")" node --input-type=module -e "
   const pg = (await import('pg')).default;
   const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
   await c.connect();
   const t = await c.query(\"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\");
   console.log('tables:', t.rows.map(r => r.tablename).join(', '));
   const fk = await c.query(\"SELECT confrel.relname AS ref, con.confdeltype::text AS del FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_class confrel ON confrel.oid=con.confrelid WHERE rel.relname='profile' AND con.contype='f'\");
   console.log('profile FKs:', JSON.stringify(fk.rows));
   await c.end();
   "
   ```

6. `git --no-optional-locks status --short -- .` again — record.

### What you should see

- Step 2 and step 3 exit 0 and their human-facing output *says* it did nothing new (the runner is looking at the CLI's no-op messaging: does it clearly tell the user the committed contract/migrations are already current, or does it look like something happened?).
- Step 4 exits 0 and its output names **both** spaces being walked (the app space and the seeded `better-auth` space) — the managed-space story made visible to the user.
- Step 5 prints `tables: account, profile, session, user, verification` (plus any framework marker tables — note what they're called) and one profile FK row `{"ref":"user","del":"c"}` (cascade onto `"public"."user"(id)`).
- Steps 1 and 6 print identical (empty) `git status` output — the documented no-op holds byte-for-byte.

### Failure modes (anything matching these = a finding the runner will classify)

- Any of the three README commands exits non-zero, or requires an undocumented flag/env var to succeed.
- `git status` shows a tracked file modified or a new untracked path after steps 2–3 (README's no-op claim broken).
- The four auth tables or the `profile` table are missing, or the FK is absent / not cascading.
- CLI output is misleading or illegible at any step (e.g. a no-op that reads like a change, an error that doesn't name the space/migration involved).

### Restore (if scenario mutates state)

Tracked tree: nothing to restore if the no-op claim holds; if `git status` showed dirt, capture it as a finding artefact first, then `git restore <exact paths>` / delete only the untracked paths this scenario created. Database db1 is intentionally left initialized — scenarios 2, 3, 4, 7 depend on it. Paste the final `git status --short -- .` output as evidence.

## Scenario 2 — Run the server, sign up, make the authenticated request

**What you're proving from the user's seat:** The README's "Run it" section, verbatim: start the server, sign up with the printed curl command, extract the `set-cookie` value by hand (as the README instructs), and call `/api/me`. Journey smoke (litmus answer 4) + judgement of what the first-run experience actually looks like — CI drives the same endpoints programmatically on an ephemeral port with a pre-created profile row; it never sees the README's port-3000 path, the printed startup banner, or what `/api/me` returns for a user who *hasn't* created a profile row (the README's fine print says app code creates it).

**Covers:** AC-5

**Isolation:** `workspace` (live checkout; server process + db1)

**Oracle:** `examples/better-auth/README.md` "Run it" section (commands and its claim that the response "carries the session … and the profile with its user"); `src/main.ts`'s startup banner; `src/server.ts`'s documented response shape (`{ session, profile }`, profile nullable).

**Preconditions:**

- Scenario 1 completed (db1 is initialized to head).
- Port 3000 free.

### Steps

1. From `examples/better-auth/`, README verbatim modulo the URL placeholder, in the background:

   ```bash
   nohup env DATABASE_URL="$(cat "$PN_QA_TMP/db1.url")" pnpm exec tsx src/main.ts > "$PN_QA_TMP/server.log" 2>&1 &
   echo $! > "$PN_QA_TMP/server.pid"
   sleep 3 && cat "$PN_QA_TMP/server.log"
   ```

2. Sign up — README verbatim:

   ```bash
   curl -i -X POST http://localhost:3000/api/auth/sign-up/email \
     -H 'content-type: application/json' \
     -d '{"email":"ada@example.com","password":"correct-horse-battery-staple","name":"Ada Lovelace"}'
   ```

3. Take the `set-cookie` value from the response (as the README instructs — note *how much* manual surgery this takes) and make the authenticated request — README verbatim:

   ```bash
   curl -i http://localhost:3000/api/me -H 'cookie: <set-cookie value>'
   ```

4. Leave the server running (scenario 3 uses it).

### What you should see

- Step 1's log shows the documented banner: `listening on http://localhost:3000` plus the two endpoint lines — and no warnings/errors before it.
- Step 2 returns HTTP 200 with a JSON body containing `user.id`, and a `set-cookie` header carrying a session token.
- Step 3 returns HTTP 200 with `session.userId` matching the signed-up user. **Look hard at `profile`:** with no app-created profile row it should be `null` — judge whether the README's "The response carries the session … and the profile with its user" prepared you for that, or whether a first-time user would think the example is broken.

### Failure modes

- Server fails to start, crashes on first request, or logs an unexplained warning a user would have to triage.
- Sign-up returns non-200, or no usable `set-cookie` arrives.
- `/api/me` with a valid cookie returns non-200, or a response shape diverging from `server.ts`'s documented `{ session, profile }`.
- The README's cookie-extraction instruction cannot be followed as written (e.g. multiple set-cookie headers, encoding surprises).

### Restore

Server intentionally left running for scenario 3. No tracked-file mutation expected; paste `git status --short -- .` evidence anyway.

## Scenario 3 — Probe the failure postures a real user hits

**What you're proving from the user's seat:** Negative probes CI skips, judged over the live HTTP surface (litmus answers 3 + 4): a wrong-password sign-in, an unauthenticated `/api/me`, and a duplicate sign-up. CI's example test covers the unauthenticated 401 status code only — nobody has judged the *bodies*: are they legible JSON a frontend could show, do they leak internals, is the wrong-password rejection distinguishable from a server fault?

**Covers:** AC-5

**Isolation:** `workspace` (shares scenario 2's server)

**Oracle:** `src/server.ts`'s documented 401 posture (`{"error":"not authenticated"}`); BetterAuth's own documented error semantics for bad credentials / existing user (401 `INVALID_EMAIL_OR_PASSWORD`, 422 `USER_ALREADY_EXISTS`); general judgement standard: every rejection is JSON with an actionable message, never a stack trace or HTML.

**Preconditions:**

- Scenario 2 completed (server on :3000; `ada@example.com` exists with the README password).

### Steps

1. Unauthenticated request: `curl -i http://localhost:3000/api/me`
2. Wrong-password sign-in:

   ```bash
   curl -i -X POST http://localhost:3000/api/auth/sign-in/email \
     -H 'content-type: application/json' \
     -d '{"email":"ada@example.com","password":"wrong-password-entirely"}'
   ```

3. Correct-password sign-in (control — proves step 2 failed for the right reason):

   ```bash
   curl -i -X POST http://localhost:3000/api/auth/sign-in/email \
     -H 'content-type: application/json' \
     -d '{"email":"ada@example.com","password":"correct-horse-battery-staple"}'
   ```

4. Duplicate sign-up (re-run scenario 2's exact sign-up curl).
5. Check `$PN_QA_TMP/server.log` for anything the failures printed server-side.

### What you should see

- Step 1: HTTP 401, body exactly `{"error":"not authenticated"}` (the code's documented copy).
- Step 2: HTTP 401 with a JSON body naming invalid credentials — and **not** revealing whether the email exists vs the password being wrong beyond BetterAuth's standard posture; no adapter internals (`PrismaNextAdapterError`, SQL, stack frames) leaking through.
- Step 3: HTTP 200 with a fresh `set-cookie` — the control passes.
- Step 4: a 4xx (BetterAuth documents 422 `USER_ALREADY_EXISTS`) with a legible JSON body; critically **not** a raw database unique-constraint error escaping through the adapter (`user.email` is unique in the space contract — this probes that BetterAuth checks-first rather than the contract constraint being the thing the user sees).
- Step 5: server log free of unhandled-rejection noise for any of the above.

### Failure modes

- Any probe returns 5xx, HTML, an empty body, or a stack trace.
- A raw postgres/contract constraint violation surfaces to the HTTP client for the duplicate sign-up.
- Wrong-password and unauthenticated cases are indistinguishable from server faults (wrong status class, no message).
- Server log shows crashes or unhandled rejections triggered by the probes.

### Restore

Stop the server: `kill $(cat "$PN_QA_TMP/server.pid")`. Paste `git status --short -- .` evidence (expect clean). db1 retains ada's user/session rows — acceptable for scenarios 4 and 7 (they tolerate existing data; scenario 7 uses a different email).

## Scenario 4 — Prove the managed space is quiescent at head

**What you're proving from the user's seat:** The other half of AC-4 that CI's example test explicitly does *not* re-run: on an already-initialized database, `db update` is a no-op at head for **both** spaces — the managed-space lifecycle promise of amended ADR 212 ("`db init` walks the space to head, `db update` is a no-op at head") observed through the CLI a user would actually run, with judgement on whether its output *communicates* the no-op (litmus answers 3 + 4).

**Covers:** AC-4

**Isolation:** `workspace` (live checkout; db1)

**Oracle:** Spec AC-4 / amended ADR 212 § "A managed space may ship application-visible table DDL"; the package README's schema-flow step 3 ("walks BOTH spaces to head"); `git status` for tree neutrality.

**Preconditions:**

- Scenario 1 completed (db1 at head). Scenario 3's data rows are fine — schema state is what's probed.

### Steps

1. From `examples/better-auth/`: `DATABASE_URL="$(cat "$PN_QA_TMP/db1.url")" pnpm exec prisma-next db update`
2. Run it a second time (a nervous user double-checks): same command.
3. `git --no-optional-locks status --short -- .` — record.

### What you should see

- Both invocations exit 0 and *say* there is nothing to apply — for the app space **and** the `better-auth` space (the runner is looking at whether the no-op message names the spaces or leaves the user guessing).
- No migration directories, refs, or pinned-contract files change on disk (step 3 empty).

### Failure modes

- `db update` at head applies something, errors, or exits non-zero.
- Output is ambiguous about whether the database changed (a no-op that reads like an apply, or vice versa).
- Tracked files under `examples/better-auth/migrations/` change (pinned-mirror rewrite drift — ADR 212 says the framework owns those files; at head they must be byte-stable).

### Restore

Nothing to restore if clean; otherwise capture artefacts, then `git restore` exactly the dirtied paths. Paste the `git status` evidence.

## Scenario 5 — Read the extension-author docs against the code

**What you're proving from the user's seat:** An extension author planning "the next BetterAuth" (Auth.js, a job queue) reads the durable docs and trusts them as the managed-space precedent. Human read of durable docs for coherence and currency (litmus answer 5): every checkable claim in the docs is compared against the shipped code — CI has no test for "the README teaches the truth".

**Covers:** AC-6, AC-5 (README fidelity half)

**Isolation:** `read-only`

**Oracle:** The shipped source is ground truth; the docs under test are `packages/3-extensions/better-auth/README.md`, `docs/architecture docs/adrs/ADR 212 - Contract spaces.md` (§ Amendment), `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md`, and `.agents/rules/contract-space-package-layout.mdc`.

**Preconditions:** none (fully parallel).

### Steps

1. **Two-views architecture:** compare the package README's "two-views" code block against `examples/better-auth/src/prisma/db.ts` — same construction options (`extensions: [betterAuthRuntimeDescriptor]`, `verifyMarker: false`, shared `Pool`), same rationale (marker names the aggregate; cross-space relations typed `never` / not `include()`-able).
2. **Config key:** the README says "List it in `prisma-next.config.ts` `extensionPacks`" — check against `examples/better-auth/prisma-next.config.ts` and `packages/3-extensions/postgres/src/config/define-config.ts` (what key does the worked example's `defineConfig` actually accept?).
3. **Error posture table:** compare the README's error-code list against `packages/3-extensions/better-auth/src/adapter/errors.ts` (codes, and whether each message names the offending surface as promised).
4. **Three-step flow:** compare the package README's "Schema flow in a consuming app" commands against the example README's three steps and against what scenario 1 actually ran (note: the package README prints bare `prisma-next …` — is that runnable in a consuming app as printed?).
5. **The README's adapter-contract claims:** for each (typed model map; codec crossing via collections; fail-fast errors; native join + transaction rebinding; two-views consumption), find the implementing code (`model-map.ts` `satisfies` bound; `errors.ts`; `join.ts` + `adapter/index.ts`; the example) — flag any claim the code doesn't actually meet or the README overstates.
6. **Amended ADR 212 + precedent naming:** confirm the `src/contract/` grouped layout described in the amendment matches the package's actual tree; confirm subsystem doc 6 and the layout rule name `better-auth` as the managed-space (table-DDL) precedent; spot-check `scripts/regen-extension-migrations.mjs` resolves both layouts as the amendment claims. Follow every relative link in the docs under test and note any that 404.
7. **Development section:** confirm `pnpm build:contract-space` exists in the package's `package.json` and `test/contract-handles.test.ts` exists as the README's claimed drift tripwire.

### What you should see

- Every checkable claim resolves to real code with matching behaviour/copy; links resolve; the reading order (README → ADR 212 § Amendment) tells one coherent story an extension author could follow to build the next adapter without reading the framework source.

### Failure modes

- A doc claim contradicts the code (wrong config key, wrong error code, wrong file path, wrong command).
- A promised artefact (script, test, subpath) doesn't exist under the documented name.
- Broken/unresolvable doc links; docs that assume knowledge the named audience doesn't have.

## Scenario 6 — Construct the aggregate client without the runtime descriptor (negative control)

**What you're proving from the user's seat:** The package README and `db.ts` both promise a specific guardrail: constructing `postgres<Contract>()` over the aggregate *without* the pack's `/runtime` descriptor is rejected with `"Contract requires extension pack 'better-auth'"`. Plant that exact violation and observe the gate fire with the documented copy (litmus answer 2). **Coverage boundary:** this proves the missing-descriptor rejection for this one pack on this one contract — it does not prove every requirement-check path (multiple packs, wrong-target descriptors) rejects correctly.

**Covers:** AC-5, AC-6 (documented error copy)

**Isolation:** `tmpdir` (writes nothing; reads the example's committed artifacts; no database contact expected)

**Oracle:** The literal message documented in `packages/3-extensions/better-auth/README.md` and `examples/better-auth/src/prisma/db.ts` ("Contract requires extension pack 'better-auth'"), against the framework's actual throw in `packages/1-framework/1-core/framework-components/src/execution/execution-requirements.ts`.

**Preconditions:** none (parallel-safe; uses a dead connection string — the rejection must fire before any I/O).

### Steps

1. From `examples/better-auth/` (module resolution only; nothing is written):

   ```bash
   node --input-type=module -e "
   const postgres = (await import('@prisma-next/postgres/runtime')).default;
   const pg = (await import('pg')).default;
   const contractJson = (await import('./src/prisma/contract.json', { with: { type: 'json' } })).default;
   const pool = new pg.Pool({ connectionString: 'postgres://nobody:nope@127.0.0.1:1/nothing' });
   try {
     postgres({ contractJson, pg: pool });
     console.log('GATE DID NOT FIRE — client constructed without the descriptor');
   } catch (err) {
     console.log('name:', err.name);
     console.log('message:', err.message);
   } finally { await pool.end(); }
   "
   ```

2. Re-run the same eval with `extensions: [(await import('@prisma-next/extension-better-auth/runtime')).default]` added to the options (restore side of the control) — construction should now succeed without touching the dead pool.

### What you should see

- Step 1: the catch branch prints an error whose message contains `requires extension pack` and names `better-auth` — compare word-for-word against the README's promised copy and judge actionability (does it tell the user *what to pass where*?).
- Step 2: no throw (`GATE DID NOT FIRE` must not print in step 1; construction must succeed in step 2) — proving the failure in step 1 was the planted violation, not collateral breakage.

### Failure modes

- Construction succeeds without the descriptor (gate absent) — per the run skill, a failed negative control.
- The rejection fires but with copy that doesn't name the pack or diverges materially from the documented message.
- The rejection is deferred to first query / connection instead of construction (user learns at runtime in production).

### Restore

Nothing mutated (dead connection string, no writes). No restore beyond process exit.

## Scenario 7 — Configure `additionalFields` like BetterAuth's own docs suggest (negative control)

**What you're proving from the user's seat:** BetterAuth's documentation actively encourages `user.additionalFields`; the spec declares it a non-goal that must "fail fast with a typed adapter error naming the unsupported surface". Plant the violation a real consumer is *most likely* to plant, and judge the failure from the app developer's programmatic seat (litmus answers 2 + 3). CI's adapter tests assert the `UNKNOWN_FIELD` error class directly; nobody has observed what a consumer actually sees when the rejection travels up through `betterAuth()`'s sign-up flow. **Coverage boundary:** proves the `UNKNOWN_FIELD` gate for one extra field on `user` during sign-up — not every unsupported surface (plugin tables, renamed models, secondaryStorage).

**Covers:** AC-5 (fail-fast posture per spec non-goals / README error contract)

**Isolation:** `workspace` (module resolution from the example dir; reuses db1; writes no rows if the gate holds)

**Oracle:** `packages/3-extensions/better-auth/src/adapter/errors.ts` `unknownField()` copy ("Unknown field … additionalFields are not supported by this adapter."); README error contract ("rejected *before* any query is built, with an error that names the offending surface").

**Preconditions:**

- Scenario 1 completed (db1 has the auth tables).
- Scenario 3 completed or not running (avoid interleaving sign-ups on db1 while judging logs).

### Steps

1. From `examples/better-auth/`:

   ```bash
   DATABASE_URL="$(cat "$PN_QA_TMP/db1.url")" node --input-type=module -e "
   const postgres = (await import('@prisma-next/postgres/runtime')).default;
   const betterAuthPack = (await import('@prisma-next/extension-better-auth/pack')).default;
   const { prismaNextAdapter } = await import('@prisma-next/extension-better-auth/adapter');
   const { betterAuth } = await import('better-auth');
   const pg = (await import('pg')).default;
   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
   const authDb = postgres({ contractJson: betterAuthPack.contractSpace?.contractJson, pg: pool, verifyMarker: false });
   const auth = betterAuth({
     database: prismaNextAdapter(authDb),
     emailAndPassword: { enabled: true },
     baseURL: 'http://localhost:3000',
     user: { additionalFields: { favoriteColor: { type: 'string' } } },
   });
   try {
     const res = await auth.api.signUpEmail({ body: { email: 'grace@example.com', password: 'correct-horse-battery-staple', name: 'Grace Hopper', favoriteColor: 'blue' } });
     console.log('SIGN-UP SUCCEEDED:', JSON.stringify(res).slice(0, 200));
   } catch (err) {
     console.log('caught:', err.constructor.name);
     console.log('message:', err.message);
     console.log('cause:', err.cause ? String(err.cause).slice(0, 300) : '(none)');
   } finally { await pool.end(); }
   "
   ```

2. Verify the gate prevented the write — check no `grace@example.com` row exists:

   ```bash
   DATABASE_URL="$(cat "$PN_QA_TMP/db1.url")" node --input-type=module -e "
   const pg = (await import('pg')).default;
   const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
   await c.connect();
   const r = await c.query('SELECT count(*)::int AS n FROM \"user\" WHERE email = \$1', ['grace@example.com']);
   console.log('grace rows:', r.rows[0].n);
   await c.end();
   "
   ```

### What you should see

- Step 1: sign-up fails; somewhere in the surfaced error chain the adapter's `UNKNOWN_FIELD` copy is findable and *legible* — the runner judges whether an app developer could diagnose "remove `additionalFields` or drop the field" from what's printed, or whether BetterAuth swallows the typed error into something opaque.
- Step 2: `grace rows: 0` — the rejection fired before any row was written (fail-*fast*, per the README's error contract).

### Failure modes

- Sign-up *succeeds* (the unsupported surface silently persisted or silently dropped the field) — failed negative control.
- A user row (or partial rows in other tables) exists despite the failure — the gate fired late; not atomic.
- The `UNKNOWN_FIELD` diagnostic is unreachable from what the consumer's seat surfaces (fully swallowed).

### Restore

If step 2 shows rows, delete them (`DELETE FROM "user" WHERE email = 'grace@example.com'` — cascades clean up sessions/accounts) and record the fact as part of the finding. No tracked-file mutation; paste `git status --short -- .` evidence.

## Scenario 8 — Exploratory: probe the example's consumer surface beyond the script

**Charter.** Explore the running example (server + CLI + docs) for 20 minutes from both audiences' seats to discover behaviours that surprise you, diagnostics that read poorly, or state combinations the scripted scenarios skipped. Candidate threads (not prescriptive): sign-out and session listing endpoints; malformed JSON bodies; re-running `db init` on an already-initialized database; the `pnpm emit` package-script alias vs the README's `pnpm exec` spelling; deleting a user through `authDb` and watching the profile cascade from the app's seat; whether `examples/better-auth` appears in any examples index/docs listing.

**Covers:** (no specific AC; surfaces unknowns)

**Isolation:** `workspace` (live checkout; db1; may restart the scenario-2 server)

**Time budget:** 20 minutes. Stop when the timer rings; log unexplored ideas as candidate scenarios for a future round.

**Notes capture:** Record what you tried, what surprised you, and anything that "felt off" but you can't yet name. Findings are classified in the report exactly like scripted-scenario findings. End with `git status --short -- examples/ packages/` evidence.

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC-1 | Package existence/build/lint:deps are compile-time and CI gates; `ls`-ing subpaths adds nothing a human can judge. |
| AC-2 | The BetterAuth conformance suite is CI's own regression surface (`pnpm test:integration`); re-running it locally proves only that this machine matches CI. |
| AC-3 | The `betterAuth()` sign-up→session integration test is CI-owned; scenario 2 exercises the *user-visible* equivalent over real HTTP instead. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC-1 | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| AC-2 | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| AC-3 | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| AC-4 | 1, 4 |
| AC-5 | 1, 2, 3, 5, 6, 7 |
| AC-6 | 5, 6 |
