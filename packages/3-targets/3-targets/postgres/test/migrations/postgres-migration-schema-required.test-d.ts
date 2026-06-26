/**
 * Negative type tests pinning that `schema` is REQUIRED on the Postgres
 * `Migration` methods where it is required (dropTable, etc.), and that
 * `schema` is OPTIONAL on methods that default to the unbound namespace
 * (createTable, addColumn, dropDefault).
 *
 * The methods are `protected`, so the calls live inside a subclass body where
 * they are reachable.
 */

import { col } from '@prisma-next/sql-relational-core/contract-free';
import { test } from 'vitest';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';

class SchemaRequiredProbe extends PostgresMigration {
  override describe() {
    return { from: null, to: 'sha256:0' };
  }

  override get operations() {
    return [
      this.createTable({ schema: 'public', table: 'user', columns: [col('id', 'text')] }),
      this.createTable({ table: 'user', columns: [col('id', 'text')] }),
      this.addColumn({ schema: 'public', table: 'user', column: col('email', 'text') }),
      this.addColumn({ table: 'user', column: col('email', 'text') }),
      this.dropTable({ schema: 'public', table: 'stale' }),
    ];
  }

  missingSchema() {
    return [
      // @ts-expect-error schema is required on Postgres Migration methods (no search_path-relative default)
      this.dropTable({ table: 'stale' }),
    ];
  }
}

test('schema is optional on addColumn/dropDefault, required on dropTable', () => {
  void SchemaRequiredProbe;
});
