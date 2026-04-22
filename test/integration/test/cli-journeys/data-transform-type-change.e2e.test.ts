/**
 * Type change — `typeChangeCallStrategy` end-to-end.
 *
 * Drives a contract change that retypes an existing column from
 * `text` to `int4`. That transition is unsafe (not in
 * `SAFE_WIDENINGS`), so the Postgres planner's
 * `typeChangeCallStrategy` matches it and emits
 * `DataTransformCall(placeholder slots) → alterColumnType`. The
 * planner-emitted `migration.ts` therefore has two `placeholder("…")`
 * stubs the user must fill in. This test simulates the user editing
 * the file (string-patching the stubs and injecting a
 * `db = sql({ context })` setup), then runs `migration emit` +
 * `migration apply` and asserts the post-apply column has switched
 * to `int4` with the expected integer values.
 *
 * Phase 2 acceptance: covers `migrationPlanCallStrategies` end-to-end
 * for the unsafe type-change case (plan.md AC R2.2 #2).
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

withTempDir(({ createTempDir }) => {
  describe('Journey: dataTransform — text → int4 type change (planner-assisted)', () => {
    const db = useDevDatabase();

    it(
      'planner emits placeholder() stubs the user fills in; apply normalises data + alters column type',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Initial contract: User.score is text. Apply, then seed two
        // rows whose `score` happens to be parseable as an int. The
        // user-filled `:run` query in this scenario is intentionally
        // a no-op — the goal of the test is to exercise the
        // `dataTransform → alterColumnType` pipeline end-to-end, not
        // to do any real normalisation work. (Expressing a proper
        // "score is not castable to int4" check against a text column
        // through the int4-typed ORM surface isn't currently possible
        // without an escape hatch.)
        swapContract(ctx, 'contract-typechange-text');
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, `emit base: ${emit0.stderr}`).toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, `plan initial: ${plan0.stderr}`).toBe(0);
        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, `apply initial: ${apply0.stderr}`).toBe(0);

        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email, score) VALUES (1, 'alice@example.com', '10'), (2, 'bob@test.org', '20')`,
        );

        // Swap to the int4 contract: this is the input to
        // `typeChangeCallStrategy`.
        swapContract(ctx, 'contract-typechange-int');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, `emit int: ${emit1.stderr}`).toBe(0);

        const planResult = await runMigrationPlan(ctx, ['--name', 'retype-score-to-int']);
        expect(planResult.exitCode, `plan: ${planResult.stdout}\n${planResult.stderr}`).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirs = readdirSync(migrationsDir)
          .filter((d) => d.includes('retype_score_to_int'))
          .sort();
        expect(migrationDirs.length, 'planned migration dir exists').toBe(1);
        const migrationDir = join(migrationsDir, migrationDirs[0]!);
        const migrationTsPath = join(migrationDir, 'migration.ts');

        const scaffold = readFileSync(migrationTsPath, 'utf-8');
        expect(scaffold).toContain("placeholder('typechange-user-score:check')");
        expect(scaffold).toContain("placeholder('typechange-user-score:run')");
        expect(scaffold).toContain('alterColumnType');
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
        // Both queries are guarded by `id = -1` so the test's
        // pre-cleaned seed data flows through unchanged and the
        // `alterColumnType USING score::int4` cast handles the actual
        // conversion. The point of patching the stubs is to prove the
        // planner-emitted migration is well-typed against the *new*
        // contract (where `score` is int4) and that the
        // `dataTransform → alterColumnType` pipeline runs end-to-end.
        const filled = scaffold
          .replace('export default class M extends Migration {', dbSetupBlock)
          .replace(
            "() => placeholder('typechange-user-score:check')",
            "() => db.user.select('id').where((f, fns) => fns.eq(f.id, -1)).limit(1)",
          )
          .replace(
            "() => placeholder('typechange-user-score:run')",
            '() => db.user.update({ score: 0 }).where((f, fns) => fns.eq(f.id, -1))',
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
          (op: { id: string }) => op.id === 'data_migration.typechange-user-score',
        );
        expect(dataTransformOp, 'dataTransform op exists').toBeDefined();
        expect(dataTransformOp.operationClass).toBe('data');
        expect(dataTransformOp.check).not.toBeNull();
        expect(dataTransformOp.run).toHaveLength(1);

        const alterOp = opsAfterEmit.find((op: { id: string }) =>
          op.id.startsWith('alterType.user.score'),
        );
        expect(alterOp, 'alterColumnType op exists').toBeDefined();
        expect(alterOp.operationClass).toBe('destructive');

        const apply1 = await runMigrationApply(ctx);
        expect(apply1.exitCode, `apply: ${apply1.stdout}\n${apply1.stderr}`).toBe(0);

        const result = await sql(
          db.connectionString,
          `SELECT id, email, score FROM "public"."user" ORDER BY id`,
        );
        expect(result.rows).toEqual([
          { id: 1, email: 'alice@example.com', score: 10 },
          { id: 2, email: 'bob@test.org', score: 20 },
        ]);

        // The column must now have integer storage type — the alter
        // ran and the USING cast converted text → int4.
        const colInfo = await sql(
          db.connectionString,
          `SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'score'`,
        );
        expect(colInfo.rows).toEqual([{ data_type: 'integer' }]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
