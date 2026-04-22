/**
 * Data Transform Authoring Surface (manual) — exercises the
 * consolidated `dataTransform` factory exported from
 * `@prisma-next/target-postgres/migration` end-to-end.
 *
 * This file covers the from-scratch authoring path:
 *
 * **`migration new` → hand-author the whole `migration.ts`.** The user
 * starts from an empty scaffold, writes the operations themselves
 * (`addColumn`, `dataTransform(contract, ...)`), then runs `migration
 * emit` + `migration apply`.
 *
 * The planner-assisted path (where the user fills in
 * planner-emitted `placeholder()` stubs) lives in dedicated
 * per-strategy files alongside this one
 * (`data-transform-not-null-backfill.e2e.test.ts` and friends).
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

// Sentinel value the migrations' `dataTransform.run` closures backfill
// into `user.name`. Named so the post-apply assertions read as a
// deliberate backfill rather than a placeholder/error string.
const BACKFILLED_NAME = 'unknown';

withTempDir(({ createTempDir }) => {
  describe('Journey: Data Transform Authoring (manual)', () => {
    const db = useDevDatabase();

    it(
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

        // Step 5: Fill in migration.ts with the class-flow authoring surface.
        // Uses `dataTransform(contract, name, { run })` from
        // `@prisma-next/target-postgres/migration`, wired through a
        // user-managed `sql({ context })` so the closure can build a typed
        // query plan and the factory can assert contract-hash consistency.
        const manifestInitial = JSON.parse(
          readFileSync(join(migrationDir, 'migration.json'), 'utf-8'),
        );
        const migrationTs = `
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { sql } from '@prisma-next/sql-builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import { Migration, addColumn, dataTransform } from '@prisma-next/target-postgres/migration';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import contract from './contract.json' with { type: 'json' };

const db = sql({
  context: createExecutionContext({
    contract,
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
      dataTransform(contract, 'backfill-user-name', {
        run: () => db.user.update({ name: '${BACKFILLED_NAME}' }).where((f, fns) => fns.eq(f.name, null)),
      }),
    ];
  }
}

Migration.run(import.meta.url, M);
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
          { id: 1, email: 'alice@example.com', name: BACKFILLED_NAME },
          { id: 2, email: 'bob@test.org', name: BACKFILLED_NAME },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
