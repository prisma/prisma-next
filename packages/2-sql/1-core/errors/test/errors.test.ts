import { describe, expect, it } from 'vitest';
import { SqlConnectionError, SqlQueryError } from '../src/errors';

describe('SqlQueryError', () => {
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
      cause: originalError,
    });
  });

  it('creates error with minimal fields', () => {
    const error = new SqlQueryError('Query failed');

    expect(error).toMatchObject({
      message: 'Query failed',
      kind: 'sql_query',
    });
    expect(error.sqlState).toBeUndefined();
    expect(error.constraint).toBeUndefined();
    expect(error.table).toBeUndefined();
    expect(error.column).toBeUndefined();
    expect(error.detail).toBeUndefined();
  });

  it('preserves original error stack trace via cause', () => {
    const originalError = new Error('Original error');
    originalError.stack = 'Error: Original error\n    at test.js:1:1';
    const error = new SqlQueryError('Query failed', { cause: originalError });

    expect(error.cause).toBe(originalError);
    if (error.cause instanceof Error) {
      expect(error.cause.stack).toBe('Error: Original error\n    at test.js:1:1');
    }
  });

  it('is() type predicate', () => {
    expect(SqlQueryError.is(new SqlQueryError('Query failed'))).toBe(true);
    expect(SqlQueryError.is(new Error('Not a SqlQueryError'))).toBe(false);
    expect(SqlQueryError.is(new SqlConnectionError('Connection failed'))).toBe(false);
    expect(SqlQueryError.is(null)).toBe(false);
    expect(SqlQueryError.is('string')).toBe(false);
  });
});

describe('SqlConnectionError', () => {
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
      cause: originalError,
    });
  });

  it('creates error with minimal fields', () => {
    const error = new SqlConnectionError('Connection failed');

    expect(error).toMatchObject({
      message: 'Connection failed',
      kind: 'sql_connection',
    });
    expect(error.transient).toBeUndefined();
  });

  it('preserves original error stack trace via cause', () => {
    const originalError = new Error('Original error');
    originalError.stack = 'Error: Original error\n    at test.js:1:1';
    const error = new SqlConnectionError('Connection failed', { cause: originalError });

    expect(error.cause).toBe(originalError);
    if (error.cause instanceof Error) {
      expect(error.cause.stack).toBe('Error: Original error\n    at test.js:1:1');
    }
  });

  it('is() type predicate', () => {
    expect(SqlConnectionError.is(new SqlConnectionError('Connection failed'))).toBe(true);
    expect(SqlConnectionError.is(new Error('Not a SqlConnectionError'))).toBe(false);
    expect(SqlConnectionError.is(new SqlQueryError('Query failed'))).toBe(false);
    expect(SqlConnectionError.is(null)).toBe(false);
    expect(SqlConnectionError.is('string')).toBe(false);
  });
});
