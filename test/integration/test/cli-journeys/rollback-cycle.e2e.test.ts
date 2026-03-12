/**
 * Rollback Cycle (Journey J — spec scenario P-2/S-2)
 *
 * Tests cycle-safe shortest-path resolution after a rollback migration
 * creates a cycle in the migration graph (C1 → C2 → C1). Without --from,
 * findLeaf fails with NO_RESOLVABLE_LEAF. Using --from bypasses the cycle
 * and produces a valid migration path.
 */

import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runMigrationApply,
  runMigrationPlan,
  runMigrationStatus,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey J: Rollback Cycle (P-2/S-2)', () => {
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
      'C1 → C2 → C1 rollback creates cycle → plan with --from recovers',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // J.01: emit base contract (C1) → plan + apply init
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'J.01: emit C1').toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'init', '--json']);
        expect(plan0.exitCode, 'J.01: plan init').toBe(0);
        const planResult0 = parseJsonOutput<{ to: string }>(plan0);
        const c1Hash = planResult0.to;
        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, 'J.01: apply init').toBe(0);

        // J.02: swap to contract-phone (C2) → emit → plan + apply add-phone
        swapContract(ctx, 'contract-phone');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'J.02: emit C2').toBe(0);
        const plan1 = await runMigrationPlan(ctx, ['--name', 'add-phone', '--json']);
        expect(plan1.exitCode, 'J.02: plan add-phone').toBe(0);
        const planResult1 = parseJsonOutput<{ to: string }>(plan1);
        const c2Hash = planResult1.to;
        expect(c2Hash, 'J.02: C2 differs from C1').not.toBe(c1Hash);
        const apply1 = await runMigrationApply(ctx);
        expect(apply1.exitCode, 'J.02: apply add-phone').toBe(0);

        // J.03: swap back to base contract (C1) → emit → plan rollback (C2→C1 cycle edge)
        swapContract(ctx, 'contract-base');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'J.03: emit C1 again').toBe(0);
        const planRollback = await runMigrationPlan(ctx, ['--name', 'rollback-phone', '--json']);
        expect(planRollback.exitCode, 'J.03: plan rollback').toBe(0);
        const apply2 = await runMigrationApply(ctx);
        expect(apply2.exitCode, 'J.03: apply rollback').toBe(0);

        // J.04: graph now has cycle (C1→C2→C1). plan without --from errors
        swapContract(ctx, 'contract-bio');
        const emit3 = await runContractEmit(ctx);
        expect(emit3.exitCode, 'J.04: emit C3 (bio)').toBe(0);
        const planFail = await runMigrationPlan(ctx, ['--name', 'add-bio']);
        expect(planFail.exitCode, 'J.04: plan without --from fails').toBe(1);
        const failOutput = stripAnsi(planFail.stdout + planFail.stderr);
        expect(failOutput, 'J.04: error mentions no resolvable leaf').toMatch(
          /no.*resolvable.*leaf|cycle|NO_RESOLVABLE_LEAF/i,
        );

        // J.05: plan with --from C1 recovers
        const planFrom = await runMigrationPlan(ctx, [
          '--name',
          'add-bio',
          '--from',
          c1Hash,
          '--json',
        ]);
        expect(planFrom.exitCode, 'J.05: plan --from C1').toBe(0);
        const planFromResult = parseJsonOutput<{ from: string; to: string; noOp: boolean }>(
          planFrom,
        );
        expect(planFromResult.noOp, 'J.05: not a noop').toBe(false);
        expect(planFromResult.from, 'J.05: from is C1').toBe(c1Hash);

        // J.06: apply and verify status
        const apply3 = await runMigrationApply(ctx, ['--json']);
        expect(apply3.exitCode, 'J.06: apply add-bio').toBe(0);
        const applyResult = parseJsonOutput<{ ok: boolean; migrationsApplied: number }>(apply3);
        expect(applyResult.ok, 'J.06: ok').toBe(true);
        expect(applyResult.migrationsApplied, 'J.06: applied 1').toBe(1);

        const status = await runMigrationStatus(ctx, ['--json']);
        expect(status.exitCode, 'J.06: status').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
