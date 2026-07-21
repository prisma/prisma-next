/**
 * A suspended pg-cursor portal lives in the session's implicit transaction.
 * On a single-session backend behind a socket multiplexer (PGlite under
 * `prisma dev`, transaction-mode poolers), any interleaved query ends that
 * implicit transaction with its Sync and destroys the portal, producing
 * `portal "C_N" does not exist` mid-stream. The driver protects streamed
 * execution by wrapping it in an explicit transaction, which an interleaved
 * Sync cannot end.
 */

import { createServer } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('No port assigned'));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

interface SharedSessionHarness {
  readonly db: PGlite;
  readonly client: Client;
  readonly driver: ReturnType<typeof postgresRuntimeDriverDescriptor.create>;
  readonly recordedQueryTexts: string[];
  close(): Promise<void>;
}

let harness: SharedSessionHarness | undefined;

function recordQueryTexts(client: Client): string[] {
  const recorded: string[] = [];
  const original = client.query.bind(client);
  const spied = (...args: unknown[]): unknown => {
    const first = args[0];
    if (typeof first === 'string') {
      recorded.push(first);
    } else if (
      typeof first === 'object' &&
      first !== null &&
      'text' in first &&
      typeof first.text === 'string'
    ) {
      recorded.push(first.text);
    }
    return (original as (...inner: unknown[]) => unknown)(...args);
  };
  (client as unknown as { query: typeof spied }).query = spied;
  return recorded;
}

async function createSharedSessionHarness(options?: {
  readonly cursorBatchSize?: number;
}): Promise<SharedSessionHarness> {
  const db = await PGlite.create();
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();

  const client = new Client({
    host: '127.0.0.1',
    port,
    database: 'postgres',
    user: 'postgres',
  });
  client.on('error', () => {});
  await client.connect();
  const recordedQueryTexts = recordQueryTexts(client);

  const driver = postgresRuntimeDriverDescriptor.create({
    cursor: { batchSize: options?.cursorBatchSize ?? 10 },
  });
  await driver.connect({ kind: 'pgClient', client });

  const created: SharedSessionHarness = {
    db,
    client,
    driver,
    recordedQueryTexts,
    close: async () => {
      await driver.close().catch(() => {});
      await server.stop().catch(() => {});
      await db.close().catch(() => {});
    },
  };
  harness = created;
  return created;
}

async function seedRows(h: SharedSessionHarness, count: number): Promise<void> {
  await h.driver.query('create table items (id int primary key, n int not null)');
  const values = Array.from({ length: count }, (_, i) => `(${i}, ${i * 2})`).join(', ');
  await h.driver.query(`insert into items (id, n) values ${values}`);
}

afterEach(async () => {
  if (harness) {
    await harness.close();
    harness = undefined;
  }
}, timeouts.spinUpDbServer);

describe('streamed execute on a shared single-session backend', () => {
  it(
    'survives a query injected into the backend session between cursor batches',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 10 });
      await seedRows(h, 30);

      const rows: Array<{ id: number }> = [];
      for await (const row of h.driver.execute<{ id: number }>({
        sql: 'select id from items order by id',
      })) {
        rows.push(row);
        if (rows.length === 10) {
          // Simulates the prisma dev server's WAL-bridge drain: a direct
          // PGlite query on the same backend session while the portal is
          // suspended between batch reads. Its Sync must not kill the stream.
          await h.db.query('select 1');
        }
      }

      expect(rows).toHaveLength(30);
      expect(rows[0]).toEqual({ id: 0 });
      expect(rows[29]).toEqual({ id: 29 });
    },
    timeouts.spinUpDbServer,
  );

  it(
    'wraps top-level streamed execution in an explicit transaction',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 12);
      h.recordedQueryTexts.length = 0;

      const rows: unknown[] = [];
      for await (const row of h.driver.execute({ sql: 'select id from items order by id' })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(12);
      expect(h.recordedQueryTexts).toEqual(['BEGIN', 'select id from items order by id', 'COMMIT']);
      expect(h.db.isInTransaction()).toBe(false);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'commits and releases the session when the consumer abandons the stream early',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 25);
      h.recordedQueryTexts.length = 0;

      for await (const row of h.driver.execute<{ id: number }>({
        sql: 'select id from items order by id',
      })) {
        if (row.id >= 6) {
          break;
        }
      }

      expect(h.recordedQueryTexts.filter((text) => text === 'BEGIN')).toHaveLength(1);
      expect(h.recordedQueryTexts.filter((text) => text === 'COMMIT')).toHaveLength(1);
      expect(h.db.isInTransaction()).toBe(false);

      const after = await h.driver.query<{ n: string | number }>(
        'select count(*)::int as n from items',
      );
      expect(after.rows).toEqual([{ n: 25 }]);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'does not open a nested transaction when streaming inside a driver transaction',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 12);
      h.recordedQueryTexts.length = 0;

      const connection = await h.driver.acquireConnection();
      const transaction = await connection.beginTransaction();
      const rows: unknown[] = [];
      for await (const row of transaction.execute({ sql: 'select id from items order by id' })) {
        rows.push(row);
      }
      await transaction.commit();
      await connection.release();

      expect(rows).toHaveLength(12);
      expect(h.recordedQueryTexts.filter((text) => text === 'BEGIN')).toHaveLength(1);
      expect(h.recordedQueryTexts.filter((text) => text === 'COMMIT')).toHaveLength(1);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'wraps connection-scoped streaming again after a transaction settles',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 8);

      const connection = await h.driver.acquireConnection();
      const transaction = await connection.beginTransaction();
      await transaction.commit();
      h.recordedQueryTexts.length = 0;

      const rows: unknown[] = [];
      for await (const row of connection.execute({ sql: 'select id from items order by id' })) {
        rows.push(row);
      }
      await connection.release();

      expect(rows).toHaveLength(8);
      expect(h.recordedQueryTexts).toEqual(['BEGIN', 'select id from items order by id', 'COMMIT']);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'serializes concurrent streams on a shared client so both complete',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 20);

      const consume = async (): Promise<number> => {
        let count = 0;
        for await (const _row of h.driver.execute({ sql: 'select id from items order by id' })) {
          count++;
        }
        return count;
      };

      const [first, second] = await Promise.all([consume(), consume()]);
      expect(first).toBe(20);
      expect(second).toBe(20);
      expect(h.db.isInTransaction()).toBe(false);
    },
    timeouts.spinUpDbServer,
  );
});
