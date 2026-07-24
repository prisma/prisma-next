/**
 * Index name-identity journeys (slice DoD scenarios I and A).
 *
 * Scenario I — upgrade path: a database whose indexes carry pre-slice plain
 * default names (raw SQL fixture) is adopted exactly (infer → emit → sign),
 * then the contract switches to managed authoring (unnamed `@@index`, default
 * FK-backing index). The first widening plan contains ONLY
 * `ALTER INDEX … RENAME` ops (byte-asserted); applying it converges the live
 * names to the content-hash wire names and `db verify` is clean.
 *
 * Scenario A (today's supported adoption flow) — exact-mode round-trip: a
 * database with fields-only indexes, some default-named by an old toolchain
 * and some custom-named, round-trips through `contract infer` → emit →
 * `db verify` with zero issues, and a `db update --dry-run` plans zero
 * operations.
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
  parseJsonOutput,
  runContractEmit,
  runContractInfer,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlanAndEmit,
  setupJourney,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRE_SLICE_SCHEMA = `
  CREATE TABLE "user" (
    id int4 PRIMARY KEY,
    email text NOT NULL
  );
  CREATE INDEX "user_email_idx" ON "user" (email);
  CREATE TABLE "post" (
    id int4 PRIMARY KEY,
    "userId" int4 NOT NULL REFERENCES "user"(id)
  );
  CREATE INDEX "post_userId_idx" ON "post" ("userId");
`;

interface PlannedOp {
  readonly id: string;
  readonly operationClass: string;
  readonly execute: readonly { readonly description: string; readonly sql: string }[];
}

function readPlannedOps(ctx: JourneyContext): readonly PlannedOp[] {
  const dir = getLatestMigrationDir(ctx);
  expect(dir, 'planned migration dir exists').toBeDefined();
  return JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations/app', dir ?? '', 'ops.json'), 'utf-8'),
  );
}

withTempDir(({ createTempDir }) => {
  describe('Scenario I: pre-slice default index names converge via renames only', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(PRE_SLICE_SCHEMA)),
    });

    it(
      'adopt exactly → switch to managed authoring → widening plan is renames-only → apply → verify clean',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        // I.01: adopt the live database exactly (infer emits map:-named indexes).
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `I.01: contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `I.01: contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `I.01: db sign\n${stripAnsi(sign.stderr)}`).toBe(0);

        // I.02: baseline migration (EMPTY → adopted contract); no-op on apply.
        const planBaseline = await runMigrationPlanAndEmit(ctx, ['--name', 'baseline']);
        expect(planBaseline.exitCode, 'I.02: plan baseline').toBe(0);
        const applyBaseline = await runMigrate(ctx, ['--json']);
        expect(applyBaseline.exitCode, 'I.02: apply baseline').toBe(0);
        expect(parseJsonOutput(applyBaseline), 'I.02: baseline no-op').toMatchObject({
          migrationsApplied: 0,
        });

        // I.03: switch to managed authoring — unnamed @@index + default
        // FK-backing index — and emit the re-based contract.
        swapPslContract(ctx, 'contract-index-upgrade');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, `I.03: contract emit managed\n${stripAnsi(emit2.stderr)}`).toBe(0);

        // I.04: the first widening plan is renames only, byte-asserted.
        const plan = await runMigrationPlanAndEmit(ctx, ['--name', 'converge-index-names']);
        expect(plan.exitCode, `I.04: migration plan\n${stripAnsi(plan.stderr)}`).toBe(0);
        const ops = readPlannedOps(ctx);
        expect(
          ops.map((op) => ({
            id: op.id,
            operationClass: op.operationClass,
            sql: op.execute[0]?.sql,
          })),
          'I.04: renames only',
        ).toEqual([
          {
            id: 'index.public.post.post_userId_idx.rename',
            operationClass: 'widening',
            sql: 'ALTER INDEX "public"."post_userId_idx" RENAME TO "post_userId_idx_a489d58a"',
          },
          {
            id: 'index.public.user.user_email_idx.rename',
            operationClass: 'widening',
            sql: 'ALTER INDEX "public"."user_email_idx" RENAME TO "user_email_idx_46df9cad"',
          },
        ]);

        // I.05: apply the renames.
        const apply = await runMigrate(ctx, ['--json']);
        expect(apply.exitCode, `I.05: migration apply\n${stripAnsi(apply.stderr)}`).toBe(0);
        expect(parseJsonOutput(apply), 'I.05: one migration applied').toMatchObject({
          migrationsApplied: 1,
        });

        // I.06: verify clean; the live catalog carries the wire names.
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `I.06: db verify\n${stripAnsi(verify.stderr)}`).toBe(0);
        await withClient(db.connectionString, async (client) => {
          const rows = await client.query<{ indexname: string }>(
            `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
          );
          const names = rows.rows.map((r) => r.indexname);
          expect(names).toContain('user_email_idx_46df9cad');
          expect(names).toContain('post_userId_idx_a489d58a');
          expect(names).not.toContain('user_email_idx');
          expect(names).not.toContain('post_userId_idx');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Scenario A: exact-mode adoption round-trip on fields-only indexes', () => {
    const db = useDevDatabase({
      onReady: (cs) =>
        withClient(cs, (client) =>
          client.query(`
            CREATE TABLE "account" (
              id int4 PRIMARY KEY,
              email text NOT NULL,
              name text NOT NULL
            );
            CREATE INDEX "account_email_idx" ON "account" (email);
            CREATE INDEX "email_lookup" ON "account" (name, email);
          `),
        ),
    });

    it(
      'infer → emit → verify zero issues → sign → db update dry-run plans zero ops',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `A.01: contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const inferredPsl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(inferredPsl, 'A.01: default-named index adopted exactly').toContain(
          '@@index([email], map: "account_email_idx")',
        );
        expect(inferredPsl, 'A.01: custom-named index adopted exactly').toContain(
          '@@index([name, email], map: "email_lookup")',
        );

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `A.02: contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        const schemaVerify = await runDbVerify(ctx, ['--schema-only', '--json']);
        expect(schemaVerify.exitCode, 'A.03: schema verify zero issues').toBe(0);
        expect(parseJsonOutput(schemaVerify), 'A.03: no issues').toMatchObject({
          ok: true,
          schema: { issues: [] },
        });

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `A.04: db sign\n${stripAnsi(sign.stderr)}`).toBe(0);
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'A.05: db verify').toBe(0);

        // Zero drift ⇒ a dry-run update plans nothing.
        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `A.06: db update dry-run\n${stripAnsi(dryRun.stderr)}`).toBe(0);
        expect(parseJsonOutput(dryRun), 'A.06: zero operations').toMatchObject({
          ok: true,
          plan: { operations: [] },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
