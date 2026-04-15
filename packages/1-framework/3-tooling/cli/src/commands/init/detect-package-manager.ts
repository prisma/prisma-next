import { detect } from 'package-manager-detector/detect';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

const KNOWN: ReadonlySet<string> = new Set<PackageManager>(['pnpm', 'npm', 'yarn', 'bun']);

export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const result = await detect({ cwd });
  if (result && KNOWN.has(result.name)) {
    return result.name as PackageManager;
  }
  return 'npm';
}

export function formatRunCommand(pm: PackageManager, bin: string, args: string): string {
  if (pm === 'npm') {
    return `npx ${bin} ${args}`;
  }
  return `${pm} ${bin} ${args}`;
}
