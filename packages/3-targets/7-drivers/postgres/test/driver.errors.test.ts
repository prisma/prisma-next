import { SqlQueryError } from '@prisma-next/sql-errors';
import { timeouts } from '@prisma-next/test-utils';
import type { Client, Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { createBoundDriverFromBinding } from '../src/postgres-driver';

describe('@prisma-next/driver-postgres', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  it(
    'handles query errors',
    async () => {
      const db = newDb();
      const { Pool } = db.adapters.createPg();
      const pool = new Pool();
      const driver = postgresRuntimeDriverDescriptor.create();
      cleanups.push(async () => {
        await driver.close();
      });
      await driver.connect({ kind: 'pgPool', pool: pool as unknown as Pool });
      await expect(driver.query('select * from nonexistent_table')).rejects.toThrow();
    },
    timeouts.spinUpPpgDev,
  );

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
          read: (_size: number, cb: (err: unknown, rows: unknown[]) => void) =>
            cb('cursor failed with string', []),
          close: (cb: (err?: unknown) => void) => cb(),
        };
      }),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      { batchSize: 1 },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const consume = async () => {
      for await (const _row of driver.execute({ sql: 'select 1' })) {
        // consume stream
      }
    };

    await expect(consume()).rejects.toThrow('cursor failed with string');
  });

  it('falls back to buffered mode when cursor throws non-postgres Error', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      query: vi.fn((statement: unknown) => {
        if (typeof statement === 'string') {
          return Promise.resolve({ rows: [{ id: 1, name: 'fallback' }] });
        }
        return {
          read: (_size: number, cb: (err: unknown, rows: unknown[]) => void) =>
            cb(new Error('cursor unavailable'), []),
          close: (cb: (err?: unknown) => void) => cb(),
        };
      }),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      { batchSize: 1 },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const rows: Array<{ id: number; name: string }> = [];
    for await (const row of driver.execute<{ id: number; name: string }>({
      sql: 'select id, name from items',
    })) {
      rows.push(row);
    }

    expect(rows).toEqual([{ id: 1, name: 'fallback' }]);
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
          read: (_size: number, cb: (err: unknown, rows: unknown[]) => void) =>
            cb(pgCursorError, []),
          close: (cb: (err?: unknown) => void) => cb(),
        };
      }),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      { batchSize: 1 },
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const consume = async () => {
      for await (const _row of driver.execute({ sql: 'select 1' })) {
        // consume stream
      }
    };

    await expect(consume()).rejects.toBeInstanceOf(SqlQueryError);
  });

  it('rethrows non already-connected client connect errors', async () => {
    const mockClient = {
      _connection: undefined,
      _ending: false,
      connect: vi.fn(async () => {
        throw new Error('Connection failed: network error');
      }),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    await expect(driver.query('select 1')).rejects.toThrow('Connection failed');
  });

  it('closes pool driver once when close called multiple times', async () => {
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ release: vi.fn() })),
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding({ kind: 'pgPool', pool }, undefined);

    await driver.close();
    await driver.close();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('reports connected state for bound pool driver', async () => {
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ release: vi.fn() })),
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding({ kind: 'pgPool', pool }, undefined);
    cleanups.push(async () => {
      await driver.close();
    });

    expect(driver.state).toBe('connected');
  });

  it('reports closed state for pool driver after close', async () => {
    const pool = {
      end: vi.fn(async () => {}),
      connect: vi.fn(async () => ({ release: vi.fn() })),
    } as unknown as Pool;
    const driver = createBoundDriverFromBinding({ kind: 'pgPool', pool }, undefined);

    await driver.close();

    expect(driver.state).toBe('closed');
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
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const result = await driver.query('select 1');

    expect(result.rows).toEqual([]);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it('reuses in-flight connect promise for concurrent queries', async () => {
    let resolveConnect: (() => void) | undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const mockClient = {
      _connection: undefined,
      _ending: false,
      connect: vi.fn(async () => {
        await connectPromise;
      }),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const first = driver.query('select 1');
    const second = driver.query('select 1');
    resolveConnect?.();
    await Promise.all([first, second]);

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it('reports connected state for bound direct driver', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    expect(driver.state).toBe('connected');
  });

  it('reports closed state for direct driver after close', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );

    await driver.close();

    expect(driver.state).toBe('closed');
  });

  it('constructs and closes url-bound driver', { timeout: 1_000 }, async () => {
    const driver = createBoundDriverFromBinding(
      { kind: 'url', url: 'postgresql://127.0.0.1:65432/unused' },
      undefined,
    );
    await driver.close();
    expect(driver).toBeDefined();
  });

  it('closes direct client once when close called multiple times', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );

    await driver.close();
    await driver.close();

    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });

  it('releases direct connection without release method', async () => {
    const mockClient = {
      _connection: {},
      _ending: false,
      connect: vi.fn(async () => {}),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    const connection = await driver.acquireConnection();
    await expect(connection.release()).resolves.toBeUndefined();
  });

  it('releases lease when direct acquireConnection fails', async () => {
    const mockClient = {
      _connection: undefined,
      _ending: false,
      connect: vi.fn(async () => {
        throw new Error('connect failed');
      }),
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: mockClient as unknown as Client },
      undefined,
    );
    cleanups.push(async () => {
      await driver.close();
    });

    await expect(driver.acquireConnection()).rejects.toThrow('connect failed');
    await expect(driver.acquireConnection()).rejects.toThrow('connect failed');
  });
});
