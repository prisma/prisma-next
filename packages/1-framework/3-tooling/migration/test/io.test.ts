import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationToolsError } from '../src/errors';
import {
  formatMigrationDirName,
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationPackage,
} from '../src/io';
import { createTestManifest, createTestOps } from './fixtures';

function expectMigrationError(error: unknown, code: string) {
  expect(MigrationToolsError.is(error)).toBe(true);
  const mte = error as MigrationToolsError;
  expect(mte.code).toBe(code);
  expect(mte.category).toBe('MIGRATION');
  expect(mte.why).toBeTruthy();
  expect(mte.fix).toBeTruthy();
}

describe('writeMigrationPackage + readMigrationPackage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-io-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('round-trips manifest and ops', async () => {
    const manifest = createTestManifest();
    const ops = createTestOps();
    const dir = join(tmpDir, '20260225T1430_add_users');

    await writeMigrationPackage(dir, manifest, ops);
    const pkg = await readMigrationPackage(dir);

    expect(JSON.stringify(pkg.manifest)).toBe(JSON.stringify(manifest));
    expect(JSON.stringify(pkg.ops)).toBe(JSON.stringify(ops));
    expect(pkg.dirName).toBe('20260225T1430_add_users');
    expect(pkg.dirPath).toBe(dir);
  });

  it('writes pretty-printed JSON', async () => {
    const dir = join(tmpDir, '20260225T1430_test');
    await writeMigrationPackage(dir, createTestManifest(), createTestOps());

    const manifestJson = await readFile(join(dir, 'migration.json'), 'utf-8');
    expect(manifestJson).toContain('\n');
    expect(manifestJson).toContain('  ');
  });

  it('errors on malformed migration.json with code MIGRATION.INVALID_JSON', async () => {
    const dir = join(tmpDir, '20260225T1430_bad');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), 'not json');
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_JSON');
      return true;
    });
  });

  it('errors on missing ops.json with code MIGRATION.FILE_MISSING', async () => {
    const dir = join(tmpDir, '20260225T1430_no_ops');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(createTestManifest()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.FILE_MISSING');
      expect((e as MigrationToolsError).details).toHaveProperty('file', 'ops.json');
      return true;
    });
  });

  it('errors on missing migration.json with code MIGRATION.FILE_MISSING', async () => {
    const dir = join(tmpDir, '20260225T1430_no_manifest');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.FILE_MISSING');
      expect((e as MigrationToolsError).details).toHaveProperty('file', 'migration.json');
      return true;
    });
  });

  it('errors when manifest is missing required fields with code MIGRATION.INVALID_MANIFEST', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_manifest');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify({ from: 'x' }));
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when migrationId is missing from manifest', async () => {
    const dir = join(tmpDir, '20260225T1430_no_edgeid');
    const manifest = createTestManifest();
    const { migrationId: _, ...manifestWithoutMigrationId } = manifest;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifestWithoutMigrationId));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when migrationId has wrong type', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_edgeid');
    const manifest = { ...createTestManifest(), migrationId: 123 };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when "from" is not a string', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_from');
    const manifest = { ...createTestManifest(), from: 42 };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when "kind" has invalid value', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_kind');
    const manifest = { ...createTestManifest(), kind: 'rollback' };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when "toContract" is missing', async () => {
    const dir = join(tmpDir, '20260225T1430_no_contract');
    const { toContract: _, ...manifestWithout } = createTestManifest();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifestWithout));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when "createdAt" is missing', async () => {
    const dir = join(tmpDir, '20260225T1430_no_created');
    const { createdAt: _, ...manifestWithout } = createTestManifest();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifestWithout));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when "hints" is missing', async () => {
    const dir = join(tmpDir, '20260225T1430_no_hints');
    const { hints: _, ...manifestWithout } = createTestManifest();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifestWithout));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when ops is not an array', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_ops');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(createTestManifest()));
    await writeFile(join(dir, 'ops.json'), JSON.stringify({ not: 'an array' }));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when ops entry is missing required fields', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_op_entry');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(createTestManifest()));
    await writeFile(join(dir, 'ops.json'), JSON.stringify([{ id: 'x' }]));

    await expect(readMigrationPackage(dir)).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('accepts manifest with optional authorship field', async () => {
    const dir = join(tmpDir, '20260225T1430_with_author');
    const manifest = createTestManifest({
      authorship: { author: 'test', email: 'test@example.com' },
    });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    const pkg = await readMigrationPackage(dir);
    expect(pkg.manifest.authorship).toEqual({ author: 'test', email: 'test@example.com' });
  });

  it('accepts manifest with migrationId: null (draft)', async () => {
    const dir = join(tmpDir, '20260225T1430_draft');
    const manifest = createTestManifest({ migrationId: null });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    const pkg = await readMigrationPackage(dir);
    expect(pkg.manifest.migrationId).toBeNull();
  });

  it('errors when writing to existing directory with code MIGRATION.DIR_EXISTS', async () => {
    const dir = join(tmpDir, '20260225T1430_exists');
    await mkdir(dir, { recursive: true });

    await expect(
      writeMigrationPackage(dir, createTestManifest(), createTestOps()),
    ).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.DIR_EXISTS');
      expect((e as MigrationToolsError).details).toHaveProperty('dir');
      return true;
    });
  });

  it('creates missing parent directories before writing package files', async () => {
    const dir = join(tmpDir, 'nested', '20260225T1430_nested');
    await writeMigrationPackage(dir, createTestManifest(), createTestOps());

    const pkg = await readMigrationPackage(dir);
    expect(pkg.dirName).toBe('20260225T1430_nested');
  });

  it('rethrows non-ENOENT errors while reading manifest file', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_manifest_file');
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'migration.json'));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir)).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });
});

