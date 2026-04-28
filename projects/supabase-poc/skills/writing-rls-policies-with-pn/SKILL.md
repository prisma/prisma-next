---
name: writing-rls-policies-with-pn
description: >-
  Author Postgres Row Level Security (RLS) policies in a Prisma Next codebase
  using PN's migration system. Use when adding, changing, or reviewing RLS in
  a PN-on-Postgres application — including: enabling RLS on a new table,
  adding/removing policies, onboarding a new role (e.g. anon, authenticated,
  a custom tenant role), or reviewing whether an existing policy is correct
  and complete. Also covers when *not* to use RLS, and the security
  best-practices a reviewer should look for.
---

# Writing RLS policies with Prisma Next

> **Status during the Supabase PoC:** finalised in phase-5.5. The skill
> lives at [`projects/supabase-poc/skills/`](../../) until the project
> closes out, then migrates to `.claude/skills/writing-rls-policies-with-pn/`
> with relative-link fixups (plan task `C.3`).

RLS is Postgres's built-in mechanism for restricting which rows a query can see / write, based on the connection's role and session state (`request.jwt.claims`, `current_setting(...)`, etc.). In a PN-on-Postgres app you author RLS in **migration files** using the `enableRowLevelSecurity` / `createRlsPolicy` / `dropRlsPolicy` factories, and you make it *enforced at request time* via a runtime that scopes each request to the right role + claims (e.g. `createSupabaseRuntime` in `examples/supabase-todos/`).

This skill is opinionated. Where Postgres allows multiple shapes, the skill picks one and explains why.

---

## 1. When to use RLS, and when not

**Use RLS when:**

