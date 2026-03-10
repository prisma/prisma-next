/**
 * Journeys F + G + H: Brownfield Adoption
 *
 * Journey F: Adopt Prisma Next on an existing database with tables.
 * Journey G: Brownfield with schema mismatch.
 * Journey H: Brownfield with extra tables (strict vs tolerant).
 */

import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbIntrospect,
  runDbSchemaVerify,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapContract,
} from '../utils/journey-test-helpers';

const CREATE_USER_TABLE = `
  CREATE TABLE "user" (
    id int4 PRIMARY KEY,
    email text NOT NULL
  );
`;

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey F: Brownfield Adoption
  // -------------------------------------------------------------------------
  describe('Journey F: Brownfield Adoption', () => {
    let connectionString: string;
    let closeDb: () => Promise<void>;

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
      // Create pre-existing table via raw SQL
      await withClient(connectionString, async (client) => {
        await client.query(CREATE_USER_TABLE);
      });
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'introspect → emit → schema-verify → sign → verify → evolve → db update',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // F.01: db introspect
        const introspect = await runDbIntrospect(ctx);
        expect(introspect.exitCode, 'F.01: db introspect').toBe(0);
        expect(stripAnsi(introspect.stdout), 'F.01: shows user table').toContain('user');

        // F.02: contract emit (base contract matches existing schema)
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'F.02: contract emit').toBe(0);

        // F.03: db schema-verify
        const schemaVerify = await runDbSchemaVerify(ctx);
        expect(schemaVerify.exitCode, 'F.03: db schema-verify').toBe(0);

        // F.04: db sign
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, 'F.04: db sign').toBe(0);

        // F.05: db verify
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'F.05: db verify').toBe(0);

        // F.06: Swap to additive, contract emit
        swapContract(ctx, 'contract-additive');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'F.06: contract emit v2').toBe(0);

        // F.07: db update (applies additive changes directly)
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'F.07: db update').toBe(0);

        // F.09: db sign --json
        const signJson = await runDbSign(ctx, ['--json']);
        expect(signJson.exitCode, 'F.09: db sign json').toBe(0);
        const signData = parseJsonOutput(signJson);
        expect(signData, 'F.09: json ok').toMatchObject({ ok: true });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey G: Brownfield with Schema Mismatch
  // -------------------------------------------------------------------------
  describe('Journey G: Brownfield Mismatch', () => {
    let connectionString: string;
    let closeDb: () => Promise<void>;

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
      await withClient(connectionString, async (client) => {
        await client.query(CREATE_USER_TABLE);
      });
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'introspect → emit mismatch → schema-verify fails → sign fails → fix → pass',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // G.01: db introspect
        const introspect = await runDbIntrospect(ctx);
        expect(introspect.exitCode, 'G.01: db introspect').toBe(0);

        // G.02: Swap to additive contract (has 'name' column DB doesn't have), emit
        swapContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'G.02: contract emit mismatch').toBe(0);

        // G.03: db schema-verify (fails — missing column)
        const schemaVerifyFail = await runDbSchemaVerify(ctx);
        expect(schemaVerifyFail.exitCode, 'G.03: db schema-verify fails').not.toBe(0);

        // G.04: db sign (fails — schema verification fails first)
        const signFail = await runDbSign(ctx);
        expect(signFail.exitCode, 'G.04: db sign fails').not.toBe(0);

        // G.05: db sign --json (fails with error envelope)
        const signJsonFail = await runDbSign(ctx, ['--json']);
        expect(signJsonFail.exitCode, 'G.05: db sign json fails').not.toBe(0);
        const signError = parseJsonOutput(signJsonFail);
        expect(signError, 'G.05: error envelope').toMatchObject({ ok: false });

        // G.06: Fix contract to match DB (swap back to base), emit
        swapContract(ctx, 'contract-base');
        const emitFixed = await runContractEmit(ctx);
        expect(emitFixed.exitCode, 'G.06: contract emit fixed').toBe(0);

        // G.07: db schema-verify (passes)
        const schemaVerifyPass = await runDbSchemaVerify(ctx);
        expect(schemaVerifyPass.exitCode, 'G.07: db schema-verify passes').toBe(0);

        // G.08: db sign (succeeds)
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, 'G.08: db sign').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey H: Brownfield with Extra Tables (Strict vs. Tolerant)
  // -------------------------------------------------------------------------
  describe('Journey H: Brownfield Extras', () => {
    let connectionString: string;
    let closeDb: () => Promise<void>;

    beforeAll(async () => {
      const db = await createDevDatabase();
      connectionString = db.connectionString;
      closeDb = db.close;
      // Create user + extra audit_log table
      await withClient(connectionString, async (client) => {
        await client.query(CREATE_USER_TABLE);
        await client.query(`
          CREATE TABLE "audit_log" (
            id int4 PRIMARY KEY,
            action text NOT NULL
          );
        `);
      });
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await closeDb();
    });

    it(
      'schema-verify tolerant passes → strict fails → sign succeeds',
      async () => {
        const ctx: JourneyContext = setupJourney({ connectionString, createTempDir });

        // Emit base contract (only defines user table)
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'H.pre: emit').toBe(0);

        // H.01: db schema-verify (tolerant — extras OK)
        const tolerant = await runDbSchemaVerify(ctx);
        expect(tolerant.exitCode, 'H.01: schema-verify tolerant passes').toBe(0);

        // H.02: db schema-verify --strict (fails — extra audit_log)
        const strict = await runDbSchemaVerify(ctx, ['--strict']);
        expect(strict.exitCode, 'H.02: schema-verify strict fails').not.toBe(0);

        // H.03: db sign (uses tolerant verification — succeeds)
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, 'H.03: db sign succeeds').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
