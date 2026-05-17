/**
 * Regression guardrail for TML-2536.
 *
 * Runs `prisma-next migration plan` against the demo's checked-in
 * history and asserts the plan is a no-op (`ok: true`, `noOp: true`,
 * empty `operations` array). This is the CI surface that would have
 * caught TML-2536 before merge — the bug manifested as the planner
 * crashing while deserialising an `end-contract.json` whose
 * polymorphic `storage.types` entries lacked the `kind`
 * discriminator.
 *
 * Reads `migrations/` after the run and ignores any pure-formatting
 * delta in `refs/head.json` (the writer normalises whitespace; the
 * checked-in file was reformatted by lint-staged after the initial
 * generation, so a byte-for-byte diff is too strict). A semantic
 * compare (parsed JSON deep-equal) is enforced instead.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function runMigrationPlan(): unknown {
  const cliEntry = join(
    demoRoot,
    '..',
    '..',
    'packages',
    '1-framework',
    '3-tooling',
    'cli',
    'dist',
    'cli.js',
  );
  const stdout = execFileSync('node', [cliEntry, 'migration', 'plan', '--json'], {
    cwd: demoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(stdout) as unknown;
}

function gitFiles(prefix: string): string[] {
  const stdout = execFileSync('git', ['ls-files', prefix], {
    cwd: demoRoot,
    encoding: 'utf-8',
  });
  return stdout.split('\n').filter((line) => line.length > 0);
}

function semanticDiff(): string[] {
  const tracked = gitFiles('migrations/');
  const drifted: string[] = [];
  for (const rel of tracked) {
    if (!rel.endsWith('.json')) continue;
    const absolute = join(demoRoot, rel);
    let onDisk: string;
    try {
      onDisk = readFileSync(absolute, 'utf-8');
    } catch {
      drifted.push(`${rel} (missing on disk after plan)`);
      continue;
    }
    const head = execFileSync('git', ['show', `HEAD:examples/prisma-next-demo/${rel}`], {
      cwd: join(demoRoot, '..', '..'),
      encoding: 'utf-8',
    });
    try {
      const parsedDisk = JSON.parse(onDisk) as unknown;
      const parsedHead = JSON.parse(head) as unknown;
      if (JSON.stringify(parsedDisk) !== JSON.stringify(parsedHead)) {
        drifted.push(rel);
      }
    } catch {
      if (onDisk !== head) drifted.push(rel);
    }
  }
  return drifted;
}

function assertNoOpPlan(plan: unknown): void {
  if (typeof plan !== 'object' || plan === null) {
    throw new Error(`Expected migration-plan output to be a JSON object, got ${typeof plan}`);
  }
  const obj = plan as Record<string, unknown>;
  if (obj['ok'] !== true) {
    throw new Error(`migration plan did not succeed: ${JSON.stringify(plan)}`);
  }
  if (obj['noOp'] !== true) {
    throw new Error(`migration plan was not a no-op: ${JSON.stringify(plan)}`);
  }
  const operations = obj['operations'];
  if (!Array.isArray(operations) || operations.length !== 0) {
    throw new Error(`migration plan emitted operations: ${JSON.stringify(operations)}`);
  }
}

try {
  const plan = runMigrationPlan();
  assertNoOpPlan(plan);
  const drifted = semanticDiff();
  if (drifted.length > 0) {
    console.error('migration:plan:check — drift detected in checked-in migration files:');
    for (const file of drifted) console.error(`  ${file}`);
    process.exit(1);
  }
  console.log('migration:plan:check — clean (plan is a no-op, no file drift)');
} catch (error) {
  console.error('migration:plan:check — FAILED');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
