import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ControlStack } from '@prisma-next/framework-components/control';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Migration, serializeMigration } from '../src/migration-base';

describe('Migration', () => {
  describe('operations + describe() contract', () => {
    it('subclasses expose operations via the getter and describe() metadata', () => {
      class TestMigration extends Migration<{
        id: string;
        label: string;
        operationClass: 'additive';
      }> {
        readonly targetId = 'test';
        override get operations() {
          return [
            { id: 'op1', label: 'Op 1', operationClass: 'additive' as const },
            { id: 'op2', label: 'Op 2', operationClass: 'additive' as const },
          ];
        }
        override describe() {
          return { from: 'abc', to: 'def', labels: ['test'] };
        }
      }

      const m = new TestMigration();
      expect(m.operations).toEqual([
        { id: 'op1', label: 'Op 1', operationClass: 'additive' },
        { id: 'op2', label: 'Op 2', operationClass: 'additive' },
      ]);
      expect(m.describe()).toEqual({ from: 'abc', to: 'def', labels: ['test'] });
    });

    it('derives origin/destination from describe()', () => {
      class TestMigration extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'hashFrom', to: 'hashTo' };
        }
      }

      const m = new TestMigration();
      expect(m.origin).toEqual({ storageHash: 'hashFrom' });
      expect(m.destination).toEqual({ storageHash: 'hashTo' });
    });

    it('returns a null origin when from is empty (origin-less plan)', () => {
      class InitialMigration extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: '', to: 'sha256:to' };
        }
      }

      expect(new InitialMigration().origin).toBeNull();
    });
  });

  describe('constructor accepts and stores a ControlStack', () => {
    /**
     * The constructor injection contract is that a subclass (e.g.
     * `PostgresMigration`) can read `this.stack` to materialize whatever it
     * needs (typically a control adapter). The base class itself stores the
     * argument verbatim; this test exercises that storage directly via a
     * subclass that exposes the protected field, independent of any concrete
     * target's stack-consumption logic.
     */
    it('stores the injected stack on the protected `stack` field', () => {
      const stub = { sentinel: true } as unknown as ControlStack<'sql', 'test'>;

      class StackProbe extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'a', to: 'b' };
        }
        public readStack(): unknown {
          return this.stack;
        }
      }

      expect(new StackProbe(stub).readStack()).toBe(stub);
    });

    it('leaves `stack` undefined when constructed without an argument', () => {
      class StackProbe extends Migration {
        readonly targetId = 'test';
        override get operations() {
          return [];
        }
        override describe() {
          return { from: 'a', to: 'b' };
        }
        public readStack(): unknown {
          return this.stack;
        }
      }

      expect(new StackProbe().readStack()).toBeUndefined();
    });
  });
});

/**
 * Direct unit tests for `serializeMigration` — the file-I/O step that was
 * previously only exercised through the now-removed `Migration.run` static
 * via subprocess. Running it in-process keeps the behavior coverage
 * (manifest synthesis, manifest preservation, hint normalization,
 * dry-run output, error surfaces) while dropping the subprocess + tsx
 * round-trip overhead.
 */
