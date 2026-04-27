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

> **Status during the Supabase PoC:** this skill is being authored under
> [`projects/supabase-poc/skills/`](../../) and lives there until the project
> closes out. It will migrate to `.claude/skills/writing-rls-policies-with-pn/`
> at close-out (plan task `C.3`). Sections marked **`TODO: populate ...`** are
> filled in during the milestones noted; do not finalize until 5.5.

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

> _TODO: populate during M2/M5 — if the PoC surfaces a concrete throughput or correctness pitfall worth promoting to a primary "don't use" rule, name it here._

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
  using: '(user_id = auth.uid())',
}),
// ... INSERT, UPDATE, DELETE policies follow
```

**Default-deny is implicit.** An RLS-enabled table with no matching policy returns zero rows for the role in question. This is a feature: if you forget to add an `INSERT` policy, inserts fail loudly rather than silently writing rows nobody can read.

---

## 3. `USING` vs `WITH CHECK` on `UPDATE` (the most common bug)

For `SELECT` and `DELETE`: only `using` matters (which rows are visible).
For `INSERT`: only `withCheck` matters (which rows are valid to insert).
For `UPDATE`: **both** matter, and they're different.

- `using` decides which rows the user is allowed to **see and target** for update.
- `withCheck` decides what the row must look like **after** the change.

Asymmetric example: a user can update their own todo, but cannot transfer ownership to someone else.

```ts
createRlsPolicy({
  schema: 'public', table: 'todos', name: 'todos_update_own',
  command: 'UPDATE', to: ['authenticated'],
  using: '(user_id = auth.uid())',          // can target rows they own
  withCheck: '(user_id = auth.uid())',      // result must still be theirs
}),
```

If you only set `using` and leave `withCheck` unset, Postgres **defaults `WITH CHECK` to `USING`** — but in this case you should still write both explicitly so the intent is unambiguous to the next reader. The pattern "only `using` set" is a code-review smell on `UPDATE` policies.

> _TODO: populate during M4 — link to the example test that covers the asymmetric-policy case once it's written._

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

---

## 7. Performance

> _TODO: populate during M2 with concrete numbers from the PoC's stress-run tests._

Rules of thumb until evidence says otherwise:

- **Index every column referenced by `using` / `withCheck`.** Without an index, every row is read and tested.
- **Wrap `auth.uid()` in `(SELECT auth.uid())`.** Per Supabase performance guidance, this lets the planner cache the result for the query rather than re-evaluating per row.
- **Avoid joining inside policies.** A join in `using` runs per row touched. If you need cross-table authorization, consider denormalizing the discriminator (`tenant_id`) onto the table and indexing it.
- **Watch composite policies.** Multiple `PERMISSIVE` policies on the same table-command pair are `OR`-ed; multiple `RESTRICTIVE` are `AND`-ed. Stacking many policies multiplies evaluation cost.

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

> _TODO: link to the actual test file once written, e.g. `examples/supabase-todos/test/runtime/rls.test.ts`._

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

> _TODO: as M2–M4 surface additional anti-patterns, append them here on the same commit that introduces the workaround. (R-FK-6.)_

---

## 10. Where to write it (PN-specific)

Author RLS in PN migration files using the migration factories, not as raw `supabase/migrations/*.sql`:

```ts
import { createTable, addForeignKey, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
// In-example for now (PoC); will be upstreamed if Sketch 3 of framework-limitations.md is adopted.
import { createRlsPolicy, dropRlsPolicy, enableRowLevelSecurity } from '../../src/db/migrations/rls-ops';

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

Run with `pnpm --filter <example> migrate:up`. Use the **service-role** URL for `migrate:up` (RLS bypass needed to `ALTER TABLE … ENABLE ROW LEVEL SECURITY`).

Working reference: [`examples/supabase-todos/migrations/<ts>_initial/migration.ts`](../../../examples/supabase-todos/migrations/) (after PoC M1 lands).

---

## 11. Known framework gaps the skill has to live with

These are recorded in [`framework-limitations.md`](../../framework-limitations.md). The skill's advice is shaped by them; if any are closed in follow-up work, **edit this skill** to remove the workaround.

- **No contract-level RLS metadata.** Policies aren't expressed in `schema.psl` / the TS DSL contract. The migration is hand-edited to add `enableRowLevelSecurity` / `createRlsPolicy` calls. (Sketch 3.)
- **`OperationClass` is closed.** The `target.details.objectType` of policy ops falls back to `'dependency'`, losing semantic precision in planner output. (Sketch 3.)
- **No first-class scoped-session SPI.** Per-request RLS context is threaded via a userspace runtime factory (this PoC's `createSupabaseRuntime`). (Sketch 1.)
- **No subscription lane.** Realtime change streams against RLS-protected tables go through `supabase-js` directly, not PN. (Sketch 2.)

---

## Cross-references

- [`projects/supabase-poc/spec.md`](../../spec.md) — full PoC spec, including the design of the migration factories and the runtime factory.
- [`projects/supabase-poc/framework-limitations.md`](../../framework-limitations.md) — gaps and design sketches this skill cross-references.
- [`examples/supabase-todos/`](../../../examples/supabase-todos/) — working reference application.
- [`@prisma-next/target-postgres/migration`](../../../packages/3-targets/3-targets/postgres/src/exports/migration.ts) — public migration surface (where the standard factories like `createTable` live, and where the RLS factories belong if Sketch 3 lands).
- Supabase RLS docs: <https://supabase.com/docs/guides/auth/row-level-security>
- Supabase RLS performance: <https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations>
