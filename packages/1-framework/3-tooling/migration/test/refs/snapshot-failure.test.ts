import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractIR } from '../../src/refs/snapshot';

const fsMocks = vi.hoisted(() => ({
  renameFailOnCall: null as number | null,
  renameCount: 0,
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
  };
});

import { rm } from 'node:fs/promises';
import { writeRefSnapshot } from '../../src/refs/snapshot';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const PROFILE_HASH = `sha256:${'c'.repeat(64)}`;

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
          storage: { table: 'users', namespace: 'public' },
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

describe('writeRefSnapshot partial-write cleanup', () => {
  let refsDir: string;

  beforeEach(async () => {
    fsMocks.renameCount = 0;
    fsMocks.renameFailOnCall = null;
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
