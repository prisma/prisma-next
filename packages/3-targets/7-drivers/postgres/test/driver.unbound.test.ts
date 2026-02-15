import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import type { Client, Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';

import postgresRuntimeDriverDescriptor from '../src/exports/runtime';

describe('@prisma-next/driver-postgres descriptor create + connect', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  }, timeouts.spinUpPpgDev);

  it('returns unbound driver when create() called with no args', () => {
    const driver = postgresRuntimeDriverDescriptor.create();
    expect(driver).toBeDefined();
    expect(driver.familyId).toBe('sql');
    expect(driver.targetId).toBe('postgres');
    expect(driver.acquireConnection).toBeDefined();
    expect(driver.connect).toBeDefined();
    expect(driver.close).toBeDefined();
  });

  it('returns unbound driver when create() called with cursor options only', () => {
    const driver = postgresRuntimeDriverDescriptor.create({
      cursor: { batchSize: 10, disabled: false },
    });
    expect(driver).toBeDefined();
  });

  it('throws clear error when acquireConnection called before connect', async () => {
    const driver = postgresRuntimeDriverDescriptor.create();
    await expect(driver.acquireConnection()).rejects.toThrow(
      'Postgres driver not connected. Call connect(binding) before acquireConnection or execute.',
    );
  });

  it('throws clear error when query called before connect', async () => {
    const driver = postgresRuntimeDriverDescriptor.create();
    await expect(driver.query('select 1')).rejects.toThrow(
      'Postgres driver not connected. Call connect(binding) before acquireConnection or execute.',
    );
  });

  it('throws clear error when execute called before connect', async () => {
    const driver = postgresRuntimeDriverDescriptor.create();
    const iter = driver.execute({ sql: 'select 1' });
    const iterator = iter[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(
      'Postgres driver not connected. Call connect(binding) before acquireConnection or execute.',
    );
  });

  it(
    'enables acquireConnection and execution after connect with pool binding',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
      await driver.query('create table items(id serial primary key, name text)');
      await driver.query('insert into items(name) values ($1)', ['test']);

      const result = await driver.query<{ id: number; name: string }>('select id, name from items');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.name).toBe('test');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'enables acquireConnection and execution after connect with client binding',
    async () => {
      const db = newDb();
      const { Client } = db.adapters.createPg();
      const client = new Client();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
      await driver.query('create table items(id serial primary key, name text)');
      await driver.query('insert into items(name) values ($1)', ['test']);

      const result = await driver.query<{ id: number; name: string }>('select id, name from items');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.name).toBe('test');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'connects from url binding and executes',
    async () => {
      const database = await createDevDatabase();
      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
        await database.close();
      };

      await driver.connect({ kind: 'url', url: database.connectionString });
      await driver.query('create table url_items(id serial primary key, name text)');
      await driver.query('insert into url_items(name) values ($1)', ['url-test']);

      const result = await driver.query<{ id: number; name: string }>(
        'select id, name from url_items where name = $1',
        ['url-test'],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.name).toBe('url-test');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'is idempotent when connect called twice with same pool binding',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create();
      const binding = { kind: 'pgPool' as const, pool: pool as unknown as Pool };

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect(binding);
      await driver.connect(binding);

      await driver.query('create table items(id serial primary key, name text)');
      const result = await driver.query<{ id: number; name: string }>('select id, name from items');
      expect(result.rows).toBeDefined();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'close works after connect with pool binding',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = undefined;

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
      await driver.close();
      await driver.close();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'close works after connect with client binding',
    async () => {
      const db = newDb();
      const { Client } = db.adapters.createPg();
      const client = new Client();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = undefined;

      await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
      await driver.close();
    },
    timeouts.spinUpPpgDev,
  );
});
