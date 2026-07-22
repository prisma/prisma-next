import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor } from '@prisma-next/family-mongo/control';
import { mongoTargetDescriptor } from '@prisma-next/target-mongo/control';

export default defineConfig({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
  extensions: [],
  contract: {
    source: {
      load: async () => ({ ok: true, value: {} }),
    },
    output: 'output/contract.json',
  },
  db: {
    connection: '{{MONGO_URI}}',
  },
});
