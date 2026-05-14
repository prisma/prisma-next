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

  describe('default-view per-space filter', () => {
    const appHash = `sha256:${'a'.repeat(64)}`;
    const extHash = `sha256:${'b'.repeat(64)}`;

    it('renders one line per extension space with pendingCount > 0', () => {
      const result: MigrationStatusResult = {
        ...baseResult,
        diagnostics: [],
        spaces: [
          {
            spaceId: 'audit',
            kind: 'extension',
            headHash: extHash,
            markerHash: appHash,
            pendingCount: 2,
            status: 'pending',
          },
          {
            spaceId: 'app',
            kind: 'app',
            headHash: appHash,
            markerHash: appHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
        ],
        totalPendingAcrossSpaces: 2,
      };
      const out = formatStatusSummary(result, false);
      expect(out).toMatch(/\[ext\]\s+audit/);
      expect(out).toMatch(/2 pending/);
    });

    it('hides extension spaces with pendingCount === 0 from the default view', () => {
      const result: MigrationStatusResult = {
        ...baseResult,
        diagnostics: [],
        spaces: [
          {
            spaceId: 'audit',
            kind: 'extension',
            headHash: extHash,
            markerHash: extHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
          {
            spaceId: 'feature-flags',
            kind: 'extension',
            headHash: extHash,
            markerHash: extHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
          {
            spaceId: 'app',
            kind: 'app',
            headHash: appHash,
            markerHash: appHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
        ],
        totalPendingAcrossSpaces: 0,
      };
      const out = formatStatusSummary(result, false);
      expect(out).not.toContain('[ext]');
      expect(out).not.toContain('audit');
      expect(out).not.toContain('feature-flags');
      expect(out).not.toContain('spaces');
    });

    it('output is byte-identical to a no-spaces app when every extension is up to date', () => {
      const noSpaces: MigrationStatusResult = { ...baseResult, diagnostics: [] };
      const allUpToDate: MigrationStatusResult = {
        ...baseResult,
        diagnostics: [],
        spaces: [
          {
            spaceId: 'audit',
            kind: 'extension',
            headHash: extHash,
            markerHash: extHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
          {
            spaceId: 'app',
            kind: 'app',
            headHash: appHash,
            markerHash: appHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
        ],
        totalPendingAcrossSpaces: 0,
      };
      expect(formatStatusSummary(allUpToDate, false)).toBe(formatStatusSummary(noSpaces, false));
    });

    it('does not render the cross-space pending total line in the default view', () => {
      const result: MigrationStatusResult = {
        ...baseResult,
        diagnostics: [],
        spaces: [
          {
            spaceId: 'audit',
            kind: 'extension',
            headHash: extHash,
            markerHash: appHash,
            pendingCount: 2,
            status: 'pending',
          },
          {
            spaceId: 'app',
            kind: 'app',
            headHash: appHash,
            markerHash: appHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
        ],
        totalPendingAcrossSpaces: 2,
      };
      const out = formatStatusSummary(result, false);
      expect(out).not.toMatch(/across .* space/);
    });

    it('hides app space in the default per-space block (app coverage lives in the main summary above)', () => {
      const result: MigrationStatusResult = {
        ...baseResult,
        diagnostics: [],
        spaces: [
          {
            spaceId: 'audit',
            kind: 'extension',
            headHash: extHash,
            markerHash: appHash,
            pendingCount: 2,
            status: 'pending',
          },
          {
            spaceId: 'app',
            kind: 'app',
            headHash: appHash,
            markerHash: appHash,
            pendingCount: 0,
            status: 'up-to-date',
          },
        ],
        totalPendingAcrossSpaces: 2,
      };
      const out = formatStatusSummary(result, false);
      expect(out).not.toContain('[app]');
    });
  });
});
