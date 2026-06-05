import { describe, expect, it } from 'vitest';
import ppgServerlessRuntimeDriverDescriptor from '../src/exports/runtime';
import { col, makeFakeClient, row } from './_fakes';

describe('@prisma-next/driver-ppg-serverless / basic', () => {
  describe('execute', () => {
    it('streams rows keyed by column name', async () => {
      const fake = makeFakeClient(() => ({
        columns: [col('id'), col('name')],
        rows: [row(1, 'alice'), row(2, 'bob')],
      }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const collected: Array<{ id: number; name: string }> = [];
      for await (const r of driver.execute<{ id: number; name: string }>({
        sql: 'select id, name from items',
      })) {
        collected.push(r);
      }

      expect(collected).toEqual([
        { id: 1, name: 'alice' },
        { id: 2, name: 'bob' },
      ]);
      expect(fake.newSessionCalls()).toBe(1);
      expect(fake.sessionCloseCalls()).toBe(1);
    });

    it('spreads params into the underlying session.query call', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('x')], rows: [row(7)] }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const consumed = [];
      for await (const r of driver.execute<{ x: number }>({
        sql: 'select $1::int as x',
        params: [7],
      })) {
        consumed.push(r);
      }

      expect(consumed).toEqual([{ x: 7 }]);
      const [call] = fake.queryCalls();
      expect(call?.sql).toBe('select $1::int as x');
      expect(call?.params).toEqual([7]);
    });

    it('closes the session even if iteration aborts early', async () => {
      const fake = makeFakeClient(() => ({
        columns: [col('id')],
        rows: [row(1), row(2), row(3)],
      }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const iter = driver.execute<{ id: number }>({ sql: 'select id from items' });
      const iterator = iter[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.value).toEqual({ id: 1 });
      await iterator.return?.(undefined);

      expect(fake.sessionCloseCalls()).toBe(1);
    });
  });

  describe('query', () => {
    it('collects rows and reports rowCount', async () => {
      const fake = makeFakeClient(() => ({
        columns: [col('id'), col('name')],
        rows: [row(1, 'alice'), row(2, 'bob'), row(3, 'carol')],
      }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const result = await driver.query<{ id: number; name: string }>('select id, name from items');

      expect(result.rows).toEqual([
        { id: 1, name: 'alice' },
        { id: 2, name: 'bob' },
        { id: 3, name: 'carol' },
      ]);
      expect(result.rowCount).toBe(3);
      expect(fake.sessionCloseCalls()).toBe(1);
    });

    it('handles empty result sets', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('id')], rows: [] }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const result = await driver.query<{ id: number }>('select id from items');
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });

    it('passes params through', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('id')], rows: [row(42)] }));
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      await driver.query('select id from items where id = $1', [42]);

      const [call] = fake.queryCalls();
      expect(call?.params).toEqual([42]);
    });
  });

  describe('executePrepared', () => {
    it('streams rows just like execute (handle is ignored)', async () => {
      const fake = makeFakeClient(() => ({
        columns: [col('id')],
        rows: [row(1), row(2)],
      }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      let handleValue: unknown = 'untouched';
      const handle = {
        get: () => handleValue,
        set: (v: unknown) => {
          handleValue = v;
        },
      };

      const collected: Array<{ id: number }> = [];
      for await (const r of driver.executePrepared<{ id: number }>({
        sql: 'select id from items',
        params: [],
        handle,
      })) {
        collected.push(r);
      }

      expect(collected).toEqual([{ id: 1 }, { id: 2 }]);
      // Handle is never touched by this driver — that is the documented design.
      expect(handleValue).toBe('untouched');
    });
  });

  describe('row mapping', () => {
    it('preserves nulls and non-primitive values', async () => {
      const date = new Date('2025-01-01T00:00:00Z');
      const fake = makeFakeClient(() => ({
        columns: [col('id'), col('payload'), col('created_at')],
        rows: [row(1, null, date)],
      }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const result = await driver.query<{
        id: number;
        payload: unknown;
        created_at: Date;
      }>('select * from t');

      expect(result.rows[0]).toEqual({ id: 1, payload: null, created_at: date });
    });
  });

  describe('one-shot session lifecycle', () => {
    it('opens and closes a session per call', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('x')], rows: [row(1)] }));

      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      await driver.query('select 1 as x');
      await driver.query('select 1 as x');
      await driver.query('select 1 as x');

      expect(fake.newSessionCalls()).toBe(3);
      expect(fake.sessionCloseCalls()).toBe(3);
    });
  });
});
