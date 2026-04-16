import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import {
  collMod,
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
} from './migration-factories';
import type { OpFactoryCall } from './op-factory-call';

function renderOne(call: OpFactoryCall): MongoMigrationPlanOperation {
  switch (call.factory) {
    case 'createIndex':
      return createIndex(call.collection, call.keys, call.options);
    case 'dropIndex':
      return dropIndex(call.collection, call.keys);
    case 'createCollection':
      return createCollection(call.collection, call.options);
    case 'dropCollection':
      return dropCollection(call.collection);
    case 'collMod':
      return collMod(call.collection, call.options, call.meta);
  }
}

export function renderOps(calls: ReadonlyArray<OpFactoryCall>): MongoMigrationPlanOperation[] {
  return calls.map(renderOne);
}
