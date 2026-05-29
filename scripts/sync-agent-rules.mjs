#!/usr/bin/env node
/**
 * Keeps agent rules consistently symlinked.
 *
 * Rules have a single canonical home: `.agents/rules/<name>.{md,mdc}` (the only
 * git-tracked copy). The harness-specific presentation trees `.cursor/rules`
 * and `.claude/rules` are git-ignored and contain nothing but relative symlinks
 * back into the canonical dir — exactly the model `skills add` uses for skills.
 *
 * Default mode consolidates any stray real-file rule found in a presentation
 * tree into the canonical dir, then (re)creates the symlinks and prunes dangling
 * ones. `--check` reports drift without touching the filesystem; it is the lint
 * gate that fails CI when a rule was added only to a presentation tree.
 */

import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const CANONICAL_DIR = '.agents/rules';
export const PRESENTATION_DIRS = ['.cursor/rules', '.claude/rules'];

const RULE_EXTENSIONS = ['.mdc', '.md'];

function isRuleFile(name) {
  return RULE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function listEntries(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function classify(fullPath) {
  let stat;
  try {
    stat = lstatSync(fullPath);
  } catch {
    return 'missing';
  }
  if (stat.isSymbolicLink()) {
    try {
      // statSync follows the link; throws if the target is missing.
      readFileSync(fullPath);
      return 'symlink';
    } catch {
      return 'dangling';
    }
  }
  return 'file';
}

function expectedTarget(root, presentationDir, name) {
  return relative(join(root, presentationDir), join(root, CANONICAL_DIR, name));
}

function symlinkTarget(fullPath) {
  // Read the literal link text without following it.
  try {
    return readlinkSync(fullPath);
  } catch {
    return null;
  }
}

/**
 * @param {{ root?: string, check?: boolean }} options
 * @returns {{ ok: boolean, drift: string[], actions: string[] }}
 */
export function syncAgentRules({ root = repoRoot, check = false } = {}) {
  const drift = [];
  const actions = [];

  const canonicalDir = join(root, CANONICAL_DIR);

  // 1. Consolidate stray real-file rules from presentation trees into canonical.
  for (const presentationDir of PRESENTATION_DIRS) {
    const dir = join(root, presentationDir);
    for (const name of listEntries(dir)) {
      if (!isRuleFile(name)) continue;
      const full = join(dir, name);
      if (classify(full) !== 'file') continue;

      const canonicalPath = join(canonicalDir, name);
      const strayBody = readFileSync(full, 'utf8');
      if (classify(canonicalPath) === 'file') {
        const canonicalBody = readFileSync(canonicalPath, 'utf8');
        if (canonicalBody !== strayBody) {
          throw new Error(
            `conflict: ${presentationDir}/${name} differs from canonical ${CANONICAL_DIR}/${name}; ` +
              'reconcile them by hand before syncing.',
          );
        }
      }

      if (check) {
        drift.push(
          `real-file rule in presentation tree: ${presentationDir}/${name} (move it to ${CANONICAL_DIR}/)`,
        );
        continue;
      }

      // unlinkSync removes the link/file itself; rmSync no-ops on a dangling symlink.
      if (classify(canonicalPath) === 'file') {
        unlinkSync(full);
      } else {
        mkdirSync(canonicalDir, { recursive: true });
        renameSync(full, canonicalPath);
        actions.push(`consolidated ${presentationDir}/${name} -> ${CANONICAL_DIR}/${name}`);
      }
    }
  }

  const canonicalRules = listEntries(canonicalDir)
    .filter((name) => isRuleFile(name) && classify(join(canonicalDir, name)) === 'file')
    .sort();
  const canonicalSet = new Set(canonicalRules);

  // 2. Ensure a correct relative symlink exists in each tree for each rule.
  for (const presentationDir of PRESENTATION_DIRS) {
    const dir = join(root, presentationDir);
    for (const name of canonicalRules) {
      const full = join(dir, name);
      const kind = classify(full);
      const want = expectedTarget(root, presentationDir, name);
      const have = symlinkTarget(full);

      if (kind === 'symlink' && have === want) continue;

      if (check) {
        drift.push(
          kind === 'missing'
            ? `missing symlink: ${presentationDir}/${name}`
            : `incorrect symlink: ${presentationDir}/${name} -> ${have ?? '(not a symlink)'} (expected ${want})`,
        );
        continue;
      }

      mkdirSync(dir, { recursive: true });
      if (kind !== 'missing') unlinkSync(full);
      symlinkSync(want, full);
      actions.push(`linked ${presentationDir}/${name} -> ${want}`);
    }
  }

  // 3. Prune dangling/orphan symlinks (target missing or no matching canonical rule).
  for (const presentationDir of PRESENTATION_DIRS) {
    const dir = join(root, presentationDir);
    for (const name of listEntries(dir)) {
      const full = join(dir, name);
      const kind = classify(full);
      const orphanRule = kind === 'symlink' && isRuleFile(name) && !canonicalSet.has(name);
      if (kind !== 'dangling' && !orphanRule) continue;

      if (check) {
        drift.push(
          `stale symlink: ${presentationDir}/${name} (no canonical ${CANONICAL_DIR}/${name})`,
        );
        continue;
      }
      unlinkSync(full);
      actions.push(`removed stale symlink ${presentationDir}/${name}`);
    }
  }

  return { ok: drift.length === 0, drift, actions };
}

function main() {
  const check = process.argv.includes('--check');
  let result;
  try {
    result = syncAgentRules({ check });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (check) {
    if (result.ok) {
      console.log('Agent rule symlinks are consistent.');
      return 0;
    }
    console.error('Agent rule symlink drift detected:\n');
    for (const item of result.drift) console.error(`  - ${item}`);
    console.error('\nRun `pnpm rules:sync` to fix.');
    return 1;
  }

  for (const action of result.actions) console.log(action);
  console.log(
    result.actions.length === 0
      ? 'Agent rule symlinks already in sync.'
      : `Synced agent rules (${result.actions.length} change(s)).`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
