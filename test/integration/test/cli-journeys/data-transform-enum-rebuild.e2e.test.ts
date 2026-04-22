/**
 * Enum rebuild — `enumChangeCallStrategy` (removed-value branch)
 * end-to-end.
 *
 * Drives a contract change that drops a value from an existing
 * Postgres enum (`status: ['active', 'pending', 'archived'] →
 * ['active', 'archived']`). Removing values forces the rebuild
 * recipe: the planner's `enumChangeCallStrategy` emits
 * `DataTransformCall(placeholder slots) → createEnumType(temp) →
 * alterColumnType per dependent column → dropEnumType(old) →
 * renameType(temp, old)`. The planner-emitted `migration.ts`
 * therefore has two `placeholder("…")` stubs the user must fill in
 * to remap any rows still carrying the doomed value before the
 * rebuild swap-over. This test simulates the user editing the file
 * (string-patching the stubs and injecting a `db = sql({ context })`
 * setup), then runs `migration emit` + `migration apply` and asserts
 * the post-apply enum has only the surviving values and the doomed
 * row was remapped.
 *
 * Phase 2 acceptance: covers `migrationPlanCallStrategies` end-to-end
 * for the enum-rebuild case (plan.md AC R2.2 #4).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
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

const REMAPPED_STATUS = 'archived';

withTempDir(({ createTempDir }) => {
  describe('Journey: dataTransform — enum rebuild on dropped value (planner-assisted)', () => {
    const db = useDevDatabase();

    it(
      'planner emits placeholder() stubs the user fills in; apply remaps doomed rows + rebuilds enum',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Initial contract with three enum values; apply, then seed a
        // mix of rows including the doomed value `pending`.
        swapContract(ctx, 'contract-status-enum');
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, `emit base: ${emit0.stderr}`).toBe(0);
        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, `plan initial: ${plan0.stderr}`).toBe(0);
        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, `apply initial: ${apply0.stderr}`).toBe(0);

        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email, status) VALUES
             (1, 'alice@example.com', 'active'),
             (2, 'bob@test.org', 'pending'),
             (3, 'carol@example.com', 'archived')`,
        );

        // Swap to the shrunk enum: this is the input to
        // `enumChangeCallStrategy` (removed-value branch).
        swapContract(ctx, 'contract-status-enum-shrunk');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, `emit shrunk: ${emit1.stderr}`).toBe(0);

        const planResult = await runMigrationPlan(ctx, ['--name', 'shrink-status-enum']);
        expect(planResult.exitCode, `plan: ${planResult.stdout}\n${planResult.stderr}`).toBe(0);

        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirs = readdirSync(migrationsDir)
          .filter((d) => d.includes('shrink_status_enum'))
          .sort();
        expect(migrationDirs.length, 'planned migration dir exists').toBe(1);
        const migrationDir = join(migrationsDir, migrationDirs[0]!);
        const migrationTsPath = join(migrationDir, 'migration.ts');

        const scaffold = readFileSync(migrationTsPath, 'utf-8');
        expect(scaffold).toContain('placeholder("migrate-status-values:check")');
        expect(scaffold).toContain('placeholder("migrate-status-values:run")');
        // Rebuild recipe: createEnumType, alterColumnType,
        // dropEnumType, renameType must all appear.
        expect(scaffold).toContain('createEnumType');
        expect(scaffold).toContain('alterColumnType');
        expect(scaffold).toContain('dropEnumType');
        expect(scaffold).toContain('renameType');
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
          '    contract,',
          '    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),',
          '  }),',
          '});',
          '',
          'export default class M extends Migration {',
        ].join('\n');
        // The contract `migration.ts` imports is the *new* contract,
        // where `status` only allows ['active', 'archived']. We can't
        // reference 'pending' directly through the typed builder, so
        // the user-written queries select-by/update-by exclusion
        // against the surviving values.
        const filled = scaffold
          .replace('export default class M extends Migration {', dbSetupBlock)
          .replace(
            '() => placeholder("migrate-status-values:check")',
            "() => db.user.select('id').where((f, fns) => fns.notIn(f.status, ['active', 'archived'])).limit(1)",
          )
          .replace(
            '() => placeholder("migrate-status-values:run")',
            `() => db.user.update({ status: '${REMAPPED_STATUS}' }).where((f, fns) => fns.notIn(f.status, ['active', 'archived']))`,
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
          (op: { id: string }) => op.id === 'data_migration.migrate-status-values',
        );
        expect(dataTransformOp, 'dataTransform op exists').toBeDefined();
        expect(dataTransformOp.operationClass).toBe('data');
        expect(dataTransformOp.check).not.toBeNull();
        expect(dataTransformOp.run).toHaveLength(1);

        const apply1 = await runMigrationApply(ctx);
        expect(apply1.exitCode, `apply: ${apply1.stdout}\n${apply1.stderr}`).toBe(0);

        // Doomed row must have been remapped; surviving rows
        // unchanged.
        const dataResult = await sql(
          db.connectionString,
          `SELECT id, status::text AS status FROM "public"."user" ORDER BY id`,
        );
        expect(dataResult.rows).toEqual([
          { id: 1, status: 'active' },
          { id: 2, status: REMAPPED_STATUS },
          { id: 3, status: 'archived' },
        ]);

        // The enum type now has only the surviving values.
        const enumResult = await sql(
          db.connectionString,
          `SELECT enumlabel FROM pg_enum
            JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
            WHERE pg_type.typname = 'status'
            ORDER BY enumsortorder`,
        );
        expect(enumResult.rows).toEqual([{ enumlabel: 'active' }, { enumlabel: 'archived' }]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
