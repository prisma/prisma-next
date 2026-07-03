import type {
  ExecutionStack,
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@prisma-next/framework-components/execution';
import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import type { MongoAdapter } from '@prisma-next/mongo-lowering';
import { buildStandardCodecRegistry } from '../core/codecs';
import {
  type MongoOperationOutputCodecs,
  mongoOperationOutputCodecs,
} from '../core/operation-output-codecs';
import { createMongoAdapter } from '../mongo-adapter';

export type { MongoOperationOutputCodecs } from '../core/operation-output-codecs';
export { mongoOperationOutputCodecs } from '../core/operation-output-codecs';

/**
 * adapter-mongo deliberately does NOT import the `MongoRuntimeAdapterDescriptor` type alias from `@prisma-next/mongo-runtime`. The adapter package is downstream of the Mongo runtime package only conceptually; introducing a hard import would create a workspace dependency cycle (`mongo-runtime` consumes the runtime descriptor's `create(stack)` factory; `adapter-mongo` would then need `mongo-runtime` to type the
 * descriptor). The descriptor is shaped to satisfy the framework's `RuntimeAdapterDescriptor` plus the structural `MongoStaticContributions` (`codecs()`) that `@prisma-next/mongo-runtime` narrows to at composition time. This mirrors the `target-postgres` ↔ `sql-runtime` decoupling pattern.
 */

interface MongoRuntimeAdapterInstance
  extends RuntimeAdapterInstance<'mongo', 'mongo'>,
    MongoAdapter {}

const mongoRuntimeAdapterDescriptor: RuntimeAdapterDescriptor<
  'mongo',
  'mongo',
  MongoRuntimeAdapterInstance
> & {
  readonly codecs: () => MongoCodecRegistry;
  readonly operationOutputCodecs: MongoOperationOutputCodecs;
} = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  codecs: buildStandardCodecRegistry,
  operationOutputCodecs: mongoOperationOutputCodecs,
  create(_stack: ExecutionStack<'mongo', 'mongo'>): MongoRuntimeAdapterInstance {
    const adapter = createMongoAdapter();
    return {
      familyId: 'mongo' as const,
      targetId: 'mongo' as const,
      lower: adapter.lower.bind(adapter),
      structuralLower: adapter.structuralLower.bind(adapter),
      resolveParams: adapter.resolveParams.bind(adapter),
    };
  },
};

export default mongoRuntimeAdapterDescriptor;
