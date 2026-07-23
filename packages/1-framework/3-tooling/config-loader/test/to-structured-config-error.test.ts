import { ConfigValidationError } from '@prisma-next/config/config-validation';
import { describe, expect, it } from 'vitest';
import { ConfigFileNotFoundError } from '../src/errors';
import { toStructuredConfigError } from '../src/load';

describe('toStructuredConfigError', () => {
  it('maps ConfigValidationError to a CONFIG.VALIDATION_FAILED structured error carrying the field reason', () => {
    const mapped = toStructuredConfigError(
      new ConfigValidationError('contract.output', 'collides with input'),
    );

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.VALIDATION_FAILED',
      why: 'collides with input',
    });
  });

  it('maps ConfigFileNotFoundError to a CONFIG.FILE_NOT_FOUND structured error', () => {
    const mapped = toStructuredConfigError(
      new ConfigFileNotFoundError('/project/prisma-next.config.ts'),
    );

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.FILE_NOT_FOUND',
    });
  });

  it('passes a structured error (one carrying a string code) through unchanged', () => {
    const structured = Object.assign(new Error('already structured'), { code: '4123' });

    expect(toStructuredConfigError(structured)).toBe(structured);
  });

  it('maps an ENOENT-flavoured plain error to a CONFIG.FILE_NOT_FOUND with the resolved display path', () => {
    const mapped = toStructuredConfigError(
      new Error('ENOENT: no such file'),
      'prisma-next.config.ts',
    );

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.FILE_NOT_FOUND',
      why: 'ENOENT: no such file',
    });
  });

  it('maps a "not found" plain error without a configPath to a CONFIG.FILE_NOT_FOUND', () => {
    const mapped = toStructuredConfigError(new Error('module not found'));

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.FILE_NOT_FOUND',
    });
  });

  it('wraps any other plain error in a CLI.UNEXPECTED unexpected error', () => {
    const mapped = toStructuredConfigError(new Error('boom'));

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: 'CLI.UNEXPECTED',
      why: 'Failed to load config: boom',
    });
  });

  it('stringifies a non-Error throwable into a CLI.UNEXPECTED unexpected error', () => {
    const mapped = toStructuredConfigError('not even an error');

    expect(mapped).toMatchObject({
      name: 'CliStructuredError',
      code: 'CLI.UNEXPECTED',
    });
  });
});
