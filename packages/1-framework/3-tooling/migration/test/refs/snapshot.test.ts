import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { canonicalizeJson } from '@prisma-next/framework-components/utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationToolsError } from '../../src/errors';
import { writeRef } from '../../src/refs';
import type { ContractIR } from '../../src/refs/snapshot';
import { deleteRefSnapshot, readRefSnapshot, writeRefSnapshot } from '../../src/refs/snapshot';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const PROFILE_HASH = `${'c'.repeat(64)}`;

function sampleContractDts(label: string): string {
  return `// generated ${label}\nexport type Contract = unknown;\n`;
}

function sampleContractIR(variant: 'a' | 'b' = 'a'): ContractIR {
  const storageHash = variant === 'a' ? HASH_A : HASH_B;
  return {
    contract: {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: PROFILE_HASH,
      storage: { storageHash },
      domain: {
        namespaces: {
          __unbound__: {
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
          },
        },
      },
      roots: {},
    },
    contractDts: sampleContractDts(variant),
  };
}

function snapshotJsonPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.json`);
}

function snapshotDtsPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.contract.d.ts`);
}

function expectInvalidRefFile(error: unknown, filePath: string) {
  expect(MigrationToolsError.is(error)).toBe(true);
  const migrationError = error as MigrationToolsError;
  expect(migrationError.code).toBe('MIGRATION.INVALID_REF_FILE');
  expect(migrationError.details).toEqual(expect.objectContaining({ path: filePath }));
}

describe('writeRefSnapshot + readRefSnapshot', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(
      tmpdir(),
      `test-ref-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await fs.rm(refsDir, { recursive: true, force: true });
  });

  it('round-trips contract json and dts', async () => {
    const input = sampleContractIR();
    await writeRefSnapshot(refsDir, 'staging', input);

    const read = await readRefSnapshot(refsDir, 'staging');
    expect(read).toEqual(input);
  });

  it('writes canonical json bytes', async () => {
    const input = sampleContractIR();
    await writeRefSnapshot(refsDir, 'staging', input);

    const raw = await fs.readFile(snapshotJsonPath(refsDir, 'staging'), 'utf-8');
    expect(raw).toBe(`${canonicalizeJson(input.contract)}\n`);
  });

  it('idempotently rewrites identical content with byte equality', async () => {
    const input = sampleContractIR();
    await writeRefSnapshot(refsDir, 'staging', input);
    const firstJson = await fs.readFile(snapshotJsonPath(refsDir, 'staging'));
    const firstDts = await fs.readFile(snapshotDtsPath(refsDir, 'staging'));

    await writeRefSnapshot(refsDir, 'staging', input);

    const secondJson = await fs.readFile(snapshotJsonPath(refsDir, 'staging'));
    const secondDts = await fs.readFile(snapshotDtsPath(refsDir, 'staging'));
    expect(secondJson.equals(firstJson)).toBe(true);
    expect(secondDts.equals(firstDts)).toBe(true);
  });

  it('overwrites with different contract content', async () => {
    await writeRefSnapshot(refsDir, 'staging', sampleContractIR());
    const updated = sampleContractIR('b');
    await writeRefSnapshot(refsDir, 'staging', updated);

    const read = await readRefSnapshot(refsDir, 'staging');
    expect(read).toEqual(updated);
  });

  it('creates parent directories for slashed ref names', async () => {
    const input = sampleContractIR();
    await writeRefSnapshot(refsDir, 'refs/staging/v1', input);

    expect(existsSync(snapshotJsonPath(refsDir, 'refs/staging/v1'))).toBe(true);
    expect(existsSync(snapshotDtsPath(refsDir, 'refs/staging/v1'))).toBe(true);
    expect(await readRefSnapshot(refsDir, 'refs/staging/v1')).toEqual(input);
  });
});

describe('readRefSnapshot', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(
      tmpdir(),
      `test-ref-snapshot-read-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await fs.rm(refsDir, { recursive: true, force: true });
  });

  it('returns null when no snapshot exists', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_A, invariants: [] });

    await expect(readRefSnapshot(refsDir, 'staging')).resolves.toBeNull();
  });

  it('throws on malformed contract json', async () => {
    const jsonPath = snapshotJsonPath(refsDir, 'staging');
    await fs.mkdir(refsDir, { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify({ not: 'a contract' }));
    await fs.writeFile(snapshotDtsPath(refsDir, 'staging'), sampleContractDts('malformed'));

    await expect(readRefSnapshot(refsDir, 'staging')).rejects.toSatisfy((error) => {
      expectInvalidRefFile(error, jsonPath);
      return true;
    });
  });

  it('throws when contract json exists but contract dts is missing', async () => {
    const jsonPath = snapshotJsonPath(refsDir, 'staging');
    const dtsPath = snapshotDtsPath(refsDir, 'staging');
    await fs.mkdir(refsDir, { recursive: true });
    await fs.writeFile(jsonPath, `${canonicalizeJson(sampleContractIR().contract)}\n`);

    await expect(readRefSnapshot(refsDir, 'staging')).rejects.toSatisfy((error) => {
      expectInvalidRefFile(error, dtsPath);
      return true;
    });
  });
});

describe('deleteRefSnapshot', () => {
  let refsDir: string;

  beforeEach(async () => {
    refsDir = join(
      tmpdir(),
      `test-ref-snapshot-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await fs.rm(refsDir, { recursive: true, force: true });
  });

  it('deletes both snapshot files', async () => {
    await writeRefSnapshot(refsDir, 'staging', sampleContractIR());
    await deleteRefSnapshot(refsDir, 'staging');

    expect(existsSync(snapshotJsonPath(refsDir, 'staging'))).toBe(false);
    expect(existsSync(snapshotDtsPath(refsDir, 'staging'))).toBe(false);
  });

  it('is idempotent when no snapshot exists', async () => {
    await expect(deleteRefSnapshot(refsDir, 'missing')).resolves.toBeUndefined();
  });

  it('is idempotent when only pointer ref exists', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_A, invariants: [] });
    await expect(deleteRefSnapshot(refsDir, 'staging')).resolves.toBeUndefined();
  });
});
