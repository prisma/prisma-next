import { DatabaseSync } from 'node:sqlite';
import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';

import { SqliteControlAdapter } from '../src/core/control-adapter';

function createTestDriver(db: DatabaseSync): ControlDriverInstance<'sql', 'sqlite'> {
  return {
    familyId: 'sql',
    targetId: 'sqlite',
    // @deprecated
    target: 'sqlite',
    async query<Row = Record<string, unknown>>(
      sql: string,
      _params?: readonly unknown[],
    ): Promise<{ readonly rows: Row[] }> {
      const stmt = db.prepare(sql);
      const returnsRows = stmt.columns().length > 0;
      if (!returnsRows) {
        stmt.run();
        return { rows: [] };
      }
      return { rows: stmt.all() as Row[] };
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}

describe('SqliteControlAdapter', () => {
  it('introspects primary keys as NOT NULL and encodes implicit autoincrement defaults', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      create table user (
        id integer primary key,
        email text not null,
        createdAt text not null default (CURRENT_TIMESTAMP)
      );
    `);

    const driver = createTestDriver(db);
    const adapter = new SqliteControlAdapter();
    const schema = await adapter.introspect(driver);

    const user = schema.tables['user'];
    expect(user).toBeDefined();
    expect(user?.primaryKey?.columns).toEqual(['id']);
    expect(user?.columns['id']).toMatchObject({
      nativeType: 'integer',
      nullable: false,
      default: 'autoincrement()',
    });
    expect(user?.columns['createdAt']).toMatchObject({
      nullable: false,
      default: 'CURRENT_TIMESTAMP',
    });
  });
});
