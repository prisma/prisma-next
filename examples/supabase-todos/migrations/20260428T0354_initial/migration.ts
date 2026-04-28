#!/usr/bin/env -S node
/**
 * Initial migration for the supabase-todos PoC.
 *
 * Sets up three tables (`profiles`, `todos`, `public_messages`),
 * enables RLS on each, and authors the policies that scope per-request
 * reads / writes to the authenticated user.
 *
 * ## Authoring workflow (CLI-first; FL-01 worked example)
 *
 * Per the project's [CLI-first migration authoring rule]
 * (../../../../projects/supabase-poc/plan.md#working-rules-for-this-project),
 * this file was scaffolded by the framework and then edited:
 *
 *  1. **Scaffold from the contract.** From `examples/supabase-todos/`,
 *     `pnpm exec prisma-next migration plan --name initial` reads the
 *     emitted contract (`src/db/contract.json`) and writes the three
 *     `createTable` ops below — schema name, column list, types, and
 *     `PRIMARY KEY` constraint all derived from the contract IR. No
 *     hand-typing of column shapes. The planner is the source of truth
 *     for everything the contract IR can express.
 *  2. **Edit to add the RLS bolt-on.** RLS metadata is not in the
 *     contract IR (FL-01, planner-side facet — see
 *     `framework-limitations.md`), so the planner cannot emit
 *     `enableRowLevelSecurity` / `createRlsPolicy` calls. We append
 *     them by hand, calling the in-example RLS factories from
 *     `migrations/utils/rls-ops.ts`. This is the "edit" half of
 *     scaffold-and-edit.
 *  3. **Re-attest.** `pnpm exec tsx migrations/20260428T0354_initial/migration.ts`
 *     (or `pnpm migrate:up` which goes through `prisma-next migration apply`)
 *     re-derives `ops.json` from the edited body and re-attests the
 *     package on disk. Run via `tsx`, not `node` — the file is
 *     TypeScript and Node's ESM loader doesn't compile `.ts` directly
 *     (`ERR_MODULE_NOT_FOUND`).
 *
 * The scaffolded `'bool'` (Postgres canonical) for `todos.completed`
 * is left as-is — it's identical to `'boolean'` semantically and
 * matches what the planner emits for any future migration touching
 * that column.
 *
 * ## Storage column convention
 *
 * The contract (`src/db/schema.ts`) sets `naming: { columns:
 * 'snake_case' }`, so storage column names match Supabase / Postgres
 * convention (`user_id`, `author_id`, `display_name`, `created_at`).
 * RLS policy SQL is interpolated verbatim by `createRlsPolicy`
 * (R-FM-3), so this lets the policies read like the Supabase docs
 * without quoted-identifier gymnastics.
 *
 * ## Why no `alterColumnType`-to-`uuid` and no FK to `auth.users`
 *
 * Both omissions are framework-expressivity gaps surfaced by this
 * migration; both are documented in `framework-limitations.md`.
 *
 *  - **No `alterColumnType` to native `uuid`.** `field.uuid()` lowers
 *    to `sql/char@1` with `length: 36`, i.e. Postgres `character(36)`
 *    (FL-03). The planner therefore emits `character(36)` for the
 *    `id` / `user_id` / `author_id` columns above. The runner's
 *    apply-time schema verify (the framework's contract guarantee)
 *    compares the introspected DB IR against the contract storage IR;
 *    an `ALTER COLUMN ... TYPE uuid` would diverge from the contract's
 *    declared `character(36)` and the apply transaction would roll
 *    back with `PN-RUN-3000` / `type_mismatch`. So we keep `char(36)`
 *    end-to-end and bridge to `auth.uid()` (which is `uuid`) by
 *    casting on the function side inside the policy bodies — see
 *    SKILL.md § 6.
 *
 *  - **No `REFERENCES auth.users(id) ON DELETE CASCADE`.** The
 *    contract DSL has no surface for cross-schema FKs (FL-02,
 *    **major**). A `rawSql` FK can be authored, but the resulting
 *    constraint is not in the contract and the verifier reports it as
 *    `extra_foreign_key`. The PoC therefore omits the constraint
 *    entirely. Trade-off: `todos.user_id`, `profiles.id`, and
 *    `public_messages.author_id` carry no DB-level guarantee of
 *    pointing at a real auth user, and `ON DELETE CASCADE` cleanup is
 *    unavailable; integrity is enforced by convention (the seed
 *    inserts the auth user first and uses the returned id) and by the
 *    `INSERT` policies' `withCheck` predicate (`(user_id =
 *    auth.uid()::text)`). **A real production app cannot ship without
 *    this gap closed** — see the elevated FL-02 entry.
 *
 * ## Operation order
 *
 * 1. `createTable` for the three public tables. CLI-scaffolded from
 *    the contract; emitted alphabetically by table name (planner
 *    convention). Columns within each table are also alphabetical.
 * 2. `enableRowLevelSecurity` for each table. Without this, policies
 *    are silently inert (SKILL.md § 2 / § 9). RLS metadata is not
 *    tracked by the contract IR (FL-01), so these ops are invisible
 *    to the verifier and apply cleanly.
 * 3. `createRlsPolicy` per table-command. One factory call per
 *    command, never `ALL` (SKILL.md § 2). For `UPDATE` we set both
 *    `using` and `withCheck` (SKILL.md § 3) so a user cannot reassign
 *    ownership in the same write that they're permitted to make.
 *
 * ## Re-running
 *
 * The migration is single-shot. Re-applying against a populated DB
 * will fail in the appropriate precheck (e.g. `ensure table "todos"
 * does not exist`). To get back to a clean slate during PoC
 * development, run `supabase db reset` from `examples/supabase-todos/`
 * — this rebuilds the local stack from scratch (clears all data;
 * acceptable for the PoC). For partial cleanups, drop the three
 * tables manually via `psql` and re-run.
 */
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import { createRlsPolicy, enableRowLevelSecurity } from '../utils/rls-ops';

