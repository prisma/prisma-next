# Manual QA — TML-2520 (PR2: namespace exemplar + cross-namespace FKs)

> **Be the user.** A schema author adopting multi-schema Postgres for the first time, or a multi-tenancy operator opting into connection-bound late binding, drives the system end-to-end the way the docs would lead them.
>
> **Out of scope of this script.** Re-running `pnpm test:packages` / `pnpm test:integration` / `pnpm typecheck` / `pnpm lint:deps` to "verify CI is green" — CI owns that and re-running it against the clean tree adds nothing. Verifying that pre-existing single-namespace contracts still emit unchanged — covered by the `fixtures:check` gate. Inspecting the `__unbound__` rename diff per file — that's a reviewer concern, not a QA observation.
>
> **Spec:** [`projects/target-extensible-ir/spec.md`](../spec.md) (see Acceptance Criteria § AC4–AC6b, FR13–FR16d)
> **Plan:** [`projects/target-extensible-ir/plan.md`](../plan.md) (PR2 = M5a + M5b + namespace ADRs)
> **PR:** to be opened on branch `tml-2520-pr2-namespace-exemplar-cross-namespace-fk-references-follow`

## What this script is testing

**The change.** PR2 lifts namespace from "implicit single-schema assumption" to a first-class IR concept and unblocks Supabase's `auth.users` story by making cross-namespace FK references first-class within a contract space. The user-facing surfaces it touches are:

- **PSL authoring.** Top-level `namespace <name> { … }` blocks group models into named schemas; cross-namespace FK references use dot-qualified type names in `@relation` (e.g. `user auth.User @relation(fields: [userId], references: [id])`). The `namespace unbound { … }` block opts a model set into Postgres-side connection-bound late binding (resolved via `search_path` at migration time).
- **TS-builder authoring.** `defineContract`'s config gains a top-level `namespaces: ['public', 'auth']` list; `model('User', { namespace: 'auth', … })` carries the namespace coordinate; cross-namespace FK refs come through `rel.belongsTo(OtherModel, …)` / `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` without any new syntax — the model handle carries the coordinate.
- **Emit pipeline.** The `contract.json` `storage` envelope and the `SqlStorage` IR are now nested-by-namespace: `tables: Record<NamespaceId, Record<TableName, StorageTable>>` (and analogously for `types`). The canonical-shape contract is enforced strictly at the `SqlStorage` constructor — extension authors and downstream tools that hand-construct storage shapes get a precise diagnostic if they pass the legacy flat shape.
- **Migration planning + DDL.** Cross-namespace FKs emit qualified DDL (`REFERENCES "auth"."users"("id")`); single-namespace contracts continue to emit qualified DDL for `public` (no behavioural change for single-tenant Postgres users). Named namespaces declared in the contract emit a `CREATE SCHEMA IF NOT EXISTS "<name>"` op ahead of their first table creation. The IR `__unbound__` slot emits unqualified DDL — `REFERENCES "users"("id")` — and lets `search_path` resolve at migration time.
- **SQL builder / ORM / control-adapter.** The SQL AST, builder, ORM call sites, and Postgres introspector all carry the namespace coordinate through; queries against namespaced models route to the right schema; introspection reads from each declared namespace and merges. (This propagation landed late in PR2 — without it the namespace IR worked at emit/plan layers but ORM-issued runtime queries did not.)
- **Per-target rejection diagnostics.** SQLite and Mongo reject explicit `namespace { … }` blocks with a clear, target-named diagnostic that points at the offending block span. Postgres reserves `unbound` as a namespace identifier (the late-binding sentinel mapping consumes it).
- **`examples/prisma-next-demo`** natively uses a two-namespace contract: `User` lives in `namespace auth { … }`; `Post` and `Task` live in the implicit `public` slot; both cross-namespace FKs (`post.userId → auth.user.id`, `task.userId → auth.user.id`) are first-class. This is the live worked example PR2 ships.

**Why manual QA matters here.** Three gaps that CI cannot meaningfully close:

