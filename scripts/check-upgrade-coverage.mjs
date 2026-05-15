#!/usr/bin/env node
// Pre-publish + PR-CI gate for the upgrade-skill mechanism.
//
// Enforces two related invariants on every PR and every release:
//
//   1. Coverage. If the PR's (or release's) diff touches `examples/`,
//      the user-skill package must carry a matching upgrade-instructions
//      directory at
//      `packages/0-shared/upgrade-skill/upgrades/<M-1>-to-<M>/`. Same
//      for `packages/3-extensions/` and the extension-upgrade-skill.
//      `M` is the in-flight minor read from `package.json` on the
//      head ref.
//
//   2. New-entries-go-in-the-in-flight-directory. File *adds* under
//      either skill package's `upgrades/` tree must land in the
//      directory keyed to `<M-1>-to-<M>`. Modifications and removals
//      are unrestricted.
//
// Usage:
//   node scripts/check-upgrade-coverage.mjs [--mode pr|publish]
//                                           [--head <ref>] [--prev <ref>]
//                                           [--json]
//
// Wired into root `package.json` as `pnpm check:upgrade-coverage`.
// Invoked from `.github/workflows/ci.yml` (mode pr) and
// `.github/workflows/publish.yml` (mode publish).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, cwd, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const USER_SKILL_PKG = 'packages/0-shared/upgrade-skill';
const EXT_SKILL_PKG = 'packages/0-shared/extension-upgrade-skill';

// Generated artefacts at the publish surface: contract.json /
// contract.d.ts are regenerated mechanically from the schema, and
// end-contract.json / end-contract.d.ts mirror them for the
// post-migration state. A pure regenerate is not a "real" substrate
// diff and must not by itself demand an entry.
const GENERATED_BASENAMES = new Set([
  'contract.json',
  'contract.d.ts',
  'end-contract.json',
  'end-contract.d.ts',
]);

/**
 * Returns true if `path` (relative to repo root, posix slashes) is
 * one of the generated-and-thus-excluded artefacts the substrate
 * coverage check should ignore. The exclusion is scoped to
 * `examples/**` — only generated example artefacts are skipped.
 */
export function isGeneratedExamplePath(path) {
  if (!path.startsWith('examples/')) return false;
  const segments = path.split('/');
  const basename = segments[segments.length - 1];
  return GENERATED_BASENAMES.has(basename);
}

/**
 * Parse a `<major>.<minor>.<patch>[-<prerelease>]` version string into
 * `{ major, minor, patch }` (all numbers; pre-release suffix discarded).
 * Throws on malformed input.
 */
