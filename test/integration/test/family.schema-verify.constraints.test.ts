/**
 * Constraint verification tests: primary key, foreign key, unique.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  int4Column,
  model,
  postgresPack,
  rel,
  runSchemaVerify,
  sqlFamily,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';

describe('family instance schemaVerify - constraints', () => {
  const { getConnectionString } = useDevDatabase();

  describe('primary key mismatch', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL,
            email TEXT NOT NULL,
            PRIMARY KEY (email)
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with primary_key_mismatch issue',
      async () => {
        const contract = defineContract({
          family: sqlFamily,
          target: postgresPack,
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql({ table: 'user' }),
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result).toMatchObject({
          ok: false,
          schema: {
            counts: { fail: expect.any(Number) },
          },
        });
        expect(result.schema.counts.fail).toBeGreaterThan(0);
        expect(result.schema.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'primary_key_mismatch', table: 'user' }),
          ]),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('unique constraint mismatch', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with unique_constraint_mismatch issue',
      async () => {
        const contract = defineContract({
          family: sqlFamily,
          target: postgresPack,
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn).unique(),
              },
            }).sql({ table: 'user' }),
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result).toMatchObject({
          ok: false,
          schema: {
            counts: { fail: expect.any(Number) },
          },
        });
        expect(result.schema.counts.fail).toBeGreaterThan(0);
        expect(result.schema.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'unique_constraint_mismatch', table: 'user' }),
          ]),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('foreign key mismatch', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL
          )
        `);
        await client.query(`
          CREATE TABLE "post" (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            title TEXT NOT NULL
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with foreign_key_mismatch issue',
      async () => {
        const User = model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql({ table: 'user' });

        const Post = model('Post', {
          fields: {
            id: field.column(int4Column).id(),
            userId: field.column(int4Column),
            title: field.column(textColumn),
          },
          relations: {
            user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
          },
        }).sql({ table: 'post' });

        const contract = defineContract({
          family: sqlFamily,
          target: postgresPack,
          models: {
            User: User.relations({
              posts: rel.hasMany(Post, { by: 'userId' }),
            }),
            Post,
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result).toMatchObject({
          ok: false,
          schema: {
            counts: { fail: expect.any(Number) },
          },
        });
        expect(result.schema.counts.fail).toBeGreaterThan(0);
        expect(result.schema.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'foreign_key_mismatch', table: 'post' }),
          ]),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
