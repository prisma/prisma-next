import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../src/canonicalize-json';
import { emitPinnedSpaceArtefacts } from '../src/emit-pinned-space-artefacts';
import { MigrationToolsError } from '../src/errors';
import { readPinnedContractHash } from '../src/read-pinned-contract-hash';

describe('readPinnedContractHash', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'read-pinned-hash-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it("returns null when the space's pinned refs/head.json does not exist", async () => {
    expect(await readPinnedContractHash(migrationsDir, 'cipherstash')).toBeNull();
  });

  it('returns null when the migrations directory itself does not exist', async () => {
    const missing = join(migrationsDir, 'nope', 'migrations');
    expect(await readPinnedContractHash(missing, 'cipherstash')).toBeNull();
  });

  it('returns the pinned hash written by emitPinnedSpaceArtefacts', async () => {
    const hash = 'sha256:0123456789012345678901234567890123456789012345678901234567890123';
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { foo: 1 },
      contractDts: '\n',
      headRef: { hash, invariants: ['inv-1'] },
    });

    expect(await readPinnedContractHash(migrationsDir, 'cipherstash')).toBe(hash);
  });

  it('reads the hash field from refs/head.json verbatim (no normalisation)', async () => {
    const dir = join(migrationsDir, 'cipherstash', 'refs');
    await mkdir(dir, { recursive: true });
    const hash = 'sha256:abc';
    await writeFile(join(dir, 'head.json'), `${canonicalizeJson({ hash, invariants: [] })}\n`);

    expect(await readPinnedContractHash(migrationsDir, 'cipherstash')).toBe(hash);
  });

  it('throws when refs/head.json is malformed JSON', async () => {
    const dir = join(migrationsDir, 'cipherstash', 'refs');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'head.json'), 'not json {');

    let captured: unknown;
    try {
      await readPinnedContractHash(migrationsDir, 'cipherstash');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    expect((captured as MigrationToolsError).code).toBe('MIGRATION.INVALID_JSON');
  });

  it("throws when refs/head.json's hash field is missing or wrong-shaped", async () => {
    const dir = join(migrationsDir, 'cipherstash', 'refs');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'head.json'), JSON.stringify({ invariants: [] }));

    let captured: unknown;
    try {
      await readPinnedContractHash(migrationsDir, 'cipherstash');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    expect((captured as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_FILE');
  });

  it('rejects an invalid space id (filesystem safety)', async () => {
    let captured: unknown;
    try {
      await readPinnedContractHash(migrationsDir, 'INVALID');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    expect((captured as MigrationToolsError).code).toBe('MIGRATION.INVALID_SPACE_ID');
  });

  it('rejects the app space (pinned head ref is an extension-space concept)', async () => {
    let captured: unknown;
    try {
      await readPinnedContractHash(migrationsDir, 'app');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    expect((captured as MigrationToolsError).code).toBe('MIGRATION.PINNED_ARTEFACTS_APP_SPACE');
  });
});
