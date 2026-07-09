import type { MongoControlAdapterDescriptor } from '@prisma-next/family-mongo/control-adapter';
import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import type { MongoControlDriverInstance } from '@prisma-next/mongo-lowering';

export { MongoInspectionExecutor } from '../core/inspection-executor';
export { introspectSchema } from '../core/introspect-schema';
export { MongoControlAdapterImpl } from '../core/mongo-control-adapter';
export { isMongoControlDriver } from '../core/mongo-control-driver';
export {
  createMongoRunnerDeps,
  extractDb,
  type MarkerOperations,
  type MongoRunnerDependencies,
} from '../core/runner-deps';
export { createMongoAdapter } from '../mongo-adapter';
export type { MongoControlDriverInstance };

import { MongoControlAdapterImpl } from '../core/mongo-control-adapter';

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel. Mirrors the descriptor's `scalarTypeDescriptors` map with explicit
 * `nativeType` values pinned to the codec manifests
 * (`codecLookup.targetTypesFor(codecId)[0]`).
 */
export const mongoScalarAuthoringTypes = {
  String: { kind: 'typeConstructor', output: { codecId: 'mongo/string@1', nativeType: 'string' } },
  Int: { kind: 'typeConstructor', output: { codecId: 'mongo/int32@1', nativeType: 'int' } },
  Boolean: { kind: 'typeConstructor', output: { codecId: 'mongo/bool@1', nativeType: 'bool' } },
  DateTime: { kind: 'typeConstructor', output: { codecId: 'mongo/date@1', nativeType: 'date' } },
  ObjectId: {
    kind: 'typeConstructor',
    output: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
  },
  Float: { kind: 'typeConstructor', output: { codecId: 'mongo/double@1', nativeType: 'double' } },
} as const satisfies AuthoringTypeNamespace;

export const mongoAdapterDescriptor: MongoControlAdapterDescriptor<'mongo'> = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  authoring: { type: mongoScalarAuthoringTypes },
  scalarTypeDescriptors: new Map([
    ['String', 'mongo/string@1'],
    ['Int', 'mongo/int32@1'],
    ['Boolean', 'mongo/bool@1'],
    ['DateTime', 'mongo/date@1'],
    ['ObjectId', 'mongo/objectId@1'],
    ['Float', 'mongo/double@1'],
  ]),
  types: {
    codecTypes: {
      import: {
        package: '@prisma-next/adapter-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
      typeImports: [
        {
          package: '@prisma-next/adapter-mongo/codec-types',
          named: 'Vector',
          alias: 'Vector',
        },
      ],
    },
  },
  create(_stack) {
    return new MongoControlAdapterImpl();
  },
};

export default mongoAdapterDescriptor;
