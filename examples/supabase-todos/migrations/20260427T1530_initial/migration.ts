#!/usr/bin/env -S node
/**
 * Initial migration for the supabase-todos PoC.
 *
 * Sets up three tables (`profiles`, `todos`, `public_messages`),
 * enables RLS on each, and authors the policies that scope per-request
 * reads / writes to the authenticated user.
 *
 * ## Storage column convention
 *
 * The contract (`src/db/schema.ts`) sets `naming: { columns: 'snake_case' }`,
 * so storage column names match Supabase / Postgres convention
 * (`user_id`, `author_id`, `display_name`, `created_at`). RLS policy
 * SQL is interpolated verbatim by `createRlsPolicy` (R-FM-3), so this
 * lets the policies read like the Supabase docs without quoted-identifier
 * gymnastics. See heads-up #1 in the `phase-1c` orchestrator briefing.
 *
 * ## Why no `alterColumnType`-to-`uuid` and no FK to `auth.users`
 *
 * The migration produces a DB shape that exactly matches the contract
 * authored in `phase-1a`. Two intentional non-features fall out of that:
 *
 *  - **No `alterColumnType` to native `uuid`.** `field.uuid()` lowers
 *    to `sql/char@1` with `length: 36`, i.e. Postgres `character(36)`
 *    (`projects/supabase-poc/framework-limitations.md` § FL-03). The
 *    runner's apply-time schema verify (the framework's contract
 *    guarantee) compares the introspected DB IR against the contract
 *    storage IR; an `ALTER COLUMN ... TYPE uuid` would diverge from the
 *    contract's declared `character(36)` and the apply transaction
 *    would roll back with `PN-RUN-3000` / `type_mismatch`. So we keep
 *    `char(36)` end-to-end and bridge to `auth.uid()` (which is `uuid`)
 *    by casting on the function side inside the policy bodies — see
 *    SKILL.md § 6.
 *
 *  - **No `REFERENCES auth.users(id) ON DELETE CASCADE`.** The contract
 *    DSL has no surface for cross-schema FKs (FL-02, **major**). A
 *    `rawSql` FK can be authored, but the resulting constraint is not
 *    in the contract and the verifier reports it as
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
 * 1. `createTable` for the three public tables. Columns lower from the
 *    contract: `id` / `user_id` / `author_id` are `character(36)`,
 *    timestamps are `timestamptz DEFAULT now()`, etc. Listed in the
 *    same alphabetical-by-storage-column order the contract emits.
 * 2. `enableRowLevelSecurity` for each table. Without this, policies
 *    are silently inert (SKILL.md § 2 / § 9). RLS metadata is not
 *    tracked by the contract IR (FL-01), so these ops are invisible
 *    to the verifier and apply cleanly.
 * 3. `createRlsPolicy` per table-command. One factory call per
 *    command, never `ALL` (SKILL.md § 2). For `UPDATE` we set both
 *    `using` and `withCheck` explicitly (SKILL.md § 3). `auth.uid()`
 *    returns `uuid`; our id columns are `character(36)`, so we cast
 *    once on the function side: `(<col> = (auth.uid())::text)`.
 *    Cheaper than casting per-row, and `char(36)` ↔ `text` comparison
 *    is standard Postgres.
 *
 * ## Reset workflow (development)
 *
 * Re-running this migration against a partially-applied state will
 * fail in the appropriate precheck (e.g. `ensure table "todos" does
 * not exist`). To get back to a clean slate during PoC development,
 * run `supabase db reset` from `examples/supabase-todos/` — this
 * rebuilds the local stack from scratch (clears all data; acceptable
 * for the PoC). For partial cleanups, drop the three tables manually
 * via `psql` and re-run.
 */
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import { createRlsPolicy, enableRowLevelSecurity } from '../../src/db/migrations/rls-ops';

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
        'todos',
        [
          { name: 'completed', typeSql: 'boolean', defaultSql: '', nullable: false },
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

      enableRowLevelSecurity(SCHEMA, 'profiles'),
      enableRowLevelSecurity(SCHEMA, 'todos'),
      enableRowLevelSecurity(SCHEMA, 'public_messages'),

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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
