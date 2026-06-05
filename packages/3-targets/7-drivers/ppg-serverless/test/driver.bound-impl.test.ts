import { describe, expect, it } from 'vitest';
import { createBoundDriverFromBinding } from '../src/exports/runtime';
import { col, makeFakeClient, row } from './_fakes';

/**
 * Direct tests for the bound impl (`PpgServerlessBoundDriverImpl`), bypassing
 * the unbound wrapper. The wrapper intercepts every public call before the
 * delegate is consulted, so the bound impl's own guards (closed-state checks,
 * the misuse `connect()` throw) are unreachable through the runtime entry
 * point. Exercising the factory directly is the only way to keep coverage
 * on those paths.
 */
describe('@prisma-next/driver-ppg-serverless / bound impl (direct)', () => {
  describe('createBoundDriverFromBinding', () => {
    it('constructs from a { kind: "url" } binding (builds its own PPG client)', () => {
      const bound = createBoundDriverFromBinding({
        kind: 'url',
        url: 'postgres://user:pass@example.invalid:5432/db',
      });
      expect(bound.state).toBe('connected');
    });
  });

  describe('connect()', () => {
    it('throws because the bound impl is constructed already-bound', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const bound = createBoundDriverFromBinding({ kind: 'ppgClient', client: fake.client });

      await expect(bound.connect({ kind: 'ppgClient', client: fake.client })).rejects.toThrow(
        /already-bound/,
      );
    });
  });

  describe('post-close guards', () => {
    it('acquireConnection() throws DRIVER.CLOSED after close()', async () => {
      const fake = makeFakeClient(() => ({ columns: [], rows: [] }));
      const bound = createBoundDriverFromBinding({ kind: 'ppgClient', client: fake.client });

      await bound.close();
      expect(bound.state).toBe('closed');

      await expect(bound.acquireConnection()).rejects.toMatchObject({
        code: 'DRIVER.CLOSED',
        category: 'RUNTIME',
      });
    });

    it('query() throws DRIVER.CLOSED after close()', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('x')], rows: [row(1)] }));
      const bound = createBoundDriverFromBinding({ kind: 'ppgClient', client: fake.client });

      await bound.close();

      await expect(bound.query('select 1 as x')).rejects.toMatchObject({
        code: 'DRIVER.CLOSED',
        category: 'RUNTIME',
      });
    });

    it('execute() throws DRIVER.CLOSED after close()', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('x')], rows: [row(1)] }));
      const bound = createBoundDriverFromBinding({ kind: 'ppgClient', client: fake.client });

      await bound.close();

      const iter = bound.execute({ sql: 'select 1 as x' });
      await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'DRIVER.CLOSED',
        category: 'RUNTIME',
      });
    });

    it('executePrepared() throws DRIVER.CLOSED after close()', async () => {
      const fake = makeFakeClient(() => ({ columns: [col('x')], rows: [row(1)] }));
      const bound = createBoundDriverFromBinding({ kind: 'ppgClient', client: fake.client });

      await bound.close();

      const iter = bound.executePrepared({
        sql: 'select 1 as x',
        params: [],
        handle: { get: () => undefined, set: () => undefined },
      });
      await expect(iter[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'DRIVER.CLOSED',
        category: 'RUNTIME',
      });
    });
  });
});
