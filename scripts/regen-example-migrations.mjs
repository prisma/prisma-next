#!/usr/bin/env node
/**
 * Regenerates migration metadata for example-app chains that carry on-disk
 * contract snapshots (start-contract / end-contract). Unlike extension-package
 * migrations, example-app migrations form multi-step chains, so the script
 * walks each chain in order and re-derives every contract snapshot from its
 * per-migration PSL source file (`contract.prisma` inside each migration dir).
 *
 * For each migration directory in chain order the script:
 *
 *   1. Writes a temporary `.prisma-next-regen.config.ts` inside the migration
 *      dir that imports the example's real `prisma-next.config.ts` and
 *      overrides only the `contract` field to point at the migration's
 *      `contract.prisma`. This keeps `extensions`, `db`, and `family` correct
 *      for every family without any per-family template.
 *   2. Runs `prisma-next contract emit --config <tmp-config> --output-path <dir>`
 *      to emit fresh `contract.json` + `contract.d.ts` for that migration's
 *      end state, then renames both to `end-contract.*`.
 *   3. For non-baseline migrations: copies the predecessor's freshly-emitted
 *      `end-contract.{json,d.ts}` to this migration's `start-contract.{json,d.ts}`.
 *   4. Rewrites the `from:` and `to:` hash literals in `migration.ts` to
 *      the newly-emitted hashes so the migration re-emits correct metadata.
 *   5. Runs `tsx migration.ts` from the example package root to regenerate
 *      `ops.json` + `migration.json`. NOTE: `migration.ts` carries its
 *      operations as a static `override get operations()` getter; this step
 *      SERIALIZES that getter — it does NOT call `MigrationPlanner.plan()`.
 *      So this regen (and `fixtures:check`) does not re-derive or gate planner
 *      output; a planner change is invisible here. Prove planner-op parity via
 *      the planner suites + `migration plan` e2e + a golden diff of real
 *      `plan()` output vs these committed ops. See
 *      `docs/onboarding/fixtures-emit-and-check.md`.
 *   6. Biome-formats all touched JSON files via stdin (bypassing biome's
 *      `files.includes` exclusion globs — same technique as
 *      `regen-extension-migrations.mjs`; see that file's JSDoc for rationale).
 *
 * Idempotence: on a second run with no schema changes the emitted contracts are
 * byte-identical to the ones on disk (after biome formatting on the first run),
 * so the hash rewrites are no-ops, `migration.ts` is not touched, and the tsx
 * re-run produces no diff.
 *
 * Usage:
 *   node scripts/regen-example-migrations.mjs
 *
 * Adding a new example chain: add an entry to the CHAINS array below.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const biome = join(repoRoot, 'node_modules', '.bin', 'biome');

// Some example configs guard against a missing DATABASE_URL at module load time.
// Contract emit and migration serialization don't actually connect to the DB, but
// the config module must be importable. Pass a fallback so those guards don't throw.
const childEnv = {
  ...process.env,
  DATABASE_URL:
    process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/postgres',
};

/**
 * One entry per example-app migration chain to regenerate.
 *
 * exampleDir      — path to the example package root, relative to repoRoot.
 * migrationsDir   — path to the namespace chain directory, relative to exampleDir.
 * realConfigPath  — path to the example's real `prisma-next.config.ts`, relative
 *                   to repoRoot. The temp config imports this and overrides only
 *                   the `contract` field, so `extensions`, `db`, and `family` are
 *                   always correct by construction.
 * contractFamily  — which contract provider to use when overriding the `contract`
 *                   field in the temp config. `'mongo'` uses `mongoContract` from
 *                   `@prisma-next/mongo-contract-psl/provider`; `'sql'` uses
 *                   `prismaContract` from `@prisma-next/sql-contract-psl/provider`
 *                   together with the postgres target pack and namespace factory.
 *                   Defaults to `'mongo'` when omitted (backward-compat shim so
 *                   existing entries without the field continue to work).
 */
