/**
 * Migration Plan Details (Journeys H + I)
 *
 * H — Plan JSON envelope and attestation: plan an initial migration with
 *     --json, verify the envelope contains operations, from/to hashes,
 *     migrationId, and dir. Then verify the planned migration passes
 *     attestation and the on-disk chain linkage is correct.
 *
 * I — Destructive planning: plan an initial migration, swap to a contract
 *     that removes a column, plan the drop-column migration, and verify the
 *     JSON output and on-disk migration contain destructive operation class.
 */

import { join } from 'node:path';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { verifyMigration } from '@prisma-next/migration-tools/attestation';
import { readMigrationsDir } from '@prisma-next/migration-tools/io';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runMigrationPlan,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey H: Plan JSON Envelope and Attestation
  // -------------------------------------------------------------------------
  describe('Journey H: Plan JSON Envelope and Attestation', () => {
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
      'emit → plan --json (verify envelope) → verify attestation → check chain linkage',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // H.01: contract emit
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'H.01: contract emit').toBe(0);

        // H.02: migration plan --json
        const plan = await runMigrationPlan(ctx, ['--name', 'initial', '--json']);
        expect(plan.exitCode, 'H.02: migration plan --json').toBe(0);

        const result = parseJsonOutput<{
          ok: boolean;
          noOp: boolean;
          from: string;
          to: string;
          migrationId: string;
          dir: string;
          operations: readonly { id: string; label: string; operationClass: string }[];
        }>(plan);

        expect(result.ok, 'H.02: ok flag').toBe(true);
        expect(result.noOp, 'H.02: not a noop').toBe(false);
        expect(result.from, 'H.02: from is empty hash').toBe(EMPTY_CONTRACT_HASH);
        expect(result.to, 'H.02: to is defined').toBeDefined();
        expect(result.migrationId, 'H.02: migrationId is defined').toBeDefined();
        expect(result.dir, 'H.02: dir is defined').toBeDefined();
        expect(result.operations.length, 'H.02: has operations').toBeGreaterThan(0);

        const tableOp = result.operations.find((op) => op.id.includes('user'));
        expect(tableOp, 'H.02: has user table operation').toBeDefined();

        // H.03: verify attestation on disk
        const migrationsDir = join(ctx.testDir, 'migrations');
        const packages = await readMigrationsDir(migrationsDir);
        expect(packages, 'H.03: one migration package').toHaveLength(1);

        const pkgDir = join(migrationsDir, packages[0]!.dirName);
        const verifyResult = await verifyMigration(pkgDir);
        expect(verifyResult.ok, 'H.03: attestation passes').toBe(true);

        // H.04: chain linkage
        expect(packages[0]!.manifest.from, 'H.04: from empty').toBe(EMPTY_CONTRACT_HASH);
        expect(packages[0]!.manifest.to, 'H.04: to matches plan output').toBe(result.to);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey I: Destructive Planning (Drop Column)
  // -------------------------------------------------------------------------
  describe('Journey I: Destructive Planning', () => {
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
      'emit → plan initial → swap destructive → plan drop-column → verify destructive ops',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // I.01: emit base contract and plan initial migration
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'I.01: contract emit').toBe(0);
        const planInit = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(planInit.exitCode, 'I.01: plan initial').toBe(0);

        // I.02: swap to destructive contract (removes email column)
        swapContract(ctx, 'contract-destructive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'I.02: contract emit destructive').toBe(0);

        // I.03: plan drop-column migration
        const planDrop = await runMigrationPlan(ctx, ['--name', 'drop-email', '--json']);
        expect(planDrop.exitCode, 'I.03: plan drop-email').toBe(0);

        const result = parseJsonOutput<{
          ok: boolean;
          noOp: boolean;
          operations: readonly { id: string; label: string; operationClass: string }[];
        }>(planDrop);

        expect(result.ok, 'I.03: ok flag').toBe(true);
        expect(result.noOp, 'I.03: not a noop').toBe(false);

        const dropOp = result.operations.find(
          (op) => op.id.includes('email') || op.label.toLowerCase().includes('email'),
        );
        expect(dropOp, 'I.03: has email-related operation').toBeDefined();
        expect(dropOp!.operationClass, 'I.03: email op is destructive').toBe('destructive');

        // I.04: verify destructive operation class on disk
        const migrationsDir = join(ctx.testDir, 'migrations');
        const packages = await readMigrationsDir(migrationsDir);
        expect(packages, 'I.04: two migration packages').toHaveLength(2);

        const destructivePkg = packages.find((p) => p.manifest.from !== EMPTY_CONTRACT_HASH)!;
        const destructiveOps = destructivePkg.ops.filter(
          (op) => op.operationClass === 'destructive',
        );
        expect(destructiveOps.length, 'I.04: has destructive ops on disk').toBeGreaterThan(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
