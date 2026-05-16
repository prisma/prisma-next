import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import { mongoFamilyDescriptor } from '@prisma-next/family-mongo/control';
import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';
import { mongoTargetDescriptor } from '@prisma-next/target-mongo/control';

export default defineConfig({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  contract: mongoContract('./contract.prisma', {
    output: 'output/contract.json',
  }),
});
