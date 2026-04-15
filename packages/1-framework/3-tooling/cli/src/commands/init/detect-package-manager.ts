import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'pathe';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

function detectFromLockfile(dir: string): PackageManager | undefined {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  return undefined;
}

function detectFromPackageJson(dir: string): PackageManager | undefined {
  try {
    const pkgJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    const pm = pkgJson.packageManager;
    if (typeof pm === 'string') {
      if (pm.startsWith('pnpm')) return 'pnpm';
      if (pm.startsWith('yarn')) return 'yarn';
      if (pm.startsWith('bun')) return 'bun';
    }
  } catch {
    // no package.json or invalid json
  }
  return undefined;
}

export function detectPackageManager(baseDir: string): PackageManager {
  let dir = baseDir;
  while (true) {
    const fromLock = detectFromLockfile(dir);
    if (fromLock) return fromLock;

    const fromPkg = detectFromPackageJson(dir);
    if (fromPkg) return fromPkg;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return 'npm';
}