- Multiple users share a database and rows are owned by users / tenants / orgs (the canonical case).
- You want defense-in-depth: even if a query handler forgets a `WHERE user_id = ?` clause, the database still doesn't return other users' rows.
- Your client-side library expects it (Supabase's `supabase-js`, PostgREST, etc. assume RLS is on).

**Don't reach for RLS when:**

- The app is single-user (a CLI tool, an admin dashboard with one operator).
- The cost of policy evaluation per row is prohibitive on a hot read path. (RLS predicates run for every row touched by every query. Indexes help; complex policies that join can hurt.) If you've measured this and it matters, prefer explicit filters + a separate role / connection per tenant.
- You're using RLS as a substitute for application-layer authorization on cross-cutting concerns (e.g. "can this user invite collaborators"). RLS is good at "which rows," not "which actions." Authz lives at the API layer.

**Worth flagging in this category: hot anon read paths.** RLS plus a per-request scoped runtime adds an envelope cost on every request — the PoC's [`createSupabaseRuntime`](../../../examples/supabase-todos/src/server/supabase-runtime.ts) wraps each plan in `BEGIN; SET LOCAL request.jwt.claims …; SET LOCAL ROLE …; <plan>; COMMIT`, which is sub-millisecond against local Postgres but ~4 round-trips of overhead against networked Postgres. For low-traffic public endpoints (the PoC's `GET /api/public/messages`) this is invisible; for hot anon reads at scale the overhead can dominate the actual query cost. The architectural fix is connection-scope mode ([FL-18](../../framework-limitations.md#fl-18) / [FL-19](../../framework-limitations.md#fl-19)); the practical fix is an HTTP-layer cache above the handler. Neither argues *against* RLS — RLS is still the right correctness story — but a reviewer should call out unbounded RLS on hot public paths as a perf-shaped risk.

---

## 2. Mandatory steps when adding RLS to a table

Always in this order, in the same migration:

1. **`enableRowLevelSecurity('public', 'todos')`.** Without this, policies do nothing and the table is wide open.
2. **One `createRlsPolicy(...)` per command** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) you want to allow. Don't use `command: 'ALL'`; it forces the same predicate to serve as both `USING` and `WITH CHECK`, which is almost never what you want for `UPDATE`. (See § 3.)
3. **Set `to`** explicitly. Default is `PUBLIC`, which means "every role including future ones" — almost never the right answer.
4. **Verify with a test.** A migration without a paired test that authenticates as user A and confirms B's rows aren't visible is incomplete. (See § 8.)

```ts
// in migrations/<ts>_initial/migration.ts
enableRowLevelSecurity('public', 'todos'),
createRlsPolicy({
  schema: 'public', table: 'todos', name: 'todos_select_own',
  command: 'SELECT', to: ['authenticated'],
  condition: '(user_id = auth.uid())',
}),
// ... INSERT, UPDATE, DELETE policies follow
```

The `condition` shorthand picks the right Postgres keyword for you: `USING` for `SELECT` and `DELETE`, `WITH CHECK` for `INSERT`, both for `UPDATE` and `ALL`. Use the explicit `using` + `withCheck` pair only for the rare `UPDATE` case where the read and write predicates differ (see § 3 for that escape hatch).

**Default-deny is implicit.** An RLS-enabled table with no matching policy returns zero rows for the role in question. This is a feature: if you forget to add an `INSERT` policy, inserts fail loudly rather than silently writing rows nobody can read.

---

## 3. `USING` vs `WITH CHECK` on `UPDATE` (the most common bug)

Postgres' rule, expressed in terms of `createRlsPolicy`'s API:

- `SELECT` and `DELETE` accept only `USING` (which rows are visible).
- `INSERT` accepts only `WITH CHECK` (which rows are valid to insert).
- `UPDATE` accepts **both**:
  - `USING` decides which rows the user is allowed to **see and target** for update.
  - `WITH CHECK` decides what the row must look like **after** the change.

**Default to `condition`.** When the same predicate gates both the read and the write — the common case for ownership-style policies — use the `condition` shorthand. The factory fans out to the right keyword(s) for the command:

```ts
createRlsPolicy({
  schema: 'public', table: 'todos', name: 'todos_update_own',
  command: 'UPDATE', to: ['authenticated'],
  condition: '(user_id = auth.uid())',  // becomes USING + WITH CHECK
}),
```

That policy says: a user can target rows they own *and* the post-update row must still be theirs (no ownership transfer). The fan-out is mechanical: same predicate either side.

**Reach for the explicit pair only when the predicates diverge.** The rare case is an `UPDATE` policy where the user can read more rows than they can write to (or vice versa). Then the `condition` shorthand is wrong — there are *two* predicates, and they need to be authored separately:

```ts
createRlsPolicy({
  schema: 'public', table: 'todos', name: 'todos_update_within_org',
  command: 'UPDATE', to: ['authenticated'],
  using: '(org_id = current_setting(\'app.current_org\')::uuid)',         // any row in your org is visible
  withCheck: '(user_id = auth.uid())',                                     // but you can only end up owning your own
}),
```

Mixing `condition` with `using` or `withCheck` in the same call is a factory error (mutual exclusion). Either you have one predicate (use `condition`) or you have two (use the explicit pair). If you only set `using` and leave `withCheck` unset, Postgres **defaults `WITH CHECK` to `USING`** — but in that case use `condition`, which makes the intent legible at the call site.

Worked example in the PoC: the `todos_update_own` policy in [`examples/supabase-todos/migrations/20260428T0354_initial/migration.ts`](../../../examples/supabase-todos/migrations/20260428T0354_initial/migration.ts) uses `condition` because the same ownership check gates both reads and writes.

The PoC's migration uses `condition` exclusively (every policy gates reads and writes with the same predicate), so there is no in-tree test for the divergent-UPDATE shape. If you author one, pair it with a test that *both* lets a permitted divergent update through *and* rejects a write that violates `withCheck` while satisfying `using` — the asymmetry is the only thing the explicit pair buys you, so the test must exercise it.

---

## 4. Role targeting

Always set `to`. Common values for Supabase-style apps:

| Audience | `to` |
|---|---|
| Logged-in users only | `['authenticated']` |
| Public read | `['anon', 'authenticated']` |
| Public write (rare; usually you want signup-then-write) | `['anon', 'authenticated']` |
| A specific custom tenant role | `['tenant_admin']` |

Don't use `to: undefined` (which renders as `PUBLIC`). It applies to every role, including roles that don't exist yet, which makes the policy's blast radius unauditable.

Worked example in the PoC: `public_messages_select_public` in [`examples/supabase-todos/migrations/20260428T0354_initial/migration.ts`](../../../examples/supabase-todos/migrations/20260428T0354_initial/migration.ts) targets `['anon', 'authenticated']` for a public read; the paired `public_messages_insert_own` targets `['authenticated']` only and `withCheck`s `(author_id = (auth.uid())::text)`. Two roles for the read, one for the write — that's the standard "publicly readable, authored-by-account" shape.

---

## 5. Service-role usage

The `service_role` (or any superuser-equivalent) **bypasses RLS entirely**. This is correct for migrations, seeds, and admin scripts that need unconditional access. It is wrong for request handlers — using `service_role` for user-facing reads invalidates the entire RLS story without warning anyone.

**Pattern:**

- One PN runtime bound to `service_role` for `migrate:up` / seed / admin tasks.
- One PN runtime per request scoped to the requester's role + claims via the runtime factory (this PoC's `createSupabaseRuntime`).

