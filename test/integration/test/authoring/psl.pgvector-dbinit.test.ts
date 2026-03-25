import { existsSync, rmSync, writeFileSync } from 'node:fs';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlClient, enrichContractIR } from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import sql, { assemblePslInterpretationContributions } from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIntegrationTestDir } from '../utils/cli-test-helpers';

describe(
  'authoring: PSL → emit → dbInit / dbUpdate',
  () => {
    const originalCwd = process.cwd();
    const frameworkComponents = [postgres, postgresAdapter, pgvector] as const;
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

    async function emitPgvectorContractIR(schemaText: string): Promise<Record<string, unknown>> {
      const schemaPath = join(testDir, 'schema.prisma');
      writeFileSync(schemaPath, schemaText, 'utf-8');

      process.chdir(testDir);
      const pslContributions = assemblePslInterpretationContributions(frameworkComponents);
      const contractConfig = prismaContract('./schema.prisma', {
        target: postgres,
        scalarTypeDescriptors: pslContributions.scalarTypeDescriptors,
        controlMutationDefaults: {
          defaultFunctionRegistry: pslContributions.defaultFunctionRegistry,
          generatorDescriptors: pslContributions.generatorDescriptors,
        },
        composedExtensionPacks: ['pgvector'],
      });

      const pslResult = await contractConfig.source({
        composedExtensionPacks: ['pgvector'],
      });
      expect(pslResult.ok).toBe(true);
      if (!pslResult.ok) {
        throw new Error('expected pgvector PSL source emission to succeed');
      }

      const enrichedIR = enrichContractIR(pslResult.value, frameworkComponents);
      const familyInstance = sql.create({
        target: postgres,
        adapter: postgresAdapter,
        driver: undefined,
        extensionPacks: [pgvector],
      });

      const emitted = await familyInstance.emitContract({ contractIR: enrichedIR });
      return JSON.parse(emitted.contractJson) as Record<string, unknown>;
    }

    async function withPgvectorControlClient<T>(
      connectionString: string,
      fn: (client: ReturnType<typeof createControlClient>) => Promise<T>,
    ): Promise<T> {
      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensionPacks: [pgvector],
      });

      try {
        await client.connect(connectionString);
        return await fn(client);
      } finally {
        await client.close();
      }
    }

    it(
      'dbInit succeeds for a PSL-emitted pgvector named type schema',
      async () => {
        const emittedContractIR = await emitPgvectorContractIR(`types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id @default(autoincrement())
  embedding Embedding1536
}
`);

        await withDevDatabase(async ({ connectionString }) => {
          await withPgvectorControlClient(connectionString, async (client) => {
            const plan = await client.dbInit({ contractIR: emittedContractIR, mode: 'plan' });
            expect(plan.ok).toBe(true);
            if (!plan.ok) {
              throw new Error(`dbInit plan failed: ${plan.failure.summary}`);
            }

            const ddl = plan.value.plan.sql?.join(';\n\n') ?? '';
            expect(ddl).toContain('vector(1536)');
            expect(ddl).not.toContain('"vector(1536)"');

            const apply = await client.dbInit({ contractIR: emittedContractIR, mode: 'apply' });
            if (!apply.ok) {
              throw new Error(
                `dbInit apply failed: ${apply.failure.summary}\n\n${JSON.stringify(apply.failure, null, 2)}`,
              );
            }
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'dbUpdate recovers a dropped pgvector NOT NULL column on a non-empty table',
      async () => {
        const emittedContractIR = await emitPgvectorContractIR(`types {
  Embedding3 = Bytes @pgvector.column(length: 3)
}

model Document {
  id Int @id @default(autoincrement())
  embedding Embedding3
}
`);

        await withDevDatabase(async ({ connectionString }) => {
          await withPgvectorControlClient(connectionString, async (client) => {
            const init = await client.dbInit({ contractIR: emittedContractIR, mode: 'apply' });
            if (!init.ok) {
              throw new Error(
                `dbInit apply failed: ${init.failure.summary}\n\n${JSON.stringify(init.failure, null, 2)}`,
              );
            }
          });

          let documentId = 0;
          await withClient(connectionString, async (client) => {
            const inserted = await client.query<{ id: number }>(
              `INSERT INTO "document" ("embedding") VALUES ('[1,2,3]') RETURNING "id"`,
            );
            documentId = inserted.rows[0]?.id ?? 0;
            expect(documentId).toBeGreaterThan(0);

            await client.query('ALTER TABLE "document" DROP COLUMN "embedding"');
          });

          await withPgvectorControlClient(connectionString, async (client) => {
            const update = await client.dbUpdate({ contractIR: emittedContractIR, mode: 'apply' });
            if (!update.ok) {
              throw new Error(
                `dbUpdate apply failed: ${update.failure.summary}\n\n${JSON.stringify(update.failure, null, 2)}`,
              );
            }
          });

          await withClient(connectionString, async (client) => {
            const restoredRows = await client.query<{ embedding_text: string }>(
              `SELECT "embedding"::text AS embedding_text
               FROM "document"
               WHERE "id" = $1`,
              [documentId],
            );
            expect(restoredRows.rows).toEqual([{ embedding_text: '[0,0,0]' }]);

            const defaultCheck = await client.query<{ column_default: string | null }>(`
              SELECT column_default
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'document'
                AND column_name = 'embedding'
            `);
            expect(defaultCheck.rows[0]?.column_default ?? null).toBeNull();
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
  timeouts.spinUpPpgDev,
);
