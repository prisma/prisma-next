/**
 * Basic schema verification tests: happy path, missing table, missing column.
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

describe('family instance schemaVerify - basic', () => {
  const { getConnectionString } = useDevDatabase();

  describe('happy path: schema matches contract', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            CONSTRAINT "user_email_unique" UNIQUE (email)
          )
        `);
        await client.query(`
          CREATE TABLE "post" (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            title TEXT NOT NULL,
            FOREIGN KEY ("userId") REFERENCES "user"(id)
          )
        `);
        await client.query('CREATE INDEX "post_userId_idx" ON "post"("userId")');
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=true with all pass nodes',
      async () => {
        const contract = defineContract<CodecTypes>()
          .target(postgresPack)
          .table('user', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('email', { type: textColumn, nullable: false })
              .primaryKey(['id'])
              .unique(['email']),
          )
          .table('post', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('userId', { type: int4Column, nullable: false })
              .column('title', { type: textColumn, nullable: false })
              .primaryKey(['id'])
              .foreignKey(['userId'], { table: 'user', columns: ['id'] })
              .index(['userId']),
          )
          .build();

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result).toMatchObject({
          ok: true,
          schema: {
            counts: { fail: 0, pass: expect.any(Number) },
            root: { status: 'pass' },
          },
        });
        expect(result.schema.counts.pass).toBeGreaterThan(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('missing table', () => {
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
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with missing_table issue',
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
              .column('title', { type: textColumn, nullable: false })
              .primaryKey(['id']),
          )
          .build();

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result).toMatchObject({
          ok: false,
          schema: {
            counts: { fail: expect.any(Number) },
            root: { status: 'fail' },
          },
        });
        expect(result.schema.counts.fail).toBeGreaterThan(0);
        expect(result.schema.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'missing_table', table: 'post' }),
          ]),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('missing column', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with missing_column issue',
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
            expect.objectContaining({ kind: 'missing_column', table: 'user', column: 'email' }),
          ]),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
