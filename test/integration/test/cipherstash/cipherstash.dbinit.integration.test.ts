import { timeouts, withRealPostgresDatabase } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  createCipherstashTsContract,
  emitCipherstashTsContract,
  readEqlInstallMarkers,
  withCipherstashControlClient,
} from './helpers';

describe(
  'cipherstash dbInit install and idempotency',
  () => {
    it(
      'installs EQL on fresh database and is idempotent on rerun (T2.c.6)',
      async () => {
        const contract = createCipherstashTsContract();
        const contractJson = await emitCipherstashTsContract(contract);

        await withRealPostgresDatabase(async ({ connectionString }) => {
          const before = await readEqlInstallMarkers(connectionString);
          expect(before.schemaExists).toBe(false);
          expect(before.configurationTableExists).toBe(false);

          await withCipherstashControlClient(connectionString, async (client) => {
            const first = await client.dbInit({ contract: contractJson, mode: 'apply' });
            if (!first.ok) {
              throw new Error(
                `first dbInit failed: ${first.failure.summary}\n\n${JSON.stringify(first.failure, null, 2)}`,
              );
            }

            const second = await client.dbInit({ contract: contractJson, mode: 'apply' });
            if (!second.ok) {
              throw new Error(
                `second dbInit failed: ${second.failure.summary}\n\n${JSON.stringify(second.failure, null, 2)}`,
              );
            }
            expect(second.value.plan.operations).toHaveLength(0);
            expect(second.value.summary.toLowerCase()).toContain('already');
          });

          const after = await readEqlInstallMarkers(connectionString);
          expect(after.schemaExists).toBe(true);
          expect(after.configurationTableExists).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
  timeouts.spinUpPpgDev,
);
