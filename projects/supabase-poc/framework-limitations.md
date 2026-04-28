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
| FL-06 | `@prisma-next/target-postgres/migration` exports an op-factory called `rawSql` ([`packages/3-targets/3-targets/postgres/src/exports/migration.ts`](../../packages/3-targets/3-targets/postgres/src/exports/migration.ts)). The runtime SQL lane in `@prisma-next/sql-builder/runtime` (and the planner's "raw SQL" surface) also use the name `rawSql` for an entirely different concept — a builder that produces a *runtime* `Plan` from a SQL string. The two share a bare name across two domains (migration-time DDL escape hatch vs. runtime query builder). | Naming collision is invisible until a file imports from both, at which point `import { rawSql } from '@prisma-next/target-postgres/migration'` and `import { rawSql } from '@prisma-next/sql-builder/runtime'` shadow each other. In a single file (e.g. an integration test that issues a runtime query against a table created via a `rawSql` migration op) the user has to alias one of them, and the resulting code is hard to grep. Even when only one is imported, the name `rawSql` *reads* like a query builder, not an operation factory — see [`SKILL.md` § 10](skills/writing-rls-policies-with-pn/SKILL.md#10-where-to-write-it-pn-specific) where the in-example RLS factories explicitly choose to *not* re-use the name. | Aliasing on import (`import { rawSql as rawSqlOp } from '@prisma-next/target-postgres/migration'`) when both are needed in one file. The PoC's RLS factories ([`examples/supabase-todos/migrations/utils/rls-ops.ts`](../../examples/supabase-todos/migrations/utils/rls-ops.ts)) wrap `rawSql` and re-export under names that read as operations (`enableRowLevelSecurity`, `createRlsPolicy`, `alterRlsPolicy`, `dropRlsPolicy`), avoiding the bare name in user code. **Upstream fix sketch:** rename the migration-side factory to `op()` (the call site reads as `op('CREATE POLICY …')`, which matches its semantic — produces an `Op`) or `rawSqlOp()`. Keep the runtime `rawSql` name as-is (it has the longer-established conceptual claim on the term). | Open — surfaced in round-3 review of `rls-ops.ts`. Cosmetic; coordinate with any future rename of the migration op-factory exports. |
| FL-07 | `PostgresPlanTargetDetails` (the `target.details` shape that every migration op carries; defined in [`packages/3-targets/3-targets/postgres/src/exports/planner-target-details.ts`](../../packages/3-targets/3-targets/postgres/src/exports/planner-target-details.ts)) is opaque to user-authored op factories. Its tri-shape `{ schema, objectType, name, table? }` overloads `name` (sometimes the table name; sometimes the policy/index/constraint name with `table` set as the parent) and the `objectType` discriminant has no `'policy'` value (FL-04), so policy ops fall back to `'dependency'` — which itself has no documented meaning at the call site. The framework provides a `targetDetails(objectType, name, schema, table?)` builder ([`packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts:47`](../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts)) but does not export it; user code re-implements it inline. | A user reading [`examples/supabase-todos/migrations/utils/rls-ops.ts`](../../examples/supabase-todos/migrations/utils/rls-ops.ts) cannot tell from the call site what `buildTargetDetails(SCHEMA, name, table)` is doing without grepping the framework: why is `'dependency'` the discriminant for an RLS policy? Why is `name` sometimes the policy name and sometimes the table name? Why does `enableRowLevelSecurity` pass `name = table` and `table = undefined`, while `createRlsPolicy` passes `name = policy` and `table = table`? The shape is correct (it round-trips through the planner) but the contract is implicit. | The PoC's `rls-ops.ts` defines an in-file `buildTargetDetails` helper that mirrors the framework's unexported `targetDetails`, with a one-line comment explaining the `name` overload and the `'dependency'` fallback. Round-3 review added a code comment above the helper documenting why `table` is optional (it's the parent-table for relation-bound objects like policies/indexes/constraints; absent for table-level ops like `ENABLE ROW LEVEL SECURITY`). **Upstream fix sketch:** export named factories that make the shape self-documenting at the call site — `targets.policy(schema, table, name)`, `targets.table(schema, name)`, `targets.index(schema, table, name)`, `targets.constraint(schema, table, name)`, `targets.column(schema, table, name)`. Each factory builds the right `objectType` discriminant and shape, and the call site reads as the conceptual target rather than as a positional triple. Coordinate with FL-04 (policy class) so `targets.policy` lowers to a real `'policy'` discriminant. | Open — surfaced in round-3 review. Cross-references FL-04, FL-09 (no DDL builder), FL-12 (no Postgres-target Op surface). |
| FL-08 | The internal `step(description, sql)` helper at [`packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts:43`](../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts) is the canonical way to construct the `{ description, sql }` envelope that fills `op.execute[]`, `op.precheck[]`, `op.postcheck[]`, and `op.rollback[]`. It is used by every framework-supplied op factory (createTable, addColumn, addForeignKey, etc.) but is not part of the public exports surface ([`packages/3-targets/3-targets/postgres/src/exports/migration.ts`](../../packages/3-targets/3-targets/postgres/src/exports/migration.ts) lists the op factories themselves but not this helper). | User-authored op factories that want to match the framework's structure have to re-declare `step` (a 3-line function) verbatim. The PoC's `rls-ops.ts` does exactly this. The duplication is small but the *signal* is wrong — the factory looks like it's reaching for an internal pattern, when in fact it should be reaching for a public one. | Re-declare a private `step()` in [`examples/supabase-todos/migrations/utils/rls-ops.ts`](../../examples/supabase-todos/migrations/utils/rls-ops.ts). **Upstream fix sketch:** add `step` (and `targetDetails` from FL-07, and the `Op` type alias from FL-12) to `@prisma-next/target-postgres/migration` exports. Group with FL-07/FL-12 as one round of "expose the public op-authoring surface". | Open — surfaced in round-3 review. Trivial to fix upstream; blocks landing well-shaped third-party migration packs. |
| FL-09 | Prisma Next has no first-class DDL query builder. The runtime SQL lane has [`@prisma-next/sql-builder`](../../packages/2-sql/3-tooling/sql-builder/) (typed `select`/`insert`/`update`/`delete` builders with codec-aware bind parameters and identifier escaping); the migration system has no equivalent for `CREATE TABLE` / `ALTER TABLE` / `CREATE POLICY` / `CREATE INDEX` / etc. Framework-supplied op factories (createTable, addColumn, addForeignKey, …) build their SQL via per-op string builders in [`packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts), but these are op-specific (no `ddl.createPolicy(…)` or `ddl.alterPolicy(…)`); user-authored op factories drop straight to `rawSql` and string concatenation. | [`examples/supabase-todos/migrations/utils/rls-ops.ts`](../../examples/supabase-todos/migrations/utils/rls-ops.ts) contains substantial string concatenation: `parts.push('CREATE POLICY', quoteIdentifier(name), 'ON', tableRef, …)` for `createRlsPolicy`, similar for `alterRlsPolicy` and `dropRlsPolicy`. Identifier escaping is hand-rolled via `quoteIdentifier` + an `IDENT_PATTERN` regex re-declared in user code (FL-12). Predicate strings (`using`, `withCheck`, `condition`) are passed through verbatim — the framework offers no SQL fragment type or template-literal builder, so the only safety the user has is "trust that the predicate string is well-formed." | String concatenation with hand-rolled identifier escaping; predicate strings passed through as-is (the PoC accepts that policy predicates are author-authored Postgres expressions and not user input). **Upstream fix sketch:** introduce a `ddl` namespace at `@prisma-next/target-postgres/ddl` with builders mirroring Postgres DDL grammar — `ddl.createPolicy(name).on(schema, table).for('SELECT').to('authenticated').using(predicate).build()` returns a SQL string with identifier escaping built in. Builders should accept `quotedIdentifier(...)` / `predicate(...)` brand types so the type system can distinguish a quoted identifier from an arbitrary string. Cross-cuts with FL-10 (an RLS-specific policy DSL would compose on top of `ddl`). | Open — surfaced in round-3 review. Largest in scope of the FLs in this round; could span its own project. |
| FL-10 | Vanilla Postgres `CREATE POLICY` requires the author to know which predicate keyword applies to which command: `SELECT` and `DELETE` accept only `USING`; `INSERT` accepts only `WITH CHECK`; `UPDATE` accepts both (and they may differ — `USING` gates which rows are visible to update, `WITH CHECK` gates the post-update row shape); `ALL` accepts both. A naive policy DSL that exposes `using` and `withCheck` as parallel string fields forces every author to reason about this matrix at every call site, including for the common case where the same predicate gates both reads and writes. | Without a higher-level abstraction, every author must remember the matrix. Misuse is detected only at apply time (Postgres rejects `WITH CHECK` on a `SELECT` policy with a syntax error from the database). The PoC's first cut of `createRlsPolicy` exposed `using` and `withCheck` directly; round-3 review observed that ~70% of real RLS policies have read-predicate ≡ write-predicate (default-deny narrowed to a single ownership check), making the verbose form noise. | The PoC's [`createRlsPolicy`](../../examples/supabase-todos/migrations/utils/rls-ops.ts) factory adds a `condition` shorthand that fans out to the right keyword(s) per command — `SELECT`/`DELETE` → `USING`; `INSERT` → `WITH CHECK`; `UPDATE`/`ALL` → both — with mutual exclusion against `using` / `withCheck` (the author opts into the explicit pair only when the read and write predicates differ). [`SKILL.md` § 3](skills/writing-rls-policies-with-pn/SKILL.md#3-pick-using-vs-with-check-correctly) leads with `condition` and documents the explicit pair as the rare case. **Upstream fix sketch:** if/when the framework grows a policy DSL (cf. Sketch 3), the `condition` shorthand should be the default; the explicit `using`+`withCheck` pair should be the documented escape hatch for divergent UPDATE predicates. Cross-references FL-09 — the `ddl.createPolicy(...)` DSL should compose this matrix in. | Open — surfaced in round-3 review. Implemented in-example; no framework change required for the PoC. |
| FL-11 | The framework's migration system has no built-in surface for `ALTER POLICY` (Postgres' surgical RLS-policy update — change the role list, the `USING` predicate, or the `WITH CHECK` predicate without dropping and recreating the policy). The exported op factories cover `createTable` / `addColumn` / `dropConstraint` / etc. but not policy-level operations (FL-04 — `OperationClass` has no `'policy'` discriminant). | Without an `alterRlsPolicy` factory, the only way to change a policy in the framework is `dropRlsPolicy` + `createRlsPolicy` across two ops in the same migration. That works, but: (a) it's two ops (`ops.json` lists one drop + one create instead of one alter, polluting plan diffs); (b) there's a brief moment between the drop and the create where the policy doesn't exist (relevant if the migration runs against a live system without `BEGIN`/`COMMIT` framing); (c) the apply-time semantic is "remove and replace", not "change" — the planner can't reason about the op as a `'widening'` change. | The PoC's [`alterRlsPolicy`](../../examples/supabase-todos/migrations/utils/rls-ops.ts) factory mirrors Postgres' `ALTER POLICY` grammar — optional `to`, `using`, `withCheck`, and the `condition` shorthand from FL-10. Validation requires at least one clause; precheck asserts the policy exists in `pg_policies`; `operationClass: 'widening'` reflects the typical use (relax the predicate). [`SKILL.md` § 10](skills/writing-rls-policies-with-pn/SKILL.md#10-where-to-write-it-pn-specific) documents the factory and links here. **Upstream fix sketch:** add `alterRlsPolicy` (and the rest of the policy op family — `createRlsPolicy`, `dropRlsPolicy`, `enableRowLevelSecurity`) to the public op-factory surface alongside FL-04 (`'policy'` discriminant) and FL-09 (DDL builder). | Open — surfaced in round-3 review. Implemented in-example; would graduate to a framework op factory if Sketch 3 lands. |
| FL-12 | Two Postgres-canonical constructs are used by every user-authored migration op factory but are not exported from `@prisma-next/target-postgres/migration`: (a) the `Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>` type alias ([`packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts:7`](../../packages/3-targets/3-targets/postgres/src/core/migrations/operations/shared.ts)), which threads the Postgres-specific `target.details` generic so user factories don't have to; (b) the `IDENT_PATTERN` regex (Postgres unquoted-identifier shape, used to validate that a table/schema/policy/role name doesn't need quoting and isn't injecting SQL). Both are `Postgres-target` concepts that any consumer authoring custom DDL ops needs. | User code re-declares both. [`examples/supabase-todos/migrations/utils/rls-ops.ts`](../../examples/supabase-todos/migrations/utils/rls-ops.ts) declares its own `IDENT_PATTERN` and its own `Op` type alias at the top of the file. Each new third-party migration pack would do the same. Subtle correctness risk: any per-consumer re-declaration of an identifier validation regex risks drifting from the framework's interpretation of "valid Postgres identifier". | Re-declare per consumer. **Upstream fix sketch:** export `Op` (typed alias), `quoteIdentifier`, and `IDENT_PATTERN` (or a higher-level `validateIdentifier(name): asserts name is QuotedIdentifier` brand) from `@prisma-next/target-postgres/migration`. Group with FL-08 (export `step`) and FL-07 (export `targetDetails`) — they're all the same root cause: the public migration-authoring surface is sized for "use the framework's ops" rather than "compose your own ops". | Open — surfaced in round-3 review. Trivial to fix upstream; group with FL-07 / FL-08. |

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
