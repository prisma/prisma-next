import { describe, expect, it } from 'vitest';
import { maskConnectionUrl, sanitizeErrorMessage } from '../../src/utils/command-helpers';

describe('maskConnectionUrl', () => {
  it('masks username and password in standard PostgreSQL URL', () => {
    const url = 'postgresql://admin:secret@localhost:5432/mydb';
    const masked = maskConnectionUrl(url);

    expect(masked).toContain('****');
    expect(masked).not.toContain('admin');
    expect(masked).not.toContain('secret');
    expect(masked).toContain('localhost');
    expect(masked).toContain('mydb');
  });

  it('masks password in query parameters', () => {
    const url = 'postgresql://localhost:5432/mydb?password=secret';
    const masked = maskConnectionUrl(url);

    expect(masked).not.toContain('secret');
    expect(masked).toContain('password=****');
  });

  it('masks sslpassword query parameter', () => {
    const url = 'postgresql://localhost:5432/mydb?sslpassword=sslsecret';
    const masked = maskConnectionUrl(url);

    expect(masked).not.toContain('sslsecret');
  });

  it('preserves URL without credentials', () => {
    const url = 'postgresql://localhost:5432/mydb';
    const masked = maskConnectionUrl(url);

    expect(masked).toContain('localhost');
    expect(masked).toContain('mydb');
  });

  it('masks password and user in libpq-style connection string', () => {
    const url = 'host=localhost password=secret user=admin dbname=mydb';
    const masked = maskConnectionUrl(url);

    expect(masked).not.toContain('secret');
    expect(masked).not.toContain('admin');
    expect(masked).toContain('password=****');
    expect(masked).toContain('user=****');
    expect(masked).toContain('host=localhost');
    expect(masked).toContain('dbname=mydb');
  });
});

describe('sanitizeErrorMessage', () => {
  it('returns message unchanged when no connection URL provided', () => {
    const message = 'Something failed';
    expect(sanitizeErrorMessage(message)).toBe(message);
    expect(sanitizeErrorMessage(message, undefined)).toBe(message);
  });

  it('strips raw connection URL from error message', () => {
    const url = 'postgresql://admin:secret@localhost:5432/mydb';
    const message = `Connection failed: ${url}`;
    const sanitized = sanitizeErrorMessage(message, url);

    expect(sanitized).not.toContain('secret');
    expect(sanitized).not.toContain('admin');
    expect(sanitized).toContain('Connection failed');
  });

  it('strips password that appears independently in the message', () => {
    const url = 'postgresql://admin:supersecret@localhost:5432/mydb';
    const message = 'password authentication failed for user "admin" with password supersecret';
    const sanitized = sanitizeErrorMessage(message, url);

    expect(sanitized).not.toContain('supersecret');
  });

  it('handles libpq-style connection strings in messages', () => {
    const url = 'host=localhost password=secret user=admin dbname=mydb';
    const message = 'Failed to connect: host=localhost password=secret user=admin';
    const sanitized = sanitizeErrorMessage(message, url);

    expect(sanitized).not.toContain('password=secret');
    expect(sanitized).not.toContain('user=admin');
  });
});
