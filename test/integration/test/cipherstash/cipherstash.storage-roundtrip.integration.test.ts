import { EncryptedString } from '@prisma-next/extension-cipherstash';
import { bulkEncryptMiddleware } from '@prisma-next/extension-cipherstash/middleware';
import { createCipherstashRuntimeDescriptor } from '@prisma-next/extension-cipherstash/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { InsertAst, ParamRef, TableSource } from '@prisma-next/sql-relational-core/ast';
import { planFromAst } from '@prisma-next/sql-relational-core/plan';
import {
  createRealPostgresDatabase,
  type DevDatabase,
  timeouts,
  withClient,
} from '@prisma-next/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCipherstashTsContract,
  createMockCipherstashSdk,
  emitCipherstashTsContract,
  withCipherstashControlClient,
} from './helpers';

const CIPHERSTASH_CODEC_ID = 'cipherstash/string@1';

describe(
  'cipherstash storage round-trip and bulk write amortization',
  () => {
    const typedContractTemplate = createCipherstashTsContract();
    let database: DevDatabase;
    let contractJson: Record<string, unknown>;

    beforeAll(async () => {
      database = await createRealPostgresDatabase();
      contractJson = await emitCipherstashTsContract(typedContractTemplate);
      await withCipherstashControlClient(database.connectionString, async (client) => {
        const result = await client.dbInit({ contract: contractJson, mode: 'apply' });
        if (!result.ok) {
          throw new Error(
            `cipherstash dbInit failed: ${result.failure.summary}\n\n${JSON.stringify(result.failure, null, 2)}`,
          );
        }
      });
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      await database.close();
    }, timeouts.spinUpPpgDev);

    beforeEach(async () => {
      await withClient(database.connectionString, async (client) => {
        await client.query('TRUNCATE TABLE "user"');
      });
    });

    it(
      'round-trips through eql_v2_encrypted wire storage (T2.c.4)',
      async () => {
        const sdk = createMockCipherstashSdk();
        const db = postgres({
          contractJson,
          _contract: typedContractTemplate,
          url: database.connectionString,
          extensions: [createCipherstashRuntimeDescriptor({ sdk })],
          middleware: [bulkEncryptMiddleware(sdk)],
        });

        const runtime = await db.connect();
        try {
          const plaintext = 'alice@example.com';
          const inserted = await db.orm.User.create({
            id: 1,
            email: EncryptedString.from(plaintext),
          });

          await withClient(database.connectionString, async (client) => {
            const row = await client.query<{
              wire_type: string;
              wire_json: Record<string, unknown>;
            }>(
              'SELECT pg_typeof("email")::text AS wire_type, ("email")::jsonb AS wire_json FROM "user" LIMIT 1',
            );
            expect(row.rows).toHaveLength(1);
            expect(row.rows[0]?.wire_type).toBe('eql_v2_encrypted');
            expect(row.rows[0]?.wire_json).toBeTypeOf('object');
          });

          const found = await db.orm.User.where((u) => u.id.eq(inserted.id)).first();
          expect(found).not.toBeNull();
          if (!found) {
            throw new Error('expected inserted row to be queryable by id');
          }
          const email = found.email;
          expect(email).toBeInstanceOf(EncryptedString);
          if (!(email instanceof EncryptedString)) {
            throw new Error('expected read-side email to decode to EncryptedString');
          }
          expect(await email.decrypt()).toBe(plaintext);
        } finally {
          await runtime.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'issues one bulkEncrypt call for 10-row insert (T2.c.5)',
      async () => {
        const sdk = createMockCipherstashSdk();
        const db = postgres({
          contractJson,
          _contract: typedContractTemplate,
          url: database.connectionString,
          extensions: [createCipherstashRuntimeDescriptor({ sdk })],
          middleware: [bulkEncryptMiddleware(sdk)],
        });
        const runtime = await db.connect();

        try {
          const rows = Array.from({ length: 10 }, (_, i) => ({
            email: ParamRef.of(EncryptedString.from(`bulk-${i}@example.com`), {
              name: `email_${i}`,
              codecId: CIPHERSTASH_CODEC_ID,
            }),
          }));

          const ast = InsertAst.into(TableSource.named('user')).withRows(rows);
          await runtime.execute(planFromAst(ast, db.context.contract));

          expect(sdk.bulkEncryptCalls).toHaveLength(1);
          const call = sdk.bulkEncryptCalls[0];
          expect(call).toBeDefined();
          if (!call) {
            throw new Error('expected a single bulkEncrypt call');
          }
          expect(call.values).toHaveLength(10);
          expect(call.routingKey).toEqual({ table: 'user', column: 'email' });
        } finally {
          await runtime.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  },
  timeouts.spinUpPpgDev,
);
