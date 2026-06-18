import { ConfigFileNotFoundError, ConfigValidationError } from '@prisma-next/config/load-helpers';
import { describe, expect, it } from 'vitest';
import { toStructuredConfigError } from '../src/load';

describe('toStructuredConfigError', () => {
  it('maps ConfigValidationError to a 4009 structured error carrying the field reason', () => {
    const mapped = toStructuredConfigError(
      new ConfigValidationError('contract.output', 'collides with input'),
    );

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: '4009',
      why: 'collides with input',
    });
  });

  it('maps ConfigFileNotFoundError to a 4001 structured error', () => {
    const mapped = toStructuredConfigError(
      new ConfigFileNotFoundError('/project/prisma-next.config.ts'),
    );

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: '4001',
    });
  });

  it('passes a structured error (one carrying a string code) through unchanged', () => {
    const structured = Object.assign(new Error('already structured'), { code: '4123' });

    expect(toStructuredConfigError(structured)).toBe(structured);
  });

  it('maps an ENOENT-flavoured plain error to a 4001 with the resolved display path', () => {
    const mapped = toStructuredConfigError(
      new Error('ENOENT: no such file'),
      'prisma-next.config.ts',
    );

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: '4001',
      why: 'ENOENT: no such file',
    });
  });

  it('maps a "not found" plain error without a configPath to a 4001', () => {
    const mapped = toStructuredConfigError(new Error('module not found'));

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: '4001',
    });
  });

  it('wraps any other plain error in a 4999 unexpected error', () => {
    const mapped = toStructuredConfigError(new Error('boom'));

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: '4999',
      why: 'Failed to load config: boom',
    });
  });

  it('stringifies a non-Error throwable into a 4999 unexpected error', () => {
    const mapped = toStructuredConfigError('not even an error');

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: '4999',
    });
  });
});
