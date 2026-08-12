import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { mongoFamilyDescriptor } from '@prisma-next/family-mongo/control';
import { mongoTargetDescriptor } from '@prisma-next/target-mongo/control';
import { ok } from '@prisma-next/utils/result';
import { contract } from './contract.mongo';

export default defineConfig({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  contract: {
    source: {
      load: async () => ok(contract as Contract),
    },
    output: 'output/contract.json',
  },
});