export function parseVersion(spec) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(spec);
  if (!match) {
    throw new Error(`unparseable version "${spec}"`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Returns the transition directory keyed to a minor bump from
 * `prev = <major>.<minor>` to `head = <major>.<minor + 1>` (or
 * across a major boundary). Used by the coverage sub-check, where
 * the "from" side is the previously-published version.
 */
export function transitionLabel(prev, head) {
  return `${prev.major}.${prev.minor}-to-${head.major}.${head.minor}`;
}

/**
 * The "in-flight" transition directory keyed to the head version
 * alone — `(headMinor - 1) → headMinor`. Used by the new-entries
 * sub-check, which enforces that *added* files under
 * `upgrades/<X>-to-<Y>/` have `Y` matching the head's minor.
 * When head crosses a major boundary (`headMinor === 0`), the
 * head version doesn't on its own name the previous minor, so we
 * fall back to using the prev version's minor as the "from" side.
 */
export function inFlightTransitionLabel(head, prev) {
  if (head.minor === 0) {
    return transitionLabel(prev, head);
  }
  return `${head.major}.${head.minor - 1}-to-${head.major}.${head.minor}`;
}

/**
 * Parse a path under `<pkg>/upgrades/<transition>/...` and return the
 * transition segment, or null if the path does not match.
 *
 * Example: `packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/foo.ts`
 *  → `'0.6-to-0.7'`
 */
export function parseTransitionFromPath(path) {
  const match =
    /^packages\/0-shared\/(?:upgrade-skill|extension-upgrade-skill)\/upgrades\/([^/]+)\//.exec(
      path,
    );
  return match ? match[1] : null;
}

function git(repoRoot, ...args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryGit(repoRoot, ...args) {
  try {
    return git(repoRoot, ...args).trim();
  } catch {
    return null;
  }
}

function readPackageJsonAtRef(repoRoot, ref) {
  const raw = git(repoRoot, 'show', `${ref}:package.json`);
  return JSON.parse(raw);
}

function diffPaths(repoRoot, prev, head, pathspecs, filter) {
  const args = ['diff', '--name-only', `${prev}..${head}`, '--'];
  args.push(...pathspecs);
  const out = git(repoRoot, ...args);
  const paths = out.split('\n').filter(Boolean);
  return filter ? paths.filter(filter) : paths;
}

function diffAddedPaths(repoRoot, prev, head, pathspecs) {
  const args = ['diff', '--name-only', '--diff-filter=A', `${prev}..${head}`, '--'];
  args.push(...pathspecs);
  const out = git(repoRoot, ...args);
  return out.split('\n').filter(Boolean);
}

function resolveDefaultPrev(repoRoot, mode) {
  if (mode === 'pr') {
    // Prefer `origin/main`; fall back to local `main` (some CI checkouts
    // don't preserve the `origin` remote name).
    const refs = ['origin/main', 'main'];
    for (const ref of refs) {
      if (tryGit(repoRoot, 'rev-parse', '--verify', `${ref}^{commit}`)) {
        return ref;
      }
    }
    throw new Error(
      'check-upgrade-coverage: --mode pr default --prev requires either `origin/main` or `main` to exist; pass --prev <ref> explicitly',
    );
  }
  // mode publish — fall back to the most recent `v[0-9]*` annotated tag.
  const tag = tryGit(repoRoot, 'describe', '--abbrev=0', '--tags', '--match', 'v[0-9]*');
  if (tag) return tag;
  throw new Error(
    'check-upgrade-coverage: --mode publish default --prev requires a `v[0-9]*` git tag; pass --prev <ref> explicitly',
  );
}

/**
 * Parse the supported CLI arguments. Exported for unit tests.
 */
export function parseArgs(args) {
  const out = { mode: 'pr', head: 'HEAD', prev: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') {
      out.mode = args[++i];
    } else if (arg === '--head') {
      out.head = args[++i];
    } else if (arg === '--prev') {
      out.prev = args[++i];
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`check-upgrade-coverage: unknown argument "${arg}"`);
    }
  }
  if (out.mode !== 'pr' && out.mode !== 'publish') {
    throw new Error(`check-upgrade-coverage: --mode must be "pr" or "publish" (got "${out.mode}")`);
  }
  return out;
}

/**
 * Run the check. Returns `{ ok, violations }`; the caller is
 * responsible for deciding how to render the result (text vs JSON)
 * and for `process.exit`.
 */
