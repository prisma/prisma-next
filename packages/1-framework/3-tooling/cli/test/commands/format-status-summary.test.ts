import { describe, expect, it } from 'vitest';
import {
  buildStatusHeadline,
  formatStatusSummary,
  type MigrationStatusResult,
} from '../../src/commands/migration-status';

const baseResult: MigrationStatusResult = {
  ok: true,
  spaces: [],
  summary: 'up to date',
  diagnostics: [],
  treeSections: [],
};

describe('buildStatusHeadline', () => {
  it('reports up to date when nothing is pending', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 0,
        targetHash: 'sha256:abc',
        markerDiverged: false,
        markerHash: 'sha256:abc',
      }),
    ).toBe('up to date');
  });

  it('names the migrate target when migrations are pending', () => {
    expect(
      buildStatusHeadline({
        pendingCount: 2,
        targetHash: 'sha256:deadbeef',
        markerDiverged: false,
        markerHash: 'sha256:marker',
      }),
    ).toBe('2 pending — run `prisma-next migrate --to deadbeef`');
  });
});

describe('formatStatusSummary', () => {
  it('includes the missing-invariants line when present', () => {
    const out = formatStatusSummary(
      {
        ...baseResult,
        missingInvariantsLine: 'missing invariant(s): users-have-email',
      },
      false,
    );
    expect(out).toContain('up to date');
    expect(out).toContain('missing invariant(s): users-have-email');
  });

  it('highlights divergence warnings', () => {
    const out = formatStatusSummary(
      {
        ...baseResult,
        summary: 'Database marker abcdef is not in the on-disk migration graph',
        diagnostics: [
          {
            code: 'MIGRATION.MARKER_NOT_IN_HISTORY',
            severity: 'warn',
            message: 'marker diverged',
            hints: [],
          },
        ],
      },
      false,
    );
    expect(out).toContain('Database marker abcdef');
  });
});