The `examples/supabase-todos/` server is set up this way: see [`src/server/db.ts`](../../../examples/supabase-todos/src/server/db.ts) (admin runtime) and [`src/server/supabase-runtime.ts`](../../../examples/supabase-todos/src/server/supabase-runtime.ts) (per-request scoped runtime).

> _Path note: cross-links above are correct after close-out (skill at `.claude/skills/writing-rls-policies-with-pn/`). During the PoC they resolve from `projects/supabase-poc/skills/writing-rls-policies-with-pn/`. Path fixup happens in close-out task C.3._

---

## 6. `auth.uid()` and anon

`auth.uid()` returns `NULL` for unauthenticated requests (the `anon` role with no JWT). This interacts predictably with the patterns above:

| Place | `(user_id = auth.uid())` evaluates to | Effect |
|---|---|---|
| `using` on `SELECT` / `UPDATE` / `DELETE` | `NULL` (treated as not-true) | Zero rows visible. Good — anon can't see user data. |
| `withCheck` on `INSERT` | `NULL` (treated as not-true) | Insert fails loudly. Good — prevents anon from creating "user-owned" rows. |

If you want anon to be able to read public rows, write a separate `SELECT` policy with `to: ['anon', 'authenticated']` and a predicate that doesn't depend on `auth.uid()` (e.g. `using: 'true'` for fully-public, or `using: '(visibility = ''public'')'` for conditional).

### Casting `auth.uid()` when storage types don't natively match

`auth.uid()` returns Postgres `uuid`. If the column it's compared against is **not** `uuid` — most commonly because the contract was authored with `field.uuid()`, which lowers to `character(36)` (FL-03) — the comparison needs an explicit cast. **Cast on the function side, once per query:**

```ts
condition: '(user_id = (auth.uid())::text)',
```

Why this direction:

- `auth.uid()::text` is evaluated once per query; per-row casts (`user_id::uuid`) defeat any index on `user_id` and run the cast for every row touched.
- `char(N)` ↔ `text` comparison is a standard implicit coercion in Postgres (the column is auto-coerced to `text`), so no per-row work is added on the column side.
- Postgres normalizes the predicate to `((user_id)::text = (auth.uid())::text)` in `pg_policies.qual` — that's the rewriter, not extra runtime cost.

If the column is already `uuid` in storage, omit the cast. Use the cast pattern only as a bridge while the contract keeps `char(36)`. See FL-03 for context and the option of authoring a custom `ColumnTypeDescriptor` to declare `uuid` in the contract directly.

---

## 7. Performance

Rules of thumb (per-row predicate cost):

- **Index every column referenced by `using` / `withCheck`.** Without an index, every row is read and tested.
- **Wrap `auth.uid()` in `(SELECT auth.uid())`.** Per Supabase performance guidance, this lets the planner cache the result for the query rather than re-evaluating per row.
- **Avoid joining inside policies.** A join in `using` runs per row touched. If you need cross-table authorization, consider denormalizing the discriminator (`tenant_id`) onto the table and indexing it.
- **Watch composite policies.** Multiple `PERMISSIVE` policies on the same table-command pair are `OR`-ed; multiple `RESTRICTIVE` are `AND`-ed. Stacking many policies multiplies evaluation cost.

**Costs surfaced by this PoC** (none are RLS-predicate-shaped; they are *runtime envelope* costs that RLS forces a per-request scoped runtime to pay):

