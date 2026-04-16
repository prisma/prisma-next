import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectPackageManager,
  formatAddArgs,
  formatAddDevArgs,
  formatRunCommand,
  hasProjectManifest,
} from '../../../src/commands/init/detect-package-manager';

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pm-detect-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects pnpm from lockfile', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');

    expect(await detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('detects yarn from lockfile', async () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '');

    expect(await detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('detects bun from bun.lockb', async () => {
    writeFileSync(join(tmpDir, 'bun.lockb'), '');

    expect(await detectPackageManager(tmpDir)).toBe('bun');
  });

  it('detects npm from package-lock.json', async () => {
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}');

    expect(await detectPackageManager(tmpDir)).toBe('npm');
  });

  it('detects deno from deno.lock', async () => {
    writeFileSync(join(tmpDir, 'deno.lock'), '{}');

    expect(await detectPackageManager(tmpDir)).toBe('deno');
  });

  it('falls back to packageManager field in package.json', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));

    expect(await detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('defaults to npm when nothing detected', async () => {
    expect(await detectPackageManager(tmpDir)).toBe('npm');
  });

  it('detects lockfile in ancestor directory', async () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    const child = join(tmpDir, 'packages', 'my-app');
    mkdirSync(child, { recursive: true });

    expect(await detectPackageManager(child)).toBe('pnpm');
  });
});

describe('hasProjectManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pm-manifest-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{}');

    expect(hasProjectManifest(tmpDir)).toBe(true);
  });

  it('returns true for deno.json', () => {
    writeFileSync(join(tmpDir, 'deno.json'), '{}');

    expect(hasProjectManifest(tmpDir)).toBe(true);
  });

  it('returns true for deno.jsonc', () => {
    writeFileSync(join(tmpDir, 'deno.jsonc'), '{}');

    expect(hasProjectManifest(tmpDir)).toBe(true);
  });

  it('returns false for empty directory', () => {
    expect(hasProjectManifest(tmpDir)).toBe(false);
  });
});

describe('formatRunCommand', () => {
  it('uses npx for npm', () => {
    expect(formatRunCommand('npm', 'prisma-next', 'contract emit')).toBe(
      'npx prisma-next contract emit',
    );
  });

  it('uses deno run npm: for deno', () => {
    expect(formatRunCommand('deno', 'prisma-next', 'contract emit')).toBe(
      'deno run npm:prisma-next contract emit',
    );
  });

  it('uses pm directly for pnpm/yarn/bun', () => {
    expect(formatRunCommand('pnpm', 'prisma-next', 'contract emit')).toBe(
      'pnpm prisma-next contract emit',
    );
    expect(formatRunCommand('bun', 'prisma-next', 'contract emit')).toBe(
      'bun prisma-next contract emit',
    );
  });
});

describe('formatAddArgs', () => {
  it('prefixes packages with npm: for deno', () => {
    expect(formatAddArgs('deno', ['@prisma-next/postgres', 'dotenv'])).toEqual([
      'add',
      'npm:@prisma-next/postgres',
      'npm:dotenv',
    ]);
  });

  it('passes packages directly for other managers', () => {
    expect(formatAddArgs('pnpm', ['@prisma-next/postgres', 'dotenv'])).toEqual([
      'add',
      '@prisma-next/postgres',
      'dotenv',
    ]);
  });
});

describe('formatAddDevArgs', () => {
  it('uses --dev for deno with npm: prefix', () => {
    expect(formatAddDevArgs('deno', ['@prisma-next/cli'])).toEqual([
      'add',
      '--dev',
      'npm:@prisma-next/cli',
    ]);
  });

  it('uses -D for other managers', () => {
    expect(formatAddDevArgs('npm', ['@prisma-next/cli'])).toEqual([
      'add',
      '-D',
      '@prisma-next/cli',
    ]);
  });
});
