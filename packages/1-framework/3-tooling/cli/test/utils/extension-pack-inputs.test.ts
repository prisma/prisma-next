import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationOps } from '@prisma-next/migration-tools/package';
import { describe, expect, it } from 'vitest';
import {
  type DescriptorMigrationPackage,
  type ExtensionPackInput,
  toDeclaredExtensions,
  toExtensionInputs,
  toExtensionMigrationsInputs,
  toMigratePassInputs,
} from '../../src/utils/extension-pack-inputs';

const contractJsonA = { kind: 'sql-contract', tables: { a: {} } } as const;
const contractJsonB = { kind: 'sql-contract', tables: { b: {} } } as const;

const packWithoutSpace = {
  id: 'ext-no-space',
  targetId: 'postgres',
} as const;

// The pack helpers under test do not introspect the package contents — they
// only pass references through. Use empty-cast stubs for the typed slots.
const STUB_METADATA = {} as MigrationMetadata;
const STUB_OPS = {} as MigrationOps;
const migrationPkg: DescriptorMigrationPackage = {
  dirName: '0000000001-init',
  metadata: STUB_METADATA,
  ops: STUB_OPS,
};

const packWithSpace = {
  id: 'ext-with-space',
  targetId: 'postgres',
  contractSpace: {
    contractJson: contractJsonA,
    headRef: { hash: 'sha256:c1', invariants: ['inv-1'] },
    migrations: [migrationPkg],
  },
} as const;

const packWithSpaceNoMigrationsField = {
  id: 'ext-no-migrations',
  targetId: 'postgres',
  contractSpace: {
    contractJson: contractJsonB,
    headRef: { hash: 'sha256:c2', invariants: [] },
  },
} as const;

describe('toExtensionInputs', () => {
  it('passes packs without contractSpace through with id + targetId only', () => {
    const out = toExtensionInputs([packWithoutSpace]);
    expect(out).toEqual([{ id: 'ext-no-space', targetId: 'postgres' }]);
  });

  it('projects contractSpace and preserves the migrations array', () => {
    const out = toExtensionInputs([packWithSpace]);
    expect(out).toEqual([
      {
        id: 'ext-with-space',
        targetId: 'postgres',
        contractSpace: {
          contractJson: contractJsonA,
          headRef: { hash: 'sha256:c1', invariants: ['inv-1'] },
          migrations: [migrationPkg],
        },
      },
    ]);
  });

  it('defaults missing migrations to []', () => {
    const out = toExtensionInputs([packWithSpaceNoMigrationsField]);
    expect(out[0]?.contractSpace?.migrations).toEqual([]);
  });

  it('preserves contractJson reference identity (loader maps keyed on this)', () => {
    const out = toExtensionInputs([packWithSpace]);
    expect(out[0]?.contractSpace?.contractJson).toBe(contractJsonA);
  });
});

describe('toDeclaredExtensions', () => {
  it('emits entries without contractSpace for non-contributing packs', () => {
    const inputs: ExtensionPackInput[] = [{ id: 'plain', targetId: 'postgres' }];
    const { entries, hashByContractJson } = toDeclaredExtensions(inputs);
    expect(entries).toEqual([{ id: 'plain', targetId: 'postgres' }]);
    expect(hashByContractJson.size).toBe(0);
  });

  it('emits entries with contractSpace and keys the hash map by contractJson identity', () => {
    const inputs: ExtensionPackInput[] = [
      {
        id: 'ext-with-space',
        targetId: 'postgres',
        contractSpace: {
          contractJson: contractJsonA,
          headRef: { hash: 'sha256:c1', invariants: [] },
          migrations: [],
        },
      },
    ];
    const { entries, hashByContractJson } = toDeclaredExtensions(inputs);
    expect(entries).toEqual([
      {
        id: 'ext-with-space',
        targetId: 'postgres',
        contractSpace: { contractJson: contractJsonA },
      },
    ]);
    expect(hashByContractJson.get(contractJsonA)).toBe('sha256:c1');
  });
});

describe('toMigratePassInputs', () => {
  it('passes packs without contractSpace as { id } only', () => {
    expect(toMigratePassInputs([{ id: 'plain', targetId: 'postgres' }])).toEqual([{ id: 'plain' }]);
  });

  it('projects contractJson + headRef for packs that declare a contractSpace', () => {
    const inputs: ExtensionPackInput[] = [
      {
        id: 'ext-with-space',
        targetId: 'postgres',
        contractSpace: {
          contractJson: contractJsonA,
          headRef: { hash: 'sha256:c1', invariants: ['inv-1'] },
          migrations: [],
        },
      },
    ];
    expect(toMigratePassInputs(inputs)).toEqual([
      {
        id: 'ext-with-space',
        contractSpace: {
          contractJson: contractJsonA,
          headRef: { hash: 'sha256:c1', invariants: ['inv-1'] },
        },
      },
    ]);
  });
});

describe('toExtensionMigrationsInputs', () => {
  it('passes packs without contractSpace as { id } only', () => {
    expect(toExtensionMigrationsInputs([{ id: 'plain', targetId: 'postgres' }])).toEqual([
      { id: 'plain' },
    ]);
  });

  it('projects contractJson + headRef + migrations for packs that declare a contractSpace', () => {
    const inputs: ExtensionPackInput[] = [
      {
        id: 'ext-with-space',
        targetId: 'postgres',
        contractSpace: {
          contractJson: contractJsonA,
          headRef: { hash: 'sha256:c1', invariants: [] },
          migrations: [migrationPkg],
        },
      },
    ];
    expect(toExtensionMigrationsInputs(inputs)).toEqual([
      {
        id: 'ext-with-space',
        contractSpace: {
          contractJson: contractJsonA,
          headRef: { hash: 'sha256:c1', invariants: [] },
          migrations: [migrationPkg],
        },
      },
    ]);
  });
});
