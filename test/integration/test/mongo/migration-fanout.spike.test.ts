import { field, index, model } from '@prisma-next/mongo-contract-ts/contract-builder';
import { expect, it } from 'vitest';
import { describeMongoMigration } from './mongo-fanout';

/**
 * Spike — exercises `describeMongoMigration` end-to-end.
 *
 * Demonstrates the parallel-but-separate shape with the SQL fan-out:
 *   - `defineContract({ models })` (family/target injected by helper)
 *   - `runMigration({ destination, before?, after })`
 *   - `after({ driver, schema, ... })` with `driver.db` for native Mongo
 *     access (no typed `db` builder — Mongo has none today).
 */

describeMongoMigration('Migration E2E - From empty schema', ({ defineContract, runMigration }) => {
  it('creates a users collection with a unique email index', async () => {
    await runMigration({
      destination: defineContract({
        models: {
          User: model('User', {
            collection: 'users',
            fields: {
              _id: field.objectId(),
              email: field.string(),
            },
            indexes: [index({ email: 1 }, { unique: true })],
          }),
        },
      }),
      after: async ({ schema, driver }) => {
        const users = schema.collection('users');
        expect(users).toBeDefined();
        expect(users!.indexes.some((i) => i.keys.some((k) => k.field === 'email'))).toBe(true);

        const rawIndexes = await driver.db.collection('users').listIndexes().toArray();
        const emailIdx = rawIndexes.find((i) => i['key']?.['email'] === 1);
        expect(emailIdx?.['unique']).toBe(true);
      },
    });
  });

  // Two-phase migration: origin establishes the collection (with an
  // explicit index so the Mongo planner emits a `createCollection` op),
  // `before` seeds data into the live DB, destination adds a new
  // collection, and `after` reads the seeded data back through the raw
  // driver. Demonstrates the origin/before/destination/after flow.
  it('runs origin then destination with seeding in between', async () => {
    const userModel = model('User', {
      collection: 'users',
      fields: { _id: field.objectId(), name: field.string() },
      indexes: [index({ name: 1 })],
    });
    const profileModel = model('Profile', {
      collection: 'profiles',
      fields: { _id: field.objectId(), userName: field.string() },
      indexes: [index({ userName: 1 })],
    });
    await runMigration({
      origin: defineContract({ models: { User: userModel } }),
      destination: defineContract({ models: { User: userModel, Profile: profileModel } }),
      before: async ({ driver }) => {
        await driver.db.collection('users').insertOne({ name: 'Alice' });
      },
      after: async ({ driver, schema }) => {
        expect(schema.collection('users')).toBeDefined();
        expect(schema.collection('profiles')).toBeDefined();
        const rows = await driver.db.collection('users').find({}).toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0]!['name']).toBe('Alice');
      },
    });
  });
});
