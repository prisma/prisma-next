#!/usr/bin/env node
// Materialises contributor agent skills into the locations agent runtimes
// read from, by symlinking the canonical source `skills-contrib/` into
// `.agents/skills/` and `.claude/skills/`.
//
// Why direct symlinks (not `skills add`):
//   - Upstream `skills add --all` deliberately installs to *every*
//     detected agent target, including ones that overlay our tracked
//     `skills/` user-facing directory (e.g. OpenClaw → `skills/`). That
//     pollutes the user-facing cluster with contributor skills.
//   - For local dev, agents read directly from their respective
//     directories. A single symlink per agent root is sufficient and
//     side-effect-free.
//
// External consumers go through the public install path
// (`npx skills add prisma/prisma-next/skills#v<version>`); they never
// run this script.

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const contribRoot = resolve(repoRoot, 'skills-contrib');

if (process.env['PRISMA_NEXT_SKIP_CONTRIB_SKILLS'] === '1') {
  console.log('[setup-contrib-skills] PRISMA_NEXT_SKIP_CONTRIB_SKILLS=1 set; skipping.');
  process.exit(0);
}

if (!existsSync(contribRoot)) {
  console.warn(
    `[setup-contrib-skills] ${contribRoot} not found; skipping contributor skill install.`,
  );
  process.exit(0);
}

const targets = [resolve(repoRoot, '.agents/skills'), resolve(repoRoot, '.claude/skills')];

for (const target of targets) {
  ensureSymlink(target, contribRoot);
}

console.log(
  `[setup-contrib-skills] linked ${relative(repoRoot, contribRoot)} → ` +
    targets.map((t) => relative(repoRoot, t)).join(', '),
);

/**
 * Atomic-ish symlink: replace anything currently at `target` with a
 * symlink to `source`. Idempotent on re-run.
 *
 * Special-cases: if `target` is already the desired symlink, leave it
 * alone so we don't churn mtimes on every `pnpm install`.
 */
function ensureSymlink(target, source) {
  const targetParent = dirname(target);
  mkdirSync(targetParent, { recursive: true });

  if (existsSync(target) || lstatExists(target)) {
    if (isSymlinkPointingTo(target, source)) {
      return;
    }
    rmSync(target, { recursive: true, force: true });
  }

  // Use a relative target for the symlink so the link is stable across
  // repo relocations (the absolute repo path will differ on each
  // contributor's machine).
  const linkBody = relative(targetParent, source);
  symlinkSync(linkBody, target, 'dir');
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isSymlinkPointingTo(target, source) {
  try {
    const stat = lstatSync(target);
    if (!stat.isSymbolicLink()) return false;
    const resolved = resolve(dirname(target), require('node:fs').readlinkSync(target));
    return resolved === source;
  } catch {
    return false;
  }
}
