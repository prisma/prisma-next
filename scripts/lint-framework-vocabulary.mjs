#!/usr/bin/env node
/**
 * Committed high-water-mark threshold for family/target vocabulary leaking
 * into packages/1-framework.
 *
 * The framework domain is family-blind (no SQL/Mongo/target-specific
 * concepts). Terms like `nativeType` or `postgres` belong to the SQL family
 * and have repeatedly leaked into framework types via review misses.
 *
 * Counts forbidden-term occurrences (identifier-token matching, not a
 * compiler diagnostic) at HEAD, per scope declared in
 * lint-framework-vocabulary.config.json, and compares the count against a
 * `threshold` recorded in that same config:
 *
 *   - count > threshold — new vocabulary was introduced; fail, and tell the
 *     author to remove it.
 *   - count < threshold — the scope improved; fail, and tell the author to
 *     lower the recorded threshold to lock in the reduction.
 *   - count === threshold — pass.
 *
 * There is no git merge-base or temporary worktree involved — the threshold
 * is just a number checked into the config, so the check works from any
 * checkout (shallow, detached, no origin/main) and the count may only ever
 * shrink over time.
 *
 * Exit codes:
 *   0 — every scope's count equals its recorded threshold
 *   1 — at least one scope's count differs from its threshold
 *
 * The script uses process.cwd() as the git root (and reads its config
 * relative to that root) so tests can supply a temporary fixture repo by
 * setting cwd on the child process.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GIT_ROOT = process.cwd();
const CONFIG_PATH = join(GIT_ROOT, 'scripts', 'lint-framework-vocabulary.config.json');

export function isScannableFile(relPath) {
  if (!/\.(ts|tsx)$/.test(relPath)) return false;
  if (/\.test\.tsx?$/.test(relPath)) return false;
  if (/\.test-d\.tsx?$/.test(relPath)) return false;
  if (/(^|\/)test\//.test(relPath)) return false;
  if (/(^|\/)dist\//.test(relPath)) return false;
  return true;
}

// Split a line into lowercase identifier tokens: break camelCase/digit→upper humps, split on non-alphanumerics.
export function tokenize(line) {
  return line
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

export function termTokens(term) {
  return tokenize(term);
}

// A line token matches a term token if equal, or equal with a trailing plural 's'.
function tokenMatches(lineToken, termToken) {
  return lineToken === termToken || lineToken === `${termToken}s`;
}

// True if the term's token sequence appears as a consecutive subsequence of the line's tokens.
export function lineMatchesTermTokens(lineTokens, tt) {
  for (let i = 0; i + tt.length <= lineTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < tt.length; j++) {
      if (!tokenMatches(lineTokens[i + j], tt[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

// Distinct matching lines. Each returned entry is one line (counted once even if several terms match it).
export function findMatchingLines(content, scope) {
  const termSeqs = scope.forbidden.map(termTokens);
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineTokens = tokenize(lines[i]);
    const matched = [];
    for (let k = 0; k < termSeqs.length; k++) {
      if (lineMatchesTermTokens(lineTokens, termSeqs[k])) matched.push(scope.forbidden[k]);
    }
    if (matched.length > 0) out.push({ line: i + 1, terms: matched, text: lines[i].trim() });
  }
  return out;
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

  const records = [];
  for (const relPath of files) {
    let content;
    try {
      content = readFileSync(join(scanDir, relPath), 'utf-8');
    } catch {
      continue;
    }
    for (const match of findMatchingLines(content, scope)) {
      records.push({ file: relPath, ...match });
    }
  }
  return records;
}

function main() {
  const config = loadConfig(CONFIG_PATH);
  const list = process.argv.slice(2).includes('--list');

  let anyFailed = false;

  for (const scope of config.scopes) {
    const records = scanScope(GIT_ROOT, scope);
    const count = records.length;
    const threshold = scope.threshold;

    console.log(
      `lint:framework-vocabulary: scope=${scope.path} count=${count} threshold=${threshold}`,
    );

    if (list) {
      for (const record of records) {
        console.log(`  ${record.file}:${record.line}: [${record.terms.join(', ')}] ${record.text}`);
      }
    }

    if (count > threshold) {
      anyFailed = true;
      console.error(
        `lint:framework-vocabulary: ${count - threshold} new family/target-vocabulary line(s) in ${scope.path}.`,
      );
      console.error(
        '  The framework domain is family-blind — move the new SQL/Mongo/target concept out of it.',
      );
      console.error(`  Find your additions: git diff origin/main -- ${scope.path}`);
      console.error('  List all current sites: node scripts/lint-framework-vocabulary.mjs --list');
      console.error(
        `  If genuinely unavoidable, raise "threshold" to ${count} in scripts/lint-framework-vocabulary.config.json with justification in review.`,
      );
    } else if (count < threshold) {
      anyFailed = true;
      console.error(
        `lint:framework-vocabulary: scope=${scope.path} improved (count=${count} < threshold=${threshold}).`,
      );
      console.error(
        `  Lower "threshold" to ${count} in scripts/lint-framework-vocabulary.config.json to lock in the reduction.`,
      );
    }
  }

  if (anyFailed) process.exit(1);
}

if (process.argv[1] === import.meta.filename) main();
