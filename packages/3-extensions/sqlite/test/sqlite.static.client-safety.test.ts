/**
 * Client-safety test for @prisma-next/sqlite/static.
 *
 * Walks the import graph starting from src/exports/static.ts, following
 * relative imports within a package AND value imports of @prisma-next/*
 * packages into their own source (resolved via each consumer's own
 * node_modules, since pnpm links workspace packages per-consumer rather
 * than at the repo root). Asserts that no reachable value import is
 * @prisma-next/driver-sqlite. `import type` / `export type` specifiers
 * are skipped: they're erased at build time and can't leak the driver
 * into a bundle.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../');
const FORBIDDEN = ['@prisma-next/driver-sqlite'];
const WORKSPACE_SCOPE = '@prisma-next/';

interface ImportSpecifier {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

function extractImports(source: string): ImportSpecifier[] {
  const re =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*(import|export)\s+(type\s+)?['"]([^'"]+)['"]/g;
  const result: ImportSpecifier[] = [];
  let match = re.exec(source);
  while (match !== null) {
    const specifier = match[3] ?? match[6];
    const typeOnly = Boolean(match[2] ?? match[5]);
    if (specifier) result.push({ specifier, typeOnly });
    match = re.exec(source);
  }
  return result;
}

function resolveRelativeImport(from: string, specifier: string): string | null {
  const dir = dirname(from);
  const candidates = [
    `${join(dir, specifier)}.ts`,
    join(dir, specifier, 'index.ts'),
    `${join(dir, specifier)}.mts`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function findPackageDir(fromDir: string, pkgName: string): string | null {
  let dir = fromDir;
  while (true) {
    const candidate = join(dir, 'node_modules', pkgName);
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function sourceEntryForSubpath(pkgDir: string, subpath: string): string | null {
  const packageJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(packageJsonPath)) return null;
  const packageJson: { exports?: Record<string, unknown> } = JSON.parse(
    readFileSync(packageJsonPath, 'utf8'),
  );
  const exportsMap = packageJson.exports;
  if (!exportsMap) return null;

  const exportKey = subpath === '' ? '.' : `./${subpath}`;
  const target = exportsMap[exportKey];
  const distPath = typeof target === 'string' ? target : null;
  if (!distPath) return null;

  const distMatch = /dist\/(.+)\.mjs$/.exec(distPath);
  if (!distMatch) return null;
  const entryName = distMatch[1];

  const srcPath = join(pkgDir, 'src/exports', `${entryName}.ts`);
  return existsSync(srcPath) ? srcPath : null;
}

function resolveWorkspaceImport(from: string, specifier: string): string | null {
  const withoutScope = specifier.slice(WORKSPACE_SCOPE.length);
  const slashIndex = withoutScope.indexOf('/');
  const pkgName =
    slashIndex === -1 ? specifier : `${WORKSPACE_SCOPE}${withoutScope.slice(0, slashIndex)}`;
  const subpath = slashIndex === -1 ? '' : withoutScope.slice(slashIndex + 1);

  const pkgDir = findPackageDir(dirname(from), pkgName);
  if (!pkgDir) return null;

  return sourceEntryForSubpath(pkgDir, subpath);
}

function collectReachable(entrypoint: string): {
  files: Set<string>;
  valueImportsBySpecifier: Map<string, string[]>;
} {
  const files = new Set<string>();
  const valueImportsBySpecifier = new Map<string, string[]>();
  const queue: string[] = [entrypoint];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const { specifier, typeOnly } of extractImports(source)) {
      if (typeOnly) continue;

      if (specifier.startsWith('.')) {
        const resolved = resolveRelativeImport(file, specifier);
        if (resolved && !files.has(resolved)) queue.push(resolved);
        continue;
      }

      const importers = valueImportsBySpecifier.get(specifier) ?? [];
      importers.push(file);
      valueImportsBySpecifier.set(specifier, importers);

      if (specifier.startsWith(WORKSPACE_SCOPE)) {
        const resolved = resolveWorkspaceImport(file, specifier);
        if (resolved && !files.has(resolved)) queue.push(resolved);
      }
    }
  }

  return { files, valueImportsBySpecifier };
}

describe('@prisma-next/sqlite/static client-safety', () => {
  it('the /static module graph has no value import of a driver package', () => {
    const entry = join(ROOT, 'src/exports/static.ts');
    const { valueImportsBySpecifier } = collectReachable(entry);

    for (const forbidden of FORBIDDEN) {
      const importers = valueImportsBySpecifier.get(forbidden);
      expect(
        importers,
        `found forbidden value import '${forbidden}' in the /static module graph, imported from: ${importers?.join(', ')}`,
      ).toBeUndefined();
    }
  });
});
