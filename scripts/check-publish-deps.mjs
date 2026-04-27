#!/usr/bin/env node
// Publish-time CI gate (FR7.1).
//
// For every publishable package, packs the tarball that `pnpm publish` would
// upload to the registry and verifies the tarball's `package.json` contains
// no `workspace:*` or `catalog:` dependency specifiers in any dependency
// field. Such specifiers are pnpm-internal protocols and are meaningless
// (and typically install-breaking) for downstream npm/pnpm/yarn consumers.
//
// `pnpm publish` rewrites these protocols on its own, but `npm publish` and
// some CI flows do not. This gate catches the resulting leaks at publish
// time so the only fix is "use pnpm publish" rather than "release a broken
// package and patch it on the registry afterwards".
//
// Usage:
//   node scripts/check-publish-deps.mjs           — exit 1 on any leak
//   node scripts/check-publish-deps.mjs --json    — same, with JSON report
//
// Wired into `.github/workflows/publish.yml` immediately before the publish
// step. Also runnable locally: `pnpm check:publish-deps`.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEP_FIELDS = /** @type {const} */ ([
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]);

/**
 * Returns true if `spec` is a published-tarball-poisoning specifier
 * (`workspace:*`, `catalog:foo`, etc.). Both pnpm-internal protocols are
 * meaningless on the registry and break downstream installs.
 *
 * Exported so the unit test in
 * `test/scripts/check-publish-deps.test.mjs` can exercise the rule
 * without packing tarballs.
 */
export function isLeak(spec) {
  return typeof spec === 'string' && (spec.startsWith('workspace:') || spec.startsWith('catalog:'));
}

/**
 * Walks every dependency field on a package.json-shaped object and
 * returns the list of `(field, name, spec)` triples that
 * {@link isLeak} flags. Pure / side-effect-free; exported for tests.
 *
 * @param {Record<string, unknown>} pkgJson
 * @returns {Array<{ field: string; name: string; spec: string }>}
 */
export function findLeaks(pkgJson) {
  const leaks = [];
  for (const field of DEP_FIELDS) {
    const deps = pkgJson[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (isLeak(spec)) {
        leaks.push({ field, name, spec });
      }
    }
  }
  return leaks;
}

function readPackedManifest(tgzPath) {
  const out = execFileSync('tar', ['-xzOf', tgzPath, 'package/package.json'], {
    encoding: 'utf-8',
  });
  return JSON.parse(out);
}

function listPublishablePackageDirs() {
  const out = execFileSync('node', ['scripts/list-publishable-packages.mjs'], {
    encoding: 'utf-8',
  });
  return out
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ''));
}

/**
 * Packs every workspace package into `destDir`. Returns 0 on success and
 * a non-zero exit code on failure so the caller can release any temp
 * resources (notably the tmpdir used as `destDir`) before exiting.
 *
 * @param {string} destDir
 * @returns {number}
 */
export function packAll(destDir) {
  // Pack every workspace package in one shot. We over-pack (private
  // packages get tarballs too) but that's cheap and lets us avoid the
  // per-package invocation overhead. The gate filters down to publishables
  // when reading.
  const result = spawnSync(
    'pnpm',
    ['-r', '--workspace-concurrency=8', 'pack', '--pack-destination', destDir],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  if (result.status !== 0) {
    process.stderr.write(`\npnpm -r pack failed with exit code ${result.status}\n`);
    return result.status ?? 1;
  }
  return 0;
}

function tarballNameFor(pkgName, version) {
  // Mirrors pnpm pack's default naming: `<name>-<version>.tgz` with the
  // package's `/` rewritten to `-` and the leading scope `@` dropped.
  // (e.g. `@prisma-next/foo@1.2.3` → `prisma-next-foo-1.2.3.tgz`).
  return `${pkgName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

const DEFAULT_IO = {
  packAll,
  listPublishablePackageDirs,
  readPackedManifest,
  readPackageJson: (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')),
  readdirSync,
  mkdtemp: () => mkdtempSync(join(tmpdir(), 'pn-publish-check-')),
  rm: (path) => rmSync(path, { recursive: true, force: true }),
  stdoutWrite: (s) => process.stdout.write(s),
  stderrWrite: (s) => process.stderr.write(s),
};

/**
 * Runs the publish-deps gate. Pure with respect to its `io` seam — the
 * default uses `pnpm pack`, the workspace fs, and `process.{stdout,stderr}`,
 * but tests can stub each leg to exercise the failure-path cleanup
 * without packing real tarballs.
 *
 * Always returns a numeric exit code; the caller is responsible for the
 * single `process.exit(...)` so finally-blocks (here, tmpdir cleanup)
 * always run.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {Partial<typeof DEFAULT_IO>} [options.io]
 * @returns {number}
 */
export function runCheck({ argv = process.argv.slice(2), io = {} } = {}) {
  const {
    packAll: pack,
    listPublishablePackageDirs: listDirs,
    readPackedManifest: readPacked,
    readPackageJson,
    readdirSync: readDir,
    mkdtemp,
    rm,
    stdoutWrite,
    stderrWrite,
  } = { ...DEFAULT_IO, ...io };
  const args = new Set(argv);
  const json = args.has('--json');

  const dirs = listDirs();
  const dest = mkdtemp();

  try {
    stderrWrite(
      `Packing ${dirs.length} publishable packages (and any private workspace siblings) → ${dest}\n`,
    );
    const packExitCode = pack(dest);
    if (packExitCode !== 0) {
      return packExitCode;
    }

    const tarballs = new Set(readDir(dest).filter((f) => f.endsWith('.tgz')));
    /** @type {Array<{ pkg: string; tarball: string; leaks: ReturnType<typeof findLeaks> }>} */
    const offenders = [];

    for (const dir of dirs) {
      const sourcePkg = readPackageJson(dir);
      const tarballName = tarballNameFor(sourcePkg.name, sourcePkg.version);
      if (!tarballs.has(tarballName)) {
        stderrWrite(`warn: tarball not found for ${sourcePkg.name} (${tarballName})\n`);
        continue;
      }
      const packed = readPacked(join(dest, tarballName));
      const leaks = findLeaks(packed);
      if (leaks.length > 0) {
        offenders.push({ pkg: sourcePkg.name, tarball: tarballName, leaks });
      }
    }

    if (json) {
      stdoutWrite(`${JSON.stringify({ ok: offenders.length === 0, offenders }, null, 2)}\n`);
    } else if (offenders.length === 0) {
      stderrWrite(
        `\nOK — no workspace:* / catalog: leaks in ${dirs.length} publishable packages.\n`,
      );
    } else {
      stderrWrite(
        `\nFAIL — ${offenders.length} publishable package(s) leak workspace:* / catalog: into the published tarball:\n`,
      );
      for (const o of offenders) {
        stderrWrite(`\n  ${o.pkg}\n`);
        for (const l of o.leaks) {
          stderrWrite(`    ${l.field}.${l.name} = ${l.spec}\n`);
        }
      }
      stderrWrite(
        '\nPublish via `pnpm publish` (which rewrites these specifiers) rather than `npm publish`,\n' +
          'or convert the offending dependency to a real version range.\n',
      );
    }

    return offenders.length === 0 ? 0 : 1;
  } finally {
    rm(dest);
  }
}

export function main() {
  return runCheck();
}

// Only run `main` when invoked directly. Importing the module from a unit
// test (or any other tool) gets you the pure helpers (`findLeaks`,
// `isLeak`) without packing every workspace tarball.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
