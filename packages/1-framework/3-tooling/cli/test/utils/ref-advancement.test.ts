import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { ContractIR } from '@prisma-next/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeRefAdvancementName, executeRefAdvancement } from '../../src/utils/ref-advancement';

const HASH_A = `${'a'.repeat(64)}`;
const PROFILE_HASH = `${'c'.repeat(64)}`;

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

function refPointerPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

function snapshotJsonPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.json`);
}

function snapshotDtsPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.d.ts`);
}

describe('computeRefAdvancementName', () => {
  it('returns the explicit name when advanceRef is set without db', () => {
    expect(computeRefAdvancementName({ advanceRef: 'staging' })).toBe('staging');
  });

  it('returns the explicit name when advanceRef is set with db', () => {
    expect(
      computeRefAdvancementName({ advanceRef: 'staging', db: 'postgres://localhost/db' }),
    ).toBe('staging');
  });

  it('returns db when advanceRef is omitted and db is omitted', () => {
    expect(computeRefAdvancementName({})).toBe('db');
  });

  it('returns null when advanceRef is omitted and db is provided', () => {
    expect(computeRefAdvancementName({ db: 'postgres://localhost/db' })).toBe(null);
  });

  it('returns db when advanceRef is explicitly db on the default database', () => {
    expect(computeRefAdvancementName({ advanceRef: 'db' })).toBe('db');
  });
});

describe('executeRefAdvancement', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(
      tmpdir(),
      `test-ref-advancement-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      'refs',
    );
  });

  afterEach(async () => {
    await rm(join(refsDir, '..'), { recursive: true, force: true });
  });

  it('writes pointer and paired snapshot files and returns the advanced ref', async () => {
    expect(existsSync(refsDir)).toBe(false);

    const result = await executeRefAdvancement(refsDir, 'db', HASH_A, sampleContractIR());

    expect(result).toEqual({ name: 'db', hash: HASH_A });
    expect(existsSync(refPointerPath(refsDir, 'db'))).toBe(true);
    expect(existsSync(snapshotJsonPath(refsDir, 'db'))).toBe(true);
    expect(existsSync(snapshotDtsPath(refsDir, 'db'))).toBe(true);
  });

  it('propagates writeRefPaired failures', async () => {
    await expect(
      executeRefAdvancement(refsDir, 'db', 'not-a-valid-hash', sampleContractIR()),
    ).rejects.toSatisfy((error) => {
      expect(MigrationToolsError.is(error)).toBe(true);
      expect((error as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_VALUE');
      return true;
    });
  });

  it('surfaces MIGRATION.INVALID_REF_NAME for an invalid ref name', async () => {
    await expect(executeRefAdvancement(refsDir, '', HASH_A, sampleContractIR())).rejects.toSatisfy(
      (error) => {
        expect(MigrationToolsError.is(error)).toBe(true);
        expect((error as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
        return true;
      },
    );
  });
});
