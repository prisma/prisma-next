import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../src/canonicalize-json';
import { emitPinnedSpaceArtefacts } from '../src/emit-pinned-space-artefacts';
import { MigrationToolsError } from '../src/errors';
import { readPinnedHeadRef } from '../src/read-pinned-head-ref';

describe('readPinnedHeadRef', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'read-pinned-head-ref-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns null when the pinned refs/head.json does not exist', async () => {
    expect(await readPinnedHeadRef(migrationsDir, 'cipherstash')).toBeNull();
  });

  it('returns null when the migrations directory itself does not exist', async () => {
    const missing = join(migrationsDir, 'nope', 'migrations');
    expect(await readPinnedHeadRef(missing, 'cipherstash')).toBeNull();
  });

  it('round-trips with emitPinnedSpaceArtefacts', async () => {
    const hash = 'sha256:0123456789012345678901234567890123456789012345678901234567890123';
    const invariants = ['inv-2', 'inv-1', 'inv-3'];
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { foo: 1 },
      contractDts: '\n',
      headRef: { hash, invariants },
    });

    const result = await readPinnedHeadRef(migrationsDir, 'cipherstash');
    expect(result?.hash).toBe(hash);
    // emitPinnedSpaceArtefacts sorts invariants alphabetically before write.
    expect(result?.invariants).toEqual(['inv-1', 'inv-2', 'inv-3']);
  });

  it('throws when refs/head.json is missing the invariants array', async () => {
    const dir = join(migrationsDir, 'cipherstash', 'refs');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'head.json'), `${canonicalizeJson({ hash: 'sha256:abc' })}\n`);

    let captured: unknown;
    try {
      await readPinnedHeadRef(migrationsDir, 'cipherstash');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
  });

  it('rejects the app space (pinned head refs are an extension-space concept)', async () => {
    let captured: unknown;
    try {
      await readPinnedHeadRef(migrationsDir, 'app');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    if (MigrationToolsError.is(captured)) {
      expect(captured.code).toBe('MIGRATION.PINNED_ARTEFACTS_APP_SPACE');
    }
  });

  it('rejects an invalid space id', async () => {
    let captured: unknown;
    try {
      await readPinnedHeadRef(migrationsDir, 'NOT VALID');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    if (MigrationToolsError.is(captured)) {
      expect(captured.code).toBe('MIGRATION.INVALID_SPACE_ID');
    }
  });
});
