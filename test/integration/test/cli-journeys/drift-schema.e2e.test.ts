/**
 * Schema Drift Scenarios (Journeys M + N)
 *
 * M — Manual DDL with unchanged marker: after initialization, a DBA drops a
 *     column via manual DDL. db verify catches that the live schema no longer
 *     matches the contract. db verify --marker-only still performs marker-only
 *     verification and therefore passes if the marker row is unchanged.
 *     Recovery via db update fails because re-adding a NOT NULL column to an
 *     existing table is unrecoverable without manual intervention.
 *
 * N — Extra column drift: a DBA adds a column via manual DDL. Tolerant
 *     db verify passes (extras OK), strict db verify fails. Recovery
 *     by expanding the contract to include a new column, then db update.
 */

import { withClient } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runDbSchema,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey M: Manual DDL With Unchanged Marker
  // -------------------------------------------------------------------------
  describe('Journey M: Manual DDL With Unchanged Marker', () => {
    const db = useDevDatabase();

    it(
      'init → manual DDL drop → verify fails → verify --marker-only passes → verify --schema-only fails',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'M.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'M.pre: init').toBe(0);

        // Manual DDL: drop email column
        await withClient(db.connectionString, async (client) => {
          await client.query('ALTER TABLE "user" DROP COLUMN email');
        });

        // M.01: db verify (fails — schema verification detects the missing column)
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'M.01: db verify detects drift').toBe(1);

        // M.02: db verify --marker-only (passes — marker hash still matches)
        const markerOnlyVerify = await runDbVerify(ctx, ['--marker-only']);
        expect(markerOnlyVerify.exitCode, 'M.02: db verify --marker-only').toBe(0);

        // M.03: db verify --schema-only (fails — missing email column)
        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerify.exitCode, 'M.03: db verify --schema-only fails').toBe(1);

        // M.04: db schema (shows schema without email)
        const schema = await runDbSchema(ctx);
        expect(schema.exitCode, 'M.04: db schema').toBe(0);

        // M.05: db update recovery
        // The planner cannot re-add a dropped NOT NULL column to an existing table
        // because Postgres requires a DEFAULT for NOT NULL columns on non-empty tables
        // (even if the table is technically empty, the planner validates post-update schema).
        // db update correctly detects the drift but the runner fails (PN-RUN-3020).
        // Recovery in this scenario requires manual DDL or db init with a fresh database.
        const update = await runDbUpdate(ctx, ['-y']);
        expect(update.exitCode, 'M.05: db update detects unrecoverable drift').toBe(1);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey N: Manual DDL Added Extra Column
  // -------------------------------------------------------------------------
  describe('Journey N: Extra Column Drift', () => {
    const db = useDevDatabase();

    it(
      'init → manual DDL add → verify/tolerant pass → strict fails → expand contract → update → verify',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'N.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'N.pre: init').toBe(0);

        // Manual DDL: add age column
        await withClient(db.connectionString, async (client) => {
          await client.query('ALTER TABLE "user" ADD COLUMN age int4');
        });

        // N.01: db verify (passes — marker matches and tolerant schema verification allows extras)
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'N.01: db verify passes').toBe(0);

        // N.02: db verify --schema-only (passes — tolerant, extras OK)
        const tolerant = await runDbVerify(ctx, ['--schema-only']);
        expect(tolerant.exitCode, 'N.02: db verify --schema-only tolerant passes').toBe(0);

        // N.03: db verify --strict (fails — extra age column)
        const strict = await runDbVerify(ctx, ['--strict']);
        expect(strict.exitCode, 'N.03: db verify strict fails').toBe(1);

        // N.04: db schema
        const schema = await runDbSchema(ctx);
        expect(schema.exitCode, 'N.04: db schema').toBe(0);
        expect(stripAnsi(schema.stdout), 'N.04: shows age column').toContain('age');

        // N.05: Evolve contract (adds 'name' column — 'age' remains as unmanaged extra)
        swapContract(ctx, 'contract-additive');
        const emitExpanded = await runContractEmit(ctx);
        expect(emitExpanded.exitCode, 'N.05: contract emit expanded').toBe(0);

        // N.06: db update --no-interactive rejects (drift from unmanaged 'age' column
        // makes the planner classify this as destructive)
        const update = await runDbUpdate(ctx, ['--no-interactive']);
        expect(update.exitCode, 'N.06: --no-interactive rejects destructive').toBe(1);

        // N.07: db update -y explicitly accepts the destructive plan
        const updateY = await runDbUpdate(ctx, ['-y']);
        expect(updateY.exitCode, 'N.07: db update -y accepts').toBe(0);

        // N.08: db verify --schema-only tolerant (passes — all contract columns present; 'age' tolerated as extra)
        const tolerantAfter = await runDbVerify(ctx, ['--schema-only']);
        expect(tolerantAfter.exitCode, 'N.08: schema-only tolerant passes after update').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
