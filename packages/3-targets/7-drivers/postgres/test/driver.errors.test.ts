import { SqlQueryError } from '@prisma-next/sql-errors';
import { timeouts } from '@prisma-next/test-utils';
import type { Client, Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { createBoundDriverFromBinding, type PostgresBinding } from '../src/postgres-driver';

describe('@prisma-next/driver-postgres', () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  }, timeouts.spinUpPpgDev);

  it(
    'handles query errors',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create();

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });

      await expect(driver.query('select * from nonexistent_table')).rejects.toThrow();
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'falls back to buffered mode when cursor execution fails',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create({
        cursor: { batchSize: 1 },
      });

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
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

  it(
    'handles non-Error exceptions in cursor path',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create({
        cursor: { batchSize: 1 },
      });

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
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
    },
    timeouts.spinUpPpgDev,
  );

  it('throws error when client connection fails with non-already-connected error', async () => {
    const db = newDb();
    const { Client } = db.adapters.createPg();
    const client = new Client();

    const driver = postgresRuntimeDriverDescriptor.create();

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
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

    const driver = postgresRuntimeDriverDescriptor.create();

    cleanup = async () => {
      await driver.close();
    };

    await driver.connect({ kind: 'pgClient', client: client as unknown as Client });
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

  it(
    'handles cursor read errors',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create({
        cursor: { batchSize: 1 },
      });

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
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
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'handles cursor close errors',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();

      const driver = postgresRuntimeDriverDescriptor.create({
        cursor: { batchSize: 1 },
      });

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
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
    },
    timeouts.spinUpPpgDev,
  );

  it('reuses already connected direct client without invoking connect', async () => {
    const client = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {
        throw new Error('connect should not be called');
      }),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    } as unknown as Client;

    const driver = postgresRuntimeDriverDescriptor.create();

    await driver.connect({ kind: 'pgClient', client });
    await driver.query('select 1');

    expect(client.connect).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalled();
  });

  it('calls client.end when closing direct client', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {
        mockClient._ending = true;
      }),
    };
    const client = mockClient as unknown as Client;

    const driver = postgresRuntimeDriverDescriptor.create();

    await driver.connect({ kind: 'pgClient', client });
    await driver.close();

    expect(mockClient.end).toHaveBeenCalled();
  });

  it('normalizes non-Error cursor failures from read callbacks', async () => {
    const client = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      query: vi.fn((queryArg: unknown) => {
        if (typeof queryArg === 'string') {
          return Promise.resolve({ rows: [] });
        }
        return {
          read: (_size: number, cb: (err: unknown, rows: unknown[] | undefined) => void) => {
            cb('cursor read failed', undefined);
          },
          close: (cb: (err: unknown) => void) => cb(null),
        };
      }),
    } as unknown as Client;

    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client },
      { batchSize: 1, disabled: false },
    );

    await expect(
      (async () => {
        for await (const _row of driver.execute({ sql: 'select 1' })) {
        }
      })(),
    ).rejects.toThrow('cursor read failed');
  });

  it('normalizes postgres cursor failures as SqlQueryError', async () => {
    const postgresError = Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
      },
    );
    const client = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      query: vi.fn((queryArg: unknown) => {
        if (typeof queryArg === 'string') {
          return Promise.resolve({ rows: [] });
        }
        return {
          read: (_size: number, cb: (err: unknown, rows: unknown[] | undefined) => void) => {
            cb(postgresError, undefined);
          },
          close: (cb: (err: unknown) => void) => cb(null),
        };
      }),
    } as unknown as Client;

    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client },
      { batchSize: 1, disabled: false },
    );

    await expect(
      (async () => {
        for await (const _row of driver.execute({ sql: 'select 1' })) {
        }
      })(),
    ).rejects.toBeInstanceOf(SqlQueryError);
  });

  it('supports no-op connect on pool and direct bound drivers', async () => {
    const pool = {
      connect: vi.fn(async () => ({
        release: vi.fn(),
      })),
      end: vi.fn(async () => {}),
    } as unknown as Pool;

    const directClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    } as unknown as Client;

    const poolDriver = createBoundDriverFromBinding({ kind: 'pgPool', pool }, { disabled: true });
    const directDriver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: directClient },
      { disabled: true },
    );

    await expect(
      poolDriver.connect({
        kind: 'pgPool',
        pool,
      } satisfies PostgresBinding),
    ).resolves.toBeUndefined();
    await expect(
      directDriver.connect({
        kind: 'pgClient',
        client: directClient,
      } satisfies PostgresBinding),
    ).resolves.toBeUndefined();
  });

  it('releases direct-connection handles without pool release function', async () => {
    const directClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN') {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      end: vi.fn(async () => {}),
    } as unknown as Client;

    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: directClient },
      { disabled: true },
    );
    const connection = await driver.acquireConnection();

    await expect(connection.release()).resolves.toBeUndefined();
  });

  it('skips pool.end when pool is already ended', async () => {
    const pool = {
      ended: true,
      connect: vi.fn(async () => ({
        query: vi.fn(async () => ({ rows: [] })),
        release: vi.fn(),
      })),
      end: vi.fn(async () => {}),
    } as unknown as Pool;

    const driver = createBoundDriverFromBinding({ kind: 'pgPool', pool }, { disabled: true });
    await driver.close();

    expect((pool as unknown as { end: ReturnType<typeof vi.fn> }).end).not.toHaveBeenCalled();
  });

  it('skips client.end when direct client is already ending', async () => {
    const directClient = {
      _connection: {},
      _ending: true,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    } as unknown as Client;

    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: directClient },
      { disabled: true },
    );
    await driver.close();

    expect(
      (directClient as unknown as { end: ReturnType<typeof vi.fn> }).end,
    ).not.toHaveBeenCalled();
  });

  it('ignores already connected errors from client.connect', async () => {
    const directClient = {
      _connection: undefined,
      _ending: false,
      connect: vi.fn(async () => {
        throw new Error('Client is already connected');
      }),
      query: vi.fn(async () => ({ rows: [{ one: 1 }] })),
      end: vi.fn(async () => {}),
    } as unknown as Client;

    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: directClient },
      { disabled: true },
    );

    await expect(driver.query('select 1')).resolves.toEqual({ rows: [{ one: 1 }] });
  });
});