export function runCheck({ repoRoot, mode, head, prev }) {
  const headVersion = parseVersion(readPackageJsonAtRef(repoRoot, head).version);
  const prevVersion = parseVersion(readPackageJsonAtRef(repoRoot, prev).version);

  const headMinor = `${headVersion.major}.${headVersion.minor}`;
  const prevMinor = `${prevVersion.major}.${prevVersion.minor}`;
  // Coverage sub-check uses the *publish* transition (prev → head):
  // the entry must explain how to traverse exactly what is shipping.
  // New-entries sub-check uses the *in-flight* transition (purely a
  // function of head): the in-flight directory is keyed to the
  // current minor, irrespective of whether prev was the immediate
  // predecessor.
  const coverageTransition = transitionLabel(prevVersion, headVersion);
  const inflightTransition = inFlightTransitionLabel(headVersion, prevVersion);
  const sameMinor = headMinor === prevMinor;

  const violations = [];

  if (!sameMinor) {
    const examplesDiff = diffPaths(
      repoRoot,
      prev,
      head,
      ['examples/'],
      (path) => !isGeneratedExamplePath(path),
    );
    if (examplesDiff.length > 0) {
      const requiredDir = `${USER_SKILL_PKG}/upgrades/${coverageTransition}`;
      if (!existsSync(`${repoRoot}/${requiredDir}`)) {
        violations.push({
          rule: 'coverage',
          substrate: 'examples/',
          requiredDir,
          sampleDiffPaths: examplesDiff.slice(0, 5),
        });
      }
    }

    const extDiff = diffPaths(
      repoRoot,
      prev,
      head,
      ['packages/3-extensions/'],
      (path) => !isGeneratedExamplePath(path),
    );
    if (extDiff.length > 0) {
      const requiredDir = `${EXT_SKILL_PKG}/upgrades/${coverageTransition}`;
      if (!existsSync(`${repoRoot}/${requiredDir}`)) {
        violations.push({
          rule: 'coverage',
          substrate: 'packages/3-extensions/',
          requiredDir,
          sampleDiffPaths: extDiff.slice(0, 5),
        });
      }
    }
  }

  const adds = diffAddedPaths(repoRoot, prev, head, [
    `${USER_SKILL_PKG}/upgrades/`,
    `${EXT_SKILL_PKG}/upgrades/`,
  ]);
  for (const path of adds) {
    const transitionInPath = parseTransitionFromPath(path);
    if (transitionInPath === null) continue; // not under a transition dir
    if (transitionInPath !== inflightTransition) {
      violations.push({
        rule: 'new-entries-in-in-flight',
        path,
        observedTransition: transitionInPath,
        expectedTransition: inflightTransition,
      });
    }
  }

  return {
    ok: violations.length === 0,
    coverageSkipped: sameMinor,
    headMinor,
    prevMinor,
    coverageTransition,
    inflightTransition,
    violations,
  };
}

function renderViolations(result, write) {
  write(
    `check-upgrade-coverage: ${result.violations.length} violation(s) (${result.prevMinor} → ${result.headMinor})\n`,
  );
  for (const v of result.violations) {
    if (v.rule === 'coverage') {
      write(
        `  [coverage] diff in ${v.substrate} requires an upgrade-instructions directory at\n` +
          `              ${v.requiredDir}/instructions.md\n`,
      );
      if (v.sampleDiffPaths.length > 0) {
        write('              sample paths from the diff:\n');
        for (const p of v.sampleDiffPaths) {
          write(`                ${p}\n`);
        }
      }
    } else if (v.rule === 'new-entries-in-in-flight') {
      write(
        `  [new-entries-in-in-flight] added ${v.path}\n` +
          `              transition is "${v.observedTransition}" but the in-flight transition is "${v.expectedTransition}"\n` +
          `              move the new file under packages/0-shared/<skill>/upgrades/${v.expectedTransition}/\n`,
      );
    }
  }
  write(
    '\nSee the in-repo `record-upgrade-instructions` skill for the authoring workflow:\n' +
      '  .agents/skills/record-upgrade-instructions/SKILL.md\n',
  );
}

export function main(args = argv.slice(2), repoRoot = cwd()) {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 2;
  }
  if (parsed.help) {
    stdout.write(
      [
        'Usage: node scripts/check-upgrade-coverage.mjs [--mode pr|publish] [--head <ref>] [--prev <ref>] [--json]',
        '',
        '  --mode    pr (default) or publish; selects the default --prev source',
        '  --head    git ref to inspect (default: HEAD)',
        '  --prev    git ref to compare against (default: origin/main for pr; most',
        '            recent v[0-9]* tag for publish)',
        '  --json    emit a JSON result envelope on stdout instead of text on stderr',
        '',
      ].join('\n'),
    );
    return 0;
  }
  const head = parsed.head;
  let prev = parsed.prev;
  try {
    if (prev === null) {
      prev = resolveDefaultPrev(repoRoot, parsed.mode);
    }
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 2;
  }
  let result;
  try {
    result = runCheck({ repoRoot, mode: parsed.mode, head, prev });
  } catch (err) {
    stderr.write(`check-upgrade-coverage: ${err.message}\n`);
    return 2;
  }
  if (parsed.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    return 0;
  }
  renderViolations(result, (s) => stderr.write(s));
  return 1;
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  exit(main());
}
