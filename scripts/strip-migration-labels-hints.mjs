#!/usr/bin/env node
/**
 * Bring on-disk `migration.json` manifests into the slimmed metadata model:
 * drop the now-removed `labels` and `hints` keys and recompute
 * `migrationHash` over the surviving metadata envelope + sibling `ops.json`.
 *
 * The hash is recomputed with the real `computeMigrationHash` from
 * `@prisma-next/migration-tools` (imported from its built dist) so the bytes
 * match exactly what the loader verifies — the canonicalisation rules are not
 * reimplemented here.
 *
 * Existing field order is preserved (the two keys are dropped in place) and
 * the trailing-newline convention of each file is kept, so the git diff stays
 * limited to the removed keys and the new hash value.
 *
 * Idempotent: re-running over already-migrated files produces no changes.
 *
 * Usage:
 *   node scripts/strip-migration-labels-hints.mjs            # apply
 *   node scripts/strip-migration-labels-hints.mjs --dry-run  # report only
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const { computeMigrationHash } = await import(
  join(repoRoot, 'packages/1-framework/3-tooling/migration/dist/exports/hash.mjs')
);

const ROOTS = ['examples', 'packages', 'apps'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  '.git',
  'coverage',
]);

const dryRun = process.argv.includes('--dry-run');

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (entry.isFile() && entry.name === 'migration.json') {
      yield join(dir, entry.name);
    }
  }
}

let scanned = 0;
let changed = 0;
const changedFiles = [];

for (const root of ROOTS) {
  for await (const file of walk(join(repoRoot, root))) {
    scanned += 1;
    const raw = await readFile(file, 'utf8');
    const trailingNewline = raw.endsWith('\n');
    const metadata = JSON.parse(raw);

    delete metadata.labels;
    delete metadata.hints;

    const opsPath = join(dirname(file), 'ops.json');
    let opsRaw;
    try {
      opsRaw = await readFile(opsPath, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read sibling ops.json for ${file}: ${error.message}`);
    }
    const ops = JSON.parse(opsRaw);

    metadata.migrationHash = computeMigrationHash(metadata, ops);

    const serialized = `${JSON.stringify(metadata, null, 2)}${trailingNewline ? '\n' : ''}`;
    if (serialized !== raw) {
      changed += 1;
      changedFiles.push(file.slice(repoRoot.length + 1));
      if (!dryRun) {
        await writeFile(file, serialized, 'utf8');
      }
    }
  }
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}scanned ${scanned} migration.json file(s); ${changed} changed`,
);
for (const f of changedFiles) {
  console.log(`  ${dryRun ? 'would change' : 'changed'}: ${f}`);
}
