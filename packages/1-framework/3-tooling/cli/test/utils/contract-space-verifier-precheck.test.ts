import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContractSpaceVerifierPrecheck } from '../../src/utils/contract-space-verifier-precheck';

const FAKE_CONTRACT_SPACE = {
  contractJson: {},
  migrations: [],
  headRef: { hash: '', invariants: [] },
};

describe('runContractSpaceVerifierPrecheck', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-precheck-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns ok when no extensions are declared (single-app project)', async () => {
    const result = await runContractSpaceVerifierPrecheck({
      migrationsDir,
      extensionPacks: [],
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok when an extension declares contractSpace AND has a pinned dir on disk', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: 'sha256:cipher', invariants: [] },
    });

    const result = await runContractSpaceVerifierPrecheck({
      migrationsDir,
      extensionPacks: [{ id: 'cipherstash', contractSpace: FAKE_CONTRACT_SPACE }],
    });
    expect(result.ok).toBe(true);
  });

  it('reports declaredButUnmigrated when extension is declared but no pinned dir on disk (locks AC-16)', async () => {
    const result = await runContractSpaceVerifierPrecheck({
      migrationsDir,
      extensionPacks: [{ id: 'cipherstash', contractSpace: FAKE_CONTRACT_SPACE }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.why).toContain('declaredButUnmigrated');
      expect(result.failure.why).toContain('cipherstash');
      expect(result.failure.fix).toContain('prisma-next migrate');
    }
  });

  it('reports orphanPinnedDir when migrations/<space>/ exists but extension is not declared (locks AC-16 case 2)', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: 'sha256:cipher', invariants: [] },
    });

    const result = await runContractSpaceVerifierPrecheck({
      migrationsDir,
      extensionPacks: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.why).toContain('orphanPinnedDir');
      expect(result.failure.why).toContain('cipherstash');
    }
  });

  it('skips extensions that do not declare contractSpace (codec-only extensions are not space participants)', async () => {
    const result = await runContractSpaceVerifierPrecheck({
      migrationsDir,
      extensionPacks: [{ id: 'codec-only-extension' }],
    });
    expect(result.ok).toBe(true);
  });

  it('reports every violation in a single error envelope (so the user sees the full picture)', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'orphan-extension', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: 'sha256:orphan', invariants: [] },
    });

    const result = await runContractSpaceVerifierPrecheck({
      migrationsDir,
      extensionPacks: [{ id: 'cipherstash', contractSpace: FAKE_CONTRACT_SPACE }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.why).toContain('declaredButUnmigrated');
      expect(result.failure.why).toContain('orphanPinnedDir');
      const meta = result.failure.meta as { violations?: unknown[] };
      expect(Array.isArray(meta?.violations)).toBe(true);
      expect((meta?.violations ?? []).length).toBe(2);
    }
  });
});
