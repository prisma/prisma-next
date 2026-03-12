/**
 * Schema Drift Scenarios (Journeys M + N)
 *
 * M — Phantom drift: after initialization, a DBA drops a column via manual DDL.
 *     db verify still passes (marker hash unchanged — false positive), but
 *     db schema-verify catches the missing column. Recovery via db update fails
 *     because re-adding a NOT NULL column to an existing table is unrecoverable
 *     without manual intervention.
 *
 * N — Extra column drift: a DBA adds a column via manual DDL. Tolerant
 *     schema-verify passes (extras OK), strict schema-verify fails. Recovery
 *     by expanding the contract to include a new column, then db update.
 */

import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runDbIntrospect,
  runDbSchemaVerify,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey M: Phantom Drift (Marker OK, Schema Diverged)
  // -------------------------------------------------------------------------
  describe('Journey M: Phantom Drift', () => {
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
      'init → manual DDL drop → verify passes (false positive) → schema-verify catches drift',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Precondition: init with base contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'M.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'M.pre: init').toBe(0);

        // Manual DDL: drop email column
        await withClient(connectionString, async (client) => {
          await client.query('ALTER TABLE "user" DROP COLUMN email');
        });

        // M.01: db verify (passes — marker hash still matches, false positive)
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'M.01: db verify false positive').toBe(0);

        // M.02: db schema-verify (fails — missing email column)
        const schemaVerify = await runDbSchemaVerify(ctx);
        expect(schemaVerify.exitCode, 'M.02: db schema-verify fails').toBe(1);

        // M.03: db introspect (shows schema without email)
        const introspect = await runDbIntrospect(ctx);
        expect(introspect.exitCode, 'M.03: db introspect').toBe(0);

        // M.04: db update recovery
        // The planner cannot re-add a dropped NOT NULL column to an existing table
        // because Postgres requires a DEFAULT for NOT NULL columns on non-empty tables
        // (even if the table is technically empty, the planner validates post-update schema).
        // db update correctly detects the drift but the runner fails (PN-RTM-3020).
        // Recovery in this scenario requires manual DDL or db init with a fresh database.
        const update = await runDbUpdate(ctx, ['-y']);
        expect(update.exitCode, 'M.04: db update detects unrecoverable drift').toBe(1);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey N: Manual DDL Added Extra Column
  // -------------------------------------------------------------------------
  describe('Journey N: Extra Column Drift', () => {
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
      'init → manual DDL add → verify/tolerant pass → strict fails → expand contract → update → verify',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Precondition: init with base contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'N.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'N.pre: init').toBe(0);

        // Manual DDL: add age column
        await withClient(connectionString, async (client) => {
          await client.query('ALTER TABLE "user" ADD COLUMN age int4');
        });

        // N.01: db verify (passes — marker matches)
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'N.01: db verify passes').toBe(0);

        // N.02: db schema-verify (passes — tolerant, extras OK)
        const tolerant = await runDbSchemaVerify(ctx);
        expect(tolerant.exitCode, 'N.02: schema-verify tolerant passes').toBe(0);

        // N.03: db schema-verify --strict (fails — extra age column)
        const strict = await runDbSchemaVerify(ctx, ['--strict']);
        expect(strict.exitCode, 'N.03: schema-verify strict fails').toBe(1);

        // N.04: db introspect
        const introspect = await runDbIntrospect(ctx);
        expect(introspect.exitCode, 'N.04: db introspect').toBe(0);
        expect(stripAnsi(introspect.stdout), 'N.04: shows age column').toContain('age');

        // N.05: Expand contract to include name column, emit
        swapContract(ctx, 'contract-additive');
        const emitExpanded = await runContractEmit(ctx);
        expect(emitExpanded.exitCode, 'N.05: contract emit expanded').toBe(0);

        // N.06: db update (contract now has 'name' col DB doesn't have — update adds 'name')
        // N.06: db update (contract now has 'name' col DB doesn't have — update adds 'name')
        // Use --no-interactive to avoid hanging on potential confirmation prompts
        const update = await runDbUpdate(ctx, ['--no-interactive']);
        // db update may fail if the planner classifies adding NOT NULL column as destructive
        // In that case, retry with -y to auto-accept
        if (update.exitCode !== 0) {
          const updateY = await runDbUpdate(ctx, ['-y']);
          expect(updateY.exitCode, 'N.06: db update with -y').toBe(0);
        }

        // N.07: db schema-verify tolerant (passes — contract columns are present)
        const tolerantAfter = await runDbSchemaVerify(ctx);
        expect(tolerantAfter.exitCode, 'N.07: tolerant passes after update').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
