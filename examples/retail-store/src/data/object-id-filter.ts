import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { ObjectId } from 'mongodb';

export function objectIdEq(field: string, id: string | ObjectId): MongoFieldFilter {
  const oid = id instanceof ObjectId ? id : new ObjectId(id);
  return MongoFieldFilter.eq(field, new MongoParamRef(oid));
}

export function rawObjectIdFilter(field: string, id: string | ObjectId): Record<string, ObjectId> {
  const oid = id instanceof ObjectId ? id : new ObjectId(id);
  return { [field]: oid };
}
