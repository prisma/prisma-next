import { defineContract, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { applyMigration, int, pack, text } from './harness';

describe('SQLite Migration E2E - Widening operations (recreate-table)', () => {
  const WIDENING = { allowedOperationClasses: ['additive', 'widening'] } as const;

  it('relaxes NOT NULL to nullable', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text, bio: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), name: text, bio: text.optional() } }),
          },
        }),
        policy: WIDENING,
      },
      async ({ schema, driver }) => {
        expect(schema.tables['User']!.columns['bio']!.nullable).toBe(true);
        await driver.query('INSERT INTO "User" (id, name, bio) VALUES (?, ?, ?)', [
          1,
          'Alice',
          null,
        ]);
        expect(
          (await driver.query<{ bio: string | null }>('SELECT bio FROM "User" WHERE id = ?', [1]))
            .rows[0]!.bio,
        ).toBeNull();
      },
    );
  });

  it('changes a column default', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            Setting: model('Setting', { fields: { id: int.id(), status: text.default('draft') } }),
          },
        }),
        destination: defineContract({
          ...pack,
          models: {
            Setting: model('Setting', { fields: { id: int.id(), status: text.default('active') } }),
          },
        }),
        policy: WIDENING,
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Setting" (id) VALUES (?)', [1]);
        expect(
          (await driver.query<{ status: string }>('SELECT status FROM "Setting" WHERE id = ?', [1]))
            .rows[0]!.status,
        ).toBe('active');
      },
    );
  });

  it('preserves existing data through recreate-table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text, email: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), name: text, email: text.optional() } }),
          },
        }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name, email) VALUES (?, ?, ?)', [
            1,
            'Alice',
            'alice@example.com',
          ]);
          await driver.query('INSERT INTO "User" (id, name, email) VALUES (?, ?, ?)', [
            2,
            'Bob',
            'bob@example.com',
          ]);
        },
      },
      async ({ driver }) => {
        const rows = await driver.query<{ id: number; name: string; email: string }>(
          'SELECT * FROM "User" ORDER BY id',
        );
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]).toMatchObject({ id: 1, name: 'Alice', email: 'alice@example.com' });
        expect(rows.rows[1]).toMatchObject({ id: 2, name: 'Bob', email: 'bob@example.com' });
      },
    );
  });
});
