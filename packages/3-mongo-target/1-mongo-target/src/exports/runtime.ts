import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@prisma-next/framework-components/execution';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@prisma-next/mongo-codec';
import { mongoTargetDescriptorMeta } from '../core/descriptor-meta';

export interface MongoRuntimeTargetInstance extends RuntimeTargetInstance<'mongo', 'mongo'> {}

/**
 * Target-mongo deliberately does NOT import `MongoRuntimeTargetDescriptor` from `@prisma-next/mongo-runtime`. The target package is a control-plane residence and must not pull the Mongo execution-plane package into its dependency closure. The runtime descriptor here is shaped to satisfy the framework's `RuntimeTargetDescriptor` plus the structural `MongoStaticContributions` (`codecs`) that `@prisma-next/mongo-runtime`
 * consumers narrow to at composition time.
 */
const mongoRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'mongo',
  'mongo',
  MongoRuntimeTargetInstance
> & {
  readonly codecs: () => MongoCodecRegistry;
} = {
  ...mongoTargetDescriptorMeta,
  // The target descriptor itself contributes no codecs — the standard set lives on the adapter descriptor (see `@prisma-next/adapter-mongo/runtime`).
  codecs: () => newMongoCodecRegistry(),
  create(): MongoRuntimeTargetInstance {
    return {
      familyId: 'mongo',
      targetId: 'mongo',
    };
  },
};

export default mongoRuntimeTargetDescriptor;
