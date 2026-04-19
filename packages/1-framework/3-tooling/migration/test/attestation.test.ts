import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@prisma-next/contract/types';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attestMigration, computeMigrationId, verifyMigration } from '../src/attestation';
import { canonicalizeJson } from '../src/canonicalize-json';
import { writeMigrationPackage } from '../src/io';
import { createTestContract, createTestManifest, createTestOps } from './fixtures';

describe('computeMigrationId', () => {
  it('produces deterministic output', () => {
    const manifest = createTestManifest();
    const ops = createTestOps();
    const id1 = computeMigrationId(manifest, ops);
    const id2 = computeMigrationId(manifest, ops);
    expect(id1).toBe(id2);
  });

  it('returns sha256: prefixed string', () => {
    const id = computeMigrationId(createTestManifest(), createTestOps());
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('handles fromContract: null (empty project)', () => {
    const manifest = createTestManifest({ fromContract: null });
    const id = computeMigrationId(manifest, createTestOps());
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('ignores existing migrationId in manifest', () => {
    const manifest = createTestManifest();
    const withMigrationId = createTestManifest({ migrationId: 'sha256:fakehash' });
    const ops = createTestOps();
    expect(computeMigrationId(manifest, ops)).toBe(computeMigrationId(withMigrationId, ops));
  });

  it('ignores signature in manifest', () => {
    const manifest = createTestManifest();
    const withSig = createTestManifest({
      signature: { keyId: 'key1', value: 'sig_value' },
    });
    const ops = createTestOps();
    expect(computeMigrationId(manifest, ops)).toBe(computeMigrationId(withSig, ops));
  });

  it('changes when manifest field changes', () => {
    const ops = createTestOps();
    const id1 = computeMigrationId(createTestManifest({ labels: [] }), ops);
    const id2 = computeMigrationId(createTestManifest({ labels: ['custom'] }), ops);
    expect(id1).not.toBe(id2);
  });

  it('changes when ops change', () => {
    const manifest = createTestManifest();
    const id1 = computeMigrationId(manifest, createTestOps());
    const id2 = computeMigrationId(manifest, []);
    expect(id1).not.toBe(id2);
  });

  it('is unchanged when toContract is mutated (non-storage fields)', () => {
    const ops = createTestOps();
    const m1 = createTestManifest({
      toContract: createTestContract({ target: 'postgres' }),
    });
    const m2 = createTestManifest({
      toContract: createTestContract({ target: 'mysql' }),
    });
    expect(computeMigrationId(m1, ops)).toBe(computeMigrationId(m2, ops));
  });

  it('is unchanged when fromContract is mutated', () => {
    const ops = createTestOps();
    const m1 = createTestManifest({
      fromContract: createTestContract({ target: 'postgres' }),
    });
    const m2 = createTestManifest({
      fromContract: createTestContract({ target: 'mysql' }),
    });
    expect(computeMigrationId(m1, ops)).toBe(computeMigrationId(m2, ops));
  });

  it('is unchanged when toContract.meta (a non-storage field) changes', () => {
    const ops = createTestOps();
    const baseContract = createTestContract();
    const mutatedContract = { ...baseContract, meta: { foo: 'bar' } } as Contract;
    const m1 = createTestManifest({ toContract: baseContract });
    const m2 = createTestManifest({ toContract: mutatedContract });
    expect(computeMigrationId(m1, ops)).toBe(computeMigrationId(m2, ops));
  });

  it('is unchanged when manifest.hints.plannerVersion is mutated', () => {
    const ops = createTestOps();
    const m1 = createTestManifest({
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '0.0.1',
        planningStrategy: 'additive',
      },
    });
    const m2 = createTestManifest({
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '9.9.9',
        planningStrategy: 'additive',
      },
    });
    expect(computeMigrationId(m1, ops)).toBe(computeMigrationId(m2, ops));
  });

  it('is unchanged when manifest.hints.planningStrategy is mutated', () => {
    const ops = createTestOps();
    const m1 = createTestManifest({
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '0.0.1',
        planningStrategy: 'additive',
      },
    });
    const m2 = createTestManifest({
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '0.0.1',
        planningStrategy: 'diff',
      },
    });
    expect(computeMigrationId(m1, ops)).toBe(computeMigrationId(m2, ops));
  });

  it('changes when manifest.from changes', () => {
    const ops = createTestOps();
    const m1 = createTestManifest({ from: 'sha256:empty' });
    const m2 = createTestManifest({ from: 'sha256:different' });
    expect(computeMigrationId(m1, ops)).not.toBe(computeMigrationId(m2, ops));
  });

  it('changes when manifest.to changes', () => {
    const ops = createTestOps();
    const m1 = createTestManifest({ to: 'sha256:abc123' });
    const m2 = createTestManifest({ to: 'sha256:different' });
    expect(computeMigrationId(m1, ops)).not.toBe(computeMigrationId(m2, ops));
  });

  it('uses framed tuple hashing for edge input parts', () => {
    const manifest = createTestManifest();
    const ops = createTestOps();

    const {
      migrationId: _migrationId,
      signature: _signature,
      fromContract: _fromContract,
      toContract: _toContract,
      hints: _hints,
      ...strippedMeta
    } = manifest;

    const canonicalParts = [canonicalizeJson(strippedMeta), canonicalizeJson(ops)];
    const partHashes = canonicalParts.map((part) =>
      createHash('sha256').update(part).digest('hex'),
    );
    const expected = `sha256:${createHash('sha256')
      .update(canonicalizeJson(partHashes))
      .digest('hex')}`;

    const legacy = `sha256:${createHash('sha256').update(canonicalParts.join(':')).digest('hex')}`;

    expect(computeMigrationId(manifest, ops)).toBe(expected);
    expect(computeMigrationId(manifest, ops)).not.toBe(legacy);
  });

  it('changes when canonical part boundaries change', () => {
    const manifest = createTestManifest({ labels: ['a:b'] });
    const baseOps = createTestOps();
    const boundaryShiftedOps = baseOps.map((op) => ({ ...op, label: `${op.label}:suffix` }));

    const baseMigrationId = computeMigrationId(manifest, baseOps);
    const boundaryShiftedMigrationId = computeMigrationId(manifest, boundaryShiftedOps);

    expect(baseMigrationId).not.toBe(boundaryShiftedMigrationId);
  });
});

