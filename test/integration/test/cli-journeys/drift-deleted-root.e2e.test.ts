/**
 * Migration DAG Drift — Deleted Root Migration (Journey P4)
 *
 * After building a 2-step migration chain (initial → add-name), the
 * initial migration directory is deleted from disk. This leaves an
 * orphaned migration (add-name) whose origin hash has no incoming edge
 * from EMPTY_CONTRACT_HASH. The system must detect this and report an
 * error rather than silently treating the graph as empty.
 */

import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runMigrationApply,
  runMigrationPlan,
  runMigrationStatus,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey P4: Deleted Root Migration', () => {
    let connectionString: string;
    let closeDb: () => Promise<void> = async () => {};

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'deleting root migration is detected as broken graph, not silently ignored',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Build a 2-migration chain: base → additive
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'P4.pre: emit base').toBe(0);
        const planInit = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'P4.pre: plan initial').toBe(0);
        const applyInit = await runMigrationApply(ctx);
        expect(applyInit.exitCode, 'P4.pre: apply initial').toBe(0);

        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'P4.pre: emit v2').toBe(0);
        const plan1 = await runMigrationPlan(ctx, ['--name', 'add-name']);
        expect(plan1.exitCode, 'P4.pre: plan add-name').toBe(0);
        const apply1 = await runMigrationApply(ctx);
        expect(apply1.exitCode, 'P4.pre: apply add-name').toBe(0);

        // Delete the FIRST migration (root edge: empty → base)
        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirs = readdirSync(migrationsDir).sort();
        const initDir = migrationDirs.find((d) => d.endsWith('_initial'));
        expect(initDir, 'P4.pre: initial dir exists').toBeDefined();
        rmSync(join(migrationsDir, initDir!), { recursive: true, force: true });

        // Verify only add-name remains on disk
        const remaining = readdirSync(migrationsDir).filter((d) => !d.startsWith('.'));
        expect(remaining, 'P4.pre: only add-name remains').toHaveLength(1);
        expect(remaining[0], 'P4.pre: remaining is add-name').toMatch(/_add_name$/);

        // P4.01: migration status detects the broken graph
        const status = await runMigrationStatus(ctx);
        expect(status.exitCode, 'P4.01: status reports error').not.toBe(0);
        const statusOutput = stripAnsi(status.stdout);
        expect(statusOutput, 'P4.01: mentions orphan, broken chain, or disconnected graph').toMatch(
          /orphan|broken|disconnect|no.*root|no.*path|unreachable/i,
        );

        // P4.02: migration plan detects the broken graph (does NOT silently
        //        treat it as empty and plan a duplicate init migration)
        const planAgain = await runMigrationPlan(ctx, ['--name', 'should-fail']);
        const planOutput = stripAnsi(planAgain.stdout);

        // The critical assertion: the planner must NOT succeed and silently
        // create a new init migration as if no migrations existed
        expect(planAgain.exitCode, 'P4.02: plan fails on broken graph').not.toBe(0);
        expect(planOutput, 'P4.02: mentions orphan, broken chain, or disconnected graph').toMatch(
          /orphan|broken|disconnect|no.*root|no.*path|unreachable/i,
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
