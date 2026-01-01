import { describe, expect, it } from 'vitest';
import { SqlConnectionError, SqlQueryError } from '../src/errors';

/**
 * Test harness for SQL error classes.
 * Makes it easy to add new error types by providing factory functions and expected values.
 */
function testErrorClass<T extends Error & { readonly kind: string }>(config: {
  readonly name: string;
  readonly ErrorClass: {
    new (message: string, options?: unknown): T;
    is(error: unknown): error is T;
  };
  readonly createWithAllFields: () => T;
  readonly createWithMinimalFields: () => T;
  readonly expectedAllFields: Record<string, unknown>;
  readonly expectedMinimalFields: Record<string, unknown>;
  readonly otherErrorClass: new (message: string) => Error & { readonly kind: string };
}) {
  const {
    name,
    ErrorClass,
    createWithAllFields,
    createWithMinimalFields,
    expectedAllFields,
    expectedMinimalFields,
    otherErrorClass,
  } = config;

  describe(name, () => {
    it('creates error with all fields', () => {
      const error = createWithAllFields();
      expect(error).toMatchObject(expectedAllFields);
    });

    it('creates error with minimal fields', () => {
      const error = createWithMinimalFields();
      expect(error).toMatchObject(expectedMinimalFields);
    });

    it('preserves original error stack trace via cause', () => {
      const originalError = new Error('Original error');
      originalError.stack = 'Error: Original error\n    at test.js:1:1';
      const error = new ErrorClass('Test error', { cause: originalError });

      expect(error.cause).toBe(originalError);
      expect((error.cause as Error).stack).toBe('Error: Original error\n    at test.js:1:1');
    });

    it('is() type predicate', () => {
      expect(ErrorClass.is(createWithMinimalFields())).toBe(true);
      expect(ErrorClass.is(new Error('Not a ' + name))).toBe(false);
      expect(ErrorClass.is(new otherErrorClass('Other error'))).toBe(false);
      expect(ErrorClass.is(null)).toBe(false);
      expect(ErrorClass.is('string')).toBe(false);
    });
  });
}

testErrorClass({
  name: 'SqlQueryError',
  ErrorClass: SqlQueryError as {
    new (message: string, options?: unknown): SqlQueryError;
    is(error: unknown): error is SqlQueryError;
  },
  createWithAllFields: () => {
    const originalError = new Error('Original error');
    return new SqlQueryError('Query failed', {
      cause: originalError,
      sqlState: '23505',
      constraint: 'user_email_unique',
      table: 'user',
      column: 'email',
      detail: 'Key (email)=(test@example.com) already exists.',
    });
  },
  createWithMinimalFields: () => new SqlQueryError('Query failed'),
  expectedAllFields: {
    message: 'Query failed',
    kind: 'sql_query',
    sqlState: '23505',
    constraint: 'user_email_unique',
    table: 'user',
    column: 'email',
    detail: 'Key (email)=(test@example.com) already exists.',
  },
  expectedMinimalFields: {
    message: 'Query failed',
    kind: 'sql_query',
  },
  otherErrorClass: SqlConnectionError,
});

testErrorClass({
  name: 'SqlConnectionError',
  ErrorClass: SqlConnectionError as {
    new (message: string, options?: unknown): SqlConnectionError;
    is(error: unknown): error is SqlConnectionError;
  },
  createWithAllFields: () => {
    const originalError = new Error('Original error');
    return new SqlConnectionError('Connection failed', {
      cause: originalError,
      transient: true,
    });
  },
  createWithMinimalFields: () => new SqlConnectionError('Connection failed'),
  expectedAllFields: {
    message: 'Connection failed',
    kind: 'sql_connection',
    transient: true,
  },
  expectedMinimalFields: {
    message: 'Connection failed',
    kind: 'sql_connection',
  },
  otherErrorClass: SqlQueryError,
});