describe('attestMigration + verifyMigration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-attest-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('attests a draft and subsequent verify passes', async () => {
    const dir = join(tmpDir, '20260225T1430_test');
    await writeMigrationPackage(dir, createTestManifest(), createTestOps());

    const migrationId = await attestMigration(dir);
    expect(migrationId).toMatch(/^sha256:/);

    const result = await verifyMigration(dir);
    expect(result.ok).toBe(true);
  });

  it('verify returns draft status for unattested migration', async () => {
    const dir = join(tmpDir, '20260225T1430_draft');
    await writeMigrationPackage(dir, createTestManifest({ migrationId: null }), createTestOps());

    const result = await verifyMigration(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('draft');
  });

  it('verify detects tampered ops', async () => {
    const dir = join(tmpDir, '20260225T1430_tampered');
    const manifest = createTestManifest();
    const ops = createTestOps();
    await writeMigrationPackage(dir, manifest, ops);
    await attestMigration(dir);

    await writeFile(join(dir, 'ops.json'), JSON.stringify([], null, 2));

    const result = await verifyMigration(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
  });

  it('verify detects tampered manifest field', async () => {
    const dir = join(tmpDir, '20260225T1430_tampered_manifest');
    await writeMigrationPackage(dir, createTestManifest(), createTestOps());
    const migrationId = await attestMigration(dir);

    const manifestPath = join(dir, 'migration.json');
    const content = JSON.parse(await readFile(manifestPath, 'utf-8'));
    content.labels = ['tampered'];
    content.migrationId = migrationId;
    await writeFile(manifestPath, JSON.stringify(content, null, 2));

    const result = await verifyMigration(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
  });
});
