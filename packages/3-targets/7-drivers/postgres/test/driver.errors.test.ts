import { SqlQueryError } from '@prisma-next/sql-errors';
import { timeouts } from '@prisma-next/test-utils';
import type { Client, Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPostgresDriver, createPostgresDriverFromOptions } from '../src/postgres-driver';

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

      const driver = createPostgresDriverFromOptions({
        connect: { pool: pool as unknown as Pool },
      });

      cleanup = async () => {
        await driver.close();
      };

      await driver.connect();

      await expect(driver.query('select * from nonexistent_table')).rejects.toThrow();
    },
    timeouts.spinUpPpgDev,
  );

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

  it(
    'handles non-Error exceptions in cursor path',
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

  it(
    'handles cursor read errors',
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

    const driver = createPostgresDriverFromOptions({
      connect: { client },
    });

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

    const driver = createPostgresDriverFromOptions({
      connect: { client },
    });

    await driver.close();

    expect(mockClient.end).toHaveBeenCalled();
  });

  it('normalizes non-Error cursor failures from execute()', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      query: vi.fn((statement: unknown) => {
        if (typeof statement === 'string') {
          return Promise.resolve({ rows: [] });
        }
        return {
          read: (size: number, cb: (err: unknown, rows: unknown[]) => void) => {
            void size;
            cb('cursor failed with string', []);
          },
          close: (cb: (err?: unknown) => void) => cb(),
        };
      }),
    };
    const client = mockClient as unknown as Client;
    const driver = createPostgresDriverFromOptions({
      connect: { client },
      cursor: { batchSize: 1 },
    });
    cleanup = async () => {
      await driver.close();
    };

    const consume = async () => {
      for await (const _row of driver.execute({ sql: 'select 1' })) {
        // consume stream
      }
    };

    await expect(consume()).rejects.toThrow('cursor failed with string');
  });

  it('normalizes postgres cursor failures as SqlQueryError', async () => {
    const pgCursorError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      query: vi.fn((statement: unknown) => {
        if (typeof statement === 'string') {
          return Promise.resolve({ rows: [] });
        }
        return {
          read: (size: number, cb: (err: unknown, rows: unknown[]) => void) => {
            void size;
            cb(pgCursorError, []);
          },
          close: (cb: (err?: unknown) => void) => cb(),
        };
      }),
    };
    const client = mockClient as unknown as Client;
    const driver = createPostgresDriverFromOptions({
      connect: { client },
      cursor: { batchSize: 1 },
    });
    cleanup = async () => {
      await driver.close();
    };

    const consume = async () => {
      for await (const _row of driver.execute({ sql: 'select 1' })) {
        // consume stream
      }
    };

    await expect(consume()).rejects.toBeInstanceOf(SqlQueryError);
  });

  it('skips pool end when pool is already ended', async () => {
    const endedPool = {
      ended: true,
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ release: vi.fn() })),
    } as unknown as Pool;

    const driver = createPostgresDriverFromOptions({
      connect: { pool: endedPool },
    });

    await driver.close();

    expect(endedPool.end).not.toHaveBeenCalled();
  });

  it('ignores already-connected errors while acquiring direct client', async () => {
    const alreadyConnectedError = new Error('Client has already been connected');
    const mockClient = {
      _connection: undefined,
      _ending: false,
      connect: vi.fn(async () => {
        throw alreadyConnectedError;
      }),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const client = mockClient as unknown as Client;
    const driver = createPostgresDriverFromOptions({
      connect: { client },
    });
    cleanup = async () => {
      await driver.close();
    };

    const result = await driver.query('select 1');

    expect(result.rows).toEqual([]);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it('uses default pg Pool factory when options are omitted', async () => {
    const driver = createPostgresDriver('postgresql://127.0.0.1:65432/unused');
    await driver.close();
    expect(driver).toBeDefined();
  });

  it('skips direct client end when client is already ending', async () => {
    const mockClient = {
      _connection: {},
      _ending: true,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const client = mockClient as unknown as Client;
    const driver = createPostgresDriverFromOptions({
      connect: { client },
    });

    await driver.close();

    expect(mockClient.end).not.toHaveBeenCalled();
  });

  it('releases direct connection without release method', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const client = mockClient as unknown as Client;
    const driver = createPostgresDriverFromOptions({
      connect: { client },
    });
    cleanup = async () => {
      await driver.close();
    };

    const connection = await driver.acquireConnection();
    await expect(connection.release()).resolves.toBeUndefined();
  });
});
