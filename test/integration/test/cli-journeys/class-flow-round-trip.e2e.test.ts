/**
 * Class-flow round trip — Phase 3 acceptance.
 *
 * Drives the full class-flow lifecycle end-to-end against a live
 * Postgres:
 *
 *   1. `migration plan` → `migration apply` against an empty
 *      database creates the initial table (`createTable` only — no
 *      placeholders, no data ops).
 *   2. Re-run `migration apply` is a no-op — `migrationsApplied: 0`
 *      and the formatted output reports "Already up to date" (per
 *      `plan.md` lines 318-323).
 *   3. Swap to a contract that both adds a nullable column and
 *      requires a data backfill, hand-author a class-flow
 *      `migration.ts` that combines `addColumn` + `dataTransform` +
 *      `setNotNull`, `migration emit` → `migration apply` succeeds
 *      and the data is correct.
 *   4. Re-running `migration apply` after the second migration is
 *      again a no-op.
 *
 * This is the broader companion to the per-strategy planner-assisted
 * e2es (`data-transform-not-null-backfill.e2e.test.ts` and
 * friends): those isolate one strategy each, this one proves the
 * whole class-flow pipeline (createTable → addColumn → dataTransform
 * → setNotNull) round-trips and is idempotent.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runMigrationApply,
  runMigrationEmit,
  runMigrationNew,
  runMigrationPlan,
  setupJourney,
  sql,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const BACKFILLED_NAME = 'unknown';

withTempDir(({ createTempDir }) => {
  describe('Journey: class-flow round trip (createTable + dataTransform + addColumn)', () => {
    const db = useDevDatabase();

    it(
      'first apply succeeds; re-apply is no-op; second migration adds + backfills + tightens; re-apply is no-op',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // -----------------------------------------------------------
        // Step 1: emit base contract → plan → apply (createTable
        // only). The base contract is `id + email`; nothing data-
        // safety touches it, so the planner emits a pure
        // `createTable` and `migration apply` runs all of it without
        // any user intervention.
        // -----------------------------------------------------------
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, `emit base: ${emit0.stderr}`).toBe(0);

        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, `plan initial: ${plan0.stderr}`).toBe(0);

        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, `apply initial: ${apply0.stderr}`).toBe(0);

        // Insert seed rows so the later backfill has something to do.
        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@test.org')`,
        );

        // -----------------------------------------------------------
        // Step 2: re-running `migration apply` against an
        // already-up-to-date database must be a no-op (Phase 3 AC,
        // plan.md lines 318-323).
        // -----------------------------------------------------------
        const reapply0 = await runMigrationApply(ctx);
        expect(reapply0.exitCode, `reapply initial: ${reapply0.stderr}`).toBe(0);
        expect(reapply0.stdout).toContain('Already up to date');

        // -----------------------------------------------------------
        // Step 3: swap to the contract that adds a NOT NULL `name`
        // column. Then hand-author a class-flow `migration.ts`
        // combining `addColumn(nullable)` + `dataTransform` +
        // `setNotNull` — the same shape `notNullBackfillCallStrategy`
        // would emit, but written manually here so this test stays
        // independent of the planner-assisted strategies (which the
        // dedicated per-strategy e2es already cover).
        // -----------------------------------------------------------
        swapContract(ctx, 'contract-additive-required-name');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, `emit additive-required: ${emit1.stderr}`).toBe(0);

        const newResult = await runMigrationNew(ctx, ['--name', 'add-required-name']);
        expect(newResult.exitCode, `migration new: ${newResult.stderr}`).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirs = readdirSync(migrationsDir)
          .filter((d) => d.includes('add_required_name'))
          .sort();
        expect(migrationDirs.length, 'scaffolded migration dir exists').toBe(1);
        const migrationDir = join(migrationsDir, migrationDirs[0]!);
        const migrationTsPath = join(migrationDir, 'migration.ts');
        const manifestInitial = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );

        const migrationTs = `
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { sql } from '@prisma-next/sql-builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import { Migration, addColumn, dataTransform, setNotNull } from '@prisma-next/target-postgres/migration';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import endContract from './end-contract.json' with { type: 'json' };

const db = sql({
  context: createExecutionContext({
    contract: endContract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
  }),
});

export default class M extends Migration {
  override describe() {
    return { from: ${JSON.stringify(manifestInitial.from)}, to: ${JSON.stringify(manifestInitial.to)} };
  }

  override get operations() {
    return [
      addColumn('public', 'user', { name: 'name', typeSql: 'text', defaultSql: null, nullable: true }),
      dataTransform(endContract, 'backfill-user-name', {
        check: () => db.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1),
        run: () => db.user.update({ name: '${BACKFILLED_NAME}' }).where((f, fns) => fns.eq(f.name, null)),
      }),
      setNotNull('public', 'user', 'name'),
    ];
  }
}

Migration.run(import.meta.url, M);
`;
        writeFileSync(migrationTsPath, migrationTs);

        const emitResult = await runMigrationEmit(ctx, [
          '--dir',
          migrationDir,
          '--config',
          ctx.configPath,
        ]);
        expect(emitResult.exitCode, `emit: ${emitResult.stdout}\n${emitResult.stderr}`).toBe(0);

        const opsAfterEmit = JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8'));
        const opIds = opsAfterEmit.map((op: { id: string }) => op.id);
        // Class-flow shape: addColumn → dataTransform → setNotNull.
        expect(opIds).toContain('column.user.name');
        expect(opIds).toContain('data_migration.backfill-user-name');
        expect(opIds.some((id: string) => id.includes('setNotNull.user.name'))).toBe(true);

        const apply1 = await runMigrationApply(ctx);
        expect(apply1.exitCode, `apply add-required-name: ${apply1.stderr}`).toBe(0);

        const result = await sql(
          db.connectionString,
          `SELECT id, email, "name" FROM "public"."user" ORDER BY id`,
        );
        expect(result.rows).toEqual([
          { id: 1, email: 'alice@example.com', name: BACKFILLED_NAME },
          { id: 2, email: 'bob@test.org', name: BACKFILLED_NAME },
        ]);

        const colInfo = await sql(
          db.connectionString,
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'name'`,
        );
        expect(colInfo.rows).toEqual([{ is_nullable: 'NO' }]);

        // -----------------------------------------------------------
        // Step 4: re-apply after the second migration must again be
        // a no-op. This exercises both that the marker advanced past
        // the second migration and that the data-transform op is
        // idempotency-skipped on re-run (its `check` returns 0 rows
        // because the previous apply backfilled all NULLs).
        // -----------------------------------------------------------
        const reapply1 = await runMigrationApply(ctx);
        expect(reapply1.exitCode, `reapply second: ${reapply1.stderr}`).toBe(0);
        expect(reapply1.stdout).toContain('Already up to date');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