describe('serializeMigration', () => {
  let tmpDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'serialize-migration-'));
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeMigration(
    operations: unknown,
    meta: { readonly from: string; readonly to: string; readonly labels?: readonly string[] } = {
      from: 'abc',
      to: 'def',
    },
  ): Migration {
    class M extends Migration {
      readonly targetId = 'test';
      override get operations() {
        return operations as never;
      }
      override describe() {
        return meta;
      }
    }
    return new M();
  }

  it('writes ops.json and migration.json with synthesized manifest fields', async () => {
    serializeMigration(makeMigration([{ id: 'op1', label: 'Test op' }]), tmpDir, false);

    const ops = JSON.parse(await readFile(join(tmpDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([{ id: 'op1', label: 'Test op' }]);

    const manifest = JSON.parse(await readFile(join(tmpDir, 'migration.json'), 'utf-8'));
    expect(manifest.from).toBe('abc');
    expect(manifest.to).toBe('def');
    expect(manifest.migrationId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(manifest.kind).toBe('regular');
    expect(manifest.labels).toEqual([]);
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.fromContract).toBeNull();
    expect(manifest.toContract).toEqual({ storage: { storageHash: 'def' } });
    expect(manifest.hints).toMatchObject({ used: [], applied: [] });
  });

  it('preserves contract bookends, hints, labels, and createdAt from an existing manifest', async () => {
    const existingManifest = {
      from: 'sha256:from',
      to: 'sha256:to',
      migrationId: null,
      kind: 'regular',
      fromContract: { storage: { storageHash: 'sha256:from' }, marker: 'preserved-from' },
      toContract: { storage: { storageHash: 'sha256:to' }, marker: 'preserved-to' },
      hints: {
        used: ['idx_a'],
        applied: ['additive_only'],
        plannerVersion: '2.0.0',
      },
      labels: ['scaffolded'],
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    await writeFile(join(tmpDir, 'migration.json'), JSON.stringify(existingManifest, null, 2));

    serializeMigration(
      makeMigration([{ id: 'op1', label: 'Edited op', operationClass: 'additive' }], {
        from: 'sha256:from',
        to: 'sha256:to',
      }),
      tmpDir,
      false,
    );

    const manifest = JSON.parse(await readFile(join(tmpDir, 'migration.json'), 'utf-8'));
    expect(manifest.fromContract).toEqual(existingManifest.fromContract);
    expect(manifest.toContract).toEqual(existingManifest.toContract);
    expect(manifest.hints).toEqual(existingManifest.hints);
    expect(manifest.labels).toEqual(existingManifest.labels);
    expect(manifest.createdAt).toBe(existingManifest.createdAt);
    expect(manifest.migrationId).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('drops legacy hint keys (e.g. planningStrategy) when re-emitting an older manifest', async () => {
    const existingManifest = {
      from: 'sha256:from',
      to: 'sha256:to',
      migrationId: null,
      kind: 'regular',
      fromContract: { storage: { storageHash: 'sha256:from' } },
      toContract: { storage: { storageHash: 'sha256:to' } },
      hints: {
        used: ['idx_a'],
        applied: ['additive_only'],
        plannerVersion: '2.0.0',
        planningStrategy: 'legacy-strategy',
      },
      labels: [],
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    await writeFile(join(tmpDir, 'migration.json'), JSON.stringify(existingManifest, null, 2));

    serializeMigration(
      makeMigration([{ id: 'op1', label: 'Op', operationClass: 'additive' }], {
        from: 'sha256:from',
        to: 'sha256:to',
      }),
      tmpDir,
      false,
    );

    const manifest = JSON.parse(await readFile(join(tmpDir, 'migration.json'), 'utf-8'));
    expect(manifest.hints).toEqual({
      used: ['idx_a'],
      applied: ['additive_only'],
      plannerVersion: '2.0.0',
    });
    expect(manifest.hints).not.toHaveProperty('planningStrategy');
  });

  it('prints both ops.json and migration.json sections in dry-run mode without writing files', async () => {
    serializeMigration(
      makeMigration([{ id: 'op1', label: 'Dry run op' }], {
        from: 'abc',
        to: 'def',
        labels: ['test'],
      }),
      tmpDir,
      true,
    );

    const stdoutText = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stdoutText).toContain('--- migration.json ---');
    expect(stdoutText).toContain('--- ops.json ---');
    expect(stdoutText).toContain('"op1"');
    expect(stdoutText).toContain('"from"');
    expect(stdoutText).toContain('"to"');

    const opsExists = await readFile(join(tmpDir, 'ops.json'), 'utf-8').catch(() => null);
    const manifestExists = await readFile(join(tmpDir, 'migration.json'), 'utf-8').catch(
      () => null,
    );
    expect(opsExists).toBeNull();
    expect(manifestExists).toBeNull();
  });

  it('throws when operations is not an array', () => {
    expect(() => serializeMigration(makeMigration('not an array'), tmpDir, false)).toThrow(
      /operations/,
    );
  });

  it('throws a clear error when describe() returns invalid metadata', () => {
    expect(() =>
      serializeMigration(makeMigration([{ id: 'op1' }], { bad: true } as never), tmpDir, false),
    ).toThrow(/describe\(\).*invalid/);
  });
});
