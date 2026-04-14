import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('detects pnpm from lockfile', () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');

    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('detects yarn from lockfile', () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '');

    expect(detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('detects bun from bun.lock', () => {
    writeFileSync(join(tmpDir, 'bun.lock'), '');

    expect(detectPackageManager(tmpDir)).toBe('bun');
  });

  it('detects bun from bun.lockb', () => {
    writeFileSync(join(tmpDir, 'bun.lockb'), '');

    expect(detectPackageManager(tmpDir)).toBe('bun');
  });

  it('detects npm from package-lock.json', () => {
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}');

    expect(detectPackageManager(tmpDir)).toBe('npm');
  });

  it('falls back to packageManager field in package.json', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));

    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('defaults to npm when nothing detected', () => {
    expect(detectPackageManager(tmpDir)).toBe('npm');
  });

  it('prefers lockfile over package.json packageManager field', () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '');
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));

    expect(detectPackageManager(tmpDir)).toBe('yarn');
  });
});
