#!/usr/bin/env node
/**
 * Mirror `.agents/rules/*.mdc` into `.cursor/rules/` as symlinks.
 *
 * Source of truth for vendor-neutral, team-shared rule cards is `.agents/rules/`
 * (committed). Cursor only discovers project rules under `.cursor/rules/`
 * (gitignored, see https://cursor.com/help/customization/rules), so a fresh
 * checkout has no rules visible to Cursor until this script runs.
 *
 * Usage:
 *   node scripts/sync-rules.mjs           # create/repair missing symlinks
 *   node scripts/sync-rules.mjs --check   # exit 1 if any are missing/wrong (CI)
 *   node scripts/sync-rules.mjs --quiet   # suppress per-file output on success
 *
 * Behavior:
 *   - For each `.agents/rules/<name>.mdc`, ensure `.cursor/rules/<name>.mdc`
 *     is a symlink pointing to `../../.agents/rules/<name>.mdc`.
 *   - If the target is a symlink with the wrong destination, repair it.
 *   - If the target is a regular file, leave it alone and warn (a teammate may
 *     have a local override; resolving the conflict is a manual choice).
 *   - Files in `.cursor/rules/` not sourced from `.agents/rules/` are ignored
 *     (Cursor-only rules coexist alongside the symlinked ones).
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SOURCE_DIR = join(ROOT, '.agents/rules');
const TARGET_DIR = join(ROOT, '.cursor/rules');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const quiet = args.has('--quiet');

function log(line) {
  if (!quiet) console.log(line);
}

function expectedLinkTarget(name) {
  return relative(TARGET_DIR, join(SOURCE_DIR, name));
}

function sourceFiles() {
  if (!existsSync(SOURCE_DIR)) return [];
  return readdirSync(SOURCE_DIR).filter((f) => /\.mdc$/i.test(f));
}

function ensureTargetDir() {
  if (existsSync(TARGET_DIR)) return;
  if (checkOnly) return;
  mkdirSync(TARGET_DIR, { recursive: true });
  log(`created ${relative(ROOT, TARGET_DIR)}/`);
}

function classify(targetPath, want) {
  let st;
  try {
    st = lstatSync(targetPath);
  } catch {
    return 'missing';
  }
  if (st.isSymbolicLink()) {
    const have = readlinkSync(targetPath);
    if (have === want) return 'ok';
    return 'wrong-symlink';
  }
  if (st.isFile()) return 'regular-file';
  return 'other';
}

function syncOne(name) {
  const want = expectedLinkTarget(name);
  const targetPath = join(TARGET_DIR, name);
  const state = classify(targetPath, want);

  switch (state) {
    case 'ok':
      return { name, action: 'ok' };
    case 'missing':
      if (checkOnly) return { name, action: 'would-link', want };
      symlinkSync(want, targetPath);
      log(`linked ${name}`);
      return { name, action: 'linked' };
    case 'wrong-symlink':
      if (checkOnly) return { name, action: 'would-relink', want };
      unlinkSync(targetPath);
      symlinkSync(want, targetPath);
      log(`relinked ${name}`);
      return { name, action: 'relinked' };
    case 'regular-file':
      return { name, action: 'conflict-file' };
    default:
      return { name, action: 'conflict-other' };
  }
}

ensureTargetDir();

const results = sourceFiles().map(syncOne);

const conflicts = results.filter((r) => r.action.startsWith('conflict'));
const wouldChange = results.filter((r) => r.action.startsWith('would-'));

if (conflicts.length) {
  console.error(
    `\nWARNING: ${conflicts.length} target(s) in ${relative(ROOT, TARGET_DIR)}/ are not symlinks:`,
  );
  for (const c of conflicts) {
    console.error(`  - ${c.name} (${c.action.replace('conflict-', '')})`);
  }
  console.error(
    'Resolve manually: delete the local file to adopt the canonical .agents/rules/ version, or move the local file into .agents/rules/ to share it.',
  );
}

if (checkOnly && (wouldChange.length || conflicts.length)) {
  if (wouldChange.length) {
    console.error(
      '\n.cursor/rules/ is out of sync with .agents/rules/. Run `pnpm sync:rules` to fix.',
    );
    for (const w of wouldChange) {
      console.error(`  - ${w.name}: ${w.action}`);
    }
  }
  process.exit(1);
}

if (!quiet) {
  const linked = results.filter((r) => r.action === 'linked' || r.action === 'relinked').length;
  const ok = results.filter((r) => r.action === 'ok').length;
  log(`\n${ok} up-to-date, ${linked} updated, ${conflicts.length} conflict(s).`);
}
