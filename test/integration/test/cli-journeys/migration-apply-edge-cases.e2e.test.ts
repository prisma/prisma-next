/**
 * Migration Apply Edge Cases (migrated from cli.migration-apply.e2e.test.ts)
 *
 * Covers apply edge cases not exercised by Journeys B and C:
 * - No planned migration path (contract changed without planning)
 * - Resume from last successful migration after partial failure
 * - Single destructive migration (drop column)
 * - Multiple migrations including destructive in DAG order
 */

import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbVerify,
  runMigrationApply,
  runMigrationPlan,
  setupJourney,
  sql,
  swapContract,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // ---------------------------------------------------------------------------
  // No planned migration path
  // ---------------------------------------------------------------------------
  describe('Migration Apply: no planned migration path', () => {
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
      'fails when contract changed without planning a new migration',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Setup: emit → plan → apply initial migration
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'emit base').toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, 'plan initial').toBe(0);
        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, 'apply initial').toBe(0);

        // Swap contract and re-emit WITHOUT planning
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'emit additive').toBe(0);

        // Apply with no planned edge for the new contract → failure
        const apply1 = await runMigrationApply(ctx, ['--json']);
        expect(apply1.exitCode, 'apply fails').toBe(1);
        const output = stripAnsi(apply1.stdout);
        expect(output, 'error mentions no path').toMatch(
          /no.*path|no.*migration|not.*found|cannot.*resolve/i,
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ---------------------------------------------------------------------------
  // Resume after partial failure
  // ---------------------------------------------------------------------------
  describe('Migration Apply: resume after partial failure', () => {
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
      'resumes from last successful migration after NOT NULL violation',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Plan and apply initial migration (creates user table)
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'emit base').toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, 'plan initial').toBe(0);
        const apply0 = await runMigrationApply(ctx, ['--json']);
        expect(apply0.exitCode, 'apply initial').toBe(0);

        const firstResult = parseJsonOutput<{ migrationsApplied: number; markerHash: string }>(
          apply0,
        );
        expect(firstResult.migrationsApplied, 'applied 1').toBe(1);

        // Insert data so a NOT NULL column addition will fail
        await sql(
          connectionString,
          `INSERT INTO "user" (id, email) VALUES (1, 'user@example.com')`,
        );

        // Plan a migration that adds a non-nullable column (will fail on existing rows)
        swapContract(ctx, 'contract-additive-required');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'emit additive-required').toBe(0);
        const plan1 = await runMigrationPlan(ctx, ['--name', 'add-required-name']);
        expect(plan1.exitCode, 'plan add-required-name').toBe(0);

        // Apply fails because existing rows violate NOT NULL
        const applyFail = await runMigrationApply(ctx, ['--json']);
        expect(applyFail.exitCode, 'apply fails on NOT NULL').toBe(1);

        // Marker stays at the first migration's target hash
        const marker = await sql(
          connectionString,
          'SELECT core_hash FROM prisma_contract.marker WHERE id = $1',
          [1],
        );
        expect(marker.rows[0]?.['core_hash'], 'marker unchanged after failure').toBe(
          firstResult.markerHash,
        );

        // Fix: remove conflicting data, then resume
        await sql(connectionString, 'DELETE FROM "user"');

        const applyResume = await runMigrationApply(ctx, ['--json']);
        expect(applyResume.exitCode, 'resume succeeds').toBe(0);

        const resumeResult = parseJsonOutput<{ migrationsApplied: number; markerHash: string }>(
          applyResume,
        );
        expect(resumeResult.migrationsApplied, 'applied 1 on resume').toBe(1);
        expect(resumeResult.markerHash, 'marker advanced').not.toBe(firstResult.markerHash);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ---------------------------------------------------------------------------
  // Destructive apply (single drop-column)
  // ---------------------------------------------------------------------------
  describe('Migration Apply: destructive (drop column)', () => {
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
      'applies a migration that drops a column and verifies schema',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Plan and apply initial migration
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'emit base').toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, 'plan initial').toBe(0);
        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, 'apply initial').toBe(0);

        // Verify email column exists before drop
        const colsBefore = await sql(
          connectionString,
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'email'`,
        );
        expect(colsBefore.rows.length, 'email exists before drop').toBe(1);

        // Plan destructive migration (removes email column)
        swapContract(ctx, 'contract-destructive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'emit destructive').toBe(0);
        const plan1 = await runMigrationPlan(ctx, ['--name', 'drop-email']);
        expect(plan1.exitCode, 'plan drop-email').toBe(0);

        // Apply destructive migration
        const apply1 = await runMigrationApply(ctx, ['--json']);
        expect(apply1.exitCode, 'apply destructive').toBe(0);

        const result = parseJsonOutput<{
          ok: boolean;
          migrationsApplied: number;
          markerHash: string;
        }>(apply1);
        expect(result.ok, 'ok flag').toBe(true);
        expect(result.migrationsApplied, 'applied 1').toBe(1);

        // Verify email column no longer exists
        const colsAfter = await sql(
          connectionString,
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'email'`,
        );
        expect(colsAfter.rows.length, 'email removed after drop').toBe(0);

        // Verify marker updated
        const marker = await sql(
          connectionString,
          'SELECT core_hash FROM prisma_contract.marker WHERE id = $1',
          [1],
        );
        expect(marker.rows[0]?.['core_hash'], 'marker matches result').toBe(result.markerHash);

        // db verify passes
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'db verify passes').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // ---------------------------------------------------------------------------
  // Multiple migrations including destructive (batch apply)
  // ---------------------------------------------------------------------------
  describe('Migration Apply: multi-step with destructive', () => {
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
      'applies three migrations (create → add column → drop column) in one batch',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Migration 1: create user table (id + email)
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'emit base').toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, 'plan initial').toBe(0);

        // Migration 2: add name column
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, 'emit additive').toBe(0);
        const plan1 = await runMigrationPlan(ctx, ['--name', 'add-name']);
        expect(plan1.exitCode, 'plan add-name').toBe(0);

        // Migration 3: drop email column (destructive)
        swapContract(ctx, 'contract-destructive');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'emit destructive').toBe(0);
        const plan2 = await runMigrationPlan(ctx, ['--name', 'drop-email']);
        expect(plan2.exitCode, 'plan drop-email').toBe(0);

        // Batch apply all three from empty DB
        const apply = await runMigrationApply(ctx, ['--json']);
        expect(apply.exitCode, 'batch apply').toBe(0);

        const result = parseJsonOutput<{
          ok: boolean;
          migrationsApplied: number;
          applied: readonly { dirName: string; operationsExecuted: number }[];
        }>(apply);
        expect(result.ok, 'ok flag').toBe(true);
        expect(result.migrationsApplied, 'applied 3').toBe(3);
        expect(result.applied, '3 entries').toHaveLength(3);

        // Verify final schema: user table has id only (email dropped, name was never in destructive)
        const cols = await sql(
          connectionString,
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user'
           ORDER BY ordinal_position`,
        );
        const columnNames = cols.rows.map((r) => r['column_name']);
        expect(columnNames, 'final schema is id-only').toEqual(['id']);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
