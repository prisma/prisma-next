import { createHash } from 'node:crypto';
import type { Contract } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../src/canonicalize-json';
import { computeMigrationHash, verifyMigrationHash } from '../src/hash';
import { createTestContract, createTestMetadata, createTestOps } from './fixtures';

describe('computeMigrationHash', () => {
  it('produces deterministic output', () => {
    const metadata = createTestMetadata();
    const ops = createTestOps();
    const id1 = computeMigrationHash(metadata, ops);
    const id2 = computeMigrationHash(metadata, ops);
    expect(id1).toBe(id2);
  });

  it('returns sha256: prefixed string', () => {
    const id = computeMigrationHash(createTestMetadata(), createTestOps());
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('handles fromContract: null (empty project)', () => {
    const metadata = createTestMetadata({ fromContract: null });
    const id = computeMigrationHash(metadata, createTestOps());
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('ignores existing migrationHash on metadata', () => {
    const metadata = createTestMetadata();
    const withMigrationHash = createTestMetadata({ migrationHash: 'sha256:fakehash' });
    const ops = createTestOps();
    expect(computeMigrationHash(metadata, ops)).toBe(computeMigrationHash(withMigrationHash, ops));
  });

  it('ignores signature on metadata', () => {
    const metadata = createTestMetadata();
    const withSig = createTestMetadata({
      signature: { keyId: 'key1', value: 'sig_value' },
    });
    const ops = createTestOps();
    expect(computeMigrationHash(metadata, ops)).toBe(computeMigrationHash(withSig, ops));
  });

  it('changes when a metadata field changes', () => {
    const ops = createTestOps();
    const id1 = computeMigrationHash(createTestMetadata({ labels: [] }), ops);
    const id2 = computeMigrationHash(createTestMetadata({ labels: ['custom'] }), ops);
    expect(id1).not.toBe(id2);
  });

  it('changes when ops change', () => {
    const metadata = createTestMetadata();
    const id1 = computeMigrationHash(metadata, createTestOps());
    const id2 = computeMigrationHash(metadata, []);
    expect(id1).not.toBe(id2);
  });

  it('is unchanged when toContract is mutated (non-storage fields)', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({
      toContract: createTestContract({ target: 'postgres' }),
    });
    const m2 = createTestMetadata({
      toContract: createTestContract({ target: 'mysql' }),
    });
    expect(computeMigrationHash(m1, ops)).toBe(computeMigrationHash(m2, ops));
  });

  it('is unchanged when fromContract is mutated', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({
      fromContract: createTestContract({ target: 'postgres' }),
    });
    const m2 = createTestMetadata({
      fromContract: createTestContract({ target: 'mysql' }),
    });
    expect(computeMigrationHash(m1, ops)).toBe(computeMigrationHash(m2, ops));
  });

  it('is unchanged when toContract.meta (a non-storage field) changes', () => {
    const ops = createTestOps();
    const baseContract = createTestContract();
    const mutatedContract = { ...baseContract, meta: { foo: 'bar' } } as Contract;
    const m1 = createTestMetadata({ toContract: baseContract });
    const m2 = createTestMetadata({ toContract: mutatedContract });
    expect(computeMigrationHash(m1, ops)).toBe(computeMigrationHash(m2, ops));
  });

  it('is unchanged when metadata.hints.plannerVersion is mutated', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '0.0.1',
      },
    });
    const m2 = createTestMetadata({
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '9.9.9',
      },
    });
    expect(computeMigrationHash(m1, ops)).toBe(computeMigrationHash(m2, ops));
  });

  it('changes when metadata.from changes', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({ from: 'sha256:empty' });
    const m2 = createTestMetadata({ from: 'sha256:different' });
    expect(computeMigrationHash(m1, ops)).not.toBe(computeMigrationHash(m2, ops));
  });

  it('changes when metadata.to changes', () => {
    const ops = createTestOps();
    const m1 = createTestMetadata({ to: 'sha256:abc123' });
    const m2 = createTestMetadata({ to: 'sha256:different' });
    expect(computeMigrationHash(m1, ops)).not.toBe(computeMigrationHash(m2, ops));
  });

  it('uses framed tuple hashing for edge input parts', () => {
    const metadata = createTestMetadata();
    const ops = createTestOps();

    const {
      migrationHash: _migrationHash,
      signature: _signature,
      fromContract: _fromContract,
      toContract: _toContract,
      hints: _hints,
      ...strippedMeta
    } = metadata;

    const canonicalParts = [canonicalizeJson(strippedMeta), canonicalizeJson(ops)];
    const partHashes = canonicalParts.map((part) =>
      createHash('sha256').update(part).digest('hex'),
    );
    const expected = `sha256:${createHash('sha256')
      .update(canonicalizeJson(partHashes))
      .digest('hex')}`;

    const legacy = `sha256:${createHash('sha256').update(canonicalParts.join(':')).digest('hex')}`;

    expect(computeMigrationHash(metadata, ops)).toBe(expected);
    expect(computeMigrationHash(metadata, ops)).not.toBe(legacy);
  });

  it('changes when canonical part boundaries change', () => {
    const metadata = createTestMetadata({ labels: ['a:b'] });
    const baseOps = createTestOps();
    const boundaryShiftedOps = baseOps.map((op) => ({ ...op, label: `${op.label}:suffix` }));

    const baseHash = computeMigrationHash(metadata, baseOps);
    const boundaryShiftedHash = computeMigrationHash(metadata, boundaryShiftedOps);

    expect(baseHash).not.toBe(boundaryShiftedHash);
  });
});

describe('verifyMigrationHash', () => {
  it('reports mismatch for an in-memory tampered package', () => {
    // The on-disk variants of this case are covered by io.test.ts (the
    // loader throws MIGRATION.HASH_MISMATCH). This case keeps the
    // in-memory primitive under test so callers that hold a hand-built
    // package (e.g. the planner before write) still have coverage.
    const ops = createTestOps();
    const baseMetadata = {
      from: 'sha256:empty',
      to: 'sha256:abc123',
      kind: 'regular' as const,
      fromContract: null,
      toContract: createTestContract(),
      hints: { used: [], applied: [], plannerVersion: '0.0.1' },
      labels: [],
      createdAt: '2026-02-25T14:30:00.000Z',
    };
    const storedHash = computeMigrationHash(baseMetadata, ops);
    const tamperedOps = [
      ...ops,
      { id: 'extra', label: 'Extra', operationClass: 'additive' as const },
    ];

    const result = verifyMigrationHash({
      dirName: '20260225T1430_tampered',
      dirPath: '/tmp/tampered',
      metadata: { ...baseMetadata, migrationHash: storedHash },
      ops: tamperedOps,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mismatch');
    expect(result.storedHash).toBe(storedHash);
    expect(result.computedHash).not.toBe(storedHash);
  });
});
