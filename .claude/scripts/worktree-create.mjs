#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf-8'));

const name = input.name;
const cwd = input.cwd;

const dir = resolve(cwd, '.claude/worktrees', name);

execSync(`git worktree add -b "worktree/${name}" "${dir}" HEAD`, {
  stdio: 'ignore',
  cwd,
});
execSync('pnpm install', { stdio: 'ignore', cwd: dir });
execSync('pnpm build', {
  stdio: 'ignore',
  cwd: dir,
});

console.log(dir);
