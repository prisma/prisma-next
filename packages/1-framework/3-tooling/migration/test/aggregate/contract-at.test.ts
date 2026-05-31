import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@prisma-next/contract/types';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContractSpaceMember } from '../../src/aggregate/aggregate';
import { writeRefSnapshot } from '../../src/refs/snapshot';
import { createAttestedPackage, createTestContract, writeTestPackage } from '../fixtures';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function sampleContractDts(label: string): string {
  return `// generated ${label}\nexport type Contract = unknown;\n`;
}

function sampleContractJson(storageHash: string): unknown {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: `sha256:${'p'.repeat(64)}`,
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
              storage: { table: 'users', namespace: 'public' },
            },
          },
        },
      },
    },
    roots: {},
  };
}

async function writeEndContract(
  packageDir: string,
  storageHash: string,
  dtsLabel: string,
): Promise<void> {
  await writeFile(
    join(packageDir, 'end-contract.json'),
    `${JSON.stringify(sampleContractJson(storageHash), null, 2)}\n`,
  );
  await writeFile(join(packageDir, 'end-contract.d.ts'), sampleContractDts(dtsLabel));
}

describe('ContractSpaceMember.contractAt', () => {
  let workDir: string;
  let refsDir: string;
  let packageDir: string;

  const identityDeserialize = (json: unknown): Contract => json as Contract;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'contract-at-'));
    refsDir = join(workDir, 'refs');
    await mkdir(refsDir, { recursive: true });
    packageDir = join(workDir, '20260101T0000_init');
    await writeTestPackage(packageDir, { from: null, to: HASH_B });
    await writeEndContract(packageDir, HASH_B, 'bundle');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function memberWithPackages(
    packages: ReturnType<typeof createAttestedPackage>[],
    deserialize: (raw: unknown) => Contract = identityDeserialize,
  ) {
    return createContractSpaceMember({
      spaceId: 'app',
      packages: packages.map((pkg) => ({ ...pkg, dirPath: packageDir })),
      refs: {},
      headRef: { hash: HASH_B, invariants: [] },
      refsDir,
      resolveContract: () => createTestContract(),
      deserializeContract: deserialize,
    });
  }

  it('prefers a ref paired snapshot when refName is supplied', async () => {
    await writeRefSnapshot(refsDir, 'staging', {
      contract: sampleContractJson(HASH_A),
      contractDts: sampleContractDts('snapshot'),
    });

    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_A }),
    ]);

    const result = await member.contractAt(HASH_A, { refName: 'staging' });

    expect(result.hash).toBe(HASH_A);
    expect(result.provenance).toBe('snapshot');
    expect(result.contractDts).toBe(sampleContractDts('snapshot'));
    expect((result.contractJson as { storage: { storageHash: string } }).storage.storageHash).toBe(
      HASH_A,
    );
  });

  it('reads end-contract from the matching graph-node package without refName', async () => {
    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const result = await member.contractAt(HASH_B);

    expect(result.hash).toBe(HASH_B);
    expect(result.provenance).toBe('graph-node');
    if (result.provenance !== 'graph-node') throw new Error('expected graph-node provenance');
    expect(result.sourceDir).toBe(packageDir);
    expect(result.contractDts).toBe(sampleContractDts('bundle'));
    expect((result.contractJson as { storage: { storageHash: string } }).storage.storageHash).toBe(
      HASH_B,
    );
  });

  it('falls back to the graph-node bundle when the ref snapshot is absent', async () => {
    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const result = await member.contractAt(HASH_B, { refName: 'staging' });

    expect(result.provenance).toBe('graph-node');
    if (result.provenance !== 'graph-node') throw new Error('expected graph-node provenance');
    expect(result.sourceDir).toBe(packageDir);
    expect(result.contractDts).toBe(sampleContractDts('bundle'));
  });

  it('throws when the hash is a graph node but no bundle ends at that hash', async () => {
    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_second', { from: HASH_A, to: HASH_B }),
    ]);

    await expect(member.contractAt(HASH_A)).rejects.toMatchObject({
      code: 'MIGRATION.BUNDLE_NOT_FOUND_FOR_GRAPH_NODE',
    });
  });

  it('throws when the matching bundle is missing end-contract.json', async () => {
    await rm(join(packageDir, 'end-contract.json'));

    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(member.contractAt(HASH_B)).rejects.toMatchObject({
      code: 'MIGRATION.FILE_MISSING',
      details: { file: 'end-contract.json', dir: packageDir },
    });
  });

  it('throws when end-contract.json is invalid JSON', async () => {
    await writeFile(join(packageDir, 'end-contract.json'), '{not json');

    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(member.contractAt(HASH_B)).rejects.toMatchObject({
      code: 'MIGRATION.INVALID_JSON',
    });
  });

  it('throws when deserializeContract rejects the parsed end-contract', async () => {
    const member = memberWithPackages(
      [createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B })],
      () => {
        throw new Error('bad contract shape');
      },
    );

    await expect(member.contractAt(HASH_B)).rejects.toMatchObject({
      code: 'MIGRATION.CONTRACT_DESERIALIZATION_FAILED',
    });
  });

  it('throws snapshot missing when refName is set and hash is not a graph node', async () => {
    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(member.contractAt(HASH_A, { refName: 'staging' })).rejects.toMatchObject({
      code: 'MIGRATION.SNAPSHOT_MISSING',
      details: { refName: 'staging' },
    });
  });

  it('throws hash not in graph when refName is omitted and hash is not a graph node', async () => {
    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    await expect(member.contractAt(HASH_A)).rejects.toMatchObject({
      code: 'MIGRATION.HASH_NOT_IN_GRAPH',
      details: { hash: HASH_A },
    });
  });

  it('memoises successful resolutions per hash and refName', async () => {
    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const first = await member.contractAt(HASH_B);
    const second = await member.contractAt(HASH_B);
    expect(second).toBe(first);
  });

  it('memoises snapshot and bundle resolutions under separate keys', async () => {
    await writeRefSnapshot(refsDir, 'staging', {
      contract: sampleContractJson(HASH_B),
      contractDts: sampleContractDts('snapshot'),
    });

    const member = memberWithPackages([
      createAttestedPackage('20260101T0000_init', { from: null, to: HASH_B }),
    ]);

    const fromSnapshot = await member.contractAt(HASH_B, { refName: 'staging' });
    const fromBundle = await member.contractAt(HASH_B);

    expect(fromSnapshot.contractDts).toBe(sampleContractDts('snapshot'));
    expect(fromBundle.contractDts).toBe(sampleContractDts('bundle'));
  });
});
