import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContractSpaceVerifierMarkerCheck } from '../../src/utils/contract-space-verifier-marker-check';

const FAKE_CONTRACT_SPACE = {
  contractJson: {},
  migrations: [],
  headRef: { hash: '', invariants: [] },
};

function makeMarker(args: {
  readonly storageHash: string;
  readonly invariants?: readonly string[];
}): ContractMarkerRecord {
  return {
    storageHash: args.storageHash,
    profileHash: 'profile',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    appTag: null,
    meta: {},
    invariants: args.invariants ?? [],
  };
}

describe('runContractSpaceVerifierMarkerCheck', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-marker-check-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns ok when marker, pinned, and extensionPacks are aligned', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: 'sha256:cipher', invariants: [] },
    });

    const result = await runContractSpaceVerifierMarkerCheck({
      migrationsDir,
      extensionPacks: [{ id: 'cipherstash', contractSpace: FAKE_CONTRACT_SPACE }],
      markerRowsBySpace: new Map([
        ['app', makeMarker({ storageHash: 'sha256:app' })],
        ['cipherstash', makeMarker({ storageHash: 'sha256:cipher' })],
      ]),
    });

    expect(result.ok).toBe(true);
  });

  it('reports orphanMarker when a marker exists for a space not in extensionPacks', async () => {
    const result = await runContractSpaceVerifierMarkerCheck({
      migrationsDir,
      extensionPacks: [],
      markerRowsBySpace: new Map([
        ['app', makeMarker({ storageHash: 'sha256:app' })],
        ['retired-extension', makeMarker({ storageHash: 'sha256:retired' })],
      ]),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.why).toContain('orphanMarker');
      expect(result.failure.why).toContain('retired-extension');
    }
  });

  it('reports hashMismatch when marker hash diverges from pinned hash (marker half)', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: 'sha256:pinned', invariants: [] },
    });

    const result = await runContractSpaceVerifierMarkerCheck({
      migrationsDir,
      extensionPacks: [{ id: 'cipherstash', contractSpace: FAKE_CONTRACT_SPACE }],
      markerRowsBySpace: new Map([
        ['app', makeMarker({ storageHash: 'sha256:app' })],
        ['cipherstash', makeMarker({ storageHash: 'sha256:marker' })],
      ]),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.why).toContain('hashMismatch');
      expect(result.failure.why).toContain('cipherstash');
    }
  });

  it('reports invariantsMismatch when marker is missing invariants the pinned head declares', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: 'sha256:cipher', invariants: ['ix1', 'ix2'] },
    });

    const result = await runContractSpaceVerifierMarkerCheck({
      migrationsDir,
      extensionPacks: [{ id: 'cipherstash', contractSpace: FAKE_CONTRACT_SPACE }],
      markerRowsBySpace: new Map([
        ['app', makeMarker({ storageHash: 'sha256:app' })],
        ['cipherstash', makeMarker({ storageHash: 'sha256:cipher', invariants: ['ix1'] })],
      ]),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.why).toContain('invariantsMismatch');
      expect(result.failure.why).toContain('cipherstash');
    }
  });

  it('app-space marker is always allowed (never reported as orphan)', async () => {
    const result = await runContractSpaceVerifierMarkerCheck({
      migrationsDir,
      extensionPacks: [],
      markerRowsBySpace: new Map([['app', makeMarker({ storageHash: 'sha256:app' })]]),
    });

    expect(result.ok).toBe(true);
  });

  it('reports every violation in a single envelope', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: 'sha256:pinned', invariants: [] },
    });

    const result = await runContractSpaceVerifierMarkerCheck({
      migrationsDir,
      extensionPacks: [{ id: 'cipherstash', contractSpace: FAKE_CONTRACT_SPACE }],
      markerRowsBySpace: new Map([
        ['app', makeMarker({ storageHash: 'sha256:app' })],
        ['cipherstash', makeMarker({ storageHash: 'sha256:diverged' })],
        ['orphan-pack', makeMarker({ storageHash: 'sha256:orphan' })],
      ]),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const meta = result.failure.meta as { violations?: unknown[] };
      const violations = (meta?.violations ?? []) as { readonly kind: string }[];
      const kinds = violations.map((v) => v.kind).sort();
      expect(kinds).toEqual(['hashMismatch', 'orphanMarker']);
    }
  });
});
