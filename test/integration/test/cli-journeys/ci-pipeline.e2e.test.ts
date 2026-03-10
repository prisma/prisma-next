/**
 * Journey I: CI/CD Pipeline
 *
 * Automated pipeline: emit, apply migrations, verify — all with --json.
 */

import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbSchemaVerify,
  runDbVerify,
  runMigrationApply,
  runMigrationPlan,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey I: CI/CD Pipeline', () => {
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
      'emit json → apply json → verify json → schema-verify json',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Setup: emit base, plan+apply initial migration, then plan v2 migration
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'I.pre: emit base').toBe(0);
        const planInit = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'I.pre: plan initial').toBe(0);
        const applyInit = await runMigrationApply(ctx);
        expect(applyInit.exitCode, 'I.pre: apply initial').toBe(0);
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'I.pre: emit v2').toBe(0);
        const plan = await runMigrationPlan(ctx, ['--name', 'add-name']);
        expect(plan.exitCode, 'I.pre: plan').toBe(0);

        // I.01: contract emit --json
        swapContract(ctx, 'contract-additive');
        const emitJson = await runContractEmit(ctx, ['--json']);
        expect(emitJson.exitCode, 'I.01: contract emit json').toBe(0);
        const emitData = parseJsonOutput(emitJson);
        expect(emitData, 'I.01: has storageHash').toMatchObject({
          storageHash: expect.any(String),
        });

        // I.02: migration apply --db --json
        const applyJson = await runMigrationApply(ctx, ['--json']);
        expect(applyJson.exitCode, 'I.02: migration apply json').toBe(0);
        const applyData = parseJsonOutput(applyJson);
        expect(applyData, 'I.02: apply result').toMatchObject({
          ok: true,
          migrationsApplied: expect.any(Number),
          migrationsTotal: expect.any(Number),
        });

        // I.03: db verify --json
        const verifyJson = await runDbVerify(ctx, ['--json']);
        expect(verifyJson.exitCode, 'I.03: db verify json').toBe(0);
        const verifyData = parseJsonOutput(verifyJson);
        expect(verifyData, 'I.03: verify ok').toMatchObject({
          ok: true,
          contract: { storageHash: expect.any(String) },
          marker: { storageHash: expect.any(String) },
        });

        // I.04: db schema-verify --json
        const svJson = await runDbSchemaVerify(ctx, ['--json']);
        expect(svJson.exitCode, 'I.04: db schema-verify json').toBe(0);
        const svData = parseJsonOutput(svJson);
        expect(svData, 'I.04: schema-verify ok').toMatchObject({ ok: true });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
