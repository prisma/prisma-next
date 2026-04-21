/**
 * Data Transform Authoring Surface (Journey: migration new → emit → ops)
 *
 * Tests the authoring pipeline end-to-end:
 * 1. Set up a project with a base contract, plan + apply initial migration
 * 2. Swap to additive contract (adds a nullable column)
 * 3. Emit the new contract
 * 4. migration new → scaffolds package with migration.ts
 * 5. Fill in migration.ts with descriptors + dataTransform (raw_sql)
 * 6. migration emit → evaluates TS, resolves descriptors, writes ops.json, attests
 * 7. Inspect ops.json — verify the ops are correct
 * 8. migration apply → executes ops including data transform
 * 9. Verify data was transformed
 *
 * SKIPPED: This test exercises the descriptor-flow data transform authoring
 * surface (createBuilders, resolveDescriptors). Postgres now uses the
 * class-flow pipeline (postgresEmit). The class-flow data transform authoring
 * surface (user-editable DataTransformCall closures) is not yet complete.
 * Re-enable once the class-flow dataTransform factory is exported and supports
 * user-provided check/run closures.
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
  runMigrationNew,
  runMigrationPlan,
  setupJourney,
  sql,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey: Data Transform Authoring', () => {
    const db = useDevDatabase();

    it.skip(
      'migration new → fill migration.ts → emit → apply → data correct',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Step 1: Emit base contract, plan, apply (creates user table with id + email)
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, `emit base: ${emit0.stderr}`).toBe(0);

        const plan0 = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan0.exitCode, `plan initial: ${plan0.stderr}`).toBe(0);

        const apply0 = await runMigrationApply(ctx);
        expect(apply0.exitCode, `apply initial: ${apply0.stderr}`).toBe(0);

        // Step 2: Insert test data
        await sql(
          db.connectionString,
          `INSERT INTO "public"."user" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@test.org')`,
        );

        // Step 3: Swap to additive contract (adds nullable 'name' column)
        swapContract(ctx, 'contract-additive');
        const emit1 = await runContractEmit(ctx);
        expect(emit1.exitCode, `emit additive: ${emit1.stderr}`).toBe(0);

        // Step 4: migration new → scaffolds package
        const newResult = await runMigrationNew(ctx, ['--name', 'add-name']);
        expect(newResult.exitCode, `migration new: ${newResult.stdout}\n${newResult.stderr}`).toBe(
          0,
        );

        // Find the scaffolded migration directory
        const migrationsDir = join(ctx.testDir, 'migrations');
        const migrationDirs = readdirSync(migrationsDir)
          .filter((d) => d.includes('add_name'))
          .sort();
        expect(migrationDirs.length, 'scaffolded migration dir exists').toBe(1);
        const migrationDir = join(migrationsDir, migrationDirs[0]!);

        // Verify migration.ts was scaffolded
        const migrationTsPath = join(migrationDir, 'migration.ts');
        const scaffoldContent = readFileSync(migrationTsPath, 'utf-8');
        expect(scaffoldContent).toContain('export default');

        // Verify ops.json is empty (draft)
        const opsBeforeVerify = JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8'));
        expect(opsBeforeVerify).toEqual([]);

        // Verify manifest is draft (migrationId: null)
        const manifestBefore = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        expect(manifestBefore.migrationId).toBeNull();

        // Step 5: Fill in migration.ts with descriptors using typed query builder
        const migrationTs = `
import { createBuilders } from "@prisma-next/target-postgres/migration-builders"

const { addColumn, dataTransform } = createBuilders()

export default () => [
  addColumn("user", "name"),
  dataTransform("backfill-user-name", {
    check: false,
    run: (db) => db.user.update({ name: "unknown" }).where((f, fns) => fns.eq(f.name, null)),
  }),
]
`;
        writeFileSync(migrationTsPath, migrationTs);

        // Step 6: migration emit → evaluates TS, resolves, attests
        const emitResult = await runMigrationEmit(ctx, [
          '--dir',
          migrationDir,
          '--config',
          ctx.configPath,
        ]);
        expect(emitResult.exitCode, `emit: ${emitResult.stdout}\n${emitResult.stderr}`).toBe(0);

        // Step 7: Inspect ops.json after emit
        const opsAfterEmit = JSON.parse(readFileSync(join(migrationDir, 'ops.json'), 'utf-8'));
        expect(opsAfterEmit.length).toBeGreaterThan(0);

        const addColumnOp = opsAfterEmit.find((op: { id: string }) => op.id === 'column.user.name');
        expect(addColumnOp, 'addColumn op exists').toBeDefined();
        expect(addColumnOp.operationClass).toBe('additive');

        const dataTransformOp = opsAfterEmit.find(
          (op: { id: string }) => op.id === 'data_migration.backfill-user-name',
        );
        expect(dataTransformOp, 'dataTransform op exists').toBeDefined();
        expect(dataTransformOp.operationClass).toBe('data');

        // Manifest should now be attested
        const manifestAfter = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        expect(manifestAfter.migrationId).not.toBeNull();
        expect(manifestAfter.migrationId).toMatch(/^sha256:/);

        // Step 8: migration apply → executes ops
        const apply1 = await runMigrationApply(ctx);
        expect(apply1.exitCode, `apply: ${apply1.stdout}\n${apply1.stderr}`).toBe(0);

        // Step 9: Verify data was transformed
        const result = await sql(
          db.connectionString,
          `SELECT id, email, "name" FROM "public"."user" ORDER BY id`,
        );
        expect(result.rows).toEqual([
          { id: 1, email: 'alice@example.com', name: 'unknown' },
          { id: 2, email: 'bob@test.org', name: 'unknown' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
