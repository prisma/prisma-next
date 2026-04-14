import { existsSync, readFileSync } from 'node:fs';
import { join } from 'pathe';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export function detectPackageManager(baseDir: string): PackageManager {
  if (existsSync(join(baseDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(baseDir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(baseDir, 'bun.lock')) || existsSync(join(baseDir, 'bun.lockb'))) return 'bun';
  if (existsSync(join(baseDir, 'package-lock.json'))) return 'npm';

  try {
    const pkgJson = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf-8'));
    const pm = pkgJson.packageManager;
    if (typeof pm === 'string') {
      if (pm.startsWith('pnpm')) return 'pnpm';
      if (pm.startsWith('yarn')) return 'yarn';
      if (pm.startsWith('bun')) return 'bun';
    }
  } catch {
    // no package.json or invalid json
  }

  return 'npm';
}
