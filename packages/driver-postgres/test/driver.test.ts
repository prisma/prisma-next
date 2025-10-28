import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newDb } from 'pg-mem';

import { createPostgresDriver } from '../src/postgres-driver';

describe('@prisma-next/driver-postgres', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it('streams rows using buffered fallback when cursor disabled', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();

    const driver = createPostgresDriver({
      connectionString: 'postgres://user:pass@localhost:5432/db',
      cursor: { disabled: true },
      poolFactory: Pool as any,
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1), ($2)', ['a', 'b']);

    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items order by id asc',
    })) {
      rows.push(row);
    }

    expect(rows).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
  });
});
