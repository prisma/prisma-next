/**
 * Verification mode tests: strict mode, dependency missing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  int4Column,
  model,
  pgvector,
  postgresPack,
  runSchemaVerify,
  sqlFamily,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';

describe('family instance schemaVerify - modes', () => {
  const { getConnectionString } = useDevDatabase();

  describe('dependency missing', () => {
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
      'returns ok=false with dependency_missing issue',
      async () => {
        const contract = defineContract({
          family: sqlFamily,
          target: postgresPack,
          extensionPacks: { pgvector },
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql({ table: 'user' }),
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract, {
          extensions: [pgvector],
        });

        expect(result).toMatchObject({
          ok: false,
          schema: {
            counts: { fail: expect.any(Number) },
            issues: expect.arrayContaining([
              expect.objectContaining({ kind: 'dependency_missing' }),
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