1. **Diagnostic legibility under three distinct failure modes** — SQLite namespace-block rejection, Postgres `unbound` reservation, and the canonical-shape strict throw at the `SqlStorage` constructor each surface in front of a human (extension author, migrator, schema author). Tests assert the diagnostic *fires*; only a human can judge whether the message names the offending input, points at the right span, and tells the reader what to do.
2. **End-to-end emit-and-plan journey for a real multi-schema contract.** Each step (PSL → contract.json, contract.json → migration plan, plan → DDL) has unit coverage in isolation. The thing tests can't easily express is the *sequence* a real user runs (`pnpm emit` → inspect `contract.json` → `pnpm migration generate` → inspect SQL) and whether the artefacts at each step look correct without having to open the next.
3. **Originally-failing flow re-enactment for the canonical-shape strict throw.** The `types[X] is a class-instance entry; expected a namespace bucket` diagnostic exists because the family-sql review surfaced a real failure mode (the example apps' emit pipelines silently producing flat shape, which the constructor now rejects). The strict-throw guardrail must fire on a planted flat-shape input — not just on today's clean tree. The negative-control scenario verifies the guard's gate-ness with explicit coverage boundaries.

## Table of contents

| # | Scenario | What it proves | Covers |
| - | -------- | -------------- | ------ |
| 1 | Inspect the demo's shipped two-namespace artefacts + query through the ORM | The PSL surface (`namespace { … }` blocks, dot-qualified `@relation`) reaches the right IR slots, emits qualified DDL across both namespaces, and queries route correctly through the ORM. | AC4, AC4a (PSL), AC6b |
| 2 | Author a two-namespace contract via the TS builder + emit | The TS surface (`namespaces:`, per-model `namespace`, model-handle cross-namespace FKs) produces an equivalent contract to scenario 1; round-trip preserves both. | AC4a (TS), AC8 (round-trip, observed slice) |
| 3 | Reject `namespace { … }` in SQLite **(negative control)** | The SQLite interpreter refuses explicit namespace blocks with a target-named diagnostic that points at the offending span. | AC5 |
| 4 | Opt into late-binding via `namespace unbound { … }` and observe IR + DDL | The Postgres interpreter maps `unbound` to the IR `__unbound__` slot; the emitted DDL is unqualified at the FK target so `search_path` resolves at migration time. | AC6 |
| 5 | Reject user-declared `namespace unbound` in non-late-binding context **(negative control)** | The reservation of `unbound` for the late-binding sentinel is enforced with a diagnostic that names the reservation rationale, not just the conflict. | AC6a |
| 6 | Canonical-shape strict-throw fires on a planted flat-shape literal **(negative control)** | The `SqlStorage` constructor's strict-shape gate fires with a diagnostic that names the offending bucket key — not silently coerces — when hand-built storage is flat. | (no specific AC; guardrail introduced during the reversal; coverage-boundary statement below) |
| 7 | Exploratory: probe combinations the script didn't enumerate **(exploratory)** | Surface unknown-unknowns in the namespace surface — reopen-merge, multi-file contracts, late-binding × cross-namespace FK, ergonomic surprises. | (no AC; charter) |

> Scenarios marked **(negative control)** plant a violation, observe the gate fire, then restore. Scenarios marked **(exploratory)** are time-boxed charters with no scripted steps. Scenario 4 mutates a real Postgres database (search_path multi-tenancy demo) and is the most setup-intensive of the script.

## Pre-flight

1. **Clean tree baseline.**
   ```bash
   git status
   ```
   Expect: clean (modulo the QA branch's own snapshot files if you've already started a round). If the tree is dirty, stash before starting; finish the round; restore.
2. **Worktree at the PR2 head.**
   ```bash
   git log -1 --oneline
   ```
   Expect: a commit message starting with `TML-2520:` (the most recent canonical-shape enforcement commit, or whatever the PR2 head is).
3. **Build.**
   ```bash
   pnpm build
   ```
   Expect: green. (Required because some scenarios invoke `prisma-next` CLI binaries from `packages/1-framework/3-tooling/cli/dist/`.)
4. **Postgres connection (scenarios 1, 4).** Either:
   - A local Postgres reachable via `DATABASE_URL` in `examples/prisma-next-demo/.env`, **or**
   - PGlite (if the demo is configured to use it — check `examples/prisma-next-demo/prisma-next.config.ts`).
   Scenario 4 specifically requires a real Postgres (PGlite's `search_path` semantics may differ). Skip scenario 4 if no real Postgres is available; report it as Not Run in the report rather than fail.
5. **SQLite scratch dir (scenario 3).** A temp directory you can write a SQLite contract to — anywhere outside the worktree's `examples/` tree is fine.

## Scenario 1 — Inspect the demo's shipped two-namespace artefacts + query through the ORM

**What you're proving from the user's seat:** a schema author opening `examples/prisma-next-demo` to see "how do namespaces work?" finds a real worked example. The PSL form documented in the spec — top-level `namespace { … }` blocks plus dot-qualified `@relation` for cross-namespace FK refs — is the shape on disk. The emitted contract has the expected nested-by-namespace shape and the generated migration emits qualified DDL across both namespaces. Queries through the ORM route to the right schema (the late-PR2 SQL-stack propagation lands here). This is the **end-to-end developer-journey smoke** for AC4 + AC4a (PSL) — the most important scenario in the script.

**Covers:** AC4, AC4a (PSL), AC6b

**Oracle:**
- **PSL on disk.** `examples/prisma-next-demo/src/prisma/contract.prisma` declares `namespace auth { model User { … @@map("user") } }` at top level; `model Post` and `model Task` stay top-level (lowered by the Postgres interpreter to the `public` slot); each has `user auth.User @relation(fields: [userId], references: [id])` (dot-qualified type position).
- **Contract.json shape.** Per FR15, `storage.tables` is a nested map keyed by namespace id: `{ "auth": { "user": { … } }, "public": { "post": { … }, "task": { … }, "bug": { … }, "feature": { … } } }`. The `post` table's FK has `foreignKeys[0].target = { columns: ["id"], namespaceId: "auth", table: "user" }`.
- **Migration ops.** The migration directory under `examples/prisma-next-demo/migrations/app/` contains an `ops.json` whose first op is `{ id: "schema.auth", label: "Create schema \"auth\"", execute: [{ sql: "CREATE SCHEMA IF NOT EXISTS \"auth\"" }] }`; later ops include `CREATE TABLE "auth"."user" (…)` and `ALTER TABLE "public"."post" ADD CONSTRAINT "post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth"."user" ("id")`.
- **ORM routing.** A query against `db.user` (or whatever the demo's repository / SQL DSL surface names it) issues SQL with the `"auth"."user"` qualifier — not unqualified `"user"`, not `"public"."user"`.

**Preconditions:**
- Pre-flight complete.
- A live Postgres reachable via `DATABASE_URL` in `examples/prisma-next-demo/.env` (or PGlite if the demo is configured for it — check `prisma-next.config.ts`). The ORM-query sub-step (step 4 below) needs a real connection; if no DB is available, skip step 4 and mark the ORM-routing oracle as Not Observed.

### Steps

1. Inspect the PSL source:
   ```bash
   cat examples/prisma-next-demo/src/prisma/contract.prisma
   ```
2. Inspect the emitted contract:
   ```bash
   jq '.storage.tables | keys' examples/prisma-next-demo/src/prisma/contract.json
   jq '.storage.tables.public.post.foreignKeys' examples/prisma-next-demo/src/prisma/contract.json
   jq '.storage.tables.auth.user | keys' examples/prisma-next-demo/src/prisma/contract.json
   grep -nE '"auth"|"public"|namespaceId' examples/prisma-next-demo/src/prisma/contract.d.ts | head -20
   ```
3. Inspect the migration:
   ```bash
   ls -t examples/prisma-next-demo/migrations/app/ | head -3
   LATEST=$(ls -t examples/prisma-next-demo/migrations/app/ | head -1)
   jq '.[0]' examples/prisma-next-demo/migrations/app/$LATEST/ops.json
   jq '.[] | select(.id == "table.user" or .id == "table.post") | {id, sql: .execute[0].sql}' examples/prisma-next-demo/migrations/app/$LATEST/ops.json
   jq '.[].execute[]?.sql' examples/prisma-next-demo/migrations/app/$LATEST/ops.json | rg -i 'REFERENCES|FOREIGN'
   ```
4. (Requires DB.) Apply migrations + run the demo's seed + issue a query through the ORM that hits `auth.user`:
   ```bash
   cd examples/prisma-next-demo
   pnpm prisma-next migration apply        # or whatever the demo's apply alias is
   pnpm seed
   pnpm tsx --eval "
     import { db } from './src/prisma/db';
     const users = await db.user.findMany({ take: 1 });
     console.log('Query result:', users);
   "
   ```
   (Capture the SQL the driver emitted by raising the driver's log level if available — `DEBUG=pg:* pnpm tsx …` typically dumps it. The shape you want to see is `SELECT … FROM "auth"."user" …`, not `FROM "user" …`.)
5. (Optional — regeneration reproducibility.) Re-emit + regenerate fixtures to confirm the on-disk artefacts are stable:
   ```bash
   cd examples/prisma-next-demo && pnpm emit && cd -
   pnpm fixtures:check
   git status   # should report clean — re-emit produced identical bytes
   ```

### What you should see

- `contract.prisma` has the `namespace auth { … }` block exactly as documented; both `Post.user` and `Task.user` use the `auth.User` dot-qualified type form.
- `jq '.storage.tables | keys'` prints `["auth", "public"]`.
- `jq '.storage.tables.public.post.foreignKeys'` shows a single FK with `target: { columns: ["id"], namespaceId: "auth", table: "user" }`.
- `contract.d.ts` mentions `"auth"` and `"public"` as namespace id literal types in the storage type definition.
- Migration `ops.json` first op is `CREATE SCHEMA IF NOT EXISTS "auth"`; `table.user` op SQL contains `CREATE TABLE "auth"."user" (…)`; the FK ALTER statements read `ALTER TABLE "public"."post" ADD CONSTRAINT … FOREIGN KEY ("userId") REFERENCES "auth"."user" ("id")` and same for `task`.
- (Step 4) ORM query returns without error; the SQL the driver emits is namespace-qualified (`FROM "auth"."user"`).
- (Step 5) Re-emit produces zero diff; `fixtures:check` is green; `git status` is clean.

### Failure modes

- `contract.json` `storage.tables` is flat (top-level `"user"` / `"post"` keys) — regression in the PSL interpreter's nested-shape emission or the build-contract.ts wrap-under-namespace fix.
- The FK target is missing `namespaceId` or has `namespaceId: "public"` — regression in the cross-namespace reference lowering or the FK reference IR structure (FR16b).
- The migration `ops.json` is missing the `CREATE SCHEMA "auth"` op or doesn't put it before the `auth.user` table creation — regression in the Postgres planner's CREATE-SCHEMA emission (the late-PR2 `issue-planner.ts` fix).
- Migration SQL emits `ALTER TABLE "post"` (unqualified) or `REFERENCES "user"("id")` (unqualified FK target) — regression in the SQL renderer's schema-qualified emission.
- Migration SQL emits `REFERENCES "public"."user"("id")` (wrong schema on FK target) — the cross-namespace coordinate was lost between IR and renderer.
- (Step 4) The ORM query fails with `relation "user" does not exist` or `permission denied for schema public` — the SQL builder / ORM stack's schema propagation regressed; the runtime is issuing unqualified or wrong-schema queries.
- (Step 5) Re-emit produces a non-trivial diff against the committed `contract.json` — emission is non-deterministic or the committed artefact is stale relative to the source.

### Restore

```bash
cd examples/prisma-next-demo
# (Step 4 only, if you applied migrations against a real DB.) Drop the schemas to reset:
psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
cd -
git status
```

Expect: clean tree (no edits to source files; only DB state was mutated, and step 5's re-emit should have produced no diff).

## Scenario 2 — Author a two-namespace contract via the TS builder + emit

**What you're proving from the user's seat:** the TS-builder authoring surface (the alternative to PSL) covers the same multi-schema cases as scenario 1. The model-handle's namespace coordinate makes cross-namespace FK refs work without any new syntax. Round-trip preserves the structure. This is an **end-to-end developer-journey smoke** for AC4a's TS branch, plus an observed slice of AC8.

**Covers:** AC4a (TS), AC8 (round-trip, observed slice)

**Oracle:**
- The contract built via `defineContract({ namespaces: ['public', 'auth'], … })` produces — when emitted — the same `storage.tables` nested shape as scenario 1's PSL version. (Comparable up to ordering and any unavoidable PSL-vs-TS metadata differences.)
- The model handle returned by `model('User', { namespace: 'auth', … })` carries `'auth'` in its public coordinate accessor; an FK declared via `rel.belongsTo(User, { from: 'userId', to: 'id' })` from a `public` model produces a contract.json FK with `target.namespaceId: "auth"`.
- `descriptor.contractSerializer.serializeContract(contract)` followed by `descriptor.contractSerializer.deserializeContract(JSON.parse(JSON.stringify(serialized)))` produces a structurally equivalent contract.

**Preconditions:**
- Pre-flight complete.
- Familiarity with the TS-builder API as documented in the spec § FR16a "TS builder surface" and AC4a "TS builder".
- Locate the existing TS-builder example. Check `examples/` for any contract authored via `defineContract`; if none exists in the repo, the scenario's steps include writing a minimal one inline.

### Steps

1. Locate a TS-builder example or scaffold one. Search:
   ```bash
   rg --files-with-matches 'defineContract\b' examples/ packages/2-sql/2-authoring/contract-ts/test/ | head -5
   ```
2. If an example exists, open and adapt it; if none, create a minimal scratch script at `/tmp/qa-pr2-scenario2.ts`:
   ```typescript
   import { defineContract, model, rel, constraints, cols } from '@prisma-next/postgres/contract-ts';

   const contract = defineContract({
     namespaces: ['public', 'auth'],
     models: ({ model }) => {
       const User = model('User', {
         namespace: 'auth',
         fields: {
           id: cols.text({ primaryKey: true }),
           email: cols.text(),
         },
       });
       const Post = model('Post', {
         namespace: 'public',
         fields: {
           id: cols.text({ primaryKey: true }),
           title: cols.text(),
           userId: cols.text(),
         },
         relations: ({ rel }) => ({
           user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
         }),
       });
       return { User, Post };
     },
   });
   ```
   *(Treat the import paths and helper names as the authoritative shape per the spec / `packages/2-sql/2-authoring/contract-ts/src/*` exports; adjust to the actual export surface if naming has drifted.)*
3. Inspect the in-memory contract:
   ```typescript
   console.log(JSON.stringify(contract.storage.tables, null, 2));
   console.log(User.refs.id.namespaceId); // expect "auth"
   ```
4. Round-trip via the serializer:
   ```typescript
   import { postgresControlTargetDescriptor } from '@prisma-next/postgres/control';
   const serializer = postgresControlTargetDescriptor.contractSerializer;
   const json = serializer.serializeContract(contract);
   const roundtripped = serializer.deserializeContract(JSON.parse(JSON.stringify(json)));
   // Compare roundtripped.storage.tables to contract.storage.tables (deep equality).
   ```
5. Run the script:
   ```bash
   pnpm tsx /tmp/qa-pr2-scenario2.ts
   ```

### What you should see

- `contract.storage.tables` printed in step 3 shows the same nested-by-namespace shape as scenario 1's contract.json: `{ "auth": { "User": { … } }, "public": { "Post": { … } } }` (modulo TS-builder ordering).
- `User.refs.id.namespaceId` prints `"auth"` (not `"public"`, not `undefined`, not `"__unbound__"`).
- The serialize → JSON.stringify → JSON.parse → deserialize round-trip in step 4 produces a structurally equivalent object. (Use `node:assert`'s `deepStrictEqual` on the storage envelope if you want a mechanical check.)
- The script exits 0 with no thrown errors.

### Failure modes

- The TS-builder rejects the `namespaces:` field as unknown / unrecognised — the top-level config schema wasn't extended.
- `model('User', { namespace: 'auth', … })` types `namespace` as `never` or rejects `'auth'` — the per-model namespace field isn't accepting the declared namespaces.
- `User.refs.id.namespaceId` is `undefined` or `"public"` — the model handle didn't carry the namespace coordinate.
- The FK in `Post.relations.user` produces a contract.json entry without `target.namespaceId` or with the wrong value — `rel.belongsTo` isn't auto-lowering to cross-namespace IR.
- The round-trip in step 4 throws ("namespace bucket", "class-instance entry", or similar) — the serializer's deserialize path is incomplete for the nested namespace shape.

### Restore

```bash
rm -f /tmp/qa-pr2-scenario2.ts
git status
```

Expect: clean tree.

## Scenario 3 — Reject `namespace { … }` in SQLite **(negative control)**

**What you're proving from the user's seat:** SQLite users who try to adopt namespace syntax (perhaps copying from a Postgres example) get a clear, target-named diagnostic that names the unsupported feature and points at the offending block — not a low-level parser error or a silent acceptance. This is a **negative control with explicit coverage boundary**.

**Covers:** AC5

**Coverage boundary statement:** This scenario plants exactly one violation kind (a named `namespace foo { … }` block in a SQLite contract) and observes one diagnostic. It does *not* prove the rejection covers every malformed shape (a `namespace { }` empty block, a recursive `namespace a { namespace b { } }`, a `namespace unbound { … }`, etc.) — those are AC6a (Postgres unbound reservation) and AC6b (parser-level rejection of recursive blocks) territory, covered by unit tests or by exploratory scenario 7.

**Oracle:** the diagnostic message contains the string `SQLite` (or `sqlite`), the phrase `namespace blocks` (or equivalent — verify the spec § FR16c "SQLite interpreter" wording for the exact target text), and points at the offending span (a line number or a contract-relative location). Severity surfaces as an emit-time error (exit code non-zero, `"ok": false`); the user does not see a stack trace.

**Preconditions:**
- Pre-flight complete.
- A SQLite-targeting example or scratch contract. Suggested: `examples/prisma-next-demo-sqlite` (if it exists — check via `ls examples/`), or scaffold a minimal scratch contract under `/tmp/qa-pr2-scenario3-sqlite/` with a `prisma-next.config.ts` pointing at SQLite.

### Steps

1. Locate or scaffold a SQLite contract. If `examples/prisma-next-demo-sqlite` exists, copy its `contract.prisma` to a scratch location to mutate:
   ```bash
   cp examples/prisma-next-demo-sqlite/src/prisma/contract.prisma /tmp/qa-pr2-scenario3-sqlite.prisma
   ```
   If no SQLite demo exists, create a minimal scratch contract — see the SQLite-using packages under `packages/3-targets/3-targets/sqlite/test/` for the smallest realistic shape.
2. Mutate the contract to wrap one model in a namespace block:
   ```prisma
   namespace foo {
     model User {
       id String @id
     }
   }
   ```
3. Attempt to emit the contract via the SQLite target:
   ```bash
   cd examples/prisma-next-demo-sqlite && pnpm emit 2>&1 | tee /tmp/qa-pr2-scenario3-diag.txt; cd -
   ```
   (Or run the CLI directly against the scratch contract if you scaffolded one.)
4. Read the diagnostic:
   ```bash
   cat /tmp/qa-pr2-scenario3-diag.txt
   ```

### What you should see

- Emit exits non-zero.
- The diagnostic JSON / formatted output contains the string `SQLite` and a phrase along the lines of "does not support namespace blocks" (verify against spec § FR16c table for the canonical wording).
- The diagnostic identifies the offending block — either by line number, by namespace name, or by `contract.prisma:<lineno>`-style citation.
- The diagnostic does NOT include a JavaScript stack trace, a `TypeError`, or a `Cannot read property` — these indicate the rejection is happening at the wrong layer (e.g. crashed in the verifier instead of being rejected by the SQLite interpreter).

### Failure modes

- Emit succeeds (exit 0) and produces a `contract.json` — the SQLite interpreter is silently accepting namespace blocks instead of rejecting them. Severe.
- Emit fails but the diagnostic is a stack trace or an unrelated structural error — the rejection isn't happening at the interpreter layer; the violation slipped through to a downstream surface that crashed on the unexpected shape.
- Emit fails with a generic "parse error" — the framework parser is rejecting the syntax, not the SQLite interpreter rejecting the semantics. (Per FR16c the framework parser is purely syntactic and accepts the syntax across all targets; rejection is per-target.)
- The diagnostic doesn't name SQLite or doesn't reference "namespace" / "schema" / "block" — a Postgres user copying it would not understand why their SQLite contract rejected.
- The diagnostic doesn't point at a span — the user has to grep the offending namespace name in their contract themselves.

### Restore

```bash
rm -f /tmp/qa-pr2-scenario3-sqlite.prisma /tmp/qa-pr2-scenario3-diag.txt
git status   # if you edited a real demo's contract.prisma, revert it here too
```

Expect: clean tree.

## Scenario 4 — Late-binding `namespace unbound { … }` + IR + DDL

**What you're proving from the user's seat:** a multi-tenancy operator opts into Postgres's late-binding mode by declaring `namespace unbound { … }`; the contract IR records the IR `__unbound__` slot; the migration DDL emits unqualified at the FK target so the runtime `search_path` resolves at migration time. This is an **end-to-end developer-journey smoke** for AC6, plus implicit re-enactment of the multi-tenancy story the spec opens with.

**Covers:** AC6

**Oracle:**
- **Contract.json shape.** `storage.tables` has a `"__unbound__"` key whose value is the namespace bucket containing the unbound models. The on-disk literal is `"__unbound__"` (double-underscore-bracketed; spec § FR14).
- **DDL emission.** Tables under the `__unbound__` slot emit unqualified DDL (`CREATE TABLE "post" (…)` not `CREATE TABLE "<schema>"."post" (…)`). FK references whose target is in the `__unbound__` slot emit unqualified (`REFERENCES "user"("id")` not `REFERENCES "<schema>"."user"("id")`).
- **Search-path resolution** (if you run against a real database): with `SET search_path = tenant_alpha;` before applying the migration, the tables get created in `tenant_alpha`. With `SET search_path = tenant_beta;`, the same migration produces tables in `tenant_beta`. Two independent applications of the same migration script create two independent table sets in two schemas without any contract-level change.

**Preconditions:**
- Pre-flight complete.
- Real Postgres (not PGlite — `search_path` semantics under PGlite may differ from real PG). If only PGlite is available, mark this scenario Not Run; the report's coverage map flags AC6 as not exercised this round.
- Two schemas pre-created in the target database (e.g. `CREATE SCHEMA tenant_alpha; CREATE SCHEMA tenant_beta;`).

### Steps

1. Adapt the demo contract (or scratch contract) to wrap models in `namespace unbound { … }`:
   ```prisma
   namespace unbound {
     model User {
       id    String @id @default(uuid())
       email String
     }
     model Post {
       id     String @id @default(uuid())
       userId String
       user   User @relation(fields: [userId], references: [id])
     }
   }
   ```
2. Emit:
   ```bash
   cd examples/prisma-next-demo && pnpm emit; cd -
   ```
3. Inspect the IR slot:
   ```bash
   cat examples/prisma-next-demo/src/prisma/contract.json | jq '.storage.tables | keys'
   cat examples/prisma-next-demo/src/prisma/contract.json | jq '.storage.tables["__unbound__"] | keys'
   ```
4. Generate the migration:
   ```bash
   cd examples/prisma-next-demo && pnpm prisma-next migration generate; cd -
   cat examples/prisma-next-demo/migrations/app/<latest>/migration.sql
   ```
5. (If real DB available) Apply against `tenant_alpha`:
   ```bash
   psql "$DATABASE_URL" -c "SET search_path = tenant_alpha;" -f examples/prisma-next-demo/migrations/app/<latest>/migration.sql
   ```
6. Apply the same migration script against `tenant_beta`:
   ```bash
   psql "$DATABASE_URL" -c "SET search_path = tenant_beta;" -f examples/prisma-next-demo/migrations/app/<latest>/migration.sql
   ```
7. Verify both schemas have the tables:
   ```bash
   psql "$DATABASE_URL" -c "\dt tenant_alpha.*"
   psql "$DATABASE_URL" -c "\dt tenant_beta.*"
   ```

### What you should see

- `storage.tables` has `"__unbound__"` as a top-level key (with the literal underscores, not stripped).
- Migration SQL has `CREATE TABLE "user" (…)` (unqualified), `CREATE TABLE "post" (…)` (unqualified), and the FK reads `REFERENCES "user"("id")` (unqualified target).
- (Real DB) Both `tenant_alpha.user` / `tenant_alpha.post` and `tenant_beta.user` / `tenant_beta.post` exist independently after step 6. The two schemas have the FK constraints (verify via `\d+ tenant_alpha.post` and `\d+ tenant_beta.post`).

### Failure modes

- `storage.tables` has a non-`__unbound__` key for the unbound models (e.g. `"public"` or the literal `"unbound"` without underscores) — the Postgres interpreter's `unbound`-keyword-to-`__unbound__`-slot mapping is wrong.
- Migration SQL qualifies the unbound tables (`CREATE TABLE "public"."user"`, `REFERENCES "public"."user"("id")`) — the DDL emitter is treating the `__unbound__` slot as the `public` schema, breaking the late-binding contract.
- (Real DB) Applying the same migration twice against different `search_path` values produces a conflict or fails on the second apply — the unqualified DDL isn't actually search-path-resolving, indicating a regression somewhere between the IR and the emitted SQL.

### Restore

```bash
cd examples/prisma-next-demo
git checkout -- src/prisma/contract.prisma src/prisma/contract.json src/prisma/contract.d.ts
rm -rf migrations/app/<dir-created-during-step-4>
cd -
# (Real DB) Drop the tenant schemas to leave the DB clean:
psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS tenant_alpha CASCADE; DROP SCHEMA IF EXISTS tenant_beta CASCADE;"
git status
```

Expect: clean tree.

## Scenario 5 — Reject user-declared `namespace unbound` reservation **(negative control)**

**What you're proving from the user's seat:** the Postgres interpreter reserves `unbound` as a namespace identifier (it's consumed for the late-binding sentinel mapping per FR14 + FR16c). A user who tries to declare a regular schema named `unbound` — e.g. via PSL `namespace unbound { … }` in a context where they actually meant a named schema, or via the TS builder's `namespaces: ['public', 'unbound']` — gets a diagnostic that names the reservation rationale, not just the conflict. This is a **negative control with explicit coverage boundary**.

**Covers:** AC6a

**Coverage boundary statement:** This scenario plants one specific violation (TS-builder `namespaces` list containing `'unbound'`) and observes one diagnostic. It does NOT prove the reservation covers PSL-side blocks (because PSL `namespace unbound { … }` is *valid* in Postgres — it lowers to the late-binding slot per AC6, scenario 4 above) and it does NOT prove SQLite / Mongo behaviour (per AC6a the rejection rationale differs by target — SQLite/Mongo reject *all* explicit namespace blocks, not just `unbound`-named ones).

**Oracle:** the diagnostic names `unbound` as a reserved identifier and explains that the reservation is because the keyword is consumed for late-binding semantics. The user can read the diagnostic and understand they need to choose a different schema name OR drop the explicit declaration in favour of the late-binding semantic.

**Preconditions:**
- Pre-flight complete.
- TS-builder scratch file (similar to scenario 2 setup).

### Steps

1. Create a scratch TS-builder script at `/tmp/qa-pr2-scenario5.ts` declaring `unbound` as a regular namespace name:
   ```typescript
   import { defineContract, cols } from '@prisma-next/postgres/contract-ts';
   const contract = defineContract({
     namespaces: ['public', 'unbound'],
     models: ({ model }) => ({
       User: model('User', { namespace: 'unbound', fields: { id: cols.text({ primaryKey: true }) } }),
     }),
   });
   ```
2. Attempt to construct + emit:
   ```bash
   pnpm tsx /tmp/qa-pr2-scenario5.ts 2>&1 | tee /tmp/qa-pr2-scenario5-diag.txt
   ```
3. (Optional, if the reservation check is at the PSL layer too) Try the analogous PSL form — but note: per scenario 4, `namespace unbound { … }` in PSL is *valid* Postgres syntax for the late-binding opt-in. The reservation surface for PSL is different (per AC6a it would be "declaring a model named `unbound` outside a namespace context" or "declaring two `namespace unbound { … }` blocks with conflicting intent"; the canonical PSL surface for this reservation is unclear in the spec — flag in the report if you can't construct a clean PSL repro).

### What you should see

- The TS-builder construction throws (or returns a typed error) at the `defineContract` call, before any emit happens. The error message contains the word `unbound` and a phrase along the lines of "reserved" / "late-binding sentinel".
- The error does NOT manifest as a `TypeError` or a `Cannot read property` — it's a deliberate, typed rejection.
- (If exercising the PSL surface and a clean repro exists) emit exits non-zero with a similar reservation diagnostic.

### Failure modes

- The TS-builder accepts `'unbound'` silently — the reservation isn't enforced at the TS-builder construction site.
- The error fires but is a generic schema-name conflict ("name already exists") rather than naming the reservation specifically — the user can't tell *why* `unbound` is special.
- The error fires but is a low-level structural error (e.g. "namespace coordinate cannot be `__unbound__`" — referencing the IR sentinel rather than the PSL keyword) — the diagnostic leaks the IR layer's vocabulary at the user-facing surface.

### Restore

```bash
rm -f /tmp/qa-pr2-scenario5.ts /tmp/qa-pr2-scenario5-diag.txt
git status
```

Expect: clean tree.

## Scenario 6 — Canonical-shape strict throw fires on a planted flat-shape literal **(negative control)**

**What you're proving from the user's seat:** the strict-shape gate at the `SqlStorage` constructor — introduced during the PR2 reversal and named in the family-sql failure-mode catalogue as the "dual-shape support relocated under a new name" anti-pattern's primary guard — fires with a diagnostic that names the offending bucket key when an extension author or downstream tool hand-builds a storage with the legacy flat shape. This is a **negative control with explicit coverage boundary**.

**Covers:** (no specific AC; guardrail introduced during the PR2 reversal slice to prevent reintroduction of dual-shape support — see family-sql failure-mode catalogue § 3.1 in `projects/agile-agent-orchestration/calibration/prisma-next.md`)

**Coverage boundary statement:** This scenario plants one specific violation (a flat `types: { user_type: <TypeDescriptor> }` literal passed to the `SqlStorage` constructor) and observes the strict throw. It does NOT prove every possible malformed shape is rejected — only the specific one we constructed. The grep gates in the calibration's § 4 catch the source-code patterns that lead to this failure mode; this scenario verifies the runtime gate's gate-ness, complementing the static-analysis gates.

**Oracle:** the constructor throws (or rejects via the validator) with a diagnostic of shape `SqlStorage: types[<offending key>] is a class-instance entry; expected a namespace bucket `Record<typeName, ...>`.` — naming the specific offending key (`user_type` in our planted literal). The diagnostic does NOT silently coerce; the legacy flat shape must surface as a hard failure.

**Preconditions:**
- Pre-flight complete.
- A minimal scratch script that imports `SqlStorage` directly and hand-builds a violating input.

### Steps

1. Create a scratch script at `/tmp/qa-pr2-scenario6.ts`:
   ```typescript
   import { SqlStorage } from '@prisma-next/sql-contract/types';

   // Plant: flat-shape `types`. The canonical shape is `types: { [namespaceId]: { [typeName]: entry } }`.
   const flatTypes = { user_type: { kind: 'codec-instance', codec: { name: 'enum', args: { values: ['admin', 'user'] } } } as any };

   try {
     const storage = new SqlStorage({
       storageHash: 'sha256:fake',
       tables: { __unbound__: {} },
       types: flatTypes as any,
       namespaces: {},
     } as any);
     console.error('FAIL: constructor accepted flat shape silently. storage =', storage);
     process.exit(1);
   } catch (err) {
     console.log('PASS — diagnostic surfaced:');
     console.log((err as Error).message);
   }
   ```
   *(Adjust import path / type names if the actual export surface has drifted; the spec § FR15 says `SqlStorage` lives in `@prisma-next/sql-contract/types`.)*
2. Run:
   ```bash
   pnpm tsx /tmp/qa-pr2-scenario6.ts
   ```
3. Read the diagnostic.

### What you should see

- The script exits 0 with `PASS — diagnostic surfaced:` followed by the diagnostic message.
- The diagnostic message names the offending key literally — i.e. contains the substring `user_type` — and uses phrasing similar to `types["user_type"] is a class-instance entry; expected a namespace bucket Record<typeName, ...>`. (Compare against the emit failure mode the build-contract.ts fix originally diagnosed — that diagnostic shipped before this scenario and is the canonical reference.)
- No silent coercion: the script does NOT print the `FAIL: constructor accepted flat shape silently.` branch.

### Failure modes

- The constructor accepts the flat literal without throwing — the strict-shape gate is missing or has been weakened back to permissive mode. This is the regression the failure-mode catalogue § 3.1 was specifically introduced to prevent.
- The diagnostic fires but doesn't name the offending key (`user_type`) — the message is less useful than the one shipped earlier in PR2; a regression in diagnostic quality.
- The diagnostic fires but is a generic arktype validation error ("`types` must be of type `Record<string, Record<string, …>>`") rather than the bespoke "class-instance entry; expected a namespace bucket" message — the bespoke diagnostic was lost; the user has to mentally decode an arktype shape signature instead of getting actionable text.
- A stack trace surfaces; the diagnostic is a `TypeError` thrown deep in the validator — the strict-throw layer crashed rather than reporting cleanly.

### Restore

```bash
rm -f /tmp/qa-pr2-scenario6.ts
git status
```

Expect: clean tree.

## Scenario 7 — Exploratory: probe namespace + cross-namespace combinations

**Charter.** Explore the namespace authoring surface (PSL + TS) with the demo contract for 30 minutes; discover behaviours that surprise you, diagnostics that read poorly, or combinations the scripted scenarios skipped. Anchor questions to think about:

- **Reopen-merge.** What happens if you declare `namespace public { model A { … } }` in one file and `namespace public { model B { … } }` in another? In the same file twice? Does the merge happen as the spec § FR16a "PSL surface" describes? Does a key collision (same model name in both blocks) fail with a useful diagnostic?
- **Recursive blocks.** What happens if you write `namespace a { namespace b { model X { … } } }`? The spec calls this a parse error; verify the diagnostic is helpful.
- **`__unspecified__` bare-name resolution.** Per spec § FR16a "PSL surface": bare-name resolution within a namespace tries local-namespace-first, then `__unspecified__`, then errors. Can you construct a contract where a model in namespace `auth` references a type declared at the top level (i.e. in the `__unspecified__` bucket)? Does it resolve cleanly?
- **Cross-namespace FK with late-binding.** What happens if you declare both an `unbound` namespace and a named `auth` namespace, and try to FK from `unbound` to `auth`? Does the spec say anything? What does the system actually do?
- **TS-builder ergonomic surprises.** Type narrowing on the model handle — does `model('User', { namespace: 'auth' }).refs.<field>` autocomplete in your editor? Are the available namespace strings narrowed by the `namespaces:` declaration?
- **Migration of a single-namespace contract that gains a second namespace.** Take the demo contract (all top-level → IR `public`), add a `namespace auth { … }` block to introduce a second schema, regenerate the migration. Does the planner correctly add `CREATE SCHEMA "auth"` before the table creation? Or does it assume the schema exists?
- **DDL for cross-namespace FKs with cascade.** AC4 covers FK declaration but doesn't specify `onDelete: CASCADE` behaviour. Does cascade work across namespaces? Does the verifier diff cascade behaviour correctly?

**Covers:** (no specific AC; surfaces unknowns)

**Time budget:** 30 minutes. Stop when the timer rings even if you have ideas left — log them as candidate scenarios for a future round.

**Notes capture:** Write what you tried, what surprised you, anything that "felt off" but you can't yet name. The runner classifies findings in the report; don't pre-classify here.

## Scenarios deliberately not in this script

| AC | Why it's not a manual-QA scenario |
| -- | --------------------------------- |
| AC1 (existing unit/integration/e2e suites pass) | CI runs this on every push. Re-running locally proves only your machine matches CI. |
| AC2 (enum first-class IR) | PR1 scope; landed before PR2. |
| AC3 (target adds IR node kind without family changes) | PR1 scope. |
| AC4 — "verification against a live database with both schemas + the FK passes" sub-clause | Covered by `packages/3-targets/6-adapters/postgres/test/migrations/runner.cross-namespace-fk.integration.test.ts` (PGlite integration). The manual scenario above (scenario 1) covers the *authoring + emit + DDL* halves of AC4; the live-DB verification half is a tight CI loop that adds nothing to do by hand. |
| AC6b (`PslDocumentAst` structural shape) | Pure framework-parser AST shape assertion. Covered by parser unit tests; nothing observable to a human at the user surface beyond what scenario 1 already exercises. |
| AC7 (Mongo 3-layer split) | PR1 scope. |
| AC8 (round-trip fidelity, full) | Scenario 2 exercises an observed slice (TS-builder round-trip on a two-namespace contract). The full `for any target` round-trip is property-test coverage; manual judgement adds nothing beyond the slice. |
| AC9 (docs updates) | The PR2 namespace ADRs are still drafts under `projects/target-extensible-ir/specs/`; they get a doc-read scenario at project close-out, not in PR2's manual-QA. |
| AC10 (ADR drafts exist on disk) | Pure file-existence check; `ls` is not a QA pass. |
| AC11 (`pnpm lint:deps` passes) | CI; no human observation. |
| AC12 (`validateContract` removed) | PR1 scope. |
| AC13 (Mongo dep direction) | PR1 scope. |
| FR16d mechanical-rename audit | Per NFR1 the rename is a breaking change with no transition window; verifying "the rename happened" is a `git log -p`-style reviewer concern, not a user-observable behaviour. The `fixtures:check` gate already catches accidental incomplete renames. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| ----- | ----------------------- |
| AC1   | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script" |
| AC2   | (PR1 scope; not in PR2 manual-QA) |
| AC3   | (PR1 scope; not in PR2 manual-QA) |
| AC4   | 1 (authoring + emit + DDL); live-DB sub-clause covered by integration test, see deliberately-not-in-script table |
| AC4a  | 1 (PSL), 2 (TS) |
| AC5   | 3 |
| AC6   | 4 |
| AC6a  | 5 |
| AC6b  | (parser-level; covered by AC4's scenario 1 indirectly + parser unit tests) |
| AC7   | (PR1 scope) |
| AC8   | 2 (observed slice via TS-builder round-trip) |
| AC9   | (deferred to project close-out QA, not PR2) |
| AC10  | (file-existence check; CI / reviewer) |
| AC11  | (CI) |
| AC12  | (PR1 scope) |
| AC13  | (PR1 scope) |
| (reversal guardrail — strict-shape throw) | 6 |
| (unknown unknowns) | 7 (exploratory) |
