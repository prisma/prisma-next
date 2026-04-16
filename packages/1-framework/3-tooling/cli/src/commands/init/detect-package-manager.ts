import { existsSync } from 'node:fs';
import { detect } from 'package-manager-detector/detect';
import { join } from 'pathe';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun' | 'deno';

const KNOWN: ReadonlySet<string> = new Set<PackageManager>(['pnpm', 'npm', 'yarn', 'bun', 'deno']);

export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const result = await detect({ cwd });
  if (result && KNOWN.has(result.name)) {
    return result.name as PackageManager;
  }
  return 'npm';
}

export function hasProjectManifest(cwd: string): boolean {
  return (
    existsSync(join(cwd, 'package.json')) ||
    existsSync(join(cwd, 'deno.json')) ||
    existsSync(join(cwd, 'deno.jsonc'))
  );
}

export function formatRunCommand(pm: PackageManager, bin: string, args: string): string {
  if (pm === 'npm') {
    return `npx ${bin} ${args}`;
  }
  if (pm === 'deno') {
    return `deno run npm:${bin} ${args}`;
  }
  return `${pm} ${bin} ${args}`;
}

export function formatAddArgs(pm: PackageManager, packages: string[]): string[] {
  if (pm === 'deno') {
    return ['add', ...packages.map((p) => `npm:${p}`)];
  }
  return ['add', ...packages];
}

export function formatAddDevArgs(pm: PackageManager, packages: string[]): string[] {
  if (pm === 'deno') {
    return ['add', '--dev', ...packages.map((p) => `npm:${p}`)];
  }
  return ['add', '-D', ...packages];
}
