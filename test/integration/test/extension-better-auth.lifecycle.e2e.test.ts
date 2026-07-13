/**
 * Managed extension-space lifecycle for `@prisma-next/extension-better-auth`
 * against PGlite, driven end-to-end through the public CLI surface
 * (in-process commands, same pattern as the cli-journeys suite):
 *
 *   contract emit → migration plan (seeds `migrations/better-auth/` from
 *   the pack descriptor) → db init (applies the space's baseline migration
 *   plus the app space) → db update (no-op at head) → db verify (clean).
 *
 * The space is **managed**: the framework owns the auth tables' DDL. The
 * assertions cover exactly that claim — the four BetterAuth core tables
 * exist after `db init` with their unique constraints (`user.email`,
 * `session.token`) and foreign keys (`session.userId → user.id`,
 * `account.userId → user.id`) verified via catalog introspection, the
 * space marker sits at the pack's published head ref, and a subsequent
 * `db update` at head plans zero operations.
 *
 * No manual SQL participates in the lifecycle: schema state is produced
 * only by the CLI commands; raw queries below are read-only catalog
 * introspection.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import betterAuthPack from '@prisma-next/extension-better-auth/pack';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runDbVerify,
  runMigrationPlan,
  sql,
  timeouts,
  useDevDatabase,
} from './utils/journey-test-helpers';

const CORE_TABLES = ['user', 'session', 'account', 'verification'] as const;

function requireContractSpace(): NonNullable<typeof betterAuthPack.contractSpace> {
  const space = betterAuthPack.contractSpace;
  if (!space) {
    throw new Error('betterAuthPack must declare a contractSpace');
  }
  return space;
}

/**
 * Lists constraints of the given type on a `public`-schema table as
 * `{ columns, referencesTable, onDelete }` records (read-only catalog
 * introspection). `onDelete` carries pg_constraint's `confdeltype` action
 * character for foreign keys ('c' = CASCADE, 'a' = NO ACTION) and null for
 * other constraint types.
 */
async function constraintsOf(
  connectionString: string,
  table: string,
  contype: 'u' | 'f',
): Promise<
  ReadonlyArray<{ columns: string; referencesTable: string | null; onDelete: string | null }>
> {
  const result = await sql(
    connectionString,
    `SELECT array_to_string(
              array_agg(att.attname ORDER BY ord.ordinality), ','
            ) AS columns,
            CASE WHEN con.contype = 'f' THEN confrel.relname ELSE NULL END AS references_table,
            CASE WHEN con.contype = 'f' THEN con.confdeltype::text ELSE NULL END AS on_delete
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       LEFT JOIN pg_class confrel ON confrel.oid = con.confrelid
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
      WHERE nsp.nspname = 'public' AND rel.relname = $1 AND con.contype = $2
      GROUP BY con.conname, con.contype, confrel.relname, con.confdeltype
      ORDER BY 1`,
    [table, contype],
  );
  return result.rows.map((row) => ({
    columns: String(row['columns']),
    referencesTable: row['references_table'] === null ? null : String(row['references_table']),
    onDelete: row['on_delete'] === null ? null : String(row['on_delete']),
  }));
}

withTempDir(({ createTempDir }) => {
  describe('extension-better-auth managed-space lifecycle (PGlite)', () => {
    const db = useDevDatabase();

    function setupLifecycleApp(): JourneyContext {
      const testSetup = setupTestDirectoryFromFixtures(
        createTempDir,
        'better-auth-lifecycle',
        'prisma-next.config.with-db.ts',
        { '{{DB_URL}}': db.connectionString },
      );
      return {
        testDir: testSetup.testDir,
        configPath: testSetup.configPath,
        outputDir: testSetup.outputDir,
      };
    }

    it(
      'emit → plan (seed) → init creates the four tables → update no-op at head → verify clean',
      async () => {
        const space = requireContractSpace();
        const ctx = setupLifecycleApp();

        // Step 1: contract emit — folds the pack's space into the aggregate.
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'contract emit').toBe(0);

        // Step 2: migration plan — seeds the descriptor-shipped migrations
        // into migrations/better-auth/ and scaffolds the app-space plan.
        const plan = await runMigrationPlan(ctx, ['--name', 'app_init']);
        expect(plan.exitCode, 'migration plan').toBe(0);

        const baselineDirName = space.migrations[0]?.dirName;
        expect(baselineDirName, 'pack ships a baseline migration').toBeDefined();
        expect(
          existsSync(join(ctx.testDir, 'migrations', 'better-auth', baselineDirName!, 'ops.json')),
          'seed phase materialised the baseline migration package on disk',
        ).toBe(true);
        const seededHead = JSON.parse(
          readFileSync(
            join(ctx.testDir, 'migrations', 'better-auth', 'refs', 'head.json'),
            'utf-8',
          ),
        ) as { hash: string };
        expect(seededHead.hash, 'seeded head ref matches the pack').toBe(space.headRef.hash);

        // Step 3: db init — the framework walks the space's migration to head.
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'db init').toBe(0);

        for (const table of CORE_TABLES) {
          const reg = await sql(
            db.connectionString,
            `select to_regclass('public."${table}"') is not null as exists`,
          );
          expect(reg.rows[0]?.['exists'], `table "${table}" created by db init`).toBe(true);
        }

        expect(await constraintsOf(db.connectionString, 'user', 'u')).toEqual([
          { columns: 'email', referencesTable: null, onDelete: null },
        ]);
        expect(await constraintsOf(db.connectionString, 'session', 'u')).toEqual([
          { columns: 'token', referencesTable: null, onDelete: null },
        ]);
        // BetterAuth's canonical schema declares ON DELETE CASCADE on both
        // user references ('c' in pg_constraint.confdeltype).
        expect(await constraintsOf(db.connectionString, 'session', 'f')).toEqual([
          { columns: 'userId', referencesTable: 'user', onDelete: 'c' },
        ]);
        expect(await constraintsOf(db.connectionString, 'account', 'f')).toEqual([
          { columns: 'userId', referencesTable: 'user', onDelete: 'c' },
        ]);

        // The space marker records the walk to head.
        const marker = await sql(
          db.connectionString,
          "select core_hash from prisma_contract.marker where space = 'better-auth'",
        );
        expect(marker.rows, 'better-auth space marker written').toHaveLength(1);
        expect(marker.rows[0]?.['core_hash'], 'marker sits at the published head').toBe(
          space.headRef.hash,
        );

        // Step 4: db update at head — plans zero operations, applies nothing.
        const dryRun = await runDbUpdate(ctx, ['--dry-run']);
        expect(dryRun.exitCode, 'db update --dry-run').toBe(0);
        expect(stripAnsi(dryRun.stdout), 'dry-run plans zero operations').toContain(
          'Planned 0 operation(s)',
        );

        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'db update').toBe(0);
        expect(stripAnsi(update.stdout), 'update reports no-op').toContain(
          'Database already matches contract',
        );

        // Step 5: verification is clean at head.
        const verify = await runDbVerify(ctx, ['--json']);
        expect(verify.exitCode, 'db verify').toBe(0);
        expect(parseJsonOutput(verify), 'verify reports ok').toMatchObject({ ok: true });

        const verifyStrict = await runDbVerify(ctx, ['--strict']);
        expect(verifyStrict.exitCode, 'db verify --strict').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
