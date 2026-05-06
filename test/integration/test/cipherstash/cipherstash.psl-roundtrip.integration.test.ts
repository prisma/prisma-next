import { EncryptedString } from '@prisma-next/extension-cipherstash';
import { bulkEncryptMiddleware } from '@prisma-next/extension-cipherstash/middleware';
import { createCipherstashRuntimeDescriptor } from '@prisma-next/extension-cipherstash/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { timeouts, withRealPostgresDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  createCipherstashTsContract,
  createMockCipherstashSdk,
  emitCipherstashPslContract,
  withCipherstashControlClient,
} from './helpers';

const pslSchema = `
model User {
  id    Int @id @default(autoincrement())
  email cipherstash.EncryptedString({ equality: true, freeTextSearch: true })

  @@map("user")
}
`;

describe(
  'cipherstash storage round-trip from PSL-authored contract',
  () => {
    it(
      'decrypts values from a PSL-emitted contract (T2.c.7)',
      async () => {
        const typedContractTemplate = createCipherstashTsContract();
        const pslContractJson = await emitCipherstashPslContract(pslSchema);

        await withRealPostgresDatabase(async ({ connectionString }) => {
          await withCipherstashControlClient(connectionString, async (client) => {
            const init = await client.dbInit({ contract: pslContractJson, mode: 'apply' });
            if (!init.ok) {
              throw new Error(
                `dbInit failed for PSL contract: ${init.failure.summary}\n\n${JSON.stringify(init.failure, null, 2)}`,
              );
            }
          });

          const sdk = createMockCipherstashSdk();
          const db = postgres({
            contractJson: pslContractJson,
            _contract: typedContractTemplate,
            url: connectionString,
            extensions: [createCipherstashRuntimeDescriptor({ sdk })],
            middleware: [bulkEncryptMiddleware(sdk)],
          });

          const runtime = await db.connect();
          try {
            const plaintext = 'psl@example.com';
            const inserted = await db.orm.User.create({
              id: 1,
              email: EncryptedString.from(plaintext),
            });

            const found = await db.orm.User.where((u) => u.id.eq(inserted.id)).first();
            expect(found).not.toBeNull();
            if (!found) {
              throw new Error('expected PSL-inserted row to be queryable');
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
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
  timeouts.spinUpPpgDev,
);
