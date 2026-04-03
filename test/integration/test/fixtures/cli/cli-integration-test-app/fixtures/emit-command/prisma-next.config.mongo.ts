import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';

export default defineConfig({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  contract: mongoContract('./contract.prisma', {
    output: 'output/contract.json',
  }),
});
