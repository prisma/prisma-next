#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { text } from 'node:stream/consumers';

const hook = JSON.parse(await text(process.stdin));
const cwd = hook.cwd;

const checks = [
  { name: 'tests', command: 'pnpm test:packages' },
  { name: 'e2e', command: 'pnpm test:e2e' },
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'lint', command: 'pnpm lint' },
];

const failures = [];

for (const { name, command } of checks) {
  try {
    execSync(command, { cwd, stdio: 'pipe', timeout: 300_000 });
  } catch (err) {
    const output = err.stderr?.toString() || err.stdout?.toString() || '';
    const tail = output.split('\n').slice(-40).join('\n');
    failures.push({ name, output: tail });
  }
}

if (failures.length > 0) {
  const details = failures
    .map((f) => `--- ${f.name} ---\n${f.output}`)
    .join('\n\n');
  console.log(
    JSON.stringify({
      decision: 'block',
      reason: `Quality gate failed: ${failures.map((f) => f.name).join(', ')}. Fix the issues before finishing.\n\n${details}`,
    }),
  );
}
