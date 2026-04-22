/**
 * Reference class-flow migration for the Postgres demo — backfills
 * `user.kind` to `'user'` for any rows that somehow arrived without a
 * value. Demonstrates the consolidated `dataTransform(contract, ...)`
 * factory from `@prisma-next/target-postgres/migration`.
 *
 * The `check` closure surfaces the count of rows that would be updated;
 * the `run` closure performs the mutation. Both closures build their
 * plan off the same `db` (which was itself configured with the same
 * `contract`), so the factory's contract-hash guard is trivially
 * satisfied.
 */

import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { Migration } from '@prisma-next/family-sql/migration';
import { sql } from '@prisma-next/sql-builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import { dataTransform } from '@prisma-next/target-postgres/migration';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import contract from './contract.json' with { type: 'json' };

const db = sql({
  context: createExecutionContext({
    contract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
  }),
});

class BackfillUserKind extends Migration {
  override describe() {
    return {
      from: contract.storage.storageHash,
      to: contract.storage.storageHash,
      labels: ['backfill-user-kind'],
    };
  }

  override get operations() {
    return [
      dataTransform(contract, 'backfill-user-kind', {
        check: () =>
          db.user
            .select('id')
            .where((f, fns) => fns.isNull(f.kind))
            .limit(1),
        run: () => db.user.update({ kind: 'user' }).where((f, fns) => fns.isNull(f.kind)),
      }),
    ];
  }
}

export default BackfillUserKind;
Migration.run(import.meta.url, BackfillUserKind);
