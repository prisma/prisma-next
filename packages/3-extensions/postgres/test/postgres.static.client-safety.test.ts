/**
 * Client-safety test for @prisma-next/postgres/static.
 *
 * Walks the source import graph starting from src/exports/static.ts and asserts
 * that no reachable source file imports pg or @prisma-next/driver-postgres.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../');
const FORBIDDEN = ['pg', '@prisma-next/driver-postgres'];

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const dir = dirname(from);
  const candidates = [
    `${join(dir, specifier)}.ts`,
    join(dir, specifier, 'index.ts'),
    `${join(dir, specifier)}.mts`,
  ];
  for (const c of candidates) {
    try {
      readFileSync(c, 'utf8');
      return c;
    } catch {
      // not found, try next
    }
  }
  return null;
}

function extractImports(source: string): string[] {
  const re = /(?:^|\n)\s*(?:import|export)[^'"]*['"]([^'"]+)['"]/g;
  const result: string[] = [];
  let match = re.exec(source);
  while (match !== null) {
    if (match[1]) result.push(match[1]);
    match = re.exec(source);
  }
  return result;
}

function collectReachable(entrypoint: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
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

    for (const specifier of extractImports(source)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveImport(file, specifier);
        if (resolved && !files.has(resolved)) queue.push(resolved);
      } else {
        const parts = specifier.split('/');
        const pkg = specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
        packages.add(pkg);
      }
    }
  }

  return { files, packages };
}

describe('@prisma-next/postgres/static client-safety', () => {
  it('the /static module graph imports no driver packages', () => {
    const entry = join(ROOT, 'src/exports/static.ts');
    const { packages } = collectReachable(entry);

    for (const forbidden of FORBIDDEN) {
      expect(
        packages,
        `found forbidden import '${forbidden}' in the /static module graph`,
      ).not.toContain(forbidden);
    }
  });
});
