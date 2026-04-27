import type { ControlStack } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { MigrationMetadata } from '../src/metadata';
import { buildMigrationArtifacts, Migration } from '../src/migration-base';

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
 * Direct unit tests for `buildMigrationArtifacts` — the pure
 * `Migration` → in-memory artifact conversion. File I/O (reading
 * existing `migration.json`, writing the rendered artifacts to disk,
 * dry-run stdout output) lives in `@prisma-next/cli` and is exercised
 * there.
 */
describe('buildMigrationArtifacts', () => {
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

  it('produces ops.json + migration.json strings with synthesized metadata fields', () => {
    const { opsJson, metadata, metadataJson } = buildMigrationArtifacts(
      makeMigration([{ id: 'op1', label: 'Test op' }]),
      null,
    );

    expect(JSON.parse(opsJson)).toEqual([{ id: 'op1', label: 'Test op' }]);

    expect(metadata.from).toBe('abc');
    expect(metadata.to).toBe('def');
    expect(metadata.migrationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(metadata.kind).toBe('regular');
    expect(metadata.labels).toEqual([]);
    expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metadata.fromContract).toBeNull();
    expect(metadata.toContract).toEqual({ storage: { storageHash: 'def' } });
    expect(metadata.hints).toMatchObject({ used: [], applied: [] });

    expect(JSON.parse(metadataJson)).toEqual(metadata);
  });

  it('preserves contract bookends, hints, labels, and createdAt from existing metadata', () => {
    const existingMetadata: Partial<MigrationMetadata> = {
      from: 'sha256:from',
      to: 'sha256:to',
      kind: 'regular',
      fromContract: { storage: { storageHash: 'sha256:from' }, marker: 'preserved-from' } as never,
      toContract: { storage: { storageHash: 'sha256:to' }, marker: 'preserved-to' } as never,
      hints: {
        used: ['idx_a'],
        applied: ['additive_only'],
        plannerVersion: '2.0.0',
      } as never,
      labels: ['scaffolded'],
      createdAt: '2026-01-15T10:00:00.000Z',
    };

    const { metadata } = buildMigrationArtifacts(
      makeMigration([{ id: 'op1', label: 'Edited op', operationClass: 'additive' }], {
        from: 'sha256:from',
        to: 'sha256:to',
      }),
      existingMetadata,
    );

    expect(metadata.fromContract).toEqual(existingMetadata.fromContract);
    expect(metadata.toContract).toEqual(existingMetadata.toContract);
    expect(metadata.hints).toEqual(existingMetadata.hints);
    expect(metadata.labels).toEqual(existingMetadata.labels);
    expect(metadata.createdAt).toBe(existingMetadata.createdAt);
    expect(metadata.migrationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('drops legacy hint keys (e.g. planningStrategy) when re-emitting older metadata', () => {
    const existingMetadata: Partial<MigrationMetadata> = {
      from: 'sha256:from',
      to: 'sha256:to',
      kind: 'regular',
      fromContract: { storage: { storageHash: 'sha256:from' } } as never,
      toContract: { storage: { storageHash: 'sha256:to' } } as never,
      hints: {
        used: ['idx_a'],
        applied: ['additive_only'],
        plannerVersion: '2.0.0',
        planningStrategy: 'legacy-strategy',
      } as never,
      labels: [],
      createdAt: '2026-01-15T10:00:00.000Z',
    };

    const { metadata } = buildMigrationArtifacts(
      makeMigration([{ id: 'op1', label: 'Op', operationClass: 'additive' }], {
        from: 'sha256:from',
        to: 'sha256:to',
      }),
      existingMetadata,
    );

    expect(metadata.hints).toEqual({
      used: ['idx_a'],
      applied: ['additive_only'],
      plannerVersion: '2.0.0',
    });
    expect(metadata.hints).not.toHaveProperty('planningStrategy');
  });

  it('throws when operations is not an array', () => {
    expect(() => buildMigrationArtifacts(makeMigration('not an array'), null)).toThrow(
      /operations/,
    );
  });

  it('throws a clear error when describe() returns invalid metadata', () => {
    expect(() =>
      buildMigrationArtifacts(makeMigration([{ id: 'op1' }], { bad: true } as never), null),
    ).toThrow(/describe\(\).*invalid/);
  });
});