const CHAINS = [
  {
    exampleDir: 'examples/retail-store',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/retail-store/prisma-next.config.ts',
    contractFamily: 'mongo',
  },
  {
    exampleDir: 'examples/mongo-demo',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/mongo-demo/prisma-next.config.ts',
    contractFamily: 'mongo',
  },
  {
    exampleDir: 'examples/prisma-next-demo',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/prisma-next-demo/prisma-next.config.ts',
    contractFamily: 'sql',
  },
  {
    exampleDir: 'examples/prisma-next-postgis-demo',
    migrationsDir: 'migrations/app',
    realConfigPath: 'examples/prisma-next-postgis-demo/prisma-next.config.ts',
    contractFamily: 'sql',
  },
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Format a file through `biome format --stdin-file-path <basename>` and write
 * the result back in place.
 *
 * Using stdin bypasses biome's `files.includes` exclusion globs (which exclude
 * migration.json, ops.json, end-contract.json, and *.d.ts from the normal
 * check/format pass) while still applying the project's formatter settings
 * (lineWidth, indentStyle, trailing newline, etc.). The result is
 * byte-identical to what biome would produce if the file were not excluded.
 */
function biomeFormatInPlace(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const formatted = execFileSync(biome, ['format', '--stdin-file-path', basename(filePath)], {
    input: content,
    encoding: 'utf8',
    cwd: repoRoot,
  });
  writeFileSync(filePath, formatted, 'utf8');
}

/**
 * Rewrite storage-hash literals (bare lowercase sha-256 hex) in a `migration.ts` file.
 *
 * `newFromHash` is null for baseline migrations (whose `from:` is `null`).
 * For non-baseline migrations both `from:` and `to:` are updated.
 *
 * New-shape migrations (post TML-2892) carry no hash literals: they import the
 * committed `end-contract.json` / `start-contract.json` and the `Migration` base
 * derives `describe()`'s from/to from those JSONs' `storage.storageHash`. The
 * regen pipeline re-emits those contract JSONs upstream of this call, so for the
 * new shape there is nothing to rewrite here — the correct hashes already live
 * in the regenerated JSON. Detect that shape (`endContractJson = endContract`
 * with no `to: '<hex>'` literal) and skip the rewrite.
 *
 * Returns true if the file was changed, false if the hashes were already
 * up-to-date (or the file is the new contract-JSON shape).
 */
