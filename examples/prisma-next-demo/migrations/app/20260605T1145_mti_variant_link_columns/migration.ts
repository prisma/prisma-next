#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:952a6fea5fded63c48b879dea555718a803e320203f02f52165c0ce6765a0509',
      to: 'sha256:e4a035f4b5357858f774ed20d5854fe3c142668df154c60d065421f2fdd73104',
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
      this.setNotNull({ schema: 'public', table: 'bug', column: 'id' }),
      this.addColumn({ schema: 'public', table: 'feature', column: col('id', 'character(36)') }),
      this.setNotNull({ schema: 'public', table: 'feature', column: 'id' }),
      this.addPrimaryKey({
        schema: 'public',
        table: 'bug',
        constraint: 'bug_pkey',
        columns: ['id'],
      }),
      this.addPrimaryKey({
        schema: 'public',
        table: 'feature',
        constraint: 'feature_pkey',
        columns: ['id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'bug',
        foreignKey: {
          name: 'bug_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'task', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'feature',
        foreignKey: {
          name: 'feature_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'task', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
