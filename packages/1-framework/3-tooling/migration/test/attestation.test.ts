import { createHash } from 'node:crypto';
import type { Contract } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { computeMigrationId, verifyMigrationBundle } from '../src/attestation';
import { canonicalizeJson } from '../src/canonicalize-json';
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
      },
    });
    const m2 = createTestManifest({
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '9.9.9',
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

describe('verifyMigrationBundle', () => {
  it('reports mismatch for an in-memory tampered bundle', () => {
    // The on-disk variants of this case are covered by io.test.ts (the
    // loader throws MIGRATION.BUNDLE_CORRUPT). This case keeps the
    // in-memory primitive under test so callers that hold a hand-built
    // bundle (e.g. the planner before write) still have coverage.
    const ops = createTestOps();
    const baseManifest = {
      from: 'sha256:empty',
      to: 'sha256:abc123',
      kind: 'regular' as const,
      fromContract: null,
      toContract: createTestContract(),
      hints: { used: [], applied: [], plannerVersion: '0.0.1' },
      labels: [],
      createdAt: '2026-02-25T14:30:00.000Z',
    };
    const storedMigrationId = computeMigrationId(baseManifest, ops);
    const tamperedOps = [
      ...ops,
      { id: 'extra', label: 'Extra', operationClass: 'additive' as const },
    ];

    const result = verifyMigrationBundle({
      dirName: '20260225T1430_tampered',
      dirPath: '/tmp/tampered',
      manifest: { ...baseManifest, migrationId: storedMigrationId },
      ops: tamperedOps,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
    expect(result.storedMigrationId).toBe(storedMigrationId);
    expect(result.computedMigrationId).not.toBe(storedMigrationId);
  });
});
