import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationToolsError } from '../src/errors';
import { readRefs, resolveRef, validateRefName, writeRefs } from '../src/refs';

describe('validateRefName', () => {
  it('accepts simple alphanumeric names', () => {
    expect(validateRefName('head')).toBe(true);
    expect(validateRefName('staging')).toBe(true);
    expect(validateRefName('production')).toBe(true);
  });

  it('accepts names with hyphens', () => {
    expect(validateRefName('my-staging')).toBe(true);
    expect(validateRefName('pre-production')).toBe(true);
  });

  it('accepts names with forward slashes', () => {
    expect(validateRefName('envs/staging')).toBe(true);
    expect(validateRefName('team/backend/prod')).toBe(true);
  });

  it('accepts names with digits', () => {
    expect(validateRefName('staging-2')).toBe(true);
    expect(validateRefName('v1')).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateRefName('')).toBe(false);
  });

  it('rejects names with path traversal sequences', () => {
    expect(validateRefName('..')).toBe(false);
    expect(validateRefName('../etc')).toBe(false);
    expect(validateRefName('envs/../production')).toBe(false);
    expect(validateRefName('./staging')).toBe(false);
  });

  it('rejects names with invalid characters', () => {
    expect(validateRefName('my staging')).toBe(false);
    expect(validateRefName('production!')).toBe(false);
    expect(validateRefName('stage@home')).toBe(false);
    expect(validateRefName('env\\prod')).toBe(false);
  });

  it('rejects names starting or ending with hyphens or slashes', () => {
    expect(validateRefName('-staging')).toBe(false);
    expect(validateRefName('staging-')).toBe(false);
    expect(validateRefName('/staging')).toBe(false);
    expect(validateRefName('staging/')).toBe(false);
  });

  it('rejects names with consecutive slashes', () => {
    expect(validateRefName('envs//staging')).toBe(false);
  });
});

describe('readRefs', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdir(join(tmpdir(), 'test-refs-read-'), { recursive: true });
    tmpDir = join(tmpdir(), `test-refs-read-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty record when refs.json does not exist', async () => {
    const refs = await readRefs(join(tmpDir, 'refs.json'));
    expect(refs).toEqual({});
  });

  it('reads valid refs.json', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeFile(refsPath, JSON.stringify({ staging: 'sha256:abc', production: 'sha256:def' }));
    const refs = await readRefs(refsPath);
    expect(refs).toEqual({ staging: 'sha256:abc', production: 'sha256:def' });
  });

  it('throws on malformed JSON', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeFile(refsPath, '{not valid json');
    try {
      await readRefs(refsPath);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REFS');
    }
  });

  it('throws when refs.json contains non-string values', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeFile(refsPath, JSON.stringify({ staging: 123 }));
    try {
      await readRefs(refsPath);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REFS');
    }
  });

  it('throws when refs.json contains invalid ref names', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeFile(refsPath, JSON.stringify({ '../escape': 'sha256:abc' }));
    try {
      await readRefs(refsPath);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REFS');
    }
  });
});

describe('writeRefs', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `test-refs-write-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes refs.json with sorted keys', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeRefs(refsPath, { production: 'sha256:def', staging: 'sha256:abc' });
    const content = JSON.parse(await readFile(refsPath, 'utf-8'));
    expect(content).toEqual({ production: 'sha256:def', staging: 'sha256:abc' });
    const raw = await readFile(refsPath, 'utf-8');
    const keys = Object.keys(JSON.parse(raw));
    expect(keys).toEqual(['production', 'staging']);
  });

  it('creates parent directory if missing', async () => {
    const refsPath = join(tmpDir, 'nested', 'refs.json');
    await writeRefs(refsPath, { head: 'sha256:abc' });
    const content = JSON.parse(await readFile(refsPath, 'utf-8'));
    expect(content).toEqual({ head: 'sha256:abc' });
  });

  it('overwrites existing refs.json', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeRefs(refsPath, { old: 'sha256:old' });
    await writeRefs(refsPath, { new: 'sha256:new' });
    const content = JSON.parse(await readFile(refsPath, 'utf-8'));
    expect(content).toEqual({ new: 'sha256:new' });
  });

  it('writes empty object when no refs', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeRefs(refsPath, {});
    const content = JSON.parse(await readFile(refsPath, 'utf-8'));
    expect(content).toEqual({});
  });

  it('rejects invalid ref names on write', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    try {
      await writeRefs(refsPath, { '../escape': 'sha256:abc' });
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });
});

describe('resolveRef', () => {
  it('resolves existing ref to hash', () => {
    const refs = { staging: 'sha256:abc', production: 'sha256:def' };
    expect(resolveRef(refs, 'staging')).toBe('sha256:abc');
  });

  it('throws for unknown ref name', () => {
    const refs = { staging: 'sha256:abc' };
    try {
      resolveRef(refs, 'production');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });

  it('throws for invalid ref name', () => {
    const refs = { staging: 'sha256:abc' };
    try {
      resolveRef(refs, '../escape');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });
});
