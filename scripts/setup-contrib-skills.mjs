#!/usr/bin/env node
// Installs the contributor agent-skills cluster into `.agents/skills/`
// (and the agent-specific symlinks) by invoking the local `skills` CLI
// against the tracked source of truth in `skills-contrib/`.
//
// Why this exists:
//   - The canonical home for contributor skills is `skills-contrib/` (tracked).
//   - Agent runtimes (Cursor, Claude Code, etc.) expect to find skills under
//     `.agents/skills/`, `.claude/skills/`, etc. Those locations are gitignored
//     and populated by this script.
//   - We dispatch through `skills add` so the materialized layout matches what
//     external consumers get from `npx skills add prisma/prisma-next/...`.
//
// The script is intentionally idempotent: re-running on `pnpm install`
// overwrites the install target without leaving stale cruft.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const contribRoot = resolve(repoRoot, 'skills-contrib');

if (!existsSync(contribRoot)) {
  // Repo is in a state where the source isn't present (e.g. partial clone).
  // No-op rather than fail the install.
  console.warn(
    `[setup-contrib-skills] ${contribRoot} not found; skipping contributor skill install.`,
  );
  process.exit(0);
}

if (process.env['PRISMA_NEXT_SKIP_CONTRIB_SKILLS'] === '1') {
  console.log('[setup-contrib-skills] PRISMA_NEXT_SKIP_CONTRIB_SKILLS=1 set; skipping.');
  process.exit(0);
}

// Pass an absolute path (not a `file://` URL): the upstream `skills` CLI
// treats absolute paths as local sources and discovers in-place, while
// `file://` URLs are routed through `git clone`, which fails on a
// non-repo subdirectory.
const args = ['exec', 'skills', 'add', contribRoot, '--all'];

const result = spawnSync('pnpm', args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, SKILLS_AGENT_AUTO: process.env['SKILLS_AGENT_AUTO'] ?? 'cursor-cli' },
});

// `skills add` exits non-zero if discovery finds nothing. We treat that as
// fatal because the tracked source dir is non-empty by construction.
if (result.status !== 0) {
  console.error(
    `[setup-contrib-skills] \`pnpm ${args.join(' ')}\` exited with status ${result.status}`,
  );
  process.exit(result.status ?? 1);
}
