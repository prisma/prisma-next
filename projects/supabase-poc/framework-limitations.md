# Framework Limitations — Supabase PoC

Framework gaps surfaced while building the Supabase example app on Prisma Next. Each entry is a signal that the framework *could* do more — the PoC is designed to expose these, not paper over them. The point of this PoC is precisely to capture this list, so be generous: if something felt awkward, it goes here.

**Format mirrors [`projects/mongo-example-apps/framework-limitations.md`](../mongo-example-apps/framework-limitations.md).**

Status values: `Open` (live in this PoC), `Triaged` (decided what to do with it), `Resolved` (fixed during a follow-up project), `Won't fix` (decided not to address).

---

## RLS / per-request session context

Limitations related to running queries with a per-request RLS / role / GUC context. These are the central problem the PoC explores.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-01 | _(populate during M1–M2)_ | | | |

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
| FL-XX | `OperationClass` (the `target.details.objectType` union) is closed: `'dependency' \| 'type' \| 'table' \| 'column' \| 'primaryKey' \| 'unique' \| 'index' \| 'foreignKey'`. There is no `'policy'` value. | Pack-level operation factories that produce kinds outside this set must either fall back to `'dependency'` (losing semantic precision in planner output / target details) or type-cast (a smell). | RLS factories use `objectType: 'dependency'`. | Open — _(record during 1.5)_ |
| FL-XX | The contract has no first-class concept of RLS (table annotations, role allowlists, policies). | The planner cannot emit `enableRowLevelSecurity` / `createRlsPolicy` calls for migrated tables; RLS authoring is bolted on after the planner runs. | The example hand-edits the planner-emitted migration file to add the RLS factory calls. | Open — _(record during 1.6)_; covered by Sketch 3. |
| FL-XX | _(populate during 1.5 if `quoteIdentifier` is not part of the public migration surface)_ | | | |

---

## Contract / lanes / authoring

Limitations encountered while authoring the contract or expressing Supabase-specific shapes.

| ID | Issue | Impact | Workaround in app | Status |
|---|---|---|---|---|
| FL-01 | The SQL contract DSL has no surface for declaring RLS metadata on a model (`enableRowLevelSecurity`, role allowlists, policies). Authors can only express column types, primary keys, FKs, indexes, etc. | RLS is invisible to the contract: the emitted `contract.json` / `contract.d.ts` make no statement about whether a table is RLS-protected, and the planner therefore cannot emit `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` from contract metadata. RLS is bolted on after-the-fact in migration files. Lints like "this query touches an RLS-protected table — did you scope to a session?" are not expressible. | The contract declares column shapes only; RLS is authored in the migration file via in-example `enableRowLevelSecurity` / `createRlsPolicy` factories (T1.5/T1.6). See also Sketch 3. | Open — surfaced in 1.3 (contract authoring); planner-side facet to be detailed in 1.6. |
| FL-02 | The contract DSL has no way to express a foreign key to a column in another schema (e.g. `auth.users.id` in Supabase). `rel.belongsTo` / `constraints.foreignKey` reference local-contract models only. | The `profiles.id` → `auth.users.id` and `todos.user_id` → `auth.users.id` references that are central to the Supabase data model cannot be expressed in the contract. The contract treats those columns as plain `uuid` columns with no referential metadata. | The `user_id` / `id` columns are typed as `field.uuid()`; the actual `REFERENCES auth.users(id) ON DELETE CASCADE` constraint is created in the migration file via raw SQL (T1.6). | Open — surfaced in 1.3. |
| FL-03 | `field.uuid()` (the callback-helper preset) lowers to `sql/char@1` with `length: 36`, i.e. Postgres `character(36)`. There is no Postgres native `uuid` field helper, and `@prisma-next/adapter-postgres/column-types` does not export a `uuidColumn` descriptor either. | Columns intended to FK to `auth.users.id` (which is pg `uuid`) are typed as `char(36)`. A direct `REFERENCES auth.users(id)` will fail with a type-mismatch; pg requires either matching types or an explicit cast at index/FK creation. | Migration file (T1.6) issues `ALTER COLUMN <col> TYPE uuid USING <col>::uuid` after `createTable` and before `addForeignKey`. The contract stays target-portable; the alter is the workaround. Captured in skill §11. | Open — surfaced in 1.3; workaround landing in 1.6. |

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
