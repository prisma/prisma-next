import { field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { expect, it } from 'vitest';
import { describeSqlMigration } from '../../migration-targets/sql-fanout';

/**
 * Regression for the integer `@default` drift loop.
 *
 * `parseSqliteDefault` used to return integer-affinity defaults as JS strings
 * (e.g. `'42'`) while contract literals authored with `.default(42)` are JS
 * `number`. The verifier's `literalValuesEqual` does no cross-type coercion,
 * so `42 === '42'` failed and `verifySqlSchema` reported `default_mismatch`
 * on every plan. The fix mirrors `parsePostgresDefault`'s bigint handling:
 * parse as JS `number` when in the safe-integer range. Both targets must
 * round-trip without drift.
 */
describeSqlMigration(
  'Migration E2E - integer default drift',
  ({ cols, defineContract, runMigration }) => {
    it('verifies an integer `@default(42)` without drift', async () => {
      await runMigration({
        destination: defineContract({
          models: {
            Setting: model('Setting', {
              fields: {
                id: field.column(cols.int).id(),
                priority: field.column(cols.int).default(42),
              },
            }),
          },
        }),
        after: async ({ driver }) => {
          await driver.query('INSERT INTO "Setting" (id) VALUES (?)', [1]);
          const rows = await driver.query<{ priority: number }>(
            'SELECT priority FROM "Setting" WHERE id = ?',
            [1],
          );
          expect(rows.rows[0]!.priority).toBe(42);
        },
      });
    });
  },
);
