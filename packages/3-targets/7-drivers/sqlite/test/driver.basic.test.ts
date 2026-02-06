import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';
import { describe, expect, it } from 'vitest';
import { createSqliteDriverFromOptions } from '../src/sqlite-driver';

describe('@prisma-next/driver-sqlite', () => {
  it('queries and binds numeric params', async () => {
    const driver = createSqliteDriverFromOptions({
      connect: { filename: ':memory:' },
    });

    const result = await driver.query<{ v: number }>('select ?1 as v', [42]);
    expect(result.rows).toEqual([{ v: 42 }]);

    await driver.close();
  });

  it('streams rows via execute()', async () => {
    const driver = createSqliteDriverFromOptions({
      connect: { filename: ':memory:' },
    });

    await driver.query('create table items(id integer primary key, name text not null)');
    await driver.query('insert into items(name) values (?1), (?2)', ['a', 'b']);

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

    await driver.close();
  });

  it('supports transactions (commit + rollback)', async () => {
    const driver = createSqliteDriverFromOptions({
      connect: { filename: ':memory:' },
    });

    await driver.query('create table items(id integer primary key, name text not null)');

    // Rollback
    const conn1 = await driver.acquireConnection();
    const tx1 = await conn1.beginTransaction();
    await tx1.query('insert into items(name) values (?1)', ['a']);
    await tx1.rollback();
    await conn1.release();

    const countAfterRollback = await driver.query<{ c: number }>('select count(*) as c from items');
    expect(countAfterRollback.rows[0]?.c).toBe(0);

    // Commit
    const conn2 = await driver.acquireConnection();
    const tx2 = await conn2.beginTransaction();
    await tx2.query('insert into items(name) values (?1)', ['b']);
    await tx2.commit();
    await conn2.release();

    const countAfterCommit = await driver.query<{ c: number }>('select count(*) as c from items');
    expect(countAfterCommit.rows[0]?.c).toBe(1);

    await driver.close();
  });

  it('normalizes connection errors', async () => {
    expect(() =>
      createSqliteDriverFromOptions({
        connect: { filename: '/this/does/not/exist/sqlite.db' },
      }),
    ).toThrowError(SqlConnectionError);
  });

  it('normalizes query errors', async () => {
    const driver = createSqliteDriverFromOptions({
      connect: { filename: ':memory:' },
    });

    await driver.query('create table items(id integer primary key, name text unique)');
    await driver.query('insert into items(name) values (?1)', ['a']);

    try {
      await driver.query('insert into items(name) values (?1)', ['a']);
      throw new Error('expected unique constraint error');
    } catch (error) {
      expect(error).toBeInstanceOf(SqlQueryError);
    } finally {
      await driver.close();
    }
  });
});
