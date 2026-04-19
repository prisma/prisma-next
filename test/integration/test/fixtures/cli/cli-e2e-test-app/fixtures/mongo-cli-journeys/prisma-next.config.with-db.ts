import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { contract } from './contract';

export default defineConfig({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
  extensionPacks: [],
  contract: {
    source: async () => ({ ok: true as const, value: contract }),
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
  db: {
    connection: '{{DB_URL}}',
  },
  migrations: {
    dir: 'migrations',
  },
});
