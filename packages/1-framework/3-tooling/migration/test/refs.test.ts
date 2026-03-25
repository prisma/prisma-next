import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MigrationToolsError } from '../src/errors';
import { readRefs, resolveRef, validateRefName, validateRefValue, writeRefs } from '../src/refs';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

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

describe('validateRefValue', () => {
  it('accepts sha256:empty', () => {
    expect(validateRefValue('sha256:empty')).toBe(true);
  });

  it('accepts valid 64-char hex hash', () => {
    expect(validateRefValue(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(validateRefValue(`sha256:${'0123456789abcdef'.repeat(4)}`)).toBe(true);
  });

  it('rejects missing sha256 prefix', () => {
    expect(validateRefValue('a'.repeat(64))).toBe(false);
    expect(validateRefValue('empty')).toBe(false);
  });

  it('rejects wrong length hex', () => {
    expect(validateRefValue('sha256:abc')).toBe(false);
    expect(validateRefValue(`sha256:${'a'.repeat(63)}`)).toBe(false);
    expect(validateRefValue(`sha256:${'a'.repeat(65)}`)).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(validateRefValue(`sha256:${'A'.repeat(64)}`)).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(validateRefValue(`sha256:${'g'.repeat(64)}`)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateRefValue('')).toBe(false);
  });
});

describe('readRefs', () => {
  let tmpDir: string;

  beforeEach(async () => {
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
    await writeFile(refsPath, JSON.stringify({ staging: HASH_A, production: HASH_B }));
    const refs = await readRefs(refsPath);
    expect(refs).toEqual({ staging: HASH_A, production: HASH_B });
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

  it('throws when refs.json contains invalid hash values', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeFile(refsPath, JSON.stringify({ staging: 'not-a-hash' }));
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
    await writeFile(refsPath, JSON.stringify({ '../escape': HASH_A }));
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
    await writeRefs(refsPath, { production: HASH_B, staging: HASH_A });
    const content = JSON.parse(await readFile(refsPath, 'utf-8'));
    expect(content).toEqual({ production: HASH_B, staging: HASH_A });
    const raw = await readFile(refsPath, 'utf-8');
    const keys = Object.keys(JSON.parse(raw));
    expect(keys).toEqual(['production', 'staging']);
  });

  it('creates parent directory if missing', async () => {
    const refsPath = join(tmpDir, 'nested', 'refs.json');
    await writeRefs(refsPath, { head: HASH_A });
    const content = JSON.parse(await readFile(refsPath, 'utf-8'));
    expect(content).toEqual({ head: HASH_A });
  });

  it('overwrites existing refs.json', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    await writeRefs(refsPath, { old: HASH_A });
    await writeRefs(refsPath, { new: HASH_B });
    const content = JSON.parse(await readFile(refsPath, 'utf-8'));
    expect(content).toEqual({ new: HASH_B });
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
      await writeRefs(refsPath, { '../escape': `sha256:${'a'.repeat(64)}` });
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });

  it('rejects invalid hash values on write', async () => {
    const refsPath = join(tmpDir, 'refs.json');
    try {
      await writeRefs(refsPath, { staging: 'not-a-valid-hash' });
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_VALUE');
    }
  });
});

describe('resolveRef', () => {
  it('resolves existing ref to hash', () => {
    const refs = { staging: HASH_A, production: HASH_B };
    expect(resolveRef(refs, 'staging')).toBe(HASH_A);
  });

  it('throws for unknown ref name', () => {
    const refs = { staging: HASH_A };
    try {
      resolveRef(refs, 'production');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });

  it('throws for invalid ref name', () => {
    const refs = { staging: `sha256:${'a'.repeat(64)}` };
    try {
      resolveRef(refs, '../escape');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_NAME');
    }
  });

  it('throws for invalid hash value in resolved ref', () => {
    const refs = { staging: 'not-a-hash' } as Record<string, string>;
    try {
      resolveRef(refs, 'staging');
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.INVALID_REF_VALUE');
    }
  });
});
