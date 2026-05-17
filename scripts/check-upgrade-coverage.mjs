#!/usr/bin/env node
// Pre-publish + PR-CI gate for the upgrade-skill mechanism.
//
// Enforces two related invariants on every PR and every release.
// `package.json.version` on a given ref is the *currently published*
// version on that ref — the value `pnpm bump-minor` reads when
// preparing the next release. The "in-flight" transition is therefore
// `head.minor → head.minor + 1`: the directory where breaking-change
// entries authored on the current commit graph belong.
//
//   1. Coverage. If the diff between prev and head touches `examples/`,
//      the user-skill package must carry a matching upgrade-instructions
//      directory. Same for `packages/3-extensions/` and the
//      extension-upgrade-skill package. Two cases:
//        - PR mode (head.minor === prev.minor, no bump on the branch):
//          the diff is in-flight work; required directory is
//          `upgrades/<head.minor>-to-<head.minor + 1>/`.
//        - Publish mode (head.minor > prev.minor, bump landed): the
//          diff describes everything shipping in this release;
//          required directory is `upgrades/<prev.minor>-to-<head.minor>/`.
//
//   2. New-entries-go-in-the-current-or-in-flight-directory. File
//      *adds* under either skill package's `upgrades/` tree must land
//      in either the coverage directory (above) or the in-flight
//      directory keyed to head alone. Modifications and removals are
//      unrestricted, so old entries can be bug-fixed in place.
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

const USER_SKILL_PKG = 'skills/upgrade/prisma-next-upgrade';
const EXT_SKILL_PKG = 'skills/extension-author/prisma-next-extension-upgrade';

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
 * `prev = <major>.<minor>` to `head = <major>.<minor>` (or across a
 * major boundary). Used by the coverage sub-check in publish mode,
 * where the "from" side is the previously-published version and the
 * "to" side is the version being shipped.
 */
export function transitionLabel(prev, head) {
  return `${prev.major}.${prev.minor}-to-${head.major}.${head.minor}`;
}

/**
 * The "in-flight" transition directory keyed to the head version
 * alone — `head.minor → head.minor + 1`. Authoring of new
 * upgrade-instructions entries on a feature branch goes here:
 * `package.json` on the head ref reads the currently-published
 * version, so the next batch of breaking-change work targets one
 * minor up.
 */
export function inFlightTransitionLabel(head) {
  return `${head.major}.${head.minor}-to-${head.major}.${head.minor + 1}`;
}

/**
 * The directory the coverage sub-check expects to find for a
 * (prev, head) pair. In PR-mode steady-state (prev.minor === head.minor)
 * the substrate diff is in-flight work and belongs in the in-flight
 * directory. In publish mode (head.minor > prev.minor) the diff
 * describes the release being shipped and belongs in `prev → head`.
 */
export function coverageTransitionLabel(head, prev) {
  if (head.minor === prev.minor) {
    return inFlightTransitionLabel(head);
  }
  return transitionLabel(prev, head);
}

/**
 * Parse a path under `<skill-pkg>/upgrades/<transition>/...` and return
 * the transition segment, or null if the path does not match.
 *
 * Example: `skills/upgrade/prisma-next-upgrade/upgrades/0.7-to-0.8/foo.ts`
 *  → `'0.7-to-0.8'`
 */
export function parseTransitionFromPath(path) {
  const match =
    /^skills\/(?:upgrade\/prisma-next-upgrade|extension-author\/prisma-next-extension-upgrade)\/upgrades\/([^/]+)\//.exec(
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

function diffPaths(repoRoot, prev, head, pathspecs) {
  const args = ['diff', '--name-only', `${prev}..${head}`, '--'];
  args.push(...pathspecs);
  const out = git(repoRoot, ...args);
  return out.split('\n').filter(Boolean);
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
  const coverageTransition = coverageTransitionLabel(headVersion, prevVersion);
  const inflightTransition = inFlightTransitionLabel(headVersion);

  const violations = [];

  // Coverage check fires whenever the substrate diff is non-empty.
  // No carve-out for patch ranges, no carve-out for "regenerated"
  // artefacts. A consumer-facing diff is a consumer-facing diff —
  // record it. When the diff legitimately needs no consumer-side
  // action (e.g. internal-only change with incidental example
  // regeneration), the entry's `changes: []` placeholder shape says
  // exactly that and is cheap to ship.
  const examplesDiff = diffPaths(repoRoot, prev, head, ['examples/']);
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

  const extDiff = diffPaths(repoRoot, prev, head, ['packages/3-extensions/']);
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

  // New-entries rule: an added file may live in either the coverage
  // directory (the release this commit graph is preparing for, or the
  // release just shipped in publish mode) or the in-flight directory
  // (the next release after head). Anything in an older transition
  // directory is stale.
  const allowedTransitions = new Set([coverageTransition, inflightTransition]);
  const adds = diffAddedPaths(repoRoot, prev, head, [
    `${USER_SKILL_PKG}/upgrades/`,
    `${EXT_SKILL_PKG}/upgrades/`,
  ]);
  for (const path of adds) {
    const transitionInPath = parseTransitionFromPath(path);
    if (transitionInPath === null) continue; // not under a transition dir
    if (!allowedTransitions.has(transitionInPath)) {
      violations.push({
        rule: 'new-entries-stale-transition',
        path,
        observedTransition: transitionInPath,
        allowedTransitions: [...allowedTransitions],
      });
    }
  }

  return {
    ok: violations.length === 0,
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
    } else if (v.rule === 'new-entries-stale-transition') {
      write(
        `  [new-entries-stale-transition] added ${v.path}\n` +
          `              transition is "${v.observedTransition}" but only the following are accepted:\n` +
          `                ${v.allowedTransitions.join(', ')}\n` +
          '              move the new file under packages/0-shared/<skill>/upgrades/<one-of-the-above>/\n',
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
