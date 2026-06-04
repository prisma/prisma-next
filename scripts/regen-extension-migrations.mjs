#!/usr/bin/env node
/**
 * Regenerates migration metadata for all extension packages that carry an
 * on-disk `migrations/` tree, keeping them consistent with the freshly-built
 * `src/contract.json` after `pnpm build:contract-space` / `pnpm fixtures:emit`.
 *
 * For each extension under packages/3-extensions/ that contains a
 * `migrations/` directory the script:
 *
 *   1. Reads `src/contract.json` -> `storage.storageHash` (new end-state hash).
 *   2. Locates the HEAD migration - the one whose `migration.json` sets
 *      `"to"` equal to the hash published in `migrations/refs/head.json`.
 *      Because every current extension has exactly one (baseline) migration
 *      with `from: null`, the head migration is always unambiguous; the
 *      script halts with an error if the chain is ambiguous or the head
 *      migration cannot be identified.
 *   3. Rewrites the `to` literal in that migration's `migration.ts` to the
 *      new storageHash.
 *   4. Re-emits `ops.json` + `migration.json` by running `tsx migration.ts`
 *      from the extension package root (tsx because the migration imports
 *      relative TypeScript siblings).
 *   5. Re-pins `migrations/refs/head.json` with the new hash, preserving
 *      the existing `invariants` array verbatim.
 *   6. Syncs `end-contract.{json,d.ts}` from `src/contract.{json,d.ts}`.
 *
 * If the new storageHash already matches the published `head.json` hash the
 * extension is skipped (already consistent) - making the script idempotent.
 *
 * Usage:
 *   node scripts/regen-extension-migrations.mjs
 *
 * Wired into the root `package.json` as `"migrations:regen"` and chained
 * after `build:contract-space` in `fixtures:emit`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = join(repoRoot, 'packages', '3-extensions');
const tsx = join(repoRoot, 'node_modules', '.bin', 'tsx');

/**
 * Read and parse a JSON file, returning the parsed object.
 * Throws a descriptive error on missing or malformed files.
 */
function readJson(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`regen-extension-migrations: cannot read ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`regen-extension-migrations: malformed JSON in ${filePath}: ${err.message}`);
  }
}

/**
 * Find the migration directory whose `migration.json` has a `to` field
 * matching `headHash`. Returns the directory path.
 *
 * Halts (throws) when:
 *   - No migration directory matches (chain is broken -- head.json is stale
 *     in a way regen cannot fix automatically).
 *   - More than one migration directory matches (ambiguous HEAD -- not expected
 *     in the current single-migration baseline layout; human review required).
 */
function findHeadMigrationDir(migrationsDir, headHash) {
  let migrationDirs;
  try {
    migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'refs')
      .map((e) => join(migrationsDir, e.name));
  } catch {
    throw new Error(
      `regen-extension-migrations: cannot list migration directories in ${migrationsDir}`,
    );
  }

  const matching = migrationDirs.filter((dir) => {
    const metaPath = join(dir, 'migration.json');
    if (!existsSync(metaPath)) return false;
    const meta = readJson(metaPath);
    return meta.to === headHash;
  });

  if (matching.length === 0) {
    throw new Error(
      `regen-extension-migrations: no migration directory in ${migrationsDir} has "to": "${headHash}" -- ` +
        'head.json may be stale in an unexpected way; manual review required',
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `regen-extension-migrations: multiple migration directories match "to": "${headHash}" in ${migrationsDir} -- ` +
        `ambiguous HEAD; manual review required: ${matching.join(', ')}`,
    );
  }
  return matching[0];
}

/**
 * Rewrite the `to:` hash literal in a `migration.ts` file.
 *
 * Matches the pattern:
 *   to: 'sha256:<hex>',
 * or
 *   to: "sha256:<hex>",
 * (with optional surrounding whitespace) and replaces the hash value.
 *
 * Throws if the pattern is not found exactly once.
 */
function rewriteMigrationToHash(migrationTsPath, newHash) {
  const src = readFileSync(migrationTsPath, 'utf8');
  // Match the `to:` property value -- either single or double-quoted sha256 hash.
  const pattern = /(to:\s*['"])sha256:[0-9a-f]+(['"])/g;
  const matches = [...src.matchAll(pattern)];
  if (matches.length === 0) {
    throw new Error(
      `regen-extension-migrations: could not find 'to: ...' hash literal in ${migrationTsPath}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `regen-extension-migrations: found ${matches.length} 'to: ...' hash literals in ${migrationTsPath}; expected exactly 1`,
    );
  }
  const updated = src.replace(pattern, `$1${newHash}$2`);
  if (updated === src) {
    return false;
  }
  writeFileSync(migrationTsPath, updated, 'utf8');
  return true;
}

