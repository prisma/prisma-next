/**
 * Constraint verification tests: primary key, foreign key, unique.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CodecTypes,
  defineContract,
  int4Column,
  postgresPack,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers.ts';

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
        const contract = defineContract<CodecTypes>()
          .target(postgresPack)
          .table('user', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('email', { type: textColumn, nullable: false })
              .primaryKey(['id']),
          )
          .build();

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

    // TODO: Enable this test once foreignKey() is implemented in contract builder
    // Currently foreignKey() is a no-op that doesn't store foreign keys (see contract-authoring/RECOMMENDATIONS.md)
    it.skip(
      'returns ok=false with foreign_key_mismatch issue',
      async () => {
        const contract = defineContract<CodecTypes>()
          .target(postgresPack)
          .table('user', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('email', { type: textColumn, nullable: false })
              .primaryKey(['id']),
          )
          .table('post', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('userId', { type: int4Column, nullable: false })
              .column('title', { type: textColumn, nullable: false })
              .primaryKey(['id'])
              .foreignKey(['userId'], { table: 'user', columns: ['id'] }),
          )
          .build();

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
