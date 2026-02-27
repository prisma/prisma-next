import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import type { CliErrorConflict, CliErrorEnvelope } from '../src/utils/cli-errors';
import { parseGlobalFlags } from '../src/utils/global-flags';
import { formatErrorOutput } from '../src/utils/output';

const baseError: CliErrorEnvelope = {
  ok: false,
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

describe('formatErrorOutput - why/fix deduplication', () => {
  it('omits Fix line when fix is identical to why', () => {
    const error: CliErrorEnvelope = {
      ...baseError,
      why: 'Something went wrong',
      fix: 'Something went wrong',
    };

    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatErrorOutput(error, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Why: Something went wrong');
    expect(stripped).not.toContain('Fix:');
  });

  it('shows both Why and Fix when they differ', () => {
    const flags = parseGlobalFlags({ 'no-color': true });
    const output = formatErrorOutput(baseError, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Why: Conflicts detected');
    expect(stripped).toContain('Fix: Resolve conflicts');
  });
});

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
