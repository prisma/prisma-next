import { createMongoRunnerDeps } from '@prisma-next/adapter-mongo/control';
import type { Contract } from '@prisma-next/contract/types';
import type { MigratableTargetDescriptor } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import {
  contractToMongoSchemaIR,
  MongoMigrationPlanner,
  MongoMigrationRunner,
  type MongoRunnerDependencies,
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
      // Deps are bound to the first driver passed to execute() and cached for
      // subsequent calls. Callers must not change the driver between calls.
      let cachedDeps: MongoRunnerDependencies | undefined;
      return {
        async execute(options) {
          cachedDeps ??= createMongoRunnerDeps(options.driver);
          const { driver: _, ...runnerOptions } = options;
          const runner = new MongoMigrationRunner(cachedDeps);
          return runner.execute(runnerOptions);
        },
      };
    },
    contractToSchema(contract: Contract | null) {
      return contractToMongoSchemaIR(contract as MongoContract | null);
    },
  },
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};
