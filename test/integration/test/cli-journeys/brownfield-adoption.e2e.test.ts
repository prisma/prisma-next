/**
 * Brownfield Adoption (Journeys F + G)
 *
 * F — Adopt Prisma on an existing database: introspect the live schema, emit a
 *     matching contract, verify --schema-only, sign the marker, then evolve via db update.
 *
 * G — Brownfield with schema mismatch: emit a contract that doesn't match the
 *     database (extra column), observe verify --schema-only and sign failures, fix the
 *     contract to match, and successfully sign.
 */

import { withClient } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbIntrospect,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
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
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(CREATE_USER_TABLE)),
    });

    it(
      'introspect → emit → verify --schema-only → sign → verify → evolve → db update',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // F.01: db introspect (writes PSL file by default)
        const introspect = await runDbIntrospect(ctx);
        expect(introspect.exitCode, 'F.01: db introspect').toBe(0);
        expect(stripAnsi(introspect.stderr), 'F.01: success message').toContain(
          'Schema written to',
        );

        // F.02: contract emit (base contract matches existing schema)
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'F.02: contract emit').toBe(0);

        // F.03: db verify --schema-only
        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerify.exitCode, 'F.03: db verify --schema-only').toBe(0);

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

        // F.08: db sign --json
        const signJson = await runDbSign(ctx, ['--json']);
        expect(signJson.exitCode, 'F.08: db sign json').toBe(0);
        const signData = parseJsonOutput(signJson);
        expect(signData, 'F.08: json ok').toMatchObject({ ok: true });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey G: Brownfield with Schema Mismatch
  // -------------------------------------------------------------------------
  describe('Journey G: Brownfield Mismatch', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(CREATE_USER_TABLE)),
    });

    it(
      'introspect → emit mismatch → verify --schema-only fails → sign fails → fix → pass',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // G.01: db introspect
        const introspect = await runDbIntrospect(ctx);
        expect(introspect.exitCode, 'G.01: db introspect').toBe(0);

        // G.02: Swap to additive contract (has 'name' column DB doesn't have), emit
        swapContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'G.02: contract emit mismatch').toBe(0);

        // G.03: db verify --schema-only (fails — missing column)
        const schemaVerifyFail = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerifyFail.exitCode, 'G.03: db verify --schema-only fails').toBe(1);

        // G.04: db sign (fails — schema verification fails first)
        const signFail = await runDbSign(ctx);
        expect(signFail.exitCode, 'G.04: db sign fails').toBe(1);

        // G.05: db sign --json (fails with error envelope)
        const signJsonFail = await runDbSign(ctx, ['--json']);
        expect(signJsonFail.exitCode, 'G.05: db sign json fails').toBe(1);
        const signError = parseJsonOutput(signJsonFail);
        expect(signError, 'G.05: error envelope').toMatchObject({ ok: false });

        // G.06: Fix contract to match DB (swap back to base), emit
        swapContract(ctx, 'contract-base');
        const emitFixed = await runContractEmit(ctx);
        expect(emitFixed.exitCode, 'G.06: contract emit fixed').toBe(0);

        // G.07: db verify --schema-only (passes)
        const schemaVerifyPass = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerifyPass.exitCode, 'G.07: db verify --schema-only passes').toBe(0);

        // G.08: db sign (succeeds)
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, 'G.08: db sign').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