function rewriteMigrationHashes(migrationTsPath, newFromHash, newToHash) {
  const src = readFileSync(migrationTsPath, 'utf8');

  const toPattern = /(to:\s*['"])(?:[0-9a-f]{64}|empty)(['"])/g;
  const isContractJsonShape =
    src.includes('endContractJson = endContract') && [...src.matchAll(toPattern)].length === 0;
  if (isContractJsonShape) {
    // The from/to identity is derived by the base from the (already-regenerated)
    // contract JSON; no literal to rewrite in migration.ts.
    return false;
  }

  let updated = src;

  if (newFromHash !== null) {
    const fromPattern = /(from:\s*['"])(?:[0-9a-f]{64}|empty)(['"])/g;
    const fromMatches = [...src.matchAll(fromPattern)];
    if (fromMatches.length === 0) {
      throw new Error(`regen-example-migrations: no 'from: <hash>' literal in ${migrationTsPath}`);
    }
    if (fromMatches.length > 1) {
      throw new Error(
        `regen-example-migrations: ${fromMatches.length} 'from: <hash>' literals in ${migrationTsPath}; expected 1`,
      );
    }
    updated = updated.replace(fromPattern, `$1${newFromHash}$2`);
  }

  const toMatches = [...updated.matchAll(toPattern)];
  if (toMatches.length === 0) {
    throw new Error(`regen-example-migrations: no 'to: <hash>' literal in ${migrationTsPath}`);
  }
  if (toMatches.length > 1) {
    throw new Error(
      `regen-example-migrations: ${toMatches.length} 'to: <hash>' literals in ${migrationTsPath}; expected 1`,
    );
  }
  updated = updated.replace(toPattern, `$1${newToHash}$2`);

  if (updated === src) {
    return false;
  }
  writeFileSync(migrationTsPath, updated, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Per-migration and per-chain logic
// ---------------------------------------------------------------------------

/**
 * Build the TypeScript source for the temporary regen config.
 *
 * For mongo chains the override uses `mongoContract(schemaPath)`.
 * For sql chains it uses `prismaContract(schemaPath, { target, createNamespace })`
 * — the same options the postgres `defineConfig` helper passes — so the emitted
 * contract is identical in shape to what the real config would produce.
 *
 * @param {string} schemaSrc        - Absolute path to the migration's contract.prisma.
 * @param {string} realConfigAbsPath - Absolute path to the example's real config file.
 * @param {'mongo'|'sql'} contractFamily - Which provider to use.
 * @returns {string} TypeScript source for the temp config.
 */
function buildTempConfigSource(schemaSrc, realConfigAbsPath, contractFamily) {
  if (contractFamily === 'sql') {
    return (
      `import { prismaContract } from '@prisma-next/sql-contract-psl/provider';\n` +
      `import postgresPackRef from '@prisma-next/target-postgres/pack';\n` +
      `import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';\n` +
      `import realConfig from '${realConfigAbsPath}';\n\n` +
      'export default {\n' +
      '  ...realConfig,\n' +
      `  contract: prismaContract('${schemaSrc}', {\n` +
      '    target: postgresPackRef,\n' +
      '    createNamespace: postgresCreateNamespace,\n' +
      '  }),\n' +
      '};\n'
    );
  }
  // Default: mongo
  return (
    `import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';\n` +
    `import realConfig from '${realConfigAbsPath}';\n\n` +
    'export default {\n' +
    '  ...realConfig,\n' +
    `  contract: mongoContract('${schemaSrc}'),\n` +
    '};\n'
  );
}

/**
 * Emit the contract from a migration dir's `contract.prisma`.
 *
 * A temporary config file is written into `migrationDir`, used for the emit
 * call, and deleted immediately after. It imports the example's real
 * `prisma-next.config.ts` and overrides only the `contract` field to point at
 * the migration's `contract.prisma` (using an absolute path so resolution is
 * independent of where the temp file sits). All other config (extensions, db,
 * family) comes from the real config unchanged.
 *
 * The emit produces `contract.json` + `contract.d.ts` inside `migrationDir`;
 * the caller renames them to `end-contract.*`.
 *
 * Returns the freshly-emitted storageHash.
 */
function emitMigrationContract(exampleDir, migrationDir, realConfigAbsPath, contractFamily) {
  const prismaNextBin = join(exampleDir, 'node_modules', '.bin', 'prisma-next');
  if (!existsSync(prismaNextBin)) {
    throw new Error(
      `regen-example-migrations: prisma-next not found at ${prismaNextBin}; run pnpm install`,
    );
  }

  const schemaSrc = join(migrationDir, 'contract.prisma');
  if (!existsSync(schemaSrc)) {
    throw new Error(
      `regen-example-migrations: no contract.prisma in ${migrationDir}. ` +
        'Each migration directory must contain a contract.prisma for its end state.',
    );
  }

  // The temp config imports the example's real config and overrides only the
  // contract path. Absolute paths for both imports ensure resolution is
  // independent of the temp file's location.
  const tmpConfigPath = join(migrationDir, '.prisma-next-regen.config.ts');
  const tmpConfig = buildTempConfigSource(schemaSrc, realConfigAbsPath, contractFamily ?? 'mongo');

  writeFileSync(tmpConfigPath, tmpConfig, 'utf8');

  let emitOutput;
  try {
    emitOutput = execFileSync(
      prismaNextBin,
      ['contract', 'emit', '--config', tmpConfigPath, '--output-path', migrationDir, '--quiet'],
      { cwd: exampleDir, encoding: 'utf8', env: childEnv },
    );
  } finally {
    try {
      unlinkSync(tmpConfigPath);
    } catch {
      // best-effort cleanup; don't mask the original error
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(emitOutput);
  } catch {
    throw new Error(
      `regen-example-migrations: prisma-next emit produced non-JSON output for ${migrationDir}:\n${emitOutput}`,
    );
  }

  const storageHash = parsed?.storageHash;
  if (typeof storageHash !== 'string' || !/^(?:[0-9a-f]{64}|empty)$/.test(storageHash)) {
    throw new Error(
      `regen-example-migrations: emit output missing storageHash for ${migrationDir}:\n${emitOutput}`,
    );
  }

  return storageHash;
}

/**
 * Process a single migration directory.
 *
 * @param {string}        exampleDir         - Absolute path to the example package root.
 * @param {string}        migrationDir       - Absolute path to this migration dir.
 * @param {string|null}   prevEndDir         - Predecessor migration dir (null for baseline).
 * @param {string|null}   prevHash           - Predecessor's freshly-emitted storageHash (null for baseline).
 * @param {string}        realConfigAbsPath  - Absolute path to the example's real config file.
 * @param {'mongo'|'sql'} contractFamily     - Which contract provider to use.
 * @returns {string} The freshly-emitted storageHash for this migration's end state.
 */
function processMigration(
  exampleDir,
  migrationDir,
  prevEndDir,
  prevHash,
  realConfigAbsPath,
  contractFamily,
) {
  const newHash = emitMigrationContract(
    exampleDir,
    migrationDir,
    realConfigAbsPath,
    contractFamily,
  );

  // Rename contract.{json,d.ts} → end-contract.{json,d.ts}
  for (const ext of ['json', 'd.ts']) {
    const emitted = join(migrationDir, `contract.${ext}`);
    const dest = join(migrationDir, `end-contract.${ext}`);
    if (!existsSync(emitted)) {
      throw new Error(`regen-example-migrations: emit did not produce ${emitted}`);
    }
    renameSync(emitted, dest);
  }

  // Normalise trailing newline on end-contract.json then biome-format it
  const endContractJsonPath = join(migrationDir, 'end-contract.json');
  const endContractJson = readFileSync(endContractJsonPath, 'utf8');
  if (!endContractJson.endsWith('\n')) {
    writeFileSync(endContractJsonPath, `${endContractJson}\n`, 'utf8');
  }
  biomeFormatInPlace(endContractJsonPath);

  // Copy predecessor's end-contract to this migration's start-contract
  if (prevEndDir !== null) {
    for (const ext of ['json', 'd.ts']) {
      copyFileSync(
        join(prevEndDir, `end-contract.${ext}`),
        join(migrationDir, `start-contract.${ext}`),
      );
    }
  }

  // Rewrite from:/to: hashes in migration.ts
  const migrationTsPath = join(migrationDir, 'migration.ts');
  if (!existsSync(migrationTsPath)) {
    throw new Error(`regen-example-migrations: no migration.ts in ${migrationDir}`);
  }
  rewriteMigrationHashes(migrationTsPath, prevHash, newHash);

  // Re-run tsx migration.ts to regenerate ops.json + migration.json
  const tsx = join(exampleDir, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) {
    throw new Error(`regen-example-migrations: tsx not found at ${tsx}; run pnpm install`);
  }
  execFileSync(tsx, [migrationTsPath], {
    cwd: exampleDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: childEnv,
  });

  // Biome-format ops.json and migration.json
  for (const name of ['ops.json', 'migration.json']) {
    const p = join(migrationDir, name);
    if (existsSync(p)) {
      biomeFormatInPlace(p);
    }
  }

  return newHash;
}

/**
 * Walk all migration subdirectories of a chain in lexicographic order
 * (timestamped names are lexicographically chronological) and process each.
 */
function processChain(chain) {
  const exampleDir = resolve(repoRoot, chain.exampleDir);
  const chainDir = resolve(exampleDir, chain.migrationsDir);
  const realConfigAbsPath = resolve(repoRoot, chain.realConfigPath);

  let dirNames;
  try {
    dirNames = readdirSync(chainDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    throw new Error(`regen-example-migrations: cannot list directories in ${chainDir}`);
  }

  if (dirNames.length === 0) {
    process.stdout.write(`regen-example-migrations: no migration dirs in ${chainDir}\n`);
    return;
  }

  let prevEndDir = null;
  let prevHash = null;

  const contractFamily = chain.contractFamily ?? 'mongo';

  for (const dirName of dirNames) {
    const migrationDir = join(chainDir, dirName);
    prevHash = processMigration(
      exampleDir,
      migrationDir,
      prevEndDir,
      prevHash,
      realConfigAbsPath,
      contractFamily,
    );
    prevEndDir = migrationDir;
  }

  process.stdout.write(
    `regen-example-migrations: updated ${chain.exampleDir}/${chain.migrationsDir} (${dirNames.length} migrations)\n`,
  );
}

function main() {
  let errors = 0;
  for (const chain of CHAINS) {
    try {
      processChain(chain);
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
