import { MongoCommandExecutor, MongoInspectionExecutor } from '@prisma-next/adapter-mongo/control';
import type { Contract } from '@prisma-next/contract/types';
import type { MigratableTargetDescriptor } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import {
  contractToMongoSchemaIR,
  MongoMigrationPlanner,
  MongoMigrationRunner,
} from '@prisma-next/target-mongo/control';
import mongoTargetDescriptorMeta from '@prisma-next/target-mongo/pack';
import type { MongoControlFamilyInstance } from './control-instance';

export const mongoTargetDescriptor: MigratableTargetDescriptor<
  'mongo',
  'mongo',
  MongoControlFamilyInstance
> = {
  ...mongoTargetDescriptorMeta,
  migrations: {
    createPlanner(_family: MongoControlFamilyInstance) {
      return new MongoMigrationPlanner();
    },
    createRunner(_family: MongoControlFamilyInstance) {
      return new MongoMigrationRunner((db) => ({
        commandExecutor: new MongoCommandExecutor(db),
        inspectionExecutor: new MongoInspectionExecutor(db),
      }));
    },
    contractToSchema(contract: Contract | null) {
      return contractToMongoSchemaIR(contract as MongoContract | null);
    },
  },
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};
