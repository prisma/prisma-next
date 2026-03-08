import { existsSync, rmSync, writeFileSync } from 'node:fs';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient, enrichContractIR } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIntegrationTestDir } from '../utils/cli-test-helpers';

describe(
  'authoring: PSL → emit → dbInit',
  () => {
    const originalCwd = process.cwd();
    let testDir: string;

    beforeEach(() => {
      testDir = createIntegrationTestDir();
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it(
      'dbInit succeeds for a PSL-emitted pgvector named type schema',
      async () => {
        const schemaPath = join(testDir, 'schema.prisma');
        writeFileSync(
          schemaPath,
          `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id @default(autoincrement())
  embedding Embedding1536
}
`,
          'utf-8',
        );

        process.chdir(testDir);
        const contractConfig = prismaContract('./schema.prisma');

        const pslResult = await contractConfig.source({
          composedExtensionPacks: ['pgvector'],
        });
        expect(pslResult.ok).toBe(true);
        if (!pslResult.ok) return;

        const frameworkComponents = [postgres, postgresAdapter, pgvector];
        const enrichedIR = enrichContractIR(pslResult.value, frameworkComponents);

        const familyInstance = sql.create({
          target: postgres,
          adapter: postgresAdapter,
          driver: undefined,
          extensionPacks: [pgvector],
        });

        const emitted = await familyInstance.emitContract({ contractIR: enrichedIR });
        const emittedContractIR = JSON.parse(emitted.contractJson) as Record<string, unknown>;

        await withDevDatabase(async ({ connectionString }) => {
          const client = createControlClient({
            family: sql,
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensionPacks: [pgvector],
          });

          try {
            await client.connect(connectionString);

            const plan = await client.dbInit({ contractIR: emittedContractIR, mode: 'plan' });
            expect(plan.ok).toBe(true);
            if (!plan.ok) return;

            const ddl = plan.value.plan.sql?.join(';\n\n') ?? '';
            expect(ddl).toContain('vector(1536)');
            expect(ddl).not.toContain('"vector(1536)"');

            const apply = await client.dbInit({ contractIR: emittedContractIR, mode: 'apply' });
            if (!apply.ok) {
              throw new Error(
                `dbInit apply failed: ${apply.failure.summary}\n\n${JSON.stringify(apply.failure, null, 2)}`,
              );
            }
          } finally {
            await client.close();
          }
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
  timeouts.spinUpPpgDev,
);