/**
 * Re-emit ops.json + migration.json for the given extension by running
 * `tsx <migrationTsPath>` with the extension package directory as cwd.
 */
function reemitMigrationArtifacts(extDir, migrationTsPath) {
  execFileSync(tsx, [migrationTsPath], {
    cwd: extDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

/**
 * Rewrite `migrations/refs/head.json`, replacing `hash` with `newHash`
 * and preserving the existing `invariants` array verbatim.
 */
function repinHeadRef(headRefPath, newHash) {
  const existing = readJson(headRefPath);
  const updated = { hash: newHash, invariants: existing.invariants };
  writeFileSync(headRefPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

/**
 * Sync `end-contract.{json,d.ts}` from `src/contract.{json,d.ts}` inside
 * the head migration directory.
 *
 * `src/contract.json` is emitted without a trailing newline; the on-disk
 * end-contract.json convention includes one. A trailing newline is added
 * if absent so idempotence holds on the first run.
 */
function syncEndContract(extDir, headMigrationDir) {
  for (const ext of ['json', 'd.ts']) {
    const src = join(extDir, 'src', `contract.${ext}`);
    const dest = join(headMigrationDir, `end-contract.${ext}`);
    const content = readFileSync(src, 'utf8');
    const normalized = content.endsWith('\n') ? content : `${content}\n`;
    writeFileSync(dest, normalized, 'utf8');
  }
}

/**
 * Process one extension directory. Returns `'skipped'` or `'updated'`;
 * throws on error.
 */
function processExtension(extDir) {
  const migrationsDir = join(extDir, 'migrations');
  if (!existsSync(migrationsDir)) {
    return 'skipped';
  }

  const contractJsonPath = join(extDir, 'src', 'contract.json');
  if (!existsSync(contractJsonPath)) {
    throw new Error(
      `regen-extension-migrations: ${extDir} has migrations/ but no src/contract.json`,
    );
  }

  const contractJson = readJson(contractJsonPath);
  const newHash = contractJson?.storage?.storageHash;
  if (typeof newHash !== 'string' || !newHash.startsWith('sha256:')) {
    throw new Error(
      `regen-extension-migrations: could not read storage.storageHash from ${contractJsonPath}`,
    );
  }

  const headRefPath = join(migrationsDir, 'refs', 'head.json');
  if (!existsSync(headRefPath)) {
    throw new Error(
      `regen-extension-migrations: expected ${headRefPath} to exist; cannot identify HEAD migration`,
    );
  }

  const headRef = readJson(headRefPath);
  const oldHash = headRef.hash;

  if (oldHash === newHash) {
    return 'skipped';
  }

  const headMigrationDir = findHeadMigrationDir(migrationsDir, oldHash);
  const migrationTsPath = join(headMigrationDir, 'migration.ts');
  if (!existsSync(migrationTsPath)) {
    throw new Error(`regen-extension-migrations: no migration.ts in ${headMigrationDir}`);
  }

  rewriteMigrationToHash(migrationTsPath, newHash);
  reemitMigrationArtifacts(extDir, migrationTsPath);
  repinHeadRef(headRefPath, newHash);
  syncEndContract(extDir, headMigrationDir);

  return 'updated';
}

function main() {
  let entries;
  try {
    entries = readdirSync(extensionsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    process.stderr.write(
      `regen-extension-migrations: cannot list ${extensionsDir}: ${err.message}\n`,
    );
    process.exit(1);
  }

  let errors = 0;
  for (const entry of entries) {
    const extDir = join(extensionsDir, entry.name);
    try {
      const result = processExtension(extDir);
      if (result === 'updated') {
        process.stdout.write(`regen-extension-migrations: updated ${entry.name}\n`);
      }
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      errors++;
    }
  }

  if (errors > 0) {
    process.exit(1);
  }
}

main();