const SCHEMA = 'public';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:empty',
      to: 'sha256:fe91b8eca8cca26d430660e7659b53f9db1dfb6601a0b74b111460b6bf53940c',
    };
  }

  override get operations() {
    return [
      // --- createTable ops: scaffolded by `prisma-next migration plan`. ---
      createTable(
        SCHEMA,
        'profiles',
        [
          {
            name: 'created_at',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'display_name', typeSql: 'text', defaultSql: '', nullable: true },
          { name: 'email', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createTable(
        SCHEMA,
        'public_messages',
        [
          { name: 'author_id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          { name: 'body', typeSql: 'text', defaultSql: '', nullable: false },
          {
            name: 'created_at',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      createTable(
        SCHEMA,
        'todos',
        [
          { name: 'completed', typeSql: 'bool', defaultSql: '', nullable: false },
          {
            name: 'created_at',
            typeSql: 'timestamptz',
            defaultSql: 'DEFAULT (now())',
            nullable: false,
          },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
          { name: 'title', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'user_id', typeSql: 'character(36)', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),

      // --- RLS bolt-on: hand-authored. The planner cannot see RLS    ---
      // --- (FL-01 planner-side facet), so these ops are appended by  ---
      // --- the author after `migration plan` returns.                ---
      enableRowLevelSecurity(SCHEMA, 'profiles'),
      enableRowLevelSecurity(SCHEMA, 'public_messages'),
      enableRowLevelSecurity(SCHEMA, 'todos'),

      // --- profiles policies ---
      // SELECT and UPDATE for the row owner. No INSERT policy: profile
      // rows mirror `auth.users` rows and are inserted under
      // service-role at signup time (T1.7 / T1.8). `auth.uid()` returns
      // `uuid`; `profiles.id` is `char(36)`, hence the cast.
      createRlsPolicy({
        schema: SCHEMA,
        table: 'profiles',
        name: 'profiles_select_own',
        command: 'SELECT',
        to: ['authenticated'],
        using: '(id = (auth.uid())::text)',
      }),
      createRlsPolicy({
        schema: SCHEMA,
        table: 'profiles',
        name: 'profiles_update_own',
        command: 'UPDATE',
        to: ['authenticated'],
        using: '(id = (auth.uid())::text)',
        withCheck: '(id = (auth.uid())::text)',
      }),

      // --- public_messages policies ---
      // Public read: both `anon` and `authenticated` can SELECT
      // (SKILL.md § 4). Write is gated to authenticated users with
      // `withCheck` ensuring they can only post as themselves.
      createRlsPolicy({
        schema: SCHEMA,
        table: 'public_messages',
        name: 'public_messages_select_public',
        command: 'SELECT',
        to: ['anon', 'authenticated'],
        using: 'true',
      }),
      createRlsPolicy({
        schema: SCHEMA,
        table: 'public_messages',
        name: 'public_messages_insert_own',
        command: 'INSERT',
        to: ['authenticated'],
        withCheck: '(author_id = (auth.uid())::text)',
      }),

      // --- todos policies ---
      // Each command gets its own factory call (SKILL.md § 2). UPDATE
      // sets both `using` and `withCheck` so a user cannot reassign
      // ownership in the same write that they're permitted to make
      // (SKILL.md § 3). No `anon` policy: anon naturally gets zero rows
      // via default-deny.
      createRlsPolicy({
        schema: SCHEMA,
        table: 'todos',
        name: 'todos_select_own',
        command: 'SELECT',
        to: ['authenticated'],
        using: '(user_id = (auth.uid())::text)',
      }),
      createRlsPolicy({
        schema: SCHEMA,
        table: 'todos',
        name: 'todos_insert_own',
        command: 'INSERT',
        to: ['authenticated'],
        withCheck: '(user_id = (auth.uid())::text)',
      }),
      createRlsPolicy({
        schema: SCHEMA,
        table: 'todos',
        name: 'todos_update_own',
        command: 'UPDATE',
        to: ['authenticated'],
        using: '(user_id = (auth.uid())::text)',
        withCheck: '(user_id = (auth.uid())::text)',
      }),
      createRlsPolicy({
        schema: SCHEMA,
        table: 'todos',
        name: 'todos_delete_own',
        command: 'DELETE',
        to: ['authenticated'],
        using: '(user_id = (auth.uid())::text)',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
