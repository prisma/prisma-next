import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';
import { describe, expect, it } from 'vitest';
import { normalizePgError } from '../src/normalize-error';

describe('normalizePgError', () => {
  describe('Postgres SQLSTATE errors', () => {
    it('normalizes unique violation error to SqlQueryError', () => {
      const pgError = new Error(
        'duplicate key value violates unique constraint "user_email_unique"',
      );
      (pgError as { code?: string }).code = '23505';
      (pgError as { constraint?: string }).constraint = 'user_email_unique';
      (pgError as { table?: string }).table = 'user';
      (pgError as { column?: string }).column = 'email';
      (pgError as { detail?: string }).detail = 'Key (email)=(test@example.com) already exists.';

      expect(() => {
        normalizePgError(pgError);
      }).toThrow(SqlQueryError);

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlQueryError.is(error)).toBe(true);
        if (SqlQueryError.is(error)) {
          expect(error.message).toBe(pgError.message);
          expect(error.sqlState).toBe('23505');
          expect(error.constraint).toBe('user_email_unique');
          expect(error.table).toBe('user');
          expect(error.column).toBe('email');
          expect(error.detail).toBe('Key (email)=(test@example.com) already exists.');
          expect(error.cause).toBe(pgError);
        }
      }
    });

    it('normalizes syntax error to SqlQueryError', () => {
      const pgError = new Error('syntax error at or near "INVALID"');
      (pgError as { code?: string }).code = '42601';

      expect(() => {
        normalizePgError(pgError);
      }).toThrow(SqlQueryError);

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlQueryError.is(error)).toBe(true);
        if (SqlQueryError.is(error)) {
          expect(error.sqlState).toBe('42601');
          expect(error.cause).toBe(pgError);
        }
      }
    });

    it('normalizes permission error to SqlQueryError', () => {
      const pgError = new Error('permission denied for table user');
      (pgError as { code?: string }).code = '42501';

      expect(() => {
        normalizePgError(pgError);
      }).toThrow(SqlQueryError);

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlQueryError.is(error)).toBe(true);
        if (SqlQueryError.is(error)) {
          expect(error.sqlState).toBe('42501');
          expect(error.cause).toBe(pgError);
        }
      }
    });

    it('normalizes error with partial fields', () => {
      const pgError = new Error('some error');
      (pgError as { code?: string }).code = '23503';
      (pgError as { table?: string }).table = 'post';

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlQueryError.is(error)).toBe(true);
        if (SqlQueryError.is(error)) {
          expect(error.sqlState).toBe('23503');
          expect(error.table).toBe('post');
          expect(error.constraint).toBeUndefined();
          expect(error.column).toBeUndefined();
          expect(error.detail).toBeUndefined();
        }
      }
    });
  });

  describe('Connection errors', () => {
    it('normalizes ECONNRESET to SqlConnectionError', () => {
      const pgError = new Error('Connection terminated unexpectedly');
      (pgError as { code?: string }).code = 'ECONNRESET';

      expect(() => {
        normalizePgError(pgError);
      }).toThrow(SqlConnectionError);

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlConnectionError.is(error)).toBe(true);
        if (SqlConnectionError.is(error)) {
          expect(error.message).toBe(pgError.message);
          expect(error.transient).toBe(true);
          expect(error.cause).toBe(pgError);
        }
      }
    });

    it('normalizes ETIMEDOUT to SqlConnectionError', () => {
      const pgError = new Error('Connection timeout');
      (pgError as { code?: string }).code = 'ETIMEDOUT';

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlConnectionError.is(error)).toBe(true);
        if (SqlConnectionError.is(error)) {
          expect(error.transient).toBe(true);
          expect(error.cause).toBe(pgError);
        }
      }
    });

    it('normalizes ECONNREFUSED to SqlConnectionError', () => {
      const pgError = new Error('Connection refused');
      (pgError as { code?: string }).code = 'ECONNREFUSED';

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlConnectionError.is(error)).toBe(true);
        if (SqlConnectionError.is(error)) {
          expect(error.transient).toBe(false);
          expect(error.cause).toBe(pgError);
        }
      }
    });

    it('normalizes connection error from message', () => {
      const pgError = new Error('Connection terminated unexpectedly');

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlConnectionError.is(error)).toBe(true);
        if (SqlConnectionError.is(error)) {
          expect(error.cause).toBe(pgError);
        }
      }
    });

    it('normalizes connection closed error from message', () => {
      const pgError = new Error('Connection closed');

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlConnectionError.is(error)).toBe(true);
      }
    });
  });

  describe('Unknown errors', () => {
    it('re-throws non-Error values', () => {
      expect(() => {
        normalizePgError('string error');
      }).toThrow('string error');

      expect(() => {
        normalizePgError(123);
      }).toThrow(123);
    });

    it('re-throws errors without recognized codes or messages', () => {
      const unknownError = new Error('Some unknown error');
      (unknownError as { code?: string }).code = 'UNKNOWN_CODE';

      expect(() => {
        normalizePgError(unknownError);
      }).toThrow(unknownError);
    });

    it('preserves original error when re-throwing', () => {
      const originalError = new Error('Unknown error');
      originalError.stack = 'Error: Unknown error\n    at test.js:1:1';

      try {
        normalizePgError(originalError);
      } catch (error) {
        expect(error).toBe(originalError);
        expect((error as Error).stack).toBe('Error: Unknown error\n    at test.js:1:1');
      }
    });
  });

  describe('Stack trace preservation', () => {
    it('preserves original stack trace via cause for SqlQueryError', () => {
      const pgError = new Error('Query failed');
      pgError.stack = 'Error: Query failed\n    at query.js:10:5';
      (pgError as { code?: string }).code = '23505';

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlQueryError.is(error)).toBe(true);
        if (SqlQueryError.is(error)) {
          expect(error.cause).toBe(pgError);
          expect(error.cause?.stack).toBe('Error: Query failed\n    at query.js:10:5');
        }
      }
    });

    it('preserves original stack trace via cause for SqlConnectionError', () => {
      const pgError = new Error('Connection failed');
      pgError.stack = 'Error: Connection failed\n    at connect.js:5:3';
      (pgError as { code?: string }).code = 'ECONNRESET';

      try {
        normalizePgError(pgError);
      } catch (error) {
        expect(SqlConnectionError.is(error)).toBe(true);
        if (SqlConnectionError.is(error)) {
          expect(error.cause).toBe(pgError);
          expect(error.cause?.stack).toBe('Error: Connection failed\n    at connect.js:5:3');
        }
      }
    });
  });
});
