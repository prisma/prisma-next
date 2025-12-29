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

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
        expect(result.schema.issues.some((i) => i.kind === 'extension_missing')).toBe(true);
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

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
        expect(
          result.schema.issues.some(
            (i) => i.kind === 'extra_column' && i.table === 'user' && i.column === 'extraColumn',
          ),
        ).toBe(true);
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
        expect(result.ok).toBe(true);
        expect(result.schema.counts.fail).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
