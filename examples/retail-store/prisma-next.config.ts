import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { createMongoScalarTypeDescriptors } from '@prisma-next/mongo-contract-psl';
import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';

const scalarTypeDescriptors = new Map([
  ...createMongoScalarTypeDescriptors(),
  ['Float', 'mongo/double@1'],
]);

export default defineConfig({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
  contract: mongoContract('./prisma/contract.prisma', {
    output: 'src/contract.json',
    scalarTypeDescriptors,
  }),
  db: {
    connection: process.env['DB_URL'] ?? 'mongodb://localhost:27017/retail-store',
  },
});
