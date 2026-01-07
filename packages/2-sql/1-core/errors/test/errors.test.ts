import { describe, expect, it } from 'vitest';
import { SqlConnectionError, type SqlDriverError, SqlQueryError } from '../src/errors.ts';

/**
 * Test error class for verifying is() predicate rejects other error types.
 */
class OtherErrorClass extends Error implements SqlDriverError<'test error'> {
  readonly kind = 'test error' as const;
}

/**
 * Test harness for SQL error classes.
 * Automatically adds common tests (is() predicate, stack trace preservation).
 * Caller provides custom tests in the callback.
 */
function describeErrorClass<
  T extends Error & SqlDriverError<string>,
  TErrorClass extends {
    // biome-ignore lint/suspicious/noExplicitAny: don't care about specific type for test harness
    new (message: string, ...args: any[]): T;
    is(error: unknown): error is T;
    readonly ERROR_NAME: string;
  },
>(ErrorClass: TErrorClass, customTests: () => void): void {
  const name = ErrorClass.ERROR_NAME;
  describe(name, () => {
    // Custom tests provided by caller
    customTests();

    // Common tests automatically added
    it('preserves original error stack trace via cause', () => {
      const originalError = new Error('Original error');
      originalError.stack = 'Error: Original error\n    at test.js:1:1';
      const error = new ErrorClass('Test error', { cause: originalError });

      expect(error.cause).toBe(originalError);
      expect((error.cause as Error).stack).toBe('Error: Original error\n    at test.js:1:1');
    });

    describe('is() type predicate', () => {
      it(`returns true on instances of ${name}`, () => {
        const error = new ErrorClass('Test error');
        expect(ErrorClass.is(error)).toBe(true);
        expect(ErrorClass.is(new Error(`Not a ${name}`))).toBe(false);
        expect(ErrorClass.is(new OtherErrorClass('Other error'))).toBe(false);
        expect(ErrorClass.is(null)).toBe(false);
        expect(ErrorClass.is('string')).toBe(false);
      });
    });
  });
}

describeErrorClass(SqlQueryError, () => {
  it('creates error with all fields', () => {
    const originalError = new Error('Original error');
    const error = new SqlQueryError('Query failed', {
      cause: originalError,
      sqlState: '23505',
      constraint: 'user_email_unique',
      table: 'user',
      column: 'email',
      detail: 'Key (email)=(test@example.com) already exists.',
    });

    expect(error).toMatchObject({
      message: 'Query failed',
      kind: 'sql_query',
      sqlState: '23505',
      constraint: 'user_email_unique',
      table: 'user',
      column: 'email',
      detail: 'Key (email)=(test@example.com) already exists.',
    });
  });

  it('creates error with minimal fields', () => {
    const error = new SqlQueryError('Query failed');

    expect(error).toMatchObject({
      message: 'Query failed',
      kind: 'sql_query',
    });
  });
});

describeErrorClass(SqlConnectionError, () => {
  it('creates error with all fields', () => {
    const originalError = new Error('Original error');
    const error = new SqlConnectionError('Connection failed', {
      cause: originalError,
      transient: true,
    });

    expect(error).toMatchObject({
      message: 'Connection failed',
      kind: 'sql_connection',
      transient: true,
    });
  });

  it('creates error with minimal fields', () => {
    const error = new SqlConnectionError('Connection failed');

    expect(error).toMatchObject({
      message: 'Connection failed',
      kind: 'sql_connection',
    });
  });
});
