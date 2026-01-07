import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import type { CliErrorConflict, CliErrorEnvelope } from '../src/utils/cli-errors.ts';
import { parseGlobalFlags } from '../src/utils/global-flags.ts';
import { formatErrorOutput } from '../src/utils/output.ts';

const baseError: CliErrorEnvelope = {
  code: 'PN-CLI-4020',
  domain: 'CLI',
  severity: 'error',
  summary: 'Migration planning failed',
  why: 'Conflicts detected',
  fix: 'Resolve conflicts',
  where: undefined,
  meta: undefined,
  docsUrl: undefined,
};

const createConflicts = (): readonly CliErrorConflict[] => [
  { kind: 'table', summary: 'First conflict' },
  { kind: 'column', summary: 'Second conflict' },
  { kind: 'index', summary: 'Third conflict' },
  { kind: 'constraint', summary: 'Fourth conflict' },
];

describe('formatErrorOutput - conflicts', () => {
  it('shows truncated conflict list when not verbose', () => {
    const conflicts = createConflicts();
    const error: CliErrorEnvelope = {
      ...baseError,
      meta: { conflicts },
    };

    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatErrorOutput(error, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Conflicts (showing 3 of 4):');
    expect(stripped).toContain('[table] First conflict');
    expect(stripped).toContain('[column] Second conflict');
    expect(stripped).toContain('[index] Third conflict');
    expect(stripped).not.toContain('[constraint] Fourth conflict');
    expect(stripped).toContain('Re-run with -v/--verbose to see all conflicts');
  });

  it('shows full conflict list when verbose', () => {
    const conflicts = createConflicts();
    const error: CliErrorEnvelope = {
      ...baseError,
      meta: { conflicts },
    };

    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });
    const output = formatErrorOutput(error, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Conflicts:');
    expect(stripped).toContain('[table] First conflict');
    expect(stripped).toContain('[column] Second conflict');
    expect(stripped).toContain('[index] Third conflict');
    expect(stripped).toContain('[constraint] Fourth conflict');
  });
});
