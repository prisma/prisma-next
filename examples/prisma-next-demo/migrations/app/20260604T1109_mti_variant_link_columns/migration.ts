#!/usr/bin/env -S node
import pgvector from '@prisma-next/extension-pgvector/runtime';
import {
  addColumn,
  addForeignKey,
  addPrimaryKey,
  Migration,
  MigrationCLI,
  setNotNull,
} from '@prisma-next/postgres/migration';
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './end-contract.d';
import endContract from './end-contract.json' with { type: 'json' };

// The migration's own end-contract drives the data-transform query builder, so
// `dataTransform`'s storage-hash assertion holds. No connection is opened here —
// `postgres(...)` only materialises the offline query lane (`db.sql`).
const db = postgres<Contract>({ contractJson: endContract, extensions: [pgvector] });

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:1375f137fa3186c77cda92aba4048c49714ed5fe65993ca7d5eed3bcd9e85cb7',
      to: 'sha256:193e40339cb36ff6e2a5e6782103274d90f1515919e79c4694a591fcb50bcd3a',
    };
  }

  override get operations() {
    return [
      addColumn('public', 'bug', {
        name: 'id',
        typeSql: 'character(36)',
        defaultSql: '',
        nullable: true,
      }),
      // Each MTI variant row's `id` mirrors its parent `task.id`; variants are
      // always written together with their base (see scripts/seed.ts), so a
      // freshly-provisioned database has no orphaned rows to fill. This backfill
      // assigns an id to any pre-existing variant row missing one, keeping the
      // migration self-consistent for legacy data while staying a no-op on the
      // demo's empty tables.
      this.dataTransform(db.context.contract, 'backfill-bug-id', {
        check: () =>
          db.sql.bug
            .select('id')
            .where((f, fns) => fns.eq(f.id, null))
            .limit(1),
        run: () =>
          db.sql.bug
            .update((_f, fns) => ({
              id: fns.raw`gen_random_uuid()::char(36)`.returns({ codecId: 'sql/char@1' }),
            }))
            .where((f, fns) => fns.eq(f.id, null)),
      }),
      setNotNull('public', 'bug', 'id'),
      addColumn('public', 'feature', {
        name: 'id',
        typeSql: 'character(36)',
        defaultSql: '',
        nullable: true,
      }),
      this.dataTransform(db.context.contract, 'backfill-feature-id', {
        check: () =>
          db.sql.feature
            .select('id')
            .where((f, fns) => fns.eq(f.id, null))
            .limit(1),
        run: () =>
          db.sql.feature
            .update((_f, fns) => ({
              id: fns.raw`gen_random_uuid()::char(36)`.returns({ codecId: 'sql/char@1' }),
            }))
            .where((f, fns) => fns.eq(f.id, null)),
      }),
      setNotNull('public', 'feature', 'id'),
      addPrimaryKey('public', 'bug', 'bug_pkey', ['id']),
      addPrimaryKey('public', 'feature', 'feature_pkey', ['id']),
      addForeignKey('public', 'bug', {
        name: 'bug_id_fkey',
        columns: ['id'],
        references: { schema: 'public', table: 'task', columns: ['id'] },
        onDelete: 'cascade',
      }),
      addForeignKey('public', 'feature', {
        name: 'feature_id_fkey',
        columns: ['id'],
        references: { schema: 'public', table: 'task', columns: ['id'] },
        onDelete: 'cascade',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
