/**
 * NOT-NULL backfill — `notNullBackfillCallStrategy` end-to-end.
 *
 * Drives a contract change that adds a non-nullable column with no
 * default. The Postgres planner's `notNullBackfillCallStrategy`
 * matches this and emits
 * `addColumn(nullable) → DataTransformCall(placeholder slots) →
 * setNotNull`. The planner-emitted `migration.ts` therefore has two
 * `placeholder("…")` stubs the user must fill in. This test simulates
 * the user editing the file (string-patching the stubs and injecting a
 * `db = sql({ context })` setup), then runs `migration emit` +
 * `migration apply` and asserts the post-apply data has been
 * backfilled and the column is NOT NULL.
 *
 * Phase 2 acceptance: covers `migrationPlanCallStrategies` end-to-end
 * for the NOT-NULL backfill case (plan.md AC R2.2 #1).
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
  runMigrationPlan,
  setupJourney,
  sql,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const BACKFILLED_NAME = 'unknown';

withTempDir(({ createTempDir }) => {
  describe('Journey: dataTransform — NOT NULL backfill (planner-assisted)', () => {
    const db = useDevDatabase();

    it(
      'planner emits placeholder() stubs the user fills in; apply backfills + sets NOT NULL',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, `emit base: ${emit0.stderr}`).toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, `plan initial: ${plan0.stderr}`).toBe(0);
        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, `apply initial: ${apply0.stderr}`).toBe(0);

        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@test.org')`,
        );

        // The contract swap is the input to `notNullBackfillCallStrategy`:
        // an existing table gains a NOT NULL column with no default.
        swapContract(ctx, 'contract-additive-required-name');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, `emit required-name: ${emit1.stderr}`).toBe(0);

        const planResult = await runMigrationPlan(ctx, ['--name', 'add-required-name']);
        expect(planResult.exitCode, `plan: ${planResult.stdout}\n${planResult.stderr}`).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirs = readdirSync(migrationsDir)
          .filter((d) => d.includes('add_required_name'))
          .sort();
        expect(migrationDirs.length, 'planned migration dir exists').toBe(1);
        const migrationDir = join(migrationsDir, migrationDirs[0]!);
        const migrationTsPath = join(migrationDir, 'migration.ts');

        const scaffold = readFileSync(migrationTsPath, 'utf-8');
        expect(scaffold).toContain("placeholder('backfill-user-name:check')");
        expect(scaffold).toContain("placeholder('backfill-user-name:run')");
        const manifestBefore = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        expect(manifestBefore.migrationId).toBeNull();

        const dbSetupBlock = [
          `import postgresAdapter from '@prisma-next/adapter-postgres/runtime';`,
          `import { sql } from '@prisma-next/sql-builder/runtime';`,
          `import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';`,
          `import postgresTarget from '@prisma-next/target-postgres/runtime';`,
          '',
          'const db = sql({',
          '  context: createExecutionContext({',
          '    contract: endContract,',
          '    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),',
          '  }),',
          '});',
          '',
          'export default class M extends Migration {',
        ].join('\n');
        const filled = scaffold
          .replace('export default class M extends Migration {', dbSetupBlock)
          .replace(
            "() => placeholder('backfill-user-name:check')",
            "() => db.user.select('id').where((f, fns) => fns.eq(f.name, null)).limit(1)",
          )
          .replace(
            "() => placeholder('backfill-user-name:run')",
            `() => db.user.update({ name: '${BACKFILLED_NAME}' }).where((f, fns) => fns.eq(f.name, null))`,
          );
        expect(filled).not.toContain('placeholder(');
        expect(filled).toContain('const db = sql(');
        writeFileSync(migrationTsPath, filled);

        const emitResult = await runMigrationEmit(ctx, [
          '--dir',
          migrationDir,
          '--config',
          ctx.configPath,
        ]);
        expect(emitResult.exitCode, `emit: ${emitResult.stdout}\n${emitResult.stderr}`).toBe(0);

        const opsAfterEmit = JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8'));
        const dataTransformOp = opsAfterEmit.find(
          (op: { id: string }) => op.id === 'data_migration.backfill-user-name',
        );
        expect(dataTransformOp, 'dataTransform op exists').toBeDefined();
        expect(dataTransformOp.operationClass).toBe('data');
        expect(dataTransformOp.check).not.toBeNull();
        expect(dataTransformOp.run).toHaveLength(1);

        const manifestAfter = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        expect(manifestAfter.migrationId).toMatch(/^sha256:/);

        const apply1 = await runMigrationApply(ctx);
        expect(apply1.exitCode, `apply: ${apply1.stdout}\n${apply1.stderr}`).toBe(0);

        const result = await sql(
          db.connectionString,
          `SELECT id, email, "name" FROM "public"."user" ORDER BY id`,
        );
        expect(result.rows).toEqual([
          { id: 1, email: 'alice@example.com', name: BACKFILLED_NAME },
          { id: 2, email: 'bob@test.org', name: BACKFILLED_NAME },
        ]);

        // Verify the column is now NOT NULL — strategy ends in
        // setNotNull and apply must have executed it.
        const colInfo = await sql(
          db.connectionString,
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'name'`,
        );
        expect(colInfo.rows).toEqual([{ is_nullable: 'NO' }]);

        // Re-apply must be a no-op: the marker advanced past this
        // migration and the dataTransform op is idempotency-skipped
        // because its `check` query now returns 0 rows (all NULLs
        // were backfilled by the first apply). Pins both the
        // runner's marker-CAS ledger advance and the data-transform
        // check-driven skip path (spec AC4.2 idempotency half).
        const reapply = await runMigrationApply(ctx);
        expect(reapply.exitCode, `reapply: ${reapply.stdout}\n${reapply.stderr}`).toBe(0);
        expect(reapply.stdout).toContain('Already up to date');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
