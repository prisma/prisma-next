/**
 * Diamond Convergence (Journey D — beyond spec, exercises multi-environment workflow)
 *
 * Two environments (staging, production) diverge from a common base C1 and
 * converge to a shared target C5. The migration graph forms a diamond:
 *
 *           ∅ → C1
 *          /       \
 *   C1→C2→C3    C1→C4
 *          \       /
 *           C3→C5  C4→C5
 *
 * Staging DB follows ∅→C1→C2→C3→C5.
 * Production DB follows ∅→C1→C4→C5.
 * Both end at C5 but via distinct paths.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runMigrationApply,
  runMigrationPlan,
  runMigrationRef,
  runMigrationStatus,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

function createSecondDbContext(baseCtx: JourneyContext, connectionString: string): JourneyContext {
  const configTemplate = readFileSync(baseCtx.configPath, 'utf-8');
  const prodConfigPath = join(baseCtx.testDir, 'prisma-next.config.prod.ts');
  const existingUrl = configTemplate.match(/connection:\s*'([^']+)'/)?.[1];
  if (!existingUrl) throw new Error('Could not extract DB URL from config');
  writeFileSync(prodConfigPath, configTemplate.replace(existingUrl, connectionString), 'utf-8');
  return { testDir: baseCtx.testDir, configPath: prodConfigPath, outputDir: baseCtx.outputDir };
}

withTempDir(({ createTempDir }) => {
  describe('Journey D: Diamond Convergence', () => {
    let stagingConnectionString: string;
    let prodConnectionString: string;
    let closeStagingDb: () => Promise<void> = async () => {};
    let closeProdDb: () => Promise<void> = async () => {};

    beforeAll(async () => {
      const stagingDb = await createDevDatabase();
      stagingConnectionString = stagingDb.connectionString;
      closeStagingDb = stagingDb.close;

      const prodDb = await createDevDatabase();
      prodConnectionString = prodDb.connectionString;
      closeProdDb = prodDb.close;
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeStagingDb();
      await closeProdDb();
    });

    it(
      'two environments diverge from C1, converge to C5 via distinct paths',
      async () => {
        const staging: JourneyContext = setupJourney({
          connectionString: stagingConnectionString,
          createTempDir,
        });
        const production = createSecondDbContext(staging, prodConnectionString);

        // D.01: emit base (C1) → plan init (∅→C1)
        const emit0 = await runContractEmit(staging);
        expect(emit0.exitCode, 'D.01: emit C1').toBe(0);
        const plan0 = await runMigrationPlan(staging, ['--name', 'init', '--json']);
        expect(plan0.exitCode, 'D.01: plan init').toBe(0);
        const c1Hash = parseJsonOutput<{ to: string }>(plan0).to;

        // D.02: apply init to both databases
        const applyStaging0 = await runMigrationApply(staging);
        expect(applyStaging0.exitCode, 'D.02: apply init to staging').toBe(0);
        const applyProd0 = await runMigrationApply(production);
        expect(applyProd0.exitCode, 'D.02: apply init to production').toBe(0);

        // D.03: set refs — staging and production both at C1
        const refStaging = await runMigrationRef(staging, ['set', 'staging', c1Hash]);
        expect(refStaging.exitCode, 'D.03: ref set staging=C1').toBe(0);
        const refProd = await runMigrationRef(staging, ['set', 'production', c1Hash]);
        expect(refProd.exitCode, 'D.03: ref set production=C1').toBe(0);

        // --- Staging branch: C1 → C2 → C3 ---

        // D.04: swap to contract-phone (C2) → emit → plan (C1→C2) → apply staging
        swapContract(staging, 'contract-phone');
        const emit1 = await runContractEmit(staging);
        expect(emit1.exitCode, 'D.04: emit C2').toBe(0);
        const plan1 = await runMigrationPlan(staging, ['--name', 'add-phone', '--json']);
        expect(plan1.exitCode, 'D.04: plan C1→C2').toBe(0);
        const applyStaging1 = await runMigrationApply(staging);
        expect(applyStaging1.exitCode, 'D.04: apply C2 to staging').toBe(0);

        // D.05: swap to contract-phone-bio (C3) → emit → plan (C2→C3) → apply staging
        swapContract(staging, 'contract-phone-bio');
        const emit2 = await runContractEmit(staging);
        expect(emit2.exitCode, 'D.05: emit C3').toBe(0);
        const plan2 = await runMigrationPlan(staging, ['--name', 'add-bio', '--json']);
        expect(plan2.exitCode, 'D.05: plan C2→C3').toBe(0);
        const c3Hash = parseJsonOutput<{ to: string }>(plan2).to;
        const applyStaging2 = await runMigrationApply(staging);
        expect(applyStaging2.exitCode, 'D.05: apply C3 to staging').toBe(0);

        // Update staging ref
        const refStaging2 = await runMigrationRef(staging, ['set', 'staging', c3Hash]);
        expect(refStaging2.exitCode, 'D.05: ref set staging=C3').toBe(0);

        // --- Production branch: C1 → C4 ---

        // D.06: swap to contract-avatar (C4) → emit → plan from C1 (divergent edge C1→C4)
        swapContract(staging, 'contract-avatar');
        const emit3 = await runContractEmit(staging);
        expect(emit3.exitCode, 'D.06: emit C4').toBe(0);
        const plan3 = await runMigrationPlan(staging, [
          '--name',
          'add-avatar',
          '--from',
          c1Hash,
          '--json',
        ]);
        expect(plan3.exitCode, 'D.06: plan C1→C4').toBe(0);
        const c4Hash = parseJsonOutput<{ to: string }>(plan3).to;

        // Update production ref to C4 before applying
        const refProd2 = await runMigrationRef(staging, ['set', 'production', c4Hash]);
        expect(refProd2.exitCode, 'D.06: ref set production=C4').toBe(0);

        // Apply C1→C4 to production DB
        const applyProd1 = await runMigrationApply(production, ['--ref', 'production', '--json']);
        expect(applyProd1.exitCode, 'D.06: apply C4 to production').toBe(0);
        const applyProd1Result = parseJsonOutput<{ migrationsApplied: number }>(applyProd1);
        expect(applyProd1Result.migrationsApplied, 'D.06: production applied 1').toBe(1);

        // --- Converge: both branches merge to C5 ---

        // D.07: swap to contract-all (C5) → emit
        swapContract(staging, 'contract-all');
        const emit4 = await runContractEmit(staging);
        expect(emit4.exitCode, 'D.07: emit C5').toBe(0);

        // Plan merge from staging branch: C3→C5
        const planMergeStaging = await runMigrationPlan(staging, [
          '--name',
          'merge-staging',
          '--from',
          c3Hash,
          '--json',
        ]);
        expect(planMergeStaging.exitCode, 'D.07: plan C3→C5').toBe(0);
        const c5Hash = parseJsonOutput<{ to: string }>(planMergeStaging).to;

        // Plan merge from production branch: C4→C5
        const planMergeProd = await runMigrationPlan(staging, [
          '--name',
          'merge-prod',
          '--from',
          c4Hash,
          '--json',
        ]);
        expect(planMergeProd.exitCode, 'D.07: plan C4→C5').toBe(0);
        const c5HashFromProd = parseJsonOutput<{ to: string }>(planMergeProd).to;
        expect(c5HashFromProd, 'D.07: both merges target same C5').toBe(c5Hash);

        // Update refs to C5
        const refStaging3 = await runMigrationRef(staging, ['set', 'staging', c5Hash]);
        expect(refStaging3.exitCode, 'D.07: ref set staging=C5').toBe(0);
        const refProd3 = await runMigrationRef(staging, ['set', 'production', c5Hash]);
        expect(refProd3.exitCode, 'D.07: ref set production=C5').toBe(0);

        // D.08: apply merge to staging DB (C3→C5)
        const applyStaging3 = await runMigrationApply(staging, ['--ref', 'staging', '--json']);
        expect(applyStaging3.exitCode, 'D.08: apply merge to staging').toBe(0);
        const stagingResult = parseJsonOutput<{
          ok: boolean;
          migrationsApplied: number;
          markerHash: string;
        }>(applyStaging3);
        expect(stagingResult.ok, 'D.08: staging ok').toBe(true);
        expect(stagingResult.migrationsApplied, 'D.08: staging applied 1 merge').toBe(1);
        expect(stagingResult.markerHash, 'D.08: staging marker at C5').toBe(c5Hash);

        // D.09: apply merge to production DB (C4→C5)
        const applyProd2 = await runMigrationApply(production, ['--ref', 'production', '--json']);
        expect(applyProd2.exitCode, 'D.09: apply merge to production').toBe(0);
        const prodResult = parseJsonOutput<{
          ok: boolean;
          migrationsApplied: number;
          markerHash: string;
        }>(applyProd2);
        expect(prodResult.ok, 'D.09: production ok').toBe(true);
        expect(prodResult.migrationsApplied, 'D.09: production applied 1 merge').toBe(1);
        expect(prodResult.markerHash, 'D.09: production marker at C5').toBe(c5Hash);

        // D.10: verify status shows distinct paths for each environment
        const statusStaging = await runMigrationStatus(staging, ['--ref', 'staging', '--json']);
        expect(statusStaging.exitCode, 'D.10: staging status').toBe(0);
        const stagingStatusData = parseJsonOutput<{
          migrations: readonly { status: string }[];
        }>(statusStaging);
        const stagingPending = stagingStatusData.migrations.filter(
          (m) => m.status === 'pending',
        ).length;
        expect(stagingPending, 'D.10: staging 0 pending').toBe(0);

        const statusProd = await runMigrationStatus(production, ['--ref', 'production', '--json']);
        expect(statusProd.exitCode, 'D.10: production status').toBe(0);
        const prodStatusData = parseJsonOutput<{
          migrations: readonly { status: string }[];
        }>(statusProd);
        const prodPending = prodStatusData.migrations.filter((m) => m.status === 'pending').length;
        expect(prodPending, 'D.10: production 0 pending').toBe(0);

        // Both environments converged to C5. Status uses shortest path from ∅
        // to the ref target: ∅→C1→C4→C5 (3 edges) is shorter than ∅→C1→C2→C3→C5 (4 edges).
        expect(stagingStatusData.migrations.length, 'D.10: staging shows shortest path to C5').toBe(
          3,
        );
        expect(prodStatusData.migrations.length, 'D.10: production shows shortest path to C5').toBe(
          3,
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
