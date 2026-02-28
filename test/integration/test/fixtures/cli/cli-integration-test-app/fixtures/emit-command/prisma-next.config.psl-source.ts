import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig, prismaContract } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { interpretPslDocumentToSqlContractIR } from '@prisma-next/sql-contract-psl';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  contract: prismaContract(
    './schema.prisma',
    async ({ schema, schemaPath }) => {
      const document = parsePslDocument({
        schema,
        sourceId: schemaPath,
      });

      return interpretPslDocumentToSqlContractIR({ document });
    },
    'output/contract.json',
  ),
});
