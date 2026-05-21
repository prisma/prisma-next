import { afterEach, describe, expect, it } from 'vitest';
import { parseGlobalFlags } from '../../src/utils/global-flags';

describe('parseGlobalFlags output format', () => {
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it('defaults to pretty on a TTY when no format flags are set', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const flags = parseGlobalFlags({});
    expect(flags.format).toBe('pretty');
    expect(flags.json).toBeUndefined();
  });

  it('defaults to json when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const flags = parseGlobalFlags({});
    expect(flags.format).toBe('json');
    expect(flags.json).toBe(true);
  });

  it('honours --format pretty on a non-TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const flags = parseGlobalFlags({ format: 'pretty' });
    expect(flags.format).toBe('pretty');
    expect(flags.json).toBeUndefined();
  });

  it('honours --format json', () => {
    const flags = parseGlobalFlags({ format: 'json' });
    expect(flags.format).toBe('json');
    expect(flags.json).toBe(true);
  });

  it('treats --json as --format json', () => {
    const flags = parseGlobalFlags({ json: true });
    expect(flags.format).toBe('json');
    expect(flags.json).toBe(true);
  });

  it('allows --format json together with --json', () => {
    const flags = parseGlobalFlags({ format: 'json', json: true });
    expect(flags.format).toBe('json');
    expect(flags.json).toBe(true);
  });

  it('rejects --format pretty together with --json', () => {
    expect(() => parseGlobalFlags({ format: 'pretty', json: true })).toThrow(
      /--format pretty.*--json/i,
    );
  });

  it('rejects unknown --format values with allowed values', () => {
    expect(() => parseGlobalFlags({ format: 'yaml' })).toThrow(/Invalid --format/i);
    expect(() => parseGlobalFlags({ format: 'yaml' })).toThrow(/pretty.*json/i);
  });

  it('disables color for json output', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const flags = parseGlobalFlags({ format: 'json' });
    expect(flags.color).toBe(false);
  });
});
