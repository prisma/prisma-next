import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { ok } from '@prisma-next/utils/result';
import { contract } from './contract';

export default defineConfig({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  contract: {
    source: {
      authoritativeInputs: { kind: 'moduleGraph' },
      load: async () => ok(contract as Contract),
    },
    output: 'generated/contract.json',
  },
});
