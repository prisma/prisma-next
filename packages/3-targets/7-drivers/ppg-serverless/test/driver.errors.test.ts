import { DatabaseError, HttpResponseError, ValidationError, WebSocketError } from '@prisma/ppg';
import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';
import { describe, expect, it } from 'vitest';
import ppgServerlessRuntimeDriverDescriptor from '../src/exports/runtime';
import { col, makeFakeClient, row } from './_fakes';

describe('@prisma-next/driver-ppg-serverless / errors', () => {
  it('normalizes DatabaseError to SqlQueryError on query', async () => {
    const pgErr = new DatabaseError({
      message: 'duplicate key value violates unique constraint "user_email_unique"',
      code: '23505',
      constraint: 'user_email_unique',
      table: 'user',
      column: 'email',
      detail: 'Key (email)=(a@b) already exists.',
    });

    const fake = makeFakeClient(() => pgErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    const promise = driver.query('insert into users(email) values ($1)', ['a@b']);
    await expect(promise).rejects.toBeInstanceOf(SqlQueryError);

    try {
      await driver.query('insert into users(email) values ($1)', ['a@b']);
    } catch (e) {
      expect(SqlQueryError.is(e)).toBe(true);
      if (SqlQueryError.is(e)) {
        expect(e.sqlState).toBe('23505');
        expect(e.constraint).toBe('user_email_unique');
        expect(e.table).toBe('user');
        expect(e.column).toBe('email');
        expect(e.detail).toBe('Key (email)=(a@b) already exists.');
        expect(e.cause).toBe(pgErr);
      }
    }
    // Sessions must still be closed even when the underlying call rejects.
    expect(fake.sessionCloseCalls()).toBe(2);
  });

  it('normalizes DatabaseError thrown during execute streaming to SqlQueryError', async () => {
    const pgErr = new DatabaseError({
      message: 'syntax error at or near "FROMM"',
      code: '42601',
    });
    const fake = makeFakeClient(() => pgErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    const consume = async () => {
      for await (const _r of driver.execute({ sql: 'selct 1' })) {
        // unused
      }
    };
    await expect(consume()).rejects.toBeInstanceOf(SqlQueryError);
    expect(fake.sessionCloseCalls()).toBe(1);
  });

  it('normalizes WebSocketError with abnormal closure to transient SqlConnectionError', async () => {
    const wsErr = new WebSocketError({
      message: 'WebSocket closed abnormally',
      closureCode: 1011,
      closureReason: 'server error',
    });
    const fake = makeFakeClient(() => wsErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    try {
      await driver.query('select 1');
      expect.fail('expected reject');
    } catch (e) {
      expect(SqlConnectionError.is(e)).toBe(true);
      if (SqlConnectionError.is(e)) {
        expect(e.transient).toBe(true);
        expect(e.cause).toBe(wsErr);
      }
    }
  });

  it('normalizes WebSocketError with normal closure (1000) to non-transient SqlConnectionError', async () => {
    const wsErr = new WebSocketError({
      message: 'normal closure',
      closureCode: 1000,
    });
    const fake = makeFakeClient(() => wsErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    try {
      await driver.query('select 1');
      expect.fail('expected reject');
    } catch (e) {
      expect(SqlConnectionError.is(e)).toBe(true);
      if (SqlConnectionError.is(e)) {
        expect(e.transient).toBe(false);
      }
    }
  });

  it('normalizes HttpResponseError 5xx to transient SqlConnectionError', async () => {
    const httpErr = new HttpResponseError({ message: 'gateway timeout', statusCode: 504 });
    const fake = makeFakeClient(() => httpErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    try {
      await driver.query('select 1');
      expect.fail('expected reject');
    } catch (e) {
      expect(SqlConnectionError.is(e)).toBe(true);
      if (SqlConnectionError.is(e)) {
        expect(e.transient).toBe(true);
        expect(e.cause).toBe(httpErr);
      }
    }
  });

  it('normalizes HttpResponseError 4xx to non-transient SqlConnectionError', async () => {
    const httpErr = new HttpResponseError({ message: 'unauthorized', statusCode: 401 });
    const fake = makeFakeClient(() => httpErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    try {
      await driver.query('select 1');
      expect.fail('expected reject');
    } catch (e) {
      expect(SqlConnectionError.is(e)).toBe(true);
      if (SqlConnectionError.is(e)) {
        expect(e.transient).toBe(false);
      }
    }
  });

  it('passes ValidationError through unchanged', async () => {
    const validationErr = new ValidationError('connection string is malformed');
    const fake = makeFakeClient(() => validationErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    try {
      await driver.query('select 1');
      expect.fail('expected reject');
    } catch (e) {
      expect(e).toBe(validationErr);
    }
  });

  it('closes session even when query rejects (try/finally)', async () => {
    const fake = makeFakeClient(() => new Error('boom'));
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    await expect(driver.query('select 1')).rejects.toThrow('boom');
    expect(fake.sessionCloseCalls()).toBe(1);
  });

  it('preserves the original error on cause for SqlQueryError', async () => {
    const pgErr = new DatabaseError({ message: 'oops', code: '23502' });
    const fake = makeFakeClient(() => pgErr);
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    try {
      await driver.query('select 1');
      expect.fail('expected reject');
    } catch (e) {
      if (SqlQueryError.is(e)) {
        expect(e.cause).toBe(pgErr);
      } else {
        expect.fail('expected SqlQueryError');
      }
    }
  });

  it('still works on a happy-path call after a previous query rejected', async () => {
    let n = 0;
    const fake = makeFakeClient(() => {
      n++;
      if (n === 1) return new DatabaseError({ message: 'first call fails', code: '42601' });
      return { columns: [col('x')], rows: [row(1)] };
    });
    const driver = ppgServerlessRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'ppgClient', client: fake.client });

    await expect(driver.query('select 1')).rejects.toBeInstanceOf(SqlQueryError);
    const result = await driver.query<{ x: number }>('select 1');
    expect(result.rows).toEqual([{ x: 1 }]);
  });
});
