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

    expect(error.message).toBe('Query failed');
    expect(error.kind).toBe('sql_query');
    expect(error.sqlState).toBe('23505');
    expect(error.constraint).toBe('user_email_unique');
    expect(error.table).toBe('user');
    expect(error.column).toBe('email');
    expect(error.detail).toBe('Key (email)=(test@example.com) already exists.');
    expect(error.cause).toBe(originalError);
  });

  it('creates error with minimal fields', () => {
    const error = new SqlQueryError('Query failed');

    expect(error.message).toBe('Query failed');
    expect(error.kind).toBe('sql_query');
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
    expect(error.cause?.stack).toBe('Error: Original error\n    at test.js:1:1');
  });

  it('is() returns true for SqlQueryError instance', () => {
    const error = new SqlQueryError('Query failed');
    expect(SqlQueryError.is(error)).toBe(true);
  });

  it('is() returns false for other error types', () => {
    const error = new Error('Not a SqlQueryError');
    expect(SqlQueryError.is(error)).toBe(false);
  });

  it('is() returns false for SqlConnectionError', () => {
    const error = new SqlConnectionError('Connection failed');
    expect(SqlQueryError.is(error)).toBe(false);
  });

  it('is() returns false for null', () => {
    expect(SqlQueryError.is(null)).toBe(false);
  });

  it('is() returns false for non-objects', () => {
    expect(SqlQueryError.is('string')).toBe(false);
    expect(SqlQueryError.is(123)).toBe(false);
  });
});

describe('SqlConnectionError', () => {
  it('creates error with all fields', () => {
    const originalError = new Error('Original error');
    const error = new SqlConnectionError('Connection failed', {
      cause: originalError,
      transient: true,
    });

    expect(error.message).toBe('Connection failed');
    expect(error.kind).toBe('sql_connection');
    expect(error.transient).toBe(true);
    expect(error.cause).toBe(originalError);
  });

  it('creates error with minimal fields', () => {
    const error = new SqlConnectionError('Connection failed');

    expect(error.message).toBe('Connection failed');
    expect(error.kind).toBe('sql_connection');
    expect(error.transient).toBeUndefined();
  });

  it('preserves original error stack trace via cause', () => {
    const originalError = new Error('Original error');
    originalError.stack = 'Error: Original error\n    at test.js:1:1';
    const error = new SqlConnectionError('Connection failed', { cause: originalError });

    expect(error.cause).toBe(originalError);
    expect(error.cause?.stack).toBe('Error: Original error\n    at test.js:1:1');
  });

  it('is() returns true for SqlConnectionError instance', () => {
    const error = new SqlConnectionError('Connection failed');
    expect(SqlConnectionError.is(error)).toBe(true);
  });

  it('is() returns false for other error types', () => {
    const error = new Error('Not a SqlConnectionError');
    expect(SqlConnectionError.is(error)).toBe(false);
  });

  it('is() returns false for SqlQueryError', () => {
    const error = new SqlQueryError('Query failed');
    expect(SqlConnectionError.is(error)).toBe(false);
  });

  it('is() returns false for null', () => {
    expect(SqlConnectionError.is(null)).toBe(false);
  });

  it('is() returns false for non-objects', () => {
    expect(SqlConnectionError.is('string')).toBe(false);
    expect(SqlConnectionError.is(123)).toBe(false);
  });
});
