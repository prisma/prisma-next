import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { canonicalizeContract } from '@prisma-next/core-control-plane/emission';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attestMigration, computeEdgeId, verifyMigration } from '../src/attestation';
import { canonicalizeJson } from '../src/canonicalize-json';
import { writeMigrationPackage } from '../src/io';
import { createTestContract, createTestManifest, createTestOps } from './fixtures';

describe('computeEdgeId', () => {
  it('produces deterministic output', () => {
    const manifest = createTestManifest();
    const ops = createTestOps();
    const id1 = computeEdgeId(manifest, ops);
    const id2 = computeEdgeId(manifest, ops);
    expect(id1).toBe(id2);
  });

  it('returns sha256: prefixed string', () => {
    const id = computeEdgeId(createTestManifest(), createTestOps());
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('handles fromContract: null (empty project)', () => {
    const manifest = createTestManifest({ fromContract: null });
    const id = computeEdgeId(manifest, createTestOps());
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('ignores existing edgeId in manifest', () => {
    const manifest = createTestManifest();
    const withEdgeId = createTestManifest({ edgeId: 'sha256:fakehash' });
    const ops = createTestOps();
    expect(computeEdgeId(manifest, ops)).toBe(computeEdgeId(withEdgeId, ops));
  });

  it('ignores signature in manifest', () => {
    const manifest = createTestManifest();
    const withSig = createTestManifest({
      signature: { keyId: 'key1', value: 'sig_value' },
    });
    const ops = createTestOps();
    expect(computeEdgeId(manifest, ops)).toBe(computeEdgeId(withSig, ops));
  });

  it('changes when manifest field changes', () => {
    const ops = createTestOps();
    const id1 = computeEdgeId(createTestManifest({ labels: [] }), ops);
    const id2 = computeEdgeId(createTestManifest({ labels: ['custom'] }), ops);
    expect(id1).not.toBe(id2);
  });

  it('changes when ops change', () => {
    const manifest = createTestManifest();
    const id1 = computeEdgeId(manifest, createTestOps());
    const id2 = computeEdgeId(manifest, []);
    expect(id1).not.toBe(id2);
  });

  it('changes when toContract changes', () => {
    const ops = createTestOps();
    const m1 = createTestManifest({
      toContract: createTestContract({ target: 'postgres' }),
    });
    const m2 = createTestManifest({
      toContract: createTestContract({ target: 'mysql' }),
    });
    expect(computeEdgeId(m1, ops)).not.toBe(computeEdgeId(m2, ops));
  });

  it('changes when parentEdgeId changes', () => {
    const ops = createTestOps();
    const root = createTestManifest({ parentEdgeId: null });
    const child = createTestManifest({ parentEdgeId: 'sha256:parent' });
    expect(computeEdgeId(root, ops)).not.toBe(computeEdgeId(child, ops));
  });

  it('uses framed tuple hashing for edge input parts', () => {
    const manifest = createTestManifest();
    const ops = createTestOps();

    const {
      edgeId: _edgeId,
      signature: _signature,
      fromContract: _fromContract,
      toContract: _toContract,
      ...strippedMeta
    } = manifest;

    const canonicalParts = [
      canonicalizeJson(strippedMeta),
      canonicalizeJson(ops),
      manifest.fromContract !== null ? canonicalizeContract(manifest.fromContract) : 'null',
      canonicalizeContract(manifest.toContract),
    ];
    const partHashes = canonicalParts.map((part) =>
      createHash('sha256').update(part).digest('hex'),
    );
    const expected = `sha256:${createHash('sha256')
      .update(canonicalizeJson(partHashes))
      .digest('hex')}`;

    const legacy = `sha256:${createHash('sha256').update(canonicalParts.join(':')).digest('hex')}`;

    expect(computeEdgeId(manifest, ops)).toBe(expected);
    expect(computeEdgeId(manifest, ops)).not.toBe(legacy);
  });

  it('changes when canonical part boundaries change', () => {
    const manifest = createTestManifest({ labels: ['a:b'] });
    const baseOps = createTestOps();
    const boundaryShiftedOps = baseOps.map((op) => ({ ...op, label: `${op.label}:suffix` }));

    const baseEdgeId = computeEdgeId(manifest, baseOps);
    const boundaryShiftedEdgeId = computeEdgeId(manifest, boundaryShiftedOps);

    expect(baseEdgeId).not.toBe(boundaryShiftedEdgeId);
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

    const edgeId = await attestMigration(dir);
    expect(edgeId).toMatch(/^sha256:/);

    const result = await verifyMigration(dir);
    expect(result.ok).toBe(true);
  });

  it('verify returns draft status for unattested migration', async () => {
    const dir = join(tmpDir, '20260225T1430_draft');
    await writeMigrationPackage(dir, createTestManifest({ edgeId: null }), createTestOps());

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
    const edgeId = await attestMigration(dir);

    const manifestPath = join(dir, 'migration.json');
    const content = JSON.parse(await readFile(manifestPath, 'utf-8'));
    content.labels = ['tampered'];
    content.edgeId = edgeId;
    await writeFile(manifestPath, JSON.stringify(content, null, 2));

    const result = await verifyMigration(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
  });
});
