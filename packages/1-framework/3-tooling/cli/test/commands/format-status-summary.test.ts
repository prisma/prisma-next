import { describe, expect, it } from 'vitest';
import {
  buildNoPathSummary,
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

describe('buildNoPathSummary', () => {
  it('names the live contract when no --to was passed', () => {
    expect(
      buildNoPathSummary({
        markerHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        targetHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        explicitTarget: false,
        refName: undefined,
      }),
    ).toBe(
      "No migration path from the database state (sha256:aaaaaaaaaaaa) to the application's contract (sha256:bbbbbbbbbbbb). Run `prisma-next migration plan --name <name>` to author one.",
    );
  });

  it('names the ref when --to resolved via ref', () => {
    expect(
      buildNoPathSummary({
        markerHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        targetHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        explicitTarget: true,
        refName: 'prod',
      }),
    ).toBe(
      'No migration path from the database state (sha256:aaaaaaaaaaaa) to the target (sha256:bbbbbbbbbbbb via `prod`). Run `prisma-next migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('omits via ref when --to was a raw hash', () => {
    expect(
      buildNoPathSummary({
        markerHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        targetHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        explicitTarget: true,
        refName: undefined,
      }),
    ).toBe(
      'No migration path from the database state (sha256:aaaaaaaaaaaa) to the target (sha256:bbbbbbbbbbbb). Run `prisma-next migration plan --name <name>` to author one, or pass `--to <contract>` to pick a reachable target.',
    );
  });

  it('omits marker parenthetical when marker hash is unknown', () => {
    expect(
      buildNoPathSummary({
        markerHash: undefined,
        targetHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        explicitTarget: false,
        refName: undefined,
      }),
    ).toBe(
      "No migration path from the database state to the application's contract (sha256:bbbbbbbbbbbb). Run `prisma-next migration plan --name <name>` to author one.",
    );
  });
});

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
