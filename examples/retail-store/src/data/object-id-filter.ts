import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { ObjectId } from 'mongodb';

export function objectIdEq(field: string, id: string | unknown): MongoFieldFilter {
  const oid = id instanceof ObjectId ? id : new ObjectId(id as string);
  return MongoFieldFilter.eq(field, new MongoParamRef(oid));
}
