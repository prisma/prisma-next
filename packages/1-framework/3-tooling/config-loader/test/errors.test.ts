import { describe, expect, it } from 'vitest';
import { ConfigFileNotFoundError } from '../src/errors';

describe('ConfigFileNotFoundError', () => {
  it('defaults the message and leaves configPath/why unset when no arguments are given', () => {
    const error = new ConfigFileNotFoundError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConfigFileNotFoundError');
    expect(error.message).toBe('Config file not found');
    expect(error.configPath).toBeUndefined();
    expect(error.why).toBeUndefined();
  });

  it('includes the path in the message and exposes configPath when given a path', () => {
    const error = new ConfigFileNotFoundError('/project/prisma-next.config.ts');

    expect(error.message).toBe('Config file not found: /project/prisma-next.config.ts');
    expect(error.configPath).toBe('/project/prisma-next.config.ts');
    expect(error.why).toBeUndefined();
  });

  it('uses an explicit why as the message and exposes both configPath and why', () => {
    const error = new ConfigFileNotFoundError(
      '/project/prisma-next.config.ts',
      'compilation failed',
    );

    expect(error.message).toBe('compilation failed');
    expect(error.configPath).toBe('/project/prisma-next.config.ts');
    expect(error.why).toBe('compilation failed');
  });

  it('uses an explicit why even when no path is supplied', () => {
    const error = new ConfigFileNotFoundError(undefined, 'no config discoverable');

    expect(error.message).toBe('no config discoverable');
    expect(error.configPath).toBeUndefined();
    expect(error.why).toBe('no config discoverable');
  });
});
