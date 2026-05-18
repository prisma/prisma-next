/**
 * `migration check` adversarial fixtures.
 *
 * Exercises each PN code under INTEGRITY_FAILED (exit 4) and the
 * clean-graph pass (exit 0). Each test plants a specific corruption
 * after a successful plan+emit and asserts the expected PN code.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runMigrationCheck,
  runMigrationPlanAndEmit,
  runRef,
  setupJourney,
  timeouts,
} from '../utils/journey-test-helpers';

function findLatestMigrationDir(ctx: JourneyContext): string {
  const appDir = join(ctx.testDir, 'migrations', 'app');
  if (!existsSync(appDir)) throw new Error('No migrations/app dir');
  const entries = readdirSync(appDir)
    .filter((e) => !e.startsWith('.') && !e.startsWith('_') && e !== 'refs')
    .sort();
  if (entries.length === 0) throw new Error('No migration directories');
  return join(appDir, entries[entries.length - 1]!);
}

withTempDir(({ createTempDir }) => {
  describe('migration check', () => {
    it(
      'clean graph passes with exit 0',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const check = await runMigrationCheck(ctx, ['--json']);
        expect(check.exitCode, 'check exit code').toBe(0);
        const json = parseJsonOutput(check);
        expect(json?.['ok']).toBe(true);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'hash mismatch (mutated ops.json) → exit 4, PN-MIG-CHECK-001',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const migDir = findLatestMigrationDir(ctx);
        const manifestPath = join(migDir, 'migration.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.migrationHash = `sha256:${'0'.repeat(64)}`;
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        const check = await runMigrationCheck(ctx, ['--json']);
        expect(check.exitCode, 'check exit code').toBe(4);
        const json = parseJsonOutput(check);
        const failures = json?.['failures'] as readonly Record<string, string>[];
        expect(failures.length).toBeGreaterThan(0);
        expect(failures.some((f) => f['pnCode'] === 'PN-MIG-CHECK-001')).toBe(true);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'missing manifest file → exit 4, PN-MIG-CHECK-002',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const appDir = join(ctx.testDir, 'migrations', 'app');
        const emptyDir = join(appDir, '99990101T0000_orphan-empty');
        mkdirSync(emptyDir, { recursive: true });

        const check = await runMigrationCheck(ctx, ['--json']);
        expect(check.exitCode, 'check exit code').toBe(4);
        const json = parseJsonOutput(check);
        const failures = json?.['failures'] as readonly Record<string, string>[];
        expect(failures.some((f) => f['pnCode'] === 'PN-MIG-CHECK-002')).toBe(true);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'orphan migration → exit 4, PN-MIG-CHECK-003',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const migDir = findLatestMigrationDir(ctx);
        const manifestPath = join(migDir, 'migration.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

        const appDir = join(ctx.testDir, 'migrations', 'app');
        const orphanDir = join(appDir, '99990101T0000_orphan');
        mkdirSync(orphanDir, { recursive: true });

        const orphanManifest = {
          ...manifest,
          from: `sha256:deadbeef${'0'.repeat(56)}`,
          to: `sha256:cafebabe${'0'.repeat(56)}`,
        };
        const orphanOps = readFileSync(join(migDir, 'ops.json'), 'utf-8');

        const { computeMigrationHash } = await import('@prisma-next/migration-tools/hash');
        orphanManifest.migrationHash = computeMigrationHash(orphanManifest, JSON.parse(orphanOps));

        writeFileSync(join(orphanDir, 'migration.json'), JSON.stringify(orphanManifest, null, 2));
        writeFileSync(join(orphanDir, 'ops.json'), orphanOps);

        const check = await runMigrationCheck(ctx, ['--json']);
        expect(check.exitCode, 'check exit code').toBe(4);
        const json = parseJsonOutput(check);
        const failures = json?.['failures'] as readonly Record<string, string>[];
        expect(failures.some((f) => f['pnCode'] === 'PN-MIG-CHECK-003')).toBe(true);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'dangling ref → exit 4, PN-MIG-CHECK-004',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const danglingHash = `sha256:${'f'.repeat(64)}`;
        const refSet = await runRef(ctx, ['set', 'dangling', danglingHash]);
        expect(refSet.exitCode, 'ref set').toBe(0);

        const check = await runMigrationCheck(ctx, ['--json']);
        expect(check.exitCode, 'check exit code').toBe(4);
        const json = parseJsonOutput(check);
        const failures = json?.['failures'] as readonly Record<string, string>[];
        expect(failures.some((f) => f['pnCode'] === 'PN-MIG-CHECK-004')).toBe(true);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'non-existent named migration → exit 2, PRECONDITION',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'init']);
        expect(plan.exitCode, 'plan').toBe(0);

        const check = await runMigrationCheck(ctx, ['nonexistent-migration', '--json']);
        expect(check.exitCode, 'check exit code').toBe(2);
      },
      timeouts.typeScriptCompilation,
    );
  });
});
