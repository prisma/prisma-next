/**
 * Spike test for the v2 SQL fanout. Two scenarios:
 *
 *   1. Common-cols-only: drops a column and preserves remaining data
 *      (mirrors the test in destructive.test.ts that uses int/text).
 *   2. With inline extras: a contract that uses a `datetime` column
 *      passed via the three-arg overload. Proves new column types can
 *      be added without touching `sql-fanout-v2.spike.ts`.
 *
 * The existing production `sql-fanout.ts` and the four migration test
 * files are untouched.
 */

import { field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { expect, it } from 'vitest';
import { describeSqlMigration, spikeExtraDatetimeCol } from './sql-fanout-v2.spike';

// ---------------------------------------------------------------------------
// Scenario 1: common cols only — two-arg overload, no column declaration
// ---------------------------------------------------------------------------

describeSqlMigration(
  'v2 spike — Destructive column changes',
  ({ cols, defineContract, runMigration }) => {
    const ALL = { allowedOperationClasses: ['additive', 'widening', 'destructive'] } as const;

    it('drops a column and preserves remaining data', async () => {
      await runMigration({
        origin: defineContract({
          models: {
            User: model('User', {
              fields: {
                id: field.column(cols.int).id(),
                name: field.column(cols.text),
                temp: field.column(cols.text).optional(),
              },
            }),
          },
        }),
        destination: defineContract({
          models: {
            User: model('User', {
              fields: {
                id: field.column(cols.int).id(),
                name: field.column(cols.text),
              },
            }),
          },
        }),
        policy: ALL,
        before: async ({ db, runtime }) => {
          await runtime.execute(
            db.User.insert({ id: 1, name: 'Alice', temp: 'remove-me' }).build(),
          );
        },
        after: async ({ db, runtime }) => {
          const rows = await runtime.execute(db.User.select('id', 'name').orderBy('id').build());
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ id: 1, name: 'Alice' });
        },
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Scenario 2: per-test extras — three-arg overload adds `datetime`
// ---------------------------------------------------------------------------

describeSqlMigration(
  'v2 spike — Migration with datetime column (extras)',
  spikeExtraDatetimeCol,
  ({ cols, defineContract, runMigration }) => {
    it('creates a model with a datetime default that round-trips on both targets', async () => {
      await runMigration({
        destination: defineContract({
          models: {
            Event: model('Event', {
              fields: {
                id: field.column(cols.int).id(),
                name: field.column(cols.text),
                // cols.datetime came from the extras arg, not commonSqlCols.
                createdAt: field.column(cols.datetime).defaultSql('now()').column('created_at'),
              },
            }),
          },
        }),
        after: async ({ schema, driver }) => {
          // Schema-level assertion (portable across targets).
          expect(schema.tables['Event']).toBeDefined();
          expect(schema.tables['Event']!.columns['created_at']).toBeDefined();

          // Behavioral assertion via raw driver (the datetime cell is
          // a string in both targets — let it be opaque here).
          await driver.query('INSERT INTO "Event" (id, name) VALUES (?, ?)', [1, 'launch']);
          const rows = await driver.query<{ created_at: string }>(
            'SELECT created_at FROM "Event" WHERE id = ?',
            [1],
          );
          expect(rows.rows[0]?.created_at).toBeTruthy();
        },
      });
    });
  },
);
