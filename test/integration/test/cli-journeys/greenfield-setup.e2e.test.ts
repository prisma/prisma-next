/**
 * Greenfield Setup (Journey A)
 *
 * A developer starts a new project with an empty database and walks through
 * the full initialization lifecycle: emit a contract, dry-run the init to
 * preview planned operations, apply it for real, confirm idempotency on
 * re-run, then verify the marker and schema (tolerant and strict). Finishes
 * with introspection and JSON output variants of verify/schema-verify.
 */

import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  runDbIntrospect,
  runDbSchemaVerify,
  runDbVerify,
  setupJourney,
  sql,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey A: Greenfield Setup', () => {
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
      'emit → init → verify → introspect (full greenfield workflow)',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // A.01: contract emit
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'A.01: contract emit').toBe(0);

        // A.02: db init --dry-run
        const dryRun = await runDbInit(ctx, ['--dry-run']);
        expect(dryRun.exitCode, 'A.02: db init dry-run').toBe(0);
        expect(stripAnsi(dryRun.stdout), 'A.02: shows planned ops').toContain('Planned');
        expect(stripAnsi(dryRun.stdout), 'A.02: mentions dry run').toContain('dry run');
        // Verify database not modified
        const tablesAfterDryRun = await sql(
          connectionString,
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user'`,
        );
        expect(tablesAfterDryRun.rows.length, 'A.02: no tables created').toBe(0);

        // A.03: db init
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'A.03: db init').toBe(0);
        expect(stripAnsi(init.stdout), 'A.03: reports applied').toContain('Applied');
        // Verify table created
        const tablesAfterInit = await sql(
          connectionString,
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user'`,
        );
        expect(tablesAfterInit.rows.length, 'A.03: user table created').toBe(1);
        // Verify marker created
        const marker = await sql(
          connectionString,
          'SELECT core_hash, profile_hash FROM prisma_contract.marker WHERE id = 1',
        );
        expect(marker.rows.length, 'A.03: marker created').toBe(1);
        expect(marker.rows[0]?.['core_hash'], 'A.03: marker has core_hash').toBeDefined();

        // A.04: db init (idempotent)
        const initAgain = await runDbInit(ctx);
        expect(initAgain.exitCode, 'A.04: db init idempotent').toBe(0);
        expect(stripAnsi(initAgain.stdout), 'A.04: reports already matches').toContain('already');

        // A.05: db verify
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'A.05: db verify').toBe(0);

        // A.06: db schema-verify
        const schemaVerify = await runDbSchemaVerify(ctx);
        expect(schemaVerify.exitCode, 'A.06: db schema-verify').toBe(0);

        // A.07: db schema-verify --strict
        const schemaVerifyStrict = await runDbSchemaVerify(ctx, ['--strict']);
        expect(schemaVerifyStrict.exitCode, 'A.07: db schema-verify strict').toBe(0);

        // A.08: db introspect
        const introspect = await runDbIntrospect(ctx);
        expect(introspect.exitCode, 'A.08: db introspect').toBe(0);
        expect(stripAnsi(introspect.stdout), 'A.08: shows user table').toContain('user');

        // A.09: db verify --json
        const verifyJson = await runDbVerify(ctx, ['--json']);
        expect(verifyJson.exitCode, 'A.09: db verify json').toBe(0);
        const verifyData = parseJsonOutput(verifyJson);
        expect(verifyData, 'A.09: json ok').toMatchObject({
          ok: true,
          contract: { storageHash: expect.any(String) },
          marker: { storageHash: expect.any(String) },
        });

        // A.10: db schema-verify --json
        const schemaVerifyJson = await runDbSchemaVerify(ctx, ['--json']);
        expect(schemaVerifyJson.exitCode, 'A.10: db schema-verify json').toBe(0);
        const svData = parseJsonOutput(schemaVerifyJson);
        expect(svData, 'A.10: json ok').toMatchObject({ ok: true });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
