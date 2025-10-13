import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyNext, applyAll, type ApplyOptions, type ApplyReport } from '../src/runner';
import { type MigrationProgram, type ContractMarker } from '../src/program';
import { type AdminConnection } from '../src/admin-connection';
import { type DialectLowerer } from '../src/lowering/postgres';
import { type ScriptAST } from '../src/script-ast';

// Mock the hashOpSet function
vi.mock('../src/program', async () => {
  const actual = await vi.importActual('../src/program');
  return {
    ...actual,
    hashOpSet: vi.fn().mockImplementation(async (ops: any) => {
      if (ops.version === 1 && ops.operations.length === 0) return 'sha256:hash1';
      if (ops.version === 1 && ops.operations.length === 1) return 'sha256:hash2';
      return 'sha256:unknown' as `sha256:${string}`;
    }),
  };
});

describe('Migration Runner', () => {
  let mockAdmin: AdminConnection;
  let mockLowerer: DialectLowerer;
  let programs: MigrationProgram[];

  beforeEach(() => {
    // Mock AdminConnection
    mockAdmin = {
      target: 'postgres',
      withAdvisoryLock: vi.fn().mockImplementation(async (key, fn) => {
        return await fn();
      }),
      executeScript: vi.fn().mockResolvedValue({
        sql: 'CREATE TABLE users (id SERIAL PRIMARY KEY);',
        params: [],
        sqlHash: 'sha256:sqlhash123' as `sha256:${string}`,
      }),
      readContract: vi.fn(),
      writeContract: vi.fn(),
      close: vi.fn(),
    };

    // Mock DialectLowerer
    mockLowerer = {
      target: 'postgres',
      lower: vi.fn().mockReturnValue({
        type: 'script',
        statements: [],
      } as ScriptAST),
    };

    // Sample programs
    programs = [
      {
        dir: '/migrations/001',
        meta: {
          id: '001',
          target: 'postgres',
          from: { kind: 'empty' },
          to: { kind: 'contract', hash: 'sha256:first' },
          opSetHash: 'sha256:hash1',
        },
        ops: { version: 1, operations: [] },
      },
      {
        dir: '/migrations/002',
        meta: {
          id: '002',
          target: 'postgres',
          from: { kind: 'contract', hash: 'sha256:first' },
          to: { kind: 'contract', hash: 'sha256:second' },
          opSetHash: 'sha256:hash2',
        },
        ops: { version: 1, operations: [] },
      },
    ];
  });

  describe('applyNext', () => {
    it('applies first program to empty database', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: null });

      const result = await applyNext(programs, mockAdmin, mockLowerer);

      expect(result.applied).toBe(true);
      expect(result.programId).toBe('001');
      expect(result.from.kind).toBe('empty');
      expect(result.to.hash).toBe('sha256:first');
      expect(mockAdmin.writeContract).toHaveBeenCalledWith('sha256:first');
    });

    it('applies second program after first', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: 'sha256:first' });

      const result = await applyNext(programs, mockAdmin, mockLowerer);

      expect(result.applied).toBe(true);
      expect(result.programId).toBe('002');
      expect(result.from.hash).toBe('sha256:first');
      expect(result.to.hash).toBe('sha256:second');
      expect(mockAdmin.writeContract).toHaveBeenCalledWith('sha256:second');
    });

    it('returns not-applicable when no programs match', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: 'sha256:second' });

      const result = await applyNext(programs, mockAdmin, mockLowerer);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('not-applicable');
      expect(mockAdmin.writeContract).not.toHaveBeenCalled();
    });

    it('returns strict-mismatch in strict mode', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: 'sha256:wrong' });

      const strictProgram: MigrationProgram = {
        dir: '/migrations/strict',
        meta: {
          id: 'strict',
          target: 'postgres',
          from: { kind: 'contract', hash: 'sha256:expected' },
          to: { kind: 'contract', hash: 'sha256:target' },
          opSetHash: 'sha256:hash',
          mode: 'strict',
        },
        ops: { version: 1, operations: [] },
      };

      const result = await applyNext([strictProgram], mockAdmin, mockLowerer);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('strict-mismatch');
      expect(mockAdmin.writeContract).not.toHaveBeenCalled();
    });

    it('allows mismatch in tolerant mode', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: 'sha256:wrong' });

      const tolerantProgram: MigrationProgram = {
        dir: '/migrations/tolerant',
        meta: {
          id: 'tolerant',
          target: 'postgres',
          from: { kind: 'contract', hash: 'sha256:expected' },
          to: { kind: 'contract', hash: 'sha256:target' },
          opSetHash: 'sha256:hash',
          mode: 'tolerant',
        },
        ops: { version: 1, operations: [] },
      };

      const result = await applyNext([tolerantProgram], mockAdmin, mockLowerer);

      expect(result.applied).toBe(true);
      expect(result.programId).toBe('tolerant');
      expect(mockAdmin.writeContract).toHaveBeenCalledWith('sha256:target');
    });

    it('throws error for opSetHash mismatch', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: null });

      const invalidProgram: MigrationProgram = {
        dir: '/migrations/invalid',
        meta: {
          id: 'invalid',
          target: 'postgres',
          from: { kind: 'empty' },
          to: { kind: 'contract', hash: 'sha256:target' },
          opSetHash: 'sha256:wronghash', // Wrong hash
        },
        ops: { version: 1, operations: [] },
      };

      await expect(applyNext([invalidProgram], mockAdmin, mockLowerer)).rejects.toThrow(
        'OpSet hash mismatch',
      );
    });

    it('skips database write in dryRun mode', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: null });

      const result = await applyNext(programs, mockAdmin, mockLowerer, { dryRun: true });

      expect(result.applied).toBe(true);
      expect(result.sql).toBe('CREATE TABLE users (id SERIAL PRIMARY KEY);');
      expect(mockAdmin.writeContract).not.toHaveBeenCalled();
    });

    it('uses advisory lock during execution', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: null });

      await applyNext(programs, mockAdmin, mockLowerer);

      expect(mockAdmin.withAdvisoryLock).toHaveBeenCalledWith(
        'prisma:migrate',
        expect.any(Function),
      );
    });
  });

  describe('applyAll', () => {
    it('applies all applicable programs in sequence', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: null });

      const reports = await applyAll(programs, mockAdmin, mockLowerer);

      expect(reports).toHaveLength(3); // 2 applied + 1 not-applicable
      expect(reports[0].applied).toBe(true);
      expect(reports[0].programId).toBe('001');
      expect(reports[1].applied).toBe(true);
      expect(reports[1].programId).toBe('002');
      expect(reports[2].applied).toBe(false);
      expect(reports[2].reason).toBe('not-applicable');
    });

    it('throws error on strict mismatch', async () => {
      mockAdmin.readContract = vi.fn().mockResolvedValue({ hash: 'sha256:wrong' });

      const strictProgram: MigrationProgram = {
        dir: '/migrations/strict',
        meta: {
          id: 'strict',
          target: 'postgres',
          from: { kind: 'contract', hash: 'sha256:expected' },
          to: { kind: 'contract', hash: 'sha256:target' },
          opSetHash: 'sha256:hash',
          mode: 'strict',
        },
        ops: { version: 1, operations: [] },
      };

      await expect(applyAll([strictProgram], mockAdmin, mockLowerer)).rejects.toThrow(
        'Strict mismatch for program strict - aborting',
      );
    });
  });
});
