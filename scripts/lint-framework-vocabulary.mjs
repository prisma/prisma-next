#!/usr/bin/env node
/**
 * CI ratchet for family/target vocabulary leaking into packages/1-framework.
 *
 * The framework domain is family-blind (no SQL/Mongo/target-specific
 * concepts). Terms like `nativeType` or `postgres` belong to the SQL family
 * and have repeatedly leaked into framework types via review misses.
 *
 * Counts forbidden-term occurrences (a regex/substring scan, not a compiler
 * diagnostic) at HEAD and at `git merge-base origin/main HEAD`, per scope
 * declared in lint-framework-vocabulary.config.json. Exits non-zero and
 * lists the new sites when a scope's count increases.
 *
 * Exit codes:
 *   0  — no scope's count increased (or skipped because HEAD == merge-base)
 *   1  — at least one scope's count increased; new sites printed to stderr
 *
 * The script uses process.cwd() as the git root (and reads its config
 * relative to that root) so tests can supply a temporary fixture repo by
 * setting cwd on the child process.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GIT_ROOT = process.cwd();
const CONFIG_PATH = join(GIT_ROOT, 'scripts', 'lint-framework-vocabulary.config.json');

export function isScannableFile(relPath) {
  if (!/\.(ts|tsx)$/.test(relPath)) return false;
  if (/\.test\.ts$/.test(relPath)) return false;
  if (/\.test-d\.ts$/.test(relPath)) return false;
  if (/(^|\/)test\//.test(relPath)) return false;
  if (/(^|\/)dist\//.test(relPath)) return false;
  return true;
}

export function findForbiddenHits(content, scope) {
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const haystack = scope.caseInsensitive ? rawLine.toLowerCase() : rawLine;
    for (const term of scope.forbidden) {
      const needle = scope.caseInsensitive ? term.toLowerCase() : term;
      if (haystack.includes(needle)) {
        hits.push({ line: i + 1, term, text: rawLine.trim() });
      }
    }
  }
  return hits;
}

export function hitKey(file, hit) {
  return `${file}:${hit.line}:${hit.term}`;
}

export function loadConfig(configPath) {
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

export function scanScope(scanDir, scope) {
  const listing = git(scanDir, 'ls-files', '--', scope.path);
  const files = listing.split('\n').filter(Boolean).filter(isScannableFile);

  const hits = [];
  for (const relPath of files) {
    let content;
    try {
      content = readFileSync(join(scanDir, relPath), 'utf-8');
    } catch {
      continue;
    }
    for (const hit of findForbiddenHits(content, scope)) {
      hits.push({ file: relPath, ...hit });
    }
  }
  return hits;
}

function main() {
  try {
    git(GIT_ROOT, 'rev-parse', 'origin/main');
  } catch {
    console.error('lint:framework-vocabulary: error — origin/main is not available.');
    console.error('  Run: git fetch --no-tags origin main:refs/remotes/origin/main');
    console.error('  Or ensure the CI checkout uses fetch-depth: 0.');
    process.exit(1);
  }

  const head = git(GIT_ROOT, 'rev-parse', 'HEAD');
  const mergeBase = git(GIT_ROOT, 'merge-base', 'origin/main', 'HEAD');

  if (head === mergeBase) {
    console.log(
      'lint:framework-vocabulary: HEAD is at merge-base with origin/main — no branch diff to ratchet. Skipping.',
    );
    process.exit(0);
  }

  const config = loadConfig(CONFIG_PATH);

  const headHitsByScope = config.scopes.map((scope) => scanScope(GIT_ROOT, scope));

  const tmpDir = mkdtempSync(join(tmpdir(), 'lint-framework-vocabulary-'));
  let baseHitsByScope;
  try {
    git(GIT_ROOT, 'worktree', 'add', '--detach', tmpDir, mergeBase);
    baseHitsByScope = config.scopes.map((scope) => scanScope(tmpDir, scope));
  } finally {
    try {
      git(GIT_ROOT, 'worktree', 'remove', '--force', tmpDir);
    } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  }

  let anyIncrease = false;

  config.scopes.forEach((scope, i) => {
    const headHits = headHitsByScope[i];
    const baseHits = baseHitsByScope[i];
    const delta = headHits.length - baseHits.length;
    const sign = delta > 0 ? '+' : '';
    console.log(
      `lint:framework-vocabulary: scope=${scope.path} current=${headHits.length} merge-base=${baseHits.length} delta=${sign}${delta}`,
    );

    if (delta > 0) {
      anyIncrease = true;
      const baseKeys = new Set(baseHits.map((h) => hitKey(h.file, h)));
      const newHits = headHits.filter((h) => !baseKeys.has(hitKey(h.file, h)));
      console.error(
        `lint:framework-vocabulary: ${delta} new forbidden vocabulary occurrence(s) in ${scope.path}. The framework domain is family-blind — move family-specific concepts (${scope.forbidden.join(', ')}) out of it:`,
      );
      for (const hit of newHits) {
        console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
      }
    }
  });

  if (anyIncrease) process.exit(1);
}

if (process.argv[1] === import.meta.filename) main();
