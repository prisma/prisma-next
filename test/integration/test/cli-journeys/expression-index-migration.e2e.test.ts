/**
 * Ciphers-style expression-index journey, authored through the real surfaces
 * (scenario B), plus scenario D (name change → rename) and scenario E
 * (body edit under the same name → create + drop).
 *
 * A `.prisma` contract carries the ciphers index in its literal DoD spelling
 * (`@@index(expression: "eql_v3.eq_term(email)", name: "users_email_eq",
 * type: "btree")` — the default access method normalizes away in the schema
 * IR, so the DDL carries no USING clause and verify is clean),
 * a partial index, a unique expression index, and a registry-typed
 * (`USING hash`) index; a `.ts` twin authors the same schema via
 * `constraints.index`. Both variants: emit → plan (DDL byte-asserted, the
 * expression rendered verbatim) → apply → verify clean → out-of-band drop
 * fails verify naming the index.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@prisma-next/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationPlanAndEmit,
  setupJourney,
  swapContract,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const EQL_V3_SETUP = `
  CREATE SCHEMA eql_v3;
  CREATE FUNCTION eql_v3.eq_term(t text) RETURNS text AS $$ SELECT lower(t) $$ LANGUAGE sql IMMUTABLE;
`;

const EXPECTED_INDEX_DDL = [
  'CREATE INDEX "users_email_active_0cd7caf9" ON "public"."user" ("email") WHERE ((archived_at IS NULL))',
  'CREATE INDEX "users_email_eq_adef23ad" ON "public"."user" (eql_v3.eq_term(email))',
  'CREATE INDEX "users_email_hash_239baf6b" ON "public"."user" USING "hash" ("email")',
  'CREATE UNIQUE INDEX "users_email_lower_key_f84d49fd" ON "public"."user" (lower(email))',
];

interface PlannedOp {
  readonly id: string;
  readonly execute: readonly { readonly description: string; readonly sql: string }[];
}

function readPlannedOps(ctx: JourneyContext): readonly PlannedOp[] {
  const dir = getLatestMigrationDir(ctx);
  expect(dir, 'planned migration dir exists').toBeDefined();
  return JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations/app', dir ?? '', 'ops.json'), 'utf-8'),
  );
}

function indexSqlOf(ops: readonly PlannedOp[]): string[] {
  return ops
    .filter((op) => op.id.includes('index.') || op.id.includes('Index.'))
    .flatMap((op) => (op.execute[0]?.sql !== undefined ? [op.execute[0].sql] : []));
}

async function runInitialFlow(ctx: JourneyContext, connectionString: string): Promise<void> {
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

  const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'initial']);
  expect(plan.exitCode, `migration plan\n${stripAnsi(plan.stderr)}`).toBe(0);
  expect(indexSqlOf(readPlannedOps(ctx)).sort(), 'byte-exact index DDL').toEqual(
    EXPECTED_INDEX_DDL,
  );

  const apply = await runMigrate(ctx);
  expect(apply.exitCode, `migration apply\n${stripAnsi(apply.stderr)}`).toBe(0);

  const verify = await runDbVerify(ctx);
  expect(verify.exitCode, `db verify clean\n${stripAnsi(verify.stderr)}`).toBe(0);

  await withClient(connectionString, (client) =>
    client.query('DROP INDEX "public"."users_email_eq_adef23ad"'),
  );
  const verifyFail = await runDbVerify(ctx, ['--schema-only']);
  expect(verifyFail.exitCode, 'verify fails after out-of-band drop').toBe(1);
  expect(
    stripAnsi(verifyFail.stderr) + stripAnsi(verifyFail.stdout),
    'verify names the dropped index',
  ).toContain('users_email_eq_adef23ad');

  await withClient(connectionString, (client) =>
    client.query(
      'CREATE INDEX "users_email_eq_adef23ad" ON "public"."user" (eql_v3.eq_term(email))',
    ),
  );
  const verifyRestored = await runDbVerify(ctx);
  expect(verifyRestored.exitCode, 'verify clean after restore').toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('expression-index authoring journey — PSL (scenarios B, D, E)', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(EQL_V3_SETUP)),
    });

    it(
      'plans byte-exact DDL, applies, verifies; name change renames (D); body edit creates + drops (E)',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        swapPslContract(ctx, 'contract-expression-authored');
        await runInitialFlow(ctx, db.connectionString);

        // Scenario D: name: changes on the ciphers index, content unchanged.
        swapPslContract(ctx, 'contract-expression-authored-renamed');
        const emitRenamed = await runContractEmit(ctx);
        expect(emitRenamed.exitCode, `D: emit\n${stripAnsi(emitRenamed.stderr)}`).toBe(0);
        const planRename = await runMigrationPlanAndEmit(ctx, ['--name', 'rename-ciphers-index']);
        expect(planRename.exitCode, `D: plan\n${stripAnsi(planRename.stderr)}`).toBe(0);
        const renameOps = readPlannedOps(ctx);
        expect(
          renameOps.map((op) => ({ id: op.id, sql: op.execute[0]?.sql })),
          'D: the widening plan is exactly one rename',
        ).toEqual([
          {
            id: 'index.public.user.users_email_eq_adef23ad.rename',
            sql: 'ALTER INDEX "public"."users_email_eq_adef23ad" RENAME TO "users_email_eq_v2_adef23ad"',
          },
        ]);
        const applyRename = await runMigrate(ctx);
        expect(applyRename.exitCode, `D: apply\n${stripAnsi(applyRename.stderr)}`).toBe(0);
        const verifyRename = await runDbVerify(ctx);
        expect(verifyRename.exitCode, `D: verify clean\n${stripAnsi(verifyRename.stderr)}`).toBe(0);

        // Scenario E: the expression changes under the same name:, so the
        // hash moves and the plan is create + drop — never a rename.
        swapPslContract(ctx, 'contract-expression-authored-editedbody');
        const emitEdited = await runContractEmit(ctx);
        expect(emitEdited.exitCode, `E: emit\n${stripAnsi(emitEdited.stderr)}`).toBe(0);
        const planEdit = await runMigrationPlanAndEmit(ctx, ['--name', 'edit-ciphers-body']);
        expect(planEdit.exitCode, `E: plan\n${stripAnsi(planEdit.stderr)}`).toBe(0);
        expect(indexSqlOf(readPlannedOps(ctx)).sort(), 'E: create + drop, byte-exact').toEqual([
          'CREATE INDEX "users_email_eq_v2_449c97be" ON "public"."user" (eql_v3.eq_term(lower(email)))',
          'DROP INDEX "public"."users_email_eq_v2_adef23ad"',
        ]);
        const applyEdit = await runMigrate(ctx);
        expect(applyEdit.exitCode, `E: apply\n${stripAnsi(applyEdit.stderr)}`).toBe(0);
        const verifyEdit = await runDbVerify(ctx);
        expect(verifyEdit.exitCode, `E: verify clean\n${stripAnsi(verifyEdit.stderr)}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('expression-index authoring journey — TS twin (scenario B)', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(EQL_V3_SETUP)),
    });

    it(
      'constraints.index authors the same indexes: plan byte-exact, apply, verify, drop fails verify',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });
        swapContract(ctx, 'contract-expression-authored');
        await runInitialFlow(ctx, db.connectionString);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
