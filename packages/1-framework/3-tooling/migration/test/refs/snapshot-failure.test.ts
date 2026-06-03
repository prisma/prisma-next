import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractIR } from '../../src/refs/snapshot';

const fsMocks = vi.hoisted(() => ({
  renameFailOnCall: null as number | null,
  renameCount: 0,
  unlinkFailOnCall: null as number | null,
  unlinkCount: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (src: string, dest: string) => {
      fsMocks.renameCount += 1;
      if (fsMocks.renameFailOnCall === fsMocks.renameCount) {
        throw new Error(`simulated rename failure on call ${fsMocks.renameCount}`);
      }
      return actual.rename(src, dest);
    },
    unlink: async (path: string) => {
      fsMocks.unlinkCount += 1;
      if (fsMocks.unlinkFailOnCall === fsMocks.unlinkCount) {
        throw new Error(`simulated unlink failure on call ${fsMocks.unlinkCount}`);
      }
      return actual.unlink(path);
    },
  };
});

afterAll(() => {
  vi.doUnmock('node:fs/promises');
});

import { rm, unlink } from 'node:fs/promises';
import { MigrationToolsError } from '../../src/errors';
import { writeRef } from '../../src/refs';
import { deleteRefPaired, writeRefPaired, writeRefSnapshot } from '../../src/refs/snapshot';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const PROFILE_HASH = `sha256:${'c'.repeat(64)}`;

const ENTRY_A = { hash: HASH_A, invariants: [] as string[] };

function sampleContractIR(): ContractIR {
  return {
    contract: {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: PROFILE_HASH,
      storage: { storageHash: HASH_A },
      models: {
        User: {
          fields: {
            id: {
              nullable: false,
              type: { kind: 'scalar', codecId: 'sql/int4@1' },
            },
          },
          relations: {},
          storage: { namespaceId: '__unbound__', table: 'users', namespace: 'public' },
        },
      },
      roots: {},
    },
    contractDts: '// generated\nexport type Contract = unknown;\n',
  };
}

function snapshotJsonPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.json`);
}

function snapshotDtsPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.d.ts`);
}

function refPointerPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

describe('writeRefSnapshot partial-write cleanup', () => {
  let refsDir: string;

  beforeEach(async () => {
    fsMocks.renameCount = 0;
    fsMocks.renameFailOnCall = null;
    fsMocks.unlinkCount = 0;
    fsMocks.unlinkFailOnCall = null;
    refsDir = join(
      tmpdir(),
      `test-ref-snapshot-failure-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('cleans up json when dts rename fails', async () => {
    fsMocks.renameFailOnCall = 2;
    const input = sampleContractIR();

    await expect(writeRefSnapshot(refsDir, 'staging', input)).rejects.toThrow(
      'simulated rename failure on call 2',
    );

    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });

  it('cleans up dts when json rename fails', async () => {
    fsMocks.renameFailOnCall = 1;
    const input = sampleContractIR();

    await expect(writeRefSnapshot(refsDir, 'staging', input)).rejects.toThrow(
      'simulated rename failure on call 1',
    );

    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });
});

describe('writeRefPaired cross-boundary failure handling', () => {
  let refsDir: string;

  beforeEach(async () => {
    fsMocks.renameCount = 0;
    fsMocks.renameFailOnCall = null;
    fsMocks.unlinkCount = 0;
    fsMocks.unlinkFailOnCall = null;
    refsDir = join(
      tmpdir(),
      `test-ref-paired-failure-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('leaves no pointer when writeRefSnapshot fails before writeRef', async () => {
    fsMocks.renameFailOnCall = 1;
    const input = sampleContractIR();

    await expect(writeRefPaired(refsDir, 'staging', ENTRY_A, input)).rejects.toThrow(
      'simulated rename failure on call 1',
    );

    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });

  it('rolls back snapshot when writeRef fails after writeRefSnapshot succeeded', async () => {
    fsMocks.renameFailOnCall = 3;
    const input = sampleContractIR();

    await expect(writeRefPaired(refsDir, 'staging', ENTRY_A, input)).rejects.toThrow(
      'simulated rename failure on call 3',
    );

    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });

  it('preserves writeRef failure when rollback unlink also fails', async () => {
    fsMocks.renameFailOnCall = 3;
    fsMocks.unlinkFailOnCall = 1;
    const input = sampleContractIR();

    await expect(writeRefPaired(refsDir, 'staging', ENTRY_A, input)).rejects.toThrow(
      'simulated rename failure on call 3',
    );
  });
});

describe('deleteRefPaired cross-boundary recovery', () => {
  let refsDir: string;

  beforeEach(async () => {
    fsMocks.renameCount = 0;
    fsMocks.renameFailOnCall = null;
    fsMocks.unlinkCount = 0;
    fsMocks.unlinkFailOnCall = null;
    refsDir = join(
      tmpdir(),
      `test-ref-paired-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await rm(refsDir, { recursive: true, force: true });
  });

  it('recovers partial state when pointer exists without a paired snapshot', async () => {
    await writeRef(refsDir, 'staging', ENTRY_A);

    await expect(deleteRefPaired(refsDir, 'staging')).resolves.toBeUndefined();

    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });

  it('removes orphan snapshot when pointer is missing', async () => {
    await writeRefSnapshot(refsDir, 'staging', sampleContractIR());

    await expect(deleteRefPaired(refsDir, 'staging')).resolves.toBeUndefined();

    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });

  it('removes dts-only orphan when pointer and json are missing', async () => {
    await writeRefSnapshot(refsDir, 'staging', sampleContractIR());
    await unlink(snapshotJsonPath(refsDir, 'staging'));

    await expect(deleteRefPaired(refsDir, 'staging')).resolves.toBeUndefined();

    expect(existsSync(refPointerPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });

  it('throws MIGRATION.UNKNOWN_REF when both pointer and snapshot are missing', async () => {
    await expect(deleteRefPaired(refsDir, 'missing')).rejects.toSatisfy((error) => {
      expect(MigrationToolsError.is(error)).toBe(true);
      expect((error as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
      return true;
    });
  });
});
