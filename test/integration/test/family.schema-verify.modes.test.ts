/**
 * Verification mode tests: strict mode, extensions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CodecTypes,
  defineContract,
  int4Column,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';

describe('family instance schemaVerify - modes', () => {
  const { getConnectionString } = useDevDatabase();

  describe('extension missing', () => {
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
      'returns ok=false with extension_missing issue',
      async () => {
        const contract = defineContract<CodecTypes>()
          .target('postgres')
          .table('user', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('email', { type: textColumn, nullable: false })
              .primaryKey(['id']),
          )
          .extensions({
            pgvector: {
              version: '1.0.0',
            },
          })
          .build();

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result).toMatchObject({
          ok: false,
          schema: {
            counts: { fail: expect.any(Number) },
            issues: expect.arrayContaining([
              expect.objectContaining({ kind: 'extension_missing' }),
            ]),
          },
        });
        expect(result.schema.counts.fail).toBeGreaterThan(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('strict mode: extra columns', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            "extraColumn" TEXT
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false in strict mode with extra_column issue',
      async () => {
        const contract = defineContract<CodecTypes>()
          .target('postgres')
          .table('user', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('email', { type: textColumn, nullable: false })
              .primaryKey(['id']),
          )
          .build();

        const result = await runSchemaVerify(getConnectionString(), contract, { strict: true });

        expect(result).toMatchObject({
          ok: false,
          schema: {
            counts: { fail: expect.any(Number) },
            issues: expect.arrayContaining([
              expect.objectContaining({
                kind: 'extra_column',
                table: 'user',
                column: 'extraColumn',
              }),
            ]),
          },
        });
        expect(result.schema.counts.fail).toBeGreaterThan(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'returns ok=true in permissive mode with extra column',
      async () => {
        const contract = defineContract<CodecTypes>()
          .target('postgres')
          .table('user', (t) =>
            t
              .column('id', { type: int4Column, nullable: false })
              .column('email', { type: textColumn, nullable: false })
              .primaryKey(['id']),
          )
          .build();

        const result = await runSchemaVerify(getConnectionString(), contract, { strict: false });

        // In permissive mode, extra columns don't cause failures
        expect(result).toMatchObject({
          ok: true,
          schema: {
            counts: { fail: 0 },
          },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
