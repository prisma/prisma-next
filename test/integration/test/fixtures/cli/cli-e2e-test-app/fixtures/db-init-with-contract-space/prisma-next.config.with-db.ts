import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import testContractSpaceExtension from '../../../../contract-space-fixture/control';
import { contract } from './contract';

// Declares a contract-space-publishing extension but does not emit any
// pinned `migrations/<space-id>/` artefacts on disk. Used by the
// contract-space verifier integration tests to exercise the
// `declaredButUnmigrated` violation path (AC-16).
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [testContractSpaceExtension],
  contract: {
    source: {
      load: async () => ({ ok: true, value: contract }),
    },
    output: 'src/prisma/contract.json',
  },
  db: {
    connection: '{{DB_URL}}',
  },
});
