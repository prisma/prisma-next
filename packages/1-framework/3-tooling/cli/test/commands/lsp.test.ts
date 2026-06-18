import { describe, expect, it } from 'vitest';
import { createLspCommand } from '../../src/commands/lsp';

describe('createLspCommand', () => {
  it('registers a top-level `lsp` command', () => {
    const command = createLspCommand();
    expect(command.name()).toBe('lsp');
  });

  it('exposes the --stdio and --config transport flags', () => {
    const command = createLspCommand();
    const flagNames = command.options.map((option) => option.long);
    expect(flagNames).toContain('--stdio');
    expect(flagNames).toContain('--config');
  });
});
