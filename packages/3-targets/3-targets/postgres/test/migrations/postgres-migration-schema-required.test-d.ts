/**
 * Type tests pinning that `schema` is optional on all Postgres Migration
 * methods — omitting it defaults to the unbound namespace.
 *
 * The methods are `protected`, so the calls live inside a subclass body.
 */

import { col } from '@prisma-next/sql-relational-core/contract-free';
import { test } from 'vitest';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';

class SchemaOptionalProbe extends PostgresMigration {
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
      this.dropTable({ table: 'stale' }),
    ];
  }
}

test('schema is optional on all Postgres Migration methods', () => {
  void SchemaOptionalProbe;
});
