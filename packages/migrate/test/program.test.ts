import { describe, it, expect } from 'vitest';
import {
  loadProgram,
  hashOpSet,
  matchesFrom,
  nextApplicable,
  type ContractRef,
  type Meta,
  type OpSetWithVersion,
  type MigrationProgram,
  type ContractMarker,
} from '../src/program';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Migration Program', () => {
  describe('hashOpSet', () => {
    it('computes deterministic hash for identical OpSets', async () => {
      const opset: OpSetWithVersion = {
        version: 1,
        operations: [
          {
            kind: 'addTable',
            name: 'users',
            columns: [
              { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
              { name: 'email', type: 'text', nullable: false },
            ],
          },
        ],
      };

      const hash1 = await hashOpSet(opset);
      const hash2 = await hashOpSet(opset);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('computes different hashes for different OpSets', async () => {
      const opset1: OpSetWithVersion = {
        version: 1,
        operations: [
          {
            kind: 'addTable',
            name: 'users',
            columns: [
              { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
            ],
          },
        ],
      };

      const opset2: OpSetWithVersion = {
        version: 1,
        operations: [
          {
            kind: 'addTable',
            name: 'posts',
            columns: [
              { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
              { name: 'title', type: 'text', nullable: false },
            ],
          },
        ],
      };

      const hash1 = await hashOpSet(opset1);
      const hash2 = await hashOpSet(opset2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('matchesFrom', () => {
    const emptyMarker: ContractMarker = { hash: null };
    const contractMarker: ContractMarker = { hash: 'sha256:abc123def456' };

    it('matches empty contract ref with null hash', () => {
      const meta: Meta = {
        id: 'test',
        target: 'postgres',
        from: { kind: 'empty' },
        to: { kind: 'contract', hash: 'sha256:def456abc789' },
        opSetHash: 'sha256:hash123',
      };

      expect(matchesFrom(meta, emptyMarker)).toBe(true);
      expect(matchesFrom(meta, contractMarker)).toBe(false);
    });

    it('matches contract ref with exact hash', () => {
      const meta: Meta = {
        id: 'test',
        target: 'postgres',
        from: { kind: 'contract', hash: 'sha256:abc123def456' },
        to: { kind: 'contract', hash: 'sha256:def456abc789' },
        opSetHash: 'sha256:hash123',
      };

      expect(matchesFrom(meta, contractMarker)).toBe(true);
      expect(matchesFrom(meta, emptyMarker)).toBe(false);
    });

    it('matches unknown ref with any hash', () => {
      const meta: Meta = {
        id: 'test',
        target: 'postgres',
        from: { kind: 'unknown' },
        to: { kind: 'contract', hash: 'sha256:def456abc789' },
        opSetHash: 'sha256:hash123',
      };

      expect(matchesFrom(meta, emptyMarker)).toBe(true);
      expect(matchesFrom(meta, contractMarker)).toBe(true);
    });

    it('matches anyOf ref with hash in set', () => {
      const meta: Meta = {
        id: 'test',
        target: 'postgres',
        from: { kind: 'anyOf', hashes: ['sha256:abc123def456', 'sha256:other123'] },
        to: { kind: 'contract', hash: 'sha256:def456abc789' },
        opSetHash: 'sha256:hash123',
      };

      expect(matchesFrom(meta, contractMarker)).toBe(true);
      expect(matchesFrom(meta, emptyMarker)).toBe(false);
    });
  });

  describe('nextApplicable', () => {
    const programs: MigrationProgram[] = [
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

    it('returns first program for empty database', () => {
      const current: ContractMarker = { hash: null };
      const result = nextApplicable(programs, current);

      expect(result).toBe(programs[0]);
    });

    it('returns second program for first contract', () => {
      const current: ContractMarker = { hash: 'sha256:first' };
      const result = nextApplicable(programs, current);

      expect(result).toBe(programs[1]);
    });

    it('returns null for no applicable programs', () => {
      const current: ContractMarker = { hash: 'sha256:second' };
      const result = nextApplicable(programs, current);

      expect(result).toBeNull();
    });
  });

  describe('loadProgram', () => {
    it('loads and validates valid migration program', async () => {
      const tempDir = join(tmpdir(), 'test-migration');
      await fs.mkdir(tempDir, { recursive: true });

      const meta = {
        id: 'test-migration',
        target: 'postgres' as const,
        from: { kind: 'empty' as const },
        to: { kind: 'contract' as const, hash: 'sha256:target123' },
        opSetHash: 'sha256:6c44498de8a9c94cc1f5d72cee7e45a8cc526759c1263567942dcb9638a32740',
      };

      const opset = {
        version: 1,
        operations: [
          {
            kind: 'addTable',
            name: 'users',
            columns: [
              { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
            ],
          },
        ],
      };

      await fs.writeFile(join(tempDir, 'meta.json'), JSON.stringify(meta));
      await fs.writeFile(join(tempDir, 'opset.json'), JSON.stringify(opset));

      const program = await loadProgram(tempDir);

      expect(program.dir).toBe(tempDir);
      expect(program.meta.id).toBe('test-migration');
      expect(program.ops.version).toBe(1);
      expect(program.ops.operations).toHaveLength(1);

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('throws error for invalid meta.json', async () => {
      const tempDir = join(tmpdir(), 'test-migration-invalid');
      await fs.mkdir(tempDir, { recursive: true });

      const invalidMeta = {
        id: 'test',
        // missing required fields
        target: 'postgres',
      };

      await fs.writeFile(join(tempDir, 'meta.json'), JSON.stringify(invalidMeta));
      await fs.writeFile(
        join(tempDir, 'opset.json'),
        JSON.stringify({ version: 1, operations: [] }),
      );

      await expect(loadProgram(tempDir)).rejects.toThrow('meta.opSetHash must be a string');

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('throws error for opSetHash mismatch', async () => {
      const tempDir = join(tmpdir(), 'test-migration-hash-mismatch');
      await fs.mkdir(tempDir, { recursive: true });

      const meta = {
        id: 'test',
        target: 'postgres' as const,
        from: { kind: 'empty' as const },
        to: { kind: 'contract' as const, hash: 'sha256:target123' },
        opSetHash: 'sha256:wronghash', // Wrong hash
      };

      const opset = {
        version: 1,
        operations: [],
      };

      await fs.writeFile(join(tempDir, 'meta.json'), JSON.stringify(meta));
      await fs.writeFile(join(tempDir, 'opset.json'), JSON.stringify(opset));

      await expect(loadProgram(tempDir)).rejects.toThrow('OpSet hash mismatch');

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    });
  });
});
