#!/usr/bin/env -S node
import {
  addCheckConstraint,
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma-next/postgres/migration';

/**
 * Converts the replayed database off the native Postgres enum type.
 *
 * The initial migration in this chain created `"public"."user_type"` as a
 * native `CREATE TYPE … AS ENUM` and typed `"user"."kind"` with it. The
 * contract now models `user_type` as a domain enum: a `text` column whose
 * value set is enforced by the `user_kind_check` CHECK constraint. This
 * migration rewrites the stored representation to match — a data-only
 * migration on the current contract hash (from === to).
 */
export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:1a02eed4ad52f589641c1e16b929427e1060acc6bc1e9cc4e3b6e663523f88b4',
      to: 'sha256:1a02eed4ad52f589641c1e16b929427e1060acc6bc1e9cc4e3b6e663523f88b4',
    };
  }

  override get operations() {
    return [
      rawSql({
        id: 'data_migration.convert-user-kind-to-text',
        label: 'Convert "user"."kind" from native enum to text',
        summary:
          'Rewrites stored "user_type" enum labels as plain text (USING "kind"::text); the value set moves to a CHECK constraint',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'column', name: 'kind', table: 'user' },
        },
        precheck: [
          {
            description: 'ensure "kind" currently has the native enum type "user_type"',
            sql: "SELECT EXISTS (\n  SELECT 1\n  FROM information_schema.columns\n  WHERE table_schema = 'public'\n    AND table_name = 'user'\n    AND column_name = 'kind'\n    AND udt_name = 'user_type'\n)",
          },
        ],
        execute: [
          {
            description: 'alter "kind" to text, casting stored enum labels',
            sql: 'ALTER TABLE "public"."user" ALTER COLUMN "kind" TYPE text USING "kind"::text',
          },
        ],
        postcheck: [
          {
            description: 'verify "kind" has type "text"',
            sql: "SELECT EXISTS (\n  SELECT 1\n  FROM information_schema.columns\n  WHERE table_schema = 'public'\n    AND table_name = 'user'\n    AND column_name = 'kind'\n    AND udt_name = 'text'\n)",
          },
        ],
      }),
      addCheckConstraint('public', 'user', 'user_kind_check', 'kind', ['admin', 'user']),
      rawSql({
        id: 'dropType.user_type',
        label: 'Drop type user_type',
        summary:
          'Drops the native enum type "user_type"; its value set is now enforced by "user_kind_check"',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'type', name: 'user_type' },
        },
        precheck: [
          {
            description: 'ensure type "user_type" exists',
            sql: "SELECT EXISTS (\n  SELECT 1\n  FROM pg_type t\n  JOIN pg_namespace n ON t.typnamespace = n.oid\n  WHERE n.nspname = 'public'\n    AND t.typname = 'user_type'\n)",
          },
        ],
        execute: [
          {
            description: 'drop type "user_type"',
            sql: 'DROP TYPE "public"."user_type"',
          },
        ],
        postcheck: [
          {
            description: 'verify type "user_type" does not exist',
            sql: "SELECT NOT EXISTS (\n  SELECT 1\n  FROM pg_type t\n  JOIN pg_namespace n ON t.typnamespace = n.oid\n  WHERE n.nspname = 'public'\n    AND t.typname = 'user_type'\n)",
          },
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
