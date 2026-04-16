import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import {
  collMod,
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
} from './migration-factories';
import type {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
  OpFactoryCall,
  OpFactoryCallVisitor,
} from './op-factory-call';

const renderVisitor: OpFactoryCallVisitor<MongoMigrationPlanOperation> = {
  createIndex(call: CreateIndexCall) {
    return createIndex(call.collection, call.keys, call.options);
  },
  dropIndex(call: DropIndexCall) {
    return dropIndex(call.collection, call.keys);
  },
  createCollection(call: CreateCollectionCall) {
    return createCollection(call.collection, call.options);
  },
  dropCollection(call: DropCollectionCall) {
    return dropCollection(call.collection);
  },
  collMod(call: CollModCall) {
    return collMod(call.collection, call.options, call.meta);
  },
};

export function renderOps(calls: ReadonlyArray<OpFactoryCall>): MongoMigrationPlanOperation[] {
  return calls.map((call) => call.accept(renderVisitor));
}