- **Per-request transaction envelope.** Transaction-scope mode pays `BEGIN; SET LOCAL request.jwt.claims …; SET LOCAL ROLE …; <plan>; COMMIT` on every plan — ~4 round-trips of setup/teardown beyond the SELECT itself. Sub-millisecond against local Postgres; measurable against any networked Postgres. The architectural fix is connection-scope mode ([FL-18](../../framework-limitations.md#fl-18) / [FL-19](../../framework-limitations.md#fl-19) / [Sketch 1](../../framework-limitations.md#sketch-1--scoped-session-spi)).
- **Marker-verification frequency.** Each `factory.authenticate(...)` constructs a fresh runtime instance, so the contract marker query runs once per session rather than once per process. Cosmetic at low concurrency; under burst traffic the marker queries roughly double back-channel pool pressure ([FL-17](../../framework-limitations.md)). The PoC's [`factory.test.ts:201` 50-parallel-sessions test](../../../examples/supabase-todos/test/runtime/factory.test.ts) exercises this path and passes; it asserts identity isolation, not back-channel volume.

These are observations, not measured benchmarks — the PoC scope stopped at "the architectural shape works"; quantitative numbers are a follow-up project's deliverable.

---

## 8. Testing your policies

Pattern: a vitest matrix that runs each policy claim against multiple authenticated identities. The `examples/supabase-todos/` PoC is the reference.

```ts
describe('todos RLS', () => {
  for (const { name, claims, expectedCount } of [
    { name: 'alice sees only her todos', claims: aliceClaims, expectedCount: 2 },
    { name: 'bob sees only his todos',   claims: bobClaims,   expectedCount: 3 },
    { name: 'anon sees none',            claims: null,        expectedCount: 0 },
  ]) {
    it(name, async () => {
      const session = factory.authenticate({ jwtClaims: claims, role: claims ? 'authenticated' : 'anon' });
      const rows = [];
      for await (const row of session.execute(selectAllTodos)) rows.push(row);
      expect(rows).toHaveLength(expectedCount);
    });
  }
});
```

Always include **negative tests** alongside positive ones — try to insert a row with someone else's `user_id`, try to read another user's todo by ID, try to update a row you don't own. The negative test failing (i.e. the operation *succeeding* when it shouldn't) is the most common signal that a policy is missing or asymmetric.

The PoC's reference suite is split across two files:

- [`examples/supabase-todos/test/runtime/factory.test.ts`](../../../examples/supabase-todos/test/runtime/factory.test.ts) — RLS-isolation matrix at the runtime layer (`alice sees only alice's todos`, `bob sees only bob's`, `anon sees none`), parallel-scope leakage (50 concurrent sessions), pool exhaustion + recovery, mid-stream rollback. This is the integration spec for `createSupabaseRuntime` and the proof that RLS is doing the filtering rather than handler code.
- [`examples/supabase-todos/test/server/routes/todos.test.ts`](../../../examples/supabase-todos/test/server/routes/todos.test.ts) — cross-user-leakage at the HTTP layer (alice asks for bob's row by id → 404; alice tries to PATCH bob's row → 404), via real Hono requests. The negative tests are explicitly load-bearing here: a passing positive test is satisfied if the handler over-returns; only the negative test catches "RLS is off and the handler is leaking everyone's todos."

---

## 9. Common anti-patterns

Each entry below is a footgun observed either in the wild or during this PoC. Reviewers should flag any of these.

- **Forgotten `ENABLE ROW LEVEL SECURITY`.** Policies attached to a table that doesn't have RLS enabled are silently inert. Always pair the two in the same migration.
- **`command: 'ALL'` on a non-trivial table.** Forces a single predicate to serve `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `USING`, and `WITH CHECK`. Almost never correct; always re-write as four explicit policies.
- **`UPDATE` policy with `using` set but `withCheck` unset.** Defaults to `using`, but the intent is invisible. Write both.
- **Application-layer `WHERE user_id = ?` clauses on RLS-protected tables.** They're not wrong, but they shadow RLS — if RLS later breaks (e.g. someone disables it during a migration), you won't notice. Prefer to let RLS do the filtering and assert "no manual `user_id` filter" in code review.
- **`SECURITY DEFINER` functions called from policies.** They run as their owner, bypassing the caller's RLS. Almost always a mistake when used inside policies; use sparingly and audit.
- **Granting `service_role` to a connection used by request handlers.** Bypasses RLS unconditionally. The runtime factory pattern exists specifically to prevent this; use it.
- **Treating RLS as the only defense.** RLS is a row-visibility layer, not an authorization framework. Action-level concerns (who can invite, who can change billing) belong in the API.
- **Policies over views.** Postgres treats views as security-definer-by-default unless created with `WITH (security_invoker = true)`. Surprising; check `pg_views` if a view-backed query returns more rows than expected.
- **Trusting the executable bit on a freshly-scaffolded migration.** `prisma-next migration plan` writes `migration.ts` with `#!/usr/bin/env -S node` and mode `0755`, but `node` cannot load `.ts` directly — `./migrations/<ts>_<slug>/migration.ts` fails with `ERR_MODULE_NOT_FOUND`. Always invoke via `pnpm exec tsx <path>` or `pnpm --filter <example> migrate:up`. Tracked as [FL-05](../../framework-limitations.md#migration-authoring).

> _Maintenance note (R-FK-6): when the next project that uses this skill surfaces a fresh anti-pattern, append it here on the same commit that lands the workaround. The PoC's continuous-capture pass closed in phase-5.5 with the executable-bit footgun above as the most recent addition._

---

## 10. Where to write it (PN-specific)

Author RLS in PN migration files using the migration factories, not as raw `supabase/migrations/*.sql`. Use the **scaffold-and-edit** workflow — let the framework do what it can from the contract, then append the RLS bolt-on by hand.

### The scaffold-and-edit workflow

1. **Scaffold from the contract.** From the example root, run `pnpm exec prisma-next migration plan --name <slug>`. The planner reads the emitted contract and writes `migrations/<ts>_<slug>/migration.ts` populated with the `createTable` / `addColumn` / `addForeignKey` / etc. ops it can derive. No hand-typing of column shapes.
2. **Edit to add the RLS bolt-on.** Open the scaffolded `migration.ts` and append calls to `enableRowLevelSecurity` and `createRlsPolicy` for the affected tables. RLS metadata is invisible to the contract IR (FL-01, planner-side facet), so the planner cannot emit these — the author does. Cross-link FL-01 in the migration's docblock so the next reviewer knows why the migration has hand-edits past the planner-emitted ops.
3. **Re-attest.** Run `pnpm exec tsx migrations/<ts>_<slug>/migration.ts` (or `pnpm migrate:up` which goes through `prisma-next migration apply`) to re-derive `ops.json` and `migration.json` from the edited body. Use `tsx`, not `node` directly — the file is TypeScript and Node's ESM loader doesn't compile `.ts` (`ERR_MODULE_NOT_FOUND`).

For migrations that exist purely to add or change RLS (no contract change), use `pnpm exec prisma-next migration new --name <slug>` instead — it scaffolds an empty `migration.ts` ready for hand-authored ops only.

### File shape after step 2

The scaffolded file already has the `Migration` class, `MigrationCLI.run(...)` footer, and the planner-derived ops. Your edits add the RLS imports and the bolt-on ops:

```ts
import { createTable, addForeignKey, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
// In-example for now (PoC); will be upstreamed if Sketch 3 of framework-limitations.md is adopted.
import { createRlsPolicy, dropRlsPolicy, enableRowLevelSecurity } from '../utils/rls-ops';

export default class M extends Migration {
  override get operations() {
    return [
      createTable(/* ... */),
      addForeignKey(/* ... */),
      enableRowLevelSecurity('public', 'todos'),
      createRlsPolicy({ /* ... */ }),
      // ...
    ];
  }
}
MigrationCLI.run(import.meta.url, M);
```

Apply with `pnpm --filter <example> migrate:up`. Use the **service-role** URL for `migrate:up` (RLS bypass needed to `ALTER TABLE … ENABLE ROW LEVEL SECURITY`).

Working reference: [`examples/supabase-todos/migrations/20260428T0354_initial/migration.ts`](../../../examples/supabase-todos/migrations/20260428T0354_initial/migration.ts) — three `createTable`s scaffolded by `migration plan`, three `enableRowLevelSecurity`s and eight `createRlsPolicy`s appended by hand. The docblock at the top documents the workflow narrative (which ops are CLI-derived, which are the hand-authored bolt-on) and the two intentional non-features (no `alterColumnType` to native `uuid`, no FK to `auth.users`), with cross-links to FL-01 / FL-02 / FL-03.

### Changing an existing policy

Use `alterRlsPolicy` for surgical updates — change the role list, the `USING` predicate, or the `WITH CHECK` predicate without dropping and recreating the policy:

```ts
import { alterRlsPolicy } from '../utils/rls-ops';

export default class M extends Migration {
  override get operations() {
    return [
      alterRlsPolicy({
        schema: 'public', table: 'todos', name: 'todos_select_own',
        condition: '(user_id = (auth.uid())::text OR org_id = current_setting(\'app.current_org\')::uuid)',
      }),
    ];
  }
}
```

Pass only the fields you want to change. The factory's precheck asserts the policy exists in `pg_policies`; if it doesn't, the migration aborts with `precheck failed` rather than silently creating it. Use `condition` when the same predicate gates both reads and writes (it fans out to both `USING` and `WITH CHECK` because `ALTER POLICY` doesn't carry a `command` slot — the original `CREATE POLICY` already chose); use the explicit `using` + `withCheck` pair to set them independently.

`alterRlsPolicy` is an in-example factory in [`examples/supabase-todos/migrations/utils/rls-ops.ts`](../../../examples/supabase-todos/migrations/utils/rls-ops.ts) — Prisma Next has no built-in surface for `ALTER POLICY` (FL-11). The fallback if `alterRlsPolicy` isn't available is `dropRlsPolicy(...)` followed by `createRlsPolicy(...)` in the same migration.

---

## 11. Known framework gaps the skill has to live with

These are recorded in [`framework-limitations.md`](../../framework-limitations.md). The skill's advice is shaped by them; if any are closed in follow-up work, **edit this skill** to remove the workaround.

- **No contract-level RLS metadata** (FL-01). Policies aren't expressed in `schema.psl` / the TS DSL contract. The migration hand-authors `enableRowLevelSecurity` / `createRlsPolicy` calls. (Sketch 3.)
- **`OperationClass` is closed** (FL-04). The `target.details.objectType` of policy ops falls back to `'dependency'`, losing semantic precision in planner output. (Sketch 3.)
- **No cross-schema FK in the contract DSL — major** (FL-02). The contract has no way to express `REFERENCES auth.users(id) ON DELETE CASCADE`. A `rawSql` FK can be authored in a migration, but the apply-time schema verifier rejects it as `extra_foreign_key` and rolls the apply back. **The PoC therefore omits the FK entirely** and relies on application-side conventions (seed inserts the auth user first; `INSERT` policies' `withCheck` enforces `author = auth.uid()`). **A real Supabase-on-PN production app cannot ship without this gap closed** — it would lose `ON DELETE CASCADE` cleanup and DB-level guarantees that user-owning columns reference real users.
- **`field.uuid()` is `char(36)`, not pg `uuid`** (FL-03). The portable `field.uuid()` callback helper lowers to `sql/char@1` with `length: 36`. The contract therefore declares `character(36)`, and the apply-time verifier enforces that — `alterColumnType` to native `uuid` is rejected as `type_mismatch`. Two options: (a) keep `char(36)` end-to-end and bridge to `auth.uid()` (which is `uuid`) by casting on the function side in policy bodies (`(<col> = (auth.uid())::text)` — see § 6); or (b) use the structural DSL with a custom `ColumnTypeDescriptor` of `{ codecId: 'pg/uuid@1', nativeType: 'uuid' }` so the contract itself declares `uuid`. The PoC takes option (a) so the contract stays target-portable.
- **No first-class scoped-session SPI.** Per-request RLS context is threaded via a userspace runtime factory (this PoC's `createSupabaseRuntime`). (Sketch 1.)
- **No subscription lane.** Realtime change streams against RLS-protected tables go through `supabase-js` directly, not PN. (Sketch 2.)
- **No DDL query builder + no public op-authoring surface** (FL-06 — `rawSql` collides with the runtime builder name; FL-07 — `PostgresPlanTargetDetails` opaque; FL-08 — `step` not exported; FL-09 — no DDL builder; FL-12 — `Op` alias not exported, no strict `validateIdentifier` exposed alongside the permissive `quoteIdentifier`). User-authored migration op factories like the in-example RLS family use string concatenation, re-declare framework-internal helpers, and ship their own identifier-validation regex on top of `quoteIdentifier`. The fallback today is what the PoC does in [`examples/supabase-todos/migrations/utils/rls-ops.ts`](../../../examples/supabase-todos/migrations/utils/rls-ops.ts); none of these block correctness.
- **No policy DSL, no built-in `ALTER POLICY`** (FL-10 — `condition` shorthand is in-example; FL-11 — `alterRlsPolicy` is in-example). The PoC's RLS factories add both as conveniences over raw `CREATE POLICY` / `ALTER POLICY` SQL. If the framework grows a policy DSL (Sketch 3), the same shape — `condition` shorthand, surgical `alter` — should be the default.

---

## Cross-references

- [`projects/supabase-poc/spec.md`](../../spec.md) — full PoC spec, including the design of the migration factories and the runtime factory.
- [`projects/supabase-poc/framework-limitations.md`](../../framework-limitations.md) — gaps and design sketches this skill cross-references.
- [`examples/supabase-todos/`](../../../examples/supabase-todos/) — working reference application.
- [`@prisma-next/target-postgres/migration`](../../../packages/3-targets/3-targets/postgres/src/exports/migration.ts) — public migration surface (where the standard factories like `createTable` live, and where the RLS factories belong if Sketch 3 lands).
- Supabase RLS docs: <https://supabase.com/docs/guides/auth/row-level-security>
- Supabase RLS performance: <https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations>
