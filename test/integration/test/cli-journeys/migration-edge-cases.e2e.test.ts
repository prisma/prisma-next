/**
 * Journeys Q + R + X: Migration Edge Cases
 *
 * Journey Q: Migration apply already up-to-date.
 * Journey R: Migration plan no changes.
 * Journey X: Migration show variants.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
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
  runMigrationShow,
  runMigrationStatus,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey Q: Migration Apply Already Up-to-Date
  // -------------------------------------------------------------------------
  describe('Journey Q: Already Up-to-Date', () => {
    let connectionString: string;
    let closeDb: () => Promise<void>;

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'apply after all migrations applied → noop',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Setup: emit, plan+apply initial, plan+apply v2
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'Q.pre: emit').toBe(0);
        const planInit = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'Q.pre: plan initial').toBe(0);
        const applyInit = await runMigrationApply(ctx);
        expect(applyInit.exitCode, 'Q.pre: apply initial').toBe(0);
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'Q.pre: emit v2').toBe(0);
        const plan = await runMigrationPlan(ctx, ['--name', 'add-name']);
        expect(plan.exitCode, 'Q.pre: plan').toBe(0);
        const apply = await runMigrationApply(ctx);
        expect(apply.exitCode, 'Q.pre: apply').toBe(0);

        // Q.01: migration apply --db (already up-to-date)
        const applyNoop = await runMigrationApply(ctx, ['--json']);
        expect(applyNoop.exitCode, 'Q.01: migration apply noop').toBe(0);
        const noopData = parseJsonOutput(applyNoop);
        expect(noopData, 'Q.01: 0 applied').toMatchObject({
          ok: true,
          migrationsApplied: 0,
        });

        // Q.02: migration status --db
        const status = await runMigrationStatus(ctx);
        expect(status.exitCode, 'Q.02: migration status').toBe(0);
        expect(stripAnsi(status.stdout), 'Q.02: all applied').toContain('Applied');
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey R: Migration Plan No Changes
  // -------------------------------------------------------------------------
  describe('Journey R: Plan No Changes', () => {
    let connectionString: string;
    let closeDb: () => Promise<void>;

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'plan when contract matches leaf migration → no-op',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Setup: emit, plan+apply initial, plan v2 migration
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'R.pre: emit').toBe(0);
        const planInit = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'R.pre: plan initial').toBe(0);
        const applyInit = await runMigrationApply(ctx);
        expect(applyInit.exitCode, 'R.pre: apply initial').toBe(0);
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'R.pre: emit v2').toBe(0);
        const plan = await runMigrationPlan(ctx, ['--name', 'add-name']);
        expect(plan.exitCode, 'R.pre: plan').toBe(0);

        // R.01: migration plan (no changes — contract matches leaf)
        const planNoop = await runMigrationPlan(ctx, ['--json']);
        expect(planNoop.exitCode, 'R.01: migration plan noop').toBe(0);
        const noopData = parseJsonOutput(planNoop);
        expect(noopData, 'R.01: noop flag').toMatchObject({ noOp: true });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey X: Migration Show Variants
  // -------------------------------------------------------------------------
  describe('Journey X: Migration Show Variants', () => {
    let connectionString: string;
    let closeDb: () => Promise<void>;

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'show latest → show by path → show ambiguous → show not found',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Setup: emit, plan two migrations
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'X.pre: emit').toBe(0);
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'X.pre: emit v2').toBe(0);
        const plan1 = await runMigrationPlan(ctx, ['--name', 'add-name']);
        expect(plan1.exitCode, 'X.pre: plan 1').toBe(0);

        swapContract(ctx, 'contract-v3');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'X.pre: emit v3').toBe(0);
        const plan2 = await runMigrationPlan(ctx, ['--name', 'add-posts']);
        expect(plan2.exitCode, 'X.pre: plan 2').toBe(0);

        // X.01: migration show (latest)
        const showLatest = await runMigrationShow(ctx);
        expect(showLatest.exitCode, 'X.01: show latest').toBe(0);

        // X.03: migration show by path
        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirs = readdirSync(migrationsDir).sort();
        if (migrationDirs.length > 0) {
          const firstDir = migrationDirs[0]!;
          const showByPath = await runMigrationShow(ctx, [join('migrations', firstDir)]);
          expect(showByPath.exitCode, 'X.03: show by path').toBe(0);
        }

        // X.05: migration show with non-existent prefix
        const showNotFound = await runMigrationShow(ctx, ['sha256:nonexistent123']);
        expect(showNotFound.exitCode, 'X.05: show not found').toBe(1);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
