# Framework Limitations — Supabase PoC

Framework gaps surfaced while building the Supabase example app on Prisma Next. Each entry is a signal that the framework *could* do more — the PoC is designed to expose these, not paper over them. The point of this PoC is precisely to capture this list, so be generous: if something felt awkward, it goes here.

**Format mirrors [`projects/mongo-example-apps/framework-limitations.md`](../mongo-example-apps/framework-limitations.md).**

Status values: `Open` (live in this PoC), `Triaged` (decided what to do with it), `Resolved` (fixed during a follow-up project), `Won't fix` (decided not to address).

---

## RLS / per-request session context

Limitations related to running queries with a per-request RLS / role / GUC context. These are the central problem the PoC explores.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-XX | _(populate during M1–M2)_ | | | |

---

## Realtime / change streams

Limitations related to streaming database changes to clients. Out of PN's scope today; populated as we discover what would have been nicer to have natively.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-XX | _(populate during M4)_ | | | |

---

## Driver / connection lifecycle

Limitations encountered while wrapping `@prisma-next/driver-postgres` to apply RLS context.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-XX | _(populate during M2–M3)_ | | | |

---

## Migration authoring

Limitations encountered while authoring the schema and RLS policies via PN's migration system. This is the second part of PN the PoC exercises (alongside the runtime).

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-04 | `OperationClass` (the `target.details.objectType` union) is closed: `'dependency' \| 'type' \| 'table' \| 'column' \| 'primaryKey' \| 'unique' \| 'index' \| 'foreignKey'`. There is no `'policy'` value. | Pack-level operation factories that produce kinds outside this set must either fall back to `'dependency'` (losing semantic precision in planner output / target details) or type-cast (a smell). | RLS factories (`enableRowLevelSecurity`, `createRlsPolicy`, `dropRlsPolicy`) set `target.details.objectType = 'dependency'`. | Open — surfaced in T1.5; covered by Sketch 3. |
| FL-05 | `prisma-next migration plan` scaffolds `migration.ts` with `#!/usr/bin/env -S node` plus mode `0755` (executable bit set). The file is TypeScript, and Node's ESM loader doesn't compile `.ts` directly — invoking the scaffolded file as `./migrations/<ts>_<slug>/migration.ts` fails with `ERR_MODULE_NOT_FOUND`. Source: [`packages/1-framework/3-tooling/migration/src/runtime-detection.ts:16`](../../packages/1-framework/3-tooling/migration/src/runtime-detection.ts) emits the shebang unconditionally for `.ts` outputs. Developer-experience papercut, not a correctness issue (canonical invocations don't use the shebang) — the scaffold misleads new contributors into trusting the executable bit. | Surfaced in 1.6 when verifying the re-attest step. The migration's docblock, [`SKILL.md` § 10 step 3](skills/writing-rls-policies-with-pn/SKILL.md#10-where-to-write-it-pn-specific) and [`SKILL.md` § 9](skills/writing-rls-policies-with-pn/SKILL.md#9-common-anti-patterns) all now spell out "use `tsx`, not `node` directly". | Always invoke via `pnpm exec tsx <path>` or `pnpm --filter <example> migrate:up`. The shebang and exec-bit on the scaffolded file are ignored by both invocations, so the workaround needs no source edit. **Upstream fix sketch:** for `.ts` scaffold outputs, either (a) emit `#!/usr/bin/env -S tsx` so `./migration.ts` works directly when `tsx` is on PATH, or (b) drop the shebang+exec-bit entirely (the canonical invocation is `tsx` / `migration apply` and neither needs them). Option (b) is simpler and matches the project convention that migrations are run through the CLI / package script, not invoked directly. | Open — surfaced in 1.6 (CLI-first refactor). Cosmetic; safe to defer. |

---

## Contract / lanes / authoring

Limitations encountered while authoring the contract or expressing Supabase-specific shapes.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-01 | The SQL contract DSL has no surface for declaring RLS metadata on a model (`enableRowLevelSecurity`, role allowlists, policies). Authors can only express column types, primary keys, FKs, indexes, etc. | **DSL-side facet:** RLS is invisible to the contract — the emitted `contract.json` / `contract.d.ts` make no statement about whether a table is RLS-protected, so the apply-time schema verifier doesn't track RLS at all (it's neither required nor forbidden). Lints like "this query touches an RLS-protected table — did you scope to a session?" are not expressible.<br><br>**Planner-side facet:** Because the contract carries no RLS metadata, the migration planner cannot emit `enableRowLevelSecurity` / `createRlsPolicy` calls for migrated tables. The canonical workflow is **scaffold-and-edit**: `prisma-next migration plan` scaffolds a `migration.ts` populated with the `createTable` / `addColumn` / etc. ops the planner derives from the contract, and the author then *edits* the file to append the RLS factory calls. Re-running `tsx migration.ts` re-derives `ops.json` from the edited body. The PoC's [`examples/supabase-todos/migrations/20260428T0354_initial/migration.ts`](../../examples/supabase-todos/migrations/20260428T0354_initial/migration.ts) is a worked example: the docblock cites which ops came from the planner and which were hand-authored. | The contract declares column shapes only; RLS is authored in the migration file via in-example `enableRowLevelSecurity` / `createRlsPolicy` factories (T1.5/T1.6). For changes after the initial migration, the same scaffold-and-edit pattern applies — `migration plan` produces an empty migration body when the contract hasn't changed, and the author appends RLS edits there. See also Sketch 3. | Open — surfaced in 1.3 (contract authoring); planner-side facet confirmed in 1.6 and demonstrated end-to-end via the CLI workflow refactor. |
| FL-02 | The contract DSL has no way to express a foreign key to a column in another schema (e.g. `auth.users.id` in Supabase). `rel.belongsTo` / `constraints.foreignKey` reference local-contract models only. | **Major.** This is a hard requirement for any real Supabase-on-PN application. Without `REFERENCES auth.users(id) ON DELETE CASCADE`, `todos.user_id` / `profiles.id` / `public_messages.author_id` carry no DB-level guarantee of pointing at a real auth user; orphan rows can persist after a user is deleted; `ON DELETE CASCADE` cleanup is unavailable. A `rawSql` FK can be authored in a migration, but the resulting constraint is not in the contract IR and the apply-time schema verifier reports it as `extra_foreign_key` and rolls the apply transaction back (`PN-RUN-3000`); there is no public flag on `prisma-next migration apply` to opt out of strict mode. **A real production app cannot ship without this gap closed.** | The PoC **omits the FK constraint entirely** (see [`examples/supabase-todos/migrations/20260428T0354_initial/migration.ts`](../../examples/supabase-todos/migrations/20260428T0354_initial/migration.ts) docblock). Integrity is enforced by convention: the seed inserts the auth user via `supabase.auth.admin.createUser` first and uses the returned id when inserting `profiles` / `todos` / `public_messages` rows; the `INSERT` policies' `withCheck` predicates (`(user_id = (auth.uid())::text)`) prevent authenticated users from posting rows owned by anyone else. **Cleanup on user deletion is not handled — accepted for PoC; would be a blocker for production.** | Open — surfaced in 1.3; **elevated to major** in 1.6 after the verify-failure evidence. |
| FL-03 | `field.uuid()` (the callback-helper preset) lowers to `sql/char@1` with `length: 36`, i.e. Postgres `character(36)`. There is no Postgres native `uuid` field helper, and `@prisma-next/adapter-postgres/column-types` does not export a `uuidColumn` descriptor either. | A column intended to FK to `auth.users.id` (which is pg `uuid`) is typed as `char(36)`. The combination of `field.uuid()` *and* a Supabase-shaped FK to `auth.users` cannot coexist today: an `alterColumnType` to native `uuid` after `createTable` is rejected by the apply-time schema verifier, which compares the introspected column native type against the contract IR — concrete failure observed in 1.6 was `verifySqlSchema` issue `{ kind: 'type_mismatch', table: 'todos', column: 'id', expected: 'character(36)', actual: 'uuid' }` (multiplied per renamed column), with the apply transaction rolled back as `PN-RUN-3000`. The two viable options are: **(a)** keep `char(36)` end-to-end and bridge to `auth.uid()` (which is `uuid`) by casting on the function side inside policy bodies — `(<col> = (auth.uid())::text)`, or **(b)** author a custom `ColumnTypeDescriptor` of `{ codecId: 'pg/uuid@1', nativeType: 'uuid' }` via the structural DSL so the contract itself declares `uuid`. The portable `field.uuid()` callback-helper does not currently let an author select native `uuid`. | The PoC takes option **(a)**: `id` / `user_id` / `author_id` stay `char(36)` end-to-end (no `alterColumnType`), and policies cast `auth.uid()::text` once on the function side. See [`migrations/20260428T0354_initial/migration.ts`](../../examples/supabase-todos/migrations/20260428T0354_initial/migration.ts) and SKILL.md § 6 for the cast pattern. The contract stays target-portable. | Open — surfaced in 1.3; concrete `type_mismatch` evidence captured in 1.6. |

---

## Other

Anything that didn't fit a bucket above.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-XX | | | | |

---

## App-level gaps (not framework)

Things the demo could do better that aren't framework limitations.

| ID | Issue | Note |
|---|---|---|
| AG-XX | | |

---

# Design sketches — proposed upstream work

Three half-page sketches of changes that *could* be upstreamed if the team decides the patterns established by this PoC are worth promoting from "userspace recipe" to "first-class framework concept." These are documentation of "what we'd want next," not commitments. They are intentionally short; if any prove popular, they become their own project with a proper spec.

## Sketch 1 — Scoped-session SPI

> **Status:** _to be written during 5.2_

**Problem.** Today, "run the next N plans against this Postgres connection with these GUCs / this `ROLE`" is not a first-class concept. Apps have to wrap the driver to express it (see this PoC's `createSupabaseRuntime`). Supabase users hit this; multi-tenant apps using session GUCs hit this; anyone who needs `SET LOCAL search_path` per request hits this.

**Sketch.** _(to be written)_

  - Option A: a `runtime.withSession({ guc: Record<string, string>, role?: string }): SqlRuntime` method on `SqlRuntime` that returns a runtime bound to a GUC profile. Implementation chooses connection-scope or transaction-scope based on driver capability.
  - Option B: a dedicated `SqlSessionScope` SPI on the driver. The runtime gains a `scope(opts): SessionScope` method that returns an object owning a connection (or transaction) for its lifetime; plans executed through it inherit the GUCs.

**Trade-offs.** _(to be written)_

  - Connection-scope vs transaction-scope is a property of the deployment (pooler mode), not the application. The SPI must let drivers pick.
  - Interaction with explicit `beginTransaction()` needs to be defined: nested? error?
  - Capability key like `sql.sessionScope.connection` / `sql.sessionScope.transaction` so middleware/lints can branch.

## Sketch 2 — Subscription lane

> **Status:** _to be written during 5.3_

**Problem.** Prisma Next has a great story for streaming the rows of a query. It has no story for streaming changes to a table. Supabase users get this from a separate service; plain Postgres users get this from `LISTEN/NOTIFY`. There's no contract-aware primitive in PN that says "tell me when a row I would have read changed."

**Sketch.** _(to be written)_

  - A new lane `db.subscribe(tables.todos).where(...).select({...}) → AsyncIterable<ChangeEvent<Row>>`.
  - Lowers via adapter capability:
    - Plain Postgres: `LISTEN <channel>` + an outgoing-trigger / replication-slot reader.
    - Supabase: open a Realtime websocket via an adapter-level helper.
  - `ChangeEvent` is `{ kind: 'insert' | 'update' | 'delete', row: Row, oldRow?: Row, source: { commitTs: string, lsn?: string } }`.

**Trade-offs.** _(to be written)_

  - Backpressure / replay semantics need to be defined.
  - RLS enforcement on subscriptions is a separate consideration (Supabase Realtime does this server-side; plain LISTEN/NOTIFY can leak rows the subscriber couldn't otherwise read).
  - Capability gates: `sql.subscribe.listen`, `sql.subscribe.replication`, `supabase.realtime`.

## Sketch 3 — RLS-aware contract metadata + lints + native policy authoring

> **Status:** _to be written during 5.4_

**Problem.** Today PN has no way to know that a table is RLS-protected, so it cannot:

1. warn an author who runs a query against `todos` from an unauthenticated runtime (the query just returns zero rows silently — a class of bug Supabase users will hit constantly), or
2. emit RLS-related operations (`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`) from the migration planner. This PoC's example has to hand-edit planner-emitted migrations to insert calls to in-example factories.

A related friction is that the postgres target's `OperationClass` union is closed and has no `'policy'` value, so any pack-level factory producing policy ops must fall back to `'dependency'`.

**Sketch.** _(to be written)_

  - Optional contract annotation `@@rls(roles: ["anon", "authenticated"])` (PSL) / `tables.todos.rls(...)` (TS DSL) capturing roles and (optionally) policy expressions.
  - The migration planner reads these annotations and emits `enableRowLevelSecurity` / `createRlsPolicy` operations into the produced migration file (no hand-editing required for the common case).
  - The two factories themselves get promoted from in-example helpers to public exports of `@prisma-next/target-postgres/migration`, and `OperationClass` gains a `'policy'` value (or becomes pack-extensible).
  - A `SqlMiddleware` lint `rls/missing-session` that consults `plan.meta.refs.tables` against the contract; when a referenced table is RLS-annotated and the runtime has no `session` context attached (see Sketch 1), it warns or errors per policy.
  - Optional second lint `rls/expected-role` that validates the active role is in the table's allowlist.

**Trade-offs.** _(to be written)_

  - Depends on Sketch 1 — without a session concept, the lint has nothing to check against.
  - Annotations don't *enforce* anything at query time; Postgres still owns enforcement. They exist for authoring-time feedback and to drive migration-planner output.
  - Embedding the policy *expressions themselves* in the contract is the open design question. Options: (a) only roles in the contract; expressions in a sibling file (looser coupling, less drift signal); (b) full policies in the contract (tightly coupled, planner is fully declarative, but the contract starts encoding operational concerns).
  - Making `OperationClass` extensible is itself a small cross-cutting change to `@prisma-next/target-postgres` planner internals; size with care.
