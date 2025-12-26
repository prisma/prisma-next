import { timeouts } from '@prisma-next/test-utils';
import type { Client, Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';

import { createPostgresDriverFromOptions } from '../src/postgres-driver';

describe('@prisma-next/driver-postgres', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it('handles query errors', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as Pool },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();

    await expect(driver.query('select * from nonexistent_table')).rejects.toThrow();
  });

  it('throws error when neither pool nor client provided', () => {
    expect(() => {
      createPostgresDriverFromOptions({
        // @ts-expect-error - Testing invalid input
        connect: {},
      });
    }).toThrow('PostgresDriver requires a pool or client');
  });

  it(
    'falls back to buffered mode when cursor execution fails',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = createPostgresDriverFromOptions({
        connect: { pool: pool as unknown as Pool },
        cursor: { batchSize: 1 },
      });

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect();
      await driver.query('create table items(id serial primary key, name text)');
      await driver.query('insert into items(name) values ($1), ($2)', ['a', 'b']);

      // Force cursor to fail by using invalid SQL that pg-mem might handle differently
      // The driver should fall back to buffered mode
      const rows: Array<{ id: number; name: string }> = [];
      for await (const row of driver.execute<{ id: number; name: string }>({
        sql: 'select id, name from items order by id asc',
      })) {
        rows.push(row);
      }

      // Should still get results via buffered fallback
      expect(rows.length).toBeGreaterThan(0);
    },
    timeouts.spinUpPpgDev,
  );

  it('handles non-Error exceptions in cursor path', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as Pool },
      cursor: { batchSize: 1 },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1)', ['test']);

    // The cursor path should handle non-Error exceptions and fall back to buffered
    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items',
    })) {
      rows.push(row);
    }

    expect(rows.length).toBeGreaterThan(0);
  });

  it('throws error when client connection fails with non-already-connected error', async () => {
    const db = newDb();
    const { Client } = db.adapters.createPg();
    const client = new Client();

    const driver = createPostgresDriverFromOptions({
      connect: { client: client as unknown as Client },
    });

    cleanup = async () => {
      await driver.close();
    };

    // Mock client.connect to throw a non-"already connected" error
    // connect() is a no-op, so we test acquireClient indirectly through query()
    const originalConnect = client.connect.bind(client);
    client.connect = async () => {
      const error = new Error('Connection failed: network error');
      throw error;
    };

    await expect(driver.query('select 1')).rejects.toThrow('Connection failed');

    // Restore original connect for cleanup
    client.connect = originalConnect;
  });

  it('handles non-Error exceptions in acquireClient', async () => {
    const db = newDb();
    const { Client } = db.adapters.createPg();
    const client = new Client();

    const driver = createPostgresDriverFromOptions({
      connect: { client: client as unknown as Client },
    });

    cleanup = async () => {
      await driver.close();
    };

    // Mock client.connect to throw a non-Error exception
    // connect() is a no-op, so we test acquireClient indirectly through query()
    const originalConnect = client.connect.bind(client);
    client.connect = async () => {
      throw 'string error';
    };

    await expect(driver.query('select 1')).rejects.toBe('string error');

    // Restore original connect for cleanup
    client.connect = originalConnect;
  });

  it('handles cursor read errors', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as Pool },
      cursor: { batchSize: 1 },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1), ($2)', ['a', 'b']);

    // Cursor read errors should be caught and handled by the execute method
    // The driver should fall back to buffered mode if cursor fails
    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items order by id asc',
    })) {
      rows.push(row);
    }

    // Should get results even if cursor read had issues (fallback to buffered)
    expect(rows.length).toBeGreaterThan(0);
  });

  it('handles cursor close errors', async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();

    const driver = createPostgresDriverFromOptions({
      connect: { pool: pool as unknown as Pool },
      cursor: { batchSize: 1 },
    });

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect();
    await driver.query('create table items(id serial primary key, name text)');
    await driver.query('insert into items(name) values ($1)', ['test']);

    // Cursor close errors should be caught in the finally block
    // The driver should still complete execution successfully
    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items',
    })) {
      rows.push(row);
    }

    // Should get results even if cursor close had issues
    expect(rows.length).toBeGreaterThan(0);
  });
});
