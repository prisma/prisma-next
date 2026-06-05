import { describe, expect, it } from 'vitest';
import ppgServerlessRuntimeDriverDescriptor from '../src/exports/runtime';
import { col, makeFakeClient, row, withTxnControlStatements } from './_fakes';

describe('@prisma-next/driver-ppg-serverless / connection', () => {
  describe('acquireConnection', () => {
    it('returns a connection that round-trips query through a single held session', async () => {
      const fake = makeFakeClient(() => ({
        columns: [col('id'), col('name')],
        rows: [row(1, 'alice')],
      }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const result = await connection.query<{ id: number; name: string }>('select id, name from t');

      expect(result.rows).toEqual([{ id: 1, name: 'alice' }]);
      // One session opened (the connection's), zero closed yet (release hasn't fired).
      expect(fake.newSessionCalls()).toBe(1);
      expect(fake.closeCount()).toBe(0);

      await connection.release();
    });

    it('reuses the same session across multiple execute / query / executePrepared calls', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('x')], rows: [row(1)] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      await connection.query('select 1 as x');
      for await (const _r of connection.execute({ sql: 'select 1 as x' })) {
        // drain
      }
      for await (const _r of connection.executePrepared({
        sql: 'select 1 as x',
        params: [],
        handle: { get: () => undefined, set: () => undefined },
      })) {
        // drain
      }

      // Three calls, still only one underlying session.
      expect(fake.newSessionCalls()).toBe(1);
      expect(fake.closeCount()).toBe(0);
      expect(fake.sessionQueryHistory()).toHaveLength(3);

      await connection.release();
    });

    it('streams rows from execute via the held session', async () => {
      const fake = makeFakeClient(() => ({
        columns: [col('id')],
        rows: [row(1), row(2), row(3)],
      }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const ids: number[] = [];
      for await (const r of connection.execute<{ id: number }>({ sql: 'select id from t' })) {
        ids.push(r.id);
      }
      expect(ids).toEqual([1, 2, 3]);
      expect(fake.newSessionCalls()).toBe(1);

      await connection.release();
    });

    it('exposes the SqlConnection-shaped surface', async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      expect(connection).toMatchObject({
        execute: expect.any(Function),
        executePrepared: expect.any(Function),
        query: expect.any(Function),
        beginTransaction: expect.any(Function),
        release: expect.any(Function),
        destroy: expect.any(Function),
      });

      await connection.release();
    });
  });

  describe('release', () => {
    it('closes the underlying session', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      expect(fake.closeCount()).toBe(0);
      await connection.release();
      expect(fake.closeCount()).toBe(1);
    });

    it('is a no-op on the second call', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      await connection.release();
      await connection.release();
      // close fired exactly once.
      expect(fake.closeCount()).toBe(1);
    });

    it('rejects subsequent query / execute / executePrepared with DRIVER.CONNECTION_RELEASED', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      await connection.release();

      await expect(connection.query('select 1')).rejects.toMatchObject({
        code: 'DRIVER.CONNECTION_RELEASED',
        category: 'RUNTIME',
      });

      const execIter = connection.execute({ sql: 'select 1' });
      await expect(execIter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'DRIVER.CONNECTION_RELEASED',
      });

      const prepIter = connection.executePrepared({
        sql: 'select 1',
        params: [],
        handle: { get: () => undefined, set: () => undefined },
      });
      await expect(prepIter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'DRIVER.CONNECTION_RELEASED',
      });
    });

    it('rejects beginTransaction after release', async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      await connection.release();

      await expect(connection.beginTransaction()).rejects.toMatchObject({
        code: 'DRIVER.CONNECTION_RELEASED',
        category: 'RUNTIME',
      });
    });
  });

  describe('destroy', () => {
    it('closes the underlying session and accepts an advisory reason', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const reason = new Error('transaction rollback failed');
      await connection.destroy(reason);
      // Session closed; reason is informational only, not rethrown.
      expect(fake.closeCount()).toBe(1);
    });

    it('is idempotent with release (release-then-destroy and destroy-then-release both close once)', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const a = await driver.acquireConnection();
      await a.release();
      await a.destroy(new Error('after release'));
      expect(fake.closeCount()).toBe(1);

      const b = await driver.acquireConnection();
      await b.destroy('failed');
      await b.release();
      // total close count is now 2 (a's release + b's destroy).
      expect(fake.closeCount()).toBe(2);
    });

    it('rejects subsequent query with DRIVER.CONNECTION_RELEASED', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      await connection.destroy();

      await expect(connection.query('select 1')).rejects.toMatchObject({
        code: 'DRIVER.CONNECTION_RELEASED',
      });
    });
  });

  describe('multiple connections from the same bound driver', () => {
    it('opens a fresh session per acquireConnection', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const a = await driver.acquireConnection();
      const b = await driver.acquireConnection();
      const c = await driver.acquireConnection();

      expect(fake.newSessionCalls()).toBe(3);
      expect(fake.closeCount()).toBe(0);

      await a.release();
      await b.release();
      await c.release();

      expect(fake.closeCount()).toBe(3);
    });

    it('isolates released-state per connection (releasing A does not release B)', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('x')], rows: [row(1)] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const a = await driver.acquireConnection();
      const b = await driver.acquireConnection();
      await a.release();

      const result = await b.query<{ x: number }>('select 1');
      expect(result.rows).toEqual([{ x: 1 }]);

      await b.release();
    });
  });
});
