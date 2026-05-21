import { describe, expect, it } from 'vitest';
import { CliStructuredError } from '../src/control';
import {
  errorDestructiveChanges,
  errorHashMismatch,
  errorMarkerMissing,
  errorMarkerReadFailed,
  errorMarkerRequired,
  errorMarkerRowCorrupt,
  errorRunnerFailed,
  errorRuntime,
  errorTargetMismatch,
  parseMarkerRowSafely,
  rethrowMarkerReadError,
  withMarkerReadErrorHandling,
} from '../src/execution';

describe('Runtime Errors', () => {
  it('errorMarkerMissing creates correct error', () => {
    const error = errorMarkerMissing();
    expect(error.code).toBe('3001');
    expect(error.message).toBe('Database not signed');
    expect(error.domain).toBe('RUN');
  });

  it('errorMarkerMissing with custom why', () => {
    const error = errorMarkerMissing({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorHashMismatch creates correct error', () => {
    const error = errorHashMismatch();
    expect(error.code).toBe('3002');
    expect(error.message).toBe('Hash mismatch');
    expect(error.domain).toBe('RUN');
  });

  it('errorHashMismatch with expected and actual', () => {
    const error = errorHashMismatch({ expected: 'hash1', actual: 'hash2' });
    expect(error.meta?.['expected']).toBe('hash1');
    expect(error.meta?.['actual']).toBe('hash2');
  });

  it('errorHashMismatch with expected only', () => {
    const error = errorHashMismatch({ expected: 'hash1' });
    expect(error.meta?.['expected']).toBe('hash1');
    expect(error.meta?.['actual']).toBeUndefined();
  });

  it('errorHashMismatch with actual only', () => {
    const error = errorHashMismatch({ actual: 'hash2' });
    expect(error.meta?.['expected']).toBeUndefined();
    expect(error.meta?.['actual']).toBe('hash2');
  });

  it('errorHashMismatch with custom why', () => {
    const error = errorHashMismatch({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorTargetMismatch creates correct error', () => {
    const error = errorTargetMismatch('postgres', 'mysql');
    expect(error.code).toBe('3003');
    expect(error.message).toBe('Target mismatch');
    expect(error.domain).toBe('RUN');
    expect(error.why).toContain('postgres');
    expect(error.why).toContain('mysql');
    expect(error.meta?.['expected']).toBe('postgres');
    expect(error.meta?.['actual']).toBe('mysql');
  });

  it('errorTargetMismatch with custom why', () => {
    const error = errorTargetMismatch('postgres', 'mysql', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorMarkerRequired creates correct error', () => {
    const error = errorMarkerRequired();
    expect(error.code).toBe('3010');
    expect(error.message).toBe('Database must be signed first');
    expect(error.domain).toBe('RUN');
  });

  it('errorMarkerRequired with custom why and fix', () => {
    const error = errorMarkerRequired({ why: 'Custom reason', fix: 'Custom fix' });
    expect(error.why).toBe('Custom reason');
    expect(error.fix).toBe('Custom fix');
  });

  it('errorRunnerFailed creates correct error', () => {
    const error = errorRunnerFailed('Runner failed');
    expect(error.code).toBe('3020');
    expect(error.message).toBe('Runner failed');
    expect(error.domain).toBe('RUN');
  });

  it('errorRunnerFailed with all options', () => {
    const error = errorRunnerFailed('Runner failed', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorDestructiveChanges creates correct error', () => {
    const error = errorDestructiveChanges('Destructive changes detected');
    expect(error.code).toBe('3030');
    expect(error.message).toBe('Destructive changes detected');
    expect(error.domain).toBe('RUN');
  });

  it('errorDestructiveChanges with all options', () => {
    const error = errorDestructiveChanges('Destructive changes detected', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorRuntime creates correct error', () => {
    const error = errorRuntime('Something failed');
    expect(error.code).toBe('3000');
    expect(error.message).toBe('Something failed');
    expect(error.domain).toBe('RUN');
  });

  it('errorRuntime with all options', () => {
    const error = errorRuntime('Something failed', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorMarkerRowCorrupt creates PN-RUN-3005 envelope', () => {
    const error = errorMarkerRowCorrupt({
      why: 'Invalid contract marker row: invariants must be string[]',
      space: 'app',
      markerLocation: 'prisma_contract.marker',
    });
    expect(error.toEnvelope().code).toBe('PN-RUN-3005');
    expect(error.message).toBe('Marker row is corrupt or incompatible');
    expect(error.fix).toContain('space "app"');
    expect(error.fix).toContain('prisma-next db init');
  });

  it('errorMarkerReadFailed creates PN-RUN-3006 envelope', () => {
    const error = errorMarkerReadFailed({
      why: 'permission denied for table marker',
      markerLocation: 'prisma_contract.marker',
    });
    expect(error.toEnvelope().code).toBe('PN-RUN-3006');
    expect(error.message).toBe('Database error while reading contract marker');
    expect(error.fix).toContain('SELECT permission');
  });

  it('rethrowMarkerReadError maps parse failures to PN-RUN-3005', () => {
    expect(() =>
      rethrowMarkerReadError(new Error('Invalid contract marker row: core_hash must be string'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(CliStructuredError);

    try {
      rethrowMarkerReadError(new Error('Invalid contract marker row: core_hash must be string'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      });
    } catch (err) {
      expect(CliStructuredError.is(err)).toBe(true);
      expect((err as CliStructuredError).toEnvelope().code).toBe('PN-RUN-3005');
    }
  });

  it('rethrowMarkerReadError maps driver failures to PN-RUN-3006', () => {
    try {
      rethrowMarkerReadError(new Error('permission denied for table marker'), {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      });
    } catch (err) {
      expect((err as CliStructuredError).toEnvelope().code).toBe('PN-RUN-3006');
    }
  });

  it('rethrowMarkerReadError rethrows existing CliStructuredError', () => {
    const existing = errorMarkerMissing();
    expect(() =>
      rethrowMarkerReadError(existing, {
        space: 'app',
        markerLocation: 'prisma_contract.marker',
      }),
    ).toThrow(existing);
  });

  it('withMarkerReadErrorHandling wraps async query failures', async () => {
    await expect(
      withMarkerReadErrorHandling(
        async () => {
          throw new Error('connection reset');
        },
        { space: 'app', markerLocation: 'prisma_contract.marker' },
      ),
    ).rejects.toMatchObject({ code: '3006' });
  });

  it('parseMarkerRowSafely wraps parse failures', () => {
    expect(() =>
      parseMarkerRowSafely(
        {},
        () => {
          throw new Error('Invalid contract marker row: invariants must be string[]');
        },
        { space: 'ext', markerLocation: '_prisma_marker' },
      ),
    ).toThrow(CliStructuredError);
  });
});
