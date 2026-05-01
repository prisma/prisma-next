import { describe, expect, it } from 'vitest';
import {
  formatStatusSummary,
  type MigrationStatusResult,
} from '../../src/commands/migration-status';

const baseResult: Omit<MigrationStatusResult, 'diagnostics'> = {
  ok: true,
  mode: 'online',
  migrations: [],
  targetHash: 'sha256:t',
  contractHash: 'sha256:c',
  requiredInvariants: [],
  summary: 'Up to date',
};

function withDiagnostics(diagnostics: MigrationStatusResult['diagnostics']): MigrationStatusResult {
  return { ...baseResult, diagnostics };
}

describe('formatStatusSummary', () => {
  it('renders the success icon when online with zero pending and no warnings', () => {
    const out = formatStatusSummary(withDiagnostics([]), false);
    expect(out.startsWith('✔ ')).toBe(true);
  });

  it('renders the pending icon when MIGRATION.INVARIANTS_PENDING is present even at info severity', () => {
    const result = withDiagnostics([
      {
        code: 'MIGRATION.INVARIANTS_PENDING',
        severity: 'info',
        message: 'Missing required invariant(s): users-have-email',
        hints: [],
      },
    ]);
    const out = formatStatusSummary(result, false);
    expect(out.startsWith('⧗ ')).toBe(true);
    expect(out.startsWith('✔ ')).toBe(false);
  });

  it('renders the warning icon when a warn-severity diagnostic is present', () => {
    const result = withDiagnostics([
      {
        code: 'MIGRATION.SOMETHING_FISHY',
        severity: 'warn',
        message: 'something fishy',
        hints: [],
      },
    ]);
    const out = formatStatusSummary(result, false);
    expect(out.startsWith('⚠ ')).toBe(true);
  });

  it('omits the icon prefix in offline mode', () => {
    const result: MigrationStatusResult = { ...baseResult, mode: 'offline', diagnostics: [] };
    const out = formatStatusSummary(result, false);
    expect(out).toBe('Up to date');
  });
});
