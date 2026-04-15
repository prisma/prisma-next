import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPackageManager } from '../../../src/commands/init/detect-package-manager';

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
