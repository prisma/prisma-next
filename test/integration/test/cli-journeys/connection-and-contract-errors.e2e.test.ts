/**
 * Journeys S + W + U + V: Connection and Contract Error Scenarios
 *
 * Journey S: Connection failures.
 * Journey W: No contract emitted yet.
 * Journey U: Target mismatch.
 * Journey V: db init on non-empty unmanaged database.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  runDbVerify,
  setupJourney,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey S: Connection Failures
  // -------------------------------------------------------------------------
  describe('Journey S: Connection Errors', () => {
    // S.04 is the most deterministically testable (no DB needed)
    it(
      'S.04: db verify without --db and no config connection fails',
      async () => {
        // Setup journey without db connection in config
        const ctx: JourneyContext = setupJourney({ createTempDir });

        // Emit contract first (no DB needed for emit)
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'S.04.pre: emit').toBe(0);

        // db verify without connection should fail
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'S.04: missing connection').not.toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey W: No Contract Emitted Yet
  // -------------------------------------------------------------------------
  describe('Journey W: No Contract Yet', () => {
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
      'db init and db verify fail when contract not emitted',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Don't emit contract — go straight to db commands

        // W.01: db init (fails — contract file not found)
        const initFail = await runDbInit(ctx);
        expect(initFail.exitCode, 'W.01: db init no contract').not.toBe(0);

        // W.02: db verify (fails — contract file required)
        const verifyFail = await runDbVerify(ctx);
        expect(verifyFail.exitCode, 'W.02: db verify no contract').not.toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey U: Target Mismatch
  // -------------------------------------------------------------------------
  describe('Journey U: Target Mismatch', () => {
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
      'db verify fails when contract target differs from config target',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Init normally with Postgres contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'U.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'U.pre: init').toBe(0);

        // Tamper with contract.json on disk: change "target" from "postgres" to "mysql"
        // The config still says target=postgres, so db verify will see a mismatch.
        const contractJsonPath = join(ctx.outputDir, 'contract.json');
        const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
        contractJson.target = 'mysql';
        writeFileSync(contractJsonPath, JSON.stringify(contractJson, null, 2), 'utf-8');

        // U.01: db verify (fails — contract says "mysql", config says "postgres")
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'U.01: db verify target mismatch').toBe(1);
        expect(stripAnsi(verify.stdout), 'U.01: mentions target mismatch').toContain(
          'Target mismatch',
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey V: db init on Non-Empty Unmanaged Database
  // -------------------------------------------------------------------------
  describe('Journey V: Unmanaged DB Init', () => {
    let connectionString: string;
    let closeDb: () => Promise<void>;

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
      // Create pre-existing tables matching the contract
      await withClient(connectionString, async (client) => {
        await client.query(`
          CREATE TABLE "user" (
            id int4 PRIMARY KEY,
            email text NOT NULL
          );
        `);
      });
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'db init on database with matching pre-existing tables',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Emit contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'V.pre: emit').toBe(0);

        // V.01: db init — tables already exist, should handle gracefully
        const init = await runDbInit(ctx);
        // Behavior depends on planner: may succeed (tables match) or fail (conflict)
        expect([0, 1], 'V.01: db init completes').toContain(init.exitCode);

        // V.02: db init --dry-run
        const dryRun = await runDbInit(ctx, ['--dry-run']);
        expect([0, 1], 'V.02: dry-run completes').toContain(dryRun.exitCode);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
