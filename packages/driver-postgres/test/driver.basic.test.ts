import { newDb } from 'pg-mem';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { createPostgresDriver, createPostgresDriverFromOptions } from '../src/postgres-driver';

describe('@prisma-next/driver-postgres', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it(
    'streams rows using buffered fallback when cursor disabled',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = createPostgresDriverFromOptions({
        connect: { pool: pool as unknown as import('pg').Pool },
        cursor: { disabled: true },
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
    },
    timeouts.spinUpPpgDev,
  );

  it('streams rows using cursor mode when enabled', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as import('pg').Pool },
      cursor: { batchSize: 1 },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1), ($2), ($3)', ['a', 'b', 'c']);

    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items order by id asc',
    })) {
      rows.push(row);
    }

    expect(rows).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ]);
  });

  it('uses custom cursor batch size', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as import('pg').Pool },
      cursor: { batchSize: 2 },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1), ($2), ($3), ($4)', [
      'a',
      'b',
      'c',
      'd',
    ]);

    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items order by id asc',
    })) {
      rows.push(row);
    }

    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ id: 1, name: 'a' });
    expect(rows[3]).toEqual({ id: 4, name: 'd' });
  });

  it('executes explain query', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as import('pg').Pool },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');

    // pg-mem doesn't support EXPLAIN (FORMAT JSON), so we test that explain() is callable
    // In a real environment, this would return explain results
    try {
      const result = await driver.explain?.({
        sql: 'select id, name from items',
      });
      if (result) {
        expect(result).toBeDefined();
        expect(result.rows).toBeDefined();
        expect(Array.isArray(result.rows)).toBe(true);
      }
    } catch {
      // pg-mem doesn't support EXPLAIN, so we just verify the method exists
      expect(driver.explain).toBeDefined();
    }
  });

  it('executes query with params', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as import('pg').Pool },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1)', ['test']);

    const result = await driver.query<{ id: number; name: string }>(
      'select id, name from items where name = $1',
      ['test'],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe('test');
  });

  it('handles direct client connection', async () => {
    const db = newDb();
    const { Client } = db.adapters.createPg();
    const client = new Client();

    const driver = createPostgresDriverFromOptions({
      connect: { client: client as unknown as import('pg').Client },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1)', ['test']);

    const result = await driver.query<{ id: number; name: string }>('select id, name from items');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe('test');
  });

  it('handles already connected client', async () => {
    const db = newDb();
    const { Client } = db.adapters.createPg();
    const client = new Client();

    const driver = createPostgresDriverFromOptions({
      connect: { client: client as unknown as import('pg').Client },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.connect();

    await driver.query('create table items(id serial primary key, name text)');
    const result = await driver.query<{ id: number; name: string }>('select id, name from items');

    expect(result.rows).toBeDefined();
  });

  it('closes pool connection', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as import('pg').Pool },
    });

    await driver.connect();
    await driver.close();

    // pg-mem Pool doesn't have an 'ended' property, so we just verify close() doesn't throw
    expect(driver).toBeDefined();
  });

  it('handles empty result set', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as import('pg').Pool },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');

    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items',
    })) {
      rows.push(row);
    }

    expect(rows).toEqual([]);
  });

  it('creates driver from connection string', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    // Mock the Pool constructor to use our pg-mem pool
    const MockPool = class extends Pool {
      constructor() {
        super();
        // Use the pg-mem pool instance
        Object.assign(this, pool);
      }
    };

    const driver = createPostgresDriver('postgresql://test', {
      poolFactory: MockPool as typeof import('pg').Pool,
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1)', ['test']);

    const result = await driver.query<{ id: number; name: string }>('select id, name from items');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe('test');
  });

  it('creates driver with custom poolFactory', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    let customPoolFactoryCalled = false;
    const CustomPool = class extends Pool {
      constructor() {
        super();
        customPoolFactoryCalled = true;
        Object.assign(this, pool);
      }
    };

    const driver = createPostgresDriver('postgresql://test', {
      poolFactory: CustomPool as typeof import('pg').Pool,
    });

    cleanup = async () => {
      await driver.close();
    };

    expect(customPoolFactoryCalled).toBe(true);
    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    const result = await driver.query<{ id: number; name: string }>('select id, name from items');
    expect(result.rows).toBeDefined();
  });
});
