import { describe, expect, it } from 'vitest';
import { sanitizeCommanderResult } from '../src/sanitize';

describe('sanitizeCommanderResult', () => {
  it('extracts the command name and parsed flag names, dropping all values and positionals', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma-next', 'migration', 'new'],
        positionalArgs: ['user-feature', '/Users/alice/secret.toml'],
        parsedOptions: {
          name: 'user-feature',
          'dry-run': true,
          target: 'postgres',
          'connection-string': 'postgres://u:p@h/d',
        },
      }),
    ).toEqual({
      command: 'migration new',
      flags: ['name', 'dry-run', 'target', 'connection-string'],
    });
  });

  it('returns the empty flag list when no options were parsed', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma-next', 'init'],
        positionalArgs: [],
        parsedOptions: {},
      }),
    ).toEqual({
      command: 'init',
      flags: [],
    });
  });

  it('joins multi-segment command paths into a single space-delimited command field', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma-next', 'contract', 'emit'],
        positionalArgs: [],
        parsedOptions: { config: '/Users/alice/secrets/x.toml' },
      }).command,
    ).toBe('contract emit');
  });

  it('strips the root program name (`prisma-next`) so command starts at the first verb', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma-next', 'help'],
        positionalArgs: [],
        parsedOptions: {},
      }).command,
    ).toBe('help');
  });

  it('preserves the order of flag names as commander returned them', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma-next', 'migrate'],
        positionalArgs: [],
        parsedOptions: { to: '/x', yes: true, json: false, verbose: 2 },
      }).flags,
    ).toEqual(['to', 'yes', 'json', 'verbose']);
  });

  it('never reads positional args; the positionalArgs input is intentionally accepted but unused', () => {
    const out = sanitizeCommanderResult({
      commandPath: ['prisma-next', 'init'],
      positionalArgs: ['SHOULD-NEVER-LEAK', 'NEITHER-SHOULD-THIS'],
      parsedOptions: { target: 'postgres' },
    });
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('SHOULD-NEVER-LEAK');
    expect(serialised).not.toContain('NEITHER-SHOULD-THIS');
  });

  it('never includes flag values in its output, even when the value is a string identical to the flag name', () => {
    const out = sanitizeCommanderResult({
      commandPath: ['prisma-next', 'migration', 'new'],
      positionalArgs: [],
      parsedOptions: {
        name: 'add-name-but-the-string-name-should-not-appear-twice',
      },
    });
    expect(out.flags).toEqual(['name']);
    expect(JSON.stringify(out)).not.toContain('add-name');
  });

  it('handles an empty commandPath by returning an empty command string', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: [],
        positionalArgs: [],
        parsedOptions: {},
      }).command,
    ).toBe('');
  });
});
