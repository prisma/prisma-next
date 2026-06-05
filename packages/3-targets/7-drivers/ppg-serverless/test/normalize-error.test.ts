import { DatabaseError, HttpResponseError, ValidationError, WebSocketError } from '@prisma/ppg';
import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';
import { describe, expect, it } from 'vitest';
import { normalizePpgError } from '../src/normalize-error';

describe('normalizePpgError', () => {
  describe('DatabaseError', () => {
    it('maps to SqlQueryError with SQLSTATE and known details fields', () => {
      const pgErr = new DatabaseError({
        message: 'duplicate key value',
        code: '23505',
        constraint: 'users_email_unique',
        table: 'users',
        column: 'email',
        detail: 'Key (email)=(a@b) already exists.',
      });

      const normalized = normalizePpgError(pgErr);
      expect(SqlQueryError.is(normalized)).toBe(true);
      if (SqlQueryError.is(normalized)) {
        expect(normalized.sqlState).toBe('23505');
        expect(normalized.constraint).toBe('users_email_unique');
        expect(normalized.table).toBe('users');
        expect(normalized.column).toBe('email');
        expect(normalized.detail).toBe('Key (email)=(a@b) already exists.');
        expect(normalized.cause).toBe(pgErr);
        expect(normalized.message).toBe('duplicate key value');
      }
    });

    it('leaves optional fields undefined when details does not carry them', () => {
      const pgErr = new DatabaseError({
        message: 'syntax error',
        code: '42601',
      });

      const normalized = normalizePpgError(pgErr);
      expect(SqlQueryError.is(normalized)).toBe(true);
      if (SqlQueryError.is(normalized)) {
        expect(normalized.sqlState).toBe('42601');
        expect(normalized.constraint).toBeUndefined();
        expect(normalized.table).toBeUndefined();
        expect(normalized.column).toBeUndefined();
        expect(normalized.detail).toBeUndefined();
      }
    });

    it('propagates partial details (e.g. table without constraint)', () => {
      const pgErr = new DatabaseError({
        message: 'foreign key violation',
        code: '23503',
        table: 'posts',
      });

      const normalized = normalizePpgError(pgErr);
      if (SqlQueryError.is(normalized)) {
        expect(normalized.table).toBe('posts');
        expect(normalized.constraint).toBeUndefined();
      } else {
        expect.fail('expected SqlQueryError');
      }
    });
  });

  describe('WebSocketError', () => {
    it('maps abnormal closure (1011) to transient SqlConnectionError', () => {
      const wsErr = new WebSocketError({ message: 'server error', closureCode: 1011 });
      const normalized = normalizePpgError(wsErr);

      expect(SqlConnectionError.is(normalized)).toBe(true);
      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(true);
        expect(normalized.cause).toBe(wsErr);
      }
    });

    it('maps normal closure (1000) to non-transient SqlConnectionError', () => {
      const wsErr = new WebSocketError({ message: 'normal', closureCode: 1000 });
      const normalized = normalizePpgError(wsErr);

      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(false);
      } else {
        expect.fail('expected SqlConnectionError');
      }
    });

    it('maps going-away (1001) to non-transient SqlConnectionError', () => {
      const wsErr = new WebSocketError({ message: 'going away', closureCode: 1001 });
      const normalized = normalizePpgError(wsErr);

      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(false);
      } else {
        expect.fail('expected SqlConnectionError');
      }
    });

    it('treats missing closureCode as non-transient (no signal)', () => {
      const wsErr = new WebSocketError({ message: 'unknown closure' });
      const normalized = normalizePpgError(wsErr);

      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(false);
      } else {
        expect.fail('expected SqlConnectionError');
      }
    });

    it.each([
      [1006, 'abnormal closure'],
      [1012, 'service restart'],
      [1013, 'try again later'],
      [1014, 'bad gateway'],
    ])('maps server/temporary closure %d (%s) to transient', (closureCode, label) => {
      const wsErr = new WebSocketError({ message: label, closureCode });
      const normalized = normalizePpgError(wsErr);

      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(true);
      } else {
        expect.fail('expected SqlConnectionError');
      }
    });

    it.each([
      [1002, 'protocol error'],
      [1003, 'unsupported data'],
      [1008, 'policy violation'],
      [1009, 'message too big'],
    ])('maps protocol/policy closure %d (%s) to non-transient', (closureCode, label) => {
      const wsErr = new WebSocketError({ message: label, closureCode });
      const normalized = normalizePpgError(wsErr);

      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(false);
      } else {
        expect.fail('expected SqlConnectionError');
      }
    });
  });

  describe('HttpResponseError', () => {
    it('maps 5xx to transient SqlConnectionError', () => {
      const httpErr = new HttpResponseError({ message: 'bad gateway', statusCode: 502 });
      const normalized = normalizePpgError(httpErr);

      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(true);
        expect(normalized.cause).toBe(httpErr);
      } else {
        expect.fail('expected SqlConnectionError');
      }
    });

    it('maps 4xx to non-transient SqlConnectionError', () => {
      const httpErr = new HttpResponseError({ message: 'forbidden', statusCode: 403 });
      const normalized = normalizePpgError(httpErr);

      if (SqlConnectionError.is(normalized)) {
        expect(normalized.transient).toBe(false);
      } else {
        expect.fail('expected SqlConnectionError');
      }
    });
  });

  describe('ValidationError', () => {
    it('passes through unchanged', () => {
      const v = new ValidationError('bad config');
      const normalized = normalizePpgError(v);
      expect(normalized).toBe(v);
    });
  });

  describe('unknown errors', () => {
    it('returns plain Errors as-is', () => {
      const plain = new Error('random failure');
      const normalized = normalizePpgError(plain);
      expect(normalized).toBe(plain);
    });

    it('wraps non-Error values in an Error', () => {
      expect(normalizePpgError('string failure').message).toBe('string failure');
      expect(normalizePpgError(42).message).toBe('42');
      expect(normalizePpgError(null).message).toBe('null');
    });
  });

  describe('cause preservation', () => {
    it('preserves the cause for SqlQueryError', () => {
      const pgErr = new DatabaseError({ message: 'oops', code: '23502' });
      pgErr.stack = 'Error: oops\n  at orig.js:1:1';
      const normalized = normalizePpgError(pgErr);
      if (SqlQueryError.is(normalized)) {
        expect(normalized.cause).toBe(pgErr);
        if (normalized.cause instanceof Error) {
          expect(normalized.cause.stack).toContain('orig.js');
        }
      }
    });

    it('preserves the cause for SqlConnectionError', () => {
      const wsErr = new WebSocketError({ message: 'closed', closureCode: 1011 });
      const normalized = normalizePpgError(wsErr);
      if (SqlConnectionError.is(normalized)) {
        expect(normalized.cause).toBe(wsErr);
      }
    });
  });
});
