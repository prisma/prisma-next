import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatMigrationDirName,
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationPackage,
} from '../src/io';
import { createTestManifest, createTestOps } from './fixtures';

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

  it('errors on malformed migration.json', async () => {
    const dir = join(tmpDir, '20260225T1430_bad');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), 'not json');
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir)).rejects.toThrow(/migration\.json/);
  });

  it('errors on missing ops.json', async () => {
    const dir = join(tmpDir, '20260225T1430_no_ops');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(createTestManifest()));

    await expect(readMigrationPackage(dir)).rejects.toThrow(/ops\.json/);
  });

  it('errors on missing migration.json', async () => {
    const dir = join(tmpDir, '20260225T1430_no_manifest');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir)).rejects.toThrow(/migration\.json/);
  });

  it('errors when manifest is missing required fields', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_manifest');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify({ from: 'x' }));
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir)).rejects.toThrow();
  });

  it('errors when writing to existing directory', async () => {
    const dir = join(tmpDir, '20260225T1430_exists');
    await mkdir(dir, { recursive: true });

    await expect(writeMigrationPackage(dir, createTestManifest(), createTestOps())).rejects.toThrow(
      /already exists/,
    );
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
    expect(result.length).toBeLessThanOrEqual(13 + 1 + 64); // timestamp + _ + max 64
  });

  it('errors on empty slug after sanitization', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(() => formatMigrationDirName(ts, '!!!')).toThrow();
  });
});