describe('readMigrationsDir', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-dir-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns two packages sorted by name', async () => {
    const manifest1 = createTestManifest({ createdAt: '2026-02-25T14:00:00.000Z' });
    const manifest2 = createTestManifest({ createdAt: '2026-02-25T15:00:00.000Z' });
    const ops = createTestOps();

    await writeMigrationPackage(join(tmpDir, '20260225T1400_first'), manifest1, ops);
    await writeMigrationPackage(join(tmpDir, '20260225T1500_second'), manifest2, ops);

    const packages = await readMigrationsDir(tmpDir);
    expect(packages).toHaveLength(2);
    expect(packages[0]!.dirName).toBe('20260225T1400_first');
    expect(packages[1]!.dirName).toBe('20260225T1500_second');
  });

  it('skips non-migration subdirectories', async () => {
    await writeMigrationPackage(
      join(tmpDir, '20260225T1400_valid'),
      createTestManifest(),
      createTestOps(),
    );
    await mkdir(join(tmpDir, 'README'), { recursive: true });
    await writeFile(join(tmpDir, 'README', 'content.md'), '# readme');

    const packages = await readMigrationsDir(tmpDir);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.dirName).toBe('20260225T1400_valid');
  });

  it('returns empty array for empty directory', async () => {
    const packages = await readMigrationsDir(tmpDir);
    expect(packages).toHaveLength(0);
  });

  it('rethrows non-ENOENT errors while reading migrations root', async () => {
    const notADirectory = join(tmpDir, 'not-a-directory.txt');
    await writeFile(notADirectory, 'content');

    await expect(readMigrationsDir(notADirectory)).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('skips files (not directories) in root', async () => {
    await writeFile(join(tmpDir, '.gitkeep'), '');
    const packages = await readMigrationsDir(tmpDir);
    expect(packages).toHaveLength(0);
  });
});

describe('formatMigrationDirName', () => {
  it('formats with normal slug', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, 'add_users')).toBe('20260225T1430_add_users');
  });

  it('sanitizes special characters', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, 'Add Users!')).toBe('20260225T1430_add_users');
  });

  it('collapses consecutive underscores', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, 'a___b')).toBe('20260225T1430_a_b');
  });

  it('trims leading/trailing underscores from slug', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, '__test__')).toBe('20260225T1430_test');
  });

  it('zero-pads timestamp', () => {
    const ts = new Date('2026-01-05T03:07:00Z');
    expect(formatMigrationDirName(ts, 'init')).toBe('20260105T0307_init');
  });

  it('truncates long slugs', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    const longSlug = 'a'.repeat(100);
    const result = formatMigrationDirName(ts, longSlug);
    expect(result.length).toBeLessThanOrEqual(13 + 1 + 64);
  });

  it('errors on empty slug with code MIGRATION.INVALID_NAME', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    try {
      formatMigrationDirName(ts, '!!!');
      expect.fail('expected error');
    } catch (e) {
      expectMigrationError(e, 'MIGRATION.INVALID_NAME');
      expect((e as MigrationToolsError).details).toHaveProperty('slug', '!!!');
    }
  });
});
