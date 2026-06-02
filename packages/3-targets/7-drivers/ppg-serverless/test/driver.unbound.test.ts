import { describe, expect, it } from 'vitest';
import ppgServerlessRuntimeDriverDescriptor from '../src/exports/runtime';
import { col, makeFakeClient, row } from './_fakes';

describe('@prisma-next/driver-ppg-serverless runtime driver lifecycle', () => {
  describe('descriptor.create', () => {
    it('returns an unbound driver with stable identity fields', () => {
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      expect(driver).toMatchObject({
        familyId: 'sql',
        targetId: 'postgres',
        acquireConnection: expect.any(Function),
        connect: expect.any(Function),
        close: expect.any(Function),
      });
      expect(driver.state).toBe('unbound');
    });

    it('descriptor metadata is correctly populated', () => {
      const d = ppgServerlessRuntimeDriverDescriptor;
      expect(d.familyId).toBe('sql');
      expect(d.targetId).toBe('postgres');
      expect(d.id).toBe('ppg-serverless');
      expect(d.kind).toBe('driver');
    });
  });

  describe('given an unbound driver', () => {
    const useBeforeConnectMessage =
      'driver-ppg-serverless: driver not connected. Call connect(binding) before acquireConnection or execute.';

    it('throws when acquireConnection is called', async () => {
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await expect(driver.acquireConnection()).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'RUNTIME',
        message: useBeforeConnectMessage,
      });
    });

    it('throws when query is called', async () => {
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await expect(driver.query('select 1')).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'RUNTIME',
        message: useBeforeConnectMessage,
      });
    });

    it('throws when execute is iterated', async () => {
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      const iter = driver.execute({ sql: 'select 1' });
      const iterator = iter[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'RUNTIME',
        message: useBeforeConnectMessage,
      });
    });

    it('throws when executePrepared is iterated', async () => {
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      const iter = driver.executePrepared({
        sql: 'select 1',
        params: [],
        handle: { get: () => undefined, set: () => undefined },
      });
      const iterator = iter[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
        category: 'RUNTIME',
      });
    });
  });

  describe('state transitions', () => {
    it('walks unbound → connected → closed → connected (reconnect after close)', async () => {
      const fakeA = makeFakeClient(() => ({ columns: [], rows: [] }));
      const fakeB = makeFakeClient(() => ({ columns: [], rows: [] }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      expect(driver.state).toBe('unbound');

      await driver.connect({ kind: 'ppgClient', client: fakeA.client });
      expect(driver.state).toBe('connected');

      await driver.close();
      expect(driver.state).toBe('closed');

      await driver.connect({ kind: 'ppgClient', client: fakeB.client });
      expect(driver.state).toBe('connected');
    });

    it('rejects double-connect without a close in between', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      await expect(
        driver.connect({ kind: 'ppgClient', client: fake.client }),
      ).rejects.toMatchObject({
        code: 'DRIVER.ALREADY_CONNECTED',
        category: 'RUNTIME',
        message:
          'driver-ppg-serverless: driver already connected. Call close() before reconnecting with a new binding.',
      });
    });

    it('allows close to be called multiple times', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });
      await driver.close();
      await driver.close();
      expect(driver.state).toBe('closed');
    });
  });

  describe('when connected with ppgClient binding', () => {
    it('queries successfully', async () => {
      const fake = makeFakeClient(() => ({
        columns: [col('id'), col('name')],
        rows: [row(1, 'alice')],
      }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const result = await driver.query<{ id: number; name: string }>('select id, name from items');
      expect(result.rows).toEqual([{ id: 1, name: 'alice' }]);
    });

    it('routes acquireConnection to the bound impl, which returns a usable SqlConnection', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
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

  describe('when constructed from { kind: "url" } binding', () => {
    it('builds a ppg client from the URL string', async () => {
      // Build a fake URL that defaultClientConfig accepts; we don't actually
      // open a WebSocket since the driver does no I/O on connect (sessions
      // are opened per-call). close() is a state flip so we can verify the
      // binding wiring without a real server.
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({
        kind: 'url',
        url: 'postgres://user:pass@example.invalid:5432/db',
      });
      expect(driver.state).toBe('connected');
      await driver.close();
      expect(driver.state).toBe('closed');
    });
  });
});
