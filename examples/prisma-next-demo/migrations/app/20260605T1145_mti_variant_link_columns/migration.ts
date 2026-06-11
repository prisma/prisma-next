#!/usr/bin/env -S node
import {
  addForeignKey,
  addPrimaryKey,
  col,
  Migration,
  MigrationCLI,
  setNotNull,
} from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:ea507b09a99523f7342c82821b22974fd8984ebe5939b5c445529cc0588ca343',
      to: 'sha256:ca7dc29135114fe62434821b39aede307bc99b0d9b92da12d7d7a14bdadc462f',
    };
  }

  override get operations() {
    return [
      // An MTI variant row's `id` must equal its parent `task.id`: the same
      // identity links a `task` row to its `bug`/`feature` detail row, and a
      // validating foreign key to `task(id)` follows below. There is therefore
      // no correct backfill — a variant id can never be fabricated, and rows
      // that predate this link column carry nothing that maps them back to
      // their base. The runtime always writes a variant together with its base
      // (see scripts/seed.ts), so a database provisioned this way has no rows
      // to fill and the `SET NOT NULL` below is a no-op.
      //
      // On a database that does hold pre-link variant rows, the `SET NOT NULL`
      // precheck ("ensure no NULL values in id") halts the migration before any
      // destructive step. Those rows are unlinkable orphans: the operator must
      // resolve them by hand — map each to the correct `task.id`, or delete it —
      // and re-run. We deliberately ship no backfill rather than fabricate ids
      // that the cascading FK to `task(id)` would immediately reject. (`migration
      // plan` scaffolds dataTransform backfill placeholders for the new NOT NULL
      // columns; they are stripped here for exactly this reason.)
      this.addColumn({ schema: 'public', table: 'bug', column: col('id', 'character(36)') }),
      setNotNull('public', 'bug', 'id'),
      this.addColumn({ schema: 'public', table: 'feature', column: col('id', 'character(36)') }),
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
