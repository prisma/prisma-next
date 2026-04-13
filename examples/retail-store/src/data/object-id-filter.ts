import { MongoFieldFilter } from '@prisma-next/mongo-query-ast/execution';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { ObjectId } from 'mongodb';

function toObjectId(id: string | ObjectId): ObjectId {
  if (id instanceof ObjectId) return id;
  if (!ObjectId.isValid(id)) throw new Error(`Invalid ObjectId: ${id}`);
  return new ObjectId(id);
}

export function objectIdEq(field: string, id: string | ObjectId): MongoFieldFilter {
  return MongoFieldFilter.eq(field, new MongoParamRef(toObjectId(id)));
}

export function rawObjectIdFilter(field: string, id: string | ObjectId): Record<string, ObjectId> {
  return { [field]: toObjectId(id) };
}
