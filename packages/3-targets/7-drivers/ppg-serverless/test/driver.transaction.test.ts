import { DatabaseError } from '@prisma/ppg';
import { SqlQueryError } from '@prisma-next/sql-errors';
import { describe, expect, it } from 'vitest';
import ppgServerlessRuntimeDriverDescriptor from '../src/exports/runtime';
import { col, makeFakeClient, row, withTxnControlStatements } from './_fakes';

describe('@prisma-next/driver-ppg-serverless / transaction', () => {
  describe('beginTransaction', () => {
    it("issues 'BEGIN' on the held session", async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();

      const history = fake.sessionQueryHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.sql).toBe('BEGIN');
      // Transaction shares the connection's underlying session — no new session.
      expect(fake.newSessionCalls()).toBe(1);

      // Cleanup
      await txn.rollback();
      await connection.release();
    });

    it('returns a transaction that exposes execute / query / executePrepared / commit / rollback', async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();

      expect(txn).toMatchObject({
        execute: expect.any(Function),
        executePrepared: expect.any(Function),
        query: expect.any(Function),
        commit: expect.any(Function),
        rollback: expect.any(Function),
      });

      await txn.commit();
      await connection.release();
    });

    it('routes execute and query through the same held session', async () => {
      const fake = makeFakeClient(
        withTxnControlStatements(() => ({ columns: [col('x')], rows: [row(1)] })),
      );
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();

      const result = await txn.query<{ x: number }>('select 1 as x');
      expect(result.rows).toEqual([{ x: 1 }]);

      for await (const _r of txn.execute({ sql: 'select 1 as x' })) {
        // drain
      }

      await txn.commit();
      await connection.release();

      // BEGIN + query + execute + COMMIT = 4 statements; still one session opened.
      expect(fake.sessionQueryHistory().map((h) => h.sql)).toEqual([
        'BEGIN',
        'select 1 as x',
        'select 1 as x',
        'COMMIT',
      ]);
      expect(fake.newSessionCalls()).toBe(1);
    });
  });

  describe('commit', () => {
    it("issues 'COMMIT' on the held session", async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();
      await txn.commit();

      const history = fake.sessionQueryHistory();
      expect(history.map((h) => h.sql)).toEqual(['BEGIN', 'COMMIT']);

      await connection.release();
    });

    it('normalizes commit failure to SqlQueryError', async () => {
      let n = 0;
      const fake = makeFakeClient((sql) => {
        if (sql.toUpperCase().startsWith('BEGIN')) {
          return { columns: [], rows: [] };
        }
        if (sql.toUpperCase().startsWith('COMMIT')) {
          n++;
          return new DatabaseError({
            message: 'no active transaction',
            code: '25P01',
          });
        }
        return { columns: [], rows: [] };
      });
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();

      await expect(txn.commit()).rejects.toBeInstanceOf(SqlQueryError);
      expect(n).toBe(1);

      await connection.release();
    });
  });

  describe('rollback', () => {
    it("issues 'ROLLBACK' on the held session", async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();
      await txn.rollback();

      const history = fake.sessionQueryHistory();
      expect(history.map((h) => h.sql)).toEqual(['BEGIN', 'ROLLBACK']);

      await connection.release();
    });

    it('normalizes rollback failure to SqlQueryError', async () => {
      const fake = makeFakeClient((sql) => {
        if (sql.toUpperCase().startsWith('BEGIN')) {
          return { columns: [], rows: [] };
        }
        if (sql.toUpperCase().startsWith('ROLLBACK')) {
          return new DatabaseError({ message: 'no active transaction', code: '25P01' });
        }
        return { columns: [], rows: [] };
      });
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();

      await expect(txn.rollback()).rejects.toBeInstanceOf(SqlQueryError);
      await connection.release();
    });
  });

  describe('sequential transactions on the same connection', () => {
    it('supports begin → commit → begin → commit on the same connection', async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();

      const txn1 = await connection.beginTransaction();
      await txn1.commit();

      const txn2 = await connection.beginTransaction();
      await txn2.commit();

      expect(fake.sessionQueryHistory().map((h) => h.sql)).toEqual([
        'BEGIN',
        'COMMIT',
        'BEGIN',
        'COMMIT',
      ]);
      // Still one session opened across the whole sequence.
      expect(fake.newSessionCalls()).toBe(1);

      await connection.release();
    });

    it('supports begin → rollback → begin → commit on the same connection', async () => {
      const fake = makeFakeClient(withTxnControlStatements());
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();

      const txn1 = await connection.beginTransaction();
      await txn1.rollback();

      const txn2 = await connection.beginTransaction();
      await txn2.commit();

      expect(fake.sessionQueryHistory().map((h) => h.sql)).toEqual([
        'BEGIN',
        'ROLLBACK',
        'BEGIN',
        'COMMIT',
      ]);

      await connection.release();
    });
  });

  describe('error normalisation inside a transaction', () => {
    it('normalizes a DatabaseError from a statement inside the transaction to SqlQueryError', async () => {
      const fake = makeFakeClient((sql) => {
        if (
          sql.toUpperCase().startsWith('BEGIN') ||
          sql.toUpperCase().startsWith('COMMIT') ||
          sql.toUpperCase().startsWith('ROLLBACK')
        ) {
          return { columns: [], rows: [] };
        }
        return new DatabaseError({
          message: 'syntax error at or near "FROMM"',
          code: '42601',
        });
      });
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      const txn = await connection.beginTransaction();

      await expect(txn.query('selct 1')).rejects.toBeInstanceOf(SqlQueryError);

      await txn.rollback();
      await connection.release();
    });
  });

  describe('beginTransaction error path', () => {
    it('normalizes a BEGIN failure to SqlQueryError', async () => {
      const fake = makeFakeClient(
        () => new DatabaseError({ message: 'cannot begin tx', code: '25001' }),
      );
      const driver = ppgServerlessRuntimeDriverDescriptor.create();
      await driver.connect({ kind: 'ppgClient', client: fake.client });

      const connection = await driver.acquireConnection();
      await expect(connection.beginTransaction()).rejects.toBeInstanceOf(SqlQueryError);

      await connection.release();
    });
  });
});
